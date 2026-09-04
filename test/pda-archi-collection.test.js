'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  decodeFrameRaw, decodeRaw, encodeRaw, WIRE,
} = require('../src/codec/rawProto');
const { lireAmes, creerCollection } = require('../src/pda-archi/collection');
const { construire } = require('../src/pda-archi/tableau');

const fixture = (nom) => decodeFrameRaw(
  Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures', nom), 'utf8').trim(), 'hex'),
);

// L'inventaire de connexion du 04/09: 674 piles, dont 143 portent une ame.
// Mesure dans docs/superpowers/specs/2026-09-04-trames-ame-pleine.md.
test('lireAmes rend les 143 ames de l inventaire mesure', () => {
  const ames = lireAmes(fixture('pda-archi-ivx-ames.hex'));
  assert.strictEqual(ames.length, 143);
});

// `iua` porte UNE pile, au champ 3 de la trame -- le meme numero de champ que
// les elements d'ivx, ce que src/pda-archi/pda-archi.js exploite deja. C'est la
// trame de la pierre qui SE REMPLIT pendant la chasse: sans elle, le tableau
// serait une photo prise a la connexion.
//
// Les octets sont ceux de la pile mesuree le 04/09, `Pichakote le Degoutant`,
// reposes tels quels dans une trame iua.
const PILE_AME = '083f2a1808d58902120a320508e011100558da1f180120d7c5929401';

const trameIua = () => ({
  type: 'iua',
  payload: decodeRaw(encodeRaw([
    { no: 3, wire: WIRE.LEN, kind: 'bytes', value: Buffer.from(PILE_AME, 'hex') },
  ])),
});

test('lireAmes lit la pierre qui se remplit, annoncee par iua', () => {
  const ames = lireAmes(trameIua());
  assert.deepStrictEqual(ames, [{ uid: 310682327, monstres: [2272] }]);
});

// --- La collection, personnage par personnage -----------------------------

const ivxDe = () => fixture('pda-archi-ivx-ames.hex');

const trameIum = (uid) => ({
  type: 'ium',
  payload: decodeRaw(encodeRaw([{ no: 1, wire: WIRE.VARINT, value: BigInt(uid) }])),
});

test('la collection retient les ames de l inventaire recu', () => {
  const c = creerCollection();
  c.onTrame({ pid: 42, dir: 'in', frame: ivxDe() });
  assert.strictEqual(c.etat().get(42).size, 143);
  assert.strictEqual(c.etat().get(42).has(2272), true);
});

// UN PERSONNAGE JAMAIS LU N EST PAS UN PERSONNAGE A ZERO, et c'est la leçon la
// plus chère du 03/09: un silence qui ressemble à une réponse fait perdre une
// soirée. Le panneau affichera `—`, ce qu'il ne peut faire que si la collection
// distingue les deux.
test('un personnage jamais lu est absent, pas a zero', () => {
  const c = creerCollection();
  c.onTrame({ pid: 42, dir: 'in', frame: ivxDe() });
  assert.strictEqual(c.etat().has(7), false);
});

test('iua coche une ame sans effacer les autres', () => {
  const c = creerCollection();
  c.onTrame({ pid: 42, dir: 'in', frame: trameIua() });
  assert.deepStrictEqual([...c.etat().get(42)], [2272]);
});

// `ium` est la disparition d'une pile, quelle qu'en soit la cause: une ame
// vendue, donnee ou posee au sol quitte le tableau.
test('ium decoche l ame qui a quitte l inventaire', () => {
  const c = creerCollection();
  c.onTrame({ pid: 42, dir: 'in', frame: ivxDe() });
  c.onTrame({ pid: 42, dir: 'in', frame: trameIum(310682327) });
  assert.strictEqual(c.etat().get(42).has(2272), false);
  assert.strictEqual(c.etat().get(42).size, 142);
});

// Deux personnages ne partagent rien: chacun sa colonne.
test('chaque personnage a sa propre collection', () => {
  const c = creerCollection();
  c.onTrame({ pid: 42, dir: 'in', frame: ivxDe() });
  c.onTrame({ pid: 43, dir: 'in', frame: trameIua() });
  assert.strictEqual(c.etat().get(42).size, 143);
  assert.strictEqual(c.etat().get(43).size, 1);
});

// Une trame SORTANTE porte les memes octets mais raconte ce qu'on a demande,
// pas ce que le serveur a repondu. Meme garde que src/pda-archi/pda-archi.js.
test('une trame sortante ne remplit rien', () => {
  const c = creerCollection();
  c.onTrame({ pid: 42, dir: 'out', frame: ivxDe() });
  assert.strictEqual(c.etat().has(42), false);
});

// Un client qui se ferme ne doit pas laisser sa colonne derriere lui.
test('oublier efface un personnage', () => {
  const c = creerCollection();
  c.onTrame({ pid: 42, dir: 'in', frame: ivxDe() });
  c.oublier(42);
  assert.strictEqual(c.etat().has(42), false);
});

// Une trame qui ne rend AUCUNE pile n'efface pas ce qu'on sait: c'est le signe
// qu'on ne l'a pas comprise, pas celui d'un inventaire vide. Meme precaution
// que src/pda-archi/pda-archi.js sur les stocks.
test('un ivx sans une seule pile n efface pas la collection', () => {
  const c = creerCollection();
  c.onTrame({ pid: 42, dir: 'in', frame: ivxDe() });
  c.onTrame({ pid: 42, dir: 'in', frame: { type: 'ivx', payload: [] } });
  assert.strictEqual(c.etat().get(42).size, 143);
});

// Mais un inventaire VRAIMENT vide d'ames, lui, en est un: le personnage a
// vendu ses pierres, sa colonne repasse a zero.
test('un ivx plein de piles mais sans ame vide la collection', () => {
  const c = creerCollection();
  c.onTrame({ pid: 42, dir: 'in', frame: ivxDe() });
  c.onTrame({
    pid: 42,
    dir: 'in',
    frame: {
      type: 'ivx',
      payload: decodeRaw(encodeRaw([
        { no: 3, wire: WIRE.LEN, kind: 'bytes', value: Buffer.from('083f2a0a08d5890218012001', 'hex') },
      ])),
    },
  });
  assert.strictEqual(c.etat().get(42).size, 0);
});

// --- De la trame au tableau, avec les octets reels -------------------------
//
// LE SEUL TEST QUI TRAVERSE TOUTE LA CHAINE: l'inventaire mesure le 04/09,
// decode, croise avec les 286. Les trois chiffres sont ceux de la mesure, et
// c'est ce qui les rend utiles -- un decodage qui deriverait les ferait bouger.
test('l inventaire mesure donne 140 archimonstres et 3 ames de boss', () => {
  const c = creerCollection();
  c.onTrame({ pid: 42, dir: 'in', frame: ivxDe() });
  const t = construire({
    comptes: [{ pid: 42, nom: 'Jibef', ames: c.etat().get(42) }],
  });
  assert.strictEqual(t.comptes[0].possede, 140);
  assert.strictEqual(t.comptes[0].horsTableau, 3);
  assert.strictEqual(t.comptes[0].manquants, 146);
  assert.strictEqual(t.possedes, 140);
});

// --- Le rangement d'ou vient la pile --------------------------------------
//
// Redemander l'inventaire (`itr`) ramene PLUS que l'inventaire: mesure du 04/09
// sur la reponse du 01/09, croisee avec les uid de la connexion.
//
//   rangement 1  474 piles, toutes deja vues a la connexion  -> l'inventaire
//   rangement 2  518 piles                                   -> la banque
//   rangement 3   64 piles                                   -> un troisieme
//   absent        16 piles, toutes deja vues                 -> l'equipement porte
//
// 474 + 16 = 490, exactement le contenu de la connexion. On ne garde donc que
// le rangement 1 et les piles sans rangement: le rafraichissement voit alors
// EXACTEMENT le meme perimetre que la connexion, et les comptes ne sautent pas.
//
// La banque est hors perimetre par decision de Jibef le 04/09; sans ce tri,
// elle entrerait par la porte du rafraichissement.
const pileAme = ({ uid, monstre, rangement }) => {
  const detail = [
    { no: 1, wire: WIRE.VARINT, value: 34005n },
    { no: 2, wire: WIRE.LEN, kind: 'message', value: [
      { no: 6, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.VARINT, value: BigInt(monstre) },
        { no: 2, wire: WIRE.VARINT, value: 5n },
      ] },
      { no: 11, wire: WIRE.VARINT, value: 4058n },
    ] },
    { no: 3, wire: WIRE.VARINT, value: 1n },
    { no: 4, wire: WIRE.VARINT, value: BigInt(uid) },
  ];
  if (rangement !== null) {
    detail.push({ no: 5, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.VARINT, value: 1n },
      { no: 2, wire: WIRE.VARINT, value: BigInt(rangement) },
    ] });
  }
  return { no: 3, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.VARINT, value: 63n },
    { no: 5, wire: WIRE.LEN, kind: 'message', value: detail },
  ] };
};

const trameIvxAvecRangements = (piles) => ({
  type: 'ivx',
  payload: decodeRaw(encodeRaw(piles.map(pileAme))),
});

test('une ame de l inventaire est retenue', () => {
  const ames = lireAmes(trameIvxAvecRangements([{ uid: 1, monstre: 2272, rangement: 1 }]));
  assert.deepStrictEqual(ames, [{ uid: 1, monstres: [2272] }]);
});

test('une ame sans rangement est retenue: c est l equipement porte', () => {
  const ames = lireAmes(trameIvxAvecRangements([{ uid: 1, monstre: 2272, rangement: null }]));
  assert.deepStrictEqual(ames, [{ uid: 1, monstres: [2272] }]);
});

test('une ame de la banque est ignoree', () => {
  const ames = lireAmes(trameIvxAvecRangements([{ uid: 2, monstre: 2276, rangement: 2 }]));
  assert.deepStrictEqual(ames, []);
});

test('une ame du troisieme rangement est ignoree', () => {
  const ames = lireAmes(trameIvxAvecRangements([{ uid: 3, monstre: 2276, rangement: 3 }]));
  assert.deepStrictEqual(ames, []);
});

test('le tri se fait pile par pile, pas trame par trame', () => {
  const ames = lireAmes(trameIvxAvecRangements([
    { uid: 1, monstre: 2272, rangement: 1 },
    { uid: 2, monstre: 2276, rangement: 2 },
    { uid: 3, monstre: 2280, rangement: 1 },
  ]));
  assert.deepStrictEqual(ames.map((a) => a.uid), [1, 3]);
});
