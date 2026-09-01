'use strict';

// LA PORTE: une politique n est appelee que si son droit est accorde.
//
// Elle ne retient pas les droits, elle les DEMANDE a chaque trame. La veille
// remplace la liste toutes les 60 s, et une porte qui aurait pris une copie au
// demarrage laisserait tourner une fonction retiree jusqu a la fermeture.
//
// Elle n attrape aucune exception: composer() le fait deja, et le fait en
// SIGNALANT. Avaler ici rendrait une politique morte indiscernable d une
// politique sans travail -- le mode d echec le plus couteux de ce projet.
function creerPorte({ droits }) {
  return function protege(nom, politique) {
    return function onTrame(evenement) {
      if (!droits().includes(nom)) return;
      politique(evenement);
    };
  };
}

module.exports = { creerPorte };
