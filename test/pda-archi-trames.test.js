'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFrameRaw, encodeRaw, WIRE } = require('../src/codec/rawProto');
const { lireStock, POSITION_INVENTAIRE } = require('../src/hdv/trames');
const {
  lireGroupes, lireGroupeAttaque, lirePosition, trameEquiper, trameLireInventaire,
  lireEntreeCombat,
} = require('../src/pda-archi/trames');

const fixture = (nom) => decodeFrameRaw(
  Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures', nom), 'utf8').trim(), 'hex'),
);

// L'inventaire de connexion du 03/09: 471 piles, 454 rangees, 17 portees.
// UNE SEULE pile n'a pas de champ 1 -- l'amulette, position 0. La lire comme
// 63 la ferait passer pour rangee, et le compte tomberait a 455 et 16.
test('lireStock rend la position, et un champ absent vaut 0 et non 63', () => {
  const piles = lireStock(fixture('pda-archi-ivx-inventaire.hex'));
  assert.strictEqual(piles.length, 471);
  assert.strictEqual(piles.filter((p) => p.pos === POSITION_INVENTAIRE).length, 454);
  assert.strictEqual(piles.filter((p) => p.pos !== POSITION_INVENTAIRE).length, 17);
  assert.strictEqual(piles.filter((p) => p.pos === 0).length, 1);
});

// La position 31 est l'emplacement de la pierre d'ame, mesure du 03/09.
test('la pierre d ame portee se trouve en position 31', () => {
  const piles = lireStock(fixture('pda-archi-ivx-inventaire.hex'));
  const portees = piles.filter((p) => p.pos === 31);
  assert.strictEqual(portees.length, 1);
  assert.strictEqual(portees[0].gid, 9687);
  assert.strictEqual(portees[0].uid, 233525940);
  assert.strictEqual(portees[0].qte, 47);
});

// La carte de mesure du 03/09 portait deux groupes. Le -20000 est celui que
// Jibef a attaque: deux Black Wabbit de niveau 46. Le -20001 en portait quatre,
// dont un Black Wabbit de niveau 50 qui menait le groupe.
test('lireGroupes rend les deux groupes de la carte mesuree', () => {
  const groupes = lireGroupes(fixture('pda-archi-jss-groupes.hex'));
  assert.strictEqual(groupes.size, 2);
  assert.strictEqual(groupes.get(-20000).niveauMax, 46);
  assert.strictEqual(groupes.get(-20000).monstres, 2);
  assert.strictEqual(groupes.get(-20001).niveauMax, 50);
  assert.strictEqual(groupes.get(-20001).monstres, 4);
});

test('le joueur n est pas un groupe de monstres', () => {
  const groupes = lireGroupes(fixture('pda-archi-jss-groupes.hex'));
  assert.strictEqual(groupes.has(677158453542), false);
});

// kmu { 2 = identifiant du groupe } arrive au demarrage du combat.
test('lireGroupeAttaque lit l identifiant du groupe dans kmu', () => {
  const frame = { type: 'kmu', payload: [{ no: 2, wire: WIRE.VARINT, value: -20000n }] };
  assert.strictEqual(lireGroupeAttaque(frame), -20000);
});

test('lireGroupeAttaque ignore une autre trame et un kmu vide', () => {
  assert.strictEqual(lireGroupeAttaque({ type: 'kmk', payload: [] }), null);
  assert.strictEqual(lireGroupeAttaque({ type: 'kmu', payload: [] }), null);
});

// ivq { 1 = uid, 2 = nouvelle position } confirme le deplacement en 40 ms.
test('lirePosition lit la confirmation ivq', () => {
  const frame = { type: 'ivq', payload: [
    { no: 1, wire: WIRE.VARINT, value: 233526404n },
    { no: 2, wire: WIRE.VARINT, value: 31n },
  ] };
  assert.deepStrictEqual(lirePosition(frame), { uid: 233526404, pos: 31 });
});

test('lirePosition rend null sur autre chose', () => {
  assert.strictEqual(lirePosition({ type: 'ivj', payload: [] }), null);
});

// L'ordre mesure le 03/09: iuk { 1 = quantite, 2 = uid, 3 = position }.
// Le client deplace la PILE ENTIERE quand il equipe, pas une unite.
test('trameEquiper reproduit l ordre mesure', () => {
  const octets = trameEquiper({ uid: 233526404, qte: 89, position: 31 });
  const attendu = encodeRaw([
    { no: 2, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: 'type.ankama.com/iuk' },
        { no: 2, wire: WIRE.LEN, kind: 'message', value: [
          { no: 1, wire: WIRE.VARINT, value: 89n },
          { no: 2, wire: WIRE.VARINT, value: 233526404n },
          { no: 3, wire: WIRE.VARINT, value: 31n },
        ] },
      ] },
      { no: 2, wire: WIRE.VARINT, value: -1n },
    ] },
  ]);
  assert.deepStrictEqual(octets, attendu);
});

// kmu dit qu'un ACTEUR QUITTE LA CARTE, pas « un combat commence ». Chaque
// joueur qui s'en va en produit une: sur la seance du 03/09 au soir, des
// dizaines sont tombees avec des identifiants de personnages, et chacune
// faisait dire « groupe inconnu » a la chasse.
test('lireGroupeAttaque ignore un identifiant de joueur, positif', () => {
  const joueur = { type: 'kmu', payload: [{ no: 2, wire: WIRE.VARINT, value: 677158453542n }] };
  assert.strictEqual(lireGroupeAttaque(joueur), null);
});

test('lireGroupeAttaque retient un identifiant de groupe, negatif', () => {
  const groupe = { type: 'kmu', payload: [{ no: 2, wire: WIRE.VARINT, value: -20004n }] };
  assert.strictEqual(lireGroupeAttaque(groupe), -20004);
});

// itr: REDEMANDER L'INVENTAIRE, sans se deconnecter.
//
// Mesuree le 01/09 dans journal-hdv.log, trois fois, emise par le jeu lui-meme
// quand on ouvre un panneau de rangement. Le serveur repond par un `ivx` en
// 38 ms. Les octets sont figes ici: cette requete doit reproduire OCTET POUR
// OCTET celle du jeu, meme regle que toutes les autres de ce depot.
//
//   itr { 2 = <02 03>, 3 = 1 }
//
// Le champ 2 est la liste des rangements demandes. On ne l'interprete pas: on
// le recopie. Ce que la reponse contient a ete mesure separement, et un champ
// de chaque pile dit de quel rangement elle vient.
test('trameLireInventaire reproduit les octets mesures de itr', () => {
  const attendu = '122a0a1d0a13747970652e616e6b616d612e636f6d2f6974721206'
    + '12020203180110ffffffffffffffffff01';
  assert.strictEqual(trameLireInventaire().toString('hex'), attendu);
});

// LES DEUX FORMES MESUREES DE kae, journal-archi-bug.log du 04/09:
//
//   kae { 1={2=1 3=-20001 4=1 5=<0o> 6=1} 2=194 }   le groupe, chez l attaquant
//   kae { 1={3=677158453542 4=1 5={…}} 2=194 }      un joueur, chez chacun
test('lireEntreeCombat lit le combat et le combattant', () => {
  const frame = { type: 'kae', payload: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 2, wire: WIRE.VARINT, value: 1n },
      { no: 3, wire: WIRE.VARINT, value: -20001n },
    ] },
    { no: 2, wire: WIRE.VARINT, value: 194n },
  ] };
  assert.deepStrictEqual(lireEntreeCombat(frame), { idCombat: 194, idActeur: -20001 });
});

// UN JOUEUR PORTE UN IDENTIFIANT GRAND ET POSITIF, et il faut le rendre tel
// quel: c est lui qui dit « ce client est dans ce combat ».
test('lireEntreeCombat rend aussi un combattant joueur', () => {
  const frame = { type: 'kae', payload: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 3, wire: WIRE.VARINT, value: 677158453542n },
    ] },
    { no: 2, wire: WIRE.VARINT, value: 194n },
  ] };
  assert.deepStrictEqual(
    lireEntreeCombat(frame), { idCombat: 194, idActeur: 677158453542 },
  );
});

test('lireEntreeCombat ignore une autre trame et un kae incomplet', () => {
  assert.strictEqual(lireEntreeCombat({ type: 'kmk', payload: [] }), null);
  assert.strictEqual(lireEntreeCombat({ type: 'kae', payload: [] }), null);
  // Le combat sans combattant, et le combattant sans combat.
  assert.strictEqual(lireEntreeCombat({ type: 'kae', payload: [
    { no: 2, wire: WIRE.VARINT, value: 194n },
  ] }), null);
  assert.strictEqual(lireEntreeCombat({ type: 'kae', payload: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 3, wire: WIRE.VARINT, value: 42n },
    ] },
  ] }), null);
});
