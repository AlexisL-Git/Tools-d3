'use strict';
const { collection, SOUS_ZONES } = require('./archimonstres');

// OU CHASSER: les zones, triees par ce qu il y reste a prendre. Fonction pure:
// ni trame, ni reseau, ni disque, ni Electron.
//
// Conception validee par Jibef le 2026-09-04. Elle repond a une question
// precise -- « ou aller pour en attraper le plus vite possible » -- et pas a
// « ou vit tel archimonstre », qui se lit deja dans le tableau.

const PAR_SOUS_ZONE = new Map(SOUS_ZONES.map((s) => [s.id, s]));

// zone -> sous-zone -> [identifiants], une fois par collection.
//
// Calcule au PREMIER usage et garde: la table ne bouge pas, et le panneau peut
// se redessiner a chaque clic sans repayer le croisement.
const ARBRES = new Map();
function arbreDe(quoi) {
  if (ARBRES.has(quoi)) return ARBRES.get(quoi);
  const arbre = new Map();
  const c = collection(quoi);
  for (const a of c.entrees) {
    for (const id of a.sousZones) {
      const sz = PAR_SOUS_ZONE.get(id);
      if (sz === undefined) continue;
      if (!arbre.has(sz.zone)) arbre.set(sz.zone, new Map());
      const parSz = arbre.get(sz.zone);
      if (!parSz.has(id)) parSz.set(id, []);
      parSz.get(id).push(a.id);
    }
  }
  ARBRES.set(quoi, { arbre, parId: c.parId });
  return ARBRES.get(quoi);
}

// Le plus fourni d abord, le nom pour departager: sans ce second critere, deux
// zones a egalite changeraient d ordre d un affichage a l autre.
const decroissant = (nomDe) => (a, b) => (b.manquants - a.manquants)
  || nomDe(a).localeCompare(nomDe(b), 'fr');

// `lignes` et `comptes` sont ce que rend src/pda-archi/tableau.js.
//
// « MANQUANT » VEUT DIRE « MANQUANT A AU MOINS UN PERSONNAGE », et c est le
// coeur de cette vue. Decision de Jibef le 2026-09-04, apres qu une premiere
// version eut compte « ce que personne n a ».
//
// La raison est la chasse elle-meme: les quatre personnages capturent EN MEME
// TEMPS, une pierre equipee sur chacun. Un endroit vaut donc le deplacement
// tant qu il reste quelqu un a servir, meme si un autre a deja l archimonstre.
//
// L autre lecture -- celle du tableau, « personne ne l a » -- rendait de plus
// les emblemes inutiles: un archimonstre que personne n a manque forcement a
// TOUT LE MONDE, donc les quatre emblemes s affichaient sur chaque ligne. Elle
// produisait aussi des lignes a `0` portant quand meme des emblemes, faute de
// compter la meme chose que `qui`.
//
// `vise` est le personnage dont on a clique le bouton, ou null. Avec lui,
// « manquant » se restreint a CE personnage.
function parZones({ lignes, comptes, vise = null, quoi = 'archi' }) {
  const { arbre: ARBRE, parId: PAR_ID } = arbreDe(quoi);
  const presents = new Map((lignes || []).map((l) => [l.id, l.presents]));

  // UN INVENTAIRE PAS ENCORE LU N EST PAS UN INVENTAIRE VIDE. On ne sait pas ce
  // qu il manque a ce personnage, donc on ne le fait pas se deplacer.
  const lus = (comptes || []).filter((c) => c.lu === true);

  const quiPour = (id) => {
    const p = presents.get(id);
    return p === undefined ? [] : lus.filter((c) => !p.includes(c.pid)).map((c) => c.pid);
  };

  const manque = (id) => {
    const p = presents.get(id);
    if (p === undefined) return false;
    if (vise !== null) return !p.includes(vise);
    // AUCUN INVENTAIRE LU: on ne peut dire a personne ce qui lui manque, alors
    // on montre ce qui existe. Un panneau ouvert avant que les clients soient
    // la doit lister le monde, pas seize zeros.
    if (lus.length === 0) return p.length === 0;
    // AUCUN INVENTAIRE LU: on ne peut dire a personne ce qui lui manque, alors
    // on montre ce qui existe. Un panneau ouvert avant que les clients soient
    // la doit lister le monde, pas seize zeros.
    return lus.some((c) => !p.includes(c.pid));
  };

  // `qui` SE DEDUIT DE CE QUI MANQUE, il ne se calcule pas a cote: c est ce qui
  // interdit la ligne « 0 » portant des emblemes.
  const quiParmi = (restants) => {
    const vus = new Set();
    for (const r of restants) for (const pid of r.qui) vus.add(pid);
    return lus.filter((c) => vus.has(c.pid)).map((c) => c.pid);
  };

  const out = [];
  for (const [zone, parSz] of ARBRE) {
    const sousZones = [];
    // CHAQUE SOUS-ZONE EST UN ENDROIT OU L ATTRAPER: un archimonstre qui vit
    // dans deux d entre elles manque dans les deux.
    for (const [id, ids] of parSz) {
      // CE QU IL Y MANQUE, NOMMEMENT. « Cimetière 6 » envoie chasser sans
      // savoir quelle pierre preparer; la liste, elle, porte les niveaux.
      //
      // Du plus faible au plus fort, comme le tableau: c'est l'ordre dans
      // lequel on chasse. Le nom departage, pour que deux affichages rendent
      // le meme ordre.
      const restants = ids.filter(manque)
        .map((m) => ({
          id: m,
          nom: PAR_ID.get(m).nom,
          niveau: PAR_ID.get(m).niveau,
          // CHACUN PORTE SES PROPRES EMBLEMES: dans une meme sous-zone, deux
          // personnages peuvent avoir besoin de deux monstres differents.
          qui: quiPour(m),
        }))
        .sort((a, b) => (a.niveau - b.niveau) || a.nom.localeCompare(b.nom, 'fr'));
      sousZones.push({
        id,
        nom: PAR_SOUS_ZONE.get(id).nom,
        manquants: restants.length,
        qui: quiParmi(restants),
        restants,
      });
    }
    // CE QUI EST FAIT DISPARAIT. Une sous-zone ou il ne reste rien n est pas
    // une information: c est une ligne a sauter, et il y en a plus de cent.
    // Demande de Jibef le 04/09.
    const restantes = sousZones.filter((s) => s.manquants > 0);
    restantes.sort(decroissant((s) => s.nom));

    // MAIS LE TOTAL DE LA ZONE NE LE COMPTE QU UNE FOIS. Sommer les sous-zones
    // gonflerait Amakna toute seule, et le tri par « ou il en manque le plus »
    // designerait la mauvaise region.
    const tous = [...new Set([...parSz.values()].flat())];
    const restantsZone = tous.filter(manque).map((m) => ({ qui: quiPour(m) }));
    // Meme regle un cran au-dessus: une zone finie ne s affiche pas. Le test
    // du niveau au-dessus garantit qu une zone gardee garde bien toutes ses
    // sous-zones ou il reste quelque chose.
    if (restantsZone.length === 0) continue;
    out.push({
      zone,
      manquants: restantsZone.length,
      qui: quiParmi(restantsZone),
      sousZones: restantes,
    });
  }
  out.sort(decroissant((z) => z.zone));
  return out;
}

module.exports = { parZones };
