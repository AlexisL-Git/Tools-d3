'use strict';

// L'ordre de l'equipe. Rien d'autre.
//
// POURQUOI L'ORDRE EST STRUCTURANT. C'est l'ordre qu'affiche le panneau, et
// c'est la liste que « fermer les clients » parcourt. Il n'a aucune raison de
// coincider avec celui de Zaap.
//
// Fonctions pures: ni Electron, ni Frida, ni disque.

// lignes — la vue construite par src/comptes/vue.js.
// ordre  — les identifiants de compte, dans l'ordre voulu par l'utilisateur.
//
// Rend une NOUVELLE liste. Les comptes absents de l'ordre vont a la fin, dans
// leur ordre d'arrivee: un compte ajoute dans Zaap apres coup apparait, sans
// bousculer ceux qui etaient deja places.
function ordonner(lignes, ordre) {
  const rang = new Map();
  (ordre || []).forEach((id, i) => { if (!rang.has(id)) rang.set(id, i); });

  const places = [];
  const reste = [];
  for (const l of lignes) {
    if (l.id !== null && l.id !== undefined && rang.has(l.id)) places.push(l);
    else reste.push(l);
  }
  places.sort((a, b) => rang.get(a.id) - rang.get(b.id));
  return places.concat(reste);
}

module.exports = { ordonner };
