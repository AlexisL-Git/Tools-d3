'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { creerVeille, creerCacheFichier } = require('../src/droits/veille');
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

// Content-Type JSON par defaut: c est ce que pose serveur-maj/api/droits.js,
// meme sur son 404. Un test qui veut simuler la page d erreur HTML d une
// route pas encore deployee passe `entetes: {}`.
function reponse(statut, corps, entetes = { 'content-type': 'application/json; charset=utf-8' }) {
  return Promise.resolve({
    status: statut,
    ok: statut === 200,
    json: async () => corps,
    headers: { get: (nom) => entetes[nom.toLowerCase()] ?? null },
  });
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

test('un 404 sans Content-Type JSON n est pas une revocation, juste injoignable', async () => {
  // Vercel rend 404 pour une cle revoquee ET pour une route qui n existe pas
  // encore (version publiee avant `npx vercel --prod`). Sans ce garde-fou,
  // publier la version avant de deployer le serveur retirerait ses sept
  // fonctions a tout le monde dans la minute.
  const t = fauxTemps();
  let tour = 0;
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => {
      tour += 1;
      return tour === 1 ? reponse(200, { droits: ['hdv'] }) : reponse(404, null, {});
    },
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
  });
  await v.demarrer();
  await t.tic();
  assert.deepStrictEqual(v.droits(), ['hdv'], 'un 404 HTML de plateforme ne revoque personne');
});

test('un 404 JSON revoque toujours (regression)', async () => {
  const t = fauxTemps();
  let tour = 0;
  const cache = fauxCache(null);
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache,
    chercher: () => { tour += 1; return tour === 1 ? reponse(200, { droits: ['hdv'] }) : reponse(404, null); },
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
  });
  await v.demarrer();
  await t.tic();
  assert.deepStrictEqual(v.droits(), [], 'un vrai 404 JSON de notre route revoque bien tout');
  assert.deepStrictEqual(cache.valeur(), []);
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
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => {
      tour += 1;
      const droits = tour === 1 ? ['hdv'] : tour === 2 ? ['hdv', 'songe'] : ['songe'];
      return reponse(200, { droits });
    },
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
    onChangement: () => { throw new Error('boum'); },
    // On espionne le rappel injecte, pas console.error: lance par le vbs,
    // OMNI n a pas de console attachee, donc c est ce rappel -- pas la
    // console -- qui porte le signalement en production.
    onJournal: (...a) => journal.push(a),
  });
  await v.demarrer();
  await t.tic(); // tour 2: hdv+songe, onChangement leve
  assert.deepStrictEqual(v.droits(), ['hdv', 'songe'], 'l etat progresse malgre l exception');
  assert.ok(journal.length >= 1, 'l exception doit etre signalee, pas avalee en silence');
  await t.tic(); // tour 3: la boucle doit encore tourner apres l exception
  assert.deepStrictEqual(v.droits(), ['songe'], 'une exception dans onChangement ne tue pas la boucle');
});

test('sans onJournal fourni, console.error recoit le signalement par defaut', async () => {
  const t = fauxTemps();
  let tour = 0;
  const appels = [];
  const original = console.error;
  console.error = (...a) => appels.push(a);
  try {
    const v = creerVeille({
      base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
      chercher: () => {
        tour += 1;
        return reponse(200, { droits: tour === 1 ? ['hdv'] : ['songe'] });
      },
      planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
      onChangement: () => { throw new Error('boum'); },
    });
    await v.demarrer();
    await t.tic();
    assert.ok(appels.length >= 1, 'console.error reste le defaut hors production');
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

test('creerCacheFichier.ecrire signale un echec permanent une seule fois, pas a chaque tentative', (t) => {
  // Le dossier parent vise est en fait un fichier: mkdirSync et writeFileSync
  // echouent tous les deux, de facon fiable sur toutes les plateformes (meme
  // motif que comptes-favoris.test.js).
  const fauxDossier = path.join(os.tmpdir(), `droits-cache-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(fauxDossier, 'je suis un fichier, pas un dossier');
  t.after(() => { try { fs.unlinkSync(fauxDossier); } catch (e) {} });

  const appels = [];
  const cache = creerCacheFichier(path.join(fauxDossier, 'droits.json'), { onJournal: (...a) => appels.push(a) });
  cache.ecrire(['hdv']);
  cache.ecrire(['hdv']);
  cache.ecrire(['songe']);
  assert.strictEqual(appels.length, 1, 'une panne qui ne se rattrape jamais ne doit etre dite qu une fois');
});

test('creerCacheFichier.ecrire ne signale rien quand l ecriture reussit', () => {
  const p = path.join(os.tmpdir(), `droits-cache-ok-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const appels = [];
  const cache = creerCacheFichier(p, { onJournal: (...a) => appels.push(a) });
  try {
    cache.ecrire(['hdv']);
    assert.strictEqual(appels.length, 0);
    assert.deepStrictEqual(cache.lire(), ['hdv']);
  } finally {
    try { fs.unlinkSync(p); } catch (e) {}
  }
});

test('creerCacheFichier.ecrire sans onJournal fourni retombe sur console.error', () => {
  const fauxDossier = path.join(os.tmpdir(), `droits-cache-defaut-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(fauxDossier, 'je suis un fichier, pas un dossier');
  const appels = [];
  const original = console.error;
  console.error = (...a) => appels.push(a);
  try {
    const cache = creerCacheFichier(path.join(fauxDossier, 'droits.json'));
    cache.ecrire(['hdv']);
    assert.strictEqual(appels.length, 1);
  } finally {
    console.error = original;
    try { fs.unlinkSync(fauxDossier); } catch (e) {}
  }
});
