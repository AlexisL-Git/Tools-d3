'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classer, PRIX_SUSPECT, LIMITE } = require('../src/pepites/classement');

// Trois gids reels, avec leurs vrais taux -- la table est figee dans le depot,
// autant s'en servir plutot que de doubler ce qu'on peut lire.
//
//   303   Bois de Frene      0.003000000026077032
//   13731 Pierre Medicinale  0.07114285714285715
//   44    Epee de Boisaille  pas recyclable
const FRENE = 0.003000000026077032;
const MEDICINALE = 0.07114285714285715;

test('le cout par pepite est le prix divise par le taux', () => {
  const l = classer({ prixMoyens: new Map([[303, 12]]) });
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].gid, 303);
  assert.strictEqual(l[0].taux, FRENE);
  assert.strictEqual(l[0].prixMoyen, 12);
  assert.strictEqual(l[0].coutParPepite, 12 / FRENE);
});

test('le moins cher par pepite passe devant', () => {
  // Medicinale a 19 kamas: 19 / 0.0711 = 267 kamas la pepite.
  // Frene a 12 kamas:      12 / 0.003  = 4 000 kamas la pepite.
  const l = classer({ prixMoyens: new Map([[303, 12], [13731, 19]]) });
  assert.deepStrictEqual(l.map((x) => x.gid), [13731, 303]);
});

// A COUT EGAL, LE TAUX LE PLUS ELEVE D'ABORD: meme depense, moins d'unites a
// trimballer jusqu'au prisme.
test('a cout egal le taux le plus eleve passe devant', () => {
  // On construit deux prix qui donnent exactement le meme cout par pepite.
  // 999 et pas 1000: en IEEE-754, (FRENE*1000)/FRENE et (MEDICINALE*1000)/
  // MEDICINALE ne rendent pas le meme flottant (1000 contre
  // 1000.0000000000001) -- un artefact d'arrondi du multiplicateur, pas un
  // bug du classeur. 999 fait le meme aller-retour a l'identique pour ces
  // deux taux.
  const prix = new Map([[303, FRENE * 999], [13731, MEDICINALE * 999]]);
  const l = classer({ prixMoyens: prix });
  assert.strictEqual(l[0].coutParPepite, l[1].coutParPepite);
  assert.deepStrictEqual(l.map((x) => x.gid), [13731, 303]);
});

// LE TRI DOIT ETRE TOTAL, sinon deux passes identiques peuvent rendre deux
// ordres differents et la colonne de variation invente des mouvements.
test('a taux egal le gid croissant departage', () => {
  // 7950 et 30365 ne partagent pas de taux; on prend deux gids d'un meme taux
  // en cherchant dans la table.
  const { TAUX } = require('../src/pepites/taux');
  const parTaux = new Map();
  for (const [cle, t] of Object.entries(TAUX)) {
    if (!parTaux.has(t)) parTaux.set(t, []);
    parTaux.get(t).push(Number(cle));
  }
  const paire = [...parTaux.values()].find((g) => g.length >= 2);
  assert.ok(paire, 'la table doit porter deux objets de meme taux');
  const [a, b] = paire.slice(0, 2).sort((x, y) => x - y);
  const t = require('../src/pepites/taux').tauxDe(a);
  const l = classer({ prixMoyens: new Map([[b, t * 100], [a, t * 100]]) });
  assert.deepStrictEqual(l.map((x) => x.gid), [a, b]);
});

test('un objet non recyclable n entre pas au classement', () => {
  const l = classer({ prixMoyens: new Map([[44, 700]]) });
  assert.deepStrictEqual(l, []);
});

test('un prix absent, nul ou negatif n entre pas au classement', () => {
  assert.deepStrictEqual(classer({ prixMoyens: new Map([[303, 0]]) }), []);
  assert.deepStrictEqual(classer({ prixMoyens: new Map([[303, -5]]) }), []);
  assert.deepStrictEqual(classer({ prixMoyens: new Map([[303, null]]) }), []);
});

// LE DOUTE EST UN MARQUEUR, JAMAIS UN FILTRE. La ligne reste a sa place.
test('un prix de 10 kamas ou moins est marque suspect sans etre ecarte', () => {
  assert.strictEqual(PRIX_SUSPECT, 10);
  const l = classer({ prixMoyens: new Map([[303, PRIX_SUSPECT]]) });
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].suspect, true);
});

test('un prix de 11 kamas n est pas suspect', () => {
  const l = classer({ prixMoyens: new Map([[303, PRIX_SUSPECT + 1]]) });
  assert.strictEqual(l[0].suspect, false);
});

test('le classement coupe a 50 lignes', () => {
  assert.strictEqual(LIMITE, 50);
  const { TAUX } = require('../src/pepites/taux');
  const prix = new Map();
  let n = 0;
  for (const cle of Object.keys(TAUX)) {
    if (n >= 60) break;
    prix.set(Number(cle), 1000 + n);
    n += 1;
  }
  assert.strictEqual(classer({ prixMoyens: prix }).length, 50);
});

test('la limite se regle, pour la recherche comme pour les tests', () => {
  const { TAUX } = require('../src/pepites/taux');
  const prix = new Map();
  let n = 0;
  for (const cle of Object.keys(TAUX)) {
    if (n >= 10) break;
    prix.set(Number(cle), 1000 + n);
    n += 1;
  }
  assert.strictEqual(classer({ prixMoyens: prix, limite: 3 }).length, 3);
});

// UNE TABLE ABSENTE N'EST PAS UNE TABLE VIDE, mais les deux rendent le meme
// classement vide: c'est l'appelant qui sait dire « pas encore de prix », pas
// le classeur.
test('une table de prix absente rend un classement vide', () => {
  assert.deepStrictEqual(classer({ prixMoyens: null }), []);
  assert.deepStrictEqual(classer({ prixMoyens: new Map() }), []);
});
