'use strict';

// Le catalogue des messages a retrouver apres un patch: pour chacun, son
// EMPREINTE structurelle d'avant. Voir appariement.js pour le mecanisme.
//
// CE FICHIER EST SEPARE DE L'OUTIL POUR UNE SEULE RAISON: pouvoir etre teste.
// Une empreinte fausse ne casse rien, n'echoue nulle part, et rend simplement
// « aucun candidat » — l'outil accuse alors la MESURE (« le geste a-t-il ete
// fait ? ») alors que la faute est ici. Une seance de capture perdue.
//
// REGLE POUR AJOUTER UNE ENTREE: calculer l'empreinte avec empreinte() SUR LES
// OCTETS REELS de la trame d'avant le patch, jamais d'apres le commentaire qui
// la decrit. Les deux divergent, et c'est mesure:
//
//   src/invitation.js decrit `ijz { 1: nous, 2: invitant, 3: 8, 5: idGroupe,
//   6: 1, 7: nom }` — six champs. La premiere version de ce catalogue en
//   portait TROIS (1, 2 et 5), les seuls que le commentaire nommait
//   utilement. candidats() compare les empreintes par egalite EXACTE: cette
//   entree-la n'aurait apparie aucune trame, quelle que soit la capture.
//   Les octets bruts sont dans
//   docs/superpowers/specs/2026-08-20-trames-invitation-groupe.md, et
//   test/appariement.test.js fige desormais le rapprochement.
//
// LE ZERO PROTOBUF NE S'ECRIT PAS, et c'est la limite du procede: un champ a
// zero est absent de la trame, donc de son empreinte. Un meme message peut
// ainsi porter deux empreintes selon la situation. Quand le doute existe, on
// inscrit les DEUX variantes plutot qu'une moyenne qui n'apparierait rien.
//
// RESOLUS le 08/09, gardes pour verifier qu'ils tiennent au patch suivant:
//   kfz -> jyv   kgt -> kcb   kgi -> kaq   kep -> kcs   kvw -> kth
//
// UNE EMPREINTE VIDE NE TRANCHE RIEN. jyj et jxy ne portent aucun champ, et
// c'est l'empreinte la plus repandue du flux — la session du 08/09 rendait 17
// candidats pour kgi. Pour ceux-la, l'outil degrossit et la CHRONOLOGIE decide:
// jyj suit de 2 a 39 ms un jzc portant l'identifiant de ce client (mesure du
// 27/08), et jxy part au moment ou l'on clique « Passer ».

const CATALOGUE = [
  // --- Passe-tour, deja remappe le 08/09 ------------------------------------
  { cle: 'jzc  debut de tour d un combattant', sens: 'entrant', empreinte: '1:varint,7:varint,8:varint' },
  { cle: 'jxh  fin de tour d un combattant',   sens: 'entrant', empreinte: '2:varint' },
  { cle: 'jyj  c est NOTRE tour',              sens: 'entrant', empreinte: '(vide)' },
  { cle: 'jxy  passer le tour',                sens: 'sortant', empreinte: '(vide)' },

  // --- Invitation de groupe, RESOLUE le 08/09 -------------------------------
  //
  //   ijz -> ikb   l invitation recue
  //   ijx -> ikg   l acceptation
  //
  // ET CE PATCH A FAIT MENTIR LE PRINCIPE MEME DE L APPARIEMENT. « Le patch
  // change les noms, pas la structure » a tenu pour 35 messages sur 35 le
  // 08/09 au matin — et pas pour celui-ci. ikb porte les MEMES numeros de
  // champ que ijz, mais 3 et 7 ont echange leurs types, et surtout les ROLES
  // ont bouge: l invitant passe du champ 2 au champ 1, le groupe du 5 au 6.
  //
  // C est pourquoi ijz n a rendu AUCUN candidat, alors que son empreinte
  // etait juste. Une empreinte muette ne prouve donc pas que le geste a
  // manque: elle peut aussi dire que la structure a bouge. Dans ce cas, seule
  // la CHRONOLOGIE retrouve le message — ce qu il a fallu faire ici.
  //
  // Empreintes d APRES le patch, pour le patch suivant. Les octets sont dans
  // test/fixtures/invitation-ikb.hex et -ikg.hex.
  { cle: 'ikb  invitation de groupe (ex ijz)',     sens: 'entrant', empreinte: '1:varint,2:varint,3:len,5:varint,6:varint,7:varint' },
  { cle: 'ikg  acceptation d invitation (ex ijx)', sens: 'sortant', empreinte: '1:varint' },

  // --- Songes, RESOLUS le 08/09 ---------------------------------------------
  //
  //   ixf -> ixm   le lancement       ixk -> ixo   l acceptation
  //   iyd -> ivj   l invitation       (son champ -300 passe du 2 au 3)
  //
  // L AMBIGUITE SUR ixf EST TRANCHEE: le spec du 29/08 disait { 1: {...} },
  // l en-tete de src/songes.js disait { 2: {...} }. La mesure donne
  // ixm { 1={1=1} } — le spec avait raison. Inscrire les deux variantes plutot
  // que choisir a coute une ligne et a evite de chercher au mauvais endroit.
  //
  // Empreintes d APRES le patch. Octets dans test/fixtures/songe-*.hex.
  { cle: 'ixm  lancement d un songe (ex ixf)',   sens: 'sortant', empreinte: '1:message' },
  { cle: 'ivj  invitation a un songe (ex iyd)',  sens: 'entrant', empreinte: '1:len,3:varint' },
  // MEME EMPREINTE QUE ikg, et tous deux sortants: l appariement ne les
  // separera jamais. Seule la chronologie le fera — espacer les deux gestes.
  { cle: 'ixo  acceptation de songe (ex ixk)',   sens: 'sortant', empreinte: '1:varint' },
];

module.exports = { CATALOGUE };
