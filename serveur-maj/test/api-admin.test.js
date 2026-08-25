'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
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

test('paquet enregistre une adresse https', async () => {
  const sql = fauxSql([[]]);
  const r = await traiterAdmin({ motDePasse: SECRET, action: 'paquet', corps: { url: 'https://exemple/omni.zip' }, sql, motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 200);
  assert.strictEqual(r.corps.url, 'https://exemple/omni.zip');
});

// Une adresse en http exposerait la redirection a une interception triviale.
test('paquet refuse une adresse qui n est pas en https', async () => {
  const r = await traiterAdmin({ motDePasse: SECRET, action: 'paquet', corps: { url: 'http://exemple/omni.zip' }, sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 400);
});

test('paquet sans url rend l adresse en place', async () => {
  const sql = fauxSql([[{ url_paquet: 'https://exemple/omni.zip' }]]);
  const r = await traiterAdmin({ motDePasse: SECRET, action: 'paquet', corps: {}, sql, motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 200);
  assert.strictEqual(r.corps.url, 'https://exemple/omni.zip');
});

test('action inconnue, 400', async () => {
  const r = await traiterAdmin({ motDePasse: SECRET, action: 'xyz', sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 400);
});

function gzB64(charge = 'x') {
  return Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from(charge)]).toString('base64');
}

// La garde: chaque action ajoutee doit rendre 404 sans mot de passe, sinon on
// a ouvert une porte derriere celle qu'on croyait fermer.
test('les actions de version sont refusees sans mot de passe', async () => {
  for (const action of ['versions', 'televerser', 'activer']) {
    const r = await traiterAdmin({
      motDePasse: undefined, action, corps: { version: '0.2.3', archive: gzB64() },
      sql: fauxSql([]), motDePasseAttendu: SECRET,
    });
    assert.strictEqual(r.statut, 404, action + ' doit rendre 404');
  }
});

test('versions rend la liste', async () => {
  const lignes = [{ version: '0.2.3', sha256: 'a', taille: 82, publiee_le: 'hier' }];
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'versions', sql: fauxSql([lignes]), motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, lignes);
});

test('televerser decode le base64 et rend l empreinte calculee', async () => {
  const archive = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from('contenu')]);
  const attendu = crypto.createHash('sha256').update(archive).digest('hex');
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'televerser',
    corps: { version: '0.2.3', archive: archive.toString('base64') },
    // L'INSERT (ON CONFLICT DO NOTHING RETURNING version) rend une ligne:
    // rien n'existait, l'insertion a eu lieu.
    sql: fauxSql([[{ version: '0.2.3' }]]), motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 200);
  assert.strictEqual(r.corps.sha256, attendu);
});

test('televerser sans archive, 400 avec le message', async () => {
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'televerser', corps: { version: '0.2.3' },
    sql: fauxSql([]), motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 400);
  assert.strictEqual(r.corps.erreur, 'archive vide');
});

test('activer une version connue bascule le manifeste', async () => {
  const sql = fauxSql([[{ version: '0.2.3', sha256: 'b'.repeat(64) }], []]);
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'activer', corps: { version: '0.2.3' },
    sql, motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 200);
  assert.strictEqual(r.corps.sha256, 'b'.repeat(64));
});

test('activer une version inconnue, 400', async () => {
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'activer', corps: { version: '9.9.9' },
    sql: fauxSql([[]]), motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 400);
});

test('lister-manifeste rend le manifeste courant, et 404 sans mot de passe', async () => {
  const m = { version: '0.2.3', sha256: 'c'.repeat(64), actif: true, message: null };
  const ok = await traiterAdmin({ motDePasse: SECRET, action: 'lister-manifeste', sql: fauxSql([[m]]), motDePasseAttendu: SECRET });
  assert.strictEqual(ok.statut, 200);
  assert.deepStrictEqual(ok.corps, m);
  const ko = await traiterAdmin({ motDePasse: undefined, action: 'lister-manifeste', sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(ko.statut, 404);
});
