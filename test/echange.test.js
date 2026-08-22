'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { TRAME_ACCEPTATION, TRAME_VALIDATION } = require('../src/echange');
const { decodeFrameRaw } = require('../src/codec/rawProto');

// Octets releves le 22/08, identiques a chaque occurrence et dans les deux
// sens. Voir docs/superpowers/specs/2026-08-22-trames-echange.md.
const HEX_ACCEPTATION =
  '12220a150a13747970652e616e6b616d612e636f6d2f6b676910ffffffffffffffffff01';
const HEX_VALIDATION =
  '12280a1b0a13747970652e616e6b616d612e636f6d2f6b657012040801100110ffffffffffffffffff01';

test('la trame d acceptation est celle mesuree', () => {
  assert.strictEqual(TRAME_ACCEPTATION.toString('hex'), HEX_ACCEPTATION);
  assert.notStrictEqual(decodeFrameRaw(TRAME_ACCEPTATION), null);
});

test('la trame de validation est celle mesuree', () => {
  assert.strictEqual(TRAME_VALIDATION.toString('hex'), HEX_VALIDATION);
  assert.notStrictEqual(decodeFrameRaw(TRAME_VALIDATION), null);
});

const {
  creerAccepteurEchange, TYPE_PROPOSITION, CHAMP_PROPOSANT,
} = require('../src/echange');

const MOI = 665809125670n;
const AMI = 677057659174n;
const ETRANGER = 123456789012n;

function fauxSuperviseur(comptes = [[1, MOI], [2, AMI]]) {
  const emis = [];
  const etats = new Map(comptes.map(([pid, id]) => [pid, {
    pid, accepteEchange: true, characterId: id,
  }]));
  return {
    emis,
    etats,
    comptes: { get: (pid) => etats.get(pid) || null, get tous() { return [...etats.values()]; } },
    emettre: (pid, octets) => { emis.push({ pid, octets }); return { ok: true, octets: octets.length }; },
  };
}

// kfz { 1: proposant, 2: cible, 4: 1 } — la cible est celle du client qui
// recoit, puisque la trame arrive chez les DEUX parties.
const proposition = (proposant, cible = MOI) => ({
  kind: 'event', type: TYPE_PROPOSITION,
  payload: [
    { no: CHAMP_PROPOSANT, value: proposant },
    { no: 2, value: cible },
    { no: 4, value: 1n },
  ],
});
const evenement = (frame, pid = 1) => ({ pid, dir: 'in', frame, brute: Buffer.alloc(0) });

function accepteur(sup, reglages = { actif: true }, rendu = []) {
  return creerAccepteurEchange({ superviseur: sup, reglages, onCompteRendu: (r) => rendu.push(r) });
}

test('un echange propose par un de nos comptes est accepte', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(proposition(AMI)));
  assert.strictEqual(sup.emis.length, 1);
  assert.strictEqual(sup.emis[0].pid, 1);
});

// Le coeur de la fonction: sans ce filtre, n'importe quel joueur ouvrant un
// echange avec un esclave le verrait valider des qu'il coche.
test('un echange propose par un tiers est refuse, et le dit', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(proposition(ETRANGER)));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(rendu[0].ok, false);
  assert.match(rendu[0].raison, /proposant/);
});

// Notre propre characterId ne designe pas un proposant: c'est le piege qui a
// failli livrer un filtre acceptant toutes les invitations de groupe.
test('un echange portant notre propre identifiant est refuse', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(proposition(MOI)));
  assert.strictEqual(sup.emis.length, 0);
});

test('interrupteur general eteint : rien n est emis', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: false }, rendu)(evenement(proposition(AMI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /interrupteur general/);
});

test('case du compte eteinte : rien n est emis', () => {
  const sup = fauxSuperviseur();
  sup.etats.get(1).accepteEchange = false;
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(proposition(AMI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /eteinte pour ce compte/);
});

test('compte inconnu du superviseur : rien n est emis', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(proposition(AMI), 99));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /compte inconnu/);
});

test('une trame sortante n est jamais traitee', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)({ pid: 1, dir: 'out', frame: proposition(AMI), brute: Buffer.alloc(0) });
  assert.strictEqual(sup.emis.length, 0);
});

test('un autre type de trame est ignore sans compte rendu', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement({ kind: 'event', type: 'zzz', payload: [] }));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(rendu.length, 0);
});
