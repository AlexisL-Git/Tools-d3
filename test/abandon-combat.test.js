'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  creerAbandonGroupe, combattantsDe,
  TYPES_ABANDON, TYPE_COMBATTANTS,
} = require('../src/abandon-combat');

// Les characterId mesures le 2026-09-01. Le decodeur rend des BigInt sur ces
// champs: les tests les gardent tels quels pour rester fideles au trafic reel.
const MAITRE = 676438999334n;
const MULE = 677048221990n;
const ETRANGER = 123456789012n;

// Un combattant, tel qu'il apparait dans kmk: cellule au champ 1, ORIENTATION
// (0 a 7, sans rapport avec le role de l'acteur) au champ 2, identifiant au
// champ 3. Un identifiant negatif est un monstre, un identifiant positif un
// characterId -- voir la ronde de correction 1 dans src/abandon-combat.js.
const combattant = (orientation, id) => ({
  no: 2, kind: 'message',
  value: [{ no: 1, value: 400n }, { no: 2, value: orientation }, { no: 3, value: id }],
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
  p(abandon(1, true, 'ioy'));
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
