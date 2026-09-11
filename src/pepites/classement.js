'use strict';
const { tauxDe } = require('./taux');

// Du croisement « quel objet donne la pepite la moins chere » au tableau
// affichable. Fonction pure: ni trame, ni reseau, ni disque, ni Electron.
//
// Conception: docs/superpowers/specs/2026-09-11-opti-pepite-design.md.
//
// LE TRI EST ICI ET PAS DANS LE PANNEAU, pour la meme raison que stock.js et
// tableau.js existent: c'est la seule decision du lot qui peut couter des
// kamas. Un comparateur ecrit a l'envers ferait acheter le pire objet en le
// presentant comme le meilleur, et il n'y aurait rien a voir -- ni exception,
// ni ligne de journal, juste un tableau plausible et faux.

// 50 lignes, le chiffre de la spec.
const LIMITE = 50;

// LE SEUIL DE DOUTE, ET IL EST ARBITRAIRE -- la spec le dit franchement.
//
// `ivi` est une moyenne glissante du serveur: sur un objet que plus personne
// ne vend, elle reste figee sur une vieille transaction, et un objet a 1 kama
// de moyenne sortirait premier tout en etant introuvable.
//
// CE QUI REND L'ARBITRAIRE ACCEPTABLE, C'EST QU'IL N'ECARTE RIEN. La ligne
// reste a sa place, marquee. Un garde-fou par comparaison a ete cherche: le
// champ `price` de DofusDB vaut 0 pour le Bois de Frene et 1 pour la Pierre
// Medicinale, qui se negocie a 19 kamas l'unite. Il ne mesure rien.
const PRIX_SUSPECT = 10;

// `prixMoyens` est la Map rendue par lirePrixMoyens() de src/hdv/trames.js,
// passee telle quelle: le classeur ne connait pas les trames, et c'est ce qui
// le rend testable sans double.
function classer({ prixMoyens, limite = LIMITE }) {
  const lignes = [];
  if (prixMoyens === null || prixMoyens === undefined) return lignes;
  for (const [gid, prixMoyen] of prixMoyens) {
    const taux = tauxDe(gid);
    // tauxDe rend null pour « pas recyclable », qui est la majorite du
    // catalogue: 4 049 objets sur 21 776. Ce n'est pas une anomalie, on ne la
    // journalise pas.
    if (taux === null) continue;
    if (typeof prixMoyen !== 'number' || !(prixMoyen > 0)) continue;
    lignes.push({
      gid,
      taux,
      prixMoyen,
      coutParPepite: prixMoyen / taux,
      suspect: prixMoyen <= PRIX_SUSPECT,
    });
  }
  // LES TROIS CRANS DU TRI, ET AUCUN N'EST DECORATIF.
  //
  // 1. le cout par pepite, croissant: c'est la question posee.
  // 2. a cout egal, le taux le plus eleve: meme depense, moins d'unites a
  //    trimballer jusqu'au prisme.
  // 3. a taux egal, le gid: le tri doit etre TOTAL. Sans ce dernier cran,
  //    deux passes sur les memes chiffres peuvent rendre deux ordres
  //    differents, et la colonne de variation inventerait des mouvements que
  //    le marche n'a pas faits.
  lignes.sort((a, b) => (a.coutParPepite - b.coutParPepite)
    || (b.taux - a.taux)
    || (a.gid - b.gid));
  return lignes.slice(0, limite);
}

module.exports = { classer, LIMITE, PRIX_SUSPECT };
