'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { lireManifeste, ecrireManifeste, basculerService } = require('../lib/manifeste');

function fauxSql(reponses = []) {
  const appels = [];
  const sql = (c, ...v) => { appels.push({ texte: c.join('?'), valeurs: v }); return Promise.resolve(reponses.length ? reponses.shift() : []); };
  sql.appels = appels;
  return sql;
}

test('lireManifeste rend la ligne unique', async () => {
  const sql = fauxSql([[{ version: '0.2.0', sha256: 'abc', actif: true, message: null }]]);
  assert.deepStrictEqual(await lireManifeste(sql), { version: '0.2.0', sha256: 'abc', actif: true, message: null });
});

// La ligne config est garantie par appliquerSchema; mais si elle manque, ne
// pas planter: rendre un manifeste inerte plutot qu'une exception.
test('lireManifeste sans ligne rend un manifeste vide non plantant', async () => {
  const r = await lireManifeste(fauxSql([[]]));
  assert.strictEqual(r.version, null);
  assert.strictEqual(r.actif, false);
});

test('ecrireManifeste met version et sha, jamais actif', async () => {
  const sql = fauxSql([[]]);
  await ecrireManifeste(sql, { version: '0.3.0', sha256: 'def' });
  assert.match(sql.appels[0].texte, /UPDATE config SET/i);
  assert.ok(sql.appels[0].valeurs.includes('0.3.0'));
  assert.ok(!/actif/i.test(sql.appels[0].texte));
});

test('basculerService ecrit actif et message', async () => {
  const sql = fauxSql([[]]);
  await basculerService(sql, false, 'maintenance');
  assert.ok(sql.appels[0].valeurs.includes(false));
  assert.ok(sql.appels[0].valeurs.includes('maintenance'));
});

test('lireUrlPaquet rend l URL, ou null quand elle n est pas posee', async () => {
  const { lireUrlPaquet } = require('../lib/manifeste');
  assert.strictEqual(await lireUrlPaquet(fauxSql([[{ url_paquet: 'https://exemple/omni.zip' }]])), 'https://exemple/omni.zip');
  assert.strictEqual(await lireUrlPaquet(fauxSql([[{ url_paquet: null }]])), null);
  assert.strictEqual(await lireUrlPaquet(fauxSql([[]])), null);
});

test('ecrireUrlPaquet passe l URL en parametre', async () => {
  const { ecrireUrlPaquet } = require('../lib/manifeste');
  const sql = fauxSql([[]]);
  await ecrireUrlPaquet(sql, 'https://exemple/omni.zip');
  assert.ok(sql.appels[0].valeurs.includes('https://exemple/omni.zip'));
});
