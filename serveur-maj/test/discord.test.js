'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { prevenir, DELAI_MS } = require('../lib/discord');

test('DELAI_MS est 700: plus court que le budget client de /api/etat (2000 ms)', () => {
  assert.strictEqual(DELAI_MS, 700);
});

function fauxFetch(reponses) {
  const appels = [];
  const f = async (url, options) => {
    appels.push({ url, corps: JSON.parse(options.body) });
    const r = reponses.shift();
    if (r instanceof Error) throw r;
    return { ok: r.statut >= 200 && r.statut < 300, status: r.statut };
  };
  f.appels = appels;
  return f;
}

test('sans URL de webhook, aucun appel et aucune erreur', async () => {
  const chercher = fauxFetch([]);
  const r = await prevenir('coucou', { url: '', chercher });
  assert.strictEqual(r.envoye, false);
  assert.strictEqual(chercher.appels.length, 0);
});

test('avec URL, le texte part dans content', async () => {
  const chercher = fauxFetch([{ statut: 204 }]);
  const r = await prevenir('coucou', { url: 'https://discord.invalid/x', chercher });
  assert.strictEqual(r.envoye, true);
  assert.strictEqual(chercher.appels[0].url, 'https://discord.invalid/x');
  assert.strictEqual(chercher.appels[0].corps.content, 'coucou');
});

test('un webhook qui rend 500 ne leve pas', async () => {
  const chercher = fauxFetch([{ statut: 500 }]);
  const r = await prevenir('coucou', { url: 'https://discord.invalid/x', chercher });
  assert.strictEqual(r.envoye, false);
  assert.match(r.raison, /500/);
});

test('un fetch qui explose ne leve pas', async () => {
  const chercher = fauxFetch([new Error('reseau mort')]);
  const r = await prevenir('coucou', { url: 'https://discord.invalid/x', chercher });
  assert.strictEqual(r.envoye, false);
  assert.strictEqual(r.raison, 'injoignable');
});
