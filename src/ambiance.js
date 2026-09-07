'use strict';

// Une minuterie qui rappelle par rafales, a intervalle aleatoire, et rien
// d'autre. Elle ne sait pas ce qu'elle declenche, ne connait ni Electron ni
// les droits: c'est desktop/main.js qui l'allume, l'eteint, et decide de ce
// que `jouer` fait.
//
// Un cycle: on attend un delai tire entre minMs et maxMs, puis `jouer` est
// appele `rafale` fois, espacees de `ecartMs`. Le cycle suivant est arme
// APRES le dernier coup de la rafale, ce qui garantit qu'il n'y a jamais plus
// d'un minuteur en vol -- `stopper()` n'a donc qu'un seul jeton a annuler, et
// il ne peut pas rester un coup de rafale orphelin derriere lui.
//
// `planifier`, `arreter` et `tirage` sont injectes pour que les tests soient
// deterministes et instantanes, comme `chercher` l'est dans
// src/droits/veille.js.
function creerAmbiance({
  jouer,
  minMs,
  maxMs,
  rafale = 1,
  ecartMs = 0,
  planifier = setTimeout,
  arreter = clearTimeout,
  tirage = Math.random,
}) {
  let jeton = null;
  // Coups qu'il reste a jouer dans la rafale en cours. Zero entre deux cycles.
  let restants = 0;

  function delai() {
    return minMs + Math.floor(tirage() * (maxMs - minMs + 1));
  }

  function armer(dansMs) {
    jeton = planifier(() => {
      // Le rappel a echu: le jeton ne designe plus rien. On l'oublie AVANT
      // d'appeler `jouer`, sinon un stopper() declenche depuis `jouer`
      // annulerait un minuteur deja consomme et laisserait `jeton` pose --
      // demarrer() croirait alors la minuterie en marche alors qu'elle est
      // morte.
      jeton = null;
      // Un nouveau cycle commence: la rafale est pleine.
      if (restants === 0) restants = rafale;
      // Une fenetre fermee entre deux echeances fait lever l'envoi IPC. Ce
      // n'est pas une raison d'arreter: la minuterie survit a sa fenetre.
      try { jouer(); } catch (e) { /* rien a dire, rien a reparer */ }
      restants -= 1;
      armer(restants > 0 ? ecartMs : delai());
    }, dansMs);
  }

  return {
    demarrer() {
      if (jeton !== null) return;   // deja en marche: ne pas doubler
      armer(delai());
    },
    stopper() {
      if (jeton === null) return;
      arreter(jeton);
      jeton = null;
      // Une rafale coupee en son milieu ne reprend pas au coup suivant quand
      // le droit revient: elle recommence entiere.
      restants = 0;
    },
    enMarche() { return jeton !== null; },
  };
}

// LES BORNES EFFECTIVES, et pourquoi elles ne sont pas de simples constantes.
//
// Essayer la fonction demandait de remplacer les deux constantes par 3000 puis
// de PENSER A LES REMETTRE. Un 3000 oublie part chez l ami et le son se
// declenche toutes les trois secondes: la blague devient un rapport de bug.
// OMNI_AMBIANCE_MS fixe donc les deux bornes le temps d un essai, sans
// toucher au code.
//
// Uniquement en mode developpement: un reglage venu de l environnement n a
// rien a faire sur le poste d un ami, qui pourrait l y poser lui-meme.
function bornes(env, minMs, maxMs) {
  const brut = Number(env.OMNI_AMBIANCE_MS);
  if (env.OMNI_DEV && Number.isFinite(brut) && brut > 0) return [brut, brut];
  return [minMs, maxMs];
}

module.exports = { creerAmbiance, bornes };
