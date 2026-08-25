'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { traiterEtat } = require('../api/etat');

function fauxSql(reponses = []) {
  const appels = [];
  const sql = (c, ...v) => { appels.push(v); return Promise.resolve(reponses.length ? reponses.shift() : []); };
  sql.appels = appels;
  return sql;
}

function fauxPrevenir() {
  const envoyes = [];
  const f = async (texte) => { envoyes.push(texte); return { envoye: true }; };
  f.envoyes = envoyes;
  return f;
}

test('sans cle: 404 corps vide', async () => {
  const sql = fauxSql();
  const r = await traiterEtat({ cle: undefined, corps: {}, sql, prevenirFn: fauxPrevenir() });
  assert.strictEqual(r.statut, 404);
  assert.strictEqual(r.corps, null);
  assert.strictEqual(sql.appels.length, 0);
});

test('cle inconnue: 404 et AUCUNE ecriture', async () => {
  // 1er appel = SELECT de verifierCle, qui ne rend aucune ligne.
  const sql = fauxSql([[]]);
  const r = await traiterEtat({ cle: 'INCONNUE', corps: { version: '0.2.4' }, sql, prevenirFn: fauxPrevenir() });
  assert.strictEqual(r.statut, 404);
  // Une seule requete au total: la verification. Ni lancement, ni refus.
  assert.strictEqual(sql.appels.length, 1);
});

test('cle valide: 200, lancement enregistre', async () => {
  // SELECT verifierCle, UPDATE derniere_vue, UPDATE version_vue, INSERT lancements
  const sql = fauxSql([[{ nom: 'Jibb' }], [], [], []]);
  const r = await traiterEtat({ cle: 'CLE', corps: { version: '0.2.4' }, sql, prevenirFn: fauxPrevenir() });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, { ok: true });
});

test('un refus neuf declenche un ping nomme', async () => {
  const prevenirFn = fauxPrevenir();
  const sql = fauxSql([[{ nom: 'Jibb' }], [], [], [], [{ version: '0.2.3' }]]);
  await traiterEtat({
    cle: 'CLE',
    corps: { version: '0.2.4', refus: [{ version: '0.2.3', journal: 'boum' }] },
    sql, prevenirFn,
  });
  assert.strictEqual(prevenirFn.envoyes.length, 1);
  assert.match(prevenirFn.envoyes[0], /Jibb/);
  assert.match(prevenirFn.envoyes[0], /0\.2\.3/);
});

test('un refus deja connu ne re-ping pas', async () => {
  const prevenirFn = fauxPrevenir();
  // Le dernier [] = ON CONFLICT DO NOTHING n'a rien insere.
  const sql = fauxSql([[{ nom: 'Jibb' }], [], [], [], []]);
  await traiterEtat({
    cle: 'CLE',
    corps: { version: '0.2.4', refus: [{ version: '0.2.3' }] },
    sql, prevenirFn,
  });
  assert.strictEqual(prevenirFn.envoyes.length, 0);
});

test('un ping qui echoue ne fait pas echouer la requete de l ami', async () => {
  const prevenirFn = async () => { throw new Error('discord mort'); };
  const sql = fauxSql([[{ nom: 'Jibb' }], [], [], [], [{ version: '0.2.3' }]]);
  const r = await traiterEtat({
    cle: 'CLE', corps: { version: '0.2.4', refus: [{ version: '0.2.3' }] }, sql, prevenirFn,
  });
  assert.strictEqual(r.statut, 200);
});

test('corps null (JSON.parse("null")): normalise et rend 200', async () => {
  const sql = fauxSql([[{ nom: 'Jibb' }], [], [], []]);
  const r = await traiterEtat({ cle: 'CLE', corps: null, sql, prevenirFn: fauxPrevenir() });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, { ok: true });
});

test('corps absent: normalise et rend 200', async () => {
  const sql = fauxSql([[{ nom: 'Jibb' }], [], [], []]);
  const r = await traiterEtat({ cle: 'CLE', sql, prevenirFn: fauxPrevenir() });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, { ok: true });
});
