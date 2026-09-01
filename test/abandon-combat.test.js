'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  creerAbandonGroupe, joueursDe,
  TYPES_ABANDON, TYPE_COMBATTANTS, TYPE_JOUEUR,
} = require('../src/abandon-combat');

// Les characterId mesures le 2026-09-01. Le decodeur rend des BigInt sur ces
// champs: les tests les gardent tels quels pour rester fideles au trafic reel.
const MAITRE = 676438999334n;
const MULE = 677048221990n;
const ETRANGER = 123456789012n;

// Un combattant, tel qu'il apparait dans kmk: type au champ 2, identifiant au
// champ 3. Type 7 = monstre, 3 = joueur, 1 = acteur de carte.
const combattant = (type, id) => ({
  no: 2, kind: 'message',
  value: [{ no: 1, value: 400n }, { no: 2, value: type }, { no: 3, value: id }],
});

const listeCombat = (...ids) => ({
  kind: 'event', type: TYPE_COMBATTANTS,
  payload: [
    combattant(7n, -1n), combattant(7n, -2n),
    ...ids.map((id) => combattant(BigInt(TYPE_JOUEUR), id)),
  ],
});

// Une kmk d'acteurs de carte: personne n'est de type 3.
const listeCarte = () => ({
  kind: 'event', type: TYPE_COMBATTANTS,
  payload: [combattant(1n, MAITRE), combattant(1n, MULE)],
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

test('la liste de combat rend les joueurs, pas les monstres', () => {
  const joueurs = joueursDe(listeCombat(MAITRE, MULE));
  assert.deepStrictEqual([...joueurs].sort(), [String(MAITRE), String(MULE)].sort());
});

test('une liste d acteurs de carte ne rend aucun joueur', () => {
  assert.strictEqual(joueursDe(listeCarte()), null);
});

test('une trame malformee ne rend aucun joueur', () => {
  assert.strictEqual(joueursDe(null), null);
  assert.strictEqual(joueursDe({ kind: 'event', type: TYPE_COMBATTANTS }), null);
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
