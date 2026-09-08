'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decodeFrameRaw } = require('../src/codec/rawProto');
const {
  creerAccepteurSonge, TRAME_ACCEPTATION, DELAI_REACTION, FENETRE_SONGE,
  TYPE_LANCEMENT, TYPE_INVITATION, TYPE_ACCEPTATION,
} = require('../src/songes');

// LA TRAME A ENFIN SES OCTETS DE REFERENCE. La capture du 29/08 n'avait livre
// que les champs decodes; celle du 08/09, apres le patch 3.6.11.12, porte les
// octets bruts — test/fixtures/songe-ixo.hex, une acceptation reelle emise a la
// main. On compare donc a une empreinte, pas seulement a une structure.
const HEX_ACCEPTATION = "0a260a190a13747970652e616e6b616d612e636f6d2f69786f1202080110ffffffffffffffffff01";
test('la trame d acceptation est celle mesuree, et se relit comme ixo { 1: 1 }', () => {
  assert.strictEqual(TRAME_ACCEPTATION.toString('hex'), HEX_ACCEPTATION);
  const relu = decodeFrameRaw(TRAME_ACCEPTATION);
  assert.notStrictEqual(relu, null, 'la trame doit se relire');
  // 'request' depuis le patch: l'enveloppe est passee du champ 2 au champ 1.
  assert.strictEqual(relu.kind, 'request');
  assert.strictEqual(relu.type, 'ixo');
  const champs = relu.payload;
  assert.strictEqual(Array.isArray(champs), true, 'payload doit etre un array');
  assert.strictEqual(champs.length, 1, 'un seul champ');
  assert.strictEqual(champs[0].no, 1);
  assert.strictEqual(champs[0].value, 1n);
});

function fauxSuperviseur(pids = [1, 2]) {
  const emis = [];
  const etats = new Map(pids.map((pid) => [pid, { pid }]));
  return {
    emis,
    etats,
    comptes: { get: (pid) => etats.get(pid) || null, get tous() { return [...etats.values()]; } },
    emettre: (pid, octets) => { emis.push({ pid, octets }); return { ok: true, octets: octets.length }; },
  };
}

const lancement = (pid = 1) => ({
  pid, dir: 'out', frame: { kind: 'request', type: TYPE_LANCEMENT, payload: [] },
});
// REJOINDRE le songe d'un autre: notre client emet ixo, pas ixm.
const rejoindre = (pid = 1) => ({
  pid, dir: 'out', frame: { kind: 'request', type: TYPE_ACCEPTATION, payload: [] },
});
const invitation = (pid = 2) => ({
  pid, dir: 'in', frame: { kind: 'event', type: TYPE_INVITATION, payload: [{ no: 3, value: -300n }] },
});

// Une horloge qu'on avance a la main: aucun test ne dort.
function horloge(depart = 1000) {
  let t = depart;
  return { maintenant: () => t, avancer: (ms) => { t += ms; } };
}

test('une invitation precedee du lancement d un de nos clients est acceptee', () => {
  const s = fauxSuperviseur();
  const rendus = [];
  const h = horloge();
  const onTrame = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true },
    onCompteRendu: (c) => rendus.push(c), maintenant: h.maintenant,
  });

  onTrame(lancement(1));
  h.avancer(34);
  onTrame(invitation(2));

  assert.strictEqual(s.emis.length, 1);
  assert.strictEqual(s.emis[0].pid, 2);
  assert.strictEqual(s.emis[0].octets, TRAME_ACCEPTATION);
  assert.strictEqual(rendus.length, 1);
  assert.strictEqual(rendus[0].ok, true);
});

// LE FILTRE, et c'est lui qui porte la demande « pas d'inconnus ».
test('une invitation sans lancement de nos clients est refusee, avec sa raison', () => {
  const s = fauxSuperviseur();
  const rendus = [];
  const onTrame = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true }, onCompteRendu: (c) => rendus.push(c),
  });

  onTrame(invitation(2));

  assert.strictEqual(s.emis.length, 0, 'aucune acceptation ne doit partir');
  assert.strictEqual(rendus.length, 1);
  assert.strictEqual(rendus[0].ok, false);
  assert.match(rendus[0].raison, /aucun lancement/);
});

test('un lancement trop ancien ne vaut plus autorisation', () => {
  const s = fauxSuperviseur();
  const rendus = [];
  const h = horloge();
  const onTrame = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true },
    onCompteRendu: (c) => rendus.push(c), maintenant: h.maintenant,
  });

  onTrame(lancement(1));
  h.avancer(FENETRE_SONGE + 1);
  onTrame(invitation(2));

  assert.strictEqual(s.emis.length, 0);
  assert.strictEqual(rendus[0].ok, false);
  assert.match(rendus[0].raison, /aucun lancement/);
});

test('interrupteur eteint : rien n est emis, et le refus le dit', () => {
  const s = fauxSuperviseur();
  const rendus = [];
  const h = horloge();
  const onTrame = creerAccepteurSonge({
    superviseur: s, reglages: { actif: false },
    onCompteRendu: (c) => rendus.push(c), maintenant: h.maintenant,
  });

  onTrame(lancement(1));
  onTrame(invitation(2));

  assert.strictEqual(s.emis.length, 0);
  assert.strictEqual(rendus.length, 1);
  assert.match(rendus[0].raison, /eteint/);
});

test('le retard tire tombe dans DELAI_REACTION et l emission est differee', () => {
  const s = fauxSuperviseur();
  const rendus = [];
  const h = horloge();
  const taches = [];
  const onTrame = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true }, onCompteRendu: (c) => rendus.push(c),
    delai: DELAI_REACTION, alea: () => 0.5, maintenant: h.maintenant,
    planifier: (fn, ms) => { taches.push({ fn, ms }); },
  });

  onTrame(lancement(1));
  onTrame(invitation(2));

  assert.strictEqual(s.emis.length, 0, 'rien ne part pendant l appel');
  assert.strictEqual(taches.length, 1);
  assert.ok(taches[0].ms >= DELAI_REACTION.minMs && taches[0].ms <= DELAI_REACTION.maxMs);

  taches[0].fn();
  assert.strictEqual(s.emis.length, 1);
  assert.strictEqual(rendus[0].retardMs, taches[0].ms);
});

test('un client ferme entre l armement et l echeance ne recoit rien', () => {
  const s = fauxSuperviseur();
  const h = horloge();
  const taches = [];
  const onTrame = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true }, delai: DELAI_REACTION,
    alea: () => 0, maintenant: h.maintenant,
    planifier: (fn, ms) => { taches.push({ fn, ms }); },
  });

  onTrame(lancement(1));
  onTrame(invitation(2));
  s.etats.delete(2);
  taches[0].fn();

  assert.strictEqual(s.emis.length, 0);
});

// Windows reattribue les pid. Un AUTRE client Dofus peut porter le pid 2 a
// l'echeance: comparer le pid ne suffit pas, on compare l'objet d'etat.
test('un pid reattribue a un autre client ne recoit rien', () => {
  const s = fauxSuperviseur();
  const h = horloge();
  const taches = [];
  const onTrame = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true }, delai: DELAI_REACTION,
    alea: () => 0, maintenant: h.maintenant,
    planifier: (fn, ms) => { taches.push({ fn, ms }); },
  });

  onTrame(lancement(1));
  onTrame(invitation(2));
  s.etats.set(2, { pid: 2 });   // meme pid, objet different
  taches[0].fn();

  assert.strictEqual(s.emis.length, 0);
});

test('une trame entrante d un autre type est ignoree sans un mot', () => {
  const s = fauxSuperviseur();
  const rendus = [];
  const onTrame = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true }, onCompteRendu: (c) => rendus.push(c),
  });

  onTrame({ pid: 2, dir: 'in', frame: { kind: 'event', type: 'kti', payload: [] } });

  assert.strictEqual(s.emis.length, 0);
  assert.strictEqual(rendus.length, 0);
});

// REJOINDRE un songe passe par ixo, pas ixm: sans cette entree, les mules de
// celui qui rejoint (plutot que lance) refuseraient toujours de le suivre.
test('un ixo sortant d un de nos clients arme la fenetre, comme ixm', () => {
  const s = fauxSuperviseur();
  const rendus = [];
  const h = horloge();
  const onTrame = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true },
    onCompteRendu: (c) => rendus.push(c), maintenant: h.maintenant,
  });

  onTrame(rejoindre(1));
  h.avancer(34);
  onTrame(invitation(2));

  assert.strictEqual(s.emis.length, 1);
  assert.strictEqual(rendus[0].ok, true);
});

test('compte inconnu du superviseur : refus, sans emission', () => {
  const s = fauxSuperviseur([1]);   // le pid 2 n est pas un compte connu
  const rendus = [];
  const h = horloge();
  const onTrame = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true },
    onCompteRendu: (c) => rendus.push(c), maintenant: h.maintenant,
  });

  onTrame(lancement(1));
  onTrame(invitation(2));

  assert.strictEqual(s.emis.length, 0);
  assert.strictEqual(rendus.length, 1);
  assert.match(rendus[0].raison, /compte inconnu/);
});

// LE CHEMIN DE PRODUCTION: desktop/main.js passe toujours un delai, donc
// reglages.actif est TOUJOURS relu a l echeance, jamais a l armement.
test('interrupteur eteint pendant le delai n emet rien (relu a l echeance)', () => {
  const s = fauxSuperviseur();
  const reglages = { actif: true };
  const h = horloge();
  const taches = [];
  const onTrame = creerAccepteurSonge({
    superviseur: s, reglages, delai: DELAI_REACTION,
    alea: () => 0, maintenant: h.maintenant,
    planifier: (fn, ms) => { taches.push({ fn, ms }); },
  });

  onTrame(lancement(1));
  onTrame(invitation(2));
  reglages.actif = false;
  taches[0].fn();

  assert.strictEqual(s.emis.length, 0);
});

// La comparaison de fenetre est stricte (`>`): pile FENETRE_SONGE doit encore
// passer.
test('un lancement vieux d exactement FENETRE_SONGE est encore valide', () => {
  const s = fauxSuperviseur();
  const rendus = [];
  const h = horloge();
  const onTrame = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true },
    onCompteRendu: (c) => rendus.push(c), maintenant: h.maintenant,
  });

  onTrame(lancement(1));
  h.avancer(FENETRE_SONGE);
  onTrame(invitation(2));

  assert.strictEqual(s.emis.length, 1);
  assert.strictEqual(rendus[0].ok, true);
});

test('un ixm ENTRANT n arme pas la fenetre', () => {
  const s = fauxSuperviseur();
  const rendus = [];
  const h = horloge();
  const onTrame = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true },
    onCompteRendu: (c) => rendus.push(c), maintenant: h.maintenant,
  });

  onTrame({ pid: 1, dir: 'in', frame: { kind: 'request', type: TYPE_LANCEMENT, payload: [] } });
  onTrame(invitation(2));

  assert.strictEqual(s.emis.length, 0);
  assert.match(rendus[0].raison, /aucun lancement/);
});

test('un ixm sortant dont le kind n est pas request n arme pas', () => {
  const s = fauxSuperviseur();
  const rendus = [];
  const h = horloge();
  const onTrame = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true },
    onCompteRendu: (c) => rendus.push(c), maintenant: h.maintenant,
  });

  onTrame({ pid: 1, dir: 'out', frame: { kind: 'event', type: TYPE_LANCEMENT, payload: [] } });
  onTrame(invitation(2));

  assert.strictEqual(s.emis.length, 0);
  assert.match(rendus[0].raison, /aucun lancement/);
});

// --- LA CAPTURE REELLE DU 08/09 -------------------------------------------
//
// Meme raison que dans test/invitation.test.js: les tests ci-dessus batissent
// leurs trames sur les constantes du module. Une constante fausse les laisse
// verts et la fonction morte — c'est ce qu'a fait le patch 3.6.11.12.
//
// Celui-ci rejoue la seance du 08/09 telle qu'elle a eu lieu: le maitre lance
// un songe (ixm), la mule recoit l'invitation (ivj), et on verifie que ce que
// le module emet est OCTET POUR OCTET l'acceptation qu'a emise le vrai client.
const fs = require('node:fs');
const octets = (nom) => Buffer.from(fs.readFileSync('test/fixtures/' + nom + '.hex', 'utf8').trim(), 'hex');

test('la seance REELLE du 08/09 rejouee: ixm arme, ivj declenche, ixo part', () => {
  const sup = fauxSuperviseur();
  const lance = decodeFrameRaw(octets('songe-ixm'));
  const invite = decodeFrameRaw(octets('songe-ivj'));
  assert.strictEqual(lance.type, TYPE_LANCEMENT, 'la fixture de lancement doit porter le type ecoute');
  assert.strictEqual(invite.type, TYPE_INVITATION, 'la fixture d invitation doit porter le type ecoute');
  assert.strictEqual(lance.kind, 'request');
  assert.strictEqual(invite.kind, 'event');

  const onTrame = creerAccepteurSonge({ superviseur: sup, reglages: { actif: true } });
  onTrame({ pid: 2, dir: 'out', frame: lance });
  onTrame({ pid: 1, dir: 'in', frame: invite });

  assert.strictEqual(sup.emis.length, 1, 'l invitation reelle doit etre acceptee');
  assert.ok(sup.emis[0].octets.equals(octets('songe-ixo')),
    'l acceptation emise doit etre identique a celle du vrai client');
});

// Sans lancement prealable, la meme invitation reelle est refusee: c'est le
// filtre par le temps, et il ne depend d'aucun champ de la trame.
test('la meme invitation reelle est refusee si aucun de nos clients n a lance', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  const onTrame = creerAccepteurSonge({
    superviseur: sup, reglages: { actif: true }, onCompteRendu: (r) => rendu.push(r),
  });
  onTrame({ pid: 1, dir: 'in', frame: decodeFrameRaw(octets('songe-ivj')) });
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /aucun lancement/);
});
