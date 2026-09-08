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
    // NOM ET CHAMPS NON REMESURES au 08/09: la mise a jour de prix n'a pas ete
    // declenchee pendant la mesure. Seule l'enveloppe suit le patch (kind 2 ->
    // 1), qui est prouvee universelle sur 63 requetes. Tant que ce message n'a
    // pas ete remesure, le repricing ne peut pas fonctionner.
    '0a2d0a200a13747970652e616e6b616d612e636f6d2f6b6368120908f7f96b10ae17186410ffffffffffffffffff01',
  );
});

test('kch se relit comme une requete de type kch, uid -1', () => {
  const f = frame(trameMajPrix({ uid: 1768695, prix: 2990, taille: 100 }).toString('hex'));
  assert.strictEqual(f.kind, 'request');
  assert.strictEqual(f.type, 'kch');   // nom perime, voir ci-dessus
  assert.strictEqual(f.uid, -1n);
});

// MESURE DU 08/09, gid 17989. Le message s'appelle kde, et ses deux champs ont
// ECHANGE de numero: le gid etait en 1, il est en 2.
test('kde d abonnement porte le gid en champ 2, mesure sur le GID 17989', () => {
  assert.strictEqual(
    trameAbonner(17989).toString('hex'),
    '0a2a0a1d0a13747970652e616e6b616d612e636f6d2f6b64651206080110c58c0110ffffffffffffffffff01',
  );
});

// Le desabonnement est le MEME message SANS le drapeau. C'est le zero protobuf,
// qui ne s'ecrit pas — mais il porte desormais le CHAMP 1, pas le champ 2.
test('kde de desabonnement est le meme message sans le drapeau', () => {
  assert.strictEqual(
    trameDesabonner(17989).toString('hex'),
    '0a280a1b0a13747970652e616e6b616d612e636f6d2f6b6465120410c58c0110ffffffffffffffffff01',
  );
});

test('kbk reproduit les octets mesures, gid en champ 2', () => {
  assert.strictEqual(
    trameStats(2304).toString('hex'),
    '0a270a1a0a13747970652e616e6b616d612e636f6d2f6b626b120310801210ffffffffffffffffff01',
  );
});

// --- Ce qu'on lit --------------------------------------------------------

// LE TABLEAU DES PRIX SE LIT PAR `raw`, JAMAIS PAR `value`. Un champ LEN est
// ambigu par construction, et rawProto.js:60 avertit qu'il a deja fait prendre
// des varints empaquetes pour une chaine ou un sous-message. Les quatre valeurs
// ci-dessous sont celles qui suivaient la pose d'un lot de 100 a 2991.
// MESURE DU 08/09: kgp s'appelle kef, et ses champs ont tous bouge — les prix
// du champ 2 au CHAMP 4, le gid du 5 au 1, la categorie du 6 au 3.
test('kef rend les quatre prix, dans l ordre des tailles', () => {
  const lu = lirePrixMarche(frame('122d1a2b0a13747970652e616e6b616d612e636f6d2f6b6566121408801210ff3c1833220ac001cc0fe69201dc9817'));
  assert.deepStrictEqual(lu, { gid: 2304, categorie: 51, prix: [192, 1996, 18790, 379996] });
});

test('une trame qui n est pas kef n est pas lue comme telle', () => {
  assert.strictEqual(lirePrixMarche(frame('121d1a1b0a13747970652e616e6b616d612e636f6d2f6b636f12040888d552')), null);
});

// kbt s'appelle jzn, et porte toujours ses quatre prix au champ 6 d'un
// sous-message — mais ce sous-message est passe du champ 3 au CHAMP 2, le gid
// du 2 au 1, et la categorie du 1 au 3. Mesure du 08/09 sur l'Aile de Larve de
// Koutoulou: un lot de 1 a 94998, un lot de 10 a 1041985, rien au-dela.
test('jzn rend les quatre prix quand il porte son sous-message', () => {
  const lu = lireStatsPrix(frame('12351a330a13747970652e616e6b616d612e636f6d2f6a7a6e121c08c58c01121410c58c01186828d9e904320896e605c1cc3f00001868'));
  assert.deepStrictEqual(lu, { gid: 17989, categorie: 104, prix: [94998, 1041985, 0, 0] });
});

// Le jzn SANS sous-message est l'accuse du desabonnement du GID precedent. Le
// lire comme des stats ferait decider sur un tableau vide. La regle survit au
// patch: c'est la PRESENCE du detail qui distingue, seul son numero a change.
test('jzn sans sous-message est un accuse de desabonnement, pas des stats', () => {
  assert.strictEqual(lireStatsPrix(frame('121e1a1c0a13747970652e616e6b616d612e636f6d2f6a7a6e12050880121833')), null);
});

// kes s'appelle kda: l'objet passe du champ 1 au 3, le prix du 2 au 5, la
// duree du 4 au 2. Dans l'objet lui-meme, le gid passe du 3 au 2 et la taille
// du 4 au 3. Premier des cinq lots poses a la main le 08/09.
test('kda rend le lot pose : uid neuf, gid, taille, prix', () => {
  const lu = lireLotPose(frame('122c1a2a0a13747970652e616e6b616d612e636f6d2f6b646112131080d493011a0908fad452108012180128c001'));
  assert.deepStrictEqual(lu, { uid: 1354362, gid: 2304, taille: 1, prix: 192, duree: 2419200 });
});

// ken s'appelle kco et n'a PAS bouge de champ. L'uid ci-dessous est celui du
// quatrieme lot pose, le seul retire a la main: les deux trames se recoupent.
test('kco rend l uid du lot qui disparait', () => {
  assert.strictEqual(lireLotRetire(frame('121d1a1b0a13747970652e616e6b616d612e636f6d2f6b636f12040888d552')), 1354376);
});

// --- La vraie kby, celle du compte de mesure -----------------------------
//
// EN ATTENTE DE MESURE. kby est le seul message HDV que la session du 08/09 n'a
// pas pu livrer: il n'est emis qu'a l'ouverture de l'hotel, et la liste de
// ventes etait vide a ce moment-la. Son nom courant est donc inconnu, et
// lireNosLots ne peut rien lire. Les fixtures ci-dessous restent celles d'aout;
// les tests sont suspendus plutot que retouches, pour qu'ils redisent la verite
// des qu'une mesure les rattrapera.
//
// 8180 octets, capturee le 01/09. L'interface du jeu affichait « 376 lots en
// vente » au meme instant: c'est la seule verification de bout en bout qu'on
// puisse faire sur ce lecteur, et elle vaut mieux qu'une trame fabriquee.
test('kby rend les 376 lots du compte de mesure', { skip: "kby non remesure au 08/09 : la liste de ventes etait VIDE a l'ouverture, donc le message n'a pas ete emis. Rouvrir l'hotel avec des lots en vente le fera apparaitre." }, () => {
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

test('kby : le premier lot porte les valeurs mesurees', { skip: "kby non remesure au 08/09 : la liste de ventes etait VIDE a l'ouverture, donc le message n'a pas ete emis. Rouvrir l'hotel avec des lots en vente le fera apparaitre." }, () => {
  const hex = fs.readFileSync(path.join(__dirname, 'fixtures', 'hdv-kby.hex'), 'utf8').trim();
  const lots = lireNosLots(frame(hex));
  assert.deepStrictEqual(lots[0], { uid: 1738966, gid: 8308, taille: 1, prix: 143, duree: 2411322 });
});

// La duree de mise en vente vaut 2 419 200 secondes, soit exactement 28 jours.
// Aucun lot n'en porte davantage: c'est le plafond, et les valeurs mesurees
// sont ce plafond moins le temps ecoule.
test('kby : aucune duree ne depasse les 28 jours du plafond', { skip: "kby non remesure au 08/09 : la liste de ventes etait VIDE a l'ouverture, donc le message n'a pas ete emis. Rouvrir l'hotel avec des lots en vente le fera apparaitre." }, () => {
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

// MESURE DU 08/09: cinq lots poses a la main sur la meme pile, cinq kcr
// identiques. Les TROIS champs ont tourne d'un cran: le prix etait en 1 il est
// en 2, l'uid de pile en 2 il est en 3, la taille en 3 elle est en 1.
//
// Le prix 192 se recoupe avec les quatre prix du marche que kef poussait au
// meme instant, [192, 1996, 18790, 379996] pour les tailles [1, 10, 100, 1000]:
// c'est bien le prix du lot de UN, ce qui fixe aussi la taille a 1.
test('kcr reproduit les octets des cinq poses mesurees', () => {
  assert.strictEqual(
    trameMettreEnVente({ prix: 192, uidPile: 9520147, taille: 1 }).toString('hex'),
    '0a2e0a210a13747970652e616e6b616d612e636f6d2f6b6372120a080110c001189388c50410ffffffffffffffffff01',
  );
});

// Les octets de la pose depuis la BANQUE n'ont pas ete refaits le 08/09. On
// verifie donc les ROLES plutot que des octets qu'on aurait construits soi-meme:
// un test qui figerait une trame jamais vue ne prouverait que sa propre recette.
test('kcr range prix, pile et taille chacun a son champ', () => {
  const f = frame(trameMettreEnVente({ prix: 29, uidPile: 84496683, taille: 10 }).toString('hex'));
  const par = Object.fromEntries(f.payload.map((c) => [c.no, c.value]));
  assert.strictEqual(par[1], 10n, 'taille');
  assert.strictEqual(par[2], 29n, 'prix');
  assert.strictEqual(par[3], 84496683n, 'uid de la pile');
});

test('kcr se relit comme une requete de type kcr, uid -1', () => {
  const f = frame(trameMettreEnVente({ prix: 29, uidPile: 84496683, taille: 1 }).toString('hex'));
  assert.strictEqual(f.kind, 'request');
  assert.strictEqual(f.type, 'kcr');
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
  // `pos` s'est ajoute le 03/09 pour la chasse a l'archimonstre: c'est la
  // position d'equipement, 63 valant « range », donc pas equipe.
  //
  // `rangement` s'est ajoute le 05/09, pour la meme chasse: d'ou vient la pile,
  // 1 l'inventaire et 2 la banque. Il est `null` ici, et il l'est dans TOUTES
  // les captures du depot -- le serveur ne le marque que dans la reponse a
  // `itr`, jamais dans l'ivx de connexion.
  assert.deepStrictEqual(pile, {
    uid: 84495873, gid: 13731, qte: 286, avecEffets: false, pos: 63, rangement: null,
  });
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
  assert.strictEqual(lireStock(frame(inv)).filter((p) => p.avecEffets).length, 204);
  assert.strictEqual(lireStock(frame(banque)).filter((p) => p.avecEffets).length, 57);
});

test('lireStock rend un tableau vide sur un type inconnu', () => {
  assert.deepStrictEqual(lireStock(frame('0a170a150a13747970652e616e6b616d612e636f6d2f6b7261')), []);
});

// LES TROIS LECTEURS ENCAISSENT UNE TRAME ABSENTE. Le decodage en amont peut
// rendre null, et l ecoute passe alors ce null tel quel: les gardes sont
// ecrites dans les trois fonctions, mais rien ne les figeait.
test('les lecteurs encaissent une trame absente', () => {
  assert.deepStrictEqual(lireStock(null), []);
  assert.strictEqual(lirePileMaj(null), null);
  assert.strictEqual(lirePileDisparue(null), null);
});
