'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { traiterAdmin } = require('../api/admin');

function fauxSql(reponses = []) {
  const sql = (c, ...v) => Promise.resolve(reponses.length ? reponses.shift() : []);
  return sql;
}
const SECRET = 'motdepasse-admin';

test('mauvais mot de passe, 404', async () => {
  const r = await traiterAdmin({ motDePasse: 'faux', action: 'lister', sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 404);
});

test('sans mot de passe, 404', async () => {
  const r = await traiterAdmin({ motDePasse: undefined, action: 'lister', sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 404);
});

test('lister rend les amis', async () => {
  const amis = [{ cle: 'a', nom: 'A', actif: true }];
  const r = await traiterAdmin({ motDePasse: SECRET, action: 'lister', sql: fauxSql([amis]), motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, amis);
});

test('creer rend la nouvelle cle', async () => {
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'creer', corps: { nom: 'Marie' },
    sql: fauxSql([[]]), genererCle: () => 'k', motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, { cle: 'k', nom: 'Marie' });
});

test('creer sans nom, 400', async () => {
  const r = await traiterAdmin({ motDePasse: SECRET, action: 'creer', corps: {}, sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 400);
});

test('action inconnue, 400', async () => {
  const r = await traiterAdmin({ motDePasse: SECRET, action: 'xyz', sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 400);
});
