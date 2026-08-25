'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { verifierCle, listerAmis, creerAmi, basculerAmi } = require('../lib/amis');

// Faux client Neon: une fonction tag qui rend la reponse en tete de file et
// journalise l'appel. Chaque requete rend un tableau, comme le vrai driver.
function fauxSql(reponses = []) {
  const appels = [];
  const sql = (chaines, ...valeurs) => {
    appels.push({ texte: chaines.join('?'), valeurs });
    return Promise.resolve(reponses.length ? reponses.shift() : []);
  };
  sql.appels = appels;
  return sql;
}

test('une cle active est acceptee et sa derniere_vue mise a jour', async () => {
  const sql = fauxSql([[{ nom: 'Kevin' }], []]);
  const r = await verifierCle(sql, 'abc');
  assert.deepStrictEqual(r, { ok: true, nom: 'Kevin' });
  // Deux requetes: le SELECT, puis l'UPDATE derniere_vue.
  assert.strictEqual(sql.appels.length, 2);
  assert.match(sql.appels[1].texte, /derniere_vue/);
});

test('une cle inconnue est refusee, sans UPDATE', async () => {
  const sql = fauxSql([[]]);
  const r = await verifierCle(sql, 'zzz');
  assert.deepStrictEqual(r, { ok: false });
  assert.strictEqual(sql.appels.length, 1);
});

test('une cle inactive est refusee', async () => {
  // Le SELECT filtre sur actif=true: une cle inactive rend 0 ligne.
  const sql = fauxSql([[]]);
  assert.deepStrictEqual(await verifierCle(sql, 'off'), { ok: false });
});

test('creerAmi genere une cle et insere', async () => {
  const sql = fauxSql([[]]);
  const r = await creerAmi(sql, 'Marie', () => 'cle-fixe');
  assert.deepStrictEqual(r, { cle: 'cle-fixe', nom: 'Marie' });
  assert.match(sql.appels[0].texte, /INSERT INTO amis/i);
  assert.ok(sql.appels[0].valeurs.includes('cle-fixe'));
  assert.ok(sql.appels[0].valeurs.includes('Marie'));
});

test('listerAmis rend les lignes telles quelles', async () => {
  const lignes = [{ cle: 'a', nom: 'A', actif: true }];
  assert.deepStrictEqual(await listerAmis(fauxSql([lignes])), lignes);
});

test('listerAmis selectionne version_vue: le panneau en depend pour afficher le retard', async () => {
  const sql = fauxSql([[]]);
  await listerAmis(sql);
  assert.match(sql.appels[0].texte, /version_vue/);
});

test('basculerAmi passe le booleen et la cle', async () => {
  const sql = fauxSql([[]]);
  await basculerAmi(sql, 'a', false);
  assert.ok(sql.appels[0].valeurs.includes(false));
  assert.ok(sql.appels[0].valeurs.includes('a'));
});
