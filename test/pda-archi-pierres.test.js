'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { tranche, choisir, POSITION_PIERRE } = require('../src/pda-archi/pierres');

const pile = (gid, uid, qte, pos = 63) => ({ gid, uid, qte, pos, avecEffets: false });

test('la tranche est la plus petite pierre qui couvre le niveau', () => {
  // Le plafond REEL, lu dans l effet 705 de l objet, pas son champ niveau.
  assert.strictEqual(tranche(1).gid, 9686);
  assert.strictEqual(tranche(50).gid, 9686);
  assert.strictEqual(tranche(51).gid, 9687);
  assert.strictEqual(tranche(100).gid, 9687);
  assert.strictEqual(tranche(101).gid, 9688);
  // 124 et 140, les deux cas rapportes par Jibef: la Grande, pas l Enorme.
  assert.strictEqual(tranche(124).gid, 9688);
  assert.strictEqual(tranche(140).gid, 9688);
  assert.strictEqual(tranche(150).gid, 9688);
  assert.strictEqual(tranche(151).gid, 9689);
  assert.strictEqual(tranche(190).gid, 9689);
  assert.strictEqual(tranche(191).gid, 9690);
});

// La Gargantuesque est ecartee: c'est le combat final d'une chasse, il se
// prepare a la main.
// La Gigantesque plafonne a 1000: rien de ce qui existe ne la depasse, donc la
// Gargantuesque reste inutile et le cas hors de portee ne tombe qu au-dela.
test('la Gigantesque couvre tout, et au-dela plus rien ne repond', () => {
  assert.strictEqual(tranche(230).gid, 9690);
  assert.strictEqual(tranche(1000).gid, 9690);
  assert.strictEqual(tranche(1001), null);
});

test('un niveau absurde ne repond pas non plus', () => {
  assert.strictEqual(tranche(0), null);
  assert.strictEqual(tranche(-1), null);
  assert.strictEqual(tranche(null), null);
});

test('la pierre presente en inventaire est celle a equiper', () => {
  const piles = [pile(9688, 111, 40), pile(9686, 222, 89)];
  assert.deepStrictEqual(choisir({ niveauMax: 120, piles }), {
    quoi: 'equiper', gid: 9688, uid: 111, qte: 40, purge: null,
  });
});

// Le cas nominal: une pierre est deja portee, c'est un remplacement.
test('une autre pierre deja portee ne change rien a la decision', () => {
  const piles = [pile(9687, 333, 47, POSITION_PIERRE), pile(9688, 111, 40)];
  assert.deepStrictEqual(choisir({ niveauMax: 120, piles }), {
    quoi: 'equiper', gid: 9688, uid: 111, qte: 40,
    purge: { uid: 333, qte: 47, gid: 9687 },
  });
});

test('la bonne pierre deja portee n appelle aucun ordre', () => {
  const piles = [pile(9688, 111, 40, POSITION_PIERRE)];
  assert.deepStrictEqual(choisir({ niveauMax: 120, piles }), { quoi: 'deja', gid: 9688 });
});

// JAMAIS DE REMPLACEMENT PAR LA TRANCHE DU DESSUS. Une Enorme capturerait bien
// un monstre de niveau 90, la regle du jeu etant « inferieur ou egal », mais
// elle vaut plus cher que ce que la capture rapporte. Decision de Jibef le
// 2026-09-03.
test('la tranche du dessus ne remplace jamais la tranche manquante', () => {
  const piles = [pile(9689, 444, 11)];
  assert.deepStrictEqual(choisir({ niveauMax: 120, piles }), {
    quoi: 'manque', gid: 9688, nom: 'Grande pierre d ame',
  });
});

test('un niveau hors portee ne fait rien et le dit', () => {
  const piles = [pile(9690, 555, 3)];
  assert.deepStrictEqual(choisir({ niveauMax: 2000, piles }), {
    quoi: 'hors-portee', niveauMax: 2000,
  });
});

// UNE PIERRE D AME VIDE PORTE DES EFFETS, mesure du 03/09: les quatre piles de
// l'inventaire mesure le font. Ecarter les piles a effets, comme le fait
// l'hotel de vente pour ne garder que les ressources, ecarterait ici TOUTES les
// pierres. Une pierre PLEINE n'est pas le meme objet, c'est le gid 7010.
test('une pierre porte des effets et reste equipable', () => {
  const piles = [{ gid: 9688, uid: 111, qte: 40, pos: 63, avecEffets: true }];
  assert.deepStrictEqual(choisir({ niveauMax: 120, piles }), {
    quoi: 'equiper', gid: 9688, uid: 111, qte: 40, purge: null,
  });
});

// A deux piles de la meme pierre, la plus grosse d'abord: c'est celle qui
// tiendra le plus de captures.
test('entre deux piles de la meme pierre, la plus grosse est choisie', () => {
  const piles = [pile(9688, 111, 3), pile(9688, 222, 40)];
  assert.deepStrictEqual(choisir({ niveauMax: 120, piles }), {
    quoi: 'equiper', gid: 9688, uid: 222, qte: 40, purge: null,
  });
});

// ---------------------------------------------------------------------------
// LE REPLI DE CALIBRE, decision d'Alexis le 2026-09-07.
//
// La decision de Jibef du 03/09 tient toujours quand la case est decochee: une
// pierre trop grosse vaut plus cher que ce que la capture rapporte, et c'est le
// defaut. Mais partir NU coute le combat entier, et c'est ce qui se passait des
// que le stock de la tranche exacte tombait a zero. La regle devient donc un
// reglage, et le test ci-dessus -- « la tranche du dessus ne remplace jamais »
// -- reste tel quel: il decrit le defaut.

test('avec le repli, la tranche du dessus prend la place de la manquante', () => {
  const piles = [pile(9689, 444, 11)];
  assert.deepStrictEqual(choisir({ niveauMax: 120, piles, monterEnCalibre: true }), {
    quoi: 'equiper', gid: 9689, uid: 444, qte: 11, purge: null,
    repli: { gid: 9688, nom: 'Grande pierre d ame' },
  });
});

// Deux crans d'un coup: ni Grande ni Enorme, il reste la Gigantesque. La
// montee ne s'arrete pas au premier trou.
test('le repli saute autant de crans qu il en manque', () => {
  const piles = [pile(9690, 555, 3)];
  assert.deepStrictEqual(choisir({ niveauMax: 120, piles, monterEnCalibre: true }), {
    quoi: 'equiper', gid: 9690, uid: 555, qte: 3, purge: null,
    repli: { gid: 9688, nom: 'Grande pierre d ame' },
  });
});

// LE REPLI NE DESCEND JAMAIS. Une Moyenne (plafond 100) ne capture pas du 120,
// et l'avoir en stock ne doit pas ressembler a une solution.
test('le repli ignore les calibres trop petits', () => {
  const piles = [pile(9686, 111, 50), pile(9687, 222, 50)];
  assert.deepStrictEqual(choisir({ niveauMax: 120, piles, monterEnCalibre: true }), {
    quoi: 'manque', gid: 9688, nom: 'Grande pierre d ame',
  });
});

test('le repli qui ne trouve rien du tout le dit comme avant', () => {
  const piles = [];
  assert.deepStrictEqual(choisir({ niveauMax: 120, piles, monterEnCalibre: true }), {
    quoi: 'manque', gid: 9688, nom: 'Grande pierre d ame',
  });
});

// LA PIERRE PORTEE EST UN STOCK COMME UN AUTRE. Une Enorme deja en place, et
// pas de Grande en reserve: la retirer pour la remettre ne servirait a rien.
test('une pierre de repli deja portee ne se rejoue pas', () => {
  const piles = [pile(9689, 444, 11, POSITION_PIERRE)];
  assert.deepStrictEqual(choisir({ niveauMax: 120, piles, monterEnCalibre: true }), {
    quoi: 'deja', gid: 9689,
  });
});

// ON REDESCEND DES QUE LE STOCK REVIENT, et c'est ce qui garde le repli
// exceptionnel. Sans ca, une seule rupture ferait consommer des Enormes
// jusqu'a la fin de la session -- exactement la depense que la decision du
// 03/09 voulait eviter.
test('le repli rend la place a la bonne tranche des qu elle revient en stock', () => {
  const piles = [pile(9689, 444, 11, POSITION_PIERRE), pile(9688, 111, 40)];
  assert.deepStrictEqual(choisir({ niveauMax: 120, piles, monterEnCalibre: true }), {
    quoi: 'equiper', gid: 9688, uid: 111, qte: 40,
    purge: { uid: 444, qte: 11, gid: 9689 },
  });
});

// Le repli n'a pas a se declarer quand il n'a pas servi: la tranche exacte est
// la, le verdict est celui d'avant, au champ pres.
test('la tranche exacte disponible ne declare aucun repli', () => {
  const piles = [pile(9688, 111, 40), pile(9689, 444, 11)];
  assert.deepStrictEqual(choisir({ niveauMax: 120, piles, monterEnCalibre: true }), {
    quoi: 'equiper', gid: 9688, uid: 111, qte: 40, purge: null,
  });
});

// Hors de portee reste hors de portee: rien a quoi se replier au-dela de la
// Gigantesque.
test('le repli ne rattrape pas un niveau hors portee', () => {
  const piles = [pile(9690, 555, 3)];
  assert.deepStrictEqual(choisir({ niveauMax: 2000, piles, monterEnCalibre: true }), {
    quoi: 'hors-portee', niveauMax: 2000,
  });
});
