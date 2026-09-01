'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFrameRaw } = require('../src/codec/rawProto');
const {
  trameMajPrix, trameAbonner, trameDesabonner, trameStats,
  lirePrixMarche, lireStatsPrix, lireNosLots, lireLotPose, lireLotRetire, lirePrixMoyens,
  trameMettreEnVente, lireStock, lirePileMaj, lirePileDisparue,
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

// --- La mise en vente ----------------------------------------------------
//
// Les deux kge du journal du 01/09: une pile d'INVENTAIRE et une pile de
// BANQUE. Les deux ont abouti, ce qui prouve que kge accepte les deux
// origines sans retrait prealable.

test('kge reproduit les octets de la vente depuis l inventaire', () => {
  assert.strictEqual(
    trameMettreEnVente({ prix: 2699, uidPile: 84571671, taille: 100 }).toString('hex'),
    '122e0a210a13747970652e616e6b616d612e636f6d2f6b6765120a088b151097eca928186410ffffffffffffffffff01',
  );
});

test('kge reproduit les octets de la vente depuis la banque', () => {
  assert.strictEqual(
    trameMettreEnVente({ prix: 29, uidPile: 84496683, taille: 1 }).toString('hex'),
    '122d0a200a13747970652e616e6b616d612e636f6d2f6b67651209081d10aba2a528180110ffffffffffffffffff01',
  );
});

test('kge se relit comme une requete de type kge, uid -1', () => {
  const f = frame(trameMettreEnVente({ prix: 29, uidPile: 84496683, taille: 1 }).toString('hex'));
  assert.strictEqual(f.kind, 'request');
  assert.strictEqual(f.type, 'kge');
  assert.strictEqual(f.uid, -1n);
});

// --- Les confirmations ---------------------------------------------------
//
// CE N'EST PAS kes QUI CONFIRME. Le journal porte 2 kge et 102 kes: les cent
// autres sont des reposts de concurrents, recus parce qu'on est abonne a leur
// GID. ivj et ium, eux, ne concernent que nos propres piles.

test('ivj rend l uid de la pile et sa quantite restante', () => {
  assert.deepStrictEqual(
    lirePileMaj(frame('0a2a0a280a13747970652e616e6b616d612e636f6d2f69766a1211120508ba0110011a081097eca92818ba01')),
    { uid: 84571671, qte: 186 },
  );
});

test('ium rend l uid de la pile videe', () => {
  assert.strictEqual(
    lirePileDisparue(frame('0a1e0a1c0a13747970652e616e6b616d612e636f6d2f69756d120508aba2a528')),
    84496683,
  );
});

test('lirePileMaj et lirePileDisparue ignorent les autres types', () => {
  const kes = frame('0a2b0a290a13747970652e616e6b616d612e636f6d2f6b657312120a0908bd937318f5412001101d2080d49301');
  assert.strictEqual(lirePileMaj(kes), null);
  assert.strictEqual(lirePileDisparue(kes), null);
});

// --- lireStock, sur les deux trames mesurees -----------------------------

test('lireStock rend les 219 piles de l inventaire mesure', () => {
  const hex = fs.readFileSync(path.join(__dirname, 'fixtures', 'hdv-ivx-inventaire.hex'), 'utf8').trim();
  const piles = lireStock(frame(hex));
  assert.strictEqual(piles.length, 219);
  for (const p of piles) {
    assert.ok(Number.isInteger(p.uid) && p.uid > 0, 'chaque pile a un uid');
    assert.ok(Number.isInteger(p.gid) && p.gid > 0, 'chaque pile a un gid');
    assert.ok(Number.isInteger(p.qte) && p.qte > 0, 'chaque pile a une quantite');
  }
});

// LA PREUVE QUE ivx EST L'INVENTAIRE: son uid le plus haut est exactement la
// pile que le joueur a ensuite posee au sol, avec le meme GID et la meme
// quantite. Voir 2026-09-01-trames-mise-en-vente.md.
test('lireStock : la pile posee au sol figure dans l inventaire mesure', () => {
  const hex = fs.readFileSync(path.join(__dirname, 'fixtures', 'hdv-ivx-inventaire.hex'), 'utf8').trim();
  const pile = lireStock(frame(hex)).find((p) => p.uid === 84495873);
  assert.deepStrictEqual(pile, { uid: 84495873, gid: 13731, qte: 286, avecStats: false });
});

test('lireStock rend les 814 piles de la banque mesuree', () => {
  const hex = fs.readFileSync(path.join(__dirname, 'fixtures', 'hdv-iwb.hex'), 'utf8').trim();
  const piles = lireStock(frame(hex));
  assert.strictEqual(piles.length, 814);
  assert.strictEqual(new Set(piles.map((p) => p.gid)).size, 814);
});

// Le champ 2 du detail dit que l'objet PORTE DES EFFETS — et non qu'il est un
// equipement. 204 des 219 piles d'inventaire en ont, et 57 des 814 de la
// banque: ces dernieres montent a 1349 exemplaires, donc ce sont des
// consommables ou des runes, pas des pieces uniques.
test('lireStock marque les piles qui portent des effets', () => {
  const inv = fs.readFileSync(path.join(__dirname, 'fixtures', 'hdv-ivx-inventaire.hex'), 'utf8').trim();
  const banque = fs.readFileSync(path.join(__dirname, 'fixtures', 'hdv-iwb.hex'), 'utf8').trim();
  assert.strictEqual(lireStock(frame(inv)).filter((p) => p.avecStats).length, 204);
  assert.strictEqual(lireStock(frame(banque)).filter((p) => p.avecStats).length, 57);
});

test('lireStock rend un tableau vide sur un type inconnu', () => {
  assert.deepStrictEqual(lireStock(frame('0a170a150a13747970652e616e6b616d612e636f6d2f6b7261')), []);
});
