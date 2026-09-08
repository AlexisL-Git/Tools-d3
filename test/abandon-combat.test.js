'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  creerAbandonGroupe, combattantsDe,
  TYPES_ABANDON, TYPE_COMBATTANTS, CHAMP_COMBATTANT, CHAMP_ID,
} = require('../src/abandon-combat');

// Les characterId mesures le 2026-09-01. Le decodeur rend des BigInt sur ces
// champs: les tests les gardent tels quels pour rester fideles au trafic reel.
const MAITRE = 676438999334n;
const MULE = 677048221990n;
const ETRANGER = 123456789012n;

// Un combattant, tel qu'il apparait dans kkr depuis le patch du 08/09:
// IDENTIFIANT au champ 1, ORIENTATION (0 a 7, sans rapport avec le role de
// l'acteur) au champ 2, cellule au champ 4. Un identifiant negatif est un
// monstre, un identifiant positif un characterId -- voir la ronde de
// correction 1 dans src/abandon-combat.js.
//
// LE HELPER SE CONSTRUIT SUR LES CONSTANTES EXPORTEES plutot que sur des
// numeros litteraux: au prochain patch, ces tests suivront le remappage sans
// retouche. La forme reelle, elle, est verrouillee par le test de fin de
// fichier, qui lit des octets captures en jeu.
const combattant = (orientation, id) => ({
  no: CHAMP_COMBATTANT, kind: 'message',
  value: [{ no: CHAMP_ID, value: id }, { no: 2, value: orientation }, { no: 4, value: 400n }],
});

// Un combat contre des monstres: toujours au moins un identifiant negatif.
// Les orientations sont volontairement variees (7, 5, 1, 5...) comme mesure
// en jeu cette nuit -- le champ 2 ne joue aucun role dans le tri, seul le
// signe du champ 3 en joue un.
const listeCombat = (...ids) => ({
  kind: 'event', type: TYPE_COMBATTANTS,
  payload: [
    combattant(7n, -1n), combattant(5n, -2n),
    ...ids.map((id, i) => combattant(i % 2 === 0 ? 1n : 5n, id)),
  ],
});

// Un combat JOUEUR CONTRE JOUEUR: uniquement des identifiants positifs,
// aucun monstre donc aucun negatif. C'est le cas assume ou l'abandon groupe
// ne se declenche pas -- voir la ronde de correction 1.
const listeCombatSansMonstre = (...ids) => ({
  kind: 'event', type: TYPE_COMBATTANTS,
  payload: ids.map((id, i) => combattant(i % 2 === 0 ? 3n : 6n, id)),
});

// Une kmk d'acteurs de carte: uniquement des identifiants positifs, aucun
// negatif. Rien au champ 2 ne la distingue plus d'un combat -- c'est
// justement l'absence de negatif qui la designe depuis la correction.
const listeCarte = () => ({
  kind: 'event', type: TYPE_COMBATTANTS,
  payload: [combattant(0n, MAITRE), combattant(2n, MULE)],
});

const recu = (pid, frame) => ({
  pid, dir: 'in', estMaitre: pid === 1, brute: Buffer.alloc(0), frame,
});

// La trame d'abandon est vide et se re-emet telle quelle: son contenu exact
// n'importe pas au module, seuls comptent son type et ses octets.
const BRUTE = Buffer.from('0102030405', 'hex');
const abandon = (pid = 1, estMaitre = true, type = TYPES_ABANDON[0]) => ({
  pid, dir: 'out', estMaitre, brute: BRUTE,
  frame: { kind: 'request', type, payload: [] },
});

// Le maitre est le pid 1. Les esclaves rendus par comptes.esclaves() sont ceux
// qu'on donne: le module ne les choisit pas, il les filtre.
function fauxSuperviseur({ arme = true, esclaves = [2], emettre = null } = {}) {
  const emis = [];
  const etats = new Map([[1, { pid: 1, characterId: MAITRE }]]);
  for (const pid of esclaves) etats.set(pid, { pid, characterId: MULE });
  return {
    arme,
    emis,
    etats,
    comptes: {
      get: (pid) => etats.get(pid) || null,
      esclaves: () => esclaves.map((pid) => etats.get(pid)),
    },
    emettre: emettre || ((pid, octets) => { emis.push({ pid, octets }); return { ok: true, octets: octets.length }; }),
  };
}

function politique(sup, rendu = []) {
  const f = creerAbandonGroupe({ superviseur: sup, onCompteRendu: (r) => rendu.push(r) });
  f.rendu = rendu;
  return f;
}

test('la liste de combat rend tous les identifiants, monstres compris', () => {
  // combattantsDe ne trie plus par role: elle rend TOUT le monde. C'est la
  // presence d'un negatif qui fait qu'elle rend quelque chose du tout --
  // voir le test suivant.
  const vus = combattantsDe(listeCombat(MAITRE, MULE));
  assert.deepStrictEqual([...vus].sort(), ['-1', '-2', String(MAITRE), String(MULE)].sort());
});

test('une liste d acteurs de carte ne rend aucun combattant', () => {
  assert.strictEqual(combattantsDe(listeCarte()), null);
});

// RONDE DE CORRECTION 1 -- consequence assumee: sans le moindre monstre, rien
// ne fait lever de negatif, et combattantsDe rend null comme pour une liste
// de carte. Un abandon rate, jamais un abandon de trop.
test('un combat joueur contre joueur, sans monstre, ne rend aucun combattant', () => {
  assert.strictEqual(combattantsDe(listeCombatSansMonstre(MAITRE, MULE)), null);
});

test('une trame malformee ne rend aucun combattant', () => {
  assert.strictEqual(combattantsDe(null), null);
  assert.strictEqual(combattantsDe({ kind: 'event', type: TYPE_COMBATTANTS }), null);
});

test('une mule du meme combat abandonne avec le maitre', () => {
  const sup = fauxSuperviseur();
  const p = politique(sup);
  p(recu(1, listeCombat(MAITRE, MULE)));
  p(recu(2, listeCombat(MAITRE, MULE)));
  p(abandon());
  assert.strictEqual(sup.emis.length, 1);
  assert.strictEqual(sup.emis[0].pid, 2);
  // La trame partie est CELLE DU MAITRE, octet pour octet.
  assert.strictEqual(sup.emis[0].octets.toString('hex'), BRUTE.toString('hex'));
  assert.deepStrictEqual(p.rendu.map((r) => [r.pid, r.ok]), [[2, true]]);
});

// LE TEST QUI PORTE LA DEMANDE: un combat de quete est solo, le maitre y est
// seul, la mule ne recoit aucune liste ou n'y voit pas le maitre.
test('une mule dans un autre combat ne recoit rien', () => {
  const sup = fauxSuperviseur();
  const p = politique(sup);
  p(recu(1, listeCombat(MAITRE)));
  p(recu(2, listeCombat(ETRANGER, MULE)));
  p(abandon());
  assert.strictEqual(sup.emis.length, 0);
});

test('une mule qui n a recu aucune liste ne recoit rien', () => {
  const sup = fauxSuperviseur();
  const p = politique(sup);
  p(recu(1, listeCombat(MAITRE)));
  p(abandon());
  assert.strictEqual(sup.emis.length, 0);
});

// Un combat neuf ECRASE le precedent: c'est ce qui rend l'etat perime
// inoffensif sans qu'on sache detecter la fin d'un combat.
test('une liste plus recente remplace la precedente', () => {
  const sup = fauxSuperviseur();
  const p = politique(sup);
  p(recu(2, listeCombat(MAITRE, MULE)));
  p(recu(2, listeCombat(ETRANGER, MULE)));
  p(abandon());
  assert.strictEqual(sup.emis.length, 0);
});

test('une liste d acteurs de carte n efface pas la liste de combat', () => {
  const sup = fauxSuperviseur();
  const p = politique(sup);
  p(recu(2, listeCombat(MAITRE, MULE)));
  p(recu(2, listeCarte()));
  p(abandon());
  assert.strictEqual(sup.emis.length, 1);
});

test('replicate coupe, rien ne part', () => {
  const sup = fauxSuperviseur({ arme: false });
  const p = politique(sup);
  p(recu(2, listeCombat(MAITRE, MULE)));
  p(abandon());
  assert.strictEqual(sup.emis.length, 0);
});

test('l abandon d une mule ne declenche rien chez les autres', () => {
  const sup = fauxSuperviseur({ esclaves: [2, 3] });
  const p = politique(sup);
  p(recu(2, listeCombat(MAITRE, MULE)));
  p(recu(3, listeCombat(MAITRE, MULE)));
  p(abandon(2, false));
  assert.strictEqual(sup.emis.length, 0);
});

test('un second abandon sur le meme combat ne renvoie rien', () => {
  const sup = fauxSuperviseur();
  const p = politique(sup);
  p(recu(2, listeCombat(MAITRE, MULE)));
  p(abandon());
  p(abandon());
  assert.strictEqual(sup.emis.length, 1);
});

// Chaque esclave dans son propre essai: une socket morte sur la premiere mule
// ne doit pas priver la seconde de son abandon.
test('une exception sur une mule n empeche pas les autres d abandonner', () => {
  const emis = [];
  const sup = fauxSuperviseur({
    esclaves: [2, 3],
    emettre: (pid, octets) => {
      if (pid === 2) throw new Error('socket morte');
      emis.push({ pid, octets });
      return { ok: true, octets: octets.length };
    },
  });
  const p = politique(sup);
  p(recu(2, listeCombat(MAITRE, MULE)));
  p(recu(3, listeCombat(MAITRE, MULE)));
  p(abandon());
  assert.deepStrictEqual(emis.map((e) => e.pid), [3]);
  assert.deepStrictEqual(p.rendu.map((r) => [r.pid, r.ok]), [[2, false], [3, true]]);
});

test('un refus du superviseur se rend comme un refus, pas comme un envoi', () => {
  const sup = fauxSuperviseur({ emettre: () => ({ ok: false, raison: 'pas de socket amont' }) });
  const p = politique(sup);
  p(recu(2, listeCombat(MAITRE, MULE)));
  p(abandon());
  assert.deepStrictEqual(p.rendu.map((r) => [r.pid, r.ok, r.raison]), [[2, false, 'pas de socket amont']]);
});

test('une trame sortante d un autre type ne declenche rien', () => {
  const sup = fauxSuperviseur();
  const p = politique(sup);
  p(recu(2, listeCombat(MAITRE, MULE)));
  p(abandon(1, true, 'inh'));
  assert.strictEqual(sup.emis.length, 0);
});

test('un maitre dont le superviseur ignore le characterId n envoie rien', () => {
  const sup = fauxSuperviseur();
  sup.etats.set(1, { pid: 1, characterId: null });
  const p = politique(sup);
  p(recu(2, listeCombat(MAITRE, MULE)));
  p(abandon());
  assert.strictEqual(sup.emis.length, 0);
});

test('une trame absente ne fait pas lever', () => {
  const sup = fauxSuperviseur();
  const p = politique(sup);
  p({ pid: 1, dir: 'in', frame: null, brute: Buffer.alloc(0), estMaitre: true });
  p({ pid: 1, dir: 'out', frame: undefined, brute: Buffer.alloc(0), estMaitre: true });
  assert.strictEqual(sup.emis.length, 0);
});

// RONDE DE CORRECTION 1 -- ce test reproduit tel quel le kmk mesure en jeu
// cette nuit (journal-dev.log, maitre 676438999334 a l'orientation 1, mule
// 677048221990 a l'orientation 5, quatre monstres aux orientations 7,5,5,5).
// AVANT LA CORRECTION il echouait: joueursDe filtrait sur le champ 2 comme si
// c'etait un type d'acteur, alors que c'est l'ORIENTATION (0 a 7); comme
// aucune orientation ne valait 3 ici, la mule n'etait jamais retenue et le
// kme du maitre ne trouvait personne -- le silence total constate en jeu.
// Sortie d'echec constatee avant correction: `0 !== 1` sur sup.emis.length.
test('une liste de combat avec les orientations mesurees en jeu fait abandonner la mule', () => {
  const combatMesure = () => ({
    kind: 'event', type: TYPE_COMBATTANTS,
    payload: [
      combattant(7n, -1n), combattant(5n, -2n), combattant(5n, -3n), combattant(5n, -4n),
      combattant(1n, MAITRE), combattant(5n, MULE),
    ],
  });
  const sup = fauxSuperviseur();
  const p = politique(sup);
  p(recu(1, combatMesure()));
  p(recu(2, combatMesure()));
  p(abandon());
  assert.strictEqual(sup.emis.length, 1);
});

// --- LA LISTE DES COMBATTANTS APRES LE PATCH 3.6.11.12 -------------------
//
// `kmk` ne designe plus rien depuis le 08/09. Les deux moities du garde en
// dependaient — l'apprentissage d'une action qui lance un combat et
// l'annulation des rejeux en attente — et toutes deux se sont eteintes sans
// un mot: `frame.type !== TYPE_COMBATTANTS` sortait a chaque trame.
//
// MESURE du 08/09 (journal-combat.log, 42532 ms). Le message s'appelle
// desormais `kkr`, et ses entrees ont change de numero AVEC leurs champs:
//
//   kmk.2[] = { 1: cellule, 2: orientation, 3: identifiant }
//   kkr.1[] = { 1: identifiant, 2: orientation, 4: cellule }
//
// La fixture porte le maitre (677012898086) et un monstre (-1), sur les
// cellules 356 et 372: c'est le combat ouvert a 42441 ms par `hps { 1 =
// -20000 }`. Le signe du champ d'identifiant reste tout le mecanisme.
test('la liste des combattants mesurée le 08/09 est reconnue', () => {
  const octets = Buffer.from(require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'fixtures', 'combat-kkr-liste.hex'), 'utf8',
  ).trim(), 'hex');
  const f = require('../src/codec/rawProto').decodeFrameRaw(octets);

  assert.strictEqual(f.type, TYPE_COMBATTANTS, 'kmk -> kkr');

  const ids = combattantsDe(f);
  assert.notStrictEqual(ids, null, 'un monstre au champ négatif: c est un combat');
  assert.ok(ids.has('677012898086'), 'le maître combat');
  assert.ok(ids.has('-1'), 'le monstre');
  assert.strictEqual(ids.size, 2);
});

// L'ABANDON, MESURE LE 08/09 A 252970 ms. Le combat s'ouvre a 249802 ms sur un
// `hps { 1 = -20000 }` dans un donjon; a 252970 le client emet `kjy { }`, sans
// un champ, et le serveur repond par la fin du tour du maitre (`jvn`) puis, une
// seconde et demie plus tard, par la fin du combat et le retour sur la carte.
// C'est le seul sortant du combat qui ne soit pas un accuse d'animation.
test('l abandon de combat mesuré le 08/09 est reconnu', () => {
  const octets = Buffer.from(require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'fixtures', 'combat-kjy-abandon.hex'), 'utf8',
  ).trim(), 'hex');
  const f = require('../src/codec/rawProto').decodeFrameRaw(octets);

  assert.strictEqual(f.type, 'kjy');
  assert.ok(TYPES_ABANDON.includes(f.type), 'kme -> kjy');
  // Un message sans champ n'a pas de payload du tout: le client omet le
  // champ 2 du Any plutot que d'y mettre un corps vide.
  assert.strictEqual(f.payload, null, 'aucun champ');
});
