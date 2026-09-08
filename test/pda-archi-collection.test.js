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

// REMESURE LE 08/09: 1345 piles, dont 245 portent une ame. Le patch a deplace
// la liste (champ 3 -> 2), l uid de la pile (4 -> 1), les effets (2 -> 3), et
// dans l effet lui-meme le numero (11 -> 1) comme ses parametres (6 -> 4), ou
// l identifiant du monstre passe du champ 1 au 3.
test('lireAmes rend les 245 ames de l inventaire mesure', () => {
  const ames = lireAmes(fixture('hdv-isb-complet.hex'));
  assert.strictEqual(ames.length, 245);
});

// `iua` s'appelle `isa` depuis le patch 3.6.11.12, et porte UNE pile au champ
// 2 — le meme numero que les elements du stock, comme avant. Mesure du 08/09,
// relevee sur des piles qui apparaissent en combat:
//
//   isa 2={3=63 5={1=9004649 2=1 5=2599}} C'est la
// trame de la pierre qui SE REMPLIT pendant la chasse: sans elle, le tableau
// serait une photo prise a la connexion.
//
// Les octets sont ceux d'une pile REMESUREE le 08/09, reposes tels quels dans
// une trame iua. Le monstre qu'elle porte est le 2848.
const PILE_AME = '183f2a2f08b1a1da0510011a0508d70850061a0908d91f2204080610341a0a08da1f2205080518a01622041001180128d18702';

const trameIua = () => ({
  type: 'isa',
  payload: decodeRaw(encodeRaw([
    { no: 2, wire: WIRE.LEN, kind: 'bytes', value: Buffer.from(PILE_AME, 'hex') },
  ])),
});

test('lireAmes lit la pierre qui se remplit, annoncee par iua', () => {
  const ames = lireAmes(trameIua());
  assert.deepStrictEqual(ames, [{ uid: 11964593, monstres: [2848] }]);
});

// --- La collection, personnage par personnage -----------------------------

const ivxDe = () => fixture('hdv-isb-complet.hex');

const trameIum = (uid) => ({
  type: 'ium',
  payload: decodeRaw(encodeRaw([{ no: 1, wire: WIRE.VARINT, value: BigInt(uid) }])),
});

test('la collection retient les ames de l inventaire recu', () => {
  const c = creerCollection();
  c.onTrame({ pid: 42, dir: 'in', frame: ivxDe() });
  assert.strictEqual(c.etat().get(42).size, 248);
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
  assert.deepStrictEqual([...c.etat().get(42)], [2848]);
});

// `ium` est la disparition d'une pile, quelle qu'en soit la cause: une ame
// vendue, donnee ou posee au sol quitte le tableau.
test('ium decoche l ame qui a quitte l inventaire', () => {
  const c = creerCollection();
  c.onTrame({ pid: 42, dir: 'in', frame: ivxDe() });
  c.onTrame({ pid: 42, dir: 'in', frame: trameIum(11964616) });
  assert.strictEqual(c.etat().get(42).has(2272), false);
  assert.strictEqual(c.etat().get(42).size, 247);
});

// Deux personnages ne partagent rien: chacun sa colonne.
test('chaque personnage a sa propre collection', () => {
  const c = creerCollection();
  c.onTrame({ pid: 42, dir: 'in', frame: ivxDe() });
  c.onTrame({ pid: 43, dir: 'in', frame: trameIua() });
  assert.strictEqual(c.etat().get(42).size, 248);
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
  assert.strictEqual(c.etat().get(42).size, 248);
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
      type: 'isb',
      payload: decodeRaw(encodeRaw([
        { no: 2, wire: WIRE.LEN, kind: 'message', value: [
          { no: 3, wire: WIRE.VARINT, value: 63n },
          { no: 5, wire: WIRE.LEN, kind: 'message', value: [
            { no: 1, wire: WIRE.VARINT, value: 34005n },
            { no: 2, wire: WIRE.VARINT, value: 1n },
            { no: 5, wire: WIRE.VARINT, value: 2304n },
          ] },
        ] },
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
test('l inventaire mesure donne 217 archimonstres et 31 ames hors tableau', () => {
  const c = creerCollection();
  c.onTrame({ pid: 42, dir: 'in', frame: ivxDe() });
  const t = construire({
    comptes: [{ pid: 42, nom: 'Jibef', ames: c.etat().get(42) }],
  });
  assert.strictEqual(t.comptes[0].possede, 217);
  assert.strictEqual(t.comptes[0].horsTableau, 31);
  assert.strictEqual(t.comptes[0].manquants, 69);
  assert.strictEqual(t.possedes, 217);
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
// MESURE DU 08/09: dans le detail l'uid passe du champ 4 au 1, la quantite du
// 3 au 2, les effets du 2 au 3, le gid du 1 au 5 et le rangement du 5 au 4.
// Dans l'effet, le numero passe du 11 au 1 et ses parametres du 6 au 4, ou
// l'identifiant du monstre passe lui-meme du champ 1 au 3.
const pileAme = ({ uid, monstre, rangement }) => {
  const detail = [
    { no: 5, wire: WIRE.VARINT, value: 34005n },
    { no: 3, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.VARINT, value: 4058n },
      { no: 4, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.VARINT, value: 5n },
        { no: 3, wire: WIRE.VARINT, value: BigInt(monstre) },
      ] },
    ] },
    { no: 2, wire: WIRE.VARINT, value: 1n },
    { no: 1, wire: WIRE.VARINT, value: BigInt(uid) },
  ];
  if (rangement !== null) {
    detail.push({ no: 4, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.VARINT, value: 1n },
      { no: 2, wire: WIRE.VARINT, value: BigInt(rangement) },
    ] });
  }
  // La pile passe du champ 3 au 2, et sa position du champ 1 au 3.
  return { no: 2, wire: WIRE.LEN, kind: 'message', value: [
    { no: 3, wire: WIRE.VARINT, value: 63n },
    { no: 5, wire: WIRE.LEN, kind: 'message', value: detail },
  ] };
};

const trameIvxAvecRangements = (piles) => ({
  type: 'isb',
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
