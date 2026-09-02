'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { traiterAdmin } = require('../api/admin');
const { FONCTIONS } = require('../lib/fonctions');

function fauxSql(reponses = []) {
  const sql = (c, ...v) => {
    sql.appels.push([...v]);
    return Promise.resolve(reponses.length ? reponses.shift() : []);
  };
  sql.appels = [];
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

test('publier n existe plus: action inconnue', async () => {
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'publier', corps: { version: '0.2.4', sha256: 'a'.repeat(64) },
    sql: fauxSql([]), motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 400);
  assert.strictEqual(r.corps.erreur, 'action inconnue');
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

test('action refus: la liste, derriere le mot de passe', async () => {
  const ligne = { cle: 'CLE', nom: 'Jibb', version: '0.2.3', journal: 'boum', signale_le: 'hier' };
  const sql = fauxSql([[ligne]]);
  const r = await traiterAdmin({
    motDePasse: SECRET, motDePasseAttendu: SECRET, action: 'refus', corps: {}, sql,
  });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, [ligne]);
});

test('action refus: 404 sur mauvais mot de passe', async () => {
  const sql = fauxSql();
  const r = await traiterAdmin({
    motDePasse: 'faux', motDePasseAttendu: SECRET, action: 'refus', corps: {}, sql,
  });
  assert.strictEqual(r.statut, 404);
  assert.strictEqual(sql.appels.length, 0);
});

test('action lancements sans cle: purge puis compteurs', async () => {
  // 1er appel = DELETE ... RETURNING, 2e = SELECT COUNT GROUP BY
  const sql = fauxSql([[{ id: 1 }], [{ cle: 'CLE', n: 4 }]]);
  const r = await traiterAdmin({
    motDePasse: SECRET, motDePasseAttendu: SECRET, action: 'lancements', corps: {}, sql,
  });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, [{ cle: 'CLE', n: 4 }]);
  assert.strictEqual(sql.appels.length, 2);
});

test('action lancements avec cle: le detail, sans purge', async () => {
  const sql = fauxSql([[{ version: '0.2.4', au: 'hier' }]]);
  const r = await traiterAdmin({
    motDePasse: SECRET, motDePasseAttendu: SECRET, action: 'lancements', corps: { cle: 'CLE' }, sql,
  });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, [{ version: '0.2.4', au: 'hier' }]);
  assert.strictEqual(sql.appels.length, 1);
  assert.deepStrictEqual(sql.appels[0], ['CLE', 20]);
});

test('action lancements: 404 sur mauvais mot de passe', async () => {
  const sql = fauxSql();
  const r = await traiterAdmin({
    motDePasse: 'faux', motDePasseAttendu: SECRET, action: 'lancements', corps: {}, sql,
  });
  assert.strictEqual(r.statut, 404);
  assert.strictEqual(sql.appels.length, 0);
});

test('action fonctions: la liste a afficher', async () => {
  const r = await traiterAdmin({
    motDePasse: 'secret', action: 'fonctions', sql: fauxSql([]), motDePasseAttendu: 'secret',
  });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, FONCTIONS);
});

test('action droit: une fonction inconnue est refusee', async () => {
  // Sans cette garde, une faute de frappe au panneau ecrit une ligne que
  // l application ne lira jamais, et la case resterait cochee pour rien.
  const r = await traiterAdmin({
    motDePasse: 'secret', action: 'droit',
    corps: { cle: 'abc', fonction: 'replicate', actif: true },
    sql: fauxSql([]), motDePasseAttendu: 'secret',
  });
  assert.strictEqual(r.statut, 400);
});

test('action droit: sans cle, 400', async () => {
  const r = await traiterAdmin({
    motDePasse: 'secret', action: 'droit',
    corps: { fonction: 'hdv', actif: true },
    sql: fauxSql([]), motDePasseAttendu: 'secret',
  });
  assert.strictEqual(r.statut, 400);
});

test('action droit: accorder puis retirer', async () => {
  const requetes = [];
  const sql = (chaines, ...valeurs) => { requetes.push({ chaines, valeurs }); return Promise.resolve([]); };
  const ok = await traiterAdmin({
    motDePasse: 'secret', action: 'droit',
    corps: { cle: 'abc', fonction: 'hdv', actif: true },
    sql, motDePasseAttendu: 'secret',
  });
  assert.strictEqual(ok.statut, 200);
  assert.ok(requetes[0].chaines.join('').includes('INSERT INTO droits'));
  await traiterAdmin({
    motDePasse: 'secret', action: 'droit',
    corps: { cle: 'abc', fonction: 'hdv', actif: false },
    sql, motDePasseAttendu: 'secret',
  });
  assert.ok(requetes[1].chaines.join('').includes('DELETE FROM droits'));
});

test('sans le mot de passe, les droits ne se lisent pas', async () => {
  const r = await traiterAdmin({
    motDePasse: 'faux', action: 'droits', sql: fauxSql([]), motDePasseAttendu: 'secret',
  });
  assert.strictEqual(r.statut, 404);
});

test('supprimer-ami sans cle, 400', async () => {
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'supprimer-ami', corps: {}, sql: fauxSql([]), motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 400);
});

// L'ordre compte: droits, refus, lancements, puis amis en dernier -- la
// ligne amis est la reference que les trois autres pointent.
test('supprimer-ami efface dans les quatre tables, amis en dernier', async () => {
  const requetes = [];
  const sql = (chaines, ...valeurs) => { requetes.push({ texte: chaines.join(''), valeurs }); return Promise.resolve([]); };
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'supprimer-ami', corps: { cle: 'CLE' }, sql, motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 200);
  assert.strictEqual(requetes.length, 4);
  assert.ok(requetes[0].texte.includes('DELETE FROM droits'));
  assert.ok(requetes[1].texte.includes('DELETE FROM refus'));
  assert.ok(requetes[2].texte.includes('DELETE FROM lancements'));
  assert.ok(requetes[3].texte.includes('DELETE FROM amis'));
  for (const req of requetes) assert.deepStrictEqual(req.valeurs, ['CLE']);
});

// Le test qui compte: la garde interdit l'effacement AVANT toute requete
// DELETE, pas apres coup sur un echec de contrainte.
test('supprimer-version sur la version active, 409 et aucune requete DELETE', async () => {
  const requetes = [];
  const sql = (chaines, ...valeurs) => {
    requetes.push(chaines.join(''));
    return Promise.resolve([{ version: '0.2.9', sha256: 'x'.repeat(64), actif: true, message: null }]);
  };
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'supprimer-version', corps: { version: '0.2.9' }, sql, motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 409);
  assert.ok(!requetes.some((t) => t.includes('DELETE')));
});

test('supprimer-version sur une autre version, 200 et DELETE FROM versions', async () => {
  const requetes = [];
  const sql = (chaines, ...valeurs) => {
    const texte = chaines.join('');
    requetes.push(texte);
    if (texte.includes('FROM config')) {
      return Promise.resolve([{ version: '0.2.9', sha256: 'x'.repeat(64), actif: true, message: null }]);
    }
    return Promise.resolve([]);
  };
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'supprimer-version', corps: { version: '0.2.6' }, sql, motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 200);
  assert.ok(requetes.some((t) => t.includes('DELETE FROM versions')));
});

test('sans le mot de passe, supprimer-ami et supprimer-version rendent 404', async () => {
  for (const action of ['supprimer-ami', 'supprimer-version']) {
    const r = await traiterAdmin({
      motDePasse: undefined, action, corps: { cle: 'CLE', version: '0.2.9' },
      sql: fauxSql([]), motDePasseAttendu: SECRET,
    });
    assert.strictEqual(r.statut, 404, action + ' doit rendre 404');
  }
});
