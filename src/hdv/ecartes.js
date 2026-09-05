'use strict';

// Le tableau des lots qui ne sont PAS partis, et pourquoi.
//
// Fonction pure: ni Electron, ni Frida, ni reseau, ni disque. Les deux passes
// de l'hotel de vente s'en servent, chacune a sa facon — la mise en vente y
// met tout ce qui n'a pas ete pose, la mise a jour des prix n'y met que les
// ecarts du garde-fou.
//
// POURQUOI IL EXISTE. Le bilan ne comptait que des lots « sautes ». Le 05/09,
// six lots de poils de barbe de Bwork mage sont partis a 7 000 002 kamas pour
// une marchandise qui en vaut 1520: la passe l'a su, elle n'avait aucun moyen
// de le dire. Un compteur ne se relit pas.
//
// LE GROUPEMENT PAR (gid, taille, motif) EST LA RAISON D'ETRE DU MODULE. Un
// marche delirant ecarte un PAQUET entier d'un coup — median quatre lots, et
// jusqu'a plusieurs dizaines — et le stock de mesure porte 6495 lots pour 1530
// paquets. Une ligne par lot serait illisible autant qu'inutile: ce qu'on veut
// lire, c'est « gid 13731, lots de 10, six lots, vise 7000001 contre un plafond
// a 7600 ».
//
// Le motif fait partie de la cle, et la taille aussi: le meme objet peut sortir
// par le haut sur un creneau et par le bas sur un autre, et les confondre
// mentirait sur ce qui s'est passe.
const PLAFOND_ECARTES = 200;

// LE PLAFOND PORTE SUR LES LIGNES, JAMAIS SUR LES LOTS. Une passe partie de
// travers sur un stock entier — un ivi absent, par exemple, et tout devient
// « moyen inconnu » — remplirait l'IPC d'un millier de lignes pour le seul
// plaisir de les tronquer a l'affichage. Les lignes deja retenues, elles,
// continuent de compter leurs lots: leur total reste exact.
function noterEcart(ecartes, ligne) {
  const deja = ecartes.find(
    (e) => e.gid === ligne.gid && e.taille === ligne.taille && e.motif === ligne.motif,
  );
  if (deja !== undefined) { deja.lots += ligne.lots; return ecartes; }
  if (ecartes.length >= PLAFOND_ECARTES) return ecartes;
  ecartes.push(ligne);
  return ecartes;
}

module.exports = { noterEcart, PLAFOND_ECARTES };
