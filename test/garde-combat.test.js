'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  estSensible, cleDe,
  DELAI_PLANCHER_MS, FENETRE_APPRENTISSAGE_MS,
} = require('../src/garde-combat');
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
  // `ido` part avec un `kla` dans la meme milliseconde: le retarder seul
  // inverserait l'ordre des deux rejeux chez la mule. Voir src/garde-combat.js.
  for (const t of ['hjc', 'jqk', 'jrh', 'kla', 'kjw', 'jbn', 'ieb', 'ido']) {
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

test('les valeurs de reglage sont celles de la conception', () => {
  assert.strictEqual(DELAI_PLANCHER_MS, 250);
  assert.strictEqual(FENETRE_APPRENTISSAGE_MS, 2000);
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

// L'ENTREE EN COMBAT DU MAITRE, telle qu'elle arrive: la MEME kmk que celle
// d'une mule, reconnue liste de combat par son identifiant negatif. Mesuree le
// 02/09 a +61 ms de l'action du maitre, quand le premier rejeu d'un type
// sensible ne part pas avant 266 ms.
const entreeCombat = () => ({
  pid: MAITRE, dir: 'in', estMaitre: true, frame: listeCombat(ID_MAITRE),
});

// LA PROGRESSION DE QUETE, l'ancien signal. Les deux valeurs sont celles
// mesurees le 02/09 sur un RAMASSAGE sans le moindre combat.
const progressionQuete = () => ({
  pid: MAITRE, dir: 'in', estMaitre: true,
  frame: { kind: 'event', type: 'ieb', payload: [{ no: 1, value: 1639 }, { no: 2, value: 9815 }] },
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

// OMNI NE REPARE QUE CE QU'IL A CAUSE, ENCORE: comptes.esclaves() filtre deja
// les comptes EXCLUS de la duplication (src/protocol/compte.js), et le
// duplicateur comme creerAbandonGroupe le respectent. Un pid qui n'est pas
// dans cette liste n'a rejoue aucune action du maitre: son combat, quel qu'il
// soit, ne peut pas venir d'OMNI.
test('un pid exclu de la duplication ne fait rien retenir', () => {
  const sup = fauxSuperviseur([2, 3]); // esclaves reels : 2 et 3, pas 99
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: 99, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
});

// LE SILENCE EST LE MODE D'ECHEC LE PLUS COUTEUX DE CE PROJET
// (src/composer.js) : characterId n'est appris que d'un `kvw` sortant
// (src/protocol/compte.js), et OMNI attache a des process deja lances peut ne
// jamais le voir. Sans cette ligne, la politique s'eteint pour toute la
// session sans qu'aucune trace ne le dise.
test('un characterId de maitre inconnu se journalise au lieu de s eteindre en silence', () => {
  const sup = fauxSuperviseur();
  sup.comptes.get = (pid) => (pid === MAITRE ? { pid, characterId: null } : { pid, characterId: ID_MULE });
  const apprises = [];
  const lignes = [];
  const garde = creerGardeCombat({
    superviseur: sup, onApprendre: (c) => apprises.push(c), onJournal: (pid, texte) => lignes.push(texte),
  });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
  assert.ok(lignes.some((l) => l.includes('characterId') && l.includes('inconnu')), 'la panne est dite');
});

// LE DEFAUT CORRIGE, ecrit en toutes lettres: le maitre qui entre en combat
// est un evenement de jeu ordinaire. Il annule les rejeux en attente, et c'est
// tout ce qu'il fait.
test('l entree en combat du maitre annule les rejeux mais ne retient RIEN', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: MAITRE, dir: 'in', frame: listeCombat(ID_MAITRE), estMaitre: true });
  assert.strictEqual(sup.annulations, 1, 'les rejeux en attente sont annules');
  assert.deepStrictEqual(apprises, [], 'mais rien n est retenu');
});

// L'ORDRE REEL EN JEU, epingle sur la mesure du 02/09: ioy du maitre, sa
// propre kmk 61 ms plus tard (l'annulation), puis la kmk de la mule. La
// retention depend de ce que la branche d'annulation NE CONSOMME PAS
// derniereAction -- un changement qui "restaurerait la symetrie" avec
// l'annulation tuerait la politique en silence, tous les autres tests
// restant verts.
test('la sequence reelle ioy puis kmk du maitre puis kmk de la mule retient et annule', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: MAITRE, dir: 'in', frame: listeCombat(ID_MAITRE), estMaitre: true });
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, ['ioy:25088']);
  assert.strictEqual(sup.annulations, 1);
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

// LE DEFAUT DU 02/09, EPINGLE — le seul test qui aurait vu venir le bug
// d'Ilan. `ieb` est une PROGRESSION DE QUETE, pas une entree en combat: meme
// compte, meme session, `1639/9815` sur un ramassage SANS le moindre combat et
// `1642/9828` sur un combat de quete. Ces dernieres valeurs sont identiques a
// celles du 28/08 sur la meme etape, a cinq jours d'ecart: ce ne sont pas des
// compteurs, ce sont des identifiants de quete.
//
// Le garde en faisait un signal de combat et coupait les rejeux de toutes les
// mules sur une simple recolte. Il ne doit plus rien couper.
test('une progression de quete n annule aucun rejeu', () => {
  const sup = fauxSuperviseur();
  const { g } = garde(sup);
  g(sortante('iwo', { 1: 17442, 2: 538794 }));
  g(progressionQuete());
  assert.strictEqual(sup.annulations, 0, 'aucun combat: rien ne doit etre coupe');
});

// Une kmk sert aussi a lister les acteurs d'une CARTE. Chez le maitre comme
// chez l'esclave, c'est l'identifiant NEGATIF -- un monstre -- qui distingue un
// combat, et rien d'autre. Meme critere, meme fonction: combattantsDe() de
// src/abandon-combat.js.
test('une liste d acteurs de carte chez le maitre n annule rien', () => {
  const sup = fauxSuperviseur();
  const { g } = garde(sup);
  g(sortante('ioy', { 1: 25088 }));
  g({ pid: MAITRE, dir: 'in', estMaitre: true, frame: listeCarte(ID_MAITRE) });
  assert.strictEqual(sup.annulations, 0);
});

// LE GARDE N'EMET PLUS RIEN. La fermeture du dialogue des esclaves a ete
// retiree le 02/09 a la demande de l'utilisateur: une mule dont le rejeu vient
// d'etre annule n'a jamais ouvert le dialogue, et celle qui l'a ouvert peut le
// garder. Ce test tient la promesse pour tout le module.
test('l entree en combat n emet aucune trame vers les esclaves', () => {
  const sup = fauxSuperviseur([2, 3]);
  const { g } = garde(sup);
  g(sortante('ioy', { 1: 25088 }));
  g(entreeCombat());
  assert.deepStrictEqual(sup.emis, [], 'le garde ne ferme plus aucun dialogue');
});

test('un combat sans action prealable ne retient rien', () => {
  const sup = fauxSuperviseur();
  const { g, retenues } = garde(sup);
  g(entreeCombat());
  assert.deepStrictEqual(retenues, []);
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

// L'entree en combat d'un ESCLAVE n'annule RIEN: c'est le maitre, et lui seul,
// qui dit qu'un combat commence. La kmk d'une mule sert a apprendre, jamais a
// couper -- couper a ce moment-la ne servirait a rien, le degat a deja eu lieu.
test('l entree en combat d un esclave n annule aucun rejeu', () => {
  const sup = fauxSuperviseur();
  const { g, retenues } = garde(sup);
  g(sortante('ioy', { 1: 25088 }));
  g({ pid: 2, dir: 'in', estMaitre: false, frame: listeCombat(ID_MULE) });
  assert.strictEqual(sup.annulations, 0, 'seul le maitre annule');
  assert.deepStrictEqual(retenues, ['ioy:25088'], 'mais l action est bien retenue');
});

test('une trame entrante d un autre type ne declenche rien', () => {
  const sup = fauxSuperviseur();
  const { g } = garde(sup);
  g({ pid: MAITRE, dir: 'in', estMaitre: true, frame: { kind: 'event', type: 'jru', payload: [{ no: 2, value: 153486336 }] } });
  assert.strictEqual(sup.annulations, 0);
});

// UN IWO SUCCEDE A UN DIALOGUE SANS EN HERITER: le combat qu'il declenche n'a
// rien a voir avec la reponse de dialogue qui l'a precede. C'est la derniere
// action qui compte, et c'est elle qui sera retenue.
test('un iwo precede d un dialogue fait retenir le iwo, pas le dialogue', () => {
  const sup = fauxSuperviseur([2, 3]);
  const { g, retenues } = garde(sup);
  g(sortante('ioy', { 1: 25088 }));
  g(sortante('iwo', { 1: 1920, 2: 489565 }));
  g({ pid: 2, dir: 'in', estMaitre: false, frame: listeCombat(ID_MULE) });
  assert.deepStrictEqual(retenues, ['iwo:489565']);
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
