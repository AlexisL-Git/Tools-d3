'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

// L'acceptation automatique de l'invitation a un Songe, et elle seule.
//
// LES TRAMES. Mesurees le 29/08 a 20:23 sur deux clients attaches, un songe
// lance par le maitre et accepte A LA MAIN sur la mule. Detail dans
// docs/superpowers/specs/2026-08-29-songes-design.md.
//
//   out request ixf { 1: {...} }   le maitre lance le songe
//   in  event   iyd { 1: <2o>, 2: -300 }   l'invitation, chez la mule
//   out request ixk { 1: 1 }       l'acceptation
//   in  event   jru { 2: carte }   la mule arrive dans le songe du maitre
//
// LA MULE N'A PAS BESOIN D'ENTRER DANS LA ZONE. Mesure: son rejeu de `iwo` a
// ete REFUSE (elle ne connaissait pas son skillInstanceUid pour l'element
// 539616), elle est restee sur place, et elle a rejoint le songe quand meme.
// Faire entrer les mules dans la zone serait du travail pour rien.
//
// LE FILTRE NE LIT PAS QUI INVITE, ET C'EST VOULU. Le champ 1 de `iyd` fait
// DEUX OCTETS: trop peu pour un identifiant de personnage, celui du maitre
// valant 676438999334. L'invitation ne nomme donc pas l'invitant. Mais elle
// arrive 34 ms apres le `ixf` d'un de nos propres clients, et celle d'un
// inconnu n'est precedee de rien. On filtre donc par le TEMPS: pas de
// lancement recent de chez nous, pas d'acceptation.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur, comme l'accepteur d'echange.

const TYPE_LANCEMENT = 'ixf';
const TYPE_INVITATION = 'iyd';
const URL_ACCEPTATION = 'type.ankama.com/ixk';

// Large devant les 34 ms mesures: absorbe un serveur lent sans ouvrir une
// fenetre ou l'invitation d'un inconnu aurait des chances d'etre confondue.
const FENETRE_SONGE = 10000;

// Meme raison que pour l'echange: une acceptation partie a la milliseconde ou
// l'invitation arrive n'est pas un comportement qu'un joueur produit.
const DELAI_REACTION = { minMs: 150, maxMs: 600 };

// Constante: l'acceptation ne recopie rien de l'invitation. Meme enveloppe que
// TRAME_ACCEPTATION de l'echange, a ceci pres qu'Any.value porte { 1: 1 }.
// uid = -1, comme toutes les requetes observees.
const TRAME_ACCEPTATION = encodeRaw([
  { no: 2, wire: WIRE.LEN, kind: 'message', value: [
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

    // Le lancement, par N'IMPORTE LEQUEL de nos clients: c'est l'application
    // qui pilote, la notion de maitre n'entre pas ici.
    if (dir === 'out' && frame.kind === 'request' && frame.type === TYPE_LANCEMENT) {
      dernierLancement = maintenant();
      return;
    }

    if (dir !== 'in' || frame.type !== TYPE_INVITATION) return;

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
  TYPE_LANCEMENT, TYPE_INVITATION,
};
