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
  // Depuis l'extension au passe-tour, le fichier porte aussi passeTour et
  // delai (vides/nuls ici): voir le test dedie plus bas pour le contenu
  // complet.
  assert.deepStrictEqual(Object.keys(contenu).sort(), ['delai', 'favoris', 'passeTour']);
  assert.deepStrictEqual(contenu.favoris, [10612457]);
});

test('un fichier corrompu est ignoré sans exception', (t) => {
  const p = fichierTemporaire(t);
  fs.writeFileSync(p, 'pas du json');
  const f = new Favoris(p);
  f.charger();
  assert.deepStrictEqual(f.tous(), []);
});

// Les interrupteurs par compte suivent le sort des favoris: enregistres, et
// ne contenant QUE des identifiants numeriques et des booleens.
test('le passe-tour par compte est enregistre et relu', (t) => {
  const p = fichierTemporaire(t);
  const a = new Favoris(p);
  a.charger();
  a.marquerPasseTour(10612457, true);

  const b = new Favoris(p);
  b.charger();
  assert.strictEqual(b.passeTourActif(10612457), true);
  assert.strictEqual(b.passeTourActif(999), false);
});

test('le delai global est enregistre et relu', (t) => {
  const p = fichierTemporaire(t);
  const a = new Favoris(p);
  a.charger();
  a.reglerDelai(1.5);

  const b = new Favoris(p);
  b.charger();
  assert.strictEqual(b.delai(), 1.5);
});

test('le delai par defaut est 0', (t) => {
  const f = new Favoris(fichierTemporaire(t));
  f.charger();
  assert.strictEqual(f.delai(), 0);
});

test('le fichier ne contient que des identifiants, booleens et le delai', (t) => {
  const p = fichierTemporaire(t);
  const f = new Favoris(p);
  f.charger();
  f.marquer(10612457, true);
  f.marquerPasseTour(10612457, true);
  f.reglerDelai(0.5);
  const contenu = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.deepStrictEqual(Object.keys(contenu).sort(), ['delai', 'favoris', 'passeTour']);
  assert.deepStrictEqual(contenu.favoris, [10612457]);
  assert.deepStrictEqual(contenu.passeTour, [10612457]);
  assert.strictEqual(contenu.delai, 0.5);
});

test('un échec d écriture ne fait pas planter l appelant', (t) => {
  // Le dossier parent visé est en fait un fichier: mkdirSync et
  // writeFileSync échouent tous les deux, de façon fiable sur toutes les
  // plateformes.
  const fauxDossier = path.join(os.tmpdir(), `favoris-parent-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(fauxDossier, 'je suis un fichier, pas un dossier');
  t.after(() => { try { fs.unlinkSync(fauxDossier); } catch (e) {} });

  const p = path.join(fauxDossier, 'favoris.json');
  const f = new Favoris(p);
  f.charger();
  assert.doesNotThrow(() => f.marquer(10612457, true));
  assert.strictEqual(f.estFavori(10612457), true);
  assert.deepStrictEqual(f.tous(), [10612457]);
});
