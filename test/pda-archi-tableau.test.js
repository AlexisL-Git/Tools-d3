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

// LA VUE PAR ZONE VOYAGE AVEC LE TABLEAU, dans le meme aller-retour: le
// panneau bascule de l'une a l'autre sans rien redemander.
test('le tableau porte aussi la vue par zone', () => {
  const t = construire({ comptes: [] });
  assert.strictEqual(t.zones[0].zone, 'Amakna');
  assert.strictEqual(t.zones[0].manquants, 78);
});

test('le personnage suivi vaut pour la vue par zone comme pour le filtre', () => {
  const t = construire({
    comptes: [
      { pid: 42, nom: 'Jibef', ames: new Set([PICHAKOTE]) },
      { pid: 43, nom: 'Mule1', ames: new Set() },
    ],
    vise: 42,
  });
  const zone = t.zones.find((z) => z.sousZones.some((s) => s.qui.includes(43)));
  assert.notStrictEqual(zone, undefined, 'Mule1 doit manquer quelque part');
  assert.strictEqual(t.zones.every((z) => z.qui.includes(43)), true);
});

// --- La seconde collection: les boss du Dofus Ocre -------------------------
//
// Le meme croisement, la meme vue par zone, le meme bouton: seule la liste de
// reference change. C'est ce qui rend cette seconde table presque gratuite.

test('le tableau des boss porte 51 lignes', () => {
  const t = construire({ comptes: [], quoi: 'boss' });
  assert.strictEqual(t.total, 51);
  assert.strictEqual(t.lignes.length, 51);
});

// Mob l'Éponge, l'une des trois ames de boss lues dans l'inventaire mesure.
test('une ame de boss coche sa ligne dans le tableau des boss', () => {
  const t = construire({ comptes: [{ pid: 1, nom: 'Jibef', ames: new Set([928]) }], quoi: 'boss' });
  assert.deepStrictEqual(t.lignes.find((l) => l.id === 928).presents, [1]);
  assert.strictEqual(t.comptes[0].possede, 1);
  assert.strictEqual(t.comptes[0].manquants, 50);
});

// LE « HORS TABLEAU » CHANGE DE SENS AVEC LA COLLECTION, et c'est normal: une
// ame d'archimonstre n'a rien a faire dans le tableau des boss, et
// reciproquement. Elle est comptee a part, jamais perdue.
test('une ame d archimonstre est hors tableau dans la vue des boss', () => {
  const t = construire({ comptes: [{ pid: 1, nom: 'Jibef', ames: new Set([2272]) }], quoi: 'boss' });
  assert.strictEqual(t.comptes[0].possede, 0);
  assert.strictEqual(t.comptes[0].horsTableau, 1);
});

// Mesure du 04/09: les 51 boss se repartissent sur 18 zones, Amakna en tete
// avec 10.
test('la vue par zone marche aussi sur les boss', () => {
  const t = construire({ comptes: [], quoi: 'boss' });
  assert.strictEqual(t.zones.length, 18);
  assert.deepStrictEqual(
    t.zones.slice(0, 2).map((z) => [z.zone, z.manquants]),
    [['Amakna', 10], ["Île d'Otomaï", 8]],
  );
});

// Une cle inconnue ne casse pas le panneau: il montre la collection par defaut.
test('une collection inconnue rend les archimonstres', () => {
  assert.strictEqual(construire({ comptes: [], quoi: 'nawak' }).total, 286);
});

// Le panneau affiche le nom de la collection qu'il montre: sans lui, deux
// tableaux de 51 et 286 lignes se ressemblent de loin.
test('le tableau dit de quelle collection il parle', () => {
  assert.strictEqual(construire({ comptes: [] }).titre, 'Archimonstres');
  assert.strictEqual(construire({ comptes: [], quoi: 'boss' }).titre, 'Boss du Dofus Ocre');
});
