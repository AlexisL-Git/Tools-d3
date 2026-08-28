'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  estSensible, cleDe, TRAME_FERMER_DIALOGUE,
  DELAI_PLANCHER_MS, FENETRE_APPRENTISSAGE_MS, FENETRE_DIALOGUE_MS,
} = require('../src/garde-combat');
const { decodeFrameRaw } = require('../src/codec/rawProto');

const trame = (type, champs) => ({
  kind: 'request', type,
  payload: Object.entries(champs).map(([no, value]) => ({ no: Number(no), value })),
});

// Les trois types qui peuvent lancer un combat, et eux seuls. Les cinq autres
// types rejoues — teleportation, changement de carte, information de carte,
// havre-sac, sortie de donjon — ne declenchent aucun combat.
test('seuls les trois types de dialogue et d interaction sont sensibles', () => {
  for (const t of ['iov', 'ioy', 'iwo']) assert.strictEqual(estSensible(t), true, t);
  for (const t of ['hjc', 'jqk', 'jrh', 'kla', 'kjw', 'jbn', 'ieb']) {
    assert.strictEqual(estSensible(t), false, t);
  }
});

// Les valeurs viennent de la capture du 28/08: le maitre a repondu ioy 25088,
// et le combat a demarre 30 ms plus tard.
test('la cle d une reponse de dialogue porte son numero', () => {
  assert.strictEqual(cleDe('ioy', trame('ioy', { 1: 25088 })), 'ioy:25088');
});

test('la cle d un PNJ porte sa carte et son instance', () => {
  assert.strictEqual(cleDe('iov', trame('iov', { 1: 3, 2: 153356294, 3: -20000 })), 'iov:153356294:-20000');
});

test('la cle d un element interactif porte son identifiant', () => {
  assert.strictEqual(cleDe('iwo', trame('iwo', { 1: 1920, 2: 489565 })), 'iwo:489565');
});

test('un type non sensible n a pas de cle', () => {
  assert.strictEqual(cleDe('hjc', trame('hjc', { 1: 1, 2: 2 })), null);
  assert.strictEqual(cleDe('ieb', trame('ieb', { 1: 1642, 2: 9828 })), null);
});

// UNE CLE PARTIELLE EST PIRE QUE PAS DE CLE: elle bloquerait une autre action
// que celle qu'on a vue lancer un combat.
test('un champ manquant ne donne pas de cle partielle', () => {
  assert.strictEqual(cleDe('iov', trame('iov', { 2: 153356294 })), null);
  assert.strictEqual(cleDe('ioy', trame('ioy', {})), null);
  assert.strictEqual(cleDe('iwo', trame('iwo', { 1: 1920 })), null);
});

test('une trame absente ou malformee ne donne pas de cle', () => {
  assert.strictEqual(cleDe('ioy', null), null);
  assert.strictEqual(cleDe('ioy', 'x'), null);
  assert.strictEqual(cleDe('ioy', { kind: 'request', type: 'ioy', payload: null }), null);
});

// Les valeurs BigInt du decodeur doivent rendre la meme cle que les nombres,
// sans quoi la liste apprise ne reconnaitrait jamais l'action rejouee.
test('un champ BigInt rend la meme cle qu un nombre', () => {
  assert.strictEqual(cleDe('ioy', trame('ioy', { 1: 25088n })), 'ioy:25088');
});

test('la trame de fermeture de dialogue est un kla sans charge utile', () => {
  const f = decodeFrameRaw(TRAME_FERMER_DIALOGUE);
  assert.notStrictEqual(f, null);
  assert.strictEqual(f.kind, 'request');
  assert.strictEqual(f.type, 'kla');
  assert.ok(f.payload === null || f.payload.length === 0, 'kla ne porte aucun champ');
});

test('les valeurs de reglage sont celles de la conception', () => {
  assert.strictEqual(DELAI_PLANCHER_MS, 250);
  assert.strictEqual(FENETRE_APPRENTISSAGE_MS, 2000);
  assert.strictEqual(FENETRE_DIALOGUE_MS, 30000);
});
