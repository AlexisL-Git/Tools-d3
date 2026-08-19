'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Favoris } = require('../src/comptes/favoris');

function fichierTemporaire(t) {
  const p = path.join(os.tmpdir(), `favoris-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  t.after(() => { try { fs.unlinkSync(p); } catch (e) {} });
  return p;
}

test('sans fichier, aucun compte n est favori', (t) => {
  const f = new Favoris(fichierTemporaire(t));
  f.charger();
  assert.strictEqual(f.estFavori(10612457), false);
  assert.deepStrictEqual(f.tous(), []);
});

test('un favori marqué survit à un rechargement', (t) => {
  const p = fichierTemporaire(t);
  const a = new Favoris(p);
  a.charger();
  a.marquer(10612457, true);

  const b = new Favoris(p);
  b.charger();
  assert.strictEqual(b.estFavori(10612457), true);
  assert.deepStrictEqual(b.tous(), [10612457]);
});

test('démarquer retire le favori', (t) => {
  const p = fichierTemporaire(t);
  const f = new Favoris(p);
  f.charger();
  f.marquer(1, true);
  f.marquer(2, true);
  f.marquer(1, false);
  assert.deepStrictEqual(f.tous(), [2]);
});

// Le fichier ne doit contenir que des identifiants de compte: aucun login,
// aucun jeton, rien qui puisse fuiter s'il est partage.
test('le fichier enregistré ne contient que des identifiants', (t) => {
  const p = fichierTemporaire(t);
  const f = new Favoris(p);
  f.charger();
  f.marquer(10612457, true);
  const contenu = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.deepStrictEqual(Object.keys(contenu), ['favoris']);
  assert.deepStrictEqual(contenu.favoris, [10612457]);
});

test('un fichier corrompu est ignoré sans exception', (t) => {
  const p = fichierTemporaire(t);
  fs.writeFileSync(p, 'pas du json');
  const f = new Favoris(p);
  f.charger();
  assert.deepStrictEqual(f.tous(), []);
});
