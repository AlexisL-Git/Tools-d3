'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decider, TAILLES } = require('../src/hdv/prix');

// Les chiffres de ces tests ne sont pas invents: ils viennent de la mesure du
// 01/09 sur la Pierre medicinale (GID 13731, prix moyen 32 kamas l'unite),
// docs/superpowers/specs/2026-09-01-trames-hdv.md.
const MARCHE_SERVI = [19, 190, 2700, 18000];
const MOYEN_PIERRE = 32;

test('marche servi et personne a nous dessus : on sous-cote d un cran', () => {
  const prix = decider({ marche: MARCHE_SERVI, nos: [], taille: 100, moyenUnitaire: MOYEN_PIERRE });
  assert.strictEqual(prix, 2699);
});

// LE PIEGE CENTRAL, et il est mesure. Apres la pose d un lot de 100 a 1222, le
// minimum du marche EST notre lot. Sous-coter le minimum sans regarder a qui il
// appartient ferait descendre a 1221, puis 1220, jusqu a zero.
test('le minimum est NOTRE lot : on ne touche a rien', () => {
  const prix = decider({
    marche: [19, 190, 1222, 18000],
    nos: [{ taille: 100, prix: 1222 }],
    taille: 100,
    moyenUnitaire: MOYEN_PIERRE,
  });
  assert.strictEqual(prix, null);
});

// La comparaison porte sur le GID ET la taille. Le minimum est par taille: un
// lot de 10 a 190 ne dit rien du creneau des lots de 100.
test('notre lot est au minimum d une AUTRE taille : on sous-cote quand meme', () => {
  const prix = decider({
    marche: [19, 190, 2700, 18000],
    nos: [{ taille: 10, prix: 190 }],
    taille: 100,
    moyenUnitaire: MOYEN_PIERRE,
  });
  assert.strictEqual(prix, 2699);
});

test('les quatre creneaux sont vides : rien a deduire, on ne pose pas', () => {
  const prix = decider({ marche: [0, 0, 0, 0], nos: [], taille: 100, moyenUnitaire: MOYEN_PIERRE });
  assert.strictEqual(prix, null);
});

// 0 n est pas un prix, c est une absence de concurrent. Le lot de 1000 se
// deduit du lot de 100: 2700 / 100 = 27 kamas l unite, donc 27000.
test('creneau vide : on deduit du voisin non vide, ramene a l unite', () => {
  const prix = decider({ marche: [19, 190, 2700, 0], nos: [], taille: 1000, moyenUnitaire: MOYEN_PIERRE });
  assert.strictEqual(prix, 27000);
});

// A distance egale, le plus petit creneau l emporte: il est plus liquide, donc
// son prix unitaire est mieux etabli. Ici le lot de 1 (19 l unite -> 190) plutot
// que le lot de 100 (27 l unite -> 270).
test('creneau vide, deux voisins a egale distance : le plus petit gagne', () => {
  const prix = decider({ marche: [19, 0, 2700, 0], nos: [], taille: 10, moyenUnitaire: MOYEN_PIERRE });
  assert.strictEqual(prix, 190);
});

test('creneau vide : une deduction plus du double du prix moyen est refusee', () => {
  const prix = decider({ marche: [1000, 0, 0, 0], nos: [], taille: 10, moyenUnitaire: 1 });
  assert.strictEqual(prix, null);
});

test('creneau vide : une deduction sous la moitie du prix moyen est refusee', () => {
  const prix = decider({ marche: [1, 0, 0, 0], nos: [], taille: 10, moyenUnitaire: 100 });
  assert.strictEqual(prix, null);
});

test('creneau vide : une deduction juste dans les bornes est acceptee', () => {
  // moyen du lot = 10 * 100 = 1000. Deduit = 2000, soit exactement le double.
  const prix = decider({ marche: [200, 0, 0, 0], nos: [], taille: 10, moyenUnitaire: 100 });
  assert.strictEqual(prix, 2000);
});

// Sans prix moyen, le garde-fou ne peut pas s appliquer. On refuse plutot que de
// deduire sans filet: ivi ne connait pas forcement tout ce qui est vendable.
test('creneau vide et prix moyen inconnu : on refuse la deduction', () => {
  const prix = decider({ marche: [19, 190, 2700, 0], nos: [], taille: 1000, moyenUnitaire: 0 });
  assert.strictEqual(prix, null);
});

// Un marche servi n a pas besoin du prix moyen: le garde-fou ne concerne que
// l extrapolation. Sans cette exception, un objet absent d ivi ne serait jamais
// mis a jour, alors que son prix de marche est connu.
test('marche servi et prix moyen inconnu : on sous-cote quand meme', () => {
  const prix = decider({ marche: MARCHE_SERVI, nos: [], taille: 100, moyenUnitaire: 0 });
  assert.strictEqual(prix, 2699);
});

test('une taille hors des quatre du jeu ne decide rien', () => {
  const prix = decider({ marche: MARCHE_SERVI, nos: [], taille: 50, moyenUnitaire: MOYEN_PIERRE });
  assert.strictEqual(prix, null);
});

// Un minimum de 1 kama ne peut pas se sous-coter: 0 n est pas un prix vendable,
// et c est aussi la valeur qui signifie « creneau vide » dans kgp. Emettre un
// lot a 0 le rendrait invisible dans le tableau qu on relit ensuite.
test('un minimum a 1 kama ne se sous-cote pas', () => {
  const prix = decider({ marche: [1, 0, 0, 0], nos: [], taille: 1, moyenUnitaire: MOYEN_PIERRE });
  assert.strictEqual(prix, null);
});

test('les quatre tailles du jeu, dans l ordre', () => {
  assert.deepStrictEqual(TAILLES, [1, 10, 100, 1000]);
});
