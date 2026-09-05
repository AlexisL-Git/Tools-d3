'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ARCHIMONSTRES } = require('../src/pda-archi/archimonstres');
const { construire } = require('../src/pda-archi/tableau');
const { parZones } = require('../src/pda-archi/zones');

const TOUS = ARCHIMONSTRES.map((a) => a.id);

// Tofumanchou l'Empereur se trouve dans DEUX sous-zones, toutes deux en Amakna:
// le Cimetière et les Cryptes du cimetière. C'est le cas qui separe les deux
// facons de compter, et c'est pour ca qu'il sert de repere ici.
const TOFUMANCHOU = 2357;

// L'arbre, tel que le panneau le recevra.
const arbre = ({ comptes }) => parZones(construire({ comptes }));

const zoneDe = (arb, nom) => arb.find((z) => z.zone === nom);
const sousZoneDe = (arb, zone, nom) => zoneDe(arb, zone).sousZones.find((s) => s.nom === nom);

// Mesure du 04/09: 16 zones, Amakna en tete avec 78 archimonstres.
test('les zones sont triees par manquants decroissants', () => {
  const arb = arbre({ comptes: [] });
  assert.strictEqual(arb.length, 16);
  assert.deepStrictEqual(
    arb.slice(0, 4).map((z) => [z.zone, z.manquants]),
    [['Amakna', 78], ['Plaines de Cania', 48], ["Île d'Otomaï", 41], ['Astrub', 32]],
  );
});

test('les sous-zones d une zone sont triees pareil', () => {
  const sz = zoneDe(arbre({ comptes: [] }), 'Amakna').sousZones;
  const comptes = sz.map((s) => s.manquants);
  assert.deepStrictEqual(comptes, [...comptes].sort((a, b) => b - a));
});

// CHAQUE SOUS-ZONE EST UN ENDROIT OU L ATTRAPER: un archimonstre qui vit dans
// deux d'entre elles manque dans les deux.
test('un archimonstre dans deux sous-zones manque dans les deux', () => {
  const ames = new Set(TOUS.filter((id) => id !== TOFUMANCHOU));
  const arb = arbre({ comptes: [{ pid: 1, nom: 'Jibef', ames }] });
  assert.strictEqual(sousZoneDe(arb, 'Amakna', 'Cimetière').manquants, 1);
  assert.strictEqual(sousZoneDe(arb, 'Amakna', 'Cryptes du cimetière').manquants, 1);
});

// MAIS LE TOTAL DE LA ZONE NE LE COMPTE QU UNE FOIS. Sommer les sous-zones
// gonflerait Amakna toute seule, et le tri par « ou il en manque le plus »
// designerait la mauvaise region.
test('le total d une zone ne compte chaque archimonstre qu une fois', () => {
  const ames = new Set(TOUS.filter((id) => id !== TOFUMANCHOU));
  const arb = arbre({ comptes: [{ pid: 1, nom: 'Jibef', ames }] });
  assert.strictEqual(zoneDe(arb, 'Amakna').manquants, 1);
});

test('ce qu on possede ne manque plus nulle part', () => {
  const arb = arbre({ comptes: [{ pid: 1, nom: 'Jibef', ames: new Set(TOUS) }] });
  assert.deepStrictEqual(arb.filter((z) => z.manquants > 0), []);
});

// `qui` repond a « qui emmener », et c'est la raison d'etre des emblemes.
test('qui ne retient que les personnages a qui il manque quelque chose', () => {
  const arb = arbre({
    comptes: [
      { pid: 1, nom: 'Complet', ames: new Set(TOUS) },
      { pid: 2, nom: 'ManqueUn', ames: new Set(TOUS.filter((id) => id !== TOFUMANCHOU)) },
    ],
  });
  assert.deepStrictEqual(sousZoneDe(arb, 'Amakna', 'Cimetière').qui, [2]);
  assert.deepStrictEqual(zoneDe(arb, 'Amakna').qui, [2]);
});

// UN INVENTAIRE PAS ENCORE LU N EST PAS UN INVENTAIRE VIDE: on ne sait pas ce
// qu'il lui manque, donc on ne le fait pas se deplacer.
test('un personnage dont l inventaire n est pas lu n apparait pas dans qui', () => {
  const arb = arbre({ comptes: [{ pid: 1, nom: 'Jamais lu', ames: null }] });
  assert.deepStrictEqual(zoneDe(arb, 'Amakna').qui, []);
});

// AUCUN INVENTAIRE LU: on ne peut dire a personne ce qui lui manque, alors on
// montre ce qui existe. Un panneau ouvert avant que les clients soient la doit
// lister le monde, pas seize zeros -- qui se liraient « tu as tout ».
test('sans aucun inventaire lu, le monde entier reste a prendre', () => {
  const arb = arbre({ comptes: [{ pid: 1, nom: 'Jamais lu', ames: null }] });
  assert.strictEqual(zoneDe(arb, 'Amakna').manquants, 78);
});

// « A AU MOINS UN », ET SANS AUCUNE EXCEPTION. Ce que le premier possede
// n'efface donc rien: le second ne l'a pas, et la chasse sert aussi le second.
// C'est ce qui distingue cette vue du tableau, ou une case cochee quelque part
// suffit a l'equipe.
//
// IL A EXISTE UNE AUTRE LECTURE, et c'est le bug du 05/09: un parametre `vise`
// restreignait « manquant » au personnage dont on avait clique le bouton. Or le
// panneau s'ouvre TOUJOURS par ce bouton -- il n'existe aucun autre chemin --
// donc la vue par zone ne montrait jamais que la chasse d'un seul: un
// personnage complet effacait des zones ou ses trois mules n'avaient rien
// pris, et c'etaient justement les plus fournies. Le parametre a disparu.
test('il suffit qu un seul compte en manque pour que la zone reste', () => {
  const comptes = [
    { pid: 1, nom: 'Complet', ames: new Set(TOUS) },
    { pid: 2, nom: 'Vide', ames: new Set() },
  ];
  const amakna = zoneDe(arbre({ comptes }), 'Amakna');
  assert.strictEqual(amakna.manquants, 78);
  assert.deepStrictEqual(amakna.qui, [2]);
});

// L'AUTRE MOITIE DE LA MEME REGLE: une zone ne disparait que quand TOUS les
// comptes lus l'ont finie.
test('une zone finie par tous les comptes disparait', () => {
  const comptes = [
    { pid: 1, nom: 'Complet', ames: new Set(TOUS) },
    { pid: 2, nom: 'Complet aussi', ames: new Set(TOUS) },
  ];
  assert.deepStrictEqual(arbre({ comptes }), []);
});

// --- Ce qu'il manque exactement, sous-zone par sous-zone -------------------
//
// Le troisieme niveau: la sous-zone dit COMBIEN, et depliee elle dit QUOI.
// Sans lui, « Cimetière 6 » envoie chasser sans savoir quelle pierre preparer.

test('une sous-zone dit quels archimonstres il y manque', () => {
  const ames = new Set(TOUS.filter((id) => id !== TOFUMANCHOU));
  const cim = sousZoneDe(arbre({ comptes: [{ pid: 1, nom: 'Jibef', ames }] }), 'Amakna', 'Cimetière');
  assert.deepStrictEqual(cim.restants.map((r) => r.id), [TOFUMANCHOU]);
  assert.strictEqual(cim.restants[0].nom, "Tofumanchou l'Empereur");
  assert.ok(Number.isFinite(cim.restants[0].niveau));
});

// Le compte et la liste ne peuvent pas diverger: l'un est la longueur de
// l'autre.
test('le compte d une sous-zone est la longueur de sa liste', () => {
  const arb = arbre({ comptes: [] });
  const boiteuses = [];
  for (const z of arb) {
    for (const sz of z.sousZones) {
      if (sz.restants.length !== sz.manquants) boiteuses.push(z.zone + '/' + sz.nom);
    }
  }
  assert.deepStrictEqual(boiteuses, []);
});

// Meme ordre que le tableau: du plus faible au plus fort, c'est celui dans
// lequel on chasse -- et celui qui dit quelle pierre preparer.
test('les archimonstres d une sous-zone vont du plus bas niveau au plus haut', () => {
  const sz = sousZoneDe(arbre({ comptes: [] }), 'Amakna', 'Cimetière');
  const niveaux = sz.restants.map((r) => r.niveau);
  assert.deepStrictEqual(niveaux, [...niveaux].sort((a, b) => a - b));
});

// Chaque archimonstre porte SES emblemes: dans une meme sous-zone, deux
// personnages peuvent avoir besoin de deux monstres differents.
test('chaque archimonstre manquant dit a qui il manque', () => {
  const arb = arbre({
    comptes: [
      { pid: 1, nom: 'Complet', ames: new Set(TOUS) },
      { pid: 2, nom: 'ManqueUn', ames: new Set(TOUS.filter((id) => id !== TOFUMANCHOU)) },
    ],
  });
  const cim = sousZoneDe(arb, 'Amakna', 'Cimetière');
  assert.deepStrictEqual(cim.restants.map((r) => [r.id, r.qui]), [[TOFUMANCHOU, [2]]]);
});

// LE COMPTE ET LA LISTE NE PEUVENT PAS DIVERGER, a aucun niveau: une sous-zone
// affichee a toujours quelque chose a lister, et une sous-zone qui n'a rien a
// lister n'est plus affichee.
test('toute sous-zone affichee a quelque chose a lister', () => {
  const ames = new Set(TOUS.filter((id) => id !== TOFUMANCHOU));
  const arb = arbre({ comptes: [{ pid: 1, nom: 'Jibef', ames }] });
  const muettes = arb.flatMap((z) => z.sousZones).filter((s) => s.restants.length === 0);
  assert.deepStrictEqual(muettes, []);
});

// --- Ce qui est fait disparait ---------------------------------------------
//
// Une zone ou il ne reste rien n'est pas une information: c'est une ligne a
// sauter, et il y en a seize. Demande de Jibef le 2026-09-04. La regle vaut aux
// deux niveaux, et elle vit ICI plutot que dans l'affichage: « ou chasser » ne
// veut rien dire d'autre.

test('une sous-zone entierement faite disparait', () => {
  // Tout sauf Tofumanchou: seules ses deux sous-zones restent en Amakna.
  const ames = new Set(TOUS.filter((id) => id !== TOFUMANCHOU));
  const amakna = zoneDe(arbre({ comptes: [{ pid: 1, nom: 'Jibef', ames }] }), 'Amakna');
  assert.deepStrictEqual(
    amakna.sousZones.map((s) => s.nom).sort(),
    ['Cimetière', 'Cryptes du cimetière'],
  );
});

test('une zone entierement faite disparait', () => {
  const ames = new Set(TOUS.filter((id) => id !== TOFUMANCHOU));
  const arb = arbre({ comptes: [{ pid: 1, nom: 'Jibef', ames }] });
  assert.deepStrictEqual(arb.map((z) => z.zone), ['Amakna']);
});

test('tout fait ne laisse aucune zone', () => {
  const arb = arbre({ comptes: [{ pid: 1, nom: 'Jibef', ames: new Set(TOUS) }] });
  assert.deepStrictEqual(arb, []);
});

// La regle ne doit pas manger ce qui reste: une zone gardee garde TOUTES ses
// sous-zones ou il reste quelque chose.
test('une zone gardee garde ses sous-zones non faites', () => {
  const arb = arbre({ comptes: [] });
  const vides = arb.flatMap((z) => z.sousZones).filter((s) => s.manquants === 0);
  assert.deepStrictEqual(vides, []);
  assert.ok(arb.every((z) => z.sousZones.length > 0), 'aucune zone sans sous-zone');
});
