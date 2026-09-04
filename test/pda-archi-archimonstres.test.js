'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  ARCHIMONSTRES, BOSS, SOUS_ZONES, VULKANIA, estArchimonstre, nomDe,
} = require('../src/pda-archi/archimonstres');

// 286, et le chiffre est celui de Jibef. Le drapeau `isMiniBoss` des donnees du
// jeu en donne 306, mais vingt vivent dans l'Archipel de Vulkania, une ile
// SAISONNIERE: les compter ferait vingt lignes definitivement vides onze mois
// sur douze.
//
// Le compte est fige ici expres. Le jour ou le jeu en ajoute un vrai, ce test
// tombe -- et c'est ce qu'on veut: regenerer le fichier doit etre une decision,
// pas un effet de bord.
test('le fichier porte les 286 archimonstres', () => {
  assert.strictEqual(ARCHIMONSTRES.length, 286);
});

test('aucun identifiant en double', () => {
  const ids = new Set(ARCHIMONSTRES.map((a) => a.id));
  assert.strictEqual(ids.size, ARCHIMONSTRES.length);
});

// Le controle de Vulkania. La REGLE d'exclusion est la zone 50, pas la plage
// d'identifiants -- sinon le premier archimonstre ajoute dans cet intervalle
// casserait le filtre en silence. La plage ne sert qu'ici, a verifier.
test('aucun archimonstre de Vulkania', () => {
  const dedans = ARCHIMONSTRES.filter((a) => a.id >= VULKANIA.debut && a.id <= VULKANIA.fin);
  assert.deepStrictEqual(dedans, []);
});

test('chaque archimonstre porte un nom et un niveau', () => {
  const boiteux = ARCHIMONSTRES.filter(
    (a) => typeof a.nom !== 'string' || a.nom === '' || !Number.isFinite(a.niveau),
  );
  assert.deepStrictEqual(boiteux, []);
});

// L'ame mesuree le 04/09: effet 4058, premier parametre 2272.
test('nomDe rend le nom de l ame mesuree', () => {
  assert.strictEqual(nomDe(2272), 'Pichakoté le Dégoutant');
});

test('nomDe rend null pour un inconnu', () => {
  assert.strictEqual(nomDe(147), null);
});

// UNE PIERRE CAPTURE AUSSI LES BOSS, et c'est le cas NORMAL, pas une anomalie:
// l'inventaire mesure portait trois ames de boss sur 143. Sans cette
// distinction, le tableau les inventerait en lignes fantomes.
test('un boss n est pas un archimonstre', () => {
  assert.strictEqual(estArchimonstre(147), false); // Bouftou Royal
  assert.strictEqual(estArchimonstre(928), false); // Mob l'Eponge
  assert.strictEqual(estArchimonstre(2848), false); // Mansot Royal
});

test('un archimonstre en est un', () => {
  assert.strictEqual(estArchimonstre(2272), true);
});

// --- Les zones -------------------------------------------------------------
//
// La table des sous-zones vit dans son PROPRE fichier: repeter « Amakna » 286
// fois se relirait mal dans un diff et grossirait pour rien. Les archimonstres
// n'en portent que les identifiants.

test('chaque archimonstre est rattache a au moins une sous-zone', () => {
  const sans = ARCHIMONSTRES.filter((a) => !Array.isArray(a.sousZones) || a.sousZones.length === 0);
  assert.deepStrictEqual(sans.map((a) => a.nom), []);
});

test('toute sous-zone citee existe dans la table des zones', () => {
  const connues = new Set(SOUS_ZONES.map((s) => s.id));
  const orphelines = new Set();
  for (const a of ARCHIMONSTRES) for (const s of a.sousZones) if (!connues.has(s)) orphelines.add(s);
  assert.deepStrictEqual([...orphelines], []);
});

test('chaque sous-zone porte un nom et une zone', () => {
  const boiteuses = SOUS_ZONES.filter(
    (s) => typeof s.nom !== 'string' || s.nom === ''
      || typeof s.zone !== 'string' || s.zone === '',
  );
  assert.deepStrictEqual(boiteuses, []);
});

// Aucune sous-zone inutile: le fichier ne decrit que ce que les DEUX
// collections citent, sinon il embarquerait les 562 sous-zones du jeu.
test('la table des zones ne porte que des sous-zones utiles', () => {
  const citees = new Set([...ARCHIMONSTRES, ...BOSS].flatMap((a) => a.sousZones));
  const inutiles = SOUS_ZONES.filter((s) => !citees.has(s.id));
  assert.deepStrictEqual(inutiles.map((s) => s.nom), []);
});

// Mesure du 04/09 sur DofusDB: 16 zones pour les 286 archimonstres. Les boss en
// ajoutent quatre que les archimonstres ne touchent pas -- leurs donjons.
test('les 286 archimonstres se repartissent sur 16 zones', () => {
  const parId = new Map(SOUS_ZONES.map((s) => [s.id, s]));
  const zones = new Set(ARCHIMONSTRES.flatMap((a) => a.sousZones).map((i) => parId.get(i).zone));
  assert.strictEqual(zones.size, 16);
});

test('les deux collections ensemble touchent 20 zones', () => {
  assert.strictEqual(new Set(SOUS_ZONES.map((s) => s.zone)).size, 20);
});

// --- Les boss du Dofus Ocre ------------------------------------------------
//
// LA LISTE VIENT DE LA QUETE ELLE-MEME, pas d'un guide. Les objectifs de la
// quete 439 « L'éternelle moisson » nomment leur monstre par IDENTIFIANT:
//
//   Rapporter 1 âme de {monster,928} à {npc,6693}
//
// C'est ce qui evite l'homonymie, et elle est reelle: « Dragon Cochon » existe
// en id 113 niveau 100 ET en id 7863 niveau 212. Apparier par le nom, comme le
// font les guides, attrape le mauvais jumeau -- et le mauvais jumeau a l'ame
// incapturable.
//
// 19 etapes, 339 objectifs: 51 boss, 286 archimonstres, 2 pour finir.
test('les 51 boss du Dofus Ocre', () => {
  assert.strictEqual(BOSS.length, 51);
});

test('aucun identifiant de boss en double', () => {
  assert.strictEqual(new Set(BOSS.map((b) => b.id)).size, BOSS.length);
});

test('chaque boss porte un nom, un niveau et au moins une sous-zone', () => {
  const boiteux = BOSS.filter(
    (b) => typeof b.nom !== 'string' || b.nom === '' || !Number.isFinite(b.niveau)
      || !Array.isArray(b.sousZones) || b.sousZones.length === 0,
  );
  assert.deepStrictEqual(boiteux, []);
});

// Les deux listes ne se recouvrent pas: la quete demande les 286 archimonstres
// ET 51 boss, ce sont deux ensembles disjoints.
test('aucun boss n est un archimonstre', () => {
  const archi = new Set(ARCHIMONSTRES.map((a) => a.id));
  assert.deepStrictEqual(BOSS.filter((b) => archi.has(b.id)).map((b) => b.nom), []);
});

// Mob l'Éponge et Bouftou Royal etaient deux des trois ames de boss lues dans
// l'inventaire mesure le 04/09. Elles cessent d'etre « hors tableau ».
test('les ames de boss mesurees sont dans la liste', () => {
  const ids = new Set(BOSS.map((b) => b.id));
  assert.strictEqual(ids.has(928), true, "Mob l'Éponge");
  assert.strictEqual(ids.has(147), true, 'Bouftou Royal');
});

test('les sous-zones des boss sont toutes connues', () => {
  const connues = new Set(SOUS_ZONES.map((s) => s.id));
  const orphelines = new Set();
  for (const b of BOSS) for (const s of b.sousZones) if (!connues.has(s)) orphelines.add(s);
  assert.deepStrictEqual([...orphelines], []);
});
