'use strict';

// Le superviseur n'accepte qu'un seul rappel onTrame. Plutot que de lui
// ajouter un second point d'entree — il est valide en jeu, on n'y touche pas —
// les appelants composent leurs politiques ici.
//
// Une politique qui echoue ne doit pas priver les autres de la trame: le
// Replicate et le passe-tour sont independants, et une exception dans l'un ne
// regarde pas l'autre.
function composer(...fonctions) {
  return function onTrame(evenement) {
    for (const f of fonctions) {
      try { f(evenement); } catch (e) { /* une politique defaillante n'en bloque pas d'autres */ }
    }
  };
}

module.exports = { composer };
