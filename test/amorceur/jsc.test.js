'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compilerSource } = require('../../outils/compiler-bytecode');
require('../../amorceur/jsc');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-'));
}

// Ces tests compilent et rechargent dans le MEME moteur, ce qui est aussi le
// cas en production: le paquet est compile par l'Electron qui l'executera.
// Ce qu'ils ne peuvent pas prouver, c'est le couple Electron/Electron — la
// mesure est dans outils/essai-bytecode.js, a lancer avec electron.exe.
test('un module compile se recharge et rend ses exports', () => {
  const d = tmp();
  const chemin = path.join(d, 'module.jsc');
  fs.writeFileSync(chemin, compilerSource('module.exports = { somme: (a, b) => a + b };'));
  const m = require(chemin);
  assert.strictEqual(m.somme(40, 2), 42);
});

test('un module compile peut en requerir un autre', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'aide.js'), 'module.exports = 7;');
  const chemin = path.join(d, 'principal.jsc');
  fs.writeFileSync(chemin, compilerSource("module.exports = require('./aide') * 6;"));
  assert.strictEqual(require(chemin), 42);
});

test('__filename et __dirname sont ceux du fichier compile', () => {
  const d = tmp();
  const chemin = path.join(d, 'chemins.jsc');
  fs.writeFileSync(chemin, compilerSource('module.exports = { f: __filename, d: __dirname };'));
  const m = require(chemin);
  assert.strictEqual(m.f, chemin);
  assert.strictEqual(m.d, d);
});

// MESURE: un cache V8 altere ne se fait PAS rejeter proprement, il tue le
// processus (« Fatal error: unreachable code »). Ce test a fait tomber le
// lanceur de tests entier avant que l'empreinte n'existe. D'ou la
// verification maison, qui refuse le fichier avant que V8 ne le voie.
test('un bytecode abime est refuse avant meme d atteindre V8', () => {
  const d = tmp();
  const chemin = path.join(d, 'casse.jsc');
  const abime = Buffer.from(compilerSource('module.exports = 1;'));
  abime.fill(0, 60, 100);
  fs.writeFileSync(chemin, abime);
  assert.throws(() => require(chemin), /abime/);
});

test('un fichier plus court que l en-tete est refuse', () => {
  const d = tmp();
  const chemin = path.join(d, 'vide.jsc');
  fs.writeFileSync(chemin, Buffer.alloc(10));
  assert.throws(() => require(chemin), /tronque/);
});

test('aucun .js lisible ne subsiste apres compilation d un dossier', () => {
  const { compilerFichier } = require('../../outils/compiler-bytecode');
  const d = tmp();
  const source = path.join(d, 'secret.js');
  fs.writeFileSync(source, '// commentaire revelateur\nmodule.exports = 3;');
  compilerFichier(source);
  assert.strictEqual(fs.existsSync(source), false);
  const jsc = fs.readFileSync(path.join(d, 'secret.jsc'));
  assert.strictEqual(jsc.includes('commentaire revelateur'), false);
});

// MESURE du 2026-08-25: les tests ci-dessus compilent et rechargent dans le
// MEME processus, et passaient tous alors que l'application packagee ouvrait
// une fenetre « Error ». V8 refuse un cache produit sous d'autres drapeaux que
// ceux du processus qui le recharge. Ce test-ci charge donc AILLEURS.
test('un module compile ici se recharge dans un autre processus', () => {
  const { spawnSync } = require('node:child_process');
  const d = tmp();
  const chemin = path.join(d, 'ailleurs.jsc');
  fs.writeFileSync(chemin, compilerSource('module.exports = 40 + 2;'));
  const chargeur = path.join(__dirname, '..', '..', 'amorceur', 'jsc.js');
  const script = `require(${JSON.stringify(chargeur)}); console.log(require(${JSON.stringify(chemin)}));`;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'sortie: ' + r.stderr);
  assert.strictEqual(r.stdout.trim(), '42');
});
