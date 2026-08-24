'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listerFichiersVersion, fabriquer } = require('../../outils/faire-paquet-code');
const { lireArchive, empreinte } = require('../../amorceur/archive');

function fausseRacine() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'paquet-'));
  const ecrire = (rel, contenu) => {
    const c = path.join(r, rel);
    fs.mkdirSync(path.dirname(c), { recursive: true });
    fs.writeFileSync(c, contenu);
  };
  ecrire('package.json', JSON.stringify({ name: 'mm', version: '0.7.0' }));
  ecrire('src/superviseur.js', '// superviseur');
  ecrire('src/comptes/vue.js', '// vue');
  ecrire('desktop/main.js', '// main');
  ecrire('desktop/dist/OMNI-win32-x64/OMNI.exe', 'binaire');
  ecrire('amorceur/electron.js', '// amorceur');
  ecrire('test/x.test.js', '// test');
  ecrire('docs/note.md', '# note');
  ecrire('serveur-maj/api/admin.js', '// serveur');
  ecrire('node_modules/frida/index.js', '// dependance');
  return r;
}

test('l archive contient le code applicatif et rien d autre', () => {
  const chemins = listerFichiersVersion(fausseRacine()).map((f) => f.chemin).sort();
  assert.deepStrictEqual(chemins, ['desktop/main.js', 'package.json', 'src/comptes/vue.js', 'src/superviseur.js']);
});

test('les chemins sont relatifs et en barres obliques', () => {
  for (const f of listerFichiersVersion(fausseRacine())) {
    assert.ok(!path.isAbsolute(f.chemin), f.chemin);
    assert.ok(!f.chemin.includes('\\'), f.chemin);
  }
});

test('fabriquer rend une archive relisible, sa version et son empreinte', () => {
  const r = fabriquer(fausseRacine());
  assert.strictEqual(r.version, '0.7.0');
  assert.strictEqual(r.sha256, empreinte(r.archive));
  const dedans = lireArchive(r.archive).map((f) => f.chemin);
  assert.ok(dedans.includes('desktop/main.js'));
  assert.strictEqual(dedans.length, r.nombreFichiers);
});

test('deux fabrications du meme code donnent la meme empreinte', () => {
  // Sans cette propriete, impossible de verifier qu'une archive publiee
  // correspond bien a un etat du depot.
  const r = fausseRacine();
  assert.strictEqual(fabriquer(r).sha256, fabriquer(r).sha256);
});
