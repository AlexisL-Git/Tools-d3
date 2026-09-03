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

  // Une pierre PLEINE porte des lignes d'effets: l'equiper ne capturerait rien.
  const siennes = (piles || []).filter((p) => p.gid === voulue.gid && !p.avecEffets);
  const portee = siennes.find((p) => p.pos === POSITION_PIERRE);
  if (portee !== undefined) return { quoi: 'deja', gid: voulue.gid };

  // La plus grosse pile d'abord: c'est celle qui tiendra le plus de captures.
  // L'uid ne departage que pour rendre le choix deterministe, donc testable.
  const rangee = siennes.filter((p) => p.pos !== POSITION_PIERRE)
    .sort((a, b) => (b.qte - a.qte) || (a.uid - b.uid))[0];
  if (rangee === undefined) return { quoi: 'manque', gid: voulue.gid, nom: voulue.nom };

  return { quoi: 'equiper', gid: voulue.gid, uid: rangee.uid, qte: rangee.qte };
}

module.exports = { PIERRES, POSITION_PIERRE, tranche, choisir };
