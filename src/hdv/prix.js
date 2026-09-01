'use strict';

// A quel prix reposer un lot deja en vente, et lui seul.
//
// Fonction pure: ni Electron, ni Frida, ni reseau, ni disque. C'est la SEULE
// decision de cette fonctionnalite qui peut couter des kamas, d'ou son
// isolement — tout le reste est du sequencage de trames.
//
// LES QUATRE PRIX. `kgp.2` porte des varints empaquetes, exactement quatre,
// dans l'ordre des tailles de lot 1 / 10 / 100 / 1000. Mesure du 01/09, prouvee
// geste par geste sur la Pierre medicinale: chaque case bouge quand et
// seulement quand on touche a CE lot-la, et remonte au prix du concurrent des
// qu'on retire le notre.
//
//   pose d'un lot de 100 a 1222   [19, 190, 1222, 18000]
//   retrait de ce lot             [19, 190, 2700, 18000]
//
// UN ZERO N'EST PAS UN PRIX, c'est « aucun concurrent a cette taille ». Le
// prendre pour un prix ferait poser a -1.
//
// LE PIEGE DE L'AUTO-SOUS-COTATION. Le tableau ci-dessus le montre en clair:
// apres la pose, le minimum du creneau des 100 ETAIT notre propre lot. kgp rend
// un minimum sans jamais dire a qui il appartient. Un bot qui sous-cote le
// minimum sans regarder descendrait a 1221 a la passe suivante, puis 1220,
// jusqu'a zero — et le defaut ne se verrait qu'apres plusieurs passes, une fois
// la marchandise bradee.
//
// Le cas 1 l'empeche. Il coute parfois un kama: si un concurrent est exactement
// a notre prix, on ne sait pas les distinguer et on renonce a le doubler.
// C'est delibere — RENONCER EST REVERSIBLE, BRADER NE L'EST PAS.
const TAILLES = [1, 10, 100, 1000];

// marche        — les quatre minimums, dans l'ordre de TAILLES. 0 = personne.
// nos           — nos lots du MEME GID: [{ taille, prix }].
// taille        — la taille du lot qu'on veut reposer.
// moyenUnitaire — le prix moyen a l'unite, tire d'ivi. 0 si inconnu.
//
// Rend le prix a poser, ou null pour « ne rien emettre ». Jamais 0.
function decider({ marche, nos, taille, moyenUnitaire }) {
  if (!Array.isArray(marche) || marche.length !== TAILLES.length) return null;
  const i = TAILLES.indexOf(taille);
  if (i === -1) return null;

  const minimum = Number(marche[i]) || 0;

  if (minimum > 0) {
    // Le minimum est-il DEJA le notre, a cette taille? Alors on est le moins
    // cher et il n'y a rien a gagner. La comparaison porte sur la taille autant
    // que sur le GID: le minimum est par creneau, et un lot de 10 ne dit rien
    // du creneau des 100.
    const nous = (nos || []).some((l) => l.taille === taille && Number(l.prix) === minimum);
    if (nous) return null;
    // Un minimum a 1 kama ne se sous-cote pas: 0 est aussi la valeur qui
    // signifie « creneau vide » dans kgp, donc un lot pose a 0 disparaitrait du
    // tableau qu'on relit juste apres.
    if (minimum <= 1) return null;
    return minimum - 1;
  }

  // CRENEAU VIDE. On deduit du creneau non vide le plus proche, ramene a
  // l'unite. La proximite se compte EN CRANS de TAILLES, pas en ecart de
  // quantite: les voisins immediats se ressemblent (19, 19, 27 et 18 kamas
  // l'unite sur la Pierre medicinale) bien plus que les extremes.
  //
  // A DISTANCE EGALE, LE PLUS PETIT: un creneau de petite taille se vend plus
  // souvent, donc son prix unitaire est mieux etabli.
  let voisin = -1;
  for (let d = 1; d < TAILLES.length && voisin === -1; d += 1) {
    if (i - d >= 0 && Number(marche[i - d]) > 0) voisin = i - d;
    else if (i + d < TAILLES.length && Number(marche[i + d]) > 0) voisin = i + d;
  }
  if (voisin === -1) return null;

  const unitaire = Number(marche[voisin]) / TAILLES[voisin];
  const deduit = Math.max(1, Math.floor(unitaire * taille));

  // LE GARDE-FOU, DANS LES DEUX SENS. Une extrapolation reste une supposition:
  // au-dessus du double du prix moyen le lot ne partira pas, en dessous de la
  // moitie on brule la marchandise. Le second sens est le dangereux, mais
  // refuser les deux evite aussi d'occuper un emplacement pour rien.
  //
  // Le prix moyen vient d'ivi, livre au login pour 9861 objets. Sans lui, le
  // garde-fou ne peut pas s'appliquer: on refuse plutot que de deduire sans
  // filet. Cette exigence ne vaut QUE pour l'extrapolation — un marche servi se
  // sous-cote sans connaitre le prix moyen.
  const moyen = (Number(moyenUnitaire) || 0) * taille;
  if (moyen <= 0) return null;
  if (deduit < moyen / 2 || deduit > moyen * 2) return null;

  return deduit;
}

module.exports = { decider, TAILLES };
