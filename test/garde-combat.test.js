'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  estSensible, cleDe, TRAME_FERMER_DIALOGUE,
  DELAI_PLANCHER_MS, FENETRE_APPRENTISSAGE_MS, FENETRE_DIALOGUE_MS,
} = require('../src/garde-combat');
const { decodeFrameRaw } = require('../src/codec/rawProto');
const { creerGardeCombat } = require('../src/garde-combat');

const trame = (type, champs) => ({
  kind: 'request', type,
  payload: Object.entries(champs).map(([no, value]) => ({ no: Number(no), value })),
});

// Les trois types qui peuvent lancer un combat, et eux seuls. Les cinq autres
// types rejoues — teleportation, changement de carte, information de carte,
// havre-sac, sortie de donjon — ne declenchent aucun combat.
test('seuls les trois types de dialogue et d interaction sont sensibles', () => {
  for (const t of ['iov', 'ioy', 'iwo']) assert.strictEqual(estSensible(t), true, t);
  for (const t of ['hjc', 'jqk', 'jrh', 'kla', 'kjw', 'jbn', 'ieb']) {
    assert.strictEqual(estSensible(t), false, t);
  }
});

// Les valeurs viennent de la capture du 28/08: le maitre a repondu ioy 25088,
// et le combat a demarre 30 ms plus tard.
test('la cle d une reponse de dialogue porte son numero', () => {
  assert.strictEqual(cleDe('ioy', trame('ioy', { 1: 25088 })), 'ioy:25088');
});

test('la cle d un PNJ porte sa carte et son instance', () => {
  assert.strictEqual(cleDe('iov', trame('iov', { 1: 3, 2: 153356294, 3: -20000 })), 'iov:153356294:-20000');
});

test('la cle d un element interactif porte son identifiant', () => {
  assert.strictEqual(cleDe('iwo', trame('iwo', { 1: 1920, 2: 489565 })), 'iwo:489565');
});

test('un type non sensible n a pas de cle', () => {
  assert.strictEqual(cleDe('hjc', trame('hjc', { 1: 1, 2: 2 })), null);
  assert.strictEqual(cleDe('ieb', trame('ieb', { 1: 1642, 2: 9828 })), null);
});

// UNE CLE PARTIELLE EST PIRE QUE PAS DE CLE: elle bloquerait une autre action
// que celle qu'on a vue lancer un combat.
test('un champ manquant ne donne pas de cle partielle', () => {
  assert.strictEqual(cleDe('iov', trame('iov', { 2: 153356294 })), null);
  assert.strictEqual(cleDe('ioy', trame('ioy', {})), null);
  assert.strictEqual(cleDe('iwo', trame('iwo', { 1: 1920 })), null);
});

test('une trame absente ou malformee ne donne pas de cle', () => {
  assert.strictEqual(cleDe('ioy', null), null);
  assert.strictEqual(cleDe('ioy', 'x'), null);
  assert.strictEqual(cleDe('ioy', { kind: 'request', type: 'ioy', payload: null }), null);
});

// Les valeurs BigInt du decodeur doivent rendre la meme cle que les nombres,
// sans quoi la liste apprise ne reconnaitrait jamais l'action rejouee.
test('un champ BigInt rend la meme cle qu un nombre', () => {
  assert.strictEqual(cleDe('ioy', trame('ioy', { 1: 25088n })), 'ioy:25088');
});

test('la trame de fermeture de dialogue est un kla sans charge utile', () => {
  const f = decodeFrameRaw(TRAME_FERMER_DIALOGUE);
  assert.notStrictEqual(f, null);
  assert.strictEqual(f.kind, 'request');
  assert.strictEqual(f.type, 'kla');
  assert.ok(f.payload === null || f.payload.length === 0, 'kla ne porte aucun champ');
});

test('les valeurs de reglage sont celles de la conception', () => {
  assert.strictEqual(DELAI_PLANCHER_MS, 250);
  assert.strictEqual(FENETRE_APPRENTISSAGE_MS, 2000);
  assert.strictEqual(FENETRE_DIALOGUE_MS, 30000);
});

// --- le garde lui-meme -----------------------------------------------------

const MAITRE = 1;

// Les characterId mesures le 2026-09-01, repris de test/abandon-combat.test.js
// pour que les deux modules se testent sur le meme trafic.
const ID_MAITRE = 676438999334n;
const ID_MULE = 677048221990n;

function fauxSuperviseur(esclaves = [2, 3]) {
  const emis = [];
  let annulations = 0;
  return {
    emis,
    get annulations() { return annulations; },
    arme: true,
    annulerRejeux: () => { annulations += 1; return 2; },
    emettre: (pid, octets) => { emis.push({ pid, octets }); return { ok: true }; },
    comptes: {
      esclaves: () => esclaves.map((pid) => ({ pid })),
      get: (pid) => (pid === MAITRE
        ? { pid, characterId: ID_MAITRE }
        : { pid, characterId: ID_MULE }),
    },
  };
}

// Une kmk telle qu'elle arrive: un combattant par champ 2, cellule au champ 1,
// ORIENTATION au champ 2, identifiant au champ 3. Un identifiant NEGATIF est
// un monstre, et c'est lui seul qui distingue un combat d'une liste de carte.
const combattant = (id) => ({
  no: 2, kind: 'message',
  value: [{ no: 1, value: 400n }, { no: 2, value: 3n }, { no: 3, value: id }],
});
const listeCombat = (...ids) => ({
  kind: 'event', type: 'kmk',
  payload: [combattant(-1n), ...ids.map(combattant)],
});
const listeCarte = (...ids) => ({
  kind: 'event', type: 'kmk', payload: ids.map(combattant),
});

const sortante = (type, champs) => ({
  pid: MAITRE, dir: 'out', estMaitre: true, frame: {
    kind: 'request', type,
    payload: Object.entries(champs).map(([no, value]) => ({ no: Number(no), value })),
  },
});

const entreeCombat = () => ({
  pid: MAITRE, dir: 'in', estMaitre: true,
  frame: { kind: 'event', type: 'ieb', payload: [{ no: 1, value: 1642 }, { no: 2, value: 9828 }] },
});

function garde(sup, extra = {}) {
  const retenues = [];
  const lignes = [];
  const horloge = { t: 1000 };
  const g = creerGardeCombat({
    superviseur: sup,
    onApprendre: (c) => retenues.push(c),
    onJournal: (pid, texte) => lignes.push({ pid, texte }),
    maintenant: () => horloge.t,
    ...extra,
  });
  return { g, retenues, lignes, horloge };
}

// CE QUI N'EST PAS ENCORE ECRIT NE PARTIRA PAS. C'est la moitie du mecanisme:
// le serveur annonce le combat au maitre 30 ms apres son action, bien avant
// l'echeance d'un rejeu retarde de 250 ms.
test('l entree en combat annule les rejeux en attente', () => {
  const sup = fauxSuperviseur();
  const { g, lignes } = garde(sup);
  g(sortante('ioy', { 1: 25088 }));
  g(entreeCombat());
  assert.strictEqual(sup.annulations, 1);
  assert.ok(lignes.some((l) => /annule/.test(l.texte)), 'l annulation doit se journaliser');
});

// onAnnulation est le canal visible en usage normal (voir desktop/main.js) :
// distinct de onJournal, qui reste muet hors OMNI_JOURNAL=complet.
test('onAnnulation recoit le nombre de rejeux annules', () => {
  const sup = fauxSuperviseur();
  const appels = [];
  const { g } = garde(sup, { onAnnulation: (n) => appels.push(n) });
  g(sortante('ioy', { 1: 25088 }));
  g(entreeCombat());
  assert.deepStrictEqual(appels, [2]);
});

// NE PAS PREVENIR POUR RIEN : une annulation de zero rejeu ne doit rien
// afficher.
test('onAnnulation n est pas appele si aucun rejeu n etait en attente', () => {
  const sup = fauxSuperviseur();
  sup.annulerRejeux = () => 0;
  const appels = [];
  const { g } = garde(sup, { onAnnulation: (n) => appels.push(n) });
  g(sortante('ioy', { 1: 25088 }));
  g(entreeCombat());
  assert.deepStrictEqual(appels, []);
});

// LE COEUR DU CHANGEMENT. Ce qui compte n'est pas que le maitre se batte —
// c'est jouer normalement — mais qu'une mule se soit ouvert SON combat.
test('une mule en combat SANS le maitre fait retenir l action', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, ['ioy:25088']);
});

test('une mule en combat AVEC le maitre ne fait rien retenir', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MAITRE, ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
});

// Une kmk sert aussi a lister les acteurs d'une CARTE, ou personne ne combat.
test('une liste d acteurs de carte ne fait rien retenir', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: 2, dir: 'in', frame: listeCarte(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
});

test('hors de la fenetre d apprentissage, rien n est retenu', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  let t = 1000;
  const garde = creerGardeCombat({
    superviseur: sup, onApprendre: (c) => apprises.push(c), maintenant: () => t,
  });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  t += FENETRE_APPRENTISSAGE_MS + 1;
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
});

// LA BORNE, EPINGLEE: rien ici ne distingue < de <=, et la kmk d'une mule
// arrivant pile a l'echeance ne doit rien retenir.
test('une kmk d une mule a exactement la fenetre d apprentissage ne retient rien', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  let t = 1000;
  const garde = creerGardeCombat({
    superviseur: sup, onApprendre: (c) => apprises.push(c), maintenant: () => t,
  });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  t += FENETRE_APPRENTISSAGE_MS;
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
});

test('une kmk d une mule juste avant l echeance retient l action', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  let t = 1000;
  const garde = creerGardeCombat({
    superviseur: sup, onApprendre: (c) => apprises.push(c), maintenant: () => t,
  });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  t += FENETRE_APPRENTISSAGE_MS - 1;
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, ['ioy:25088']);
});

test('sans action sensible recente, une mule en combat ne fait rien retenir', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
});

// LE DEFAUT CORRIGE, ecrit en toutes lettres: le maitre qui entre en combat
// est un evenement de jeu ordinaire. Il annule les rejeux en attente, et c'est
// tout ce qu'il fait.
test('le ieb du maitre annule les rejeux mais ne retient RIEN', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: MAITRE, dir: 'in', frame: trame('ieb', { 1: 1642, 2: 9828 }), estMaitre: true });
  assert.strictEqual(sup.annulations, 1, 'les rejeux en attente sont annules');
  assert.deepStrictEqual(apprises, [], 'mais rien n est retenu');
});

test('deux mules dans deux combats distincts ne font qu une entree', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  garde({ pid: 3, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, ['ioy:25088']);
});

test('sans duplication armee, rien n est retenu', () => {
  const sup = fauxSuperviseur();
  sup.arme = false;
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
});

test('une action deja connue n est pas retenue deux fois', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({
    superviseur: sup, estApprise: () => true, onApprendre: (c) => apprises.push(c),
  });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
});

// Les reponses precedentes de l'enchainement sont parties il y a plusieurs
// secondes et ne sont pas annulables; le maitre, lui, ne fermera jamais le
// dialogue des esclaves puisqu'il est en combat.
test('le dialogue des esclaves est ferme apres un dialogue recent', () => {
  const sup = fauxSuperviseur([2, 3]);
  const { g } = garde(sup);
  g(sortante('ioy', { 1: 25088 }));
  g(entreeCombat());
  assert.deepStrictEqual(sup.emis.map((e) => e.pid), [2, 3]);
  assert.deepStrictEqual(sup.emis[0].octets, TRAME_FERMER_DIALOGUE);
});

test('aucun dialogue n est ferme si le dernier remonte a trop longtemps', () => {
  const sup = fauxSuperviseur();
  const { g, horloge } = garde(sup);
  g(sortante('ioy', { 1: 25088 }));
  horloge.t += 31000;
  g(entreeCombat());
  assert.deepStrictEqual(sup.emis, []);
});

// Un combat ouvert par un element interactif n'a jamais ouvert de dialogue: il
// n'y a rien a fermer, et un kla envoye pour rien est une trame de plus sans
// raison.
// La retention ne se verifie plus ici: depuis le 01/09 elle exige une kmk
// d'esclave (voir plus haut), qu'aucun de ces deux tests n'envoie. Ce qu'ils
// verifient reste entier: un iwo ne fait fermer aucun dialogue.
test('un element interactif ne fait fermer aucun dialogue', () => {
  const sup = fauxSuperviseur();
  const { g } = garde(sup);
  g(sortante('iwo', { 1: 1920, 2: 489565 }));
  g(entreeCombat());
  assert.deepStrictEqual(sup.emis, []);
});

test('un combat sans action prealable ne retient rien et ne ferme rien', () => {
  const sup = fauxSuperviseur();
  const { g, retenues } = garde(sup);
  g(entreeCombat());
  assert.deepStrictEqual(retenues, []);
  assert.deepStrictEqual(sup.emis, []);
  assert.strictEqual(sup.annulations, 1, 'l annulation, elle, reste utile');
});

// OMNI NE REPARE QUE CE QU'IL A CAUSE: sans duplication armee, aucun esclave
// n'a rejoue quoi que ce soit.
test('rien ne se passe si la duplication n est pas armee', () => {
  const sup = fauxSuperviseur();
  sup.arme = false;
  const { g, retenues } = garde(sup);
  g(sortante('ioy', { 1: 25088 }));
  g(entreeCombat());
  assert.strictEqual(sup.annulations, 0);
  assert.deepStrictEqual(retenues, []);
  assert.deepStrictEqual(sup.emis, []);
});

// L'entree en combat d'un ESCLAVE ne dit rien: c'est justement ce qu'on essaie
// d'empecher, et l'action a retenir est celle du maitre.
test('l entree en combat d un esclave ne declenche rien', () => {
  const sup = fauxSuperviseur();
  const { g, retenues } = garde(sup);
  g(sortante('ioy', { 1: 25088 }));
  g({ pid: 2, dir: 'in', estMaitre: false, frame: { kind: 'event', type: 'ieb', payload: [] } });
  assert.strictEqual(sup.annulations, 0);
  assert.deepStrictEqual(retenues, []);
});

test('une trame entrante d un autre type ne declenche rien', () => {
  const sup = fauxSuperviseur();
  const { g } = garde(sup);
  g({ pid: MAITRE, dir: 'in', estMaitre: true, frame: { kind: 'event', type: 'jru', payload: [{ no: 2, value: 153486336 }] } });
  assert.strictEqual(sup.annulations, 0);
});

// Un envoi refuse — socket fermee — se journalise sans lever: le garde tourne
// sous un rappel du superviseur, ou une exception n'a personne pour la
// rattraper.
test('un refus de fermeture se journalise sans lever', () => {
  const sup = fauxSuperviseur([2]);
  sup.emettre = () => ({ ok: false, raison: 'pas de socket amont' });
  const { g, lignes } = garde(sup);
  g(sortante('ioy', { 1: 25088 }));
  assert.doesNotThrow(() => g(entreeCombat()));
  assert.ok(lignes.some((l) => /socket amont/.test(l.texte)));
});

// UN IWO NE HERITE PAS D'UN DIALOGUE ANTERIEUR: le combat qu'il declenche
// n'a rien a voir avec la reponse de dialogue qui l'a precede, meme sans
// combat entre les deux pour la consommer explicitement.
test('un iwo precede d un dialogue ne fait fermer aucun dialogue', () => {
  const sup = fauxSuperviseur([2, 3]);
  const { g } = garde(sup);
  g(sortante('ioy', { 1: 25088 }));
  g(sortante('iwo', { 1: 1920, 2: 489565 }));
  g(entreeCombat());
  assert.deepStrictEqual(sup.emis, []);
});

// Le devis restreint les destinataires a ceux qui avaient reellement le
// dialogue ouvert: un client connecte entre le dialogue et le combat n'a
// jamais vu ce dialogue-la, et l'effet d'un kla a vide n'est pas mesure.
test('un esclave apparu apres le dialogue ne recoit rien', () => {
  const esclaves = [2];
  const sup = fauxSuperviseur(esclaves);
  const { g } = garde(sup);
  g(sortante('ioy', { 1: 25088 }));
  esclaves.push(3);
  g(entreeCombat());
  assert.deepStrictEqual(sup.emis.map((e) => e.pid), [2]);
});

// onApprendre ecrit la liste apprise sur le disque dans l application: une
// exception la-dedans ne doit pas remonter jusqu'au superviseur, qui tourne
// le garde sous un rappel sans personne pour la rattraper.
test('une exception dans onApprendre est journalisee, pas propagee', () => {
  const sup = fauxSuperviseur();
  const lignes = [];
  const garde = creerGardeCombat({
    superviseur: sup,
    onApprendre: () => { throw new Error('disque plein'); },
    onJournal: (pid, texte) => lignes.push(texte),
  });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  assert.doesNotThrow(() => {
    garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  });
  assert.ok(lignes.some((l) => l.includes('disque plein')), 'la panne est dite');
});

test('un dialogue a exactement trente secondes ne fait fermer aucun dialogue', () => {
  const sup = fauxSuperviseur([2]);
  const { g, horloge } = garde(sup);
  g(sortante('ioy', { 1: 25088 }));
  horloge.t += FENETRE_DIALOGUE_MS;
  g(entreeCombat());
  assert.deepStrictEqual(sup.emis, []);
});
