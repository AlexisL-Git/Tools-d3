'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decider, deciderPose, TAILLES } = require('../src/hdv/prix');

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

// HUIT LOTS DU MEME OBJET, ET UN SEUL AU MINIMUM. Signale en jeu le 03/09: des
// lots de 10 restes a 19814 et 19812 alors que le creneau etait tombe a 19809 —
// notre propre lot. Le test « est-ce le notre » regardait si UN QUELCONQUE de
// nos lots touchait le minimum, pas si CELUI-CI y etait: des le premier lot
// descendu, tous ses jumeaux plus chers etaient abandonnes, passe apres passe.
//
// S'ALIGNER, JAMAIS SOUS-COTER. Le minimum est deja le notre: descendre d'un
// kama serait l'auto-sous-cotation que ce module interdit. Meme raisonnement
// que deciderPose(), et il est borne — une fois aligne, le lot ne bouge plus.
test('le minimum est le notre mais CE lot-ci est plus cher : on s aligne', () => {
  const prix = decider({
    marche: [0, 19809, 0, 0],
    nos: [{ taille: 10, prix: 19814 }, { taille: 10, prix: 19809 }],
    taille: 10,
    prixActuel: 19814,
    moyenUnitaire: 1900,
  });
  assert.strictEqual(prix, 19809);
});

// Le pendant du precedent: ce lot-ci EST le minimum, il n'y a rien a emettre.
test('le minimum est le notre et c est CE lot-ci : on ne touche a rien', () => {
  const prix = decider({
    marche: [0, 19809, 0, 0],
    nos: [{ taille: 10, prix: 19814 }, { taille: 10, prix: 19809 }],
    taille: 10,
    prixActuel: 19809,
    moyenUnitaire: 1900,
  });
  assert.strictEqual(prix, null);
});

// Le minimum est le notre a 1 kama: le garde-fou passe AVANT l'alignement,
// comme chez deciderPose. S'aligner sur 1 kama serait brader huit lots d'un
// coup, et un kama ne se sous-cote pas non plus — 0 signifie « creneau vide ».
test('le minimum est le notre a 1 kama : on ne s aligne pas dessus', () => {
  const prix = decider({
    marche: [0, 1, 0, 0],
    nos: [{ taille: 10, prix: 320 }, { taille: 10, prix: 1 }],
    taille: 10,
    prixActuel: 320,
    moyenUnitaire: 32,
  });
  assert.strictEqual(prix, null);
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

// --- deciderPose : poser un lot NEUF ------------------------------------
//
// La regle de la mise en vente. Elle partage l'extrapolation avec decider()
// et differe sur deux points, mesures et tranches en conception:
// docs/superpowers/specs/2026-09-01-mise-en-vente-design.md.

test('deciderPose sous-cote un concurrent d un kama, comme decider', () => {
  assert.strictEqual(
    deciderPose({ marche: [19, 190, 1222, 18000], nos: [], taille: 100, moyenUnitaire: 12 }),
    1221,
  );
});

// LA DIFFERENCE QUI FAIT EXISTER LA FONCTION. decider() rend null ici pour ne
// pas se sous-coter soi-meme. deciderPose s'ALIGNE: sans cela, des qu'on a
// pose le premier lot d'un paquet le minimum est le notre, et tous les lots
// suivants seraient sautes en silence.
test('deciderPose s aligne quand le minimum est deja le notre', () => {
  const marche = [19, 190, 1222, 18000];
  const nos = [{ taille: 100, prix: 1222 }];
  assert.strictEqual(decider({ marche, nos, taille: 100, moyenUnitaire: 12 }), null);
  assert.strictEqual(deciderPose({ marche, nos, taille: 100, moyenUnitaire: 12 }), 1222);
});

// L'ORDRE DES CAS. Chez decider les deux tests rendent null, leur ordre est
// indifferent. Ici le test « est-ce le notre » rend un PRIX: le placer avant
// le garde-fou du minimum a 1 ferait poser a 1 kama.
test('deciderPose refuse un minimum a 1 meme quand ce lot est le notre', () => {
  assert.strictEqual(
    deciderPose({ marche: [1, 0, 0, 0], nos: [{ taille: 1, prix: 1 }], taille: 1, moyenUnitaire: 12 }),
    null,
  );
});

test('deciderPose extrapole du creneau voisin quand le sien est vide', () => {
  assert.strictEqual(
    deciderPose({ marche: [12, 122, 0, 0], nos: [], taille: 100, moyenUnitaire: 12 }),
    1220,
  );
});

test('deciderPose refuse une extrapolation hors du garde-fou', () => {
  assert.strictEqual(
    deciderPose({ marche: [100, 0, 0, 0], nos: [], taille: 10, moyenUnitaire: 1 }),
    null,
  );
});

// AUCUN CRENEAU SERVI: il n'y a rien a extrapoler, et decider() renonce. Poser
// au prix moyen vaut mieux que ne rien poser — c'est le seul endroit ou une
// pile sans marche du tout peut quand meme partir.
test('deciderPose pose au prix moyen quand aucun creneau n est servi', () => {
  const marche = [0, 0, 0, 0];
  assert.strictEqual(decider({ marche, nos: [], taille: 10, moyenUnitaire: 32 }), null);
  assert.strictEqual(deciderPose({ marche, nos: [], taille: 10, moyenUnitaire: 32 }), 320);
});

test('deciderPose renonce si le prix moyen est inconnu et le marche vide', () => {
  assert.strictEqual(
    deciderPose({ marche: [0, 0, 0, 0], nos: [], taille: 10, moyenUnitaire: 0 }),
    null,
  );
});

test('deciderPose refuse une taille qui n est pas un creneau', () => {
  assert.strictEqual(
    deciderPose({ marche: [19, 190, 1222, 18000], nos: [], taille: 50, moyenUnitaire: 12 }),
    null,
  );
});
