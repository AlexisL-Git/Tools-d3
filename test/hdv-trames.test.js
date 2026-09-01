'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFrameRaw } = require('../src/codec/rawProto');
const {
  trameMajPrix, trameAbonner, trameDesabonner, trameStats,
  lirePrixMarche, lireStatsPrix, lireNosLots, lireLotPose, lireLotRetire, lirePrixMoyens,
} = require('../src/hdv/trames');

// Toutes les valeurs de ce fichier sont MESUREES, pas construites: elles
// viennent du journal du 01/09, docs/superpowers/specs/2026-09-01-trames-hdv.md.
const frame = (hex) => decodeFrameRaw(Buffer.from(hex, 'hex'));

// --- Ce qu'on emet -------------------------------------------------------
//
// Les octets attendus sont ceux que le JEU a emis quand l'utilisateur a fait le
// geste a la main. Les figer ici est le meme choix que TRAME_ACCEPTATION dans
// echange.test.js: une trame reconstruite doit etre indiscernable de la vraie.

test('kch reproduit exactement les octets de la mise a jour mesuree', () => {
  const t = trameMajPrix({ uid: 1768695, prix: 2990, taille: 100 });
  assert.strictEqual(
    t.toString('hex'),
    '122d0a200a13747970652e616e6b616d612e636f6d2f6b6368120908f7f96b10ae17186410ffffffffffffffffff01',
  );
});

test('kch se relit comme une requete de type kch, uid -1', () => {
  const f = frame(trameMajPrix({ uid: 1768695, prix: 2990, taille: 100 }).toString('hex'));
  assert.strictEqual(f.kind, 'request');
  assert.strictEqual(f.type, 'kch');
  assert.strictEqual(f.uid, -1n);
});

test('keh d abonnement porte le champ 2, mesure sur le GID 20967', () => {
  assert.strictEqual(
    trameAbonner(20967).toString('hex'),
    '122a0a1d0a13747970652e616e6b616d612e636f6d2f6b6568120608e7a301100110ffffffffffffffffff01',
  );
});

// Le desabonnement est le MEME message SANS le champ 2. C'est le zero protobuf,
// qui ne s'ecrit pas — meme regle que le champ 3 de kgt dans l'echange.
test('keh de desabonnement est le meme message sans le champ 2', () => {
  assert.strictEqual(
    trameDesabonner(20967).toString('hex'),
    '12280a1b0a13747970652e616e6b616d612e636f6d2f6b6568120408e7a30110ffffffffffffffffff01',
  );
});

test('kbz reproduit les octets mesures', () => {
  assert.strictEqual(
    trameStats(20967).toString('hex'),
    '12280a1b0a13747970652e616e6b616d612e636f6d2f6b627a120408e7a30110ffffffffffffffffff01',
  );
});

// --- Ce qu'on lit --------------------------------------------------------

// LE TABLEAU DES PRIX SE LIT PAR `raw`, JAMAIS PAR `value`. Un champ LEN est
// ambigu par construction, et rawProto.js:60 avertit qu'il a deja fait prendre
// des varints empaquetes pour une chaine ou un sous-message. Les quatre valeurs
// ci-dessous sont celles qui suivaient la pose d'un lot de 100 a 2991.
test('kgp rend les quatre prix, dans l ordre des tailles', () => {
  const lu = lirePrixMarche(frame('0a2c0a2a0a13747970652e616e6b616d612e636f6d2f6b6770121312084d8f02af17d4b002189f8c0428c1763036'));
  assert.deepStrictEqual(lu, { gid: 15169, categorie: 54, prix: [77, 271, 2991, 38996] });
});

// Le meme tableau, apres le reprix a 2990: seule la case des lots de 100 bouge.
test('kgp apres le reprix : seule la case de la taille touchee change', () => {
  const lu = lirePrixMarche(frame('0a2c0a2a0a13747970652e616e6b616d612e636f6d2f6b6770121312084d8f02ae17d4b002189f8c0428c1763036'));
  assert.deepStrictEqual(lu.prix, [77, 271, 2990, 38996]);
});

test('une trame qui n est pas kgp n est pas lue comme telle', () => {
  assert.strictEqual(lirePrixMarche(frame('0a1d0a1b0a13747970652e616e6b616d612e636f6d2f6b656e120408f7f96b')), null);
});

// kbt porte les memes quatre prix, mais au champ 6 d'un sous-message. Mesure
// sur la Legende de Bakushana: un seul lot de 1 en vente a 599998.
test('kbt rend les quatre prix quand il porte le champ 3', () => {
  const lu = lireStatsPrix(frame('0a350a330a13747970652e616e6b616d612e636f6d2f6b6274121c08db0110e7a3011a1308b2f50528e7a3013206becf2400000040db01'));
  assert.deepStrictEqual(lu, { gid: 20967, categorie: 219, prix: [599998, 0, 0, 0] });
});

// Le kbt SANS champ 3 est l'accuse du desabonnement du GID precedent. Le lire
// comme des stats ferait decider sur un tableau vide.
test('kbt sans champ 3 est un accuse de desabonnement, pas des stats', () => {
  assert.strictEqual(lireStatsPrix(frame('0a200a1e0a13747970652e616e6b616d612e636f6d2f6b6274120708db0110e7a301')), null);
});

test('kes rend le lot pose : uid neuf, gid, taille, prix', () => {
  const lu = lireLotPose(frame('0a2c0a2a0a13747970652e616e6b616d612e636f6d2f6b657312130a0908f6fa6b18c176206410ae172080d49301'));
  assert.deepStrictEqual(lu, { uid: 1768822, gid: 15169, taille: 100, prix: 2990, duree: 2419200 });
});

test('ken rend l uid du lot qui disparait', () => {
  assert.strictEqual(lireLotRetire(frame('0a1d0a1b0a13747970652e616e6b616d612e636f6d2f6b656e120408f7f96b')), 1768695);
});

// --- La vraie kby, celle du compte de mesure -----------------------------
//
// 8180 octets, capturee le 01/09. L'interface du jeu affichait « 376 lots en
// vente » au meme instant: c'est la seule verification de bout en bout qu'on
// puisse faire sur ce lecteur, et elle vaut mieux qu'une trame fabriquee.
test('kby rend les 376 lots du compte de mesure', () => {
  const hex = fs.readFileSync(path.join(__dirname, 'fixtures', 'hdv-kby.hex'), 'utf8').trim();
  const lots = lireNosLots(frame(hex));
  assert.strictEqual(lots.length, 376);
  for (const l of lots) {
    assert.ok(Number.isInteger(l.uid) && l.uid > 0, 'chaque lot a un uid');
    assert.ok(Number.isInteger(l.gid) && l.gid > 0, 'chaque lot a un gid');
    assert.ok([1, 10, 100, 1000].includes(l.taille), `taille inattendue: ${l.taille}`);
    assert.ok(Number.isInteger(l.prix) && l.prix > 0, 'chaque lot a un prix');
  }
});

test('kby : le premier lot porte les valeurs mesurees', () => {
  const hex = fs.readFileSync(path.join(__dirname, 'fixtures', 'hdv-kby.hex'), 'utf8').trim();
  const lots = lireNosLots(frame(hex));
  assert.deepStrictEqual(lots[0], { uid: 1738966, gid: 8308, taille: 1, prix: 143, duree: 2411322 });
});

// La duree de mise en vente vaut 2 419 200 secondes, soit exactement 28 jours.
// Aucun lot n'en porte davantage: c'est le plafond, et les valeurs mesurees
// sont ce plafond moins le temps ecoule.
test('kby : aucune duree ne depasse les 28 jours du plafond', () => {
  const hex = fs.readFileSync(path.join(__dirname, 'fixtures', 'hdv-kby.hex'), 'utf8').trim();
  for (const l of lireNosLots(frame(hex))) assert.ok(l.duree <= 2419200, `duree ${l.duree}`);
});

// --- ivi, les prix moyens du catalogue -----------------------------------
//
// 9861 paires { gid, prixMoyen } livrees au login. Les cinq GID verifies pendant
// la mesure y valaient exactement ce que kcq.4 a rendu ensuite.
test('ivi rend une table gid -> prix moyen', () => {
  const { encodeRaw, WIRE } = require('../src/codec/rawProto');
  const paire = (gid, prix) => ({
    no: 2, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.VARINT, value: BigInt(gid) },
      { no: 2, wire: WIRE.VARINT, value: BigInt(prix) },
    ],
  });
  const brute = encodeRaw([
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: 'type.ankama.com/ivi' },
        { no: 2, wire: WIRE.LEN, kind: 'message', value: [
          paire(13731, 32), paire(15169, 34), paire(20967, 827440),
        ] },
      ] },
    ] },
  ]);
  const table = lirePrixMoyens(decodeFrameRaw(brute));
  assert.strictEqual(table.get(13731), 32);
  assert.strictEqual(table.get(15169), 34);
  assert.strictEqual(table.get(20967), 827440);
});
