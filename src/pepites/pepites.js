'use strict';
const { lirePrixMoyens } = require('../hdv/trames');
const { classer, comparer } = require('./classement');

// Le classement des pepites: une ecoute permanente, et une minuterie.
//
// Conception: docs/superpowers/specs/2026-09-11-opti-pepite-design.md.
//
// IL RESSEMBLE A reprix.js ET vente.js PAR SA FORME -- une ecoute permanente
// plus un declencheur -- ET IL LEUR MANQUE TOUT LE RESTE. Ce module N'EMET
// AUCUNE TRAME. Pas de sequenceur, pas de rythme, pas de delai de reponse,
// pas de garde d'identite de client: rien de ce qui protege ces deux-la n'a
// d'objet ici, puisque rien ne part vers le jeu.
//
// C'EST AUSSI CE QUI REND LA PERIODICITE INOFFENSIVE. La spec du reprix
// (2026-09-01-maj-prix-hdv-design.md) ecartait explicitement « toute
// periodicite ». Ce qui etait refuse la-bas, c'est une passe de fond QUI EMET.
// Une minuterie qui ne fait que diviser des nombres deja recus ne se voit de
// nulle part.
//
// L'ECOUTE EST PERMANENTE PARCE QUE ivi N'ARRIVE QU'AU LOGIN. Elle ne se
// redemande pas. Un module qui ne se reveillerait qu'a l'ouverture du panneau
// aurait deja rate la seule trame qui dit les prix.
const PERIODE_MS = 12 * 60 * 60 * 1000;

// `poserMinuteur` et `oterMinuteur` entrent par argument pour que la minuterie
// se teste sans piloter d'horloge -- meme raison que le hasard passe en
// argument dans rythme() de reprix.js.
function creerPepites({
  historique,
  onPasse = () => {},
  periodeMs = PERIODE_MS,
  maintenant = () => Date.now(),
  poserMinuteur = (fn, ms) => setInterval(fn, ms),
  oterMinuteur = (id) => clearInterval(id),
}) {
  // La derniere table de prix connue, d'ou qu'elle vienne.
  //
  // ivi EST PROPRE A UN SERVEUR. Deux comptes sur deux serveurs differents
  // donneraient le classement du dernier connecte, et c'est la limite assumee
  // par la spec: les prix moyens de deux serveurs ne se moyennent pas, et
  // pretendre le contraire serait pire que la limite.
  let table = null;
  let minuteur = null;

  function onTrame({ pid, dir, frame }) {
    if (frame === null || frame === undefined || dir !== 'in') return;
    if (frame.type !== 'itn') return;
    const prixMoyens = lirePrixMoyens(frame);
    // UNE TABLE VIDE N'EFFACE PAS CE QU'ON SAIT, meme regle que les piles dans
    // vente.js: le panneau deviendrait muet sans raison visible.
    if (prixMoyens.size === 0) return;
    table = { prixMoyens, quand: maintenant(), pid };
    passer();
  }

  function passer() {
    // RIEN, ET SURTOUT PAS UN CLASSEMENT VIDE. Un tableau vide se lit comme
    // « aucun objet ne vaut le coup », alors que la verite est « je n'ai pas
    // encore vu les prix ». C'est au panneau de le dire.
    if (table === null) return null;
    const precedent = historique.dernier();
    // UNE PASSE NE SE COMPARE PAS A ELLE-MEME. Le battement des douze heures
    // et l'ivi sont independants (voir plus bas): sans cette garde, un
    // battement qui tombe sans ivi neuve entretemps recalculerait la MEME
    // table contre elle-meme -- tout ressortirait 'stable' a deltaCout 0, une
    // verite fausse plutot que « rien de neuf a comparer » -- et ecrirait une
    // entree identique dans un historique borne a 30, chassant la derniere
    // comparaison utile apres quinze jours sans connexion. La conception le
    // dit explicitement a propos du rattrapage: « Rattraper produirait deux
    // passes identiques a la file, puisque la table de prix, elle, n'a pas
    // change entretemps. » Meme defaut, meme correction que celle posee sur
    // le handler IPC en ronde 1 -- ici sur l'autre declencheur.
    if (precedent !== null && precedent.prixQuand === table.quand) return null;
    const lignes = classer({ prixMoyens: table.prixMoyens });
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

  // LA MINUTERIE NE SE REARME PAS SUR UNE ivi, et les deux declencheurs sont
  // independants: sans cela, une session de jeu reguliere -- donc une ivi par
  // connexion -- repousserait le battement des douze heures indefiniment, et
  // la periodicite n'existerait que pour ceux qui ne jouent pas.
  function demarrer() {
    if (minuteur !== null) return;
    minuteur = poserMinuteur(passer, periodeMs);
  }

  function arreter() {
    if (minuteur === null) return;
    oterMinuteur(minuteur);
    minuteur = null;
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

  return { onTrame, passer, demarrer, arreter, etat, prixMoyens };
}

module.exports = { creerPepites, PERIODE_MS };
