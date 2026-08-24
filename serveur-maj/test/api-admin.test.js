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

// Le champ Value de Vercel est multiligne: un retour a la ligne colle avec la
// valeur ne doit pas fermer la porte. Mesure prise sur le vrai service.
test('un secret entoure de blancs reste accepte', async () => {
  const amis = [];
  const r = await traiterAdmin({ motDePasse: SECRET, action: 'lister', sql: fauxSql([amis]), motDePasseAttendu: SECRET + String.fromCharCode(10) });
  assert.strictEqual(r.statut, 200);
});

test('un mot de passe faux reste refuse, blancs ou pas', async () => {
  const r = await traiterAdmin({ motDePasse: '  ' + SECRET + 'x ', action: 'lister', sql: fauxSql([]), motDePasseAttendu: SECRET });
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

test('publier ecrit version et sha256 dans le manifeste', async () => {
  const sql = fauxSql([[]]);
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'publier', corps: { version: '0.2.0', sha256: 'a'.repeat(64) },
    sql, motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, { ok: true, version: '0.2.0' });
});

test('publier sans version ou sans sha256 est refuse', async () => {
  const sansVersion = await traiterAdmin({ motDePasse: SECRET, action: 'publier', corps: { sha256: 'a'.repeat(64) }, sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(sansVersion.statut, 400);
  const sansSha = await traiterAdmin({ motDePasse: SECRET, action: 'publier', corps: { version: '0.2.0' }, sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(sansSha.statut, 400);
});

// Une empreinte mal collee (tronquee, avec une espace) publierait une version
// que plus aucun client n'accepterait: 64 caracteres hexadecimaux, ou rien.
test('publier refuse une empreinte qui n est pas un sha256', async () => {
  const r = await traiterAdmin({ motDePasse: SECRET, action: 'publier', corps: { version: '0.2.0', sha256: 'trop-court' }, sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 400);
});

test('action inconnue, 400', async () => {
  const r = await traiterAdmin({ motDePasse: SECRET, action: 'xyz', sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 400);
});
