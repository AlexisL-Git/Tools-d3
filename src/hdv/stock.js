'use strict';
const { TAILLES } = require('./trames');

// Du stock aux lots candidats: ce qu'on va poser, et dans quel ordre.
//
// Conception: docs/superpowers/specs/2026-09-01-mise-en-vente-design.md.
// Fonction pure: ni trame, ni reseau, ni disque.

// Du plus gros au plus petit. TAILLES est croissant chez trames.js parce que
// c'est l'ordre des quatre prix de kgp; ici c'est l'ordre de decoupage.
const DECROISSANT = [...TAILLES].sort((a, b) => b - a);

// 286 -> 100, 100, puis 10 huit fois, puis 1 six fois.
function decouper(quantite) {
  const lots = [];
  let reste = Number(quantite) || 0;
  if (!Number.isFinite(reste) || reste <= 0) return lots;
  for (const taille of DECROISSANT) {
    const n = Math.floor(reste / taille);
    for (let i = 0; i < n; i += 1) lots.push(taille);
    reste -= n * taille;
  }
  return lots;
}

// LES LIGNES DE CARACTERISTIQUES SEPARENT L'EQUIPEMENT DE LA RESSOURCE, et
// c'est ce qui evite d'avoir a demander une categorie par GID. La categorie
// n'arrive que dans kbt.1, un objet a la fois: interroger un millier d'objets
// pour savoir lesquels sont vendables serait exactement le flot que le rythme
// cherche a eviter.
//
// LE CHAMP 2 DIT « CET OBJET PORTE DES EFFETS », PAS « C'EST UN EQUIPEMENT ».
// Mesure du 01/09: 204 des 219 piles d'inventaire en portent, dont 179 a
// quantite 1 — de l'equipement. Mais 57 des 814 piles de banque en portent
// aussi, dont 52 a quantite superieure a 1, jusqu'a 1349: des consommables ou
// des runes. Une RESSOURCE, elle, n'a pas d'effets — c'est ce qui rend le champ
// utilisable pour trier ce que l'hotel de vente ressources accepte.
//
// LE TRI EST LE COEUR DE LA FONCTION. La passe n'ira jamais au bout — le
// plafond de l'hotel de vente l'arretera apres quelques centaines de lots —
// donc l'ordre ne decide pas de la sequence, il decide de CE QUI SERA VENDU.
// A nombre d'emplacements egal, l'ordre par valeur pose 1,4 a 2,3 fois plus de
// valeur que le groupage par objet.
//
// Les departages apres la valeur ne servent qu'a rendre le tri deterministe,
// donc testable.
function candidats({ piles, prixMoyens }) {
  const table = prixMoyens instanceof Map ? prixMoyens : new Map();
  const lots = [];
  for (const pile of piles || []) {
    if (pile === null || pile === undefined || pile.avecEffets) continue;
    const moyen = Number(table.get(pile.gid)) || 0;
    for (const taille of decouper(pile.qte)) {
      lots.push({ uidPile: pile.uid, gid: pile.gid, taille, valeur: moyen * taille });
    }
  }
  lots.sort((a, b) => (b.valeur - a.valeur) || (b.taille - a.taille) || (a.gid - b.gid));
  return lots;
}

// UN PAQUET EST UNE VISITE D'OBJET. Deux lots de meme GID et de meme taille
// ont la meme valeur, donc le tri les place cote a cote: le paquet tombe tout
// seul. Sur le stock de mesure, 6495 lots forment 1530 paquets, de taille
// mediane 4 — exactement le geste « Entree, Entree, Entree, Entree ».
function paquets(lots) {
  const out = [];
  for (const lot of lots || []) {
    const dernier = out[out.length - 1];
    if (dernier !== undefined && dernier.gid === lot.gid && dernier.taille === lot.taille) {
      dernier.lots.push(lot);
    } else {
      out.push({ gid: lot.gid, taille: lot.taille, lots: [lot] });
    }
  }
  return out;
}

module.exports = { decouper, candidats, paquets };
