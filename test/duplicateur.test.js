'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerDuplicateur, ETALEMENT_REJEU, MIN_TICK_WINDOWS } = require('../src/duplicateur');

// Ce test verrouille une MESURE, pas une preference. Sous le pas des minuteurs
// Windows (~15,6 ms), deux echeances retombent dans le meme tick et s'ecrivent
// dans le meme tour de boucle: l'ecart annonce ne se retrouve pas sur le
// reseau. Constate sur 3 essais avec un plancher a 1 ms — 149,2 et 149,3 ms
// pour 6 ms d'ecart annonce. Abaisser minMs sous ce seuil rend l'etalement
// decoratif.
test('le plancher d étalement dépasse le pas des minuteurs Windows', () => {
  assert.ok(
    ETALEMENT_REJEU.minMs >= MIN_TICK_WINDOWS,
    `minMs=${ETALEMENT_REJEU.minMs} : sous ${MIN_TICK_WINDOWS} ms, deux comptes partent sur la même milliseconde`,
  );
  assert.ok(ETALEMENT_REJEU.maxMs > ETALEMENT_REJEU.minMs);
});

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
  const onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame({ dir: 'in' }));

  assert.strictEqual(s.appels.length, 0);
  assert.strictEqual(comptesRendus.length, 0);
});

test('une réponse sortante n est pas rejouée, seules les requêtes le sont', () => {
  const s = faux();
  const onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: () => {} });

  onTrame(trame({ frame: { kind: 'response', type: 'hjc', payload: [] } }));

  assert.strictEqual(s.appels.length, 0);
});

// Seul le client au premier plan dicte l'action; celles des autres sont deja
// les leurs.
test('une trame sortante d un non-maître n est pas rejouée', () => {
  const s = faux();
  const comptesRendus = [];
  const onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame({ estMaitre: false }));

  assert.strictEqual(s.appels.length, 0);
  assert.strictEqual(comptesRendus.length, 0);
});

// Emettre une trame dont on ne sait rien serait pire que de s'abstenir.
test('un type inconnu n est pas rejoué', () => {
  const s = faux();
  const comptesRendus = [];
  const onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame({ frame: { kind: 'request', type: 'zzz', payload: [] } }));

  assert.strictEqual(s.appels.length, 0);
  assert.strictEqual(comptesRendus.length, 0);
});

test('une trame sortante du maître d un type connu déclenche rejouer', () => {
  const s = faux();
  const brute = Buffer.from([0x08, 0x2a]);
  const onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: () => {} });

  onTrame(trame({ pid: 7, brute }));

  assert.strictEqual(s.appels.length, 1);
  assert.deepStrictEqual(s.appels[0], { type: 'hjc', brute, pidMaitre: 7 });
});

test('le compte rendu porte le nom du message, le rendu et le mode', () => {
  const rendu = [{ pid: 2, ok: true, emis: true, action: 'copier', octets: 12 }];
  const s = faux({ arme: true, rendu });
  const comptesRendus = [];
  const onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

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
  const onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

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
  const onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame({ frame: { kind: 'request', type: 'iwo', payload: [] } }));

  assert.strictEqual(comptesRendus[0].nom, 'InteractiveUseRequest');
  assert.deepStrictEqual(comptesRendus[0].rendu, rendu);
});

// Le rappel est facultatif: un appelant qui ne veut que le rejeu ne doit pas
// avoir a en fournir un.
test('sans rappel de compte rendu, le rejeu a quand même lieu', () => {
  const s = faux();
  const onTrame = creerDuplicateur({ superviseur: s });

  onTrame(trame());

  assert.strictEqual(s.appels.length, 1);
});

// --- garde contre les combats dupliques ------------------------------------

const { DELAI_PLANCHER_MS } = require('../src/garde-combat');

function superviseurQuiNoteLesRejeux(esclaves = [2]) {
  const appels = [];
  return {
    appels,
    arme: true,
    comptes: { esclaves: () => esclaves.map((pid) => ({ pid })) },
    rejouer: (args) => {
      appels.push(args);
      return esclaves.map((pid) => ({ pid, ok: true, emis: true, retardMs: args.retardPlancher || 0 }));
    },
  };
}

const sortante = (type, champs) => ({
  pid: 1, dir: 'out', estMaitre: true, brute: Buffer.from([0x08, 0x01]),
  frame: {
    kind: 'request', type,
    payload: Object.entries(champs).map(([no, value]) => ({ no: Number(no), value })),
  },
});

// Les trois types qui peuvent ouvrir un combat partent avec le plancher: le
// serveur annonce le combat au maitre 30 ms apres son action, et il faut que
// rien ne soit encore ecrit a cet instant.
test('une action sensible part avec le plancher de retard', () => {
  const sup = superviseurQuiNoteLesRejeux();
  const d = creerDuplicateur({ superviseur: sup });
  d(sortante('ioy', { 1: 25088 }));
  assert.strictEqual(sup.appels[0].retardPlancher, DELAI_PLANCHER_MS);
});

test('une action ordinaire garde son etalement seul', () => {
  const sup = superviseurQuiNoteLesRejeux();
  const d = creerDuplicateur({ superviseur: sup });
  d(sortante('hjc', { 1: 1, 2: 2 }));
  assert.strictEqual(sup.appels[0].retardPlancher || 0, 0);
});

// Une action deja vue lancer un combat n'est ni retardee ni tentee.
test('une action apprise n est pas rejouee du tout', () => {
  const sup = superviseurQuiNoteLesRejeux();
  const d = creerDuplicateur({ superviseur: sup, estApprise: (c) => c === 'ioy:25088' });
  d(sortante('ioy', { 1: 25088 }));
  assert.strictEqual(sup.appels.length, 0, 'rejouer ne doit pas etre appele');
});

// Un compte qui ne rejoue pas ressemble a un compte inactif: le refus doit se
// voir sur sa ligne, comme tout autre refus de rejeu.
test('le refus est signale pour chaque esclave', () => {
  const sup = superviseurQuiNoteLesRejeux([2, 3]);
  const rendus = [];
  const d = creerDuplicateur({
    superviseur: sup,
    estApprise: () => true,
    onCompteRendu: (r) => rendus.push(r),
  });
  d(sortante('ioy', { 1: 25088 }));
  assert.strictEqual(rendus.length, 1);
  assert.deepStrictEqual(rendus[0].rendu.map((r) => r.pid), [2, 3]);
  for (const r of rendus[0].rendu) {
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.emis, false);
    assert.match(r.raison, /combat/);
  }
});

// Sans estApprise, le duplicateur se comporte comme avant.
test('sans liste apprise, tout se rejoue comme avant', () => {
  const sup = superviseurQuiNoteLesRejeux();
  const d = creerDuplicateur({ superviseur: sup });
  d(sortante('ioy', { 1: 25088 }));
  assert.strictEqual(sup.appels.length, 1);
});
