'use strict';
const { ARCHIMONSTRES, estArchimonstre } = require('./archimonstres');
const { parZones } = require('./zones');

// Du croisement « qui possede quoi » au tableau affichable. Fonction pure: ni
// trame, ni reseau, ni disque, ni Electron.
//
// Conception: docs/superpowers/specs/2026-09-04-tableau-archimonstres-design.md.
//
// LE CROISEMENT EST ICI ET PAS DANS LE PANNEAU, pour la meme raison que
// src/hdv/stock.js existe: une regle qu on peut se tromper de sens merite un
// test, et une regle qui vit dans du HTML n en a pas.

// Du plus faible au plus fort: c est l ordre dans lequel on chasse.
const LIGNES = [...ARCHIMONSTRES].sort((a, b) => (a.niveau - b.niveau) || (a.id - b.id));

// `comptes` : [ { pid, nom, ames } ], ou `ames` est un Set d identifiants, ou
// NULL quand l inventaire de ce personnage n a pas encore ete lu.
//
// LA DIFFERENCE ENTRE `null` ET UN SET VIDE EST TOUT L INTERET DE CETTE
// FONCTION. Un inventaire pas encore lu n est pas un inventaire vide: le
// panneau affiche `—` pour le premier et `0` pour le second. Les confondre
// ferait passer un client lance avant OMNI pour un personnage sans une seule
// ame -- exactement le silence qui ressemble a une reponse, et qui a coute la
// soiree du 03/09.
// `vise` est le personnage dont on a clique le bouton, ou null. Il ne change
// rien au tableau lui-meme -- toutes les colonnes restent affichees -- il ne
// sert qu'a la vue par zone, ou « manquant » veut alors dire manquant POUR LUI.
function construire({ comptes, vise = null }) {
  const liste = (comptes || []).filter((c) => c !== null && c !== undefined);

  const lignes = LIGNES.map((a) => ({
    id: a.id,
    nom: a.nom,
    niveau: a.niveau,
    presents: liste.filter((c) => c.ames instanceof Set && c.ames.has(a.id)).map((c) => c.pid),
  }));

  const rendus = liste.map((c) => {
    if (!(c.ames instanceof Set)) {
      return {
        pid: c.pid, nom: c.nom, lu: false, possede: null, manquants: null, horsTableau: null,
      };
    }
    // UNE PIERRE CAPTURE AUSSI LES BOSS. Trois des 143 ames mesurees le 04/09
    // en etaient: Mansot Royal, Bouftou Royal, Mob l Eponge. Elles ne sont pas
    // des lignes du tableau, et elles ne sont pas perdues non plus -- elles se
    // comptent a part, sous le tableau.
    const possede = [...c.ames].filter(estArchimonstre).length;
    return {
      pid: c.pid,
      nom: c.nom,
      lu: true,
      possede,
      manquants: LIGNES.length - possede,
      horsTableau: c.ames.size - possede,
    };
  });

  // Ce que le groupe possede, tous personnages confondus: une ligne cochee
  // quelque part est un archimonstre qu on a. Les lignes vides sont ce qui
  // reste a chasser.
  const possedes = lignes.filter((l) => l.presents.length > 0).length;

  return {
    total: LIGNES.length,
    lignes,
    comptes: rendus,
    possedes,
    manquants: LIGNES.length - possedes,
    // OU CHASSER, dans le meme aller-retour: le panneau bascule d'une vue a
    // l'autre sans rien redemander au process principal.
    zones: parZones({ lignes, comptes: rendus, vise }),
  };
}

module.exports = { construire };
