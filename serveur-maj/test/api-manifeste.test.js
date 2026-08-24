'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { traiterManifeste } = require('../api/manifeste');

function fauxSql(reponses) {
  const sql = (c, ...v) => Promise.resolve(reponses.length ? reponses.shift() : []);
  return sql;
}

test('sans cle, 404', async () => {
  const r = await traiterManifeste({ cle: undefined, sql: fauxSql([]) });
  assert.strictEqual(r.statut, 404);
});

test('cle inconnue, 404', async () => {
  const r = await traiterManifeste({ cle: 'zzz', sql: fauxSql([[]]) });
  assert.strictEqual(r.statut, 404);
});

test('cle valide, 200 et le manifeste', async () => {
  // 1er SELECT: verifierCle rend le nom. 2e: UPDATE derniere_vue. 3e: lireManifeste.
  const sql = fauxSql([[{ nom: 'Kevin' }], [], [{ version: '0.2.0', sha256: 'abc', actif: true, message: null }]]);
  const r = await traiterManifeste({ cle: 'ok', sql });
  assert.strictEqual(r.statut, 200);
  assert.strictEqual(r.corps.version, '0.2.0');
  assert.strictEqual(r.corps.sha256, 'abc');
});
