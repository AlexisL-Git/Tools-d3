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

const { comparer, chercher, LIMITE_RECHERCHE } = require('../src/pepites/classement');

// --- comparer() -------------------------------------------------------

function ligne(gid, cout) {
  return { gid, taux: 1, prixMoyen: cout, coutParPepite: cout, suspect: false };
}

test('un gid absent de la passe precedente est une entree', () => {
  const r = comparer([], [ligne(303, 100)]);
  assert.strictEqual(r.lignes[0].etat, 'entree');
  assert.strictEqual(r.lignes[0].deltaRang, null);
  assert.strictEqual(r.lignes[0].deltaCout, null);
});

test('un gid qui gagne des rangs est une montee', () => {
  const avant = [ligne(1, 10), ligne(303, 100)];
  const apres = [ligne(303, 90), ligne(1, 10)];
  const r = comparer(avant, apres);
  const l = r.lignes.find((x) => x.gid === 303);
  assert.strictEqual(l.etat, 'montee');
  assert.strictEqual(l.deltaRang, 1);
  assert.strictEqual(l.deltaCout, -10);
});

test('un gid qui perd des rangs est une descente', () => {
  const avant = [ligne(303, 90), ligne(1, 100)];
  const apres = [ligne(1, 100), ligne(303, 110)];
  const l = comparer(avant, apres).lignes.find((x) => x.gid === 303);
  assert.strictEqual(l.etat, 'descente');
  assert.strictEqual(l.deltaRang, -1);
  assert.strictEqual(l.deltaCout, 20);
});

test('un gid au meme rang est stable, meme si son prix a bouge', () => {
  const l = comparer([ligne(303, 100)], [ligne(303, 105)]).lignes[0];
  assert.strictEqual(l.etat, 'stable');
  assert.strictEqual(l.deltaRang, 0);
  assert.strictEqual(l.deltaCout, 5);
});

// LE CAS QU'ON OUBLIE: il porte sur une ligne ABSENTE du classement courant,
// donc aucune boucle sur `courant` ne peut le produire.
test('un gid disparu du classement est une sortie, rendue a part', () => {
  const r = comparer([ligne(303, 100), ligne(1, 10)], [ligne(1, 10)]);
  assert.deepStrictEqual(r.lignes.map((x) => x.gid), [1]);
  assert.strictEqual(r.sorties.length, 1);
  assert.strictEqual(r.sorties[0].gid, 303);
  assert.strictEqual(r.sorties[0].etat, 'sortie');
});

test('une premiere passe sans precedent ne rend que des entrees', () => {
  const r = comparer(null, [ligne(303, 100), ligne(1, 10)]);
  assert.deepStrictEqual(r.lignes.map((x) => x.etat), ['entree', 'entree']);
  assert.deepStrictEqual(r.sorties, []);
});

// --- chercher() -------------------------------------------------------

test('la recherche trouve un objet recyclable par son nom', () => {
  const r = chercher({ texte: 'Bois de Frene', prixMoyens: new Map([[303, 12]]) });
  const l = r.find((x) => x.gid === 303);
  assert.ok(l, 'le Bois de Frene doit sortir');
  assert.strictEqual(l.nom, 'Bois de Frêne');
  assert.strictEqual(l.coutParPepite, 12 / 0.003000000026077032);
});

// LES NOMS DU JEU PORTENT DES ACCENTS, PAS LES CLAVIERS PRESSES. Chercher
// Chercher `frene` doit trouver le Bois de Frene, dont le nom du jeu porte
// un accent circonflexe. Sans cela la barre ne sert qu'a ceux qui savent
// deja ecrire ce qu'ils cherchent.
test('la recherche ignore les accents et la casse', () => {
  const r = chercher({ texte: 'FRENE', prixMoyens: new Map() });
  assert.ok(r.some((x) => x.gid === 303));
});

// UN OBJET RECYCLABLE SANS PRIX SE DIT, il ne se cache pas: la recherche
// repond « prix inconnu » la ou le classement, lui, ne peut pas le ranger.
test('un objet recyclable sans prix sort avec un cout null', () => {
  const l = chercher({ texte: 'Bois de Frene', prixMoyens: new Map() })
    .find((x) => x.gid === 303);
  assert.strictEqual(l.prixMoyen, null);
  assert.strictEqual(l.coutParPepite, null);
});

// INDICES FIXES, PAS DECOUVERTS. La version precedente cherchait `avecPrix`
// et `sansPrix` par findIndex et ne comparait que si `sansPrix !== -1` --
// donc passait par construction des que `avecPrix` valait -1 (rien trouve
// avec prix), sans jamais avoir verifie l'ordre reel. 'bois' rend 20
// resultats sur la table figee du depot (verifie a l'ecriture de ce test):
// seul gid 303 porte un prix, et le tri le place en tete.
test('les objets sans prix passent apres ceux qui en ont un', () => {
  const r = chercher({ texte: 'bois', prixMoyens: new Map([[303, 12]]) });
  assert.strictEqual(r.length, LIMITE_RECHERCHE, `attendu ${LIMITE_RECHERCHE} resultats pour 'bois'`);
  assert.strictEqual(r[0].gid, 303, 'le seul prix connu doit passer en tete');
  assert.notStrictEqual(r[0].coutParPepite, null);
  for (let i = 1; i < r.length; i += 1) {
    assert.strictEqual(r[i].coutParPepite, null, `l objet a l index ${i} devrait etre sans prix`);
  }
});

// LE PLAFOND DE LA RECHERCHE LIBRE, VERIFIE POUR DE VRAI: le test precedent
// montre deja qu'il s'applique a 'bois', celui-ci le verifie en le comparant
// a la constante exportee plutot que de recopier le chiffre 20 en dur.
test('la recherche ne depasse jamais LIMITE_RECHERCHE', () => {
  assert.strictEqual(LIMITE_RECHERCHE, 20);
  const r = chercher({ texte: 'bois', prixMoyens: new Map() });
  assert.ok(r.length <= LIMITE_RECHERCHE);
});

// LE SUSPECT DE chercher() N'EST PAS TESTE AILLEURS: classer() a sa propre
// verification plus haut, mais chercher() pose `suspect` sur un chemin de
// code different (elle part de TAUX, pas de prixMoyens) et pourrait diverger
// sans qu'aucun test ne le remarque.
test('la recherche marque suspect un prix a 10 kamas ou moins', () => {
  const l = chercher({ texte: 'Bois de Frene', prixMoyens: new Map([[303, PRIX_SUSPECT]]) })
    .find((x) => x.gid === 303);
  assert.strictEqual(l.suspect, true);
});

test('un objet non recyclable ne sort jamais de la recherche', () => {
  // 44 est l'Epee de Boisaille, taux 0.
  const r = chercher({ texte: 'Epee de Boisaille', prixMoyens: new Map([[44, 700]]) });
  assert.deepStrictEqual(r.filter((x) => x.gid === 44), []);
});

// UNE LETTRE RENDRAIT DES CENTAINES DE LIGNES a chaque frappe.
test('une recherche de moins de deux caracteres ne rend rien', () => {
  assert.deepStrictEqual(chercher({ texte: 'b', prixMoyens: new Map() }), []);
  assert.deepStrictEqual(chercher({ texte: '', prixMoyens: new Map() }), []);
  assert.deepStrictEqual(chercher({ texte: null, prixMoyens: new Map() }), []);
});
