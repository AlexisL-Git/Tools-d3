'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerReplicateur } = require('../src/replicateur');

// La decision de rejeu, testee sans Electron, sans Frida et sans jeu: le
// superviseur est remplace par un double qui note ce qu'on lui demande.
function faux({ arme = false, rendu = [{ pid: 2, ok: true, emis: false, action: 'copier', octets: 12 }] } = {}) {
  const appels = [];
  return {
    arme,
    appels,
    clients: new Map(),
    rejouer(args) { appels.push(args); return rendu; },
  };
}

function trame(extra = {}) {
  return {
    pid: 1,
    dir: 'out',
    frame: { kind: 'request', type: 'hjc', payload: [] },
    brute: Buffer.from([0x08, 0x01]),
    estMaitre: true,
    ...extra,
  };
}

// Ce que le serveur renvoie est propre a chaque client: le rejouer chez un
// autre n'aurait aucun sens.
test('une trame entrante n est pas rejouée', () => {
  const s = faux();
  const comptesRendus = [];
  const onTrame = creerReplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame({ dir: 'in' }));

  assert.strictEqual(s.appels.length, 0);
  assert.strictEqual(comptesRendus.length, 0);
});

test('une réponse sortante n est pas rejouée, seules les requêtes le sont', () => {
  const s = faux();
  const onTrame = creerReplicateur({ superviseur: s, onCompteRendu: () => {} });

  onTrame(trame({ frame: { kind: 'response', type: 'hjc', payload: [] } }));

  assert.strictEqual(s.appels.length, 0);
});

// Seul le client au premier plan dicte l'action; celles des autres sont deja
// les leurs.
test('une trame sortante d un non-maître n est pas rejouée', () => {
  const s = faux();
  const comptesRendus = [];
  const onTrame = creerReplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame({ estMaitre: false }));

  assert.strictEqual(s.appels.length, 0);
  assert.strictEqual(comptesRendus.length, 0);
});

// Emettre une trame dont on ne sait rien serait pire que de s'abstenir.
test('un type inconnu n est pas rejoué', () => {
  const s = faux();
  const comptesRendus = [];
  const onTrame = creerReplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame({ frame: { kind: 'request', type: 'zzz', payload: [] } }));

  assert.strictEqual(s.appels.length, 0);
  assert.strictEqual(comptesRendus.length, 0);
});

test('une trame sortante du maître d un type connu déclenche rejouer', () => {
  const s = faux();
  const brute = Buffer.from([0x08, 0x2a]);
  const onTrame = creerReplicateur({ superviseur: s, onCompteRendu: () => {} });

  onTrame(trame({ pid: 7, brute }));

  assert.strictEqual(s.appels.length, 1);
  assert.deepStrictEqual(s.appels[0], { type: 'hjc', brute, pidMaitre: 7 });
});

test('le compte rendu porte le nom du message, le rendu et le mode', () => {
  const rendu = [{ pid: 2, ok: true, emis: true, action: 'copier', octets: 12 }];
  const s = faux({ arme: true, rendu });
  const comptesRendus = [];
  const onTrame = creerReplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame({ pid: 7 }));

  assert.strictEqual(comptesRendus.length, 1);
  assert.deepStrictEqual(comptesRendus[0], {
    pidMaitre: 7, type: 'hjc', nom: 'TeleportRequest', arme: true, rendu,
  });
});

// Le maitre seul en jeu: aucun esclave, donc rien a dire.
test('un rejeu sans esclave ne produit pas de compte rendu', () => {
  const s = faux({ rendu: [] });
  const comptesRendus = [];
  const onTrame = creerReplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame());

  assert.strictEqual(s.appels.length, 1);
  assert.strictEqual(comptesRendus.length, 0);
});

// La raison d'un refus est ce que l'interface doit pouvoir montrer: sans elle,
// un compte qui ne suit pas est indiscernable d'un compte inactif.
test('la raison d un refus remonte telle quelle dans le compte rendu', () => {
  const rendu = [
    { pid: 2, ok: false, emis: false, raison: "manque skillInstanceUid pour l'élément 4198401" },
    { pid: 3, ok: true, emis: false, action: 'réécrire', octets: 14 },
  ];
  const s = faux({ rendu });
  const comptesRendus = [];
  const onTrame = creerReplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame({ frame: { kind: 'request', type: 'iwo', payload: [] } }));

  assert.strictEqual(comptesRendus[0].nom, 'InteractiveUseRequest');
  assert.deepStrictEqual(comptesRendus[0].rendu, rendu);
});

// Le rappel est facultatif: un appelant qui ne veut que le rejeu ne doit pas
// avoir a en fournir un.
test('sans rappel de compte rendu, le rejeu a quand même lieu', () => {
  const s = faux();
  const onTrame = creerReplicateur({ superviseur: s });

  onTrame(trame());

  assert.strictEqual(s.appels.length, 1);
});
