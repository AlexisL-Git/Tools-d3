'use strict';

// Le catalogue des messages a retrouver apres un patch: pour chacun, son
// EMPREINTE structurelle. Voir appariement.js pour le mecanisme.
//
// CE FICHIER EST SEPARE DE L'OUTIL POUR UNE SEULE RAISON: pouvoir etre teste.
// Une empreinte fausse ne casse rien, n'echoue nulle part, et rend simplement
// « aucun candidat » — l'outil accuse alors la MESURE (« le geste a-t-il ete
// fait ? ») alors que la faute est ici. Une seance de capture perdue.
//
// REGLE POUR AJOUTER UNE ENTREE: calculer l'empreinte avec empreinte() SUR LES
// OCTETS REELS de la trame, jamais d'apres le commentaire qui la decrit. Les
// deux divergent, et c'est mesure: la premiere entree `ijz` portait TROIS
// champs (1, 2 et 5), les seuls que le commentaire de src/invitation.js
// nommait utilement, la ou la trame en porte six.
//
// LE ZERO PROTOBUF NE S'ECRIT PAS, et c'est la limite du procede: un champ a
// zero est absent de la trame, donc de son empreinte. Un meme message peut
// ainsi porter deux empreintes selon la situation. Quand le doute existe, on
// inscrit les DEUX variantes plutot qu'une moyenne qui n'apparierait rien.
//
// RESOLUS le 08/09, gardes pour verifier qu'ils tiennent au patch suivant:
//   kfz -> jyv   kgt -> kcb   kgi -> kaq   kep -> kcs   kvw -> kth
//   jyj -> juu   jxy -> jvv   jxh -> jvn   jzc -> jxl   (le passe-tour)
//   ijz -> ikb   ijx -> ikg                             (l invitation)
//   ixf -> ixm   iyd -> ivj   ixk -> ixo                (les songes)
//
// UNE EMPREINTE VIDE NE TRANCHE RIEN. jyj et jxy ne portent aucun champ, et
// c'est l'empreinte la plus repandue du flux — la session du 08/09 rendait 17
// candidats pour kgi. Pour ceux-la, l'outil degrossit et la CHRONOLOGIE decide.

const CATALOGUE = [
  // --- Passe-tour, RESOLU le 08/09 ------------------------------------------
  //
  // Le bloc reste, avec les empreintes d'AVANT le patch: il sert de temoin au
  // patch suivant, pas de piste ouverte. Ne pas relire ses candidats comme une
  // question encore posee — c'etait le cas jusqu'au 08/09 au soir.
  { cle: 'jzc  debut de tour d un combattant', sens: 'entrant', empreinte: '1:varint,7:varint,8:varint' },
  { cle: 'jxh  fin de tour d un combattant',   sens: 'entrant', empreinte: '2:varint' },
  { cle: 'jyj  c est NOTRE tour',              sens: 'entrant', empreinte: '(vide)' },
  { cle: 'jxy  passer le tour',                sens: 'sortant', empreinte: '(vide)' },

  // --- Invitation de groupe, RESOLUE le 08/09 au soir -----------------------
  //
  // Empreintes d'APRES le patch. Elles portent la lecon de ce remappage:
  // L'EMPREINTE SEULE N'A PAS TROUVE `ikb`. Les six champs ont PERMUTE — la
  // chaine est passee du 7 au 3 — donc l'empreinte d'avant ne correspondait a
  // aucune trame reelle, et l'outil a repondu « aucun candidat » sur une
  // capture qui contenait pourtant l'invitation.
  //
  //   role                    avant   apres
  //   l invitant                2   ->   1
  //   la constante 1            6   ->   2
  //   le nom de l invitant      7   ->   3
  //   la constante 8            3   ->   5
  //   l identifiant de groupe   5   ->   6
  //   le destinataire, nous     1   ->   7
  //
  // DEUX METHODES L'ONT TROUVEE, SEPAREMENT ET LE MEME SOIR, ce qui vaut
  // confirmation croisee — deux mesures independantes, un seul resultat.
  //
  //   la CORRELATION DE VALEURS (Alexis): un seul entrant de toute la session
  //   porte DEUX characterId connus a son premier niveau, appris des trames
  //   `kth` de chaque client. Ses occurrences portent le meme champ 1 (le
  //   maitre) et un champ 7 different, egal au characterId du client qui la
  //   recoit: l invitant et le destinataire, sans ambiguite.
  //
  //   la CHRONOLOGIE: `ikb` arrive 30 ms avant l acceptation manuelle, et
  //   `ikg` porte exactement l identifiant de groupe que `ikb` annonce.
  //
  // `ikg` etait noye parmi dix candidats pour une empreinte `1:varint`, qui ne
  // tranche jamais seule.
  { cle: 'ikb  invitation de groupe (ex ijz)',     sens: 'entrant', empreinte: '1:varint,2:varint,3:len,5:varint,6:varint,7:varint' },
  { cle: 'ikg  acceptation d invitation (ex ijx)', sens: 'sortant', empreinte: '1:varint' },

  // --- Songes, RESOLUS le 08/09 au soir -------------------------------------
  //
  //   ixf -> ixm   le lancement       ixk -> ixo   l acceptation
  //   iyd -> ivj   l invitation       (son champ -300 passe du 2 au 3)
  //
  // L'AMBIGUITE SUR ixf ETAIT DANS NOS PROPRES NOTES: le spec du 29/08 ecrivait
  // { 1: {...} }, l en-tete de src/songes.js { 2: {...} }. La mesure donne
  // ixm { 1={1=1} } — le spec avait raison. Inscrire les deux variantes plutot
  // que choisir a coute une ligne et evite de chercher au mauvais endroit.
  //
  // Empreintes d'APRES le patch. Octets dans test/fixtures/songe-*.hex.
  { cle: 'ixm  lancement d un songe (ex ixf)',   sens: 'sortant', empreinte: '1:message' },
  { cle: 'ivj  invitation a un songe (ex iyd)',  sens: 'entrant', empreinte: '1:len,3:varint' },
  // MEME EMPREINTE QUE ikg, et tous deux sortants: l appariement ne les
  // separera jamais. Seule la chronologie le fera — espacer les deux gestes
  // pendant la mesure, et noter l instant de chacun.
  { cle: 'ixo  acceptation de songe (ex ixk)',   sens: 'sortant', empreinte: '1:varint' },
];

module.exports = { CATALOGUE };
