'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { COLONNES, etatColonne, cibleBascule, valeurDe } = require('../src/comptes/colonnes');

const L = (id, extra = {}) => ({
  id, exclu: false, passeTour: false, invitation: false, noAnim: false, echange: false, ...extra,
});

// --- la table des colonnes -------------------------------------------------

test('les cinq colonnes sont déclarées, dans l ordre affiché', () => {
  assert.deepStrictEqual(COLONNES.map((c) => c.nom), ['repl', 'tour', 'groupe', 'anim', 'echange']);
});

// La colonne « Répl. » est INVERSEE par rapport aux quatre autres: son champ
// est `exclu`, et cocher veut dire « suit le meneur ». C'est le piege que la
// table doit absorber, pour que personne n'ait a s'en souvenir ailleurs.
test('la colonne Répl. lit l inverse de exclu', () => {
  assert.strictEqual(valeurDe(L(1, { exclu: false }), 'repl'), true);
  assert.strictEqual(valeurDe(L(1, { exclu: true }), 'repl'), false);
});

test('les quatre autres colonnes lisent leur champ directement', () => {
  assert.strictEqual(valeurDe(L(1, { passeTour: true }), 'tour'), true);
  assert.strictEqual(valeurDe(L(1, { invitation: true }), 'groupe'), true);
  assert.strictEqual(valeurDe(L(1, { noAnim: true }), 'anim'), true);
  assert.strictEqual(valeurDe(L(1, { echange: true }), 'echange'), true);
});

// --- l etat a trois valeurs ------------------------------------------------

test('tout coché donne « tous »', () => {
  const lignes = [L(1, { passeTour: true }), L(2, { passeTour: true })];
  assert.strictEqual(etatColonne(lignes, 'tour'), 'tous');
});

test('rien coché donne « aucun »', () => {
  assert.strictEqual(etatColonne([L(1), L(2)], 'tour'), 'aucun');
});

test('un mélange donne « partiel »', () => {
  const lignes = [L(1, { passeTour: true }), L(2)];
  assert.strictEqual(etatColonne(lignes, 'tour'), 'partiel');
});

// Une liste vide n'est pas « tous »: l'en-tete doit se lire comme eteint,
// sinon un panneau sans aucun client afficherait cinq colonnes armees.
test('une liste vide donne « aucun »', () => {
  assert.strictEqual(etatColonne([], 'tour'), 'aucun');
});

// Un client sans identifiant de compte ne peut rien enregistrer: il ne compte
// ni dans l'etat de la colonne, ni dans l'action groupee.
test('une ligne sans identifiant ne compte pas', () => {
  const lignes = [L(1, { passeTour: true }), L(null)];
  assert.strictEqual(etatColonne(lignes, 'tour'), 'tous');
});

// --- ce que fait le clic groupé --------------------------------------------

// Le geste attendu est simple: si tout est allume, on eteint; sinon on allume
// tout. Depuis « partiel », on complete plutot que de tout eteindre — c'est ce
// qui demande le moins de clics dans le cas courant.
test('depuis « tous », le clic éteint tout le monde', () => {
  const lignes = [L(1, { passeTour: true }), L(2, { passeTour: true })];
  assert.strictEqual(cibleBascule(lignes, 'tour'), false);
});

test('depuis « aucun », le clic allume tout le monde', () => {
  assert.strictEqual(cibleBascule([L(1), L(2)], 'tour'), true);
});

test('depuis « partiel », le clic complète', () => {
  const lignes = [L(1, { passeTour: true }), L(2)];
  assert.strictEqual(cibleBascule(lignes, 'tour'), true);
});

test('une colonne inconnue ne rend rien plutôt que de lever', () => {
  assert.strictEqual(etatColonne([L(1)], 'inexistante'), null);
  assert.strictEqual(cibleBascule([L(1)], 'inexistante'), null);
  assert.strictEqual(valeurDe(L(1), 'inexistante'), null);
});
