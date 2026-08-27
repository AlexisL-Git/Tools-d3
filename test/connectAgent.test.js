'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { connectAgentSource } = require('../src/il2cpp/connectAgent');
const { parseConnectLine } = require('../src/proxy/server');

test('un port invalide est refusé avant toute injection', () => {
  for (const bad of [0, -1, 70000, 1.5, undefined, 'x']) {
    assert.throws(() => connectAgentSource({ proxyPort: bad }), /proxyPort invalide/);
  }
});

test('le source est du JavaScript valide', () => {
  const src = connectAgentSource({ proxyPort: 8105, fakeDeviceId: 'abc' });
  assert.doesNotThrow(() => new Function(src));
});

// La ligne que l'agent construit doit etre exactement celle que le proxy sait
// lire. Les deux cotes ont ete ecrits a des mois d'intervalle sur des
// hypotheses differentes: ce test les tient ensemble.
test('la ligne CONNECT produite est celle que le proxy sait lire', () => {
  const src = connectAgentSource({ proxyPort: 8105 });
  const m = /'CONNECT ' \+ ([^;]+?) \+ ' HTTP\/1\.0'/.exec(src);
  assert.notStrictEqual(m, null, "l'agent doit construire la ligne CONNECT");

  // On rejoue la concaténation de l'agent avec une cible connue.
  const line = 'CONNECT ' + '52.85.118.92' + ':' + 5555 + ' HTTP/1.0';
  const parsed = parseConnectLine(Buffer.from(line));
  assert.notStrictEqual(parsed, null);
  assert.strictEqual(parsed.host, '52.85.118.92');
  assert.strictEqual(parsed.port, 5555);
});

test('le port du proxy est bien celui demandé', () => {
  assert.match(connectAgentSource({ proxyPort: 9999 }), /const PROXY_PORT = 9999;/);
});

test("l'empreinte n'est touchée que si un identifiant est fourni", () => {
  assert.doesNotMatch(connectAgentSource({ proxyPort: 8105 }), /get_deviceUniqueIdentifier/);
  assert.match(
    connectAgentSource({ proxyPort: 8105, fakeDeviceId: 'deadbeef' }),
    /get_deviceUniqueIdentifier/,
  );
});

// Un RVA code en dur meurt au premier patch du jeu: la resolution doit passer
// par le nom de la classe et de la methode.
test("l'empreinte est résolue par nom, jamais par adresse en dur", () => {
  const src = connectAgentSource({ proxyPort: 8105, fakeDeviceId: 'x' });
  assert.match(src, /il2cpp_class_from_name/);
  assert.doesNotMatch(src, /0x4D15DF0/i);
});

// Empreinte machine et neutralisation du cache servent a faire passer
// plusieurs clients d'un meme poste pour des machines distinctes. Cela n'a de
// sens que face a un serveur monocompte; sur un serveur multicompte, le
// multi-instance est prevu par Ankama (Zaap passe --instanceId au jeu). Rien
// de tout cela ne doit etre pose sans demande explicite.
test('aucun contournement de détection n est posé par défaut', () => {
  const src = connectAgentSource({ proxyPort: 8105 });
  assert.doesNotMatch(src, /CreateFileW/, 'le cache ne doit pas être neutralisé par défaut');
  assert.doesNotMatch(src, /get_deviceUniqueIdentifier/, "l'empreinte ne doit pas être falsifiée par défaut");
});

test('les deux mécanismes restent disponibles sur demande', () => {
  assert.match(connectAgentSource({ proxyPort: 8105, neutralizeCache: true }), /CreateFileW/);
  assert.match(connectAgentSource({ proxyPort: 8105, fakeDeviceId: 'x' }), /get_deviceUniqueIdentifier/);
});

test('les ports exclus sont transmis à l agent', () => {
  assert.match(connectAgentSource({ proxyPort: 8105, excludePorts: [80, 443] }), /const EXCLUDE = \[80,443\];/);
});

// Le client ouvre bien plus que la partie: HTTPS vers les CDN, et surtout
// 127.0.0.1:26116 vers le launcher Ankama d'ou il tient sa session. Detourner
// cette derniere coupe la session ("connection between DOFUS and the Ankama
// Launcher has been lost"), constate le 19/08 sur un client reel.
test('par défaut seul le port de jeu est détourné', () => {
  assert.match(connectAgentSource({ proxyPort: 8105 }), /const ONLY = \[5555\];/);
});

test('la liste des ports détournés est réglable', () => {
  assert.match(connectAgentSource({ proxyPort: 8105, onlyPorts: [5555, 5556] }), /const ONLY = \[5555,5556\];/);
  assert.match(connectAgentSource({ proxyPort: 8105, onlyPorts: [] }), /const ONLY = \[\];/);
});

// Le jeu joint son serveur par une adresse IPv4 mappee en IPv6. Ecrite en
// groupes hexadecimaux, elle parvenait au proxy sous la forme
// "0:0:0:0:0:ffff:6c80:f748", inutilisable pour relayer.
test('les adresses IPv4 mappées sont rendues en forme pointée', () => {
  const src = connectAgentSource({ proxyPort: 8105 });
  assert.match(src, /b\[10\] === 0xff && b\[11\] === 0xff/, 'le préfixe mappé doit être détecté');
  assert.match(src, /b\[12\] \+ '\.' \+ b\[13\] \+ '\.' \+ b\[14\] \+ '\.' \+ b\[15\]/);

  // On rejoue la conversion sur l'adresse réellement observée.
  const b = [0,0,0,0,0,0,0,0,0,0,0xff,0xff,0x6c,0x80,0xf7,0x48];
  const dotted = `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
  assert.strictEqual(dotted, '108.128.247.72');
  const { parseConnectLine } = require('../src/proxy/server');
  const p = parseConnectLine(Buffer.from(`CONNECT ${dotted}:5555 HTTP/1.0`));
  assert.strictEqual(p.host, '108.128.247.72');
  assert.strictEqual(p.port, 5555);
});

// La reecriture de l'adresse doit se faire APRES le filtre, sinon une
// connexion non retenue partirait quand meme vers 127.0.0.1.
test("l'adresse n'est réécrite qu'après la décision de détourner", () => {
  const src = connectAgentSource({ proxyPort: 8105 });
  const filtre = src.indexOf('ONLY.indexOf(port)');
  const ecriture = src.indexOf('writeByteArray([127, 0, 0, 1])');
  assert.ok(filtre > 0 && ecriture > 0, 'les deux repères doivent exister');
  assert.ok(ecriture > filtre, "l'écriture de 127.0.0.1 doit suivre le filtre");
});

// --- commande de fenetre ---------------------------------------------------

// Le clic sur une ligne, et les raccourcis, doivent mettre la fenetre Dofus au
// premier plan. C'est l'agent qui le fait, depuis l'interieur du process:
// SetForegroundWindow est bride, et le contournement documente par Microsoft
// (AttachThreadInput sur le fil du premier plan) demande d'etre dans la place.
//
// Ces trois fonctions user32, l'agent les appelait deja avant qu'on retire la
// surveillance du focus. On ne prend donc aucun risque nouveau.
test('l agent expose une commande de mise au premier plan', () => {
  const src = connectAgentSource({ proxyPort: 8000 });
  assert.match(src, /recv\(/, 'un canal de commande depuis l hote');
  assert.match(src, /SetForegroundWindow/);
  assert.match(src, /AttachThreadInput/);
  assert.match(src, /EnumWindows|GetTopWindow|FindWindow/, 'il faut trouver sa propre fenetre');
});

// Sans cette annonce, l'hote ne peut pas savoir si la bascule a eu lieu, et le
// journal d'un ami ne dirait rien d'exploitable.
test('l agent rend compte de la bascule', () => {
  const src = connectAgentSource({ proxyPort: 8000 });
  assert.match(src, /premierPlanFait/);
});

// La surveillance du focus revient, mais pour un AUTRE usage: elle ne decerne
// plus le role de maitre, elle dit seulement d'ou part « personnage suivant ».
test('la surveillance du premier plan est de nouveau disponible, en option', () => {
  const avec = connectAgentSource({ proxyPort: 8000, reportFocus: true });
  const sans = connectAgentSource({ proxyPort: 8000 });
  assert.match(avec, /GetForegroundWindow/);
  assert.match(avec, /premierPlan:/);
  assert.doesNotMatch(sans, /premierPlan:/, 'muette si on ne la demande pas');
});

// SetForegroundWindow seul reussissait environ une fois sur deux: Windows
// protege deliberement le premier plan, et la regle depend de qui a recu la
// derniere entree, du verrou de premier plan, et de l'etat du bureau a
// l'instant de l'appel. L'agent enchaine donc trois recours, du plus propre au
// plus intrusif, et s'arrete au premier qui marche.
test('la mise au premier plan enchaîne trois recours', () => {
  const src = connectAgentSource({ proxyPort: 8000 });
  assert.match(src, /AttachThreadInput/, '1. le contournement documenté');
  assert.match(src, /SwitchToThisWindow/, '2. la voie d Alt+Tab');
  assert.match(src, /SPI_SETFOREGROUNDLOCKTIMEOUT/, '3. le verrou de premier plan');
});

// Un verrou de premier plan laisse a zero rendrait TOUTE application capable de
// voler le focus, bien apres qu'OMNI se soit ferme.
test('le verrou de premier plan est toujours restauré', () => {
  const src = connectAgentSource({ proxyPort: 8000 });
  assert.match(src, /SPI_GETFOREGROUNDLOCKTIMEOUT/, 'l ancienne valeur doit être lue');
  assert.match(src, /finally\s*\{[\s\S]{0,400}SPI_SETFOREGROUNDLOCKTIMEOUT/,
    'la restauration doit être dans un finally');
});

// Deux fils dont les entrees restent liees se bloquent mutuellement au premier
// incident: le detachement ne peut pas dependre du succes de l'appel.
test('le rattachement de fil est toujours défait', () => {
  const src = connectAgentSource({ proxyPort: 8000 });
  assert.match(src, /finally\s*\{[\s\S]{0,200}AttachThreadInput\([^)]*, 0\)/);
});

// --- boutons de souris ------------------------------------------------------

test('l agent porte le bloc des boutons de souris', () => {
  const src = connectAgentSource({ proxyPort: 8105 });
  assert.match(src, /GetAsyncKeyState/, 'il faut lire l etat des boutons');
  assert.match(src, /recv\('souris'/, 'le bloc s allume sur commande');
  assert.match(src, /boutons de souris/, 'le rapport d attache le mentionne');
});

// Les trois codes Windows des boutons assignables. Se tromper d'un code
// donnerait un bouton qui ne repond jamais, sans erreur nulle part.
test('les trois codes de bouton sont ceux de Windows', () => {
  const src = connectAgentSource({ proxyPort: 8105 });
  assert.match(src, /0x04/, 'VK_MBUTTON');
  assert.match(src, /0x05/, 'VK_XBUTTON1');
  assert.match(src, /0x06/, 'VK_XBUTTON2');
});

// Sans cette garde, les cinq clients verraient le meme appui.
test('l agent ne signale un appui que s il est au premier plan', () => {
  const src = connectAgentSource({ proxyPort: 8105 });
  const bloc = src.slice(src.indexOf('GetAsyncKeyState'));
  assert.match(bloc, /GetForegroundWindow/);
});

test('le source reste du JavaScript valide avec le bloc souris', () => {
  const src = connectAgentSource({ proxyPort: 8105, fakeDeviceId: 'abc', neutralizeCache: true });
  assert.doesNotThrow(() => new Function(src));
});
