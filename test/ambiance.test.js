'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerAmbiance } = require('../src/ambiance');

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
