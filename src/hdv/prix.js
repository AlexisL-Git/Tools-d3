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
//
// MAIS RENONCER A SOUS-COTER N'EST PAS RENONCER A TOUT. Quand le minimum est le
// notre, les AUTRES lots du meme creneau, eux, sont souvent restes plus haut:
// ils ne se vendront qu'une fois le premier parti. On les aligne sur ce
// minimum. C'est le seul cas ou la fonction rend un prix egal au marche.
const TAILLES = [1, 10, 100, 1000];

// LE PRIX DU MARCHE N'EST PAS UNE AUTORITE, et c'est la lecon du 05/09.
//
// Six lots de 10 poils de barbe de Bwork mage sont partis a 7 000 002 kamas,
// pour un prix moyen de 152 kamas l'unite — 1520 le lot, un facteur 4600. Le
// concurrent d'en face avait pose un prix delirant, et sous-coter d'un kama un
// prix delirant donne un prix delirant. Le garde-fou existait deja, mais il ne
// gardait QUE l'extrapolation: des que le creneau etait servi, plus rien ne
// regardait le prix moyen.
//
// DESORMAIS TOUT PRIX EMIS EST BORNE, quelle que soit la branche qui l'a
// decide: le sous-cotage, l'alignement, l'extrapolation, le repli au prix
// moyen. Le facteur est large a dessein — un marche peut legitimement valoir
// plusieurs fois le prix moyen d'ivi, qui est une moyenne glissante et non une
// cote. Ce qu'on refuse, c'est l'ordre de grandeur absurde.
const FACTEUR = 5;

// L'EXTRAPOLATION GARDE SA BORNE PLUS SERREE. Deduire le prix d'un creneau
// depuis un creneau voisin est une supposition sans ancre: elle merite d'etre
// tenue de plus pres que le prix d'un marche qu'on a vraiment lu. Le facteur 2
// tient depuis le 01/09, il n'y a aucune raison de le desserrer a 5.
const FACTEUR_DEDUCTION = 2;

const ECART_MARCHE = { haut: 'trop-haut', bas: 'trop-bas' };
const ECART_DEDUCTION = { haut: 'deduction-trop-haute', bas: 'deduction-trop-basse' };

// LES MOTIFS QUI VIENNENT DU GARDE-FOU, par opposition a « il n'y avait rien a
// faire sur ce lot ». Les deux passes s'en servent pour trier ce qu'elles
// montrent: la mise en vente affiche tout ce qui n'est pas parti, la mise a
// jour des prix n'affiche que les ecarts — laisser un lot deja au meilleur prix
// est le cas NORMAL, et le lister noierait les trois lignes qui comptent sous
// deux cents lignes de bruit.
const MOTIFS_GARDE_FOU = new Set([
  ECART_MARCHE.haut, ECART_MARCHE.bas,
  ECART_DEDUCTION.haut, ECART_DEDUCTION.bas,
  'moyen-inconnu',
]);

// LA FORME DU RETOUR. Les deux fonctions rendaient un prix ou un `null` nu; ce
// `null` ne disait pas POURQUOI, et le panneau ne pouvait donc rien montrer de
// mieux qu'un compteur de lots sautes. Elles rendent maintenant, toujours:
//
//   prix  — le prix a emettre, ou null quand il n'y a rien a emettre
//   motif — non nul exactement quand prix est null
//   vise  — le prix qu'on AURAIT emis, quand c'est le garde-fou qui a coupe
//   borne — la borne franchie, pour que le tableau dise « 7000001 > 7600 »
function pose(prix) {
  return { prix, motif: null, vise: null, borne: null };
}

function ecart(motif, vise = null, borne = null) {
  return { prix: null, motif, vise, borne };
}

// LE CRENEAU NON VIDE LE PLUS PROCHE, en CRANS de TAILLES et non en ecart de
// quantite: les voisins immediats se ressemblent (19, 19, 27 et 18 kamas
// l'unite sur la Pierre medicinale) bien plus que les extremes. A distance
// egale on prend le plus petit, parce qu'un creneau de petite taille se vend
// plus souvent et que son prix unitaire est donc mieux etabli.
//
// Rend -1 quand aucun creneau n'est servi. Les deux regles s'en servent, mais
// elles en tirent des conclusions differentes: decider() renonce, deciderPose
// retombe sur le prix moyen.
function voisinServi(marche, i) {
  for (let d = 1; d < TAILLES.length; d += 1) {
    if (i - d >= 0 && Number(marche[i - d]) > 0) return i - d;
    if (i + d < TAILLES.length && Number(marche[i + d]) > 0) return i + d;
  }
  return -1;
}

// LE GARDE-FOU, DANS LES DEUX SENS. Au-dessus du plafond le lot ne part pas —
// et pire, il reste affiche a un prix absurde que la passe suivante ne saura
// pas corriger, puisque le minimum du creneau sera devenu le notre. En dessous
// du plancher, on brule la marchandise.
//
// SANS PRIX MOYEN IL N'Y A PAS DE FILET, donc on ecarte. C'est le choix du
// 05/09, et il inverse celui du 01/09 qui laissait passer un marche servi sans
// prix moyen: une borne qui ne s'applique pas a tout ne garantit rien. ivi
// porte 9861 prix, les objets concernes sont donc rares — et ils apparaissent
// maintenant dans le tableau des ecartes au lieu de partir en silence.
//
// LES BORNES SONT INCLUSIVES: exactement cinq fois le prix moyen passe. C'est
// la convention d'origine, et un refus a l'egalite se lirait mal dans un
// tableau qui affiche la borne juste a cote du prix vise.
function borner({ prix, taille, moyenUnitaire, facteur = FACTEUR, motifs = ECART_MARCHE }) {
  const moyen = (Number(moyenUnitaire) || 0) * taille;
  if (moyen <= 0) return ecart('moyen-inconnu', prix);
  if (prix > moyen * facteur) return ecart(motifs.haut, prix, Math.floor(moyen * facteur));
  if (prix < moyen / facteur) return ecart(motifs.bas, prix, Math.ceil(moyen / facteur));
  return pose(prix);
}

// Une deduction est bornee plus serre que le reste, et par construction: ce qui
// tient dans le facteur 2 tient dans le facteur 5, il n'y a donc rien a
// repasser au garde-fou general derriere.
function extrapoler({ marche, voisin, taille, moyenUnitaire }) {
  const unitaire = Number(marche[voisin]) / TAILLES[voisin];
  const deduit = Math.max(1, Math.floor(unitaire * taille));
  return borner({
    prix: deduit, taille, moyenUnitaire, facteur: FACTEUR_DEDUCTION, motifs: ECART_DEDUCTION,
  });
}

// marche        — les quatre minimums, dans l'ordre de TAILLES. 0 = personne.
// nos           — nos lots du MEME GID: [{ taille, prix }].
// taille        — la taille du lot qu'on veut reposer.
// prixActuel    — le prix ou CE lot-ci est en ce moment. C'est lui qui distingue
//                 « le minimum est le notre » de « le minimum est CELUI-CI »:
//                 sans lui, un stock de lots jumeaux garde ses retardataires.
// moyenUnitaire — le prix moyen a l'unite, tire d'ivi. 0 si inconnu.
//
// Rend { prix, motif, vise, borne }. `prix` est null pour « ne rien emettre »,
// jamais 0, et `motif` dit alors pourquoi.
function decider({ marche, nos, taille, moyenUnitaire, prixActuel }) {
  if (!Array.isArray(marche) || marche.length !== TAILLES.length) return ecart('marche-illisible');
  const i = TAILLES.indexOf(taille);
  if (i === -1) return ecart('taille-hors-creneaux');

  const minimum = Number(marche[i]) || 0;

  if (minimum > 0) {
    // UN MINIMUM A 1 KAMA NE SE TOUCHE PAS, et ce garde-fou passe EN PREMIER,
    // meme ordre que chez deciderPose(). On ne le sous-cote pas — 0 est aussi
    // la valeur qui signifie « creneau vide » dans kgp, donc un lot pose a 0
    // disparaitrait du tableau qu'on relit juste apres — et on ne s'aligne pas
    // dessus non plus: aligner huit lots sur un kama, c'est les brader.
    if (minimum <= 1) return ecart('marche-a-1-kama');

    // Le minimum est-il DEJA le notre, a cette taille? La comparaison porte sur
    // la taille autant que sur le GID: le minimum est par creneau, et un lot de
    // 10 ne dit rien du creneau des 100.
    const nous = (nos || []).some((l) => l.taille === taille && Number(l.prix) === minimum);
    if (nous) {
      // UN LOT A NOUS, PAS FORCEMENT CELUI-CI. C'est toute la difference, et
      // elle a coute huit lots en jeu le 03/09: rendre null ici abandonnait
      // tous les jumeaux restes plus chers des qu'UN SEUL avait touche le
      // minimum. Ils n'etaient pas oublies par la passe — ils etaient decides,
      // et decides a « ne rien faire », passe apres passe.
      //
      // ON S'ALIGNE, ON NE SOUS-COTE PAS. Descendre d'un kama sous notre propre
      // lot serait exactement l'auto-sous-cotation que ce module interdit.
      // L'alignement, lui, est borne: une fois au minimum, le lot rend null au
      // passage suivant et ne bouge plus.
      const actuel = Number(prixActuel) || 0;
      // Sans prix connu — ou deja au minimum — il n'y a rien a emettre.
      if (actuel <= minimum) return ecart('deja-au-minimum');
      // L'ALIGNEMENT PASSE PAR LE GARDE-FOU LUI AUSSI. Un de nos lots pose trop
      // haut avant que la borne existe rendrait sinon tous ses jumeaux
      // eligibles a le rejoindre: le defaut se propagerait a la pile entiere.
      return borner({ prix: minimum, taille, moyenUnitaire });
    }
    return borner({ prix: minimum - 1, taille, moyenUnitaire });
  }

  // CRENEAU VIDE. Rien a sous-coter: on deduit du voisin, ou on renonce. Le
  // detail des deux regles est remonte dans voisinServi() et extrapoler(),
  // partages avec deciderPose().
  const voisin = voisinServi(marche, i);
  if (voisin === -1) return ecart('aucun-voisin');
  return extrapoler({ marche, voisin, taille, moyenUnitaire });
}

// POSER UN LOT NEUF, la regle de « mettre en vente ».
//
// Memes entrees que decider(), et elle partage son extrapolation. Deux
// differences, et chacune vient d'un raisonnement mesure:
//
// 1. QUAND LE MINIMUM EST DEJA LE NOTRE, ON S'ALIGNE au lieu de renoncer. Des
//    qu'on a pose le premier lot d'un paquet, le minimum du creneau est le
//    notre: renoncer ferait sauter tous les lots suivants, et la fonction
//    poserait un seul lot par objet et par taille, sans rien dire. S'aligner
//    n'erode rien — sous-coter d'un kama a chaque lot serait exactement
//    l'auto-sous-cotation que decider() interdit, bornee par la pile plutot
//    qu'infinie, ce qui n'est pas la meme chose que gratuite.
//
// 2. SANS AUCUN CRENEAU SERVI, ON POSE AU PRIX MOYEN. Il n'y a rien a
//    extrapoler, et decider() renonce parce qu'un lot deja en vente peut
//    attendre. Un lot qu'on n'a pas encore pose, lui, ne rapporte rien.
//
// L'ORDRE DES CAS COMPTE, ici comme chez decider(): le garde-fou « minimum a 1 »
// passe AVANT le test « est-ce le notre », sans quoi notre propre lot a 1 kama
// nous ferait poser a 1 kama.
function deciderPose({ marche, nos, taille, moyenUnitaire }) {
  if (!Array.isArray(marche) || marche.length !== TAILLES.length) return ecart('marche-illisible');
  const i = TAILLES.indexOf(taille);
  if (i === -1) return ecart('taille-hors-creneaux');

  const minimum = Number(marche[i]) || 0;

  if (minimum > 0) {
    // Un minimum a 1 ne se sous-cote pas: 0 est aussi la valeur qui signifie
    // « creneau vide » dans kgp, donc un lot pose a 0 disparaitrait du tableau.
    if (minimum <= 1) return ecart('marche-a-1-kama');
    const nous = (nos || []).some((l) => l.taille === taille && Number(l.prix) === minimum);
    if (nous) return borner({ prix: minimum, taille, moyenUnitaire });
    return borner({ prix: minimum - 1, taille, moyenUnitaire });
  }

  const voisin = voisinServi(marche, i);
  if (voisin !== -1) return extrapoler({ marche, voisin, taille, moyenUnitaire });

  // Le repli au prix moyen est dans les bornes par construction — c'est le
  // centre de l'intervalle — mais il ne peut pas exister sans prix moyen.
  const moyen = Math.floor((Number(moyenUnitaire) || 0) * taille);
  return moyen > 0 ? pose(moyen) : ecart('moyen-inconnu');
}

module.exports = { decider, deciderPose, TAILLES, FACTEUR, MOTIFS_GARDE_FOU };
