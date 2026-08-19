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

test('la neutralisation du cache est optionnelle', () => {
  assert.match(connectAgentSource({ proxyPort: 8105 }), /CreateFileW/);
  assert.doesNotMatch(
    connectAgentSource({ proxyPort: 8105, neutralizeCache: false }),
    /CreateFileW/,
  );
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
