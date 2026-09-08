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

// Le groupe mesure le 08/09 APRES LE PATCH 3.6.11.12, et les octets exacts
// releves ce jour-la, dans test/fixtures/invitation-ikg.hex.
const GROUPE = 7028n;
const HEX_ACCEPTATION =
  '0a270a1a0a13747970652e616e6b616d612e636f6d2f696b67120308f43610ffffffffffffffffff01';

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

// CHAMP_INVITANT = 1 et CHAMP_GROUPE = 6, REMESURES le 08/09. Le champ 7 porte
// le DESTINATAIRE, c'est-a-dire nous: s'en servir comme invitant reviendrait a
// accepter tout le monde. Avant le patch les deux roles occupaient les champs
// 1 et 2 dans l ordre inverse: le piege a change de cote, il n a pas disparu.
const invitation = (invitant, groupe = GROUPE) => ({
  kind: 'event', type: TYPE_INVITATION,
  payload: [
    { no: 7, value: MOI },
    { no: CHAMP_INVITANT, value: invitant },
    { no: CHAMP_GROUPE, value: groupe },
  ],
});
const invitationSansGroupe = (invitant) => ({
  kind: 'event', type: TYPE_INVITATION,
  payload: [{ no: 7, value: MOI }, { no: CHAMP_INVITANT, value: invitant }],
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
// 36074, 36380 puis 7028 sur quatre mesures. Une trame figee n'accepterait que le
// groupe du jour de la mesure.
test('l identifiant de groupe de l invitation est recopie dans l acceptation', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(invitation(AMI, 4242n)));
  const f = decodeFrameRaw(sup.emis[0].octets);
  assert.strictEqual(f.type, 'ikg');
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

// LE PANNEAU D'INVITATION. Voir src/masque.js: il ne peut pas etre ferme par
// le reseau, seulement empeche de s'ouvrir. L'accepteur est le seul a savoir
// quelle trame a ete acceptee -- et c'est lui, jamais un filtre recopie
// ailleurs, qui designe ce qui doit etre masque au client.
const BRUTE = Buffer.from('0a37 0a35 0a13'.replace(/ /g, ''), 'hex');
const evenementBrut = (frame, brute, pid = 1) => ({ pid, dir: 'in', frame, brute });

test('l invitation acceptee est marquee, pour ne jamais atteindre le client', () => {
  const sup = fauxSuperviseur();
  const masquees = [];
  creerAccepteur({
    superviseur: sup, reglages: { actif: true },
    masquer: (pid, brute) => masquees.push({ pid, brute }),
  })(evenementBrut(invitation(AMI), BRUTE));
  assert.strictEqual(sup.emis.length, 1);
  assert.strictEqual(masquees.length, 1);
  assert.strictEqual(masquees[0].pid, 1);
  assert.ok(masquees[0].brute.equals(BRUTE));
});

// Une invitation qu'on n'accepte pas doit rester VISIBLE: la masquer
// ferait disparaitre en silence l'invitation d'un vrai ami.
test('une invitation refusee n est jamais marquee', () => {
  const sup = fauxSuperviseur();
  const masquees = [];
  const a = creerAccepteur({
    superviseur: sup, reglages: { actif: true },
    masquer: (pid, brute) => masquees.push({ pid, brute }),
  });
  a(evenementBrut(invitation(ETRANGER), BRUTE));
  a(evenementBrut(invitationSansGroupe(AMI), BRUTE));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(masquees.length, 0);
});

// --- LA CAPTURE REELLE DU 08/09 -------------------------------------------
//
// Les tests ci-dessus fabriquent leurs trames a partir des constantes du
// module: si une constante est fausse, ils restent VERTS et la fonction est
// morte en jeu. C'est exactement ce qui est arrive au patch 3.6.11.12 — 1231
// tests verts, et plus une seule invitation acceptee.
//
// Ceux-ci partent des OCTETS captures, jamais des constantes. Ils ne peuvent
// pas mentir de la meme facon.
const fs = require('node:fs');
const octets = (nom) => Buffer.from(fs.readFileSync('test/fixtures/' + nom + '.hex', 'utf8').trim(), 'hex');

const INVITANT_REEL = 676438999334n;   // celui qui invite: champ 1 de ikb
const NOUS_REEL = 666951024934n;       // le destinataire: champ 7

test('l invitation REELLE du 08/09 produit l acceptation REELLE, octet pour octet', () => {
  const sup = fauxSuperviseur([[1, NOUS_REEL], [2, INVITANT_REEL]]);
  const brute = octets('invitation-ikb');
  const frame = decodeFrameRaw(brute);
  assert.strictEqual(frame.type, TYPE_INVITATION, 'la fixture doit porter le type que le module ecoute');
  accepteur(sup)({ pid: 1, dir: 'in', frame, brute });
  assert.strictEqual(sup.emis.length, 1, 'une invitation reelle doit etre acceptee');
  assert.ok(sup.emis[0].octets.equals(octets('invitation-ikg')),
    'l acceptation emise doit etre identique a celle qu a emise le vrai client');
});

// Le champ 2 porte la constante 1 dans la trame reelle. Un filtre reste sur
// l'ancien numero d'invitant la comparerait a nos identifiants, ne la
// trouverait jamais, et refuserait TOUTES les invitations en silence.
test('les champs de la trame reelle sont bien ceux que le module lit', () => {
  const frame = decodeFrameRaw(octets('invitation-ikb'));
  assert.strictEqual(frame.payload.find((c) => c.no === 2).value, 1n);
  assert.strictEqual(frame.payload.find((c) => c.no === CHAMP_INVITANT).value, INVITANT_REEL);
  assert.strictEqual(frame.payload.find((c) => c.no === CHAMP_GROUPE).value, 7028n);
});
