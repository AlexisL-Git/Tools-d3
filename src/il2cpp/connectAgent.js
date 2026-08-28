'use strict';

// Agent d'injection: amene le trafic du client jusqu'a notre proxy, et fait
// passer plusieurs clients pour une seule machine.
//
// Reproduit les trois mecanismes releves sur le produit de krm35
// (voir docs/superpowers/specs/2026-08-19-architecture-reelle-du-omni.md),
// avec une difference sur le troisieme.
//
//   1. connect() est detourne vers 127.0.0.1:<proxyPort>. Seul, cela ne peut
//      pas fonctionner: on vient d'ecraser la destination, donc le proxy ne
//      sait pas ou relayer. La ligne CONNECT ecrite juste apres la lui annonce.
//   2. l'identifiant unique de machine est remplace.
//   3. l'ouverture des fichiers de .cache est mise en echec.
//
// Sur le point 2, l'original code en dur GameAssembly.dll+0x4D15DF0, un RVA qui
// se deplace a chaque patch du jeu. On resout ici la methode PAR SON NOM via
// l'API IL2CPP, ce qui survit aux mises a jour.

function connectAgentSource({
  proxyPort,
  // Ces deux mecanismes viennent du produit de krm35 et n'ont qu'un objet:
  // faire passer plusieurs clients d'un meme poste pour des machines
  // distinctes, ce qui n'a de sens que face a un serveur monocompte. Sur un
  // serveur multicompte, faire tourner plusieurs clients depuis une machine
  // est le fonctionnement prevu — Zaap passe lui-meme --instanceId au jeu.
  // Ils restent disponibles mais ne sont pas poses par defaut: on ne
  // contourne pas une detection dont on n'a que faire.
  fakeDeviceId = null,
  neutralizeCache = false,
  excludePorts = [],
  // Le client ouvre bien plus que la partie: HTTPS vers les CDN, et surtout
  // 127.0.0.1:26116 vers le launcher Ankama, d'ou il tient sa session.
  // Detourner cette derniere coupe la session et le jeu affiche
  // « The connection between DOFUS and the Ankama Launcher has been lost ».
  // On ne detourne donc que le port de jeu, annonce par --connectionPort.
  onlyPorts = [5555],
  reportFocus = false,
} = {}) {
  if (!Number.isInteger(proxyPort) || proxyPort <= 0 || proxyPort > 65535) {
    throw new Error('proxyPort invalide');
  }
  return `
    const PROXY_PORT = ${proxyPort};
    const FAKE_ID = ${JSON.stringify(fakeDeviceId)};
    const EXCLUDE = ${JSON.stringify(excludePorts)};
    const ONLY = ${JSON.stringify(onlyPorts || [])};
    const report = [];

    let _ws2 = null;
    function ws2(n) {
      if (_ws2 === null) _ws2 = Process.getModuleByName('ws2_32.dll');
      // Frida 17 a retire Module.findExportByName(module, nom) ET
      // Module.getExportByName: tout passe par l'objet Module.
      return _ws2.findExportByName ? _ws2.findExportByName(n) : _ws2.getExportByName(n);
    }

    const AF_INET = 2, AF_INET6 = 23;
    const socket_send = new NativeFunction(ws2('send'), 'int', ['int', 'pointer', 'int', 'int']);

    // Le jeu joint son serveur par une adresse IPv4 MAPPEE en IPv6
    // (::ffff:a.b.c.d). Ecrite sous forme de groupes hexadecimaux, elle
    // arrivait au proxy comme "0:0:0:0:0:ffff:6c80:f748" — techniquement
    // valide, mais inutilisable pour relayer. On rend la forme pointee.
    function readV6(sockaddr) {
      const b = [];
      for (let i = 0; i < 16; i++) b.push(sockaddr.add(8 + i).readU8());
      let mapped = true;
      for (let i = 0; i < 10; i++) if (b[i] !== 0) { mapped = false; break; }
      if (mapped && b[10] === 0xff && b[11] === 0xff) {
        return b[12] + '.' + b[13] + '.' + b[14] + '.' + b[15];
      }
      const parts = [];
      for (let i = 0; i < 16; i += 2) parts.push(((b[i] << 8) | b[i + 1]).toString(16));
      return parts.join(':');
    }

    // Lecture seule, avant toute decision: sert au journal.
    function peek(sockaddr) {
      const family = sockaddr.readU16();
      const port = (sockaddr.add(2).readU8() << 8) | sockaddr.add(3).readU8();
      if (family === AF_INET) {
        const o = [];
        for (let i = 0; i < 4; i++) o.push(sockaddr.add(4 + i).readU8());
        return { host: o.join('.'), port: port, family: family };
      }
      if (family === AF_INET6) return { host: readV6(sockaddr), port: port, family: family };
      return { host: '(famille ' + family + ')', port: port, family: family };
    }

    // sockaddr_in  : famille(2) port(2, gros-boutiste) adresse(4)
    // sockaddr_in6 : famille(2) port(2) flowinfo(4) adresse(16)
    function redirect(sockaddr) {
      const family = sockaddr.readU16();
      const port = (sockaddr.add(2).readU8() << 8) | sockaddr.add(3).readU8();
      let host = null;

      if (family === AF_INET) {
        const o = [];
        for (let i = 0; i < 4; i++) o.push(sockaddr.add(4 + i).readU8());
        host = o.join('.');
      } else if (family === AF_INET6) {
        host = readV6(sockaddr);
      } else {
        return null;
      }

      // La reecriture n'a lieu qu'ici: si le port n'est pas retenu, l'adresse
      // d'origine reste intacte et la connexion part normalement.
      if (EXCLUDE.indexOf(port) >= 0) return null;
      if (ONLY.length && ONLY.indexOf(port) < 0) return null;

      if (family === AF_INET) sockaddr.add(4).writeByteArray([127, 0, 0, 1]);
      else sockaddr.add(8).writeByteArray([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]);
      sockaddr.add(2).writeByteArray([(PROXY_PORT >> 8) & 0xff, PROXY_PORT & 0xff]);
      return { host: host, port: port };
    }

    // Chaque connect est signale, detourne ou non. Sans cela, l'absence de
    // trafic dans le proxy ne dit pas si le hook n'a pas vu la connexion ou
    // si le filtre l'a laissee passer — deux causes opposees.
    Interceptor.attach(ws2('connect'), {
      onEnter: function (args) {
        this.sockfd = args[0];
        try { this.vu = peek(args[1]); } catch (e) { this.vu = null; }
        try { this.target = redirect(args[1]); } catch (e) { this.target = null; }
        if (this.vu) send({ connect: this.vu.host + ':' + this.vu.port, detourne: this.target !== null });
      },
      onLeave: function () {
        if (!this.target) return;
        // Le proxy ne recevrait qu'une connexion sans destination: on la lui
        // annonce. Ni CRLF ni espace finale — la charge utile du jeu suit
        // immediatement, et le proxy reconnait la fin de ligne au suffixe.
        const line = 'CONNECT ' + this.target.host + ':' + this.target.port + ' HTTP/1.0';
        const buf = Memory.allocUtf8String(line);
        socket_send(this.sockfd.toInt32(), buf, line.length, 0);
      }
    });
    report.push('connect -> 127.0.0.1:' + PROXY_PORT);

    ${fakeDeviceId === null ? '' : `
    {
      // Resolution par nom plutot que par adresse: un RVA code en dur meurt au
      // premier patch du jeu.
      setTimeout(function () {
        try {
          const ga = Process.getModuleByName('GameAssembly.dll');
          const ex = (n) => ga.findExportByName ? ga.findExportByName(n) : ga.getExportByName(n);
          const F = (n, r, a) => new NativeFunction(ex(n), r, a);

          const domain_get     = F('il2cpp_domain_get', 'pointer', []);
          const thread_attach  = F('il2cpp_thread_attach', 'pointer', ['pointer']);
          const domain_get_asm = F('il2cpp_domain_get_assemblies', 'pointer', ['pointer', 'pointer']);
          const asm_get_image  = F('il2cpp_assembly_get_image', 'pointer', ['pointer']);
          const image_get_name = F('il2cpp_image_get_name', 'pointer', ['pointer']);
          const class_from_name= F('il2cpp_class_from_name', 'pointer', ['pointer', 'pointer', 'pointer']);
          const class_get_mfn  = F('il2cpp_class_get_method_from_name', 'pointer', ['pointer', 'pointer', 'int']);
          const string_new     = F('il2cpp_string_new', 'pointer', ['pointer']);
          const S = (p) => (!p || p.isNull()) ? '' : p.readUtf8String();
          const C = (s) => Memory.allocUtf8String(s);

          const domain = domain_get();
          thread_attach(domain);

          const sz = Memory.alloc(8); sz.writeU64(0);
          const asms = domain_get_asm(domain, sz);
          const n = sz.readU64().toNumber();
          let img = null;
          for (let i = 0; i < n; i++) {
            const im = asm_get_image(asms.add(i * Process.pointerSize).readPointer());
            if (S(image_get_name(im)) === 'UnityEngine.CoreModule.dll') { img = im; break; }
          }
          if (img === null) { send({ warn: 'UnityEngine.CoreModule.dll introuvable' }); return; }

          const k = class_from_name(img, C('UnityEngine'), C('SystemInfo'));
          if (k.isNull()) { send({ warn: 'UnityEngine.SystemInfo introuvable' }); return; }
          const mi = class_get_mfn(k, C('get_deviceUniqueIdentifier'), 0);
          if (mi.isNull()) { send({ warn: 'get_deviceUniqueIdentifier introuvable' }); return; }

          const target = mi.readPointer();   // 1er champ du MethodInfo = code natif
          Interceptor.attach(target, {
            onLeave: function (retval) {
              const forged = string_new(Memory.allocAnsiString(FAKE_ID));
              retval.replace(forged);
            }
          });
          send({ hooked: 'SystemInfo.get_deviceUniqueIdentifier @ ' + target });
        } catch (e) {
          send({ warn: 'empreinte: ' + e.message });
        }
      }, 200);
      report.push('empreinte machine remplacee');
    }`}

    ${neutralizeCache ? `
    {
      const k32 = Process.getModuleByName('kernel32.dll');
      const cf = k32.findExportByName ? k32.findExportByName('CreateFileW') : k32.getExportByName('CreateFileW');
      Interceptor.attach(cf, {
        onEnter: function (args) {
          try {
            const name = args[0].readUtf16String();
            if (name && name.indexOf('.cache') >= 0) args[0].writeUtf16String(name + 'nop');
          } catch (e) {}
        }
      });
      report.push('cache neutralise');
    }` : ''}

    ${reportFocus ? `
    {
      // Le maitre est le client dont la fenetre a le focus. Plutot que de
      // sonder le systeme depuis le superviseur, chaque agent dit lui-meme
      // s'il est au premier plan: il est deja dans le process, il connait son
      // pid, et le changement est signale au lieu d'etre interroge.
      const u32 = Process.getModuleByName('user32.dll');
      const ex = (n) => u32.findExportByName ? u32.findExportByName(n) : u32.getExportByName(n);
      const getForeground = new NativeFunction(ex('GetForegroundWindow'), 'pointer', []);
      const getThreadPid = new NativeFunction(ex('GetWindowThreadProcessId'), 'uint32', ['pointer', 'pointer']);
      const slot = Memory.alloc(4);
      let dernier = null;
      setInterval(function () {
        try {
          const hwnd = getForeground();
          if (hwnd.isNull()) return;
          slot.writeU32(0);
          getThreadPid(hwnd, slot);
          const actif = slot.readU32() === Process.id;
          if (actif !== dernier) { dernier = actif; send({ premierPlan: actif }); }
        } catch (e) {}
      }, 250);
      report.push('premier plan surveille');
    }` : ''}


    // MISE AU PREMIER PLAN, sur commande de l'hote.
    //
    // POURQUOI DEPUIS L'AGENT. SetForegroundWindow est bride: Windows n'y
    // autorise qu'un processus qui a recu le dernier evenement d'entree, ou
    // qui est deja au premier plan. Le contournement documente par Microsoft
    // est AttachThreadInput: on rattache le fil de NOTRE fenetre a celui du
    // premier plan courant, le temps de l'appel. Cela demande d'etre dans la
    // place, donc dans le process du jeu — l'agent y est deja.
    //
    // Ces fonctions user32, l'agent les appelait deja pour surveiller le
    // premier plan: aucune surface nouvelle.
    {
      const u32b = Process.getModuleByName('user32.dll');
      const exb = (n) => u32b.findExportByName ? u32b.findExportByName(n) : u32b.getExportByName(n);
      const k32 = Process.getModuleByName('kernel32.dll');
      const exk = (n) => k32.findExportByName ? k32.findExportByName(n) : k32.getExportByName(n);

      const EnumWindows = new NativeFunction(exb('EnumWindows'), 'int', ['pointer', 'pointer']);
      const IsWindowVisible = new NativeFunction(exb('IsWindowVisible'), 'int', ['pointer']);
      const GetWindowThreadProcessId2 = new NativeFunction(exb('GetWindowThreadProcessId'), 'uint32', ['pointer', 'pointer']);
      const SetForegroundWindow = new NativeFunction(exb('SetForegroundWindow'), 'int', ['pointer']);
      const AttachThreadInput = new NativeFunction(exb('AttachThreadInput'), 'int', ['uint32', 'uint32', 'int']);
      const GetForegroundWindow2 = new NativeFunction(exb('GetForegroundWindow'), 'pointer', []);
      const BringWindowToTop = new NativeFunction(exb('BringWindowToTop'), 'int', ['pointer']);
      const ShowWindow = new NativeFunction(exb('ShowWindow'), 'int', ['pointer', 'int']);
      const IsIconic = new NativeFunction(exb('IsIconic'), 'int', ['pointer']);
      const GetCurrentThreadId = new NativeFunction(exk('GetCurrentThreadId'), 'uint32', []);
      const SW_RESTORE = 9;

      // Ces deux-la peuvent manquer selon la version de Windows: on les rend
      // facultatives plutot que de faire echouer tout l'agent au chargement.
      const opt = (nom, retour, args) => {
        try {
          const p = exb(nom);
          return p === null ? null : new NativeFunction(p, retour, args);
        } catch (e) { return null; }
      };
      const SwitchToThisWindow = opt('SwitchToThisWindow', 'void', ['pointer', 'int']);
      const SystemParametersInfoW = opt('SystemParametersInfoW', 'int', ['uint32', 'uint32', 'pointer', 'uint32']);
      const SPI_GETFOREGROUNDLOCKTIMEOUT = 0x2000;
      const SPI_SETFOREGROUNDLOCKTIMEOUT = 0x2001;
      const SPIF_SENDCHANGE = 0x02;

      const casier = Memory.alloc(4);
      const filDe = (hwnd) => {
        casier.writeU32(0);
        return GetWindowThreadProcessId2(hwnd, casier);
      };

      // La premiere fenetre VISIBLE de haut niveau qui nous appartienne. Le
      // jeu en cree d'autres, invisibles, dont la mise au premier plan ne
      // ferait rien de visible pour l'utilisateur.
      const rappel = new NativeCallback(function (hwnd, _lp) {
        if (trouvee !== null) return 0;
        if (IsWindowVisible(hwnd) === 0) return 1;
        casier.writeU32(0);
        GetWindowThreadProcessId2(hwnd, casier);
        if (casier.readU32() === Process.id) { trouvee = hwnd; return 0; }
        return 1;
      }, 'int', ['pointer', 'pointer']);
      let trouvee = null;
      function maFenetre() {
        trouvee = null;
        EnumWindows(rappel, NULL);
        return trouvee;
      }

      // TROIS RECOURS, DANS L'ORDRE, ET ON S'ARRETE DES QUE CA MARCHE.
      //
      // SetForegroundWindow seul reussissait environ une fois sur deux. Windows
      // protege deliberement le premier plan, et un seul appel ne suffit pas:
      // la regle depend de qui a recu la derniere entree, du verrou de premier
      // plan, et de l'etat du bureau au moment precis de l'appel.
      //
      //   1. AttachThreadInput + SetForegroundWindow — le contournement
      //      documente par Microsoft, qui marche la plupart du temps.
      //   2. SwitchToThisWindow — non documente mais stable depuis vingt ans,
      //      c'est ce qu'utilise Alt+Tab, et il ignore le verrou.
      //   3. Verrou de premier plan mis a zero, nouvel essai, verrou remis.
      //      Le plus intrusif, donc le dernier, et l'ancienne valeur est
      //      TOUJOURS restauree.
      //
      // Chaque etape est verifiee: on rend compte de ce qui s'est passe, pas de
      // ce qu'on a tente.
      function estDevant(h) {
        const a = GetForegroundWindow2();
        return !a.isNull() && a.equals(h);
      }

      function auPremierPlan() {
        const moi = maFenetre();
        if (moi === null || moi.isNull()) return false;
        // Une fenetre reduite ne peut pas passer devant: on la restaure
        // d'abord, sans quoi la bascule est silencieusement sans effet.
        if (IsIconic(moi) !== 0) ShowWindow(moi, SW_RESTORE);
        if (estDevant(moi)) return true;

        // --- 1. le contournement documente ---
        const devant = GetForegroundWindow2();
        const filDevant = devant.isNull() ? 0 : filDe(devant);
        const filMoi = filDe(moi);
        const rattache = filDevant !== 0 && filDevant !== filMoi
          && AttachThreadInput(filMoi, filDevant, 1) !== 0;
        try {
          SetForegroundWindow(moi);
          BringWindowToTop(moi);
        } finally {
          // Le detachement est OBLIGATOIRE: deux fils dont les entrees restent
          // liees se bloquent mutuellement au premier incident.
          if (rattache) AttachThreadInput(filMoi, filDevant, 0);
        }
        if (estDevant(moi)) return true;

        // --- 2. la voie d'Alt+Tab ---
        if (SwitchToThisWindow !== null) {
          try { SwitchToThisWindow(moi, 1); } catch (e) {}
          if (estDevant(moi)) return true;
        }

        // --- 3. le verrou de premier plan, rendu ensuite ---
        if (SystemParametersInfoW !== null) {
          const ancien = Memory.alloc(8);
          ancien.writeU64(0);
          let lu = false;
          try {
            lu = SystemParametersInfoW(SPI_GETFOREGROUNDLOCKTIMEOUT, 0, ancien, 0) !== 0;
            SystemParametersInfoW(SPI_SETFOREGROUNDLOCKTIMEOUT, 0, NULL, SPIF_SENDCHANGE);
            SetForegroundWindow(moi);
            BringWindowToTop(moi);
          } catch (e) {
          } finally {
            if (lu) {
              try {
                SystemParametersInfoW(SPI_SETFOREGROUNDLOCKTIMEOUT, 0,
                  ptr(ancien.readU32()), SPIF_SENDCHANGE);
              } catch (e) {}
            }
          }
          if (estDevant(moi)) return true;
        }

        return false;
      }

      // recv n'ecoute qu'UNE fois: on se replace apres chaque message, sinon
      // la premiere bascule serait aussi la derniere.
      function ecouter() {
        recv('premierPlan', function () {
          let fait = false;
          try { fait = auPremierPlan(); } catch (e) { fait = false; }
          send({ premierPlanFait: fait });
          ecouter();
        });
      }
      ecouter();
      report.push('commande de fenetre');
    }

    // LES BOUTONS DE SOURIS, allumes sur commande de l'hote.
    //
    // POURQUOI ICI. globalShortcut d'Electron ne connait que le clavier:
    // aucun bouton de souris n'est representable dans un accelerateur, et
    // register() rendrait faux sans lever. On observe donc l'etat des boutons
    // depuis l'interieur du process du jeu, ou l'agent est deja.
    //
    // LE BOUTON N'EST PAS CONFISQUE A DOFUS. GetAsyncKeyState lit un etat, il
    // n'intercepte rien: le jeu recoit le clic lui aussi. C'est sans
    // consequence pour M4 et M5, que le jeu n'utilise pas.
    //
    // La boucle ne tourne QUE si un bouton est assigne. Une boucle de 250 ms
    // a deja ete retiree d'ici parce qu'elle repondait a une question qu'on ne
    // posait plus; celle-ci est plus rapide, donc elle doit se justifier a
    // chaque instant ou elle tourne.
    {
      const u32s = Process.getModuleByName('user32.dll');
      const exs = (n) => u32s.findExportByName ? u32s.findExportByName(n) : u32s.getExportByName(n);
      const getEtatTouche = new NativeFunction(exs('GetAsyncKeyState'), 'int16', ['int']);
      const devantS = new NativeFunction(exs('GetForegroundWindow'), 'pointer', []);
      const pidDeS = new NativeFunction(exs('GetWindowThreadProcessId'), 'uint32', ['pointer', 'pointer']);
      const casier = Memory.alloc(4);

      // VK_MBUTTON, VK_XBUTTON1, VK_XBUTTON2 -> numero de bouton du DOM.
      const BOUTONS_VK = [[0x04, 1], [0x05, 3], [0x06, 4]];
      const VK_SHIFT = 0x10;
      const VK_CONTROL = 0x11;
      const VK_MENU = 0x12;
      const enfonce = function (vk) { return (getEtatTouche(vk) & 0x8000) !== 0; };

      const avant = {};
      for (let i = 0; i < BOUTONS_VK.length; i++) avant[BOUTONS_VK[i][0]] = false;
      let sonde = null;

      function auPremierPlanSouris() {
        const hwnd = devantS();
        if (hwnd.isNull()) return false;
        casier.writeU32(0);
        pidDeS(hwnd, casier);
        return casier.readU32() === Process.id;
      }

      // Rempli juste avant d'allumer le sondage, avec l'etat REEL de chaque
      // bouton, sans rien emettre. Sans cela, un bouton deja enfonce au
      // moment de l'allumage serait vu comme un front montant au premier
      // passage et enverrait un appui fantome.
      function reamorcerAvant() {
        for (let i = 0; i < BOUTONS_VK.length; i++) {
          const vk = BOUTONS_VK[i][0];
          avant[vk] = enfonce(vk);
        }
      }

      function sonderBoutons() {
        try {
          // Sans cette garde, les cinq clients verraient le meme appui et la
          // bascule partirait cinq fois.
          const actif = auPremierPlanSouris();
          for (let i = 0; i < BOUTONS_VK.length; i++) {
            const vk = BOUTONS_VK[i][0];
            const bouton = BOUTONS_VK[i][1];
            const etat = enfonce(vk);
            const front = etat && !avant[vk];
            // L'etat est tenu a jour MEME hors premier plan: un bouton
            // relache ailleurs paraitrait sinon encore enfonce au retour, et
            // l'appui suivant serait manque.
            avant[vk] = etat;
            if (!front || !actif) continue;
            send({ souris: {
              button: bouton,
              ctrlKey: enfonce(VK_CONTROL),
              altKey: enfonce(VK_MENU),
              shiftKey: enfonce(VK_SHIFT),
            } });
          }
        } catch (e) {}
      }

      // recv n'ecoute qu'UNE fois: on se replace apres chaque message, sinon
      // le premier allumage serait aussi le dernier.
      function ecouterSouris() {
        recv('souris', function (m) {
          try {
            // 30 ms: un clic dure 80 a 150 ms, on ne peut pas en rater.
            if (m && m.actif && sonde === null) { reamorcerAvant(); sonde = setInterval(sonderBoutons, 30); }
            else if ((!m || !m.actif) && sonde !== null) { clearInterval(sonde); sonde = null; }
          } catch (e) {}
          ecouterSouris();
        });
      }
      ecouterSouris();
      report.push('boutons de souris');
    }

    send({ ready: report });
  `;
}

module.exports = { connectAgentSource };
