'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  ARCHIMONSTRES, SOUS_ZONES, VULKANIA, estArchimonstre, nomDe,
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

// Aucune sous-zone inutile: le fichier ne decrit que ce que les archimonstres
// citent, sinon il embarquerait les 562 sous-zones du jeu.
test('la table des zones ne porte que des sous-zones utiles', () => {
  const citees = new Set(ARCHIMONSTRES.flatMap((a) => a.sousZones));
  const inutiles = SOUS_ZONES.filter((s) => !citees.has(s.id));
  assert.deepStrictEqual(inutiles.map((s) => s.nom), []);
});

// Mesure du 04/09 sur DofusDB: 16 zones pour les 286 archimonstres retenus.
test('les 286 se repartissent sur 16 zones', () => {
  assert.strictEqual(new Set(SOUS_ZONES.map((s) => s.zone)).size, 16);
});
