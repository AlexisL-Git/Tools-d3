'use strict';

// Agent d'injection: amene le trafic du client jusqu'a notre proxy, et fait
// passer plusieurs clients pour une seule machine.
//
// Reproduit les trois mecanismes releves sur le produit de krm35
// (voir docs/superpowers/specs/2026-08-19-architecture-reelle-du-replicate.md),
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

    send({ ready: report });
  `;
}

module.exports = { connectAgentSource };
