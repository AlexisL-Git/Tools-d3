'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { construireVue } = require('../src/comptes/vue');

const COMPTES = [
  { id: 1, nickname: 'BrokenLegs', isMain: true },
  { id: 2, nickname: 'squeezie', isMain: false },
  { id: 3, nickname: 'yoplait', isMain: false },
];

function vue(extra = {}) {
  return construireVue({
    comptes: COMPTES,
    clients: [],
    intercepte: new Set(),
    maitre: null,
    exclus: new Set(),
    favoris: new Set(),
    ...extra,
  });
}

// --- etat « erreur » -------------------------------------------------------

// Un client dont l'attache a echoue ne suivra rien. L'afficher comme
// intercepte laisserait l'utilisateur attendre un rejeu qui n'arrivera pas.
test('un client dont l attache a échoué est en erreur, pas intercepté', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set(),
    erreurs: new Map([[100, 'attache impossible : process not found']]),
  }).find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'erreur');
  assert.strictEqual(l.message, 'attache impossible : process not found');
  assert.strictEqual(l.suivi, false);
});

test('l erreur prime sur l interception', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set([100]),
    erreurs: new Map([[100, 'agent en échec']]),
  }).find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'erreur');
});

// --- message par ligne -----------------------------------------------------

// La raison rendue par rejouer() doit pouvoir s'afficher: sinon un compte qui
// ne rejoue pas est indiscernable d'un compte inactif.
test('le message de rejeu est reporté sur la ligne du compte', () => {
  const lignes = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set([100]),
    messages: new Map([[100, "InteractiveUseRequest : manque skillInstanceUid pour l'élément 4198401"]]),
  });
  const l = lignes.find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'intercepte');
  assert.strictEqual(l.message, "InteractiveUseRequest : manque skillInstanceUid pour l'élément 4198401");
  assert.strictEqual(lignes.find((x) => x.id === 1).message, null);
});

test('sans message ni erreur la ligne porte message null', () => {
  for (const l of vue()) assert.strictEqual(l.message, null);
});

// --- compte absent de la liste du launcher ---------------------------------

// Cas reel: un compte ajoute dans Zaap apres le demarrage. La liste n'etant
// lue qu'une fois, son client est attache et rejoue tout en n'ayant aucune
// ligne — donc aucun moyen de l'exclure.
test('un client dont le compte est absent de la liste apparaît quand même', () => {
  const lignes = vue({
    clients: [{ pid: 500, idCompte: 42, personnage: 'Tardif', classe: 'Eniripsa' }],
    intercepte: new Set([500]),
  });
  assert.strictEqual(lignes.length, 4);
  const l = lignes[lignes.length - 1];
  assert.strictEqual(l.etat, 'inconnu');
  assert.strictEqual(l.pid, 500);
  assert.strictEqual(l.personnage, 'Tardif');
  // L'identifiant de compte est connu: la ligne reste actionnable.
  assert.strictEqual(l.id, 42);
  assert.strictEqual(l.suivi, true);
});

test('un compte absent de la liste peut être exclu et mis en favori', () => {
  const l = vue({
    clients: [{ pid: 500, idCompte: 42, personnage: 'Tardif', classe: 'Eniripsa' }],
    intercepte: new Set([500]),
    exclus: new Set([42]),
    favoris: new Set([42]),
  }).pop();
  assert.strictEqual(l.exclu, true);
  assert.strictEqual(l.favori, true);
});

test('un client au compte absent de la liste remonte aussi ses erreurs', () => {
  const l = vue({
    clients: [{ pid: 500, idCompte: 42, personnage: null, classe: null }],
    erreurs: new Map([[500, 'attache impossible : accès refusé']]),
  }).pop();
  assert.strictEqual(l.etat, 'erreur');
  assert.strictEqual(l.message, 'attache impossible : accès refusé');
});

// Deux clients pour un meme compte: le second ne doit pas disparaitre non plus.
test('un second client sur le même compte reste visible', () => {
  const lignes = vue({
    clients: [
      { pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' },
      { pid: 101, idCompte: 2, personnage: 'Doublon', classe: 'Cra' },
    ],
    intercepte: new Set([100, 101]),
  });
  assert.strictEqual(lignes.length, 4);
  assert.strictEqual(lignes[lignes.length - 1].pid, 101);
});

test('un compte sans client est hors ligne', () => {
  const lignes = vue();
  assert.strictEqual(lignes.length, 3);
  for (const l of lignes) {
    assert.strictEqual(l.etat, 'hors-ligne');
    assert.strictEqual(l.pid, null);
    assert.strictEqual(l.personnage, null);
  }
});

test('un client pris en charge est intercepté', () => {
  const lignes = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set([100]),
  });
  const l = lignes.find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'intercepte');
  assert.strictEqual(l.pid, 100);
  assert.strictEqual(l.personnage, 'Swaggman');
  assert.strictEqual(l.classe, 'Cra');
});

// Un client lance avant l'application s'est connecte hors du proxy: sa session
// est irrattrapable. L'interface doit le dire, pas le presenter comme normal.
test('un client lancé avant l application est signalé non intercepté', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set(),
  }).find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'non-intercepte');
});

test('le maître est marqué', () => {
  const lignes = vue({
    clients: [
      { pid: 100, idCompte: 1, personnage: 'Spoony', classe: 'Pandawa' },
      { pid: 200, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' },
    ],
    intercepte: new Set([100, 200]),
    maitre: 200,
  });
  assert.strictEqual(lignes.find((x) => x.id === 1).estMaitre, false);
  assert.strictEqual(lignes.find((x) => x.id === 2).estMaitre, true);
});

test('favoris et exclusions sont reportés', () => {
  const lignes = vue({ favoris: new Set([1, 3]), exclus: new Set([3]) });
  assert.strictEqual(lignes.find((x) => x.id === 1).favori, true);
  assert.strictEqual(lignes.find((x) => x.id === 1).exclu, false);
  assert.strictEqual(lignes.find((x) => x.id === 3).favori, true);
  assert.strictEqual(lignes.find((x) => x.id === 3).exclu, true);
});

// Un client dont le compte n'est pas dans Zaap ne doit pas disparaitre en
// silence: on le montre a part.
test('un client sans compte connu apparaît quand même', () => {
  const lignes = vue({
    clients: [{ pid: 999, idCompte: null, personnage: 'Inconnu', classe: 'Iop' }],
    intercepte: new Set([999]),
  });
  assert.strictEqual(lignes.length, 4);
  const l = lignes[lignes.length - 1];
  assert.strictEqual(l.etat, 'inconnu');
  assert.strictEqual(l.pid, 999);
  assert.strictEqual(l.personnage, 'Inconnu');
});

test('huit comptes en jeu sont tous rendus', () => {
  const comptes = [];
  const clients = [];
  const intercepte = new Set();
  for (let i = 1; i <= 8; i++) {
    comptes.push({ id: i, nickname: `c${i}`, isMain: i === 1 });
    clients.push({ pid: 100 + i, idCompte: i, personnage: `p${i}`, classe: 'Iop' });
    intercepte.add(100 + i);
  }
  const lignes = construireVue({
    comptes, clients, intercepte, maitre: 103,
    exclus: new Set(), favoris: new Set(),
  });
  assert.strictEqual(lignes.length, 8);
  assert.strictEqual(lignes.filter((l) => l.etat === 'intercepte').length, 8);
  assert.strictEqual(lignes.filter((l) => l.estMaitre).length, 1);
});
