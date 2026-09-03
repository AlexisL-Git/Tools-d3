'use strict';

// La table des pierres d'ame, et le choix. Fonction pure: ni trame, ni reseau,
// ni disque.
//
// Conception: docs/superpowers/specs/2026-09-03-chasse-pierre-ame-design.md.
//
// LE PLAFOND N'EST PAS LE NIVEAU DE L'OBJET, et les confondre coute une pierre
// a chaque combat. C'est l'erreur du 03/09, rapportee deux fois par Jibef avant
// qu'elle soit comprise: le champ « niveau » d'une pierre d'ame est celui de
// l'OBJET, et le plafond de capture est DECALE D'UN CRAN AU-DESSUS.
//
//   gid   nom            niveau de l'objet   plafond reel
//   9686  Petite                        20             50
//   9687  Moyenne                       50            100
//   9688  Grande                       100            150
//   9689  Enorme                       150            190
//   9690  Gigantesque                  190           1000
//
// Le plafond se lit dans l'effet 705 de l'objet, troisieme parametre. Lire le
// champ « niveau » faisait equiper une Enorme (plafond 190) sur un monstre de
// 124, la ou la Grande (plafond 150) suffisait.
//
// LA GIGANTESQUE COUVRE TOUT ce qui existe: la Gargantuesque (gid 9718) n'a
// donc aucune raison d'etre dans la table, et le cas « hors de portee » ne peut
// plus se produire en jeu. Il reste code, on ne supprime pas une garde parce
// qu'elle ne sert pas aujourd'hui.
const PIERRES = [
  { gid: 9686, plafond: 50, nom: 'Petite pierre d ame' },
  { gid: 9687, plafond: 100, nom: 'Moyenne pierre d ame' },
  { gid: 9688, plafond: 150, nom: 'Grande pierre d ame' },
  { gid: 9689, plafond: 190, nom: 'Enorme pierre d ame' },
  { gid: 9690, plafond: 1000, nom: 'Gigantesque pierre d ame' },
];

// L'emplacement d'equipement d'une pierre d'ame, mesure le 03/09: poser une
// pile en 31 renvoie en inventaire celle qui s'y trouvait.
const POSITION_PIERRE = 31;

// La plus petite pierre dont le plafond couvre le niveau, ou null.
function tranche(niveauMax) {
  const n = Number(niveauMax);
  if (!Number.isFinite(n) || n <= 0) return null;
  return PIERRES.find((p) => n <= p.plafond) || null;
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
