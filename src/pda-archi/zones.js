'use strict';
const { ARCHIMONSTRES, SOUS_ZONES } = require('./archimonstres');

// OU CHASSER: les zones, triees par ce qu il y reste a prendre. Fonction pure:
// ni trame, ni reseau, ni disque, ni Electron.
//
// Conception validee par Jibef le 2026-09-04. Elle repond a une question
// precise -- « ou aller pour en attraper le plus vite possible » -- et pas a
// « ou vit tel archimonstre », qui se lit deja dans le tableau.

const PAR_SOUS_ZONE = new Map(SOUS_ZONES.map((s) => [s.id, s]));

// zone -> sous-zone -> [identifiants d archimonstres]
//
// Calcule UNE FOIS au chargement: la table ne bouge pas, et le panneau peut se
// redessiner a chaque clic sans repayer le croisement.
const ARBRE = new Map();
for (const a of ARCHIMONSTRES) {
  for (const id of a.sousZones) {
    const sz = PAR_SOUS_ZONE.get(id);
    if (sz === undefined) continue;
    if (!ARBRE.has(sz.zone)) ARBRE.set(sz.zone, new Map());
    const parSz = ARBRE.get(sz.zone);
    if (!parSz.has(id)) parSz.set(id, []);
    parSz.get(id).push(a.id);
  }
}

// Le plus fourni d abord, le nom pour departager: sans ce second critere, deux
// zones a egalite changeraient d ordre d un affichage a l autre.
const decroissant = (nomDe) => (a, b) => (b.manquants - a.manquants)
  || nomDe(a).localeCompare(nomDe(b), 'fr');

// `lignes` et `comptes` sont ce que rend src/pda-archi/tableau.js.
//
// `vise` est le personnage dont on a clique le bouton, ou null. MEME REGLE QUE
// LE FILTRE DU TABLEAU: avec un personnage suivi, « manquant » veut dire
// manquant POUR LUI; sans, il veut dire que personne dans l equipe ne l a. Un
// seul modele mental dans le panneau.
function parZones({ lignes, comptes, vise = null }) {
  const presents = new Map((lignes || []).map((l) => [l.id, l.presents]));

  const manque = (id) => {
    const p = presents.get(id);
    if (p === undefined) return false;
    return vise === null ? p.length === 0 : !p.includes(vise);
  };

  // UN INVENTAIRE PAS ENCORE LU N EST PAS UN INVENTAIRE VIDE. On ne sait pas ce
  // qu il manque a ce personnage, donc on ne le fait pas se deplacer: il
  // n apparait dans aucun `qui`.
  const lus = (comptes || []).filter((c) => c.lu === true);
  const quiParmi = (ids) => lus
    .filter((c) => ids.some((id) => {
      const p = presents.get(id);
      return p !== undefined && !p.includes(c.pid);
    }))
    .map((c) => c.pid);

  const out = [];
  for (const [zone, parSz] of ARBRE) {
    const sousZones = [];
    // CHAQUE SOUS-ZONE EST UN ENDROIT OU L ATTRAPER: un archimonstre qui vit
    // dans deux d entre elles manque dans les deux.
    for (const [id, ids] of parSz) {
      const restants = ids.filter(manque);
      sousZones.push({
        id,
        nom: PAR_SOUS_ZONE.get(id).nom,
        manquants: restants.length,
        qui: quiParmi(ids),
      });
    }
    sousZones.sort(decroissant((s) => s.nom));

    // MAIS LE TOTAL DE LA ZONE NE LE COMPTE QU UNE FOIS. Sommer les sous-zones
    // gonflerait Amakna toute seule, et le tri par « ou il en manque le plus »
    // designerait la mauvaise region.
    const tous = [...new Set([...parSz.values()].flat())];
    out.push({
      zone,
      manquants: tous.filter(manque).length,
      qui: quiParmi(tous),
      sousZones,
    });
  }
  out.sort(decroissant((z) => z.zone));
  return out;
}

module.exports = { parZones };
