'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  decider, deciderPose, TAILLES, FACTEUR, MOTIFS_GARDE_FOU,
} = require('../src/hdv/prix');

// Les chiffres de ces tests ne sont pas inventes: ils viennent de la mesure du
// 01/09 sur la Pierre medicinale (GID 13731, prix moyen 32 kamas l'unite),
// docs/superpowers/specs/2026-09-01-trames-hdv.md.
const MARCHE_SERVI = [19, 190, 2700, 18000];
const MOYEN_PIERRE = 32;

test('marche servi et personne a nous dessus : on sous-cote d un cran', () => {
  const d = decider({ marche: MARCHE_SERVI, nos: [], taille: 100, moyenUnitaire: MOYEN_PIERRE });
  assert.strictEqual(d.prix, 2699);
  assert.strictEqual(d.motif, null);
});

// LE PIEGE CENTRAL, et il est mesure. Apres la pose d un lot de 100 a 1222, le
// minimum du marche EST notre lot. Sous-coter le minimum sans regarder a qui il
// appartient ferait descendre a 1221, puis 1220, jusqu a zero.
test('le minimum est NOTRE lot : on ne touche a rien', () => {
  const d = decider({
    marche: [19, 190, 1222, 18000],
    nos: [{ taille: 100, prix: 1222 }],
    taille: 100,
    moyenUnitaire: MOYEN_PIERRE,
  });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'deja-au-minimum');
});

// La comparaison porte sur le GID ET la taille. Le minimum est par taille: un
// lot de 10 a 190 ne dit rien du creneau des lots de 100.
test('notre lot est au minimum d une AUTRE taille : on sous-cote quand meme', () => {
  const d = decider({
    marche: [19, 190, 2700, 18000],
    nos: [{ taille: 10, prix: 190 }],
    taille: 100,
    moyenUnitaire: MOYEN_PIERRE,
  });
  assert.strictEqual(d.prix, 2699);
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
  const d = decider({
    marche: [0, 19809, 0, 0],
    nos: [{ taille: 10, prix: 19814 }, { taille: 10, prix: 19809 }],
    taille: 10,
    prixActuel: 19814,
    moyenUnitaire: 1900,
  });
  assert.strictEqual(d.prix, 19809);
});

// Le pendant du precedent: ce lot-ci EST le minimum, il n'y a rien a emettre.
test('le minimum est le notre et c est CE lot-ci : on ne touche a rien', () => {
  const d = decider({
    marche: [0, 19809, 0, 0],
    nos: [{ taille: 10, prix: 19814 }, { taille: 10, prix: 19809 }],
    taille: 10,
    prixActuel: 19809,
    moyenUnitaire: 1900,
  });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'deja-au-minimum');
});

// Le minimum est le notre a 1 kama: le garde-fou passe AVANT l'alignement,
// comme chez deciderPose. S'aligner sur 1 kama serait brader huit lots d'un
// coup, et un kama ne se sous-cote pas non plus — 0 signifie « creneau vide ».
test('le minimum est le notre a 1 kama : on ne s aligne pas dessus', () => {
  const d = decider({
    marche: [0, 1, 0, 0],
    nos: [{ taille: 10, prix: 320 }, { taille: 10, prix: 1 }],
    taille: 10,
    prixActuel: 320,
    moyenUnitaire: 32,
  });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'marche-a-1-kama');
});

test('les quatre creneaux sont vides : rien a deduire, on ne pose pas', () => {
  const d = decider({ marche: [0, 0, 0, 0], nos: [], taille: 100, moyenUnitaire: MOYEN_PIERRE });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'aucun-voisin');
});

// 0 n est pas un prix, c est une absence de concurrent. Le lot de 1000 se
// deduit du lot de 100: 2700 / 100 = 27 kamas l unite, donc 27000.
test('creneau vide : on deduit du voisin non vide, ramene a l unite', () => {
  const d = decider({ marche: [19, 190, 2700, 0], nos: [], taille: 1000, moyenUnitaire: MOYEN_PIERRE });
  assert.strictEqual(d.prix, 27000);
});

// A distance egale, le plus petit creneau l emporte: il est plus liquide, donc
// son prix unitaire est mieux etabli. Ici le lot de 1 (19 l unite -> 190) plutot
// que le lot de 100 (27 l unite -> 270).
test('creneau vide, deux voisins a egale distance : le plus petit gagne', () => {
  const d = decider({ marche: [19, 0, 2700, 0], nos: [], taille: 10, moyenUnitaire: MOYEN_PIERRE });
  assert.strictEqual(d.prix, 190);
});

// L'extrapolation garde sa borne a 2, plus serree que le garde-fou general:
// deduire d'un creneau voisin est une supposition sans ancre.
test('creneau vide : une deduction plus du double du prix moyen est refusee', () => {
  const d = decider({ marche: [1000, 0, 0, 0], nos: [], taille: 10, moyenUnitaire: 1 });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'deduction-trop-haute');
});

test('creneau vide : une deduction sous la moitie du prix moyen est refusee', () => {
  const d = decider({ marche: [1, 0, 0, 0], nos: [], taille: 10, moyenUnitaire: 100 });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'deduction-trop-basse');
});

test('creneau vide : une deduction juste dans les bornes est acceptee', () => {
  // moyen du lot = 10 * 100 = 1000. Deduit = 2000, soit exactement le double.
  const d = decider({ marche: [200, 0, 0, 0], nos: [], taille: 10, moyenUnitaire: 100 });
  assert.strictEqual(d.prix, 2000);
});

// Sans prix moyen, le garde-fou ne peut pas s appliquer. On refuse plutot que de
// deduire sans filet: ivi ne connait pas forcement tout ce qui est vendable.
test('creneau vide et prix moyen inconnu : on refuse la deduction', () => {
  const d = decider({ marche: [19, 190, 2700, 0], nos: [], taille: 1000, moyenUnitaire: 0 });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'moyen-inconnu');
});

// L'EXCEPTION DU 01/09 EST SUPPRIMEE, et c'est la decision du 05/09.
//
// Elle disait: un marche servi n'a pas besoin du prix moyen, le garde-fou ne
// concerne que l'extrapolation. Elle avait sa logique — sans elle, un objet
// absent d'ivi n'est jamais mis a jour. Mais une borne qui ne s'applique pas a
// tout ne garantit rien, et c'est exactement par cette porte qu'un marche
// delirant passait. Les objets hors ivi sont rares (ivi porte 9861 prix) et ils
// ne disparaissent plus en silence: ils sortent dans le tableau des ecartes.
test('marche servi et prix moyen inconnu : on ecarte, faute de filet', () => {
  const d = decider({ marche: MARCHE_SERVI, nos: [], taille: 100, moyenUnitaire: 0 });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'moyen-inconnu');
  // Le prix qu'on aurait emis reste visible: c'est ce que le tableau affiche.
  assert.strictEqual(d.vise, 2699);
});

test('une taille hors des quatre du jeu ne decide rien', () => {
  const d = decider({ marche: MARCHE_SERVI, nos: [], taille: 50, moyenUnitaire: MOYEN_PIERRE });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'taille-hors-creneaux');
});

// Un minimum de 1 kama ne peut pas se sous-coter: 0 n est pas un prix vendable,
// et c est aussi la valeur qui signifie « creneau vide » dans kgp. Emettre un
// lot a 0 le rendrait invisible dans le tableau qu on relit ensuite.
test('un minimum a 1 kama ne se sous-cote pas', () => {
  const d = decider({ marche: [1, 0, 0, 0], nos: [], taille: 1, moyenUnitaire: MOYEN_PIERRE });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'marche-a-1-kama');
});

test('un marche illisible ne decide rien', () => {
  const d = decider({ marche: [19, 190], nos: [], taille: 10, moyenUnitaire: MOYEN_PIERRE });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'marche-illisible');
});

test('les quatre tailles du jeu, dans l ordre', () => {
  assert.deepStrictEqual(TAILLES, [1, 10, 100, 1000]);
});

// --- LE GARDE-FOU GLOBAL ------------------------------------------------
//
// Signale en jeu le 05/09: six lots de 10 poils de barbe de Bwork mage poses a
// 7 000 002 kamas, pour un prix moyen de 152 kamas l'unite — soit 1520 le lot,
// et un facteur 4600. Le concurrent avait un prix delirant, et sous-coter d'un
// kama un prix delirant reste un prix delirant.
//
// Le garde-fou de l'extrapolation existait deja, mais il ne couvrait QUE le
// creneau vide. Des que le marche etait servi, aucune borne ne regardait le
// prix moyen.
const MOYEN_BARBE = 152;

test('marche servi a 4600 fois le prix moyen : on ecarte le lot', () => {
  const d = decider({
    marche: [0, 7000002, 0, 0],
    nos: [],
    taille: 10,
    prixActuel: 1520,
    moyenUnitaire: MOYEN_BARBE,
  });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'trop-haut');
});

// Le tableau du panneau montre le prix vise ET la borne franchie: sans les deux,
// la ligne « ecarte » n'apprend rien a qui la lit.
test('un ecart vers le haut porte le prix vise et le plafond', () => {
  const d = decider({
    marche: [0, 7000002, 0, 0], nos: [], taille: 10, moyenUnitaire: MOYEN_BARBE,
  });
  assert.strictEqual(d.vise, 7000001);
  assert.strictEqual(d.borne, 7600); // 5 * 152 * 10
});

// L'AUTRE SENS, et c'est celui qui coute vraiment des kamas. Un concurrent a 40
// kamas le lot de 10 pour une marchandise qui en vaut 1520: le sous-coter, ce
// serait bruler la pile pour rien.
test('marche servi sous le cinquieme du prix moyen : on ecarte le lot', () => {
  const d = decider({
    marche: [0, 40, 0, 0], nos: [], taille: 10, prixActuel: 1520, moyenUnitaire: MOYEN_BARBE,
  });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'trop-bas');
  assert.strictEqual(d.vise, 39);
  assert.strictEqual(d.borne, 304); // 152 * 10 / 5
});

// LES BORNES SONT INCLUSIVES. Exactement cinq fois le prix moyen passe, et
// exactement un cinquieme aussi: refuser a l'egalite se lirait mal dans un
// tableau qui affiche la borne juste a cote du prix vise.
test('exactement cinq fois le prix moyen passe', () => {
  // moyen du lot = 100 * 10 = 1000, plafond 5000. Le marche a 5001 -> 5000.
  const d = decider({ marche: [0, 5001, 0, 0], nos: [], taille: 10, moyenUnitaire: 100 });
  assert.strictEqual(d.prix, 5000);
});

test('exactement un cinquieme du prix moyen passe', () => {
  // moyen du lot = 100 * 10 = 1000, plancher 200. Le marche a 201 -> 200.
  const d = decider({ marche: [0, 201, 0, 0], nos: [], taille: 10, moyenUnitaire: 100 });
  assert.strictEqual(d.prix, 200);
});

// LA TAILLE DU LOT EST DANS LA BORNE, sans quoi tout lot de 100 serait ecarte:
// la borne se compare au prix du LOT, pas au prix unitaire.
test('la borne suit la taille du lot', () => {
  // Le meme prix unitaire de marche, a deux tailles: 300 le lot de 10 (moyen
  // 1000) passe, alors que 300 le lot de 1 (moyen 100, plafond 500) passe aussi
  // — mais 3000 le lot de 1 serait 30 fois le moyen.
  assert.strictEqual(decider({ marche: [0, 301, 0, 0], nos: [], taille: 10, moyenUnitaire: 100 }).prix, 300);
  assert.strictEqual(decider({ marche: [3001, 0, 0, 0], nos: [], taille: 1, moyenUnitaire: 100 }).motif, 'trop-haut');
});

// L'ALIGNEMENT SUR NOTRE PROPRE LOT PASSE PAR LA BORNE LUI AUSSI. Sans cela, un
// lot pose trop haut avant l'existence du garde-fou ferait monter tous ses
// jumeaux a son niveau: le defaut se propagerait a la pile entiere.
test('on ne s aligne pas sur un de nos lots pose hors des bornes', () => {
  const d = decider({
    marche: [0, 7000002, 0, 0],
    nos: [{ taille: 10, prix: 7000002 }, { taille: 10, prix: 7000005 }],
    taille: 10,
    prixActuel: 7000005,
    moyenUnitaire: MOYEN_BARBE,
  });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'trop-haut');
});

test('le facteur du garde-fou est expose, et vaut cinq', () => {
  assert.strictEqual(FACTEUR, 5);
});

// La mise a jour des prix ne montre que les ecarts du garde-fou: « deja au
// meilleur prix » est le cas normal, pas une anomalie.
test('les motifs du garde-fou sont distingues de ceux du cours normal', () => {
  assert.ok(MOTIFS_GARDE_FOU.has('trop-haut'));
  assert.ok(MOTIFS_GARDE_FOU.has('trop-bas'));
  assert.ok(MOTIFS_GARDE_FOU.has('moyen-inconnu'));
  assert.ok(!MOTIFS_GARDE_FOU.has('deja-au-minimum'));
  assert.ok(!MOTIFS_GARDE_FOU.has('marche-a-1-kama'));
});

// --- deciderPose : poser un lot NEUF ------------------------------------
//
// La regle de la mise en vente. Elle partage l'extrapolation avec decider()
// et differe sur deux points, mesures et tranches en conception:
// docs/superpowers/specs/2026-09-01-mise-en-vente-design.md.

test('deciderPose sous-cote un concurrent d un kama, comme decider', () => {
  assert.strictEqual(
    deciderPose({ marche: [19, 190, 1222, 18000], nos: [], taille: 100, moyenUnitaire: 12 }).prix,
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
  assert.strictEqual(decider({ marche, nos, taille: 100, moyenUnitaire: 12 }).prix, null);
  assert.strictEqual(deciderPose({ marche, nos, taille: 100, moyenUnitaire: 12 }).prix, 1222);
});

// L'ORDRE DES CAS. Chez decider les deux tests rendent null, leur ordre est
// indifferent. Ici le test « est-ce le notre » rend un PRIX: le placer avant
// le garde-fou du minimum a 1 ferait poser a 1 kama.
test('deciderPose refuse un minimum a 1 meme quand ce lot est le notre', () => {
  const d = deciderPose({
    marche: [1, 0, 0, 0], nos: [{ taille: 1, prix: 1 }], taille: 1, moyenUnitaire: 12,
  });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'marche-a-1-kama');
});

test('deciderPose extrapole du creneau voisin quand le sien est vide', () => {
  assert.strictEqual(
    deciderPose({ marche: [12, 122, 0, 0], nos: [], taille: 100, moyenUnitaire: 12 }).prix,
    1220,
  );
});

test('deciderPose refuse une extrapolation hors du garde-fou', () => {
  const d = deciderPose({ marche: [100, 0, 0, 0], nos: [], taille: 10, moyenUnitaire: 1 });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'deduction-trop-haute');
});

// AUCUN CRENEAU SERVI: il n'y a rien a extrapoler, et decider() renonce. Poser
// au prix moyen vaut mieux que ne rien poser — c'est le seul endroit ou une
// pile sans marche du tout peut quand meme partir.
test('deciderPose pose au prix moyen quand aucun creneau n est servi', () => {
  const marche = [0, 0, 0, 0];
  assert.strictEqual(decider({ marche, nos: [], taille: 10, moyenUnitaire: 32 }).prix, null);
  assert.strictEqual(deciderPose({ marche, nos: [], taille: 10, moyenUnitaire: 32 }).prix, 320);
});

test('deciderPose renonce si le prix moyen est inconnu et le marche vide', () => {
  const d = deciderPose({ marche: [0, 0, 0, 0], nos: [], taille: 10, moyenUnitaire: 0 });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'moyen-inconnu');
});

test('deciderPose refuse une taille qui n est pas un creneau', () => {
  const d = deciderPose({
    marche: [19, 190, 1222, 18000], nos: [], taille: 50, moyenUnitaire: 12,
  });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'taille-hors-creneaux');
});

// LE CAS REEL, DU COTE DE LA MISE EN VENTE. C'est celui qui a coute les six
// lots: la passe posait, elle ne mettait pas a jour.
test('deciderPose ecarte le lot quand le marche est a 4600 fois le prix moyen', () => {
  const d = deciderPose({
    marche: [0, 7000002, 0, 0], nos: [], taille: 10, moyenUnitaire: MOYEN_BARBE,
  });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'trop-haut');
  assert.strictEqual(d.borne, 7600);
});

test('deciderPose ecarte un marche sous le cinquieme du prix moyen', () => {
  const d = deciderPose({
    marche: [0, 40, 0, 0], nos: [], taille: 10, moyenUnitaire: MOYEN_BARBE,
  });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'trop-bas');
});

// Le pendant de l'exception supprimee chez decider(): a la pose non plus, un
// marche servi ne suffit pas quand ivi ne connait pas l'objet.
test('deciderPose ecarte quand le prix moyen est inconnu, marche servi ou non', () => {
  const d = deciderPose({
    marche: [19, 190, 1222, 18000], nos: [], taille: 100, moyenUnitaire: 0,
  });
  assert.strictEqual(d.prix, null);
  assert.strictEqual(d.motif, 'moyen-inconnu');
});
