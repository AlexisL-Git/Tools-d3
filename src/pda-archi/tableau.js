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
//
// LE PERSONNAGE SUIVI N'ENTRE PAS ICI, et c'est la correction du 05/09. Il a
// existe un parametre `vise` qui restreignait « manquant » a un seul
// personnage dans la vue par zone; il cachait des endroits ou les trois autres
// avaient encore tout a prendre. La colonne suivie ne vit plus que dans le
// panneau, ou elle surligne et filtre la liste sans rien croiser.
//
// `quoi` choisit la collection: 'archi' pour les 286 archimonstres, 'boss' pour
// les 51 boss du Dofus Ocre. Une cle inconnue rend les archimonstres -- le
// panneau ne peut pas casser sur une faute de frappe.
function construire({ comptes, quoi = 'archi' }) {
  const liste = (comptes || []).filter((c) => c !== null && c !== undefined);
  const { liste: LIGNES, parId, titre } = lignesDe(quoi);
  const estDeLaTable = (id) => parId.has(id);

  // « MANQUANT » VEUT DIRE « MANQUANT A AU MOINS UN », ET LA REGLE EST ICI.
  //
  // Elle a ete ecrite trois fois et trois fois de travers: dans la vue par zone
  // le 05/09 (le personnage clique decidait du sens), dans cette meme vue le
  // 11/09 (un inventaire pas encore lu comptait comme complet), et dans le
  // filtre du panneau, ou elle vivait en HTML -- donc sans test -- et se
  // restreignait elle aussi au personnage clique. Un boss capture sur le
  // premier quittait la liste alors que les trois autres ne l avaient pas.
  //
  // Elle ne vit donc plus qu a UN endroit, que src/pda-archi/zones.js et le
  // panneau consomment tous les deux. Deux vues qui repondent a la meme
  // question ne peuvent plus se contredire.
  //
  // Un inventaire pas encore lu ne PROUVE rien: il ne peut pas faire disparaitre
  // une ligne. Ne pas savoir, c est garder.
  const manqueAQuelquUn = (presents) => {
    // AUCUN COMPTE DU TOUT: on montre ce qui existe. Un panneau ouvert avant que
    // les clients soient la doit lister le monde, pas une table vide.
    if (liste.length === 0) return true;
    return liste.some((c) => !(c.ames instanceof Set) || !presents.includes(c.pid));
  };

  const lignes = LIGNES.map((a) => {
    const presents = liste
      .filter((c) => c.ames instanceof Set && c.ames.has(a.id)).map((c) => c.pid);
    return {
      id: a.id,
      nom: a.nom,
      niveau: a.niveau,
      presents,
      // `presents` dit QUI l a; `manque` dit s il reste quelqu un a servir. Les
      // deux ne se deduisent pas l un de l autre des qu un inventaire n est pas
      // lu -- c est justement le piege du 11/09.
      manque: manqueAQuelquUn(presents),
    };
  });

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
    zones: parZones({ lignes, comptes: rendus, quoi }),
  };
}

module.exports = { construire };
