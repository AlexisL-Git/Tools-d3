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

test('demarrer() appele deux fois ne dedouble pas la boucle', async () => {
  const t = fauxTemps();
  let appels = 0;
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => { appels += 1; return reponse(200, { droits: ['hdv'] }); },
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
  });
  await v.demarrer();
  await v.demarrer();
  assert.strictEqual(appels, 1, 'un second demarrer() ne doit pas relancer une chaine de plus');
  v.arreter();
  await t.tic();
  assert.strictEqual(appels, 1, 'apres arreter(), plus aucune chaine ne doit encore interroger');
});

test('une exception dans onChangement est signalee, pas avalee, et la boucle continue', async () => {
  const t = fauxTemps();
  let tour = 0;
  const journal = [];
  const original = console.error;
  console.error = (...a) => journal.push(a);
  try {
    const v = creerVeille({
      base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
      chercher: () => {
        tour += 1;
        const droits = tour === 1 ? ['hdv'] : tour === 2 ? ['hdv', 'songe'] : ['songe'];
        return reponse(200, { droits });
      },
      planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
      onChangement: () => { throw new Error('boum'); },
    });
    await v.demarrer();
    await t.tic(); // tour 2: hdv+songe, onChangement leve
    assert.deepStrictEqual(v.droits(), ['hdv', 'songe'], 'l etat progresse malgre l exception');
    assert.ok(journal.length >= 1, 'l exception doit etre signalee, pas avalee en silence');
    await t.tic(); // tour 3: la boucle doit encore tourner apres l exception
    assert.deepStrictEqual(v.droits(), ['songe'], 'une exception dans onChangement ne tue pas la boucle');
  } finally {
    console.error = original;
  }
});

test('un 200 sans tableau droits est un incident, pas une revocation', async () => {
  const t = fauxTemps();
  let tour = 0;
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => { tour += 1; return tour === 1 ? reponse(200, { droits: ['hdv'] }) : reponse(200, {}); },
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
  });
  await v.demarrer();
  assert.deepStrictEqual(v.droits(), ['hdv']);
  await t.tic();
  assert.deepStrictEqual(v.droits(), ['hdv'], 'un 200 sans droits ne revoque personne');
});

test('un corps illisible (json() qui rejette) ne change rien', async () => {
  const t = fauxTemps();
  let tour = 0;
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => {
      tour += 1;
      if (tour === 1) return reponse(200, { droits: ['hdv'] });
      return Promise.resolve({ status: 200, ok: true, json: async () => { throw new Error('json casse'); } });
    },
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
  });
  await v.demarrer();
  await t.tic();
  assert.deepStrictEqual(v.droits(), ['hdv'], 'un corps illisible ne revoque personne');
});

test('un 500 ne change rien', async () => {
  const t = fauxTemps();
  let tour = 0;
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => { tour += 1; return tour === 1 ? reponse(200, { droits: ['hdv'] }) : reponse(500, null); },
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
  });
  await v.demarrer();
  await t.tic();
  assert.deepStrictEqual(v.droits(), ['hdv'], 'un 500 chez nous n est pas une revocation');
});
