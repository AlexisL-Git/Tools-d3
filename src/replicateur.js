'use strict';
const { lookup } = require('./protocol/replicate');

// La decision de rejeu, et elle seule.
//
// Le superviseur ne rejoue jamais de lui-meme: il decode et emet chaque trame
// vers son rappel `onTrame`. Choisir laquelle merite d'etre dupliquee est une
// politique, pas de la mecanique — et cette politique doit etre LA MEME pour
// le CLI et pour l'application. La recopier d'un cote a l'autre a deja coute
// une application entierement debranchee: desktop/main.js construisait un
// superviseur sans `onTrame`, donc rien n'appelait jamais rejouer().
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur.

// superviseur — l'objet qui porte rejouer() et le drapeau arme.
// onCompteRendu — recoit ce qui a ete rejoue, ou refuse et pourquoi. C'est par
//   la que passent les raisons rendues dans rendu[].raison, qu'un appelant
//   affiche en console (le CLI) ou sur la ligne du compte (l'application).
function creerReplicateur({ superviseur, onCompteRendu = () => {} }) {
  return function onTrame({ pid, dir, frame, brute, estMaitre }) {
    // Seules les requetes SORTANTES du maitre se rejouent: ce que le serveur
    // renvoie est propre a chaque client et n'a rien a faire ailleurs.
    if (dir !== 'out' || frame.kind !== 'request') return;
    const connu = lookup(frame.type);
    if (connu === null) return;
    if (!estMaitre) return;

    const rendu = superviseur.rejouer({ type: frame.type, brute, pidMaitre: pid });
    // Le maitre seul en jeu: aucun esclave, rien a signaler.
    if (rendu.length === 0) return;

    onCompteRendu({
      pidMaitre: pid,
      type: frame.type,
      nom: connu.name,
      arme: superviseur.arme,
      rendu,
    });
  };
}

module.exports = { creerReplicateur };
