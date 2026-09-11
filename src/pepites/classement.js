'use strict';
const { tauxDe, TAUX } = require('./taux');
const { nomDe } = require('../hdv/objets');

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

// Le prix retenu pour un gid, et d'ou il vient. Rend null quand aucune des
// deux sources ne donne de prix utilisable -- ce qui est le cas de la majorite
// du catalogue.
//
// UN PRIX DE MARCHE A ZERO N'EST PAS UN PRIX. Le zero des quatre creneaux veut
// dire « aucune offre a cette taille », jamais « gratuit »: la regle est celle
// de src/hdv/prix.js, et la confondre ferait sortir l'objet en tete du
// classement a cout nul.
function prixEtSource(gid, prixMoyens, prixMarche) {
  const reel = prixMarche === null || prixMarche === undefined ? undefined : prixMarche.get(gid);
  if (reel !== null && reel !== undefined && typeof reel.prix === 'number' && reel.prix > 0) {
    return { prix: reel.prix, source: 'marche', quand: reel.quand === undefined ? null : reel.quand };
  }
  const moyen = prixMoyens === null || prixMoyens === undefined ? undefined : prixMoyens.get(gid);
  if (typeof moyen === 'number' && moyen > 0) return { prix: moyen, source: 'moyen', quand: null };
  return null;
}

// `prixMoyens` est la Map rendue par lirePrixMoyens() de src/hdv/trames.js.
// `prixMarche` est une Map gid -> { prix, quand }, remplie par marche.js quand
// une passe a tourne devant un etal. Elle vaut null tant qu'aucune passe n'a eu
// lieu, ce qui est l'etat au lancement.
//
// LE PRIX REEL PRIME, TOUJOURS. C'est le sens de la fonctionnalite, et la
// colonne des prix annonce la source de chaque ligne: une moyenne qui
// l'emporterait sur une mesure ferait mentir cette annonce.
function classer({ prixMoyens, prixMarche = null, limite = LIMITE }) {
  const lignes = [];
  const gids = new Set();
  if (prixMoyens !== null && prixMoyens !== undefined) for (const g of prixMoyens.keys()) gids.add(g);
  // LES GIDS DU MARCHE ENTRENT AUSSI, et pas seulement ceux d'ivi: environ
  // 39 % des objets recyclables n'ont aucun prix moyen (mesure du 11/09).
  // Pour ceux-la la passe de marche est la seule source, et les ignorer
  // reviendrait a jeter ce qu'on vient d'aller chercher devant l'etal.
  if (prixMarche !== null && prixMarche !== undefined) for (const g of prixMarche.keys()) gids.add(g);
  for (const gid of gids) {
    const taux = tauxDe(gid);
    // tauxDe rend null pour « pas recyclable », qui est la majorite du
    // catalogue: 4 049 objets sur 21 776. Ce n'est pas une anomalie, on ne la
    // journalise pas.
    if (taux === null) continue;
    const ligne = prixEtSource(gid, prixMoyens, prixMarche);
    if (ligne === null) continue;
    lignes.push({
      gid,
      taux,
      prix: ligne.prix,
      source: ligne.source,
      quand: ligne.quand,
      coutParPepite: ligne.prix / taux,
      // LE DOUTE NE PORTE QUE SUR LES MOYENNES. Un prix de marche a 3 kamas
      // n'est pas douteux, il est vrai: c'est le prix auquel on peut acheter.
      suspect: ligne.source === 'moyen' && ligne.prix <= PRIX_SUSPECT,
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

// Combien de lignes la barre de recherche rend au plus. Au-dela, la liste
// cesse d'etre une reponse et redevient un catalogue.
const LIMITE_RECHERCHE = 20;

// De deux passes au mouvement de chacune de leurs lignes.
//
// LES SORTIES SONT RENDUES A PART, ET C'EST TOUT L'INTERET DE CETTE FONCTION.
// Une ligne sortie du classement n'existe PAS dans `courant`: aucune boucle
// sur la passe courante ne peut la produire. C'est le cas qu'on oublie, et
// c'est aussi le seul qui interesse -- « qu'est-ce qui n'est plus rentable »
// est la question qu'on se pose en revenant apres deux jours.
//
// LA COMPARAISON PORTE SUR LA PASSE PRECEDENTE, pas sur une moyenne: on veut
// voir ce qui vient de bouger, pas une tendance lissee qui noierait le
// mouvement du jour.
function comparer(precedent, courant) {
  const avant = new Map();
  (precedent || []).forEach((l, rang) => {
    avant.set(l.gid, { rang, cout: l.coutParPepite });
  });
  const vus = new Set();
  const lignes = (courant || []).map((l, rang) => {
    vus.add(l.gid);
    const a = avant.get(l.gid);
    // NULL ET PAS 0 pour une entree: un ecart de zero voudrait dire « rien
    // n'a bouge », et c'est faux -- il n'y avait rien a quoi se comparer.
    if (a === undefined) return { ...l, etat: 'entree', deltaRang: null, deltaCout: null };
    let etat = 'stable';
    if (rang < a.rang) etat = 'montee';
    else if (rang > a.rang) etat = 'descente';
    return { ...l, etat, deltaRang: a.rang - rang, deltaCout: l.coutParPepite - a.cout };
  });
  const sorties = (precedent || [])
    .filter((l) => !vus.has(l.gid))
    .map((l) => ({ ...l, etat: 'sortie', deltaRang: null, deltaCout: null }));
  return { lignes, sorties };
}

// Les noms du jeu portent des accents, les recherches n'en portent pas.
function sansAccent(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// La recherche libre: le taux et le cout par pepite de N'IMPORTE QUEL objet
// recyclable, y compris ceux que le classement ne montrera jamais.
//
// ELLE PARCOURT LA TABLE DES TAUX, PAS CELLE DES PRIX, et c'est ce qui la
// distingue de classer(). Un objet recyclable dont personne ne connait le prix
// doit pouvoir se chercher: la reponse « prix inconnu » est une reponse, alors
// que l'absence de ligne laisserait croire qu'il n'est pas recyclable.
function chercher({
  texte, prixMoyens, prixMarche = null, limite = LIMITE_RECHERCHE,
}) {
  const q = sansAccent(texte === null || texte === undefined ? '' : texte).trim();
  if (q.length < 2) return [];
  const out = [];
  for (const cle of Object.keys(TAUX)) {
    const nom = nomDe(cle);
    if (nom === null || !sansAccent(nom).includes(q)) continue;
    const gid = Number(cle);
    const taux = tauxDe(gid);
    if (taux === null) continue;
    const p = prixEtSource(gid, prixMoyens, prixMarche);
    out.push({
      gid,
      nom,
      taux,
      prix: p === null ? null : p.prix,
      source: p === null ? null : p.source,
      quand: p === null ? null : p.quand,
      coutParPepite: p === null ? null : p.prix / taux,
      suspect: p !== null && p.source === 'moyen' && p.prix <= PRIX_SUSPECT,
    });
  }
  // LES SANS-PRIX EN DERNIER, et pas melanges: ils n'ont pas de cout, donc
  // aucune place legitime dans un tri par cout. Les mettre en tete ferait
  // passer « on ne sait pas » pour « c'est le meilleur ».
  out.sort((a, b) => {
    if (a.coutParPepite === null && b.coutParPepite === null) return a.gid - b.gid;
    if (a.coutParPepite === null) return 1;
    if (b.coutParPepite === null) return -1;
    return (a.coutParPepite - b.coutParPepite) || (b.taux - a.taux) || (a.gid - b.gid);
  });
  return out.slice(0, limite);
}

module.exports = { classer, comparer, chercher, LIMITE, LIMITE_RECHERCHE, PRIX_SUSPECT };
