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
    frame: { kind: 'request', type: 'hiu', payload: [] },
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

  onTrame(trame({ frame: { kind: 'response', type: 'hiu', payload: [] } }));

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
  // retardPlancher est toujours present dans l'appel, meme a 0 pour un type
  // ordinaire: rejouer() gagne un parametre, son contrat s'elargit, et cette
  // forme est desormais celle attendue pour tous les types.
  assert.deepStrictEqual(s.appels[0], { type: 'hiu', brute, pidMaitre: 7, retardPlancher: 0 });
});

test('le compte rendu porte le nom du message, le rendu et le mode', () => {
  const rendu = [{ pid: 2, ok: true, emis: true, action: 'copier', octets: 12 }];
  const s = faux({ arme: true, rendu });
  const comptesRendus = [];
  const onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame({ pid: 7 }));

  assert.strictEqual(comptesRendus.length, 1);
  assert.deepStrictEqual(comptesRendus[0], {
    pidMaitre: 7, type: 'hiu', nom: 'TeleportRequest', arme: true, rendu,
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

  onTrame(trame({ frame: { kind: 'request', type: 'iva', payload: [] } }));

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
  d(sortante('inh', { 1: 25088 }));
  assert.strictEqual(sup.appels[0].retardPlancher, DELAI_PLANCHER_MS);
});

test('une action ordinaire garde son etalement seul', () => {
  const sup = superviseurQuiNoteLesRejeux();
  const d = creerDuplicateur({ superviseur: sup });
  d(sortante('hiu', { 1: 1, 2: 2 }));
  // Champ toujours present desormais: strictEqual sur 0, pas de || qui
  // masquerait un undefined aussi bien qu'une valeur fausse.
  assert.strictEqual(sup.appels[0].retardPlancher, 0);
});

// Une action deja vue lancer un combat n'est ni retardee ni tentee.
test('une action apprise n est pas rejouee du tout', () => {
  const sup = superviseurQuiNoteLesRejeux();
  const d = creerDuplicateur({ superviseur: sup, estApprise: (c) => c === 'inh:25088' });
  d(sortante('inh', { 1: 25088 }));
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
  d(sortante('inh', { 1: 25088 }));
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
  d(sortante('inh', { 1: 25088 }));
  assert.strictEqual(sup.appels.length, 1);
});

// LE DEFAUT DU 28/08: avec le suivi de groupe du jeu, des mules bouclaient
// sur une carte sans jamais passer a la suivante. Le rejeu du changement de
// carte etait la cause: le serveur le refusait a chaque fois (la mule n est
// pas sur la cellule de sortie), et ce refus annulait la marche que le suivi
// du jeu venait d entamer. Mesure complete dans test/duplication.test.js.
//
// Le refus se prend ICI, dans la politique, et pas dans le superviseur: la
// mecanique de rejeu reste capable de tout ecrire, c est la decision qui
// change.
test('un changement de carte n est jamais rejoué', () => {
  const s = faux();
  const comptesRendus = [];
  const onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame({ frame: { kind: 'request', type: 'jpp', payload: [{ no: 2, value: 191104000n }] } }));

  assert.strictEqual(s.appels.length, 0, 'rejouer() ne doit pas être appelé');
  // Silencieux, et c est voulu: ce rejeu n a JAMAIS fonctionne (0 sur 32
  // mesures), donc rien n est perdu qu il faille signaler. Un compte rendu de
  // refus s afficherait sur la ligne de chaque mule a chaque changement de
  // carte, en permanence, pour annoncer une absence sans consequence.
  assert.strictEqual(comptesRendus.length, 0);
});

// Le voisin immediat dans la table doit continuer de partir: le correctif
// vise UN type, pas la famille du deplacement.
test('la téléportation continue de se rejouer', () => {
  const s = faux();
  const onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: () => {} });

  onTrame(trame({ frame: { kind: 'request', type: 'hiu', payload: [] } }));

  assert.strictEqual(s.appels.length, 1);
});

// Meme raison que le changement de carte, sans le degat: le serveur ne repond
// a une demande d infos que pour la carte ou se tient le personnage. 78
// injections mesurees, 66 sans aucune reponse, zero pour la carte du maitre.
test('une demande d infos de carte n est jamais rejouée', () => {
  const s = faux();
  const comptesRendus = [];
  const onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame({ frame: { kind: 'request', type: 'jrh', payload: [{ no: 1, value: 191104000n }] } }));

  assert.strictEqual(s.appels.length, 0, 'rejouer() ne doit pas être appelé');
  assert.strictEqual(comptesRendus.length, 0);
});

// LA DEMANDE, verrouillee au niveau de la DECISION et pas seulement de la
// table: acheter au marchand PNJ, jamais a l'hotel de vente. Mesure du 29/08,
// detaillee dans test/duplication.test.js — l'achat au marchand est `kea`,
// celui de l'HDV est `kbm`, et ce sont deux types distincts.
test('l achat au marchand PNJ est rejoué', () => {
  const s = faux();
  const comptesRendus = [];
  const onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame({ frame: { kind: 'request', type: 'kaa', payload: [] } }));

  assert.strictEqual(s.appels.length, 1, "l'achat au marchand doit partir chez les mules");
  assert.strictEqual(s.appels[0].type, 'kaa');
  // Aucun plancher: le plancher ne protege que des actions qui ouvrent un
  // combat, et acheter n'en ouvre aucun.
  assert.strictEqual(s.appels[0].retardPlancher, 0);
  assert.strictEqual(comptesRendus.length, 1);
});

// Le refus tient a une ABSENCE — `kbm` n'est pas dans la table — donc il est
// SILENCIEUX, comme tout type hors table. Il n'y a rien a signaler: la mule ne
// rate pas une action, elle n'a jamais eu a en faire une.
test('l achat en hôtel de vente n est jamais rejoué, et sans un mot', () => {
  const s = faux();
  const comptesRendus = [];
  const onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  onTrame(trame({ frame: { kind: 'request', type: 'kbm', payload: [] } }));

  assert.strictEqual(s.appels.length, 0, "les mules ne doivent PAS acheter a l'HDV");
  assert.strictEqual(comptesRendus.length, 0);
});

// --- LE DIALOGUE DANS UN SONGE --------------------------------------------
//
// Dans un songe il n'y a qu'un PNJ, celui qui donne un boost, et le boost est
// au maitre — decision de l'utilisateur du 08/09. Le dialogue s'y coupe donc,
// et NULLE PART AILLEURS: la regle tient a l'endroit, pas au message. Le
// savoir d'ou l'on est vit dans src/songe-en-cours.js.
function fauxAvecEsclaves({ arme = true, esclaves = [2, 3] } = {}) {
  const appels = [];
  const etats = new Map(esclaves.map((pid) => [pid, { pid }]));
  return {
    arme,
    appels,
    comptes: { esclaves: () => [...etats.values()] },
    rejouer(args) { appels.push(args); return esclaves.map((pid) => ({ pid, ok: true, emis: true })); },
  };
}

const dialogue = (type, extra = {}) => trame({
  frame: { kind: 'request', type, payload: [{ no: 1, value: 237781005n }] },
  ...extra,
});

test('hors songe, le dialogue se rejoue comme avant', () => {
  for (const type of ['imp', 'inh', 'kiy']) {
    const s = fauxAvecEsclaves();
    const onTrame = creerDuplicateur({ superviseur: s, dansUnSonge: () => false });
    onTrame(dialogue(type));
    assert.strictEqual(s.appels.length, 1, `${type} doit se rejouer hors songe`);
  }
});

test('dans un songe, aucun des trois messages du dialogue ne se rejoue', () => {
  for (const type of ['imp', 'inh', 'kiy']) {
    const s = fauxAvecEsclaves();
    const onTrame = creerDuplicateur({ superviseur: s, dansUnSonge: () => true });
    onTrame(dialogue(type));
    assert.strictEqual(s.appels.length, 0, `${type} ne doit pas se rejouer dans un songe`);
  }
});

// Un refus muet est le mode d'echec le plus couteux du projet: une mule qui ne
// rejoue pas ressemble alors a une mule inactive. Le refus se rend donc
// esclave par esclave, comme celui du garde-combat.
test('le refus est rendu, esclave par esclave, avec sa raison', () => {
  const s = fauxAvecEsclaves({ esclaves: [2, 3] });
  const rendus = [];
  const onTrame = creerDuplicateur({
    superviseur: s, dansUnSonge: () => true, onCompteRendu: (c) => rendus.push(c),
  });

  onTrame(dialogue('inh'));

  assert.strictEqual(rendus.length, 1);
  assert.strictEqual(rendus[0].type, 'inh');
  assert.strictEqual(rendus[0].rendu.length, 2);
  for (const r of rendus[0].rendu) {
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.emis, false);
    assert.match(r.raison, /songe/);
  }
});

// La regle vise le dialogue, pas le songe entier: le maitre qui se teleporte
// depuis son songe emmene toujours ses mules.
test('dans un songe, ce qui n est pas un dialogue se rejoue quand meme', () => {
  const s = fauxAvecEsclaves();
  const onTrame = creerDuplicateur({ superviseur: s, dansUnSonge: () => true });
  onTrame(trame());
  assert.strictEqual(s.appels.length, 1);
});

// Sans esclave, il n'y a personne a qui expliquer le refus. Meme silence que
// le garde-combat, et pour la meme raison: annoncer un non-evenement.
test('sans esclave, le refus ne produit aucun compte rendu', () => {
  const s = fauxAvecEsclaves({ esclaves: [] });
  const rendus = [];
  const onTrame = creerDuplicateur({
    superviseur: s, dansUnSonge: () => true, onCompteRendu: (c) => rendus.push(c),
  });
  onTrame(dialogue('imp'));
  assert.strictEqual(rendus.length, 0);
  assert.strictEqual(s.appels.length, 0);
});

// Le defaut par defaut: sans la question, la politique est celle d'avant. Un
// appelant qui oublie de cabler le suivi ne coupe rien en silence.
test('sans dansUnSonge, le dialogue se rejoue: le defaut ne coupe rien', () => {
  const s = fauxAvecEsclaves();
  const onTrame = creerDuplicateur({ superviseur: s });
  onTrame(dialogue('imp'));
  assert.strictEqual(s.appels.length, 1);
});
