'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  creerGardeHdv, estClicInteractif, PLANCHER_HDV_MS, FENETRE_MS,
} = require('../src/garde-hdv');
const { DELAI_PLANCHER_MS } = require('../src/garde-combat');

// Mesure du 09/09 (journal-bug-0909.log): le clic sur l'etal a 139461 ms,
// l'interface a 139493 ms. 32 ms. Le plancher doit couvrir ca largement, sinon
// le rejeu part avant qu'on ait pu l'annuler.
test('le plancher couvre le delai mesure de la reponse', () => {
  assert.ok(PLANCHER_HDV_MS >= 250, `plancher=${PLANCHER_HDV_MS} : trop court pour annuler a temps`);
  assert.strictEqual(PLANCHER_HDV_MS, DELAI_PLANCHER_MS, 'meme plancher que le garde-combat');
  assert.ok(FENETRE_MS > PLANCHER_HDV_MS);
});

test('iva est le seul type retarde par ce garde', () => {
  assert.strictEqual(estClicInteractif('iva'), true);
  assert.strictEqual(estClicInteractif('imp'), false);
  assert.strictEqual(estClicInteractif('hiu'), false);
});

function faux() {
  let annules = 3;
  return {
    appels: 0,
    annulerRejeux() { this.appels += 1; return annules; },
    videLesRejeux() { annules = 0; },
  };
}

const clic = () => ({ kind: 'request', type: 'iva', payload: [{ no: 1, value: 519826n }, { no: 5, value: 11411n }] });
const interface_ = () => ({ kind: 'event', type: 'isb', payload: [{ no: 1, value: 460654n }] });
const autre = () => ({ kind: 'event', type: 'ivf', payload: [{ no: 2, value: 519826n }] });

function horloge() {
  let t = 0;
  return { maintenant: () => t, avancer: (ms) => { t += ms; } };
}

test('le clic puis l interface annulent les rejeux en attente', () => {
  const sup = faux();
  const h = horloge();
  const rendus = [];
  const garde = creerGardeHdv({ superviseur: sup, maintenant: h.maintenant, onCompteRendu: (r) => rendus.push(r) });

  garde({ pid: 1, dir: 'out', frame: clic(), estMaitre: true });
  h.avancer(32);
  garde({ pid: 1, dir: 'in', frame: interface_(), estMaitre: true });

  assert.strictEqual(sup.appels, 1);
  assert.deepStrictEqual(rendus, [{ pidMaitre: 1, annules: 3 }]);
});

// Un zaap, une porte: le meme clic, mais rien ne redescend qui ressemble a un
// etal. Les mules doivent suivre.
test('un clic sans interface d hotel de vente n annule rien', () => {
  const sup = faux();
  const h = horloge();
  const garde = creerGardeHdv({ superviseur: sup, maintenant: h.maintenant });

  garde({ pid: 1, dir: 'out', frame: clic(), estMaitre: true });
  h.avancer(32);
  garde({ pid: 1, dir: 'in', frame: autre(), estMaitre: true });

  assert.strictEqual(sup.appels, 0);
});

test('une interface qui arrive trop tard n annule rien', () => {
  const sup = faux();
  const h = horloge();
  const garde = creerGardeHdv({ superviseur: sup, maintenant: h.maintenant });

  garde({ pid: 1, dir: 'out', frame: clic(), estMaitre: true });
  h.avancer(FENETRE_MS + 1);
  garde({ pid: 1, dir: 'in', frame: interface_(), estMaitre: true });

  assert.strictEqual(sup.appels, 0);
});

// Le serveur envoie plusieurs isb quand l'etal est gros. Le premier consomme le
// clic; les suivants ne doivent pas annuler une action sans rapport.
test('le clic n est consomme qu une fois', () => {
  const sup = faux();
  const h = horloge();
  const garde = creerGardeHdv({ superviseur: sup, maintenant: h.maintenant });

  garde({ pid: 1, dir: 'out', frame: clic(), estMaitre: true });
  garde({ pid: 1, dir: 'in', frame: interface_(), estMaitre: true });
  garde({ pid: 1, dir: 'in', frame: interface_(), estMaitre: true });

  assert.strictEqual(sup.appels, 1);
});

// Une MULE qui ouvre son hotel de vente a la main ne doit pas annuler les
// rejeux du maitre.
test('seul le maitre arme et declenche', () => {
  const sup = faux();
  const h = horloge();
  const garde = creerGardeHdv({ superviseur: sup, maintenant: h.maintenant });

  garde({ pid: 2, dir: 'out', frame: clic(), estMaitre: false });
  garde({ pid: 2, dir: 'in', frame: interface_(), estMaitre: false });

  assert.strictEqual(sup.appels, 0);
});

test('rien a annuler ne produit aucun compte rendu', () => {
  const sup = faux();
  sup.videLesRejeux();
  const h = horloge();
  const rendus = [];
  const garde = creerGardeHdv({ superviseur: sup, maintenant: h.maintenant, onCompteRendu: (r) => rendus.push(r) });

  garde({ pid: 1, dir: 'out', frame: clic(), estMaitre: true });
  garde({ pid: 1, dir: 'in', frame: interface_(), estMaitre: true });

  assert.deepStrictEqual(rendus, []);
});
