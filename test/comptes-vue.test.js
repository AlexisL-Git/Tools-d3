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

// --- attache != interception ----------------------------------------------
//
// Le faux positif reproduit le 22/08: un client lance a 13:09, l'application a
// 14:27. L'agent s'injecte quand meme (il detourne `connect` pour les
// connexions A VENIR), donc l'ancien code le comptait comme intercepte et
// affichait « suit ». Sa session de jeu, elle, etait ouverte hors du proxy:
// rien ne pouvait etre rejoue. Seule une trame decodee le prouve.

test('un client attaché mais sans trafic observé n est pas intercepté', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set(),
    enAttente: new Set(),
  }).find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'non-intercepte');
  assert.strictEqual(l.suivi, false);
  assert.strictEqual(l.pilotable, false);
});

// Sans fenetre de grace, un client tout juste lance s'afficherait « relance ce
// client » pendant la seconde qui separe l'attache de sa premiere trame — un
// faux negatif a la place d'un faux positif.
test('un client attaché depuis peu, sans trafic encore, est en attente', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set(),
    enAttente: new Set([100]),
  }).find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'en-attente');
  // Rien n'est prouve: il ne compte pas parmi les comptes en jeu...
  assert.strictEqual(l.suivi, false);
  // ...mais son agent est en place, donc ses interrupteurs ont un sens.
  assert.strictEqual(l.pilotable, true);
});

test('une trame observée prime sur l attente', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set([100]),
    enAttente: new Set([100]),
  }).find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'intercepte');
  assert.strictEqual(l.suivi, true);
  assert.strictEqual(l.pilotable, true);
});

test('l erreur prime sur l attente', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    enAttente: new Set([100]),
    erreurs: new Map([[100, 'attache impossible : accès refusé']]),
  }).find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'erreur');
  assert.strictEqual(l.pilotable, false);
});

// Meme piege que passeTour/invitation/noAnim, rencontre trois fois: un champ
// code en dur dans les lignes de repli. Toutes les lignes y passent si
// lireComptes() echoue.
test('un client au compte absent de la liste porte aussi son attente', () => {
  const l = vue({
    clients: [{ pid: 500, idCompte: 42, personnage: 'Tardif', classe: 'Eniripsa' }],
    intercepte: new Set(),
    enAttente: new Set([500]),
  }).pop();
  assert.strictEqual(l.id, 42);
  assert.strictEqual(l.etat, 'en-attente');
  assert.strictEqual(l.suivi, false);
  assert.strictEqual(l.pilotable, true);
});

test('un compte hors ligne n est ni suivi ni pilotable', () => {
  for (const l of vue()) {
    assert.strictEqual(l.suivi, false);
    assert.strictEqual(l.pilotable, false);
  }
});

test('l absence d enAttente ne casse pas la vue', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set([100]),
  }).find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'intercepte');
  assert.strictEqual(l.pilotable, true);
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

test('la ligne porte l etat du passe-tour', () => {
  const lignes = construireVue({
    comptes: COMPTES,
    clients: [],
    intercepte: new Set(),
    maitre: null,
    exclus: new Set(),
    favoris: new Set(),
    passeTour: new Set([2]),
  });
  assert.strictEqual(lignes.find((l) => l.id === 1).passeTour, false);
  assert.strictEqual(lignes.find((l) => l.id === 2).passeTour, true);
});

// Un client dont le compte est inconnu de Zaap tombe dans les lignes de repli.
// Un passeTour code en dur a faux y rendait la case eteinte alors que le
// compte emettait: aucun interrupteur pour l'arreter. Cas declencheur banal —
// si lireComptes() echoue, toutes les lignes passent par ce repli.
test('un client au compte absent de la liste porte quand même son passe-tour', () => {
  const l = construireVue({
    comptes: COMPTES,
    clients: [{ pid: 500, idCompte: 42, personnage: 'Tardif', classe: 'Eniripsa' }],
    intercepte: new Set([500]),
    maitre: null,
    exclus: new Set(),
    favoris: new Set(),
    passeTour: new Set([42]),
  }).pop();
  assert.strictEqual(l.id, 42);
  assert.strictEqual(l.etat, 'inconnu');
  assert.strictEqual(l.passeTour, true);
});

// Sans idCompte, il n'y a rien a interroger: la ligne reste informative.
test('un client sans idCompte ne porte pas de passe-tour', () => {
  const l = construireVue({
    comptes: COMPTES,
    clients: [{ pid: 999, idCompte: null, personnage: 'Inconnu', classe: 'Iop' }],
    intercepte: new Set([999]),
    maitre: null,
    exclus: new Set(),
    favoris: new Set(),
    passeTour: new Set([42]),
  }).pop();
  assert.strictEqual(l.passeTour, false);
});

test('l absence de passeTour ne casse pas la vue', () => {
  const lignes = construireVue({
    comptes: COMPTES, clients: [], intercepte: new Set(),
    maitre: null, exclus: new Set(), favoris: new Set(),
  });
  assert.strictEqual(lignes[0].passeTour, false);
});

test('l invitation remonte sur la ligne du compte', () => {
  const lignes = vue({ invitation: new Set([2]) });
  assert.strictEqual(lignes.find((l) => l.id === 1).invitation, false);
  assert.strictEqual(lignes.find((l) => l.id === 2).invitation, true);
});

// Meme piege que pour passeTour: code en dur a faux, la case s'affichait
// eteinte alors que le compte acceptait, donc impossible a debrayer. Toutes
// les lignes passent par ce repli si lireComptes() echoue.
test('l invitation remonte aussi sur un client sans ligne de compte', () => {
  const l = construireVue({
    comptes: COMPTES,
    clients: [{ pid: 500, idCompte: 42, personnage: 'Tardif', classe: 'Eniripsa' }],
    intercepte: new Set([500]),
    maitre: null,
    exclus: new Set(),
    favoris: new Set(),
    invitation: new Set([42]),
  }).pop();
  assert.strictEqual(l.id, 42);
  assert.strictEqual(l.invitation, true);
});

// Sans idCompte, il n'y a rien a interroger: la ligne reste informative.
test('un client sans idCompte ne porte pas d invitation', () => {
  const l = construireVue({
    comptes: COMPTES,
    clients: [{ pid: 999, idCompte: null, personnage: 'Inconnu', classe: 'Iop' }],
    intercepte: new Set([999]),
    maitre: null,
    exclus: new Set(),
    favoris: new Set(),
    invitation: new Set([42]),
  }).pop();
  assert.strictEqual(l.invitation, false);
});

test('l absence d invitation ne casse pas la vue', () => {
  const lignes = vue();
  assert.strictEqual(lignes[0].invitation, false);
});

test('le no-anim remonte sur la ligne du compte', () => {
  const lignes = vue({ noAnim: new Set([2]) });
  assert.strictEqual(lignes.find((l) => l.id === 1).noAnim, false);
  assert.strictEqual(lignes.find((l) => l.id === 2).noAnim, true);
});

// Meme piege que pour passeTour et invitation, rencontre deux fois: code en
// dur a faux, la case s'affichait eteinte alors que la fonction agissait.
test('le no-anim remonte aussi sur un client sans ligne de compte', () => {
  const l = construireVue({
    comptes: COMPTES,
    clients: [{ pid: 500, idCompte: 42, personnage: 'Tardif', classe: 'Eniripsa' }],
    intercepte: new Set([500]),
    maitre: null,
    exclus: new Set(),
    favoris: new Set(),
    noAnim: new Set([42]),
  }).pop();
  assert.strictEqual(l.id, 42);
  assert.strictEqual(l.noAnim, true);
});

test('l absence de noAnim ne casse pas la vue', () => {
  const lignes = vue();
  assert.strictEqual(lignes[0].noAnim, false);
});

test('l echange remonte sur la ligne du compte', () => {
  const lignes = vue({ echange: new Set([2]) });
  assert.strictEqual(lignes.find((l) => l.id === 1).echange, false);
  assert.strictEqual(lignes.find((l) => l.id === 2).echange, true);
});

// Meme piege que passeTour, invitation et noAnim, rencontre trois fois: code
// en dur a faux, la case s'affiche eteinte alors que la fonction agit.
test('l echange remonte aussi sur un client sans ligne de compte', () => {
  const l = vue({
    clients: [{ pid: 500, idCompte: 42, personnage: 'Tardif', classe: 'Eniripsa' }],
    intercepte: new Set([500]),
    echange: new Set([42]),
  }).pop();
  assert.strictEqual(l.id, 42);
  assert.strictEqual(l.echange, true);
});

test('l absence d echange ne casse pas la vue', () => {
  assert.strictEqual(vue()[0].echange, false);
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

// --- eligibilite au role de maitre -----------------------------------------

// Un maitre doit EMETTRE des trames, sinon il n'y a rien a repliquer. La
// preuve de trafic est donc exigee, la ou les interrupteurs se contentent de
// `pilotable` — eux ne font que se preparer.
test('un compte intercepté est éligible au rôle de maître', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set([100]),
  }).find((x) => x.id === 2);
  assert.strictEqual(l.eligibleMaitre, true);
});

test('un compte hors ligne n est pas éligible', () => {
  const l = vue({}).find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'hors-ligne');
  assert.strictEqual(l.eligibleMaitre, false);
});

// La fenetre d'attente suffit a piloter, pas a commander: avant la premiere
// trame il n'y a par construction aucune action a dupliquer.
test('un compte en attente de trafic n est pas encore éligible', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set(),
    enAttente: new Set([100]),
  }).find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'en-attente');
  assert.strictEqual(l.pilotable, true);
  assert.strictEqual(l.eligibleMaitre, false);
});

test('un compte non intercepté n est pas éligible', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set(),
  }).find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'non-intercepte');
  assert.strictEqual(l.eligibleMaitre, false);
});

// L'erreur prime sur tout le reste, y compris sur une preuve de trafic.
test('un compte en erreur n est pas éligible même avec du trafic', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set([100]),
    erreurs: new Map([[100, 'agent en échec']]),
  }).find((x) => x.id === 2);
  assert.strictEqual(l.eligibleMaitre, false);
});

// Le choix est memorise PAR IDENTIFIANT DE COMPTE: un client sans identifiant
// ne survivrait pas au redemarrage, donc on ne lui propose pas le geste.
test('un client sans identifiant de compte n est pas éligible', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: null, personnage: null, classe: null }],
    intercepte: new Set([100]),
  }).find((x) => x.pid === 100);
  assert.strictEqual(l.id, null);
  assert.strictEqual(l.suivi, true);
  assert.strictEqual(l.eligibleMaitre, false);
});

// Un client qui passe par le proxy mais dont le compte est absent de la liste
// Zaap reste parfaitement pilotable, et commandable: il a un identifiant.
test('un compte inconnu de Zaap reste éligible', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: 4242, personnage: 'Ombre', classe: 'Sram' }],
    intercepte: new Set([100]),
  }).find((x) => x.pid === 100);
  assert.strictEqual(l.etat, 'inconnu');
  assert.strictEqual(l.eligibleMaitre, true);
});
