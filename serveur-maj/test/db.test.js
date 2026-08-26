'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { appliquerSchema, oublierSchema } = require('../lib/db');

// Compte les requetes emises, sans les lire: seul leur NOMBRE nous interesse.
function fauxSql(lever = false) {
  const appels = [];
  const sql = (c) => {
    appels.push(c.join('?'));
    return lever ? Promise.reject(new Error('base injoignable')) : Promise.resolve([]);
  };
  sql.appels = appels;
  return sql;
}

test('le schema n est joue qu une fois par processus', async () => {
  oublierSchema();
  const sql = fauxSql();
  await appliquerSchema(sql);
  const premier = sql.appels.length;
  assert.ok(premier > 1, 'le premier appel doit ecrire le schema');

  await appliquerSchema(sql);
  await appliquerSchema(sql);
  assert.strictEqual(sql.appels.length, premier,
    'les appels suivants ne doivent emettre aucune requete');
});

test('deux appels simultanes ne jouent le schema qu une fois', async () => {
  oublierSchema();
  const sql = fauxSql();
  await Promise.all([appliquerSchema(sql), appliquerSchema(sql), appliquerSchema(sql)]);
  const seul = fauxSql();
  await appliquerSchema(seul);
  assert.strictEqual(seul.appels.length, 0, 'le schema est deja pose pour ce processus');
});

// Memoriser un ECHEC condamnerait le processus: toutes les requetes suivantes
// partiraient sur une base sans tables, sans jamais retenter.
test('un schema en echec n est pas memorise', async () => {
  oublierSchema();
  await assert.rejects(() => appliquerSchema(fauxSql(true)), /injoignable/);

  const sql = fauxSql();
  await appliquerSchema(sql);
  assert.ok(sql.appels.length > 1, 'apres un echec, le schema doit etre rejoue');
});
