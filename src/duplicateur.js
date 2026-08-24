'use strict';
const { lookup } = require('./protocol/omni');

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

// Ecart entre deux esclaves, en millisecondes, tire au hasard dans ces bornes
// et cumule le long du plan de rejeu. Sept comptes qui se teleportent sur la
// meme milliseconde ne ressemblent a rien de ce que sept joueurs produisent;
// espacer suffit a supprimer la simultaneite parfaite.
//
// Vit ici plutot que dans le superviseur parce que c'est une POLITIQUE, au
// meme titre que le choix des messages a rejouer: le superviseur se contente
// de l'appliquer, et n'etale rien si on ne lui demande pas. Les deux appelants
// reels — l'application et le CLI — importent cette constante, pour la meme
// raison qu'ils partagent creerDuplicateur: une regle recopiee finit par
// diverger.
//
// LE PLANCHER N'EST PAS ARBITRAIRE. Le pas des minuteurs Windows est de
// ~15,6 ms: deux echeances separees de moins que cela retombent dans le meme
// tick et s'ecrivent dans le MEME tour de boucle, donc sur le reseau a
// quelques microsecondes l'une de l'autre. Mesure sur 3 essais avec des bornes
// 1-40: un ecart annonce de 6 ms donnait 149,2 et 149,3 ms — exactement la
// simultaneite que l'etalement doit supprimer. Sous MIN_TICK_WINDOWS, un ecart
// n'est qu'un chiffre dans le journal.
const MIN_TICK_WINDOWS = 16;
const ETALEMENT_REJEU = { minMs: MIN_TICK_WINDOWS, maxMs: 80 };

// superviseur — l'objet qui porte rejouer() et le drapeau arme.
// onCompteRendu — recoit ce qui a ete rejoue, ou refuse et pourquoi. C'est par
//   la que passent les raisons rendues dans rendu[].raison, qu'un appelant
//   affiche en console (le CLI) ou sur la ligne du compte (l'application).
function creerDuplicateur({ superviseur, onCompteRendu = () => {} }) {
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

module.exports = { creerDuplicateur, ETALEMENT_REJEU, MIN_TICK_WINDOWS };
