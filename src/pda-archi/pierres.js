'use strict';

// La table des pierres d'ame, et le choix. Fonction pure: ni trame, ni reseau,
// ni disque.
//
// Conception: docs/superpowers/specs/2026-09-03-pda-archi-design.md.
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
// LA TRANCHE DU DESSUS NE REMPLACE LA MANQUANTE QUE SI ON LE DEMANDE, et c'est
// `monterEnCalibre`. Deux decisions se sont succede, et les deux sont vraies:
//
//   Jibef, le 2026-09-03 -- jamais de remplacement. Une pierre plus grande
//   capturerait bien un monstre plus faible, la regle du jeu etant « inferieur
//   ou egal », mais elle vaut plus cher que ce que la capture rapporte. C'est
//   le DEFAUT, et un argument absent le laisse intact.
//
//   Alexis, le 2026-09-07 -- partir NU coute le combat entier. Un stock de
//   Grandes tombe a zero, et plus rien ne s'equipait: le motif du 03/09 tient
//   sur le prix d'une pierre, pas sur celui d'une capture ratee. La montee est
//   donc offerte, en case a cocher (`pdaArchiRepli` dans favoris.json).
//
// LE REPLI RESTE EXCEPTIONNEL PARCE QU'IL REDESCEND. Des que la tranche exacte
// revient en reserve, elle reprend la place: sans ca une seule rupture ferait
// consommer des Gigantesques jusqu'a la fin de la session, ce que la decision
// du 03/09 voulait justement eviter.
function choisir({ niveauMax, piles, monterEnCalibre }) {
  const voulue = tranche(niveauMax);
  if (voulue === null) return { quoi: 'hors-portee', niveauMax };

  const stock = piles || [];

  // CE QUI OCCUPE L'EMPLACEMENT, quoi que ce soit. On le sortira de la, plutot
  // que de compter sur le serveur pour le faire.
  //
  // APRES LA POSE, ET PAS AVANT -- correction du 05/09, voir purgerApresPose()
  // dans pda-archi.js. Sortir d'abord laissait le personnage NU chaque fois que
  // la pose qui suivait n'aboutissait pas. Ce que `choisir` rend ici ne change
  // pas: c'est toujours « voila ce qui traine a l'emplacement », seul le moment
  // ou l'ordre part a bouge.
  //
  // UNE PIERRE QUI SE REMPLIT NE RESTE PAS A L'EMPLACEMENT, et ce commentaire a
  // affirme le contraire du 03/09 au 05/09. Observation d'Alexis en jeu le
  // 05/09: a la capture, la pierre repart en INVENTAIRE avec l'ame du monstre.
  // Le jeu la desequipe donc lui-meme, et l'emplacement est VIDE au combat
  // suivant -- il n'y a alors rien a purger du tout.
  //
  // CE QUI RESTE A PURGER est ce qu'on n'a pas mis la: une pierre d'un autre
  // calibre, portee a la main ou laissee par une session precedente. Le cas est
  // rare, la garde reste -- on ne supprime pas une garde parce qu'elle sert
  // moins souvent qu'on ne le croyait.
  //
  // CE N'EST PAS LE GID 7010. Ce commentaire l'a annonce du 03/09 au 04/09,
  // ecrit sans qu'une pierre pleine ait jamais ete observee. La mesure du 04/09
  // (2026-09-04-trames-ame-pleine.md) ne trouve AUCUNE pile de gid 7010, sur
  // 674: chaque ame est son propre objet, `Pichakote le Degoutant` est le gid
  // 34005, et les 143 ames d'un inventaire portent 143 gids distincts. Le
  // raisonnement ci-dessus tient tel quel -- il compare des gids sans jamais en
  // nommer un -- seul son exemple etait invente.
  const occupant = stock.find((p) => p.pos === POSITION_PIERRE) || null;

  // LES CALIBRES ACCEPTABLES, DU PLUS PETIT AU PLUS GRAND. Sans repli la liste
  // n'a qu'un element et tout ce qui suit se comporte comme avant le 07/09.
  //
  // ON NE DESCEND JAMAIS: `PIERRES` est trie par plafond croissant, et couper a
  // la tranche voulue ecarte d'un coup tous les calibres qui ne captureraient
  // pas. Une Moyenne en stock n'est pas une solution pour du niveau 120.
  const candidats = monterEnCalibre === true
    ? PIERRES.slice(PIERRES.indexOf(voulue))
    : [voulue];

  // LE GID SUFFIT, ET `avecEffets` NE SERT A RIEN ICI. Mesure du 03/09: les
  // quatre piles de pierres vides de l'inventaire le portent toutes. Le
  // raisonnement de l'hotel de vente, ou une ressource n'a pas d'effets, ne
  // s'applique pas: une pierre est de l'equipement. Et une pierre PLEINE n'est
  // pas le meme objet -- elle a son propre gid, un par archimonstre -- donc
  // elle ne peut pas se glisser ici.
  //
  // LA PIERRE PORTEE COMPTE COMME UN STOCK, et c'est pour ca qu'on cherche dans
  // `stock` entier plutot que dans les seules piles rangees: une Enorme deja en
  // place, sans Grande en reserve, ne doit pas etre retiree pour etre remise.
  const prise = candidats.find((c) => stock.some((p) => p.gid === c.gid));
  if (prise === undefined) {
    // LE NOM RENDU EST CELUI DE LA TRANCHE VOULUE, pas du dernier calibre
    // essaye: c'est cette pierre-la qu'il faut racheter.
    return { quoi: 'manque', gid: voulue.gid, nom: voulue.nom };
  }

  // LA QUESTION EST « UNE PILE DE CE CALIBRE EST-ELLE PORTEE », PAS « L'OCCUPANT
  // EST-IL DE CE CALIBRE ». Les deux se confondent en jeu -- il n'y a qu'un seul
  // emplacement -- mais pas dans notre copie de l'inventaire: equiper a la main
  // envoie un `ivq` pour la pierre qui ARRIVE et rien pour celle qui part, donc
  // deux piles s'y declarent le temps du prochain `ivx`. Comparer a `occupant`,
  // qui est la premiere des deux, faisait dire « manque » sur une pierre qu'on
  // portait: regression du 07/09, rattrapee par le test « la position se met a
  // jour meme eteinte ».
  if (stock.some((p) => p.gid === prise.gid && p.pos === POSITION_PIERRE)) {
    return { quoi: 'deja', gid: prise.gid };
  }

  // La plus grosse pile d'abord: c'est celle qui tiendra le plus de captures.
  // L'uid ne departage que pour rendre le choix deterministe, donc testable.
  const rangee = stock.filter((p) => p.gid === prise.gid && p.pos !== POSITION_PIERRE)
    .sort((a, b) => (b.qte - a.qte) || (a.uid - b.uid))[0];
  // Hors d'atteinte aujourd'hui: la seule pile possible hors reserve est celle
  // de l'emplacement, et le `deja` ci-dessus l'a deja renvoyee. La garde reste.
  if (rangee === undefined) return { quoi: 'manque', gid: voulue.gid, nom: voulue.nom };

  const purge = occupant === null
    ? null
    : { uid: occupant.uid, qte: occupant.qte, gid: occupant.gid };
  const verdict = {
    quoi: 'equiper', gid: prise.gid, uid: rangee.uid, qte: rangee.qte, purge,
  };
  // LE REPLI SE DECLARE, sinon le journal mentirait par omission: « Enorme
  // equipee » sans dire que c'est la Grande qui manque ne se comprend pas.
  if (prise.gid !== voulue.gid) verdict.repli = { gid: voulue.gid, nom: voulue.nom };
  return verdict;
}

module.exports = { PIERRES, POSITION_PIERRE, tranche, choisir };
