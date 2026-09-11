'use strict';
const TABLE = require('./taux.json');

// Le taux de recyclage en pepites, a l'unite, de chaque objet du jeu.
//
// Fabrication: outils/faire-pepites.js, qui ne tourne jamais ici.
// Fonction pure: ni Electron, ni Frida, ni reseau, ni disque.
// Conception: docs/superpowers/specs/2026-09-11-opti-pepite-design.md.
//
// LA TABLE NE PORTE QUE LES OBJETS RECYCLABLES -- 4 049 sur 21 776. C'est la
// difference avec objets.json, qui garde tout: la un gid absent voudrait dire
// « nom inconnu », ici il veut dire « pas recyclable », et c'est une reponse,
// pas un trou.
//
// ELLE PORTE AUSSI LA VERSION DU JEU contre laquelle elle a ete verifiee.
// Mesure du 11/09: entre le client live et la beta installee sur la machine de
// developpement, 22 taux divergent. Une table figee peut donc se demoder, et
// une table qui ne dit pas son age ne le laisse pas voir.
const TAUX = TABLE.objets;
const JEU = TABLE.jeu;

// NULL, ET JAMAIS 0. Le zero est le piege de ce fichier: le classement divise
// le prix par le taux, et une division par zero rend l'infini -- qui ne casse
// rien, ne leve rien, et va se ranger a une extremite du tri. Le pire objet du
// jeu presente comme le meilleur, sans une ligne de journal.
//
// hasOwnProperty PAR APPEL, comme objets.js: la table vient d'un JSON.parse,
// donc elle herite d'Object.prototype, et un gid nomme `toString` en sortirait
// une fonction.
function tauxDe(gid) {
  if (gid === null || gid === undefined) return null;
  const cle = String(gid);
  if (!Object.prototype.hasOwnProperty.call(TAUX, cle)) return null;
  const t = TAUX[cle];
  return typeof t === 'number' && t > 0 ? t : null;
}

module.exports = { tauxDe, TAUX, JEU };
