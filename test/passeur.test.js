'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerPasseur, TRAME_PASSE } = require('../src/passeur');
const { decodeFrameRaw } = require('../src/codec/rawProto');

const MOI = 677057659174n;
const AUTRE = 665809125670n;

// Double du superviseur: on n'a besoin que d'emettre() et des etats de compte.
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

// jxh { 2: <characterId> } — debut du tour de ce personnage.
const trameJxh = (id) => ({ kind: 'event', type: 'jxh', payload: [{ no: 2, value: id }] });
const evenement = (frame, pid = 1) => ({ pid, dir: 'in', frame, brute: Buffer.alloc(0), estMaitre: false });

function passeur(sup, reglages = { actif: true, delaiMs: 0 }, rendu = []) {
  return creerPasseur({ superviseur: sup, reglages, onCompteRendu: (r) => rendu.push(r) });
}

// La trame emise doit etre exactement celle de l'autopasse mesuree le 20/08.
test('la trame emise est jti { 1: 1, 2: 12 }', () => {
  const f = decodeFrameRaw(TRAME_PASSE);
  assert.notStrictEqual(f, null);
  assert.strictEqual(f.kind, 'request');
  assert.strictEqual(f.type, 'jti');
  assert.strictEqual(f.uid, -1n);
  const parNo = Object.fromEntries(f.payload.map((x) => [x.no, x.value]));
  assert.strictEqual(parNo[1], 1n);
  assert.strictEqual(parNo[2], 12n);
});

test('un delai de 0 emet immediatement', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(trameJxh(MOI)));
  assert.strictEqual(sup.emis.length, 1);
  assert.strictEqual(sup.emis[0].pid, 1);
  assert.deepStrictEqual(sup.emis[0].octets, TRAME_PASSE);
});

// LE test qui compte: jxh est diffuse a tous, y compris pour les tours des
// autres. Emettre sur celui d'un autre lui ferait perdre son tour.
test('le tour d un AUTRE personnage ne declenche rien', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(trameJxh(AUTRE)));
  assert.strictEqual(sup.emis.length, 0);
});

test('le tour d un monstre ne declenche rien', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(trameJxh(-1n)));
  assert.strictEqual(sup.emis.length, 0);
});

// jxz est le compteur de tours du combat, diffuse identiquement a tous: s'en
// servir ferait passer chaque compte des que n'importe qui commence son tour.
test('jxz ne declenche jamais rien', () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup);
  p(evenement({ kind: 'event', type: 'jxz', payload: [{ no: 2, value: 3n }] }));
  p(evenement({ kind: 'event', type: 'jyj', payload: null }));
  p(evenement({ kind: 'request', type: 'jxh', payload: [{ no: 2, value: MOI }] }));   // sortant
  p({ pid: 1, dir: 'out', frame: trameJxh(MOI), brute: Buffer.alloc(0), estMaitre: false });
  assert.strictEqual(sup.emis.length, 0);
});

test('un compte dont le characterId est inconnu ne declenche pas', () => {
  const sup = fauxSuperviseur([[1, null]]);
  const rendu = [];
  passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(trameJxh(MOI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(rendu.length, 1);
  assert.match(rendu[0].raison, /characterId/);
});

test('un compte dont l interrupteur est eteint ne declenche pas', () => {
  const sup = fauxSuperviseur();
  sup.comptes.get(1).passeTour = false;
  passeur(sup)(evenement(trameJxh(MOI)));
  assert.strictEqual(sup.emis.length, 0);
});

test('l interrupteur general eteint neutralise tous les comptes', () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: false, delaiMs: 0 })(evenement(trameJxh(MOI)));
  assert.strictEqual(sup.emis.length, 0);
});

test('un compte inconnu du superviseur ne declenche pas', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(trameJxh(MOI), 99));
  assert.strictEqual(sup.emis.length, 0);
});

// Le garde-fou central: une trame en retard passerait le tour d'un AUTRE
// personnage. Toute nouvelle annonce annule celle en attente, y compris celle
// qui concerne quelqu'un d'autre — elle signifie que notre tour est fini.
test('le tour d un autre annule le minuteur en attente', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 60 });
  p(evenement(trameJxh(MOI)));
  p(evenement(trameJxh(AUTRE)));
  await new Promise((r) => setTimeout(r, 160));
  assert.strictEqual(sup.emis.length, 0, 'notre tour etait fini, rien ne doit partir');
});

test('deux annonces pour nous n arment qu un seul envoi', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 40 });
  p(evenement(trameJxh(MOI)));
  p(evenement(trameJxh(MOI)));
  await new Promise((r) => setTimeout(r, 140));
  assert.strictEqual(sup.emis.length, 1);
});

test('le delai est respecte', async () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: true, delaiMs: 60 })(evenement(trameJxh(MOI)));
  assert.strictEqual(sup.emis.length, 0, 'rien avant l echeance');
  await new Promise((r) => setTimeout(r, 160));
  assert.strictEqual(sup.emis.length, 1);
});

test('deux comptes arment deux minuteurs independants', async () => {
  const sup = fauxSuperviseur([[1, MOI], [2, AUTRE]]);
  const p = passeur(sup, { actif: true, delaiMs: 30 });
  p(evenement(trameJxh(MOI), 1));
  p(evenement(trameJxh(AUTRE), 2));
  await new Promise((r) => setTimeout(r, 120));
  assert.deepStrictEqual(sup.emis.map((e) => e.pid).sort(), [1, 2]);
});

test('le compte rendu dit ce qui a ete emis', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(trameJxh(MOI)));
  assert.strictEqual(rendu.length, 1);
  assert.strictEqual(rendu[0].pid, 1);
  assert.strictEqual(rendu[0].ok, true);
});

// Un client ferme pendant l'attente ne doit pas faire remonter d'exception.
test('un echec d emission est signale sans exception', () => {
  const sup = fauxSuperviseur();
  sup.emettre = () => ({ ok: false, raison: 'pas de socket amont' });
  const rendu = [];
  assert.doesNotThrow(() => passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(trameJxh(MOI))));
  assert.strictEqual(rendu[0].ok, false);
  assert.match(rendu[0].raison, /socket amont/);
});
