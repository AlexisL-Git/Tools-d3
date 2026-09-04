'use strict';
const { collection } = require('./archimonstres');
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
//
// TRIEES UNE FOIS PAR COLLECTION, au premier usage: la table ne bouge pas, et
// le panneau peut se redessiner a chaque clic sans repayer le tri.
const TRIEES = new Map();
function lignesDe(quoi) {
  if (!TRIEES.has(quoi)) {
    const c = collection(quoi);
    TRIEES.set(quoi, {
      titre: c.titre,
      parId: c.parId,
      liste: [...c.entrees].sort((a, b) => (a.niveau - b.niveau) || (a.id - b.id)),
    });
  }
  return TRIEES.get(quoi);
}

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
// `quoi` choisit la collection: 'archi' pour les 286 archimonstres, 'boss' pour
// les 51 boss du Dofus Ocre. Une cle inconnue rend les archimonstres -- le
// panneau ne peut pas casser sur une faute de frappe.
function construire({ comptes, vise = null, quoi = 'archi' }) {
  const liste = (comptes || []).filter((c) => c !== null && c !== undefined);
  const { liste: LIGNES, parId, titre } = lignesDe(quoi);
  const estDeLaTable = (id) => parId.has(id);

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
    // CE QUI N EST PAS DE CETTE COLLECTION SE COMPTE A PART, jamais perdu et
    // jamais invente en ligne fantome. Dans la vue des archimonstres ce sont
    // les ames de boss -- trois des 143 mesurees le 04/09 -- et dans la vue des
    // boss ce sont les archimonstres.
    const possede = [...c.ames].filter(estDeLaTable).length;
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
    titre,
    total: LIGNES.length,
    lignes,
    comptes: rendus,
    possedes,
    manquants: LIGNES.length - possedes,
    // OU CHASSER, dans le meme aller-retour: le panneau bascule d'une vue a
    // l'autre sans rien redemander au process principal.
    zones: parZones({ lignes, comptes: rendus, vise, quoi }),
  };
}

module.exports = { construire };
