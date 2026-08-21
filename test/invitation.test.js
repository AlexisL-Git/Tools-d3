'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  creerAccepteur, construireAcceptation, TYPE_INVITATION,
  CHAMP_INVITANT, CHAMP_GROUPE,
} = require('../src/invitation');
const { decodeFrameRaw } = require('../src/codec/rawProto');

const MOI = 665809125670n;
const AMI = 677057659174n;
const ETRANGER = 123456789012n;

// Le groupe mesure le 20/08, et les octets exacts releves ce jour-la.
const GROUPE = 36380n;
const HEX_ACCEPTATION =
  '12280a1b0a13747970652e616e6b616d612e636f6d2f696a781204089c9c0210ffffffffffffffffff01';

function fauxSuperviseur(comptes = [[1, MOI], [2, AMI]]) {
  const emis = [];
  const etats = new Map(comptes.map(([pid, id]) => [pid, {
    pid, accepteInvitation: true, characterId: id,
  }]));
  return {
    emis,
    etats,
    comptes: { get: (pid) => etats.get(pid) || null, get tous() { return [...etats.values()]; } },
    emettre: (pid, octets) => { emis.push({ pid, octets }); return { ok: true, octets: octets.length }; },
  };
}

// CHAMP_INVITANT = 2 et CHAMP_GROUPE = 5, mesures en tache 1. Le champ 1 porte
// le DESTINATAIRE, c'est-a-dire nous: s'en servir comme invitant reviendrait a
// accepter tout le monde.
const invitation = (invitant, groupe = GROUPE) => ({
  kind: 'event', type: TYPE_INVITATION,
  payload: [
    { no: 1, value: MOI },
    { no: CHAMP_INVITANT, value: invitant },
    { no: CHAMP_GROUPE, value: groupe },
  ],
});
const invitationSansGroupe = (invitant) => ({
  kind: 'event', type: TYPE_INVITATION,
  payload: [{ no: 1, value: MOI }, { no: CHAMP_INVITANT, value: invitant }],
});
const evenement = (frame, pid = 1) => ({ pid, dir: 'in', frame, brute: Buffer.alloc(0) });

function accepteur(sup, reglages = { actif: true }, rendu = []) {
  return creerAccepteur({ superviseur: sup, reglages, onCompteRendu: (r) => rendu.push(r) });
}

test('la trame construite est celle mesuree', () => {
  assert.strictEqual(construireAcceptation(GROUPE).toString('hex'), HEX_ACCEPTATION);
  assert.notStrictEqual(decodeFrameRaw(construireAcceptation(GROUPE)), null);
});

test('une invitation venue d un de nos comptes est acceptee', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(invitation(AMI)));
  assert.strictEqual(sup.emis.length, 1);
  assert.strictEqual(sup.emis[0].pid, 1);
});

// Le coeur de la fonction: sans ce filtre, n'importe qui en jeu peut faire
// rejoindre son groupe a un compte dont l'interrupteur est actif.
test('une invitation venue d un tiers est refusee, et le dit', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(invitation(ETRANGER)));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(rendu[0].ok, false);
  assert.match(rendu[0].raison, /invitant/);
});

// Notre propre characterId n'est pas un invitant valable: il designe le
// destinataire, pas un autre client. C'est exactement ce que le champ 1 porte.
test('une invitation portant notre propre identifiant est refusee', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(invitation(MOI)));
  assert.strictEqual(sup.emis.length, 0);
});

test('l interrupteur general eteint bloque et le dit', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: false }, rendu)(evenement(invitation(AMI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /interrupteur/);
});

test('un compte inconnu du superviseur bloque et le dit', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(invitation(AMI), 99));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /inconnu/);
});

test('un compte dont l interrupteur est eteint bloque et le dit', () => {
  const sup = fauxSuperviseur();
  sup.etats.get(1).accepteInvitation = false;
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(invitation(AMI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /eteint/);
});

// Une trame sortante porte les memes types: le client emet lui-meme
// l'acceptation quand l'utilisateur clique. La rejouer serait un doublon.
test('une trame sortante ne declenche rien', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)({ pid: 1, dir: 'out', frame: invitation(AMI), brute: Buffer.alloc(0) });
  assert.strictEqual(sup.emis.length, 0);
});

test('un autre type de trame ne declenche rien', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement({ kind: 'event', type: 'jxz', payload: [] }));
  assert.strictEqual(sup.emis.length, 0);
});

// Un client ferme entre l'invitation et l'acceptation.
test('un echec d emission est signale sans exception', () => {
  const sup = fauxSuperviseur();
  sup.emettre = () => ({ ok: false, raison: 'pas de socket amont' });
  const rendu = [];
  assert.doesNotThrow(() => accepteur(sup, { actif: true }, rendu)(evenement(invitation(AMI))));
  assert.strictEqual(rendu[0].ok, false);
  assert.match(rendu[0].raison, /socket amont/);
});

test('deux comptes sont independants', () => {
  const sup = fauxSuperviseur();
  const a = accepteur(sup);
  a(evenement(invitation(AMI), 1));
  a(evenement(invitation(MOI), 2));
  assert.deepStrictEqual(sup.emis.map((e) => e.pid).sort(), [1, 2]);
});

// L'acceptation N'EST PAS constante: l'identifiant de groupe a valu 35949,
// 36074 puis 36380 sur trois mesures. Une trame figee n'accepterait que le
// groupe du jour de la mesure.
test('l identifiant de groupe de l invitation est recopie dans l acceptation', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(invitation(AMI, 4242n)));
  const f = decodeFrameRaw(sup.emis[0].octets);
  assert.strictEqual(f.type, 'ijx');
  const c = f.payload.find((x) => x.no === 1);
  assert.strictEqual(c.value, 4242n);
});

// Accepter a l'aveugle une invitation dont on n'a pas l'identifiant enverrait
// une trame a moitie traduite; c'est ce que peutRejouer() refuse deja ailleurs.
test('une invitation sans identifiant de groupe est refusee, pas acceptee a l aveugle', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(invitationSansGroupe(AMI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /identifiant/);
});
