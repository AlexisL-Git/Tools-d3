'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

// L'acceptation automatique de l'invitation a un Songe, et elle seule.
//
// LES TRAMES. Mesurees le 29/08 a 20:23 sur deux clients attaches, un songe
// lance par le maitre et accepte A LA MAIN sur la mule. Detail dans
// docs/superpowers/specs/2026-08-29-songes-design.md.
//
// CES NOMS SONT CEUX D'AVANT LE PATCH 3.6.11.12. On ne recrit pas un journal
// cite: la correspondance etablie apres le patch est juste en dessous.
//
//   out request ixf { 2: {...} }   le maitre lance le songe
//   in  event   iyd { 1: <2o>, 2: -300 }   l'invitation, chez la mule
//   out request ixk { 1: 1 }       l'acceptation
//   in  event   jru { 2: carte }   la mule arrive dans le songe du maitre
//
// REMESURE LE 08/09 APRES LE PATCH 3.6.11.12, un songe lance par A et accepte
// a la main sur B, journal-groupe.log. Les octets sont dans
// test/fixtures/songe-ixm.hex, -ivj.hex et -ixo.hex.
//
//   out request ixm { 1: {1: 1} }        le maitre lance le songe
//   in  event   ivj { 1: <2o>, 3: -300 } l invitation, chez la mule
//   out request ixo { 1: 1 }             l acceptation
//
// LE CHAMP -300 A CHANGE DE NUMERO, 2 devient 3. Sans consequence ici: ce
// module ne lit aucun champ de l'invitation, il ne lit que son TYPE. Note
// quand meme, parce que le prochain qui voudra decoder ce message le cherchera.
//
// L'AMBIGUITE SUR ixm EST LEVEE. Le spec du 29/08 ecrivait { 1: {...} } et
// l'en-tete de ce module { 2: {...} }: l'un des deux se trompait. La mesure
// donne ixm { 1={1=1} } — le spec avait raison, ce fichier avait tort.
//
// VERIFIE EN JEU le 29/08 a 22:24, APRES le correctif — ce sont les lignes
// d'un vrai songe, maitre 29428 et mule 25460, pas un test:
//
//   1363493ms [29428] --> request ixf { 2={...} }        le maitre lance
//   1363527ms [29428] <-- event   jru { 2=237897728 }    il arrive dans le songe
//   1363529ms [25460] <-- event   iyd { 1=<2o> 2=-300 }  l'invitation, 2 ms apres
//   1363777ms [25460] songe : invitation acceptee apres 236 ms
//   1363806ms [25460] <-- event   jru { 2=237897728 }    LA MULE ARRIVE
//
// La carte de la mule est LA MEME que celle du maitre, et c'est le SERVEUR qui
// l'envoie: l'acceptation fabriquee ici est donc acceptee. Les deux hypotheses
// que le design portait sont levees — `ivj` EST l'invitation, et les octets de
// `ixo` sont les bons.
//
// LA MULE N'A PAS BESOIN D'ENTRER DANS LA ZONE. Mesure: son rejeu de `iwo` a
// ete REFUSE (elle ne connaissait pas son skillInstanceUid pour l'element
// 539616), elle est restee sur place, et elle a rejoint le songe quand meme.
// Faire entrer les mules dans la zone serait du travail pour rien.
//
// LE FILTRE NE LIT PAS QUI INVITE, ET C'EST VOULU. Le champ 1 de `ivj` fait
// DEUX OCTETS: trop peu pour un identifiant de personnage, celui du maitre
// valant 676438999334. L'invitation ne nomme donc pas l'invitant. Mais elle
// arrive 34 ms apres le `ixm` d'un de nos propres clients, et celle d'un
// inconnu n'est precedee de rien. On filtre donc par le TEMPS: pas de
// lancement recent de chez nous, pas d'acceptation.
//
// L'ARMEMENT NE LIT PAS reglages.actif, ET C'EST VOULU. Allumer
// l'interrupteur juste apres un songe lance a la main hors reglage herite
// donc d'une fenetre deja ouverte: la premiere invitation qui suit est
// acceptee. Sert le cas « j'allume en cours de route », qu'on ne veut pas
// punir d'un refus juste parce que l'interrupteur etait encore eteint au
// moment du lancement.
//
// LIMITE CONNUE. Si le client MAITRE (celui qui lance ou rejoint le songe)
// n'est pas lui-meme attache a OMNI, aucun ixm ni ixo sortant n'est jamais vu
// ici: dernierLancement ne s'arme jamais, et toutes les invitations sont
// refusees, meme legitimes.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur, comme l'accepteur d'echange.

const TYPE_LANCEMENT = 'ixm';
const TYPE_INVITATION = 'ivj';
// Le type de trame de l'acceptation, distinct de URL_ACCEPTATION (l'url
// complete portee DANS la trame): sert a reconnaitre un ixo SORTANT emis par
// un de nos clients, pour l armement -- voir plus bas.
const TYPE_ACCEPTATION = 'ixo';
const URL_ACCEPTATION = 'type.ankama.com/ixo';

// Decision utilisateur du 29/08, apres coup: 10 000 ms ramene a 2 000 ms.
// Toujours large devant les 34 ms mesures -- 60 fois la marge -- mais le
// songe est une activite de GROUPE: si un AUTRE joueur lance son propre songe
// peu apres le notre, la trame d'acceptation `ixo { 1: 1 }` ne designe aucune
// invitation en particulier et accepterait la sienne a la place. Reduire la
// fenetre reduit d'autant ce risque, sans mordre sur la marge de securite.
const FENETRE_SONGE = 2000;

// Meme raison que pour l'echange: une acceptation partie a la milliseconde ou
// l'invitation arrive n'est pas un comportement qu'un joueur produit.
const DELAI_REACTION = { minMs: 150, maxMs: 600 };

// Constante: l'acceptation ne recopie rien de l'invitation. Meme enveloppe que
// TRAME_ACCEPTATION de l'echange, a ceci pres qu'Any.value porte { 1: 1 }.
// uid = -1, comme toutes les requetes observees.
// L'ENVELOPPE EST EN CHAMP 1 DEPUIS LE PATCH, elle etait en champ 2 avant.
// Correction passee partout ailleurs le 08/09; ce module et src/invitation.js
// sont les deux qu elle n avait pas atteints. Une requete batie sur l ancien
// numero ne differe que par son PREMIER OCTET, 12 au lieu de 0a, et le serveur
// l ignore sans rien dire.
const TRAME_ACCEPTATION = encodeRaw([
  { no: 1, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'string', value: URL_ACCEPTATION },
      { no: 2, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.VARINT, value: 1n },
      ] },
    ] },
    { no: 2, wire: WIRE.VARINT, value: -1n },
  ] },
]);

// superviseur   — porte emettre(pid, octets) et comptes.get(pid)
// reglages      — { actif }, RELU a chaque trame pour que l'interrupteur
//                 unique prenne effet aussitot
// onCompteRendu — recoit ce qui a ete emis, ou refuse et pourquoi
// delai         — { minMs, maxMs } ou null pour emettre pendant l'appel. Null
//                 par defaut: le comportement inerte est celui qu'on obtient
//                 sans rien demander. Seul desktop/main.js demande le delai.
// alea, planifier, maintenant — injectes pour que le delai et la fenetre se
//                 testent sans dormir.
function creerAccepteurSonge({
  superviseur, reglages, onCompteRendu = () => {},
  delai = null, alea = Math.random, planifier = setTimeout, maintenant = Date.now,
}) {
  // 0 veut dire « jamais »: aucune horloge ne rend 0, et la comparaison de
  // fenetre le rejetterait de toute facon.
  let dernierLancement = 0;

  // Relu A L'ECHEANCE, pas a l'armement: entre les deux, l'utilisateur a pu
  // eteindre, le client se fermer, et Windows reattribuer le pid a un AUTRE
  // client Dofus. On compare donc l'IDENTITE de l'objet d'etat -- meme garde
  // que src/echange.js et src/passeur.js.
  const emettre = (pid, etatArme, retardMs) => {
    const etat = superviseur.comptes.get(pid);
    if (!reglages.actif || etat === null || etat === undefined || etat !== etatArme) return;
    const res = superviseur.emettre(pid, TRAME_ACCEPTATION);
    onCompteRendu({ pid, ok: res.ok, raison: res.raison, octets: res.octets, retardMs });
  };

  return function onTrame({ pid, dir, frame }) {
    if (frame === null || frame === undefined) return;

    // Le lancement (ixm), par N'IMPORTE LEQUEL de nos clients: c'est
    // l'application qui pilote, la notion de maitre n'entre pas ici.
    //
    // TYPE_ACCEPTATION (ixo) arme aussi. REJOINDRE le songe d'un autre ne
    // passe pas par ixm: seul celui qui LANCE l'emet. Sans cette entree, un
    // utilisateur qui rejoint le songe d'un tiers (son maitre emet ixo, pas
    // ixm) verrait ses propres mules refuser l'invitation qui suit -- alors
    // qu'il attend qu'elles le suivent, comme pour un songe lance par lui.
    //
    // PAS DE RISQUE DE BOUCLE: les trames qu'OMNI injecte via
    // superviseur.emettre() sont ecrites directement sur la socket amont et
    // ne repassent pas par l'ecoute qui alimente onTrame. Le TRAME_ACCEPTATION
    // qu'une mule emet ici ne se voit donc jamais reinjectee dans ce onTrame.
    if (dir === 'out' && frame.kind === 'request'
        && (frame.type === TYPE_LANCEMENT || frame.type === TYPE_ACCEPTATION)) {
      dernierLancement = maintenant();
      return;
    }

    // Meme exigence de kind que l'armement: ivj mesuree est un event, et une
    // eventuelle response de meme type ne doit pas etre prise pour
    // l'invitation.
    if (dir !== 'in' || frame.kind !== 'event' || frame.type !== TYPE_INVITATION) return;

    // Une invitation a un songe est un evenement rare: dire pourquoi on ne
    // l'accepte pas ne coute rien et repond a la seule question que
    // l'utilisateur se pose.
    const refus = (raison) => onCompteRendu({ pid, ok: false, raison });

    if (!reglages.actif) return refus('songe ignore : interrupteur eteint');
    const etat = superviseur.comptes.get(pid);
    if (etat === null || etat === undefined) return refus('songe ignore : compte inconnu du superviseur');

    if (dernierLancement === 0 || maintenant() - dernierLancement > FENETRE_SONGE) {
      return refus('songe refuse : aucun lancement de songe par nos clients');
    }

    if (delai === null) return emettre(pid, etat, 0);
    const retardMs = delai.minMs + Math.floor(alea() * (delai.maxMs - delai.minMs + 1));
    planifier(() => emettre(pid, etat, retardMs), retardMs);
  };
}

module.exports = {
  creerAccepteurSonge, TRAME_ACCEPTATION, DELAI_REACTION, FENETRE_SONGE,
  TYPE_LANCEMENT, TYPE_INVITATION, TYPE_ACCEPTATION,
};
