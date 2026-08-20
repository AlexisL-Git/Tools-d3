'use strict';

// Le superviseur n'accepte qu'un seul rappel onTrame. Plutot que de lui
// ajouter un second point d'entree — il est valide en jeu, on n'y touche pas —
// les appelants composent leurs politiques ici.
//
// Une politique qui echoue ne doit pas priver les autres de la trame: le
// Replicate et le passe-tour sont independants, et une exception dans l'un ne
// regarde pas l'autre.
//
// Mais isoler n'est pas etouffer. Une premiere version avalait l'exception
// sans rien dire, et une politique morte ressemblait alors trait pour trait a
// une politique qui n'a rien a faire: ni l'une ni l'autre ne produit de ligne
// de journal. C'est le mode d'echec le plus couteux de ce projet — il s'est
// presente quatre fois, toujours sous la forme d'un silence. L'exception est
// donc toujours signalee, a onErreur si l'appelant en fournit un, sur la
// sortie d'erreur sinon. Aucun chemin ne mene au silence.
//
// onErreur est le dernier argument, sous la forme { onErreur }. Les fonctions
// etant de type 'function', il n'y a pas d'ambiguite possible.
function composer(...fonctions) {
  let onErreur = null;
  const dernier = fonctions[fonctions.length - 1];
  if (typeof dernier === 'object' && dernier !== null) onErreur = fonctions.pop().onErreur || null;

  return function onTrame(evenement) {
    for (const f of fonctions) {
      try { f(evenement); }
      catch (e) {
        if (onErreur !== null) onErreur({ evenement, erreur: e });
        else console.error('politique en echec :', e);
      }
    }
  };
}

module.exports = { composer };
