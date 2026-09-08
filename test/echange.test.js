'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { TRAME_ACCEPTATION, TRAME_VALIDATION, DELAI_REACTION } = require('../src/echange');
const { decodeFrameRaw } = require('../src/codec/rawProto');

// Octets releves le 22/08, identiques a chaque occurrence et dans les deux
// sens. Voir docs/superpowers/specs/2026-08-22-trames-echange.md.
//
// REMESURES LE 08/09, patch 3.6.11.12, sur un echange fait a la main entre deux
// comptes. Trois choses ont bouge d'un coup, et aucune ne se signale:
//   - l'enveloppe: une requete part en kind 1, plus en kind 2 (premier octet);
//   - les noms: kgi -> kaq, kep -> kcs, comme tout le reste du protocole;
//   - les champs de la validation: {1,2} -> {2,3}.
// Les deux clients ont emis des kcs identiques, donc la trame reste CONSTANTE.
const HEX_ACCEPTATION =
  '0a220a150a13747970652e616e6b616d612e636f6d2f6b617110ffffffffffffffffff01';
const HEX_VALIDATION =
  '0a280a1b0a13747970652e616e6b616d612e636f6d2f6b637312041001180110ffffffffffffffffff01';

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

const { TYPE_PARTENAIRE_PRET, CHAMP_PRET, CHAMP_VALIDANT } = require('../src/echange');

// kgt { 3: 1, 4: qui } = X a coche. Sans le champ 3 = X a DEcoche.
const partenairePret = (partenaire) => ({
  kind: 'event', type: TYPE_PARTENAIRE_PRET,
  payload: [{ no: CHAMP_PRET, value: 1n }, { no: CHAMP_VALIDANT, value: partenaire }],
});
const partenaireDecoche = (partenaire) => ({
  kind: 'event', type: TYPE_PARTENAIRE_PRET,
  payload: [{ no: CHAMP_VALIDANT, value: partenaire }],
});

test('la validation du partenaire declenche la notre', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(partenairePret(AMI)));
  assert.strictEqual(sup.emis.length, 1);
  assert.strictEqual(sup.emis[0].pid, 1);
});

// Un tiers qui coche ne doit pas nous faire cocher: c'est le vol en un clic
// que le filtre existe pour empecher.
test('la validation d un tiers ne declenche rien', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(partenairePret(ETRANGER)));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(rendu[0].ok, false);
});

// La proposition ouvre la fenetre, elle ne valide pas. Confondre les deux
// ferait valider un echange vide avant que l'utilisateur ait pose quoi que
// ce soit.
test('l acceptation seule n emet pas de validation', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(proposition(AMI)));
  assert.strictEqual(sup.emis.length, 1, 'une seule trame: l acceptation');
});

test('interrupteur general eteint : la validation ne part pas non plus', () => {
  const sup = fauxSuperviseur();
  accepteur(sup, { actif: false })(evenement(partenairePret(AMI)));
  assert.strictEqual(sup.emis.length, 0);
});

// LE test de cette tache. A la fin de chaque echange le serveur remet les deux
// coches a zero avec des kgt SANS champ 3. Les prendre pour des validations
// ferait emettre un kep sur un echange deja ferme.
test('une coche qui retombe ne declenche aucune validation', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(partenaireDecoche(AMI)));
  assert.strictEqual(sup.emis.length, 0);
});

// Notre propre validation nous revient en kgt avec NOTRE identifiant. Sans le
// filtre, le client se repondrait a lui-meme.
test('notre propre validation ne se redeclenche pas', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(partenairePret(MOI)));
  assert.strictEqual(sup.emis.length, 0);
});

// Comme superviseurEtale du passe-tour: `alea` rend une suite fixee et
// `planifier` capture au lieu d'attendre. Le test reste instantane.
function accepteurRetarde(sup, tirages, reglages = { actif: true }) {
  let i = 0;
  const planifies = [];
  const rendu = [];
  const a = creerAccepteurEchange({
    superviseur: sup,
    reglages,
    delai: { minMs: 150, maxMs: 600 },
    alea: () => tirages[i++ % tirages.length],
    planifier: (fn, ms) => { planifies.push({ fn, ms }); return null; },
    onCompteRendu: (r) => rendu.push(r),
  });
  return { a, planifies, rendu };
}

test('avec delai, rien ne part pendant l appel', () => {
  const sup = fauxSuperviseur();
  const { a, planifies } = accepteurRetarde(sup, [0]);
  a(evenement(proposition(AMI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(planifies.length, 1);
  planifies[0].fn();
  assert.strictEqual(sup.emis.length, 1);
});

test('le retard reste dans les bornes', () => {
  const sup = fauxSuperviseur();
  const { a, planifies } = accepteurRetarde(sup, [0, 0.999999]);
  a(evenement(proposition(AMI)));
  a(evenement(partenairePret(AMI)));
  assert.deepStrictEqual(planifies.map((p) => p.ms), [150, 600]);
});

// LE test de cette tache. Sans la garde d'identite, une acceptation armee
// pour un client ferme partirait chez le client qui a herite de son pid.
test('un compte decoche pendant le delai n emet rien', () => {
  const sup = fauxSuperviseur();
  const { a, planifies } = accepteurRetarde(sup, [0]);
  a(evenement(proposition(AMI)));
  sup.etats.get(1).accepteEchange = false;
  planifies[0].fn();
  assert.strictEqual(sup.emis.length, 0);
});

test('un interrupteur general eteint pendant le delai n emet rien', () => {
  const sup = fauxSuperviseur();
  const reglages = { actif: true };
  const { a, planifies } = accepteurRetarde(sup, [0], reglages);
  a(evenement(proposition(AMI)));
  reglages.actif = false;
  planifies[0].fn();
  assert.strictEqual(sup.emis.length, 0);
});

// Windows reattribue les pid. Le meme pid peut designer un AUTRE client a
// l'echeance: comparer l'identite de l'objet d'etat, pas le pid.
test('un etat remplace pendant le delai n emet rien', () => {
  const sup = fauxSuperviseur();
  const { a, planifies } = accepteurRetarde(sup, [0]);
  a(evenement(proposition(AMI)));
  sup.etats.set(1, { pid: 1, accepteEchange: true, characterId: MOI });
  planifies[0].fn();
  assert.strictEqual(sup.emis.length, 0);
});

test('sans delai configure, l emission reste dans l appel', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(proposition(AMI)));
  assert.strictEqual(sup.emis.length, 1);
});

test('la constante vaut 150 a 600 ms', () => {
  assert.deepStrictEqual(DELAI_REACTION, { minMs: 150, maxMs: 600 });
});

// --- Vérité terrain du 08/09, patch 3.6.11.12 ------------------------------
//
// Trames REELLES d'un echange fait a la main entre deux comptes, relues telles
// quelles. Le patch a renomme les deux events ET renumerote leurs champs: dans
// kfz le proposant etait en 1, il est en 4; dans kgt le drapeau « a coche » et
// l'identifiant ont glisse de {3,4} a {2,3}.
//
// Les figer sur les octets, plutot que sur des payloads reconstruits, est ce
// qui aurait fait echouer la suite le matin du patch au lieu du soir.
const JYV_PROPOSITION =
  '12291a270a13747970652e616e6b616d612e636f6d2f6a79761210080110a682e888da1320a682c488da13';
const KCB_PARTENAIRE_PRET =
  '12221a200a13747970652e616e6b616d612e636f6d2f6b63621209100118a682e888da13';

const PROPOSANT_MESURE = 677012111654n;
const CIBLE_MESUREE = 677012701478n;

test('la proposition mesuree est reconnue et livre son proposant', () => {
  const f = decodeFrameRaw(Buffer.from(JYV_PROPOSITION, 'hex'));
  assert.strictEqual(f.type, TYPE_PROPOSITION);
  const champ = f.payload.find((c) => c.no === CHAMP_PROPOSANT);
  assert.strictEqual(champ.value, PROPOSANT_MESURE);
});

// La cible reste en champ 2. Le verifier protege d'une correction qui, en
// deplacant le proposant, prendrait la cible pour lui: l'accepteur repondrait
// alors a ses propres propositions.
test('la cible de la proposition reste distincte du proposant', () => {
  const f = decodeFrameRaw(Buffer.from(JYV_PROPOSITION, 'hex'));
  assert.strictEqual(f.payload.find((c) => c.no === 2).value, CIBLE_MESUREE);
});

test('le partenaire pret mesure est reconnu, coche et identifie', () => {
  const { TYPE_PARTENAIRE_PRET, CHAMP_PRET, CHAMP_VALIDANT } = require('../src/echange');
  const f = decodeFrameRaw(Buffer.from(KCB_PARTENAIRE_PRET, 'hex'));
  assert.strictEqual(f.type, TYPE_PARTENAIRE_PRET);
  assert.strictEqual(f.payload.find((c) => c.no === CHAMP_PRET).value, 1n);
  assert.strictEqual(f.payload.find((c) => c.no === CHAMP_VALIDANT).value, CIBLE_MESUREE);
});
