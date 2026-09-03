'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { tranche, choisir, POSITION_PIERRE } = require('../src/chasse/pierres');

const pile = (gid, uid, qte, pos = 63) => ({ gid, uid, qte, pos, avecEffets: false });

test('la tranche est la plus petite pierre qui couvre le niveau', () => {
  assert.strictEqual(tranche(1).gid, 9686);
  assert.strictEqual(tranche(20).gid, 9686);
  assert.strictEqual(tranche(21).gid, 9687);
  assert.strictEqual(tranche(50).gid, 9687);
  assert.strictEqual(tranche(51).gid, 9688);
  assert.strictEqual(tranche(100).gid, 9688);
  assert.strictEqual(tranche(101).gid, 9689);
  assert.strictEqual(tranche(150).gid, 9689);
  assert.strictEqual(tranche(151).gid, 9690);
  assert.strictEqual(tranche(190).gid, 9690);
});

// La Gargantuesque est ecartee: c'est le combat final d'une chasse, il se
// prepare a la main.
test('au-dela de 190 aucune tranche ne repond', () => {
  assert.strictEqual(tranche(191), null);
  assert.strictEqual(tranche(230), null);
});

test('un niveau absurde ne repond pas non plus', () => {
  assert.strictEqual(tranche(0), null);
  assert.strictEqual(tranche(-1), null);
  assert.strictEqual(tranche(null), null);
});

test('la pierre presente en inventaire est celle a equiper', () => {
  const piles = [pile(9688, 111, 40), pile(9686, 222, 89)];
  assert.deepStrictEqual(choisir({ niveauMax: 90, piles }), {
    quoi: 'equiper', gid: 9688, uid: 111, qte: 40, purge: null,
  });
});

// Le cas nominal: une pierre est deja portee, c'est un remplacement.
test('une autre pierre deja portee ne change rien a la decision', () => {
  const piles = [pile(9687, 333, 47, POSITION_PIERRE), pile(9688, 111, 40)];
  assert.deepStrictEqual(choisir({ niveauMax: 90, piles }), {
    quoi: 'equiper', gid: 9688, uid: 111, qte: 40,
    purge: { uid: 333, qte: 47, gid: 9687 },
  });
});

test('la bonne pierre deja portee n appelle aucun ordre', () => {
  const piles = [pile(9688, 111, 40, POSITION_PIERRE)];
  assert.deepStrictEqual(choisir({ niveauMax: 90, piles }), { quoi: 'deja', gid: 9688 });
});

// JAMAIS DE REMPLACEMENT PAR LA TRANCHE DU DESSUS. Une Enorme capturerait bien
// un monstre de niveau 90, la regle du jeu etant « inferieur ou egal », mais
// elle vaut plus cher que ce que la capture rapporte. Decision de Jibef le
// 2026-09-03.
test('la tranche du dessus ne remplace jamais la tranche manquante', () => {
  const piles = [pile(9689, 444, 11)];
  assert.deepStrictEqual(choisir({ niveauMax: 90, piles }), {
    quoi: 'manque', gid: 9688, nom: 'Grande pierre d ame',
  });
});

test('un niveau hors portee ne fait rien et le dit', () => {
  const piles = [pile(9690, 555, 3)];
  assert.deepStrictEqual(choisir({ niveauMax: 200, piles }), {
    quoi: 'hors-portee', niveauMax: 200,
  });
});

// UNE PIERRE D AME VIDE PORTE DES EFFETS, mesure du 03/09: les quatre piles de
// l'inventaire mesure le font. Ecarter les piles a effets, comme le fait
// l'hotel de vente pour ne garder que les ressources, ecarterait ici TOUTES les
// pierres. Une pierre PLEINE n'est pas le meme objet, c'est le gid 7010.
test('une pierre porte des effets et reste equipable', () => {
  const piles = [{ gid: 9688, uid: 111, qte: 40, pos: 63, avecEffets: true }];
  assert.deepStrictEqual(choisir({ niveauMax: 90, piles }), {
    quoi: 'equiper', gid: 9688, uid: 111, qte: 40, purge: null,
  });
});

// A deux piles de la meme pierre, la plus grosse d'abord: c'est celle qui
// tiendra le plus de captures.
test('entre deux piles de la meme pierre, la plus grosse est choisie', () => {
  const piles = [pile(9688, 111, 3), pile(9688, 222, 40)];
  assert.deepStrictEqual(choisir({ niveauMax: 90, piles }), {
    quoi: 'equiper', gid: 9688, uid: 222, qte: 40, purge: null,
  });
});
