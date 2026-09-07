'use strict';

// Une minuterie qui rappelle a intervalle aleatoire, et rien d'autre. Elle ne
// sait pas ce qu'elle declenche, ne connait ni Electron ni les droits: c'est
// desktop/main.js qui l'allume, l'eteint, et decide de ce que `jouer` fait.
//
// `planifier`, `arreter` et `tirage` sont injectes pour que les tests soient
// deterministes et instantanes, comme `chercher` l'est dans
// src/droits/veille.js.
function creerAmbiance({
  jouer,
  minMs,
  maxMs,
  planifier = setTimeout,
  arreter = clearTimeout,
  tirage = Math.random,
}) {
  let jeton = null;

  function delai() {
    return minMs + Math.floor(tirage() * (maxMs - minMs + 1));
  }

  function armer() {
    jeton = planifier(() => {
      // Le rappel a echu: le jeton ne designe plus rien. On l'oublie AVANT
      // d'appeler `jouer`, sinon un stopper() declenche depuis `jouer`
      // annulerait un minuteur deja consomme et laisserait `jeton` pose --
      // demarrer() croirait alors la minuterie en marche alors qu'elle est
      // morte.
      jeton = null;
      // Une fenetre fermee entre deux echeances fait lever l'envoi IPC. Ce
      // n'est pas une raison d'arreter: la minuterie survit a sa fenetre.
      try { jouer(); } catch (e) { /* rien a dire, rien a reparer */ }
      armer();
    }, delai());
  }

  return {
    demarrer() {
      if (jeton !== null) return;   // deja en marche: ne pas doubler
      armer();
    },
    stopper() {
      if (jeton === null) return;
      arreter(jeton);
      jeton = null;
    },
    enMarche() { return jeton !== null; },
  };
}

module.exports = { creerAmbiance };
