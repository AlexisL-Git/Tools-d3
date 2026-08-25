'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerCanal, DELAI_SIGNALEMENT_MS } = require('../../amorceur/canal');
const { ecrireArchive, empreinte } = require('../../amorceur/archive');

const BASE = 'https://exemple.invalid';

test('DELAI_SIGNALEMENT_MS est 2000', () => {
  assert.strictEqual(DELAI_SIGNALEMENT_MS, 2000);
});

// Faux fetch: rend la reponse programmee et enregistre l'appel. Aucun test
// n'ouvre de socket.
function fauxFetch(reponses) {
  const appels = [];
  const f = async (url, options) => {
    appels.push({
      url,
      entetes: (options && options.headers) || {},
      corps: options && options.body ? JSON.parse(options.body) : null,
    });
    const r = reponses.shift();
    if (r instanceof Error) throw r;
    return {
      ok: r.statut >= 200 && r.statut < 300,
      status: r.statut,
      json: async () => r.corps,
      arrayBuffer: async () => r.octets.buffer.slice(r.octets.byteOffset, r.octets.byteOffset + r.octets.byteLength),
    };
  };
  f.appels = appels;
  return f;
}

test('le manifeste part avec la cle dans x-cle', async () => {
  const chercher = fauxFetch([{ statut: 200, corps: { version: '0.3.0', sha256: 'abc', actif: true, message: null } }]);
  const c = creerCanal({ base: BASE, chercher });
  const r = await c.manifeste('CLE');
  assert.strictEqual(r.etat, 'ok');
  assert.strictEqual(r.manifeste.version, '0.3.0');
  assert.strictEqual(chercher.appels[0].url, BASE + '/api/manifeste');
  assert.strictEqual(chercher.appels[0].entetes['x-cle'], 'CLE');
});

test('un 404 est un refus, pas une panne', async () => {
  const c = creerCanal({ base: BASE, chercher: fauxFetch([{ statut: 404, corps: null }]) });
  assert.strictEqual((await c.manifeste('CLE')).etat, 'refuse');
});

test('une erreur reseau est injoignable, jamais un refus', async () => {
  const c = creerCanal({ base: BASE, chercher: fauxFetch([new Error('getaddrinfo ENOTFOUND')]) });
  const r = await c.manifeste('CLE');
  assert.strictEqual(r.etat, 'injoignable');
  assert.match(r.raison, /ENOTFOUND/);
});

test('un 500 est injoignable, pas un refus', async () => {
  const c = creerCanal({ base: BASE, chercher: fauxFetch([{ statut: 500, corps: null }]) });
  assert.strictEqual((await c.manifeste('CLE')).etat, 'injoignable');
});

test('une reponse illisible est injoignable', async () => {
  const chercher = async () => ({ ok: true, status: 200, json: async () => { throw new Error('pas du json'); } });
  const c = creerCanal({ base: BASE, chercher });
  assert.strictEqual((await c.manifeste('CLE')).etat, 'injoignable');
});

test('le paquet est rendu quand son sha256 correspond', async () => {
  const archive = ecrireArchive([{ chemin: 'a.txt', contenu: Buffer.from('x') }]);
  const c = creerCanal({ base: BASE, chercher: fauxFetch([{ statut: 200, octets: archive }]) });
  const r = await c.paquet('CLE', empreinte(archive));
  assert.strictEqual(r.etat, 'ok');
  assert.ok(r.archive.equals(archive));
});

test('un sha256 qui ne correspond pas rend corrompu, et l archive n est pas rendue', async () => {
  const archive = ecrireArchive([{ chemin: 'a.txt', contenu: Buffer.from('x') }]);
  const c = creerCanal({ base: BASE, chercher: fauxFetch([{ statut: 200, octets: archive }]) });
  const r = await c.paquet('CLE', '0'.repeat(64));
  assert.strictEqual(r.etat, 'corrompu');
  assert.strictEqual(r.archive, undefined);
});

test('signaler poste sur /api/etat avec la cle et le corps', async () => {
  const chercher = fauxFetch([{ statut: 200, corps: { ok: true } }]);
  const c = creerCanal({ base: BASE, chercher });
  const r = await c.signaler('CLE', { version: '0.2.4', refus: [] });
  assert.strictEqual(r.etat, 'ok');
  assert.strictEqual(chercher.appels[0].url, BASE + '/api/etat');
  assert.strictEqual(chercher.appels[0].entetes['x-cle'], 'CLE');
});

test('signaler: 404 vaut refuse, pas injoignable', async () => {
  const chercher = fauxFetch([{ statut: 404 }]);
  const c = creerCanal({ base: BASE, chercher });
  assert.strictEqual((await c.signaler('CLE', {})).etat, 'refuse');
});

test('signaler: 500 vaut injoignable', async () => {
  const chercher = fauxFetch([{ statut: 500 }]);
  const c = creerCanal({ base: BASE, chercher });
  assert.strictEqual((await c.signaler('CLE', {})).etat, 'injoignable');
});

test('signaler ne leve jamais, meme si fetch explose', async () => {
  const chercher = fauxFetch([new Error('reseau mort')]);
  const c = creerCanal({ base: BASE, chercher });
  const r = await c.signaler('CLE', {});
  assert.strictEqual(r.etat, 'injoignable');
  assert.match(r.raison, /reseau mort/);
});
