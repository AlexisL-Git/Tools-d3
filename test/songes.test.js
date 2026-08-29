'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decodeFrameRaw } = require('../src/codec/rawProto');
const {
  creerAccepteurSonge, TRAME_ACCEPTATION, DELAI_REACTION, FENETRE_SONGE,
  TYPE_LANCEMENT, TYPE_INVITATION,
} = require('../src/songes');

// LA TRAME N'A PAS DE HEX DE REFERENCE, contrairement a l'echange: la capture
// du 29/08 n'a livre que les champs decodes (`ixk { 1=1 }`), pas les octets
// bruts. On verifie donc la STRUCTURE relue, pas une empreinte. La preuve que
// ces octets sont les bons se fera en jeu, tache 3.
test('la trame d acceptation se relit comme ixk { 1: 1 }', () => {
  const relu = decodeFrameRaw(TRAME_ACCEPTATION);
  assert.notStrictEqual(relu, null, 'la trame doit se relire');
  assert.strictEqual(relu.kind, 'request');
  assert.strictEqual(relu.type, 'ixk');
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
const invitation = (pid = 2) => ({
  pid, dir: 'in', frame: { kind: 'event', type: TYPE_INVITATION, payload: [{ no: 2, value: -300n }] },
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
  const onTrama = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true },
    onCompteRendu: (c) => rendus.push(c), maintenant: h.maintenant,
  });

  onTrama(lancement(1));
  h.avancer(34);
  onTrama(invitation(2));

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
  const onTrama = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true }, onCompteRendu: (c) => rendus.push(c),
  });

  onTrama(invitation(2));

  assert.strictEqual(s.emis.length, 0, 'aucune acceptation ne doit partir');
  assert.strictEqual(rendus.length, 1);
  assert.strictEqual(rendus[0].ok, false);
  assert.match(rendus[0].raison, /aucun lancement/);
});

test('un lancement trop ancien ne vaut plus autorisation', () => {
  const s = fauxSuperviseur();
  const rendus = [];
  const h = horloge();
  const onTrama = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true },
    onCompteRendu: (c) => rendus.push(c), maintenant: h.maintenant,
  });

  onTrama(lancement(1));
  h.avancer(FENETRE_SONGE + 1);
  onTrama(invitation(2));

  assert.strictEqual(s.emis.length, 0);
  assert.strictEqual(rendus[0].ok, false);
  assert.match(rendus[0].raison, /aucun lancement/);
});

test('interrupteur eteint : rien n est emis, et le refus le dit', () => {
  const s = fauxSuperviseur();
  const rendus = [];
  const h = horloge();
  const onTrama = creerAccepteurSonge({
    superviseur: s, reglages: { actif: false },
    onCompteRendu: (c) => rendus.push(c), maintenant: h.maintenant,
  });

  onTrama(lancement(1));
  onTrama(invitation(2));

  assert.strictEqual(s.emis.length, 0);
  assert.strictEqual(rendus.length, 1);
  assert.match(rendus[0].raison, /eteint/);
});

test('le retard tire tombe dans DELAI_REACTION et l emission est differee', () => {
  const s = fauxSuperviseur();
  const rendus = [];
  const h = horloge();
  const taches = [];
  const onTrama = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true }, onCompteRendu: (c) => rendus.push(c),
    delai: DELAI_REACTION, alea: () => 0.5, maintenant: h.maintenant,
    planifier: (fn, ms) => { taches.push({ fn, ms }); },
  });

  onTrama(lancement(1));
  onTrama(invitation(2));

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
  const onTrama = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true }, delai: DELAI_REACTION,
    alea: () => 0, maintenant: h.maintenant,
    planifier: (fn, ms) => { taches.push({ fn, ms }); },
  });

  onTrama(lancement(1));
  onTrama(invitation(2));
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
  const onTrama = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true }, delai: DELAI_REACTION,
    alea: () => 0, maintenant: h.maintenant,
    planifier: (fn, ms) => { taches.push({ fn, ms }); },
  });

  onTrama(lancement(1));
  onTrama(invitation(2));
  s.etats.set(2, { pid: 2 });   // meme pid, objet different
  taches[0].fn();

  assert.strictEqual(s.emis.length, 0);
});

test('une trame entrante d un autre type est ignoree sans un mot', () => {
  const s = fauxSuperviseur();
  const rendus = [];
  const onTrama = creerAccepteurSonge({
    superviseur: s, reglages: { actif: true }, onCompteRendu: (c) => rendus.push(c),
  });

  onTrama({ pid: 2, dir: 'in', frame: { kind: 'event', type: 'kti', payload: [] } });

  assert.strictEqual(s.emis.length, 0);
  assert.strictEqual(rendus.length, 0);
});
