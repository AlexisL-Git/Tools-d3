'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { fabriquerEtat, comptesArchi } = require('../outils/faux-etat');
const { NOMS } = require('../src/droits/liste');
const hdvReprix = require('../src/hdv/reprix');

// LES SIX ETATS SONT LA RAISON D'ETRE DU FAUX ETAT. Un banc qui ne montre que
// des lignes « intercepte » laisserait passer une regression sur l'affichage
// d'une ligne en erreur ou hors-ligne -- exactement les cas qu'on ne peut pas
// reproduire a la demande avec de vrais clients Dofus.
test('le faux etat couvre les six etats que vue.js sait produire', () => {
  const vus = new Set(fabriquerEtat().lignes.map((l) => l.etat));
  for (const attendu of ['intercepte', 'en-attente', 'non-intercepte', 'erreur', 'hors-ligne', 'inconnu']) {
    assert.ok(vus.has(attendu), `etat absent du faux etat : ${attendu}`);
  }
});

// Rien ne doit etre grise sur le banc: la page grise ce qui n'est pas dans
// `droits`, et un bouton grise sans raison se prend pour un bug de mise en page.
test('le faux etat accorde toutes les fonctions verrouillables', () => {
  assert.deepStrictEqual([...fabriquerEtat().droits].sort(), [...NOMS].sort());
});

test('une ligne et une seule est maitre, et elle est pilotable', () => {
  const etat = fabriquerEtat();
  const maitres = etat.lignes.filter((l) => l.estMaitre);
  assert.strictEqual(maitres.length, 1);
  assert.strictEqual(maitres[0].pilotable, true);
  assert.strictEqual(etat.sansMaitre, false);
});

// Les huit champs que main.js pose APRES construireVue: touche, archi et
// embleme (main.js:785-809), puis les cinq champs hdv* (main.js:754-765) que
// le menu HDV de chaque ligne et la fenetre des lots ecartes lisent
// directement. Les oublier ne casse rien au chargement: ca se voit comme une
// colonne vide, ou un menu HDV grise et inerte.
test('chaque ligne porte touche, archi, embleme et les cinq champs hdv*', () => {
  const lignes = fabriquerEtat().lignes;
  for (const l of lignes) {
    assert.ok('touche' in l, 'touche manquante');
    assert.ok('archi' in l, 'archi manquant');
    assert.strictEqual(l.embleme, null, 'le banc ne telecharge aucun embleme');
    assert.strictEqual(typeof l.hdvLots, 'number', 'hdvLots manquant ou mal type');
    assert.strictEqual(typeof l.hdvEnCours, 'boolean', 'hdvEnCours manquant ou mal type');
    assert.strictEqual(typeof l.hdvPiles, 'number', 'hdvPiles manquant ou mal type');
    assert.strictEqual(typeof l.hdvVenteEnCours, 'boolean', 'hdvVenteEnCours manquant ou mal type');
    assert.ok(l.hdvEcartes === null || typeof l.hdvEcartes === 'object', 'hdvEcartes de forme inattendue');
  }

  // Varie: au moins une ligne dans chaque cas, sinon un menu HDV grise
  // resterait grise en permanence sur le banc sans qu'un test le remarque.
  assert.ok(lignes.some((l) => l.hdvLots > 0), 'aucune ligne avec des lots');
  assert.ok(lignes.some((l) => l.hdvEnCours === true), 'aucune ligne avec une passe de prix en cours');
  assert.ok(lignes.some((l) => l.hdvPiles > 0), 'aucune ligne avec des piles en attente');
  assert.ok(lignes.some((l) => l.hdvVenteEnCours === true), 'aucune ligne en vente');
  const avecEcartes = lignes.find((l) => l.hdvEcartes !== null);
  assert.ok(avecEcartes, 'aucune ligne avec des lots ecartes');
  // La forme attendue par desktop/index.html: ouvrirEcartes() lit e.quoi,
  // e.lots, e.lignes (avec nom ou gid, taille, lots, moyenUnitaire, vise,
  // borne, motif) et e.tronque.
  assert.ok(['prix', 'vente'].includes(avecEcartes.hdvEcartes.quoi));
  assert.strictEqual(typeof avecEcartes.hdvEcartes.lots, 'number');
  assert.strictEqual(typeof avecEcartes.hdvEcartes.tronque, 'boolean');
  assert.ok(Array.isArray(avecEcartes.hdvEcartes.lignes) && avecEcartes.hdvEcartes.lignes.length > 0);
  const ligneEcartee = avecEcartes.hdvEcartes.lignes[0];
  for (const champ of ['gid', 'taille', 'lots', 'moyenUnitaire', 'vise', 'borne', 'motif']) {
    assert.ok(champ in ligneEcartee, `champ manquant dans une ligne ecartee : ${champ}`);
  }

  // Une ligne sans pid retombe sur le cas « pas de client », comme main.js
  // avec son aUnPid.
  const sansPid = lignes.find((l) => l.pid === null || l.pid === undefined);
  assert.ok(sansPid, 'aucune ligne sans pid pour verifier le repli');
  assert.deepStrictEqual(
    {
      hdvLots: sansPid.hdvLots,
      hdvEnCours: sansPid.hdvEnCours,
      hdvPiles: sansPid.hdvPiles,
      hdvVenteEnCours: sansPid.hdvVenteEnCours,
      hdvEcartes: sansPid.hdvEcartes,
    },
    { hdvLots: 0, hdvEnCours: false, hdvPiles: 0, hdvVenteEnCours: false, hdvEcartes: null },
    'une ligne sans pid doit avoir le repli 0 / false / null',
  );
});

// `null` et 0 ne veulent pas dire la meme chose: un inventaire pas encore lu
// n'est pas un personnage sans une seule ame. Le banc doit montrer les deux.
test('archi distingue l inventaire non lu du personnage sans ame', () => {
  const lignes = fabriquerEtat().lignes;
  assert.ok(lignes.some((l) => l.archi === null), 'aucune ligne a inventaire non lu');
  assert.ok(lignes.some((l) => l.archi > 0), 'aucune ligne avec des ames');
});

// Recopier les bornes les aurait laissees deriver au premier ajustement
// mesure en jeu -- meme raison que le commentaire de desktop/main.js:25.
test('les bornes hdv viennent des modules, pas d une copie', () => {
  const { hdvBornes } = fabriquerEtat();
  assert.deepStrictEqual(hdvBornes.reprix.lot, [hdvReprix.DELAI_MIN, hdvReprix.DELAI_MAX]);
  assert.deepStrictEqual(hdvBornes.reprix.objet, [hdvReprix.DELAI_OBJET_MIN, hdvReprix.DELAI_OBJET_MAX]);
});

// tableau.js compte sur la difference entre un Set vide et null.
test('les comptes archi melangent inventaires lus et non lus', () => {
  const comptes = comptesArchi();
  assert.ok(comptes.some((c) => c.ames instanceof Set), 'aucun inventaire lu');
  assert.ok(comptes.some((c) => c.ames === null), 'aucun inventaire non lu');
  for (const c of comptes) assert.strictEqual(typeof c.nom, 'string');
});

// Le faux etat est mute par le shim cote navigateur. S'il rendait toujours le
// meme objet, deux onglets partageraient leurs cases a cocher par le serveur.
test('fabriquerEtat rend un objet neuf a chaque appel', () => {
  const a = fabriquerEtat();
  const b = fabriquerEtat();
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.lignes, b.lignes);
  a.lignes[0].passeTour = !a.lignes[0].passeTour;
  assert.notStrictEqual(a.lignes[0].passeTour, b.lignes[0].passeTour);
});
