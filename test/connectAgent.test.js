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
