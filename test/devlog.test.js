'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { lireDevlog, CHEMIN } = require('../desktop/devlog');

// Le devlog est du confort. Ces tests portent tous la meme exigence: aucune
// entree du module ne doit lever, quoi qu'on lui donne. Une exception ici
// remonterait par le canal IPC jusqu'a la fenetre, pour du texte decoratif.

function fichierTemporaire(contenu) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'devlog-'));
  const chemin = path.join(dossier, 'devlog.json');
  fs.writeFileSync(chemin, contenu);
  return chemin;
}

test('un fichier valide rend ses entrees', () => {
  const chemin = fichierTemporaire(JSON.stringify([
    { version: '0.2.5', le: '2026-08-27', notes: ['deux'] },
    { version: '0.2.4', le: '2026-08-26', notes: ['un', 'et demi'] },
  ]));
  const entrees = lireDevlog(chemin);
  assert.strictEqual(entrees.length, 2);
  assert.strictEqual(entrees[0].version, '0.2.5');
  assert.deepStrictEqual(entrees[1].notes, ['un', 'et demi']);
});

test('les entrees sortent en ordre decroissant, quel que soit l ordre du fichier', () => {
  const chemin = fichierTemporaire(JSON.stringify([
    { version: '0.2.4', notes: ['a'] },
    { version: '0.10.0', notes: ['b'] },
    { version: '0.9.1', notes: ['c'] },
  ]));
  // 0.10.0 > 0.9.1: la comparaison est numerique, pas alphabetique. Une
  // comparaison de chaines mettrait 0.10.0 AVANT 0.9.1 dans le mauvais sens.
  assert.deepStrictEqual(
    lireDevlog(chemin).map((e) => e.version),
    ['0.10.0', '0.9.1', '0.2.4'],
  );
});

test('un fichier absent rend un tableau vide sans lever', () => {
  assert.deepStrictEqual(lireDevlog(path.join(os.tmpdir(), 'devlog-inexistant-xyz.json')), []);
});

test('un JSON invalide rend un tableau vide sans lever', () => {
  assert.deepStrictEqual(lireDevlog(fichierTemporaire('{ pas du json')), []);
});

test('un JSON valide qui n est pas un tableau rend un tableau vide', () => {
  assert.deepStrictEqual(lireDevlog(fichierTemporaire('{"version":"0.2.5"}')), []);
});

test('une entree sans notes utilisables est ecartee, les autres restent', () => {
  const chemin = fichierTemporaire(JSON.stringify([
    { version: '0.2.5', notes: ['bonne'] },
    { version: '0.2.4' },
    { version: '0.2.3', notes: 'pas un tableau' },
    { version: '0.2.2', notes: [42] },
    { version: '0.2.1', notes: [] },
  ]));
  assert.deepStrictEqual(lireDevlog(chemin).map((e) => e.version), ['0.2.5']);
});

test('une entree sans version, ou de format invalide, est ecartee', () => {
  const chemin = fichierTemporaire(JSON.stringify([
    { notes: ['sans version'] },
    { version: 'dev', notes: ['pas x.y.z'] },
    { version: ['0.2.5'], notes: ['version en tableau'] },
    { version: '0.2.5', notes: ['bonne'] },
  ]));
  assert.deepStrictEqual(lireDevlog(chemin).map((e) => e.version), ['0.2.5']);
});

test('null et une entree nulle ne font pas lever', () => {
  assert.deepStrictEqual(lireDevlog(fichierTemporaire('null')), []);
  assert.deepStrictEqual(lireDevlog(fichierTemporaire('[null, 3, "x"]')), []);
});

test('CHEMIN pointe dans desktop/', () => {
  assert.strictEqual(path.basename(CHEMIN), 'devlog.json');
  assert.strictEqual(path.basename(path.dirname(CHEMIN)), 'desktop');
});
