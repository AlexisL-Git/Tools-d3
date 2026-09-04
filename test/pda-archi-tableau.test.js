'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { construire } = require('../src/pda-archi/tableau');

// Pichakoté le Dégoutant, l'ame mesuree le 04/09. Ribibi le Cher, une autre.
const PICHAKOTE = 2272;
const RIBIBI = 2276;
const BOUFTOU_ROYAL = 147; // un BOSS, pas un archimonstre

test('le tableau porte une ligne par archimonstre', () => {
  const t = construire({ comptes: [] });
  assert.strictEqual(t.lignes.length, 286);
  assert.strictEqual(t.total, 286);
});

test('une ame possedee marque la colonne de son personnage', () => {
  const t = construire({
    comptes: [
      { pid: 42, nom: 'Jibef', ames: new Set([PICHAKOTE]) },
      { pid: 43, nom: 'Mule1', ames: new Set([RIBIBI]) },
    ],
  });
  const pichakote = t.lignes.find((l) => l.id === PICHAKOTE);
  assert.deepStrictEqual(pichakote.presents, [42]);
  assert.strictEqual(pichakote.nom, 'Pichakoté le Dégoutant');
  assert.deepStrictEqual(t.lignes.find((l) => l.id === RIBIBI).presents, [43]);
});

test('une ligne que personne n a reste vide', () => {
  const t = construire({ comptes: [{ pid: 42, nom: 'Jibef', ames: new Set([PICHAKOTE]) }] });
  assert.deepStrictEqual(t.lignes.find((l) => l.id === RIBIBI).presents, []);
});

// UNE PIERRE CAPTURE AUSSI LES BOSS: trois des 143 ames mesurees en etaient.
// C'est le cas normal, pas une anomalie -- elles se comptent a part plutot que
// d'inventer des lignes fantomes ou de disparaitre en silence.
test('les ames de boss se comptent a part', () => {
  const t = construire({
    comptes: [{ pid: 42, nom: 'Jibef', ames: new Set([PICHAKOTE, BOUFTOU_ROYAL]) }],
  });
  assert.strictEqual(t.comptes[0].possede, 1);
  assert.strictEqual(t.comptes[0].horsTableau, 1);
  assert.strictEqual(t.comptes[0].manquants, 285);
});

// UN INVENTAIRE PAS ENCORE LU N EST PAS UN INVENTAIRE VIDE. Le panneau affiche
// `—` pour le premier et `0` pour le second: la difference doit exister ici,
// sinon un client lance avant OMNI passerait pour un personnage sans une seule
// ame.
test('un inventaire pas encore lu ne compte pas pour zero', () => {
  const t = construire({ comptes: [{ pid: 42, nom: 'Jibef', ames: null }] });
  assert.strictEqual(t.comptes[0].lu, false);
  assert.strictEqual(t.comptes[0].possede, null);
  assert.strictEqual(t.comptes[0].manquants, null);
});

test('un inventaire lu et vide compte pour zero', () => {
  const t = construire({ comptes: [{ pid: 42, nom: 'Jibef', ames: new Set() }] });
  assert.strictEqual(t.comptes[0].lu, true);
  assert.strictEqual(t.comptes[0].possede, 0);
  assert.strictEqual(t.comptes[0].manquants, 286);
});

// Le tableau se lit du plus faible au plus fort: c'est l'ordre dans lequel on
// chasse.
test('les lignes vont du plus bas niveau au plus haut', () => {
  const t = construire({ comptes: [] });
  const niveaux = t.lignes.map((l) => l.niveau);
  assert.deepStrictEqual(niveaux, [...niveaux].sort((a, b) => a - b));
});

// Ce qu'aucun personnage n'a: la vraie liste de ce qui reste a chasser.
test('le tableau dit ce que personne n a', () => {
  const t = construire({
    comptes: [
      { pid: 42, nom: 'Jibef', ames: new Set([PICHAKOTE]) },
      { pid: 43, nom: 'Mule1', ames: new Set([PICHAKOTE, RIBIBI]) },
    ],
  });
  assert.strictEqual(t.possedes, 2);
  assert.strictEqual(t.manquants, 284);
});
