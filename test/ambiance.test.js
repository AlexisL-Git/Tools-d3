'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerAmbiance, bornes } = require('../src/ambiance');

// Une fausse minuterie: elle retient le rappel et le delai au lieu de dormir.
// Meme procede que test/droits-veille.test.js.
function fauxTemps() {
  let suivant = 1;
  const enAttente = new Map();
  return {
    planifier: (fn, ms) => { const j = suivant++; enAttente.set(j, { fn, ms }); return j; },
    arreter: (j) => { enAttente.delete(j); },
    delais: () => [...enAttente.values()].map((e) => e.ms),
    nombre: () => enAttente.size,
    // Declenche l'unique rappel en attente.
    echoir: () => {
      assert.strictEqual(enAttente.size, 1, 'un seul rappel doit etre en attente');
      const [j, e] = [...enAttente.entries()][0];
      enAttente.delete(j);
      e.fn();
    },
  };
}

test('ambiance: le delai tombe sur la borne basse quand le tirage vaut 0', () => {
  const t = fauxTemps();
  const a = creerAmbiance({
    jouer: () => {}, minMs: 1000, maxMs: 5000,
    planifier: t.planifier, arreter: t.arreter, tirage: () => 0,
  });
  a.demarrer();
  assert.deepStrictEqual(t.delais(), [1000]);
});

test('ambiance: le delai reste dans les bornes quand le tirage frole 1', () => {
  const t = fauxTemps();
  const a = creerAmbiance({
    jouer: () => {}, minMs: 1000, maxMs: 5000,
    planifier: t.planifier, arreter: t.arreter, tirage: () => 0.999999,
  });
  a.demarrer();
  const [d] = t.delais();
  assert.ok(d >= 1000 && d <= 5000, `delai hors bornes: ${d}`);
});

test('ambiance: jouer est appele a l echeance, et la minuterie se reprogramme', () => {
  const t = fauxTemps();
  let coups = 0;
  const a = creerAmbiance({
    jouer: () => { coups += 1; }, minMs: 1000, maxMs: 1000,
    planifier: t.planifier, arreter: t.arreter, tirage: () => 0,
  });
  a.demarrer();
  t.echoir();
  assert.strictEqual(coups, 1);
  assert.strictEqual(t.nombre(), 1, 'elle doit s etre reprogrammee');
  t.echoir();
  assert.strictEqual(coups, 2);
});

test('ambiance: demarrer deux fois ne lance qu une seule minuterie', () => {
  const t = fauxTemps();
  const a = creerAmbiance({
    jouer: () => {}, minMs: 1000, maxMs: 1000,
    planifier: t.planifier, arreter: t.arreter, tirage: () => 0,
  });
  a.demarrer();
  a.demarrer();
  assert.strictEqual(t.nombre(), 1);
});

test('ambiance: stopper annule le rappel en attente et jouer ne part plus', () => {
  const t = fauxTemps();
  let coups = 0;
  const a = creerAmbiance({
    jouer: () => { coups += 1; }, minMs: 1000, maxMs: 1000,
    planifier: t.planifier, arreter: t.arreter, tirage: () => 0,
  });
  a.demarrer();
  a.stopper();
  assert.strictEqual(t.nombre(), 0);
  assert.strictEqual(coups, 0);
  assert.strictEqual(a.enMarche(), false);
});

test('ambiance: stopper sans avoir demarre ne leve pas', () => {
  const t = fauxTemps();
  const a = creerAmbiance({
    jouer: () => {}, minMs: 1000, maxMs: 1000,
    planifier: t.planifier, arreter: t.arreter, tirage: () => 0,
  });
  a.stopper();
  a.stopper();
  assert.strictEqual(a.enMarche(), false);
});

test('ambiance: une erreur de jouer n arrete pas la minuterie', () => {
  const t = fauxTemps();
  const a = creerAmbiance({
    jouer: () => { throw new Error('la fenetre est partie'); },
    minMs: 1000, maxMs: 1000,
    planifier: t.planifier, arreter: t.arreter, tirage: () => 0,
  });
  a.demarrer();
  t.echoir();
  assert.strictEqual(t.nombre(), 1, 'elle doit s etre reprogrammee malgre l erreur');
});

test('ambiance: sans OMNI_AMBIANCE_MS, les bornes du code sont gardees', () => {
  assert.deepStrictEqual(bornes({ OMNI_DEV: 'F:/omni_project' }, 10, 20), [10, 20]);
  assert.deepStrictEqual(bornes({}, 10, 20), [10, 20]);
});

test('ambiance: OMNI_AMBIANCE_MS fixe les deux bornes en mode developpement', () => {
  assert.deepStrictEqual(
    bornes({ OMNI_DEV: 'F:/omni_project', OMNI_AMBIANCE_MS: '3000' }, 10, 20),
    [3000, 3000],
  );
});

test('ambiance: OMNI_AMBIANCE_MS est ignore chez un ami', () => {
  // Sans OMNI_DEV, c est un poste ami: il pourrait poser la variable lui-meme.
  assert.deepStrictEqual(bornes({ OMNI_AMBIANCE_MS: '3000' }, 10, 20), [10, 20]);
});

test('ambiance: une valeur absurde de OMNI_AMBIANCE_MS ne casse rien', () => {
  const dev = { OMNI_DEV: 'F:/omni_project' };
  for (const v of ['', 'vite', '0', '-5', 'NaN']) {
    assert.deepStrictEqual(bornes({ ...dev, OMNI_AMBIANCE_MS: v }, 10, 20), [10, 20], `valeur: ${v}`);
  }
});

test('ambiance: une rafale de trois, puis le cycle suivant', () => {
  const t = fauxTemps();
  let coups = 0;
  const a = creerAmbiance({
    jouer: () => { coups += 1; },
    minMs: 20000, maxMs: 20000, rafale: 3, ecartMs: 2500,
    planifier: t.planifier, arreter: t.arreter, tirage: () => 0,
  });
  a.demarrer();
  assert.deepStrictEqual(t.delais(), [20000], 'le premier cycle attend l intervalle');

  t.echoir();                                   // premier coup
  assert.strictEqual(coups, 1);
  assert.deepStrictEqual(t.delais(), [2500], 'le deuxieme coup suit l ecart');

  t.echoir();                                   // deuxieme coup
  assert.strictEqual(coups, 2);
  assert.deepStrictEqual(t.delais(), [2500], 'le troisieme coup aussi');

  t.echoir();                                   // troisieme coup
  assert.strictEqual(coups, 3);
  assert.deepStrictEqual(t.delais(), [20000], 'la rafale finie, on repart pour un cycle');

  t.echoir();                                   // rafale suivante
  assert.strictEqual(coups, 4);
  assert.deepStrictEqual(t.delais(), [2500]);
});

test('ambiance: il n y a jamais plus d un minuteur en vol', () => {
  const t = fauxTemps();
  const a = creerAmbiance({
    jouer: () => {}, minMs: 20000, maxMs: 20000, rafale: 3, ecartMs: 2500,
    planifier: t.planifier, arreter: t.arreter, tirage: () => 0,
  });
  a.demarrer();
  for (let i = 0; i < 8; i += 1) {
    assert.strictEqual(t.nombre(), 1, `apres ${i} echeances`);
    t.echoir();
  }
});

test('ambiance: stopper au milieu d une rafale ne laisse rien derriere', () => {
  const t = fauxTemps();
  let coups = 0;
  const a = creerAmbiance({
    jouer: () => { coups += 1; },
    minMs: 20000, maxMs: 20000, rafale: 3, ecartMs: 2500,
    planifier: t.planifier, arreter: t.arreter, tirage: () => 0,
  });
  a.demarrer();
  t.echoir();                                   // premier coup de la rafale
  a.stopper();
  assert.strictEqual(t.nombre(), 0);
  assert.strictEqual(a.enMarche(), false);

  // Le droit revient: la rafale recommence entiere, elle ne reprend pas au
  // deuxieme coup.
  a.demarrer();
  assert.deepStrictEqual(t.delais(), [20000]);
  t.echoir();
  assert.strictEqual(coups, 2);
  assert.deepStrictEqual(t.delais(), [2500], 'deux coups restent a jouer');
});

test('ambiance: sans rafale precisee, un seul coup par cycle', () => {
  const t = fauxTemps();
  let coups = 0;
  const a = creerAmbiance({
    jouer: () => { coups += 1; }, minMs: 1000, maxMs: 1000,
    planifier: t.planifier, arreter: t.arreter, tirage: () => 0,
  });
  a.demarrer();
  t.echoir();
  assert.strictEqual(coups, 1);
  assert.deepStrictEqual(t.delais(), [1000], 'on repart directement pour un cycle');
});
