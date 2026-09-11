'use strict';
const { lirePrixMoyens } = require('../hdv/trames');
const { classer, comparer } = require('./classement');

// Le classement des pepites: une ecoute permanente.
//
// Conception: docs/superpowers/specs/2026-09-11-opti-pepite-design.md,
// completee par docs/superpowers/specs/2026-09-11-pepites-prix-marche-design.md.
//
// IL RESSEMBLE A reprix.js ET vente.js PAR SA FORME -- une ecoute permanente
// -- ET IL LEUR MANQUE TOUT LE RESTE. Ce module N'EMET AUCUNE TRAME. Pas de
// sequenceur, pas de rythme, pas de delai de reponse, pas de garde d'identite
// de client: rien de ce qui protege ces deux-la n'a d'objet ici, puisque rien
// ne part vers le jeu. C'est src/pepites/marche.js qui emet, pas ce module --
// voir sa propre note en tete pour ce que ca change.
//
// L'ECOUTE EST PERMANENTE PARCE QUE ivi N'ARRIVE QU'AU LOGIN. Elle ne se
// redemande pas. Un module qui ne se reveillerait qu'a l'ouverture du panneau
// aurait deja rate la seule trame qui dit les prix.
function creerPepites({
  historique,
  onPasse = () => {},
  maintenant = () => Date.now(),
}) {
  // La derniere table de prix connue, d'ou qu'elle vienne.
  //
  // ivi EST PROPRE A UN SERVEUR. Deux comptes sur deux serveurs differents
  // donneraient le classement du dernier connecte, et c'est la limite assumee
  // par la spec: les prix moyens de deux serveurs ne se moyennent pas, et
  // pretendre le contraire serait pire que la limite.
  let table = null;

  // Les prix releves devant l'etal, par gid. VIDEE A CHAQUE ivi NEUVE: une ivi
  // veut dire nouvelle connexion, et un prix de marche vieux d'une session
  // n'est plus un prix de marche -- il vaut moins que la moyenne, qui au moins
  // s'annonce comme une moyenne.
  const prixMarche = new Map();

  function noterPrixMarche(gid, prix, quand) {
    prixMarche.set(gid, { prix, quand });
  }

  function onTrame({ pid, dir, frame }) {
    if (frame === null || frame === undefined || dir !== 'in') return;
    if (frame.type !== 'itn') return;
    const prixMoyens = lirePrixMoyens(frame);
    // UNE TABLE VIDE N'EFFACE PAS CE QU'ON SAIT, meme regle que les piles dans
    // vente.js: le panneau deviendrait muet sans raison visible.
    if (prixMoyens.size === 0) return;
    prixMarche.clear();
    table = { prixMoyens, quand: maintenant(), pid };
    passer();
  }

  function passer() {
    // RIEN, ET SURTOUT PAS UN CLASSEMENT VIDE. Un tableau vide se lit comme
    // « aucun objet ne vaut le coup », alors que la verite est « je n'ai pas
    // encore vu les prix ». C'est au panneau de le dire.
    if (table === null) return null;
    const precedent = historique.dernier();
    const lignes = classer({ prixMoyens: table.prixMoyens, prixMarche });
    const passe = {
      quand: maintenant(),
      prixQuand: table.quand,
      pid: table.pid,
      lignes,
    };
    historique.ajouter(passe);
    const variation = comparer(precedent === null ? null : precedent.lignes, lignes);
    const resultat = { passe, variation };
    onPasse(resultat);
    return resultat;
  }

  // Ce que le panneau a besoin de savoir sans qu'on lui livre la table entiere.
  function etat() {
    if (table === null) return null;
    return { quand: table.quand, pid: table.pid, taille: table.prixMoyens.size };
  }

  // La table de prix elle-meme, pour la recherche libre: elle en a besoin pour
  // dire un cout, et la recopier a chaque frappe serait absurde.
  function prixMoyens() {
    return table === null ? null : table.prixMoyens;
  }

  // Les gids du dernier classement, dans l'ordre. C'est ce que la passe de
  // marche va tarifer -- et c'est pourquoi elle n'a pas besoin de connaitre le
  // classeur: elle recoit une liste.
  function candidats() {
    const d = historique.dernier();
    return d === null ? [] : d.lignes.map((l) => l.gid);
  }

  return {
    onTrame, passer, etat, prixMoyens, noterPrixMarche, candidats,
  };
}

module.exports = { creerPepites };
