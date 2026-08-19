'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { MESSAGES, lookup, lookupByName, needsRewrite, accountFields } = require('../src/protocol/replicate');

test('les huit types répliqués sont présents', () => {
  assert.strictEqual(Object.keys(MESSAGES).length, 8);
  for (const k of ['hjc', 'jqk', 'jrh', 'iov', 'ioy', 'kla', 'jbn', 'iwo']) {
    assert.notStrictEqual(lookup(k), null, `${k} manquant`);
  }
});

test('la recherche par nom réel fonctionne dans les deux sens', () => {
  assert.strictEqual(lookup('hjc').name, 'TeleportRequest');
  assert.strictEqual(lookupByName('TeleportRequest').key, 'hjc');
  assert.strictEqual(lookupByName('Inexistant'), null);
});

// La distinction monde/compte est toute la difficulte du rejeu: recopier un
// identifiant propre au maitre ferait agir l'esclave sur un objet qui n'est
// pas le sien, ou ferait rejeter le message.
test('seuls les messages à champ de compte demandent une réécriture', () => {
  assert.strictEqual(needsRewrite('iwo'), true, 'skillInstanceUid est propre au compte');
  assert.strictEqual(needsRewrite('jbn'), true, 'fsor est l identifiant du personnage');
  assert.strictEqual(needsRewrite('hjc'), false);
  assert.strictEqual(needsRewrite('kla'), false, 'sans champ, rien à réécrire');
  assert.strictEqual(needsRewrite('inconnu'), null);
});

test('needsRewrite est cohérent avec le drapeau verbatim', () => {
  for (const [key, m] of Object.entries(MESSAGES)) {
    assert.strictEqual(m.verbatim, !needsRewrite(key), `${key} (${m.name})`);
  }
});

test('les champs à substituer sont nommés', () => {
  assert.deepStrictEqual(accountFields('iwo'), ['skillInstanceUid']);
  assert.deepStrictEqual(accountFields('jbn'), ['fsor']);
  assert.deepStrictEqual(accountFields('hjc'), []);
});

// Une table dont on ne sait plus ce qui est mesure et ce qui est suppose perd
// sa valeur: chaque champ doit porter son niveau de preuve.
test('chaque champ déclare sa nature et son niveau de preuve', () => {
  for (const [key, m] of Object.entries(MESSAGES)) {
    for (const [name, f] of Object.entries(m.fields)) {
      assert.ok(['monde', 'compte'].includes(f.nature), `${key}.${name}: nature`);
      assert.ok(['mesure', 'infere'].includes(f.sur), `${key}.${name}: preuve`);
    }
  }
});
