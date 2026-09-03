'use strict';

// La table des pierres d'ame, et le choix. Fonction pure: ni trame, ni reseau,
// ni disque.
//
// Conception: docs/superpowers/specs/2026-09-03-chasse-pierre-ame-design.md.
//
// LES NIVEAUX NE SONT PAS DEVINES. Ils viennent du champ niveau des objets du
// jeu, typeId 83, et disent le PLAFOND de capture: une pierre prend tout ce
// qui est inferieur ou egal a son niveau.
//
// LA GARGANTUESQUE (gid 9718) N'EST PAS DANS LA TABLE, volontairement: c'est
// le combat final d'une chasse, il se prepare a la main.
const PIERRES = [
  { gid: 9686, niveau: 20, nom: 'Petite pierre d ame' },
  { gid: 9687, niveau: 50, nom: 'Moyenne pierre d ame' },
  { gid: 9688, niveau: 100, nom: 'Grande pierre d ame' },
  { gid: 9689, niveau: 150, nom: 'Enorme pierre d ame' },
  { gid: 9690, niveau: 190, nom: 'Gigantesque pierre d ame' },
];

// L'emplacement d'equipement d'une pierre d'ame, mesure le 03/09: poser une
// pile en 31 renvoie en inventaire celle qui s'y trouvait.
const POSITION_PIERRE = 31;

// La plus petite pierre qui couvre le niveau, ou null.
function tranche(niveauMax) {
  const n = Number(niveauMax);
  if (!Number.isFinite(n) || n <= 0) return null;
  return PIERRES.find((p) => n <= p.niveau) || null;
}

// LE VERDICT EST UN SEUL OBJET, jamais une exception ni un null nu: chacun des
// quatre cas doit pouvoir s'afficher tel quel dans le panneau.
//
// JAMAIS DE REMPLACEMENT PAR LA TRANCHE DU DESSUS. Une pierre plus grande
// capturerait bien un monstre plus faible, la regle du jeu etant « inferieur ou
// egal », mais elle vaut plus cher que ce que la capture rapporte. Decision de
// Jibef le 2026-09-03.
function choisir({ niveauMax, piles }) {
  const voulue = tranche(niveauMax);
  if (voulue === null) return { quoi: 'hors-portee', niveauMax };

  // CE QUI OCCUPE L'EMPLACEMENT, quoi que ce soit. On le sortira avant de poser
  // la bonne pierre, plutot que de compter sur le serveur pour le faire.
  //
  // LE CAS QUI JUSTIFIE VRAIMENT CETTE PURGE: une pierre qui se remplit pendant
  // le combat CHANGE D'OBJET, elle devient une « Pierre d'ame pleine », gid
  // 7010, et reste a l'emplacement. Sans purge, on la prendrait pour une pierre
  // etrangere qu'on remplace, ce qui va, mais si notre copie de l'inventaire
  // avait pris du retard on croirait la bonne pierre en place et la chasse
  // s'arreterait en silence apres la premiere capture. Sortir d'abord ne
  // suppose rien.
  const occupant = (piles || []).find((p) => p.pos === POSITION_PIERRE) || null;
  const purge = occupant === null || occupant.gid === voulue.gid
    ? null
    : { uid: occupant.uid, qte: occupant.qte, gid: occupant.gid };

  // LE GID SUFFIT, ET `avecEffets` NE SERT A RIEN ICI. Mesure du 03/09: les
  // quatre piles de pierres vides de l'inventaire le portent toutes. Le
  // raisonnement de l'hotel de vente, ou une ressource n'a pas d'effets, ne
  // s'applique pas: une pierre est de l'equipement. Et une pierre PLEINE n'est
  // pas le meme objet, c'est le gid 7010, donc elle ne peut pas se glisser ici.
  const siennes = (piles || []).filter((p) => p.gid === voulue.gid);
  const portee = siennes.find((p) => p.pos === POSITION_PIERRE);
  if (portee !== undefined) return { quoi: 'deja', gid: voulue.gid };

  // La plus grosse pile d'abord: c'est celle qui tiendra le plus de captures.
  // L'uid ne departage que pour rendre le choix deterministe, donc testable.
  const rangee = siennes.filter((p) => p.pos !== POSITION_PIERRE)
    .sort((a, b) => (b.qte - a.qte) || (a.uid - b.uid))[0];
  if (rangee === undefined) return { quoi: 'manque', gid: voulue.gid, nom: voulue.nom };

  return { quoi: 'equiper', gid: voulue.gid, uid: rangee.uid, qte: rangee.qte, purge };
}

module.exports = { PIERRES, POSITION_PIERRE, tranche, choisir };
