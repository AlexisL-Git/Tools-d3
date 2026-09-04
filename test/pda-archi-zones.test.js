'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ARCHIMONSTRES } = require('../src/pda-archi/archimonstres');
const { construire } = require('../src/pda-archi/tableau');
const { parZones } = require('../src/pda-archi/zones');

const TOUS = ARCHIMONSTRES.map((a) => a.id);

// Tofumanchou l'Empereur se trouve dans DEUX sous-zones, toutes deux en Amakna:
// le Cimetière et les Cryptes du cimetière. C'est le cas qui separe les deux
// facons de compter, et c'est pour ca qu'il sert de repere ici.
const TOFUMANCHOU = 2357;

// L'arbre, tel que le panneau le recevra.
const arbre = ({ comptes, vise = null }) => parZones({
  ...construire({ comptes }), vise,
});

const zoneDe = (arb, nom) => arb.find((z) => z.zone === nom);
const sousZoneDe = (arb, zone, nom) => zoneDe(arb, zone).sousZones.find((s) => s.nom === nom);

// Mesure du 04/09: 16 zones, Amakna en tete avec 78 archimonstres.
test('les zones sont triees par manquants decroissants', () => {
  const arb = arbre({ comptes: [] });
  assert.strictEqual(arb.length, 16);
  assert.deepStrictEqual(
    arb.slice(0, 4).map((z) => [z.zone, z.manquants]),
    [['Amakna', 78], ['Plaines de Cania', 48], ["Île d'Otomaï", 41], ['Astrub', 32]],
  );
});

test('les sous-zones d une zone sont triees pareil', () => {
  const sz = zoneDe(arbre({ comptes: [] }), 'Amakna').sousZones;
  const comptes = sz.map((s) => s.manquants);
  assert.deepStrictEqual(comptes, [...comptes].sort((a, b) => b - a));
});

// CHAQUE SOUS-ZONE EST UN ENDROIT OU L ATTRAPER: un archimonstre qui vit dans
// deux d'entre elles manque dans les deux.
test('un archimonstre dans deux sous-zones manque dans les deux', () => {
  const ames = new Set(TOUS.filter((id) => id !== TOFUMANCHOU));
  const arb = arbre({ comptes: [{ pid: 1, nom: 'Jibef', ames }] });
  assert.strictEqual(sousZoneDe(arb, 'Amakna', 'Cimetière').manquants, 1);
  assert.strictEqual(sousZoneDe(arb, 'Amakna', 'Cryptes du cimetière').manquants, 1);
});

// MAIS LE TOTAL DE LA ZONE NE LE COMPTE QU UNE FOIS. Sommer les sous-zones
// gonflerait Amakna toute seule, et le tri par « ou il en manque le plus »
// designerait la mauvaise region.
test('le total d une zone ne compte chaque archimonstre qu une fois', () => {
  const ames = new Set(TOUS.filter((id) => id !== TOFUMANCHOU));
  const arb = arbre({ comptes: [{ pid: 1, nom: 'Jibef', ames }] });
  assert.strictEqual(zoneDe(arb, 'Amakna').manquants, 1);
});

test('ce qu on possede ne manque plus nulle part', () => {
  const arb = arbre({ comptes: [{ pid: 1, nom: 'Jibef', ames: new Set(TOUS) }] });
  assert.deepStrictEqual(arb.filter((z) => z.manquants > 0), []);
});

// `qui` repond a « qui emmener », et c'est la raison d'etre des emblemes.
test('qui ne retient que les personnages a qui il manque quelque chose', () => {
  const arb = arbre({
    comptes: [
      { pid: 1, nom: 'Complet', ames: new Set(TOUS) },
      { pid: 2, nom: 'ManqueUn', ames: new Set(TOUS.filter((id) => id !== TOFUMANCHOU)) },
    ],
  });
  assert.deepStrictEqual(sousZoneDe(arb, 'Amakna', 'Cimetière').qui, [2]);
  assert.deepStrictEqual(zoneDe(arb, 'Amakna').qui, [2]);
});

// UN INVENTAIRE PAS ENCORE LU N EST PAS UN INVENTAIRE VIDE: on ne sait pas ce
// qu'il lui manque, donc on ne le fait pas se deplacer.
test('un personnage dont l inventaire n est pas lu n apparait pas dans qui', () => {
  const arb = arbre({ comptes: [{ pid: 1, nom: 'Jamais lu', ames: null }] });
  assert.deepStrictEqual(zoneDe(arb, 'Amakna').qui, []);
});

// Meme regle que le filtre du tableau: avec un personnage suivi, « manquant »
// veut dire manquant POUR LUI, pas pour l'equipe.
test('avec un personnage vise, manquant veut dire manquant pour lui', () => {
  const comptes = [
    { pid: 1, nom: 'Complet', ames: new Set(TOUS) },
    { pid: 2, nom: 'Vide', ames: new Set() },
  ];
  assert.strictEqual(zoneDe(arbre({ comptes, vise: 1 }), 'Amakna').manquants, 0);
  assert.strictEqual(zoneDe(arbre({ comptes, vise: 2 }), 'Amakna').manquants, 78);
  // Sans personnage suivi, c'est l'equipe: ce que le premier possede est acquis.
  assert.strictEqual(zoneDe(arbre({ comptes }), 'Amakna').manquants, 0);
});
