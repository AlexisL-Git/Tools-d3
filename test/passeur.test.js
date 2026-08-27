'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerPasseur, TRAME_PASSE } = require('../src/passeur');
const { decodeFrameRaw } = require('../src/codec/rawProto');

const MOI = 665809125670n;
const AUTRE = 677057659174n;
const MONSTRE = -1n;

function fauxSuperviseur(comptes = [[1, MOI]]) {
  const emis = [];
  const etats = new Map(comptes.map(([pid, id]) => [pid, { pid, passeTour: true, characterId: id }]));
  return {
    emis,
    etats,
    comptes: { get: (pid) => etats.get(pid) || null },
    emettre: (pid, octets) => { emis.push({ pid, octets }); return { ok: true, octets: octets.length + 1 }; },
  };
}

// jxh { 2: X } — DEBUT du tour de X. Mesure le 20/08 sur un combat a deux:
// l'autopasse de krm35 emettait sa passe 16 ms apres un jxh portant SON propre
// characterId, et le compteur jxz s'incrementait 100 ms plus tard. Quatre fois.
const debutDeTour = (id) => ({ kind: 'event', type: 'jxh', payload: [{ no: 2, value: id }] });
// jxz { 2: N } — compteur de tours du combat. Dans les combats mesures, le
// tour du joueur commence juste apres.
const compteurTour = (n) => ({ kind: 'event', type: 'jxz', payload: [{ no: 2, value: BigInt(n) }] });
const evenement = (frame, pid = 1) => ({ pid, dir: 'in', frame, brute: Buffer.alloc(0), estMaitre: false });

function passeur(sup, reglages = { actif: true, delaiMs: 0 }, rendu = []) {
  return creerPasseur({ superviseur: sup, reglages, onCompteRendu: (r) => rendu.push(r) });
}

// La trame mesuree: request { Any{ type_url: jxy }, uid: -1 }, sans charge
// utile. Deux clics sur « Passer » ont produit exactement ces octets, et les
// tours se sont termines 30 ms plus tard.
test('la trame emise est jxy, sans charge utile', () => {
  const f = decodeFrameRaw(TRAME_PASSE);
  assert.notStrictEqual(f, null);
  assert.strictEqual(f.kind, 'request');
  assert.strictEqual(f.type, 'jxy');
  assert.strictEqual(f.uid, -1n);
  assert.ok(f.payload === null || f.payload.length === 0, 'jxy ne porte aucun champ');
});

test('les octets exacts correspondent a la trame mesuree', () => {
  const attendu = '12220a150a13747970652e616e6b616d612e636f6d2f6a787910ffffffffffffffffff01';
  assert.strictEqual(TRAME_PASSE.toString('hex'), attendu);
});

// LE DECLENCHEUR. Notre propre jxh est le seul instant ou le serveur accepte
// jxy: c'est la que notre tour commence. Le passeur l'ecartait — il annulait
// meme les envois en attente — et n'emettait que sur les jalons des AUTRES
// combattants, donc toujours trop tot. En solo la coincidence sauvait la mise:
// seul joueur, notre tour commence juste apres le compteur de manche, sur
// lequel le passeur emet aussi. En groupe, notre tour est 3e ou 5e et plus
// aucun jalon ne tombe au bon moment.
test('le debut de NOTRE tour declenche le passe-tour', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(debutDeTour(MOI)));
  assert.strictEqual(sup.emis.length, 1);
  assert.deepStrictEqual(sup.emis[0].octets, TRAME_PASSE);
  assert.match(rendu[0].declencheur, /moi/);
});

// Le cas du groupe, bout en bout: manche 1, quatre combattants jouent avant
// nous, puis notre tour s'ouvre. Une seule chose compte — qu'une trame parte
// APRES notre propre jxh, pas seulement avant.
test('en groupe, la trame part au debut de notre tour', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  const p = passeur(sup, { actif: true, delaiMs: 0 }, rendu);
  p(evenement(compteurTour(1)));
  for (const id of [111n, 222n, MONSTRE, 444n]) p(evenement(debutDeTour(id)));
  const avant = sup.emis.length;
  p(evenement(debutDeTour(MOI)));
  assert.strictEqual(sup.emis.length, avant + 1, 'notre tour emet');
  assert.match(rendu[rendu.length - 1].declencheur, /moi/);
});

// Notre jxh n'annule plus rien. C'etait le defaut: en groupe, l'envoi arme au
// tour du combattant precedent etait detruit a l'instant meme ou il devenait
// utile.
test('notre jxh n annule pas un envoi en attente', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 50 });
  p(evenement(debutDeTour(AUTRE)));
  p(evenement(debutDeTour(MOI)));
  await new Promise((r) => setTimeout(r, 160));
  assert.strictEqual(sup.emis.length, 2, 'les deux envois aboutissent');
});

// Le debut du tour d'un autre combattant reste un jalon de repli: le notre
// peut suivre, et un jxy hors tour est ignore par le serveur.
test('le debut du tour d un autre declenche une tentative', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(debutDeTour(AUTRE)));
  assert.strictEqual(sup.emis.length, 1);
  assert.deepStrictEqual(sup.emis[0].octets, TRAME_PASSE);
});

test('le debut du tour d un monstre declenche aussi', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(debutDeTour(MONSTRE)));
  assert.strictEqual(sup.emis.length, 1);
});

// Dans les combats mesures, jxz est le dernier message avant le tour du
// joueur. Un jxy emis hors tour etant ignore par le serveur, l'essayer ne
// coute qu'une trame inutile.
test('le compteur de tours declenche une tentative', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(compteurTour(37)));
  assert.strictEqual(sup.emis.length, 1);
});

// Le passeur exigeait frame.kind === 'event'. jxz n'a jamais declenche la
// moindre emission en jeu, jxh en declenchait a chaque tour. Le type du jalon
// suffit: c'est `dir` qui dit d'ou vient la trame.
test('un jalon declenche quel que soit son kind', () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 0 });
  p(evenement({ kind: 'response', type: 'jxz', payload: [{ no: 2, value: 1n }] }));
  assert.strictEqual(sup.emis.length, 1);
});

test('un autre type entrant ne declenche rien', () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup);
  p(evenement({ kind: 'event', type: 'jyj', payload: null }));
  p(evenement({ kind: 'event', type: 'jwi', payload: [{ no: 2, value: MOI }] }));
  p({ pid: 1, dir: 'out', frame: compteurTour(1), brute: Buffer.alloc(0), estMaitre: false });
  assert.strictEqual(sup.emis.length, 0);
});

// Le characterId est ce qui reconnait NOTRE jxh parmi ceux de tous les
// combattants. Sans lui, le seul declencheur fiable est perdu: on s'abstient.
test('un characterId inconnu bloque et le dit', () => {
  const sup = fauxSuperviseur([[1, null]]);
  const rendu = [];
  passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(debutDeTour(AUTRE)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /characterId/);
});

test('un compte eteint ne declenche pas', () => {
  const sup = fauxSuperviseur();
  sup.comptes.get(1).passeTour = false;
  passeur(sup)(evenement(debutDeTour(AUTRE)));
  assert.strictEqual(sup.emis.length, 0);
});

test('l interrupteur general eteint neutralise tout', () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: false, delaiMs: 0 })(evenement(debutDeTour(AUTRE)));
  assert.strictEqual(sup.emis.length, 0);
});

// Le combat multicompte est le cas qui a condamne le limiteur « une tentative
// par manche »: notre personnage joue en cinquieme position, la tentative
// unique partait au premier jalon et n'atteignait jamais son tour. Chaque
// jalon adverse doit donner sa chance.
test('chaque jalon adverse donne lieu a une tentative', () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 0 });
  for (const id of [111n, 222n, 333n, 444n]) p(evenement(debutDeTour(id)));
  assert.strictEqual(sup.emis.length, 4);
});

// Le cout reste borne par le nombre de combattants, pas par le temps: rien
// n'emet tant qu'aucun jalon n'arrive.
test('aucune trame ne part sans jalon', async () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: true, delaiMs: 0 });
  await new Promise((r) => setTimeout(r, 120));
  assert.strictEqual(sup.emis.length, 0);
});

// Le premier tour d'un combat n'est precede d'aucune fin de tour: le compteur
// est le seul jalon, et il peut arriver avant que le serveur ouvre le tour.
test('le compteur emet une fois puis relance plusieurs fois', async () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: true, delaiMs: 0 })(evenement(compteurTour(1)));
  assert.strictEqual(sup.emis.length, 1, 'la premiere tentative est immediate');
  await new Promise((r) => setTimeout(r, 900));
  assert.strictEqual(sup.emis.length, 2, 'la premiere relance a 700 ms');
  // L'ouverture d'un combat met ~2,1 s a accepter le passe-tour: une seule
  // relance ne suffisait pas.
  await new Promise((r) => setTimeout(r, 1600));
  assert.strictEqual(sup.emis.length, 4, 'les relances couvrent les 2 premieres secondes');
});

// LE JOURNAL DU 20/08, combat reel. A l'ouverture:
//
//   280192  jxz { 2: 1 }        la manche 1 commence
//   280221  jxh { 2: MOI }      29 ms plus tard, avant tout tour
//   316240  jxh { 2: MOI }      36,0 s: le chronometre complet
//
// Ce jxh a 29 ms n'est pas la fin d'un tour — aucun tour n'avait eu lieu:
// c'est l'OUVERTURE de notre premier tour, et les 36,0 s qui suivent sont le
// chronometre complet ecoule faute de passe. Le passeur y voyait une fin de
// tour, annulait les cinq relances armees juste avant, et le premier tour
// partait au chronometre.
test('a l ouverture, notre jxh emet et les relances suivent', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 0 });
  p(evenement(compteurTour(1)));
  assert.strictEqual(sup.emis.length, 1, 'le compteur tente une fois');
  p(evenement(debutDeTour(MOI)));
  assert.strictEqual(sup.emis.length, 2, 'notre tour tente a son tour');
  await new Promise((r) => setTimeout(r, 900));
  assert.strictEqual(sup.emis.length, 3, 'la relance a 700 ms survit');
});

// Les relances ne repondent qu'a l'ouverture d'un combat. Les armer a chaque
// manche etait ce qui rendait leur annulation necessaire; le compteur dit la
// manche, donc la question ne se pose plus. En regime etabli les jalons de fin
// de tour suffisent, et le tour dure ~380 ms.
test('en regime etabli le compteur n arme aucune relance', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 0 });
  p(evenement(compteurTour(4)));
  assert.strictEqual(sup.emis.length, 1, 'la tentative immediate a lieu');
  await new Promise((r) => setTimeout(r, 900));
  assert.strictEqual(sup.emis.length, 1, 'aucune relance hors ouverture');
});

test('le delai differe l emission', async () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: true, delaiMs: 60 })(evenement(debutDeTour(AUTRE)));
  assert.strictEqual(sup.emis.length, 0);
  await new Promise((r) => setTimeout(r, 160));
  assert.strictEqual(sup.emis.length, 1);
});

test('deux comptes sont independants', async () => {
  const sup = fauxSuperviseur([[1, MOI], [2, AUTRE]]);
  const p = passeur(sup, { actif: true, delaiMs: 0 });
  p(evenement(debutDeTour(MONSTRE), 1));
  p(evenement(debutDeTour(MONSTRE), 2));
  assert.deepStrictEqual(sup.emis.map((e) => e.pid).sort(), [1, 2]);
});

test('le compte rendu dit ce qui a ete emis', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(debutDeTour(MONSTRE)));
  assert.strictEqual(rendu.length, 1);
  assert.strictEqual(rendu[0].pid, 1);
  assert.strictEqual(rendu[0].ok, true);
});

// Un client ferme pendant l'attente ne doit pas faire remonter d'exception.
test('un echec d emission est signale sans exception', () => {
  const sup = fauxSuperviseur();
  sup.emettre = () => ({ ok: false, raison: 'pas de socket amont' });
  const rendu = [];
  assert.doesNotThrow(() => passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(debutDeTour(MONSTRE))));
  assert.strictEqual(rendu[0].ok, false);
  assert.match(rendu[0].raison, /socket amont/);
});

// L'interrupteur general est un coupe-circuit immediat: l'eteindre PENDANT le
// delai doit annuler l'envoi deja programme, pas seulement empecher d'en
// programmer un nouveau.
test('eteindre l interrupteur general pendant le delai empeche l emission', async () => {
  const sup = fauxSuperviseur();
  const reglages = { actif: true, delaiMs: 40 };
  const p = passeur(sup, reglages);
  p(evenement(debutDeTour(MONSTRE)));
  reglages.actif = false;
  await new Promise((r) => setTimeout(r, 120));
  assert.strictEqual(sup.emis.length, 0);
});

// Windows reattribue les pid. Si le compte arme est retire pendant le delai et
// que le meme pid revient a un nouveau client Dofus, le minuteur perime
// emettrait sur CE client, a un instant arbitraire et hors de tout combat.
// Le pid ne suffit donc pas: c'est l'identite de l'objet qui compte.
test('un pid reattribue a un autre client n herite pas du minuteur en attente', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 40 });
  p(evenement(debutDeTour(MONSTRE)));
  // Meme pid, meme characterId, meme interrupteur: seul l'objet differe.
  sup.etats.set(1, { pid: 1, passeTour: true, characterId: MOI });
  await new Promise((r) => setTimeout(r, 140));
  assert.strictEqual(sup.emis.length, 0, "ce client n'a jamais vu de combat");
});

test('un compte retire pendant le delai n emet pas', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 40 });
  p(evenement(debutDeTour(MONSTRE)));
  sup.etats.delete(1);
  await new Promise((r) => setTimeout(r, 140));
  assert.strictEqual(sup.emis.length, 0);
});

test('eteindre le passeTour du compte pendant le delai empeche l emission', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 40 });
  p(evenement(debutDeTour(MONSTRE)));
  sup.comptes.get(1).passeTour = false;
  await new Promise((r) => setTimeout(r, 120));
  assert.strictEqual(sup.emis.length, 0);
});
