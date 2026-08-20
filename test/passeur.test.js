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

// jxh { 2: X } — FIN du tour de X. Mesure le 20/08 sur les octets bruts:
// les tours du joueur duraient 36 s et se terminaient sur ce message.
const finDeTour = (id) => ({ kind: 'event', type: 'jxh', payload: [{ no: 2, value: id }] });
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

// jxh porte la FIN d'un tour. Sur le notre, il est trop tard pour passer.
test('la fin de NOTRE tour ne declenche rien', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(finDeTour(MOI)));
  assert.strictEqual(sup.emis.length, 0);
});

// La fin du tour d'un autre combattant peut annoncer le debut du notre.
test('la fin du tour d un autre declenche une tentative', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(finDeTour(AUTRE)));
  assert.strictEqual(sup.emis.length, 1);
  assert.deepStrictEqual(sup.emis[0].octets, TRAME_PASSE);
});

test('la fin du tour d un monstre declenche aussi', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(finDeTour(MONSTRE)));
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

test('un autre type entrant ne declenche rien', () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup);
  p(evenement({ kind: 'event', type: 'jyj', payload: null }));
  p(evenement({ kind: 'event', type: 'jwi', payload: [{ no: 2, value: MOI }] }));
  p({ pid: 1, dir: 'out', frame: compteurTour(1), brute: Buffer.alloc(0), estMaitre: false });
  assert.strictEqual(sup.emis.length, 0);
});

// Le characterId ne sert plus qu'a ECARTER la fin de notre propre tour. Sans
// lui, on ne peut pas distinguer, donc on s'abstient.
test('un characterId inconnu bloque et le dit', () => {
  const sup = fauxSuperviseur([[1, null]]);
  const rendu = [];
  passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(finDeTour(AUTRE)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /characterId/);
});

test('un compte eteint ne declenche pas', () => {
  const sup = fauxSuperviseur();
  sup.comptes.get(1).passeTour = false;
  passeur(sup)(evenement(finDeTour(AUTRE)));
  assert.strictEqual(sup.emis.length, 0);
});

test('l interrupteur general eteint neutralise tout', () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: false, delaiMs: 0 })(evenement(finDeTour(AUTRE)));
  assert.strictEqual(sup.emis.length, 0);
});

// Le combat multicompte est le cas qui a condamne le limiteur « une tentative
// par manche »: notre personnage joue en cinquieme position, la tentative
// unique partait apres la premiere fin de tour et n'atteignait jamais la
// notre. Chaque fin de tour adverse doit donner sa chance.
test('chaque fin de tour adverse donne lieu a une tentative', () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 0 });
  for (const id of [111n, 222n, 333n, 444n]) p(evenement(finDeTour(id)));
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
test('le compteur emet une fois puis relance', async () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: true, delaiMs: 0 })(evenement(compteurTour(1)));
  assert.strictEqual(sup.emis.length, 1, 'la premiere tentative est immediate');
  await new Promise((r) => setTimeout(r, 900));
  assert.strictEqual(sup.emis.length, 2, 'une relance rattrape le premier tour');
});

// La relance devient sans objet des que notre tour se termine.
test('la fin de notre tour annule la relance du compteur', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 0 });
  p(evenement(compteurTour(1)));
  p(evenement(finDeTour(MOI)));
  await new Promise((r) => setTimeout(r, 900));
  assert.strictEqual(sup.emis.length, 1, 'seule la tentative immediate a eu lieu');
});

test('le delai differe l emission', async () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: true, delaiMs: 60 })(evenement(finDeTour(AUTRE)));
  assert.strictEqual(sup.emis.length, 0);
  await new Promise((r) => setTimeout(r, 160));
  assert.strictEqual(sup.emis.length, 1);
});

test('deux comptes sont independants', async () => {
  const sup = fauxSuperviseur([[1, MOI], [2, AUTRE]]);
  const p = passeur(sup, { actif: true, delaiMs: 0 });
  p(evenement(finDeTour(MONSTRE), 1));
  p(evenement(finDeTour(MONSTRE), 2));
  assert.deepStrictEqual(sup.emis.map((e) => e.pid).sort(), [1, 2]);
});

test('le compte rendu dit ce qui a ete emis', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(finDeTour(MONSTRE)));
  assert.strictEqual(rendu.length, 1);
  assert.strictEqual(rendu[0].pid, 1);
  assert.strictEqual(rendu[0].ok, true);
});

// Un client ferme pendant l'attente ne doit pas faire remonter d'exception.
test('un echec d emission est signale sans exception', () => {
  const sup = fauxSuperviseur();
  sup.emettre = () => ({ ok: false, raison: 'pas de socket amont' });
  const rendu = [];
  assert.doesNotThrow(() => passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(finDeTour(MONSTRE))));
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
  p(evenement(finDeTour(MONSTRE)));
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
  p(evenement(finDeTour(MONSTRE)));
  // Meme pid, meme characterId, meme interrupteur: seul l'objet differe.
  sup.etats.set(1, { pid: 1, passeTour: true, characterId: MOI });
  await new Promise((r) => setTimeout(r, 140));
  assert.strictEqual(sup.emis.length, 0, "ce client n'a jamais vu de combat");
});

test('un compte retire pendant le delai n emet pas', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 40 });
  p(evenement(finDeTour(MONSTRE)));
  sup.etats.delete(1);
  await new Promise((r) => setTimeout(r, 140));
  assert.strictEqual(sup.emis.length, 0);
});

test('eteindre le passeTour du compte pendant le delai empeche l emission', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 40 });
  p(evenement(finDeTour(MONSTRE)));
  sup.comptes.get(1).passeTour = false;
  await new Promise((r) => setTimeout(r, 120));
  assert.strictEqual(sup.emis.length, 0);
});
