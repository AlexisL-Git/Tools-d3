'use strict';

// L'hotel de vente ne s'ouvre que chez le maitre, et rien d'autre.
//
// LA DEMANDE. Utilisateur, le 09/09: « je veux que tu enleves le replicate
// ouvrir hdv avec les mules, c'est insupportable ». Sept panneaux d'hotel de
// vente qui s'ouvrent parce qu'on ouvre le sien.
//
// POURQUOI CE N'EST PAS UN SIMPLE FILTRE DE TYPE. L'etal de l'hotel de vente
// est un ELEMENT INTERACTIF, comme un zaap ou une porte: on l'ouvre par `iva`,
// le meme message exactement. Mesure du 09/09, journal-bug-0909.log:
//
//   139461 [19356] --> iva { 1=519826 5=11411 }   le clic sur l'etal
//   139491 [19356] <-- ivf { 2=519826 3=676438999334 4=355 5=1 }
//   139493 [19356] <-- isb { 1=460654 2={...} ... }   L'INTERFACE S'OUVRE
//
// Couper `iva` couperait donc aussi les zaaps, que l'utilisateur veut garder —
// c'est meme ainsi qu'il deplace son equipe (voir la table, entree `iva`).
//
// CE QUI DISTINGUE L'HDV, C'EST LA REPONSE, PAS LA REQUETE. Le clic est le
// meme partout; seul l'hotel de vente fait redescendre `isb`, la liste de
// l'etal. Elle arrive 32 ms apres le clic.
//
// D'OU LE MECANISME: retarder, puis annuler. C'est celui du garde-combat, deja
// eprouve en jeu — un plancher de retard sur le rejeu, et une annulation quand
// la reponse tombe. Les 250 ms du plancher laissent 218 ms de marge sur les
// 32 ms mesures. Aucune mule n'ouvre l'hotel de vente, pas meme une fois, et
// aucun autre usage d'`iva` n'est touche.
//
// CE MODULE N'EMET RIEN. Il annule, et il le dit. Comme le garde-combat, ce
// n'est pas une fonction verrouillable: personne ne verrouille une
// restriction.

// Le clic sur un element interactif, tous elements confondus.
const TYPE_CLIC = 'iva';

// La liste de l'etal. C'est elle, et elle seule, qui dit « c'etait l'hotel de
// vente ». `ivf` ne suffit pas: l'element repond pour un zaap aussi.
const TYPE_INTERFACE = 'isb';

// Le plancher de retard applique au rejeu d'un `iva`. Meme valeur que le
// garde-combat, pour la meme raison: il doit couvrir le temps de la reponse
// (32 ms mesures) avec une marge qui absorbe un hoquet.
const PLANCHER_HDV_MS = 250;

// Au-dela, un `isb` n'a plus de rapport avec le clic: il vient d'un panneau
// ouvert autrement. 30 fois la mesure, comme les autres fenetres du projet.
const FENETRE_MS = 1000;

function estClicInteractif(type) {
  return type === TYPE_CLIC;
}

// superviseur — porte annulerRejeux().
// onCompteRendu — recoit { pidMaitre, annules } quand des rejeux sont annules.
// maintenant — injectee pour que la fenetre se teste sans dormir.
function creerGardeHdv({
  superviseur, onCompteRendu = () => {}, maintenant = () => Date.now(),
}) {
  // Le dernier clic du MAITRE sur un element interactif. Un seul suffit: on ne
  // clique pas sur deux elements dans la meme seconde, et si cela arrivait, le
  // second clic remplacerait le premier — ce qui est la bonne lecture.
  let clic = null;

  return function onTrame({ pid, dir, frame, estMaitre }) {
    if (frame === null || frame === undefined || !estMaitre) return;

    if (dir === 'out' && frame.kind === 'request' && frame.type === TYPE_CLIC) {
      clic = { pid, instant: maintenant() };
      return;
    }

    if (dir !== 'in' || frame.type !== TYPE_INTERFACE) return;
    if (clic === null || maintenant() - clic.instant > FENETRE_MS) return;
    // Consomme: un second `isb` du meme panneau — le serveur en envoie
    // plusieurs quand l'etal est gros — ne doit pas annuler une autre action.
    clic = null;

    const annules = superviseur.annulerRejeux();
    if (annules > 0) onCompteRendu({ pidMaitre: pid, annules });
  };
}

module.exports = {
  creerGardeHdv, estClicInteractif,
  TYPE_CLIC, TYPE_INTERFACE, PLANCHER_HDV_MS, FENETRE_MS,
};
