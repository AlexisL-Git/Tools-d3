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
// L'inventaire du compte de mesure: 219 piles, dont 204 portent des lignes
// d'effets — 179 d'entre elles a quantite 1, donc majoritairement de
// l'equipement.
test('candidats ne retient que les 15 piles fongibles de l inventaire mesure', () => {
  const piles = lireStock(fixture('hdv-ivx-inventaire.hex'));
  assert.strictEqual(piles.length, 219);
  assert.strictEqual(piles.filter((p) => !p.avecEffets).length, 15);
  const lots = candidats({ piles, prixMoyens: new Map() });
  assert.strictEqual(new Set(lots.map((l) => l.uidPile)).size, 15);
});

// La banque mesuree, elle, porte 57 piles a effets sur 814 — et 52 d'entre
// elles ont une quantite superieure a 1. Ce ne sont donc pas des equipements.
test('candidats retient les 757 piles fongibles de la banque mesuree', () => {
  const piles = lireStock(fixture('hdv-iwb.hex'));
  assert.strictEqual(piles.length, 814);
  // 57 piles de banque portent des effets — des consommables ou des runes,
  // empilables (jusqu'a 1349 exemplaires), PAS des equipements.
  assert.strictEqual(piles.filter((p) => p.avecEffets).length, 57);
  const lots = candidats({ piles, prixMoyens: new Map() });
  assert.strictEqual(new Set(lots.map((l) => l.uidPile)).size, 757);
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
