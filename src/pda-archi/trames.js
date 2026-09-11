'use strict';
const { encodeRaw, decodeRaw, WIRE } = require('../codec/rawProto');

// Les trames de la chasse: ce qu'on emet, ce qu'on lit.
//
// Mesure du 2026-09-03, journal-chasse1.log, conception dans
// docs/superpowers/specs/2026-09-03-pda-archi-design.md. La requete
// construite ici reproduit celle que le jeu emet quand on equipe a la main.
//
// Fonctions pures: ni Electron, ni Frida, ni reseau.

// La meme enveloppe que src/hdv/trames.js: request { content: Any{ type_url,
// value }, uid: -1 }.
//
// L'ENVELOPPE EST EN CHAMP 1 DEPUIS LE PATCH 3.6.11.12, elle etait en champ 2
// avant. C'est le plus couteux des cinq defauts remappes le 10/09, et le plus
// discret: une requete batie sur l'ancien numero ne differe que par son PREMIER
// OCTET, 12 au lieu de 0a. Elle part alors dans la boite « event » au lieu de
// « request », et le serveur l'ignore sans rien dire.
//
// LE BALAYAGE DU 08/09 AVAIT MANQUE CE MODULE. src/songes.js porte la meme note
// pour la meme raison: la correction etait passee partout ailleurs ce soir-la,
// et les modules oublies n'ont rien signale — ils ont juste cesse d'agir.
const v = (no, valeur) => ({ no, wire: WIRE.VARINT, value: BigInt(valeur) });

function requete(type, champs) {
  const contenu = [{ no: 1, wire: WIRE.LEN, kind: 'string', value: `type.ankama.com/${type}` }];
  if (champs.length > 0) contenu.push({ no: 2, wire: WIRE.LEN, kind: 'message', value: champs });
  return encodeRaw([
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: contenu },
      // uid = -1, comme toutes les requetes observees depuis le 20/08.
      { no: 2, wire: WIRE.VARINT, value: -1n },
    ] },
  ]);
}

// --- Ce qu'on emet -------------------------------------------------------

// isz { 1: position, 2: uid de la pile, 3: quantite }
//
// REMAPPEE LE 10/09: le message s'appelait `iuk`, et SES TROIS CHAMPS ONT
// PERMUTE — la quantite est passee du 1 au 3, la position du 3 au 1. L'uid n'a
// pas bouge, ce qui rend l'erreur invisible a l'oeil: l'ordre reste bien forme,
// il demande simplement de deplacer 31 pierres vers l'emplacement 1.
//
// LA MESURE, journal-invitation.log a 29818 ms — un desequipement fait a la
// main, et le seul mouvement de pierre de tous les journaux:
//
//   --> isz { 1=63 2=52798638 3=1 }
//   <-- isf { 3={2=14 3=52799406} }              la pile d'arrivee, 13 -> 14
//   <-- irv { 2={3=17 4={1=52799406 2=9689}} }   gid 9689: une Enorme
//   <-- irz { 1=52798638 }                       la pile source disparait
//
// CE QUI IDENTIFIE LES TROIS CHAMPS, sans autre lecture possible: le 63 est
// POSITION_INVENTAIRE, la ou l'on range ce qu'on retire; l'uid du champ 2 est
// celui que `irz` declare disparu a la milliseconde; et la pile d'arrivee gagne
// UNE unite, donc la quantite deplacee vaut 1 — le champ 3.
//
// LE CLIENT DEPLACE LA PILE ENTIERE quand il equipe, pas une unite: mesure du
// 03/09, une pile de 89 s'equipe en un seul ordre a 89.
//
// LE SERVEUR DESEQUIPE TOUT SEUL. Poser une pile en 31 renvoie en 63 celle qui
// s'y trouvait, sans qu'on ait rien a demander: un ordre suffit.
//
// LES DEUX EMPLACEMENTS N'ONT PAS ETE REMESURES. 31 pour la pierre, 63 pour
// l'inventaire: ce sont des numeros du JEU, pas des numeros de champ, et rien
// n'indique qu'un patch les touche. Le 63 ci-dessus le confirme pour
// l'inventaire; le 31 attend la meme confirmation.
function trameEquiper({ uid, qte, position }) {
  return requete('isz', [v(1, position), v(2, uid), v(3, qte)]);
}

// iup { 1: 1, 2: rangements demandes } — REDEMANDER L'INVENTAIRE.
// (`itr { 2: rangements, 3: 1 }` jusqu'au patch 3.6.11.12.)
//
// Mesuree le 01/09 dans journal-hdv.log: le jeu l'emet lui-meme en ouvrant un
// panneau de rangement, et le serveur repond par un `ivx` en 38 ms, trois fois
// sur trois. C'est ce qui permet de rafraichir la collection d'archimonstres
// sans se deconnecter -- `ivx` ne tombe autrement qu'a la connexion.
//
// LE CHAMP 2 N'EST PAS INTERPRETE, IL EST RECOPIE. C'est la liste des
// rangements demandes, et deviner ce que valent ses deux octets ne rapporterait
// rien: la reponse dit elle-meme, pile par pile, de quel rangement chacune
// vient. Mesure du 04/09 sur la meme trame:
//
//   rangement 1  474 piles, toutes deja vues a la connexion  -> l'inventaire
//   rangement 2  518 piles                                   -> la banque
//   rangement 3   64 piles                                   -> un troisieme
//   absent        16 piles, toutes deja vues                 -> l'equipement porte
//
// 474 + 16 = 490, exactement le contenu de la connexion. Le tri se fait donc a
// la lecture, pas a la demande.
const RANGEMENTS = Buffer.from([0x02, 0x03]);

// REMAPPEE LE 10/09: `itr` est devenue `iup`, et la constante a change de champ
// — 3 avant, 1 apres. LA LISTE DES RANGEMENTS N'A PAS BOUGE: <02 03>, toujours
// au champ 2, et toujours recopiee sans etre interpretee.
//
// CE QUI CONFIRME L'APPARIEMENT est la REPONSE, pas la forme: dans
// journal-archi.log le serveur rend un `isb` 42 ms apres le premier `iup` et
// 70 ms apres le second. Le delai mesure au 01/09 pour `itr` etait de 38 ms, et
// aucun autre sortant de la seance n'est suivi d'un inventaire.
function trameLireInventaire() {
  return requete('iup', [
    v(1, 1),
    { no: 2, wire: WIRE.LEN, kind: 'bytes', value: RANGEMENTS },
  ]);
}

// --- Ce qu'on lit --------------------------------------------------------

const champ = (payload, no) => (payload || []).find((f) => f.no === no) || null;
const tous = (payload, no) => (payload || []).filter((f) => f.no === no);

function entier(payload, no) {
  const f = champ(payload, no);
  if (f === null || f.wire !== WIRE.VARINT) return null;
  return Number(f.value);
}

// UN CHAMP LEN EST AMBIGU PAR CONSTRUCTION, et rawProto.js le rappelle: une
// chaine, un sous-message et une suite d'octets sont indiscernables sans
// schema, donc le decodeur DEVINE. Un sous-message peut tres bien revenir en
// 'bytes'. On le redecode alors nous-memes plutot que de croire le kind, qui
// est exactement le piege ayant fait refuser a tort des chemins de deplacement.
function sousMessage(f) {
  if (f === null || f === undefined) return null;
  if (Array.isArray(f.value)) return f.value;
  if (Buffer.isBuffer(f.value)) {
    try {
      const d = decodeRaw(f.value);
      return d.length > 0 ? d : null;
    } catch (e) { return null; }
  }
  return null;
}

// ivq { 1: uid, 2: nouvelle position } etait la confirmation d'un deplacement,
// rendue en 40 ms a la mesure. C'est elle qu'on attend, pas un delai.
//
// CE NOM EST MORT DEPUIS LE PATCH 3.6.11.12, ET SON REMPLACANT EST INCONNU.
// C'est le seul des cinq que le remappage du 10/09 n'a pas retrouve, et il faut
// le dire ici plutot que de le laisser deviner: cette fonction ne rendra jamais
// autre chose que null tant que la mesure n'aura pas eu lieu.
//
// POURQUOI IL MANQUE, et ce n'est pas un oubli: le seul mouvement de pierre de
// tous les journaux est un desequipement qui FUSIONNE la pierre dans une pile
// existante. Le serveur repond alors `isf` puis `irz`, et aucune trame ne parle
// de position. Il faudrait deplacer une pile QUI NE FUSIONNE PAS — un
// equipement fait a la main pendant une mesure suffira.
//
// CE QUE SON ABSENCE COUTE EST BORNE, et c'est pourquoi la chasse repart sans
// lui: la pose d'une pierre prise dans une pile CREE une pile neuve, deja a
// l'emplacement, donc arrive en `isa` — le vrai chemin de confirmation depuis
// le 03/09. Ce qui reste sans suivi est l'equipement fait A LA MAIN entre deux
// combats: notre copie garde alors une position perimee, et `choisir` peut
// repondre « deja » sur une pierre qui n'est plus portee. Le prochain `isb`
// remet tout d'aplomb.
function lirePosition(frame) {
  if (!frame || frame.type !== 'ivq') return null;
  const uid = entier(frame.payload, 1);
  const pos = entier(frame.payload, 2);
  if (uid === null || pos === null) return null;
  return { uid, pos };
}

// kmu { 2: identifiant d'un acteur } dit qu'un acteur QUITTE LA CARTE. Un
// groupe de monstres attaque la quitte, donc c'est bien le signal du combat.
//
// LA CHASSE NE S'EN SERT PLUS depuis le 04/09: elle lit `kae`, qui nomme le
// combat lui-meme (voir plus bas). Cette lecture reste parce qu'elle est
// mesuree et juste, et parce que « un acteur quitte la carte » servira
// ailleurs. Ne pas la rebrancher sur la chasse: c'est en croyant qu'elle
// disait « un combat commence » qu'on a bati trois etats qui perimaient.
//
// MAIS ELLE NE PARLE PAS QUE DE COMBAT, et c'est la lecon du 03/09 au soir:
// chaque joueur qui s'en va en produit une aussi. La premiere mesure avait
// donne `kmu { 2=-20000 }` juste au demarrage du combat, et on en avait
// conclu trop vite qu'elle nommait le groupe attaque. Sur une carte frequentee,
// elle tombe des dizaines de fois pour rien.
//
// LE SIGNE FAIT LE TRI, et lui seul: un groupe de monstres porte un
// identifiant NEGATIF, un joueur porte le sien, grand et positif. Meme critere
// que src/abandon-combat.js pour distinguer un monstre d'un joueur.
//
// Verifie le 03/09: les DEUX clients recoivent le meme `kmu { 2=-20004 }` a
// 6 ms d'intervalle. La trame sortante `hqa`, elle, n'est emise que par le
// maitre: elle n'aurait pas convenu.
function lireGroupeAttaque(frame) {
  if (!frame || frame.type !== 'kmu') return null;
  const id = entier(frame.payload, 2);
  if (id === null || id >= 0) return null;
  return id;
}

// jpo, la liste des acteurs de la carte — le MEME message qui porte les
// elements interactifs (voir JPO_ELEMENTS dans src/protocol/compte.js):
//
//   9 (repete) = un acteur
//     2 = son identifiant, NEGATIF pour un groupe de monstres
//     1.1.4 = les infos de groupe, absentes chez un joueur
//       2 = le bloc des monstres, un sous-message chacun:
//           { 1: grade, 2: identifiant du monstre, 3: NIVEAU }
//
// LE NIVEAU EST DANS LA TRAME. Aucune donnee de reference n'est necessaire, ni
// fichier de monstres ni DofusDB: verifie le 03/09 contre DofusDB sur quatre
// monstres, exact au niveau pres.
//
// REMESURE LE 08/09, patch 3.6.11.12: le message s'appelait `jss`, et TOUS les
// numeros ont bouge — la liste, l'identifiant de l'acteur, le chemin du bloc,
// et les trois champs de chaque monstre.
//
// CE QUI IDENTIFIE CES TROIS CHAMPS, sur les 1014 entrees de monstre relevees
// dans les trois journaux du 08/09: le champ 1 ne prend QUE les valeurs 1 a 5,
// les grades du jeu; le champ 3 reste entre 24 et 160, un niveau; le champ 2
// monte a 4560 et ne peut etre ni l'un ni l'autre. Le grade et le niveau
// montent ENSEMBLE dans un meme groupe — grade 3 -> 66, 4 -> 68, 5 -> 70 sur la
// carte de la fixture — ce qui ne laisse pas d'autre lecture.
//
// LE BLOC MELANGE DEUX NUMEROS DE CHAMP: le 1 est la creature qui mene le
// groupe, le 3 les autres, repete (c'etait 2 et 1 avant le patch). On ne fait
// pas la difference, la regle ne demandant que le maximum, donc on lit toutes
// les entrees du bloc.
//
// LE BLOC EST PLUS PROFOND QUE CE QUE `decodeFrameRaw` DECODE, et c'est
// `sousMessage` qui sauve la lecture: il redecode lui-meme un champ rendu en
// 'bytes' faute de budget de profondeur. Sans lui lireGroupes rendrait une
// carte vide, sans une erreur.
function lireGroupes(frame) {
  const groupes = new Map();
  if (!frame || frame.type !== 'jpo') return groupes;
  for (const acteur of tous(frame.payload, 9)) {
    const a = sousMessage(acteur);
    if (a === null) continue;
    const id = entier(a, 2);
    // UN IDENTIFIANT POSITIF EST UN JOUEUR, et il n'a pas d'infos de groupe.
    if (id === null || id >= 0) continue;
    const bloc = sousMessage(champ(
      sousMessage(champ(sousMessage(champ(sousMessage(champ(a, 1)), 1)), 4)), 2,
    ));
    if (bloc === null) continue;
    let niveauMax = 0;
    let monstres = 0;
    for (const f of bloc) {
      const m = sousMessage(f);
      const niveau = entier(m, 3);
      if (entier(m, 2) === null || niveau === null) continue;
      monstres += 1;
      if (niveau > niveauMax) niveauMax = niveau;
    }
    if (monstres > 0) groupes.set(id, { niveauMax, monstres });
  }
  return groupes;
}

// jym { 1={ 5: identifiant du combattant }, 2: identifiant du COMBAT } dit
// qu'un combattant est ajoute a un combat. Une trame par combattant, monstres
// compris.
//
// TOUT CE QUI SUIT A ETE ETABLI SOUS SON ANCIEN NOM, `kae`, les 03 et 04/09.
// Le raisonnement n'a pas bouge d'un mot au remappage du 10/09 — seuls le nom
// et le numero du champ de l'acteur ont change, voir la note juste au-dessus de
// la fonction. Les trames citees plus bas gardent donc leur ecriture d'origine:
// les rebaptiser ferait croire qu'elles ont ete remesurees.
//
// C'EST ELLE QUI REMPLACE `kmu`, et le 04/09 a montre pourquoi il fallait le
// remplacer. `kmu` ne dit que « un acteur quitte la carte »: pour en tirer un
// combat il fallait un objet global, une fenetre de 5 s contre les doublons et
// une de 60 s contre les retardataires. Trois etats qui peuvent perimer, et
// trois sorties MUETTES quand ils perimaient. Le bug de Jibef etait la.
//
// `kae` porte l'identifiant du combat LUI-MEME. Plus aucune fenetre n'est
// necessaire: on equipe une fois par combat et par personnage, point.
//
// MESURE, journal-archi-bug.log du 04/09 et journal-chasse6.log du 03/09:
//
//   kae { 1={2=1 3=-20001 4=1 5=<0o> 6=1} 2=194 }   le groupe, chez l'attaquant
//   kae { 1={3=677158453542 4=1 5={…}} 2=194 }      un joueur, chez chacun
//
// L'IDENTIFIANT DE COMBAT EST BIEN CELUI D'UN COMBAT, et pas d'une carte: dans
// journal-chasse6.log le MEME groupe `-20002`, sur la MEME carte, porte
// `2=211` au premier combat et `2=55` au troisieme. Aucune autre lecture ne
// survit a cette mesure.
//
// LE GROUPE N'EST NOMME QUE CHEZ L'ATTAQUANT. Ceux qui rejoignent ne recoivent
// que les `kae` des joueurs. C'est sans importance: un seul client a besoin
// d'apprendre le niveau, puisque la cle est le combat et non le personnage.
// REMAPPEE LE 10/09: le message s'appelait `kae`, c'est `jym`, et
// L'IDENTIFIANT DU COMBATTANT A CHANGE DE CHAMP — 3 avant, 5 apres. Le
// combat, lui, reste au champ 2.
//
//   kae { 1={2=1 3=-20001 4=1 5=<0o> 6=1} 2=194 }      avant, le 04/09
//   jym { 1={2=<0o> 3=1 5=-20000 7=1 8=1} 2=100 }      apres, le groupe
//   jym { 1={2={2={…}} 5=677012898086 8=1} 2=100 }     apres, un joueur
//
// DEUX JOURNAUX INDEPENDANTS DONNENT LA MEME FORME: journal-combat.log porte
// trois `jym`, toutes en combat 100; journal-hdv.log en porte douze, toutes en
// combat 18. Dans chacun un seul combattant est NEGATIF — le groupe de
// monstres — et les autres sont des joueurs, grands et positifs. C'est trait
// pour trait ce que `kae` decrivait ci-dessus.
function lireEntreeCombat(frame) {
  if (!frame || frame.type !== 'jym') return null;
  const idCombat = entier(frame.payload, 2);
  if (idCombat === null) return null;
  const acteur = sousMessage(champ(frame.payload, 1));
  const idActeur = acteur === null ? null : entier(acteur, 5);
  if (idActeur === null) return null;
  return { idCombat, idActeur };
}

module.exports = {
  trameEquiper, trameLireInventaire, lirePosition, lireGroupeAttaque, lireGroupes,
  lireEntreeCombat,
};
