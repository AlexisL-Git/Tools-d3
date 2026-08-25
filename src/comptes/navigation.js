'use strict';

// L'ordre de l'equipe, et le deplacement dans cet ordre. Rien d'autre.
//
// POURQUOI L'ORDRE EST STRUCTURANT. Tant qu'on ne faisait qu'afficher une
// liste, l'ordre de Zaap valait n'importe quel autre. Des lors qu'une touche
// dit « personnage suivant », l'ordre devient de la memoire musculaire: il
// faut pouvoir le figer, et il n'a aucune raison de coincider avec celui du
// launcher.
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

// pids    — les clients navigables, dans l'ordre d'affichage.
// courant — le pid au premier plan, ou null si on ne le sait pas.
//
// Un point de depart inconnu n'est pas un cas d'erreur: le premier plan peut
// etre le navigateur, Zaap, ou un client qu'OMNI n'a pas pris en charge. On
// entre alors par le bout de la liste correspondant au sens demande.
function deplacer(pids, courant, pas) {
  const liste = pids || [];
  if (liste.length === 0) return null;
  const i = liste.indexOf(courant);
  if (i === -1) return pas > 0 ? liste[0] : liste[liste.length - 1];
  // Le modulo positif: -1 % n vaut -1 en JavaScript, pas n-1.
  return liste[((i + pas) % liste.length + liste.length) % liste.length];
}

const suivant = (pids, courant) => deplacer(pids, courant, 1);
const precedent = (pids, courant) => deplacer(pids, courant, -1);

module.exports = { ordonner, suivant, precedent };
