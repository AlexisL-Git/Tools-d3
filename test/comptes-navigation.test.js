'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ordonner, suivant, precedent } = require('../src/comptes/navigation');

const L = (id, extra = {}) => ({ id, nickname: 'c' + id, pid: 100 + id, ...extra });

// --- l'ordre de l'équipe ---------------------------------------------------

// Sans ordre enregistre, on garde celui d'arrivee: aucune surprise au premier
// lancement.
test('sans ordre enregistré, la liste ne bouge pas', () => {
  const lignes = [L(3), L(1), L(2)];
  assert.deepStrictEqual(ordonner(lignes, []).map((l) => l.id), [3, 1, 2]);
});

test('l ordre enregistré est appliqué', () => {
  const lignes = [L(3), L(1), L(2)];
  assert.deepStrictEqual(ordonner(lignes, [2, 3, 1]).map((l) => l.id), [2, 3, 1]);
});

// Un compte ajoute dans Zaap apres coup n'est pas dans l'ordre enregistre: il
// va a la fin plutot que de disparaitre.
test('un compte absent de l ordre passe à la fin, dans son ordre d arrivée', () => {
  const lignes = [L(9), L(1), L(8)];
  assert.deepStrictEqual(ordonner(lignes, [1]).map((l) => l.id), [1, 9, 8]);
});

// L'ordre garde la trace de comptes qui ne tournent plus: ils ne doivent pas
// creer de trous ni de lignes fantomes.
test('un identifiant de l ordre sans ligne correspondante est ignoré', () => {
  const lignes = [L(1), L(2)];
  assert.deepStrictEqual(ordonner(lignes, [5, 2, 7, 1]).map((l) => l.id), [2, 1]);
});

// Une ligne sans identifiant de compte ne peut pas etre ordonnee, mais elle
// doit rester affichee.
test('une ligne sans identifiant reste présente, à la fin', () => {
  const lignes = [L(1), L(null), L(2)];
  const r = ordonner(lignes, [2, 1]);
  assert.deepStrictEqual(r.map((l) => l.id), [2, 1, null]);
});

test('ordonner ne modifie pas la liste reçue', () => {
  const lignes = [L(3), L(1)];
  ordonner(lignes, [1, 3]);
  assert.deepStrictEqual(lignes.map((l) => l.id), [3, 1]);
});

// --- suivant et précédent --------------------------------------------------

test('suivant avance dans la liste', () => {
  assert.strictEqual(suivant([10, 20, 30], 10), 20);
  assert.strictEqual(suivant([10, 20, 30], 20), 30);
});

test('suivant reboucle sur le premier', () => {
  assert.strictEqual(suivant([10, 20, 30], 30), 10);
});

test('précédent recule et reboucle sur le dernier', () => {
  assert.strictEqual(precedent([10, 20, 30], 20), 10);
  assert.strictEqual(precedent([10, 20, 30], 10), 30);
});

// On peut appuyer sur « suivant » alors que le premier plan est ailleurs: le
// navigateur, Zaap, ou un client qu'OMNI n'a pas pris en charge.
test('sans point de départ connu, suivant prend le premier', () => {
  assert.strictEqual(suivant([10, 20, 30], null), 10);
  assert.strictEqual(suivant([10, 20, 30], 999), 10);
});

test('sans point de départ connu, précédent prend le dernier', () => {
  assert.strictEqual(precedent([10, 20, 30], null), 30);
});

test('une liste vide ne donne aucune cible', () => {
  assert.strictEqual(suivant([], 10), null);
  assert.strictEqual(precedent([], 10), null);
});

test('un seul client se rend lui-même, sans osciller', () => {
  assert.strictEqual(suivant([10], 10), 10);
  assert.strictEqual(precedent([10], 10), 10);
});
