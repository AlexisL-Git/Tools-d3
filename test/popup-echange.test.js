'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { writeVarint } = require('../src/codec/framing');
const { decodeFrameRaw } = require('../src/codec/rawProto');
const {
  creerFermeturePopup, TRAME_FIN_ECHANGE, TRAME_ANNULATION, PAQUET_ANNULATION,
} = require('../src/popup-echange');

// Octets releves en jeu le 09/09 (journal-bug-0909.log), acceptation
// automatique eteinte pour la mesure:
//
//   5186745 [8328] <-- jzi { 1=11 }      le maitre annule -> la pop-up se ferme
//   5208283 [8328] <-- jzi { 1=11 2=1 }  fin d'un echange reussi -> elle reste
test('les deux trames sont celles mesurees, et elles se decodent', () => {
  assert.strictEqual(
    TRAME_FIN_ECHANGE.toString('hex'),
    '121d1a1b0a13747970652e616e6b616d612e636f6d2f6a7a691204080b1001',
  );
  assert.strictEqual(
    TRAME_ANNULATION.toString('hex'),
    '121b1a190a13747970652e616e6b616d612e636f6d2f6a7a691202080b',
  );

  const fin = decodeFrameRaw(TRAME_FIN_ECHANGE);
  const annul = decodeFrameRaw(TRAME_ANNULATION);
  assert.strictEqual(fin.type, 'jzi');
  assert.strictEqual(annul.type, 'jzi');
  // TOUTE la difference est la: le champ 2 dit « l'echange a abouti ».
  assert.deepStrictEqual(fin.payload.map((f) => f.no), [1, 2]);
  assert.deepStrictEqual(annul.payload.map((f) => f.no), [1]);
});

const paquet = (brute) => Buffer.concat([writeVarint(brute.length), brute]);
const AUTRE = Buffer.from('121b1a190a13747970652e616e6b616d612e636f6d2f6b6f6212020801', 'hex');
const conn = { pid: 7, id: '7/1' };

test('sans marque, pas un octet n est recopie', () => {
  const f = creerFermeturePopup();
  assert.strictEqual(f.transformer(paquet(TRAME_FIN_ECHANGE), conn), null);
});

test('la fin d un echange accepte par OMNI porte la trame d annulation', () => {
  const rendus = [];
  const f = creerFermeturePopup({ onCompteRendu: (r) => rendus.push(r) });
  f.marquer(7);

  const sortie = f.transformer(Buffer.concat([paquet(AUTRE), paquet(TRAME_FIN_ECHANGE)]), conn);

  assert.deepStrictEqual(
    sortie,
    Buffer.concat([paquet(AUTRE), paquet(TRAME_FIN_ECHANGE), PAQUET_ANNULATION]),
  );
  assert.strictEqual(rendus.length, 1);
});

test('ce qui suit la fin dans le meme chunk est conserve', () => {
  const f = creerFermeturePopup();
  f.marquer(7);

  const sortie = f.transformer(Buffer.concat([paquet(TRAME_FIN_ECHANGE), paquet(AUTRE)]), conn);

  assert.deepStrictEqual(
    sortie,
    Buffer.concat([paquet(TRAME_FIN_ECHANGE), PAQUET_ANNULATION, paquet(AUTRE)]),
  );
});

test('la marque ne sert qu une fois', () => {
  const f = creerFermeturePopup();
  f.marquer(7);
  f.transformer(paquet(TRAME_FIN_ECHANGE), conn);
  assert.strictEqual(f.transformer(paquet(TRAME_FIN_ECHANGE), conn), null);
});

// Un echange ANNULE se termine par la meme trame, sans le champ 2. Elle solde
// la marque sans rien inserer: sinon la marque resterait armee et la trame
// partirait a la fin de l'echange SUIVANT, celui-la peut-etre accepte a la main.
test('un echange annule solde la marque sans rien inserer', () => {
  const f = creerFermeturePopup();
  f.marquer(7);

  assert.strictEqual(f.transformer(paquet(TRAME_ANNULATION), conn), null);
  assert.strictEqual(f.transformer(paquet(TRAME_FIN_ECHANGE), conn), null);
});

test('un autre compte ne recoit rien', () => {
  const f = creerFermeturePopup();
  f.marquer(7);
  assert.strictEqual(f.transformer(paquet(TRAME_FIN_ECHANGE), { pid: 8, id: '8/1' }), null);
});

// Meme prudence que le masquage: une trame coupee par la fin du chunk laisse le
// reste partir tel quel plutot que de deviner ou commence la suivante.
test('une trame incomplete a la fin du chunk ne fait rien inserer', () => {
  const f = creerFermeturePopup();
  f.marquer(7);
  const coupe = paquet(TRAME_FIN_ECHANGE).subarray(0, 10);
  assert.strictEqual(f.transformer(coupe, conn), null);
});

// Un champ de plus dans la trame du serveur ne doit pas desarmer la fermeture
// en silence: c'est pour ca qu'on decode au lieu de comparer les octets.
test('un champ de plus dans la fin d echange ne desarme rien', () => {
  const f = creerFermeturePopup();
  f.marquer(7);
  // Meme trame, avec un champ 3 = 1 ajoute dans le message: 1801 en plus.
  const plus = Buffer.from(
    '121f1a1d0a13747970652e616e6b616d612e636f6d2f6a7a691206080b10011801', 'hex',
  );
  assert.strictEqual(decodeFrameRaw(plus).type, 'jzi');

  const sortie = f.transformer(paquet(plus), conn);
  assert.deepStrictEqual(sortie, Buffer.concat([paquet(plus), PAQUET_ANNULATION]));
});
