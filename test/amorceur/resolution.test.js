'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rendreResolvable } = require('../../amorceur/resolution');

// Reproduit la situation reelle: du code installe DEHORS (%APPDATA%\...\
// versions\0.2.2\) qui doit trouver une dependance restee DANS le paquet.
function scene(nomModule) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'resol-'));
  const paquet = path.join(racine, 'paquet');
  const dossierVersion = path.join(racine, 'versions', '0.2.2');
  const mod = path.join(paquet, 'node_modules', nomModule);
  fs.mkdirSync(mod, { recursive: true });
  fs.writeFileSync(path.join(mod, 'package.json'), JSON.stringify({ name: nomModule, main: 'index.js' }));
  fs.writeFileSync(path.join(mod, 'index.js'), 'module.exports = 42;');
  fs.mkdirSync(path.join(dossierVersion, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dossierVersion, 'src', 'code.js'),
    `module.exports = require('${nomModule}');`,
  );
  return { dossierVersion, dossiers: [path.join(paquet, 'node_modules')] };
}

test('sans rien faire, le code installe dehors ne trouve pas sa dependance', () => {
  const s = scene('fauxfrida0');
  assert.throws(() => require(path.join(s.dossierVersion, 'src', 'code.js')), /Cannot find module/);
});

test('apres rendreResolvable, la dependance du paquet est trouvee', () => {
  const s = scene('fauxfrida1');
  const r = rendreResolvable(s);
  assert.ok(r.methode === 'jonction' || r.methode === 'resolution', 'methode: ' + r.methode);
  assert.strictEqual(require(path.join(s.dossierVersion, 'src', 'code.js')), 42);
});

test('la solution de repli marche aussi quand la jonction est impossible', () => {
  // C'est le cas d'un paquet en archive asar: on ne peut pas y faire pointer
  // une jonction, il faut alors etendre la resolution elle-meme.
  const s = scene('fauxfrida2');
  const r = rendreResolvable({ ...s, autoriserJonction: false });
  assert.strictEqual(r.methode, 'resolution');
  assert.strictEqual(require(path.join(s.dossierVersion, 'src', 'code.js')), 42);
});

test('un module qui n existe nulle part leve toujours', () => {
  const s = scene('fauxfrida3');
  rendreResolvable(s);
  assert.throws(() => require('module-qui-n-existe-pas-du-tout'), /Cannot find module/);
});

test('rendreResolvable ne casse pas la resolution ordinaire', () => {
  const s = scene('fauxfrida4');
  rendreResolvable(s);
  assert.strictEqual(typeof require('node:path').join, 'function');
  assert.ok(require('../../amorceur/depot').creerDepot);
});
