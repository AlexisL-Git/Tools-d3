'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  creerPasseur, TRAME_PASSE, TYPE_MON_TOUR, TYPE_FIN_TOUR, CHAMP_PERSONNAGE,
} = require('../src/passeur');
const { decodeFrameRaw } = require('../src/codec/rawProto');

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');

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

// LE DECLENCHEUR, mesure le 27/08 sur un combat de groupe a deux clients.
//
// jyj est VIDE et PERSONNEL: sur 9 occurrences, chacune suit de 2 a 39 ms un
// jzc portant le characterId de CE client, et les 49 jzc portant l'id d'un
// autre combattant n'en ont produit aucun. Il ne porte aucun champ — il n'a
// rien a dire d'autre que « c'est ton tour ».
const monTour = () => ({ kind: 'event', type: TYPE_MON_TOUR, payload: null });
// jxh { 2: X } — FIN du tour de X. Etabli par CAUSALITE, pas par correlation:
// un clic reel sur « Passer » a 72526 ms a produit ce message a 72560 ms, 34 ms
// plus tard, portant notre propre characterId.
const finDeTour = (id) => ({
  kind: 'event', type: TYPE_FIN_TOUR, payload: [{ no: CHAMP_PERSONNAGE, value: id }],
});
// jxz { 2: N } — compteur de manches du combat, diffuse a tous.
const compteurTour = (n) => ({ kind: 'event', type: 'jxz', payload: [{ no: 2, value: BigInt(n) }] });
// jzc { 1: X, 7: rang, 8: manche } — debut du tour de X, diffuse a tous. C'est
// jyj, et non lui, qui distingue notre tour: jzc obligerait a connaitre notre
// characterId pour rien.
const debutDeTour = (id) => ({ kind: 'event', type: 'jzc', payload: [{ no: 1, value: id }, { no: 8, value: 1n }] });
const evenement = (frame, pid = 1) => ({ pid, dir: 'in', frame, brute: Buffer.alloc(0), estMaitre: false });

function passeur(sup, reglages = { actif: true, delaiMs: 0 }, rendu = []) {
  return creerPasseur({ superviseur: sup, reglages, onCompteRendu: (r) => rendu.push(r) });
}

// La trame mesuree: request { Any{ type_url: jxy }, uid: -1 }, sans charge
// utile. Deux clics sur « Passer » ont produit exactement ces octets.
test('la trame emise est jxy, sans charge utile', () => {
  const f = decodeFrameRaw(TRAME_PASSE);
  assert.notStrictEqual(f, null);
  assert.strictEqual(f.kind, 'request');
  assert.strictEqual(f.type, 'jvv');
  assert.strictEqual(f.uid, -1n);
  assert.ok(f.payload === null || f.payload.length === 0, 'la requete ne porte aucun champ');
});

test('les octets exacts correspondent a la trame mesuree', () => {
  const attendu = '0a220a150a13747970652e616e6b616d612e636f6d2f6a767610ffffffffffffffffff01';
  assert.strictEqual(TRAME_PASSE.toString('hex'), attendu);
});

test('jyj declenche le passe-tour', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(monTour()));
  assert.strictEqual(sup.emis.length, 1);
  assert.deepStrictEqual(sup.emis[0].octets, TRAME_PASSE);
  assert.strictEqual(rendu[0].ok, true);
});

// LE DEFAUT CORRIGE, et la mesure qui l'a etabli.
//
// Le passeur tirait sur la fin du tour du combattant precedent, en la prenant
// pour le debut du notre. Le serveur ouvre en realite notre tour ~400 ms plus
// tard: sur le combat mesure, TOUS les envois partis a l'instant du jxh ont
// ete ignores, et le tour partait au chronometre complet.
//
// Le defaut se voyait a peine en solo — la relance d'ouverture, armee sur le
// compteur de manche, finissait par tomber dans la fenetre utile — et pas du
// tout en groupe, ou notre tour arrive bien plus tard dans la manche.
test('la fin du tour d un autre ne declenche rien', () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup);
  p(evenement(finDeTour(AUTRE)));
  p(evenement(finDeTour(MONSTRE)));
  assert.strictEqual(sup.emis.length, 0);
});

test('le compteur de manche ne declenche rien', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(compteurTour(1)));
  assert.strictEqual(sup.emis.length, 0);
});

// jzc annonce le debut du tour de N'IMPORTE QUEL combattant, nous compris.
// Tirer dessus ferait partir une trame au tour de chacun; jyj ne parle que de
// nous, et sans exiger de characterId.
test('le debut du tour d un autre ne declenche rien', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(debutDeTour(AUTRE)));
  assert.strictEqual(sup.emis.length, 0);
});

test('un autre type entrant ne declenche rien', () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup);
  p(evenement({ kind: 'event', type: 'jwi', payload: [{ no: 2, value: MOI }] }));
  p(evenement({ kind: 'event', type: 'jxc', payload: [{ no: 4, value: MOI }] }));
  assert.strictEqual(sup.emis.length, 0);
});

// jyj est ENTRANT. Le meme type dans l'autre sens, s'il existait, viendrait du
// client lui-meme et ne dirait rien de notre tour.
test('un jyj sortant ne declenche rien', () => {
  const sup = fauxSuperviseur();
  passeur(sup)({ pid: 1, dir: 'out', frame: monTour(), brute: Buffer.alloc(0), estMaitre: false });
  assert.strictEqual(sup.emis.length, 0);
});

// Le characterId ne sert plus qu'a reconnaitre la FIN de notre tour, donc a
// arreter les relances. Ne pas le connaitre ne doit plus empecher de passer:
// c'etait une garde heritee d'un declencheur qui en dependait.
test('un characterId inconnu n empeche plus le passe-tour', () => {
  const sup = fauxSuperviseur([[1, null]]);
  passeur(sup)(evenement(monTour()));
  assert.strictEqual(sup.emis.length, 1);
});

test('un compte eteint ne declenche pas', () => {
  const sup = fauxSuperviseur();
  sup.comptes.get(1).passeTour = false;
  passeur(sup)(evenement(monTour()));
  assert.strictEqual(sup.emis.length, 0);
});

test('l interrupteur general eteint neutralise tout', () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: false, delaiMs: 0 })(evenement(monTour()));
  assert.strictEqual(sup.emis.length, 0);
});

test('un compte inconnu du superviseur ne declenche pas', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(monTour(), 42));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(rendu[0].ok, false);
});

// LES RELANCES NE COUTENT RIEN QUAND LA PREMIERE TRAME SUFFIT: la fin de notre
// tour arrive ~40 ms plus tard et les annule avant leur echeance. Elles ne
// partent que si le tour dure encore, c'est-a-dire si le premier essai a ete
// perdu ou refuse.
test('la fin de notre tour annule les relances', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 0 });
  p(evenement(monTour()));
  assert.strictEqual(sup.emis.length, 1);
  p(evenement(finDeTour(MOI)));
  await new Promise((r) => setTimeout(r, 500));
  assert.strictEqual(sup.emis.length, 1, 'aucune relance apres la fin du tour');
});

test('un tour qui dure declenche des relances', async () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: true, delaiMs: 0 })(evenement(monTour()));
  assert.strictEqual(sup.emis.length, 1);
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(sup.emis.length >= 2, `au moins une relance, vu ${sup.emis.length}`);
});

// La fin du tour d'un AUTRE combattant ne doit pas arreter nos relances: notre
// tour, lui, continue.
test('la fin du tour d un autre n annule pas les relances', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 0 });
  p(evenement(monTour()));
  p(evenement(finDeTour(AUTRE)));
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(sup.emis.length >= 2, 'les relances survivent');
});

test('le delai differe l emission', async () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: true, delaiMs: 60 })(evenement(monTour()));
  assert.strictEqual(sup.emis.length, 0);
  await new Promise((r) => setTimeout(r, 160));
  assert.strictEqual(sup.emis.length, 1);
});

// SANS delaiMs CONFIGURE (l'usage reel, hors tests): le passe-tour tire son
// propre delai entre 80 et 140 ms plutot que d'emettre a l'instant du jyj.
test('sans delaiMs configure, le passe-tour attend un delai tire au hasard', async () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: true })(evenement(monTour()));
  assert.strictEqual(sup.emis.length, 0);
  await new Promise((r) => setTimeout(r, 70));
  assert.strictEqual(sup.emis.length, 0, 'le delai minimal (80 ms) n a pas encore ete atteint');
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(sup.emis.length, 1, 'le delai maximal (140 ms) est depasse');
});

test('deux comptes sont independants', () => {
  const sup = fauxSuperviseur([[1, MOI], [2, AUTRE]]);
  const p = passeur(sup, { actif: true, delaiMs: 0 });
  p(evenement(monTour(), 1));
  p(evenement(monTour(), 2));
  assert.deepStrictEqual(sup.emis.map((e) => e.pid).sort(), [1, 2]);
});

// Le tour de l'un ne doit pas arreter les relances de l'autre.
test('la fin du tour d un compte n annule pas celles d un autre', async () => {
  const sup = fauxSuperviseur([[1, MOI], [2, AUTRE]]);
  const p = passeur(sup, { actif: true, delaiMs: 0 });
  p(evenement(monTour(), 1));
  p(evenement(monTour(), 2));
  p(evenement(finDeTour(MOI), 1));
  await new Promise((r) => setTimeout(r, 500));
  assert.strictEqual(sup.emis.filter((e) => e.pid === 1).length, 1);
  assert.ok(sup.emis.filter((e) => e.pid === 2).length >= 2);
});

test('le compte rendu dit ce qui a ete emis', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(monTour()));
  assert.strictEqual(rendu.length, 1);
  assert.strictEqual(rendu[0].pid, 1);
  assert.strictEqual(rendu[0].ok, true);
  // Le nom du declencheur change a chaque patch: on l'attend par la constante,
  // pas par un litteral, sinon ce test redemande une retouche a chaque fois.
  assert.strictEqual(rendu[0].declencheur, TYPE_MON_TOUR);
});

// Un client ferme pendant l'attente ne doit pas faire remonter d'exception.
test('un echec d emission est signale sans exception', () => {
  const sup = fauxSuperviseur();
  sup.emettre = () => ({ ok: false, raison: 'pas de socket amont' });
  const rendu = [];
  assert.doesNotThrow(() => passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(monTour())));
  assert.strictEqual(rendu[0].ok, false);
  assert.match(rendu[0].raison, /socket amont/);
});

// L'interrupteur general est un coupe-circuit immediat: l'eteindre PENDANT le
// delai doit annuler l'envoi deja programme.
test('eteindre l interrupteur general pendant le delai empeche l emission', async () => {
  const sup = fauxSuperviseur();
  const reglages = { actif: true, delaiMs: 40 };
  const p = passeur(sup, reglages);
  p(evenement(monTour()));
  reglages.actif = false;
  await new Promise((r) => setTimeout(r, 140));
  assert.strictEqual(sup.emis.length, 0);
});

// Si le compte a ete retire pendant le delai et que Windows a reattribue le
// meme pid a un nouveau client, l'etat rendu est un AUTRE objet: l'envoi ne
// doit pas partir sur ce client-la.
test('un minuteur ne survit pas a un pid reattribue', async () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: true, delaiMs: 40 })(evenement(monTour()));
  sup.etats.set(1, { pid: 1, passeTour: true, characterId: MOI });
  await new Promise((r) => setTimeout(r, 140));
  assert.strictEqual(sup.emis.length, 0);
});

test('aucune trame ne part sans jalon', async () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: true, delaiMs: 0 });
  await new Promise((r) => setTimeout(r, 500));
  assert.strictEqual(sup.emis.length, 0);
});

// --- Vérité terrain du 08/09, patch 3.6.11.12 ------------------------------
//
// Trames REELLES d'un combat 2v2, six tours, le passe fait a la main. Le patch
// a renomme les trois messages et deplace le champ de la fin de tour:
//
//   jyj -> juu   c'est notre tour        (toujours vide)
//   jxy -> jvv   passer                  (toujours vide, kind 2 -> 1)
//   jxh -> jvn   fin du tour d'un combattant, champ 2 -> CHAMP 1
//
// Les deux messages VIDES ne s'apparient pas par leur structure — c'est
// l'empreinte la plus repandue du flux. Ils ont ete identifies par le compte et
// la cadence: 12 juu pour 6 tours a deux personnages, un par client et par
// tour; 11 jvv pour 11 clics. Aucun orphelin.
const JUU_NOTRE_TOUR = hex('12171a150a13747970652e616e6b616d612e636f6d2f6a7575');
const JVN_FIN_DE_TOUR = hex('12201a1e0a13747970652e616e6b616d612e636f6d2f6a766e120708a682c488da13');
const COMBATTANT_MESURE = 677012111654n;

test('l event mesure de notre tour est reconnu et ne porte aucun champ', () => {
  const f = decodeFrameRaw(JUU_NOTRE_TOUR);
  assert.strictEqual(f.type, TYPE_MON_TOUR);
  assert.ok(f.payload === null || f.payload.length === 0);
});

test('la fin de tour mesuree livre le combattant qui vient de jouer', () => {
  const f = decodeFrameRaw(JVN_FIN_DE_TOUR);
  assert.strictEqual(f.type, TYPE_FIN_TOUR);
  assert.strictEqual(f.payload.find((c) => c.no === CHAMP_PERSONNAGE).value, COMBATTANT_MESURE);
});
