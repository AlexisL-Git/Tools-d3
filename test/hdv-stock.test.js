'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFrameRaw } = require('../src/codec/rawProto');
const { lireStock } = require('../src/hdv/trames');
const { decouper, candidats, paquets } = require('../src/hdv/stock');

const fixture = (nom) => decodeFrameRaw(
  Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures', nom), 'utf8').trim(), 'hex'),
);

// --- Le decoupage --------------------------------------------------------
//
// Du plus gros lot au plus petit. Les chiffres viennent du stock mesure le
// 01/09: la pile de Pierre medicinale en portait 286, la plus grosse 1660.

test('decouper prend les plus gros lots d abord', () => {
  assert.deepStrictEqual(
    decouper(286),
    [100, 100, 10, 10, 10, 10, 10, 10, 10, 10, 1, 1, 1, 1, 1, 1],
  );
});

test('decouper sur la plus grosse pile mesuree', () => {
  assert.deepStrictEqual(
    decouper(1660),
    [1000, 100, 100, 100, 100, 100, 100, 10, 10, 10, 10, 10, 10],
  );
});

test('decouper rend des lots de 1 sous le premier palier', () => {
  assert.deepStrictEqual(decouper(9), [1, 1, 1, 1, 1, 1, 1, 1, 1]);
});

test('decouper ne rend rien sur une pile vide', () => {
  assert.deepStrictEqual(decouper(0), []);
});

// --- Les candidats -------------------------------------------------------

test('candidats ecarte les piles a lignes de caracteristiques', () => {
  const piles = [
    { uid: 1, gid: 13731, qte: 100, avecEffets: false },
    { uid: 2, gid: 14162, qte: 1, avecEffets: true },
  ];
  const lots = candidats({ piles, prixMoyens: new Map([[13731, 32], [14162, 5000]]) });
  assert.strictEqual(lots.length, 1);
  assert.strictEqual(lots[0].gid, 13731);
});

test('candidats trie par valeur de lot decroissante', () => {
  const piles = [
    { uid: 1, gid: 100, qte: 10, avecEffets: false },
    { uid: 2, gid: 200, qte: 10, avecEffets: false },
  ];
  const lots = candidats({ piles, prixMoyens: new Map([[100, 5], [200, 900]]) });
  assert.deepStrictEqual(lots.map((l) => l.gid), [200, 100]);
  assert.deepStrictEqual(lots.map((l) => l.valeur), [9000, 50]);
});

test('candidats porte l uid de la pile d origine sur chaque lot', () => {
  const piles = [{ uid: 84496683, gid: 8437, qte: 200, avecEffets: false }];
  const lots = candidats({ piles, prixMoyens: new Map([[8437, 39]]) });
  assert.strictEqual(lots.length, 2);
  for (const l of lots) {
    assert.strictEqual(l.uidPile, 84496683);
    assert.strictEqual(l.taille, 100);
  }
});

test('candidats accepte un gid absent de la table des prix moyens', () => {
  const lots = candidats({ piles: [{ uid: 1, gid: 999, qte: 5, avecEffets: false }], prixMoyens: new Map() });
  assert.strictEqual(lots.length, 5);
  assert.strictEqual(lots[0].valeur, 0);
});

// --- Sur les trames reellement mesurees ----------------------------------
//
// REMESURE LE 08/09. ivx s'appelle isb et sa liste passe du champ 3 au 2; dans
// chaque pile la position passe du 1 au 3, et dans le detail le gid du 1 au 5,
// la quantite du 3 au 2, l'uid du 4 au 1, les effets du 2 au 3.
//
// L'inventaire seul du compte de mesure: 1003 piles, dont 340 portent des
// lignes d'effets — de l'equipement, qu'on ne met pas en vente au lot.
test('candidats ne retient que les piles fongibles de l inventaire mesure', () => {
  const piles = lireStock(fixture('hdv-isb-inventaire.hex'));
  assert.strictEqual(piles.length, 1003);
  assert.strictEqual(piles.filter((p) => !p.avecEffets).length, 663);
  // Aucun rangement annonce: c'est la marque de l'inventaire, par opposition a
  // la reponse qui porte aussi la banque.
  assert.deepStrictEqual([...new Set(piles.map((p) => p.rangement))], [null]);
  const lots = candidats({ piles, prixMoyens: new Map() });
  assert.strictEqual(new Set(lots.map((l) => l.uidPile)).size, 663);
});

// La reponse aux DEUX rangements demandes (RANGEMENTS = 02 03) porte en plus la
// banque: 1345 piles, et des rangements 1, 2 et 3 la ou l'inventaire seul n'en
// annonce aucun. C'est ce qui prouve que rangementDe lit le bon bloc.
test('candidats retient les piles fongibles des deux rangements', () => {
  const piles = lireStock(fixture('hdv-isb-complet.hex'));
  assert.strictEqual(piles.length, 1345);
  assert.strictEqual(piles.filter((p) => p.avecEffets).length, 459);
  assert.deepStrictEqual(
    [...new Set(piles.map((p) => p.rangement))].sort(),
    [1, 2, 3, null],
  );
  const lots = candidats({ piles, prixMoyens: new Map() });
  assert.strictEqual(new Set(lots.map((l) => l.uidPile)).size, 886);
});

// --- Les paquets ---------------------------------------------------------

test('paquets regroupe les lots consecutifs de meme gid et meme taille', () => {
  const lots = [
    { gid: 1, taille: 100, valeur: 900 },
    { gid: 1, taille: 100, valeur: 900 },
    { gid: 2, taille: 100, valeur: 500 },
    { gid: 1, taille: 10, valeur: 90 },
  ];
  const p = paquets(lots);
  assert.deepStrictEqual(p.map((x) => [x.gid, x.taille, x.lots.length]), [
    [1, 100, 2], [2, 100, 1], [1, 10, 1],
  ]);
});

test('paquets ne fusionne pas deux tailles du meme objet', () => {
  const p = paquets([{ gid: 1, taille: 100 }, { gid: 1, taille: 10 }]);
  assert.strictEqual(p.length, 2);
});

// --- Le tri est DETERMINISTE, et paquets en depend -----------------------
//
// Les departages apres la valeur ne sont pas cosmetiques: c'est eux qui
// garantissent que deux lots de meme gid ET meme taille se retrouvent cote a
// cote, sans quoi paquets() — qui ne regarde que le voisin precedent —
// fragmenterait un groupe en plusieurs visites d'objet.
//
// Sans ces deux tests, retirer un departage laisserait toute la suite verte.

test('a valeur egale, le tri departage par taille decroissante puis gid croissant', () => {
  const piles = [
    { uid: 1, gid: 100, qte: 100, avecEffets: false },
    { uid: 2, gid: 200, qte: 10, avecEffets: false },
    { uid: 3, gid: 50, qte: 10, avecEffets: false },
  ];
  // Trois lots de valeur 1000: 10x100, 100x10 et 100x10.
  const lots = candidats({ piles, prixMoyens: new Map([[100, 10], [200, 100], [50, 100]]) });
  assert.deepStrictEqual(lots.map((l) => l.valeur), [1000, 1000, 1000]);
  assert.deepStrictEqual(lots.map((l) => [l.gid, l.taille]), [[100, 100], [50, 10], [200, 10]]);
});

test('deux piles du meme objet a valeur egale tombent dans UN SEUL paquet', () => {
  const piles = [
    { uid: 1, gid: 100, qte: 100, avecEffets: false },
    { uid: 2, gid: 200, qte: 100, avecEffets: false },
    { uid: 3, gid: 100, qte: 100, avecEffets: false },
  ];
  const lots = candidats({ piles, prixMoyens: new Map([[100, 10], [200, 10]]) });
  const p = paquets(lots);
  assert.deepStrictEqual(p.map((x) => [x.gid, x.taille, x.lots.length]), [
    [100, 100, 2], [200, 100, 1],
  ]);
  // Les deux lots du gid 100 viennent de piles differentes: le paquet les
  // groupe quand meme, et chacun garde son uid d'origine.
  assert.deepStrictEqual(p[0].lots.map((l) => l.uidPile).sort(), [1, 3]);
});
