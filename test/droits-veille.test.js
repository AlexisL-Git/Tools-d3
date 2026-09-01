'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerVeille } = require('../src/droits/veille');
const { NOMS } = require('../src/droits/liste');

function fauxCache(depart = null) {
  let valeur = depart;
  return { lire: () => valeur, ecrire: (v) => { valeur = v; }, valeur: () => valeur };
}

// Un faux planifier qui retient le rappel au lieu de dormir.
function fauxTemps() {
  const rappels = [];
  return {
    planifier: (fn) => { rappels.push(fn); return rappels.length; },
    arreterMinuteur: () => {},
    tic: async () => { const fn = rappels.pop(); if (fn) await fn(); },
  };
}

function reponse(statut, corps) {
  return Promise.resolve({ status: statut, ok: statut === 200, json: async () => corps });
}

test('sans cle (mode developpement), tous les droits et aucune requete', async () => {
  let appels = 0;
  const v = creerVeille({
    base: 'https://x', lireCle: () => null, cache: fauxCache(),
    chercher: () => { appels += 1; return reponse(200, { droits: [] }); },
    ...fauxTemps(),
  });
  await v.demarrer();
  assert.deepStrictEqual(v.droits(), NOMS);
  assert.strictEqual(appels, 0, 'le depot ne doit jamais interroger le service');
});

test('au demarrage, le cache est applique avant toute reponse', async () => {
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(['songe']),
    chercher: () => new Promise(() => {}), // jamais resolue
    ...fauxTemps(),
  });
  v.demarrer();
  assert.deepStrictEqual(v.droits(), ['songe']);
});

test('sans cache, aucun droit: ferme par defaut', () => {
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => new Promise(() => {}), ...fauxTemps(),
  });
  v.demarrer();
  assert.deepStrictEqual(v.droits(), []);
});

test('une reponse 200 applique la liste et ecrit le cache', async () => {
  const cache = fauxCache(null);
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache,
    chercher: () => reponse(200, { droits: ['hdv', 'songe'] }), ...fauxTemps(),
  });
  await v.demarrer();
  assert.deepStrictEqual(v.droits(), ['hdv', 'songe']);
  assert.deepStrictEqual(cache.valeur(), ['hdv', 'songe']);
});

test('une fonction inconnue du serveur est ignoree', async () => {
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => reponse(200, { droits: ['hdv', 'teleportation'] }), ...fauxTemps(),
  });
  await v.demarrer();
  assert.deepStrictEqual(v.droits(), ['hdv']);
});

test('INJOIGNABLE NE RETIRE RIEN', async () => {
  // Le test qui compte. Confondre une coupure de reseau et une revocation
  // retirerait ses fonctions a tout le monde des que Vercel eternue.
  const t = fauxTemps();
  let tour = 0;
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => { tour += 1; return tour === 1 ? reponse(200, { droits: ['hdv'] }) : Promise.reject(new Error('ECONNRESET')); },
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
  });
  await v.demarrer();
  assert.deepStrictEqual(v.droits(), ['hdv']);
  await t.tic();
  assert.deepStrictEqual(v.droits(), ['hdv'], 'un incident reseau ne revoque personne');
});

test('un 404 fait tout tomber', async () => {
  const t = fauxTemps();
  let tour = 0;
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => { tour += 1; return tour === 1 ? reponse(200, { droits: ['hdv'] }) : reponse(404, null); },
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
  });
  await v.demarrer();
  await t.tic();
  assert.deepStrictEqual(v.droits(), []);
});

test('onChangement dit ce qui est gagne et ce qui est perdu', async () => {
  const t = fauxTemps();
  const vus = [];
  let tour = 0;
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => { tour += 1; return reponse(200, { droits: tour === 1 ? ['hdv', 'songe'] : ['songe'] }); },
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
    onChangement: (c) => vus.push(c),
  });
  await v.demarrer();
  await t.tic();
  assert.deepStrictEqual(vus[0].gagnes, ['hdv', 'songe']);
  assert.deepStrictEqual(vus[1].perdus, ['hdv']);
});

test('sans changement, onChangement ne dit rien', async () => {
  const t = fauxTemps();
  const vus = [];
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => reponse(200, { droits: ['hdv'] }),
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
    onChangement: (c) => vus.push(c),
  });
  await v.demarrer();
  await t.tic();
  assert.strictEqual(vus.length, 1, 'un seul evenement: le premier');
});
