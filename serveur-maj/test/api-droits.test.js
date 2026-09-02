'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { traiterDroits } = require('../api/droits');

function fauxSql(reponses) {
  return () => Promise.resolve(reponses.length ? reponses.shift() : []);
}

test('sans cle, 404', async () => {
  const r = await traiterDroits({ cle: undefined, sql: fauxSql([]) });
  assert.strictEqual(r.statut, 404);
});

test('cle inconnue, 404 et aucun droit divulgue', async () => {
  const r = await traiterDroits({ cle: 'zzz', sql: fauxSql([[]]) });
  assert.strictEqual(r.statut, 404);
  assert.strictEqual(r.corps, null);
});

test('cle valide, 200 et la liste des fonctions accordees', async () => {
  // 1er SELECT: verifierCle rend le nom. 2e: UPDATE derniere_vue. 3e: les droits.
  const sql = fauxSql([[{ nom: 'Ilan' }], [], [{ fonction: 'songe' }, { fonction: 'hdv' }]]);
  const r = await traiterDroits({ cle: 'ok', sql });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, { droits: ['songe', 'hdv'] });
});

test('cle valide sans aucun droit, 200 et une liste vide', async () => {
  // FERME PAR DEFAUT: un ami neuf n a rien, et ce n est pas une erreur.
  const sql = fauxSql([[{ nom: 'Neuf' }], [], []]);
  const r = await traiterDroits({ cle: 'ok', sql });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, { droits: [] });
});
