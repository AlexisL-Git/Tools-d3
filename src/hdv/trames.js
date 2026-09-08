'use strict';
const { encodeRaw, decodeRaw, WIRE } = require('../codec/rawProto');

// Les trames de l'hotel de vente: ce qu'on emet, ce qu'on lit.
//
// Mesure du 01/09, docs/superpowers/specs/2026-09-01-trames-hdv.md. Chaque
// requete construite ici reproduit OCTET POUR OCTET celle que le jeu emet quand
// l'utilisateur fait le geste a la main; les tests les figent.
//
// CE MODULE EST LA RUPTURE AVEC LE RESTE D'OMNI. TRAME_PASSE, TRAME_ACCEPTATION
// et TRAME_VALIDATION sont des constantes: elles ne recopient rien de la
// situation, on les construit une fois pour toutes. Ici chaque `kch` porte un
// uid, un prix et une taille differents — il faut donc construire a chaque coup.
//
// Fonctions pures: ni Electron, ni Frida, ni reseau.
//
// REMAPPE LE 08/09, patch 3.6.11.12. Les noms d'aout ci-dessous sont ceux qui
// figurent encore dans les commentaires; voici leur equivalent courant, mesure
// sur une session ou l'hotel a ete ouvert, un objet cherche, cinq lots poses et
// un retire. Les NUMEROS DE CHAMPS ont bouge autant que les noms:
//
//   keh -> kde   abonnement       gid 1 -> 2, drapeau 2 -> 1
//   kbz -> kbk   stats            gid 1 -> 2
//   kge -> kcr   mise en vente    prix 1 -> 2, pile 2 -> 3, taille 3 -> 1
//   kgp -> kef   prix du marche   prix 2 -> 4, gid 5 -> 1, categorie 6 -> 3
//   kbt -> jzn   stats de prix    gid 2 -> 1, detail 3 -> 2, categorie 1 -> 3
//   kes -> kda   lot pose         objet 1 -> 3, prix 2 -> 5, duree 4 -> 2
//   ken -> kco   lot retire       inchange
//   kch -> kas   maj de prix      uid 1 -> 2, prix 2 -> 1, taille inchangee
//   kby -> ket   nos ventes       liste 1 -> 2, objet 2 -> 1, prix 3 -> 2,
//                                 duree 4 -> 3
//   dans le lot: gid 3 -> 2, taille 4 -> 3
//
// Les messages d'inventaire (ivx, iwb, ivj, ium, ivi) n'ont pas ete remesures
// non plus: ils ne passent pas par l'hotel de vente.

const TAILLES = [1, 10, 100, 1000];

// La position d'une pile. 63 est l'inventaire, c'est-a-dire « pas equipe ».
// LE ZERO PROTOBUF NE S'ECRIT PAS: un champ 1 absent vaut 0, l'amulette, et
// surtout PAS 63. Mesure du 03/09: sur 471 piles, une seule est dans ce cas.
const POSITION_INVENTAIRE = 63;

// Le rangement a portee de main. Voir rangementDe() plus bas: la banque est le
// 2, un troisieme rangement le 3, et l'absence de rangement vaut l'inventaire.
const RANGEMENT_INVENTAIRE = 1;

// --- Ce qu'on emet -------------------------------------------------------

// L'enveloppe commune a toutes les requetes observees: request { content:
// Any{ type_url, value }, uid: -1 }. Un Any.value VIDE ne s'ecrit pas — c'est
// ce qui distingue keh d'abonnement et keh de desabonnement.
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

// kch { 1: uid du LOT EN VENTE, 2: prix DU LOT, 3: taille du lot }
//
// L'uid est celui rendu par kes, PAS celui d'une pile d'inventaire. Le prix est
// celui du lot entier, pas de l'unite: 1222 pour 100 unites, 122 pour 10.
//
// Le champ 3 a longtemps ete ambigu: la premiere mesure portait sur un lot de 1
// et donnait 3=1, indiscernable d'un drapeau. Une seconde mesure sur un lot de
// 100 a donne 3=100. Deux valeurs distinctes, ambiguite levee.
function trameMajPrix({ uid, prix, taille }) {
  return requete('kas', [v(1, prix), v(2, uid), v(3, taille)]);
}

// keh { 1: gid, 2: 1 } — s'abonner au marche d'un objet.
//
// Tant qu'on est abonne, le serveur POUSSE un kgp a chaque mouvement du marche
// sur ce gid, sans qu'on demande rien. C'est ce qui rend la passe possible: on
// relit les prix apres chaque envoi sans avoir a les redemander.
function trameAbonner(gid) {
  return requete('kde', [v(1, 1), v(2, gid)]);
}

// keh { 1: gid } — se DESABONNER. Le meme message, sans le champ 2.
//
// C'est le zero protobuf, qui ne s'ecrit pas: meme regle que le champ 3 de kgt
// dans l'echange, ou son absence disait « X a decoche ». Sans ce message, le
// flux pousse reste ouvert apres la passe.
function trameDesabonner(gid) {
  return requete('kde', [v(2, gid)]);
}

// kbz { 1: gid } — demander les statistiques de prix. Emise dans la meme
// milliseconde que l'abonnement par le jeu; la reponse est un kbt avec champ 3.
function trameStats(gid) {
  return requete('kbk', [v(2, gid)]);
}

// kge { 1: prix DU LOT, 2: uid de la PILE, 3: taille du lot }
//
// LE CHAMP 2 EST L'UID D'UNE PILE, pas celui d'un lot en vente: c'est ce qui
// distingue kge de kch. Prouve par deux poses consecutives sur la meme pile,
// meme valeur au champ 2 et deux quantites differentes.
//
// LES DEUX ORIGINES MARCHENT. Une pile d'inventaire et une pile de banque ont
// ete posees le 01/09, toutes deux acceptees: il n'y a donc rien a retirer de
// la banque avant de vendre.
function trameMettreEnVente({ prix, uidPile, taille }) {
  return requete('kcr', [v(1, taille), v(2, prix), v(3, uidPile)]);
}

// --- Ce qu'on lit --------------------------------------------------------

const champ = (payload, no) => (payload || []).find((f) => f.no === no) || null;

function entier(payload, no) {
  const f = champ(payload, no);
  if (f === null || f.wire !== WIRE.VARINT) return null;
  return Number(f.value);
}

// LES QUATRE PRIX SONT DES VARINTS EMPAQUETES, et ils se lisent par `raw`.
//
// rawProto.js:60 avertit qu'un champ LEN est ambigu par construction: une
// chaine, un sous-message et une suite d'octets quelconque sont indiscernables
// sans schema, et le decodeur DEVINE. La meme suite de prix peut donc tomber en
// 'bytes' pour un objet et en 'message' pour un autre, selon les valeurs.
// `raw` porte toujours les octets exacts, quel que soit le kind devine — c'est
// exactement le piege qui avait fait refuser a tort des chemins de deplacement.
function varintsPackes(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  const out = [];
  let i = 0;
  while (i < buf.length) {
    let valeur = 0n;
    let decalage = 0n;
    let complet = false;
    while (i < buf.length) {
      const octet = buf[i];
      i += 1;
      valeur |= BigInt(octet & 0x7f) << decalage;
      if ((octet & 0x80) === 0) { complet = true; break; }
      decalage += 7n;
      if (decalage > 63n) return null;
    }
    if (!complet) return null;
    out.push(Number(valeur));
  }
  return out;
}

// Exactement quatre valeurs, ou rien. Un tableau plus court voudrait dire qu'on
// n'a pas compris la trame, et decider sur trois prix poserait au mauvais
// creneau.
function quatrePrix(f) {
  if (f === null) return null;
  const prix = varintsPackes(f.raw);
  if (prix === null || prix.length !== TAILLES.length) return null;
  return prix;
}

// kgp { 2: [p1, p10, p100, p1000], 3: cle de marche, 5: gid, 6: categorie }
//
// Pousse par le serveur a chaque mouvement du marche sur un gid abonne. C'est la
// trame centrale de la fonction: chaque case bouge quand et seulement quand on
// touche a CE lot-la. Un 0 signifie « aucun concurrent a cette taille », jamais
// « gratuit ».
function lirePrixMarche(frame) {
  if (!frame || frame.type !== 'kef') return null;
  const prix = quatrePrix(champ(frame.payload, 4));
  if (prix === null) return null;
  const gid = entier(frame.payload, 1);
  if (gid === null) return null;
  return { gid, categorie: entier(frame.payload, 3), prix };
}

// kbt { 1: categorie, 2: gid, 3: { 6: [les quatre prix] } }
//
// LE CHAMP 3 EST CE QUI DISTINGUE LES DEUX kbt. Avec lui, c'est la reponse a
// kbz. Sans lui, c'est l'accuse du desabonnement du gid PRECEDENT — et il
// arrive juste avant la vraie reponse. Le lire comme des statistiques ferait
// decider sur un tableau absent.
function lireStatsPrix(frame) {
  if (!frame || frame.type !== 'jzn') return null;
  const detail = champ(frame.payload, 2);
  if (detail === null || detail.kind !== 'message') return null;
  const prix = quatrePrix(champ(detail.value, 6));
  if (prix === null) return null;
  const gid = entier(frame.payload, 1);
  if (gid === null) return null;
  return { gid, categorie: entier(frame.payload, 3), prix };
}

// Un lot, tel qu'il apparait dans kby et dans kes. Les deux portent la meme
// forme a un numero de champ pres — c'est ce qui a prouve que kby EST notre
// liste de ventes, et pas un catalogue.
function lireLot(objet, prix, duree) {
  if (objet === null || objet.kind !== 'message') return null;
  const uid = entier(objet.value, 1);
  const gid = entier(objet.value, 2);
  const taille = entier(objet.value, 3);
  if (uid === null || gid === null || taille === null || prix === null) return null;
  return { uid, gid, taille, prix, duree };
}

// kby { 1: [ { 2: {uid, gid, taille}, 3: prix, 4: duree } ] }
//
// Emise UNE SEULE FOIS, a l'ouverture de l'hotel de vente. C'est pour cela que
// le sequenceur doit ecouter en permanence: un module qui ne se reveillerait
// qu'au clic du bouton aurait deja rate la seule trame qui dit ce qu'on vend.
//
// Validee a 376 lots contre le compteur affiche en jeu au meme instant.
function lireNosLots(frame) {
  if (!frame || frame.type !== 'ket') return [];
  const lots = [];
  for (const el of frame.payload || []) {
    if (el.no !== 2 || el.kind !== 'message') continue;
    const lot = lireLot(champ(el.value, 1), entier(el.value, 2), entier(el.value, 3));
    if (lot !== null) lots.push(lot);
  }
  return lots;
}

// UNE PILE, telle qu'elle apparait dans ivx comme dans iwb: la meme forme, au
// numero de champ de l'element pres.
//
//   { 1: <position>, 5: { 1: gid, 2: <effets>…, 3: quantite, 4: uid } }
//
// LE CHAMP 2 DU DETAIL DIT QUE L'OBJET PORTE DES EFFETS. Il ne dit PAS que
// c'est un equipement, et les confondre coute cher: 57 des 814 piles de banque
// mesurees le portent, dont 52 a quantite superieure a 1 et jusqu'a 1349
// exemplaires — des consommables ou des runes, empilables. Seul l'inventaire
// est majoritairement de l'equipement, 179 de ses 204 piles a effets etant a
// quantite 1.
//
// Ce qu'on en tire est donc « cet objet a des effets », et rien de plus. Une
// RESSOURCE n'en a pas: c'est ce qui rend le champ utilisable pour garder
// exactement ce que l'hotel de vente ressources accepte, en ecartant du meme
// coup les equipements ET les consommables, qui relevent d'autres hotels. Sans
// ce tri il faudrait demander la categorie de chaque GID, un aller-retour par
// objet.
//
// LE CHAMP 5 DU DETAIL DIT D'OU VIENT LA PILE: { 1: page, 2: rangement }.
//
// Il n'apparait QUE dans la reponse a `itr`, jamais dans l'`ivx` de connexion
// ni dans `iwb` -- mesure du 04/09, detaillee dans src/pda-archi/collection.js.
// `null` veut donc dire deux choses a la fois: soit la trame ne le porte pas,
// soit c'est l'equipement porte. Les deux se traitent pareil, ils sont a
// portee de main.
//
//   1  l'inventaire        2  la banque        3  un troisieme
function rangementDe(detail) {
  const f = champ(detail, 5);
  if (f === null) return null;
  let bloc = null;
  if (Array.isArray(f.value)) bloc = f.value;
  else {
    const brut = Buffer.isBuffer(f.raw) ? f.raw : (Buffer.isBuffer(f.value) ? f.value : null);
    if (brut === null) return null;
    try {
      const d = decodeRaw(brut);
      bloc = d.length > 0 ? d : null;
    } catch (e) { return null; }
  }
  return bloc === null ? null : entier(bloc, 2);
}

function lirePile(el) {
  if (el.kind !== 'message') return null;
  const detail = champ(el.value, 5);
  if (detail === null || detail.kind !== 'message') return null;
  const gid = entier(detail.value, 1);
  const qte = entier(detail.value, 3);
  const uid = entier(detail.value, 4);
  if (gid === null || qte === null || uid === null) return null;
  const avecEffets = (detail.value || []).some((f) => f.no === 2);
  const p = entier(el.value, 1);
  const rangement = rangementDe(detail.value);
  return { uid, gid, qte, avecEffets, pos: p === null ? 0 : p, rangement };
}

// ivx { 3: [ pile ] } — l'inventaire, et l'inventaire + la banque quand le
// client a demande les deux rangements. iwb { 1: [ pile ] } — la banque seule,
// a l'ouverture chez le banquier.
//
// LE CLIENT EMET LA DEMANDE LUI-MEME (itr) en ouvrant le panneau de vente:
// OMNI n'a rien a demander, il lui suffit d'ecouter.
function lireStock(frame) {
  if (!frame) return [];
  let no = null;
  if (frame.type === 'ivx') no = 3;
  else if (frame.type === 'iwb') no = 1;
  if (no === null) return [];
  const piles = [];
  for (const el of frame.payload || []) {
    if (el.no !== no) continue;
    const pile = lirePile(el);
    if (pile !== null) piles.push(pile);
  }
  return piles;
}

// ivj { 3: { 2: uid de la pile, 3: quantite restante } } — la pile a ete
// entamee. C'est L'UNE DES DEUX SEULES CONFIRMATIONS d'un kge qui nous
// appartienne: kes arrive aussi pour les lots des autres joueurs.
function lirePileMaj(frame) {
  if (!frame || frame.type !== 'ivj') return null;
  const detail = champ(frame.payload, 3);
  if (detail === null || detail.kind !== 'message') return null;
  const uid = entier(detail.value, 2);
  const qte = entier(detail.value, 3);
  if (uid === null || qte === null) return null;
  return { uid, qte };
}

// ium { 1: uid } — la pile a disparu. Elle sert deux fois: une pile posee au
// sol, et une pile videe par une vente. C'est la disparition d'une pile,
// quelle qu'en soit la cause.
function lirePileDisparue(frame) {
  if (!frame || frame.type !== 'ium') return null;
  return entier(frame.payload, 1);
}

// kes { 1: {uid, gid, taille}, 2: prix, 4: duree }
//
// LE LOT REND UN UID NEUF. Une mise a jour est un retrait suivi d'une repose:
// le serveur envoie ken avec l'ancien uid, puis kes avec un uid different.
// Mesure: kch sur 1768695 a produit kes sur 1768822. Le sequenceur doit donc
// remplacer l'uid dans sa liste au fil de la passe.
//
// Le champ 4 vaut 2 419 200 secondes, soit exactement 28 jours.
function lireLotPose(frame) {
  if (!frame || frame.type !== 'kda') return null;
  return lireLot(champ(frame.payload, 3), entier(frame.payload, 5), entier(frame.payload, 2));
}

// ken { 1: uid } — ce lot a quitte la vente.
//
// ATTENTION: il arrive AUSSI pour les lots des autres joueurs tant qu'on est
// abonne au gid. Plusieurs dizaines ont ete observees sans qu'on ait rien fait.
// L'appelant doit verifier que l'uid est bien un des siens.
function lireLotRetire(frame) {
  if (!frame || frame.type !== 'kco') return null;
  return entier(frame.payload, 1);
}

// ivi { 2: [ { 1: gid, 2: prixMoyenUnitaire } ] }
//
// 9861 paires, 90 Ko, livrees UNE FOIS au login. C'est la table complete des
// prix moyens du serveur: le garde-fou anti-extrapolation de prix.js n'a donc
// besoin d'aucun aller-retour, quelle que soit la ressource.
//
// Verifiee sur cinq objets: les valeurs d'ivi et celles que kcq.4 a rendues
// plus tard au HDV coincident exactement.
function lirePrixMoyens(frame) {
  const table = new Map();
  if (!frame || frame.type !== 'ivi') return table;
  for (const el of frame.payload || []) {
    if (el.no !== 2 || el.kind !== 'message') continue;
    const gid = entier(el.value, 1);
    const prix = entier(el.value, 2);
    if (gid !== null && prix !== null) table.set(gid, prix);
  }
  return table;
}

module.exports = {
  TAILLES, POSITION_INVENTAIRE, RANGEMENT_INVENTAIRE,
  trameMajPrix, trameAbonner, trameDesabonner, trameStats, trameMettreEnVente,
  lirePrixMarche, lireStatsPrix, lireNosLots, lireLotPose, lireLotRetire, lirePrixMoyens,
  lireStock, lirePile, lirePileMaj, lirePileDisparue,
  varintsPackes,
};
