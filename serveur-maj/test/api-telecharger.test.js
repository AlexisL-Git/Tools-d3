'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { traiterTelechargement } = require('../api/telecharger');

function fauxSql(reponses) {
  return () => Promise.resolve(reponses.length ? reponses.shift() : []);
}

test('sans cle, 404', async () => {
  const r = await traiterTelechargement({ cle: undefined, sql: fauxSql([]) });
  assert.strictEqual(r.statut, 404);
});

test('cle inconnue, 404 — et l URL n est pas revelee', async () => {
  const r = await traiterTelechargement({ cle: 'zzz', sql: fauxSql([[]]) });
  assert.strictEqual(r.statut, 404);
  assert.strictEqual(r.corps, null);
});

test('cle valide, l URL du paquet est rendue', async () => {
  // verifierCle: SELECT puis UPDATE. Puis la lecture de l'URL.
  const sql = fauxSql([[{ nom: 'Kevin' }], [], [{ url_paquet: 'https://exemple/omni.zip' }]]);
  const r = await traiterTelechargement({ cle: 'ok', sql });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, { url: 'https://exemple/omni.zip' });
});

// Une cle valide mais aucun paquet publie: 404 aussi. Rendre 200 avec une URL
// nulle ferait cliquer dans le vide.
test('cle valide mais aucune URL posee, 404', async () => {
  const sql = fauxSql([[{ nom: 'Kevin' }], [], [{ url_paquet: null }]]);
  const r = await traiterTelechargement({ cle: 'ok', sql });
  assert.strictEqual(r.statut, 404);
});
