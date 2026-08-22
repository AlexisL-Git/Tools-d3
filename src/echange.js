'use strict';
const { encodeRaw, decodeFrameRaw, remplacerChamp, WIRE } = require('./codec/rawProto');

// L'acceptation automatique de l'echange entre joueurs, et elle seule.
//
// LES TRAMES. Mesurees le 22/08 sur deux clients attaches: quatre echanges
// dans les deux sens, plus un avec un joueur tiers. Le detail et les octets
// bruts sont dans docs/superpowers/specs/2026-08-22-trames-echange.md.
//
//   in  event   kfz { 1: proposant, 2: cible, 4: 1 }   RECUE PAR LES DEUX
//   out request kgi { }                                l'acceptation
//   in  event   kgt { 3: 1, 4: qui a coche }           RECUE PAR LES DEUX
//   out request kep { 1: 1, 2: 1 }                     la validation
//
// LE PROPOSANT EST AU CHAMP 1 — l'inverse de `ijz`, ou le champ 1 portait le
// destinataire. Prouve par inversion des roles sur quatre echanges: le champ 1
// bascule avec le role, le champ 2 porte la cible. Un filtre bati sur le
// champ 2 aurait fait accepter au proposant SA PROPRE proposition, puisque
// `kfz` arrive chez les deux parties.
//
// LE CHAMP 3 DE `kgt` N'EST PAS DECORATIF. Present et valant 1, il dit « X a
// coche »; ABSENT, il dit « X a decoche » — c'est le zero protobuf, qui ne
// s'ecrit pas. A la conclusion de chaque echange le serveur envoie deux `kgt`
// sans champ 3 pour remettre les coches a zero. Les traiter comme des
// validations ferait emettre un `kep` sur un echange deja ferme.
//
// LE FILTRE. Un echange n'est accepte que si le proposant est un AUTRE client
// pilote par l'application. Les characterId sont appris du trafic, donc connus
// sans configuration. Sans ce filtre, n'importe quel joueur ouvrant un echange
// avec un esclave le verrait valider des qu'il coche. Le filtre ecarte aussi
// notre propre validation, qui nous revient en `kgt` avec notre identifiant.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur, comme l'accepteur d'invitation.

const TYPE_PROPOSITION = 'kfz';
const TYPE_PARTENAIRE_PRET = 'kgt';
const CHAMP_PROPOSANT = 1;
const CHAMP_PRET = 3;
const CHAMP_VALIDANT = 4;
const URL_ACCEPTATION = 'type.ankama.com/kgi';
const URL_VALIDATION = 'type.ankama.com/kep';

// Les deux requetes sont CONSTANTES: elles ne recopient rien de l'echange en
// cours. On les construit une fois pour toutes, comme TRAME_PASSE.
const TRAME_ACCEPTATION = encodeRaw([
  { no: 2, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'string', value: URL_ACCEPTATION },
      // Pas de champ 2: Any.value est vide, et un champ vide ne s'ecrit pas.
    ] },
    // uid = -1, comme toutes les requetes observees.
    { no: 2, wire: WIRE.VARINT, value: -1n },
  ] },
]);

const TRAME_VALIDATION = encodeRaw([
  { no: 2, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'string', value: URL_VALIDATION },
      { no: 2, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.VARINT, value: 1n },
        { no: 2, wire: WIRE.VARINT, value: 1n },
      ] },
    ] },
    { no: 2, wire: WIRE.VARINT, value: -1n },
  ] },
]);

// Delai de reaction avant d'emettre. Une acceptation partie a la milliseconde
// ou la proposition arrive n'est pas un comportement qu'un joueur produit --
// meme raisonnement que l'etalement du rejeu. 150 a 600 ms est le temps qu'il
// faut a quelqu'un pour voir une fenetre, viser et cliquer.
const DELAI_REACTION = { minMs: 150, maxMs: 600 };

const champ = (frame, no) => (frame.payload || []).find((f) => f.no === no) || null;

// Les characterId de nos AUTRES clients. Notre propre identifiant n'en fait
// jamais partie: il designe le destinataire, pas un proposant.
function autresNotres(superviseur, pid) {
  return superviseur.comptes.tous
    .filter((e) => e.pid !== pid && e.characterId !== null && e.characterId !== undefined)
    .map((e) => e.characterId);
}

// Champ 4 de kfz: constant a 1 sur les quatre echanges mesures, dans une trame
// qui declenche une demande de confirmation. Hypothese: c'est le drapeau
// « demander confirmation ». A zero, le client preparerait l'echange sans
// poser la question -- et sans afficher la boite qui reste sinon a l'ecran.
// SONDE, pas une certitude: le champ 4 peut aussi bien etre un type
// d'echange, auquel cas le mettre a zero casse autre chose.
const CHAMP_CONFIRMATION = 4;

// Rend les octets de remplacement de la proposition d'echange, ou null pour
// laisser la trame intacte. Dans le doute on relaie: une trame qu'on n'a pas
// su lire, ou qui n'est pas la proposition, n'est jamais reecrite.
function reecrireProposition(brute) {
  let frame = null;
  try { frame = decodeFrameRaw(brute); } catch (e) { return null; }
  if (frame === null || frame.type !== TYPE_PROPOSITION) return null;
  try { return remplacerChamp(brute, CHAMP_CONFIRMATION, 0n); }
  catch (e) { return null; }
}

// superviseur   — porte emettre(pid, octets), comptes.get(pid) et comptes.tous
// reglages      — { actif }, RELU a chaque trame pour que l'interrupteur
//                 general prenne effet aussitot
// onCompteRendu — recoit ce qui a ete emis, ou refuse et pourquoi
// delai         — { minMs, maxMs } pour differer l'emission, ou null pour
//                 emettre pendant l'appel. Null par defaut, comme
//                 etalementRejeu du superviseur: le comportement inerte est
//                 celui qu'on obtient sans rien demander. Seul desktop/main.js
//                 demande le delai.
// alea, planifier — injectes pour que le delai se teste sans dormir.
function creerAccepteurEchange({
  superviseur, reglages, onCompteRendu = () => {},
  delai = null, alea = Math.random, planifier = setTimeout,
}) {
  // Relu A L'ECHEANCE, pas a l'armement: entre les deux, l'utilisateur a pu
  // decocher, le client se fermer, et Windows reattribuer le pid a un AUTRE
  // client Dofus. On compare donc l'IDENTITE de l'objet d'etat, pas seulement
  // le pid -- meme garde que src/passeur.js, pour la meme raison.
  const emettre = (pid, etatArme, trame, validation, retardMs) => {
    const etat = superviseur.comptes.get(pid);
    if (!reglages.actif || etat === null || etat === undefined
        || etat !== etatArme || !etat.accepteEchange) return;
    const res = superviseur.emettre(pid, trame);
    onCompteRendu({ pid, ok: res.ok, raison: res.raison, octets: res.octets, validation, retardMs });
  };

  return function onTrame({ pid, dir, frame }) {
    if (dir !== 'in' || frame === null || frame === undefined) return;
    if (frame.type !== TYPE_PROPOSITION && frame.type !== TYPE_PARTENAIRE_PRET) return;

    // Un echange est un evenement rare: dire pourquoi on ne l'accepte pas ne
    // coute rien et repond a la seule question que l'utilisateur se pose.
    const refus = (raison) => onCompteRendu({ pid, ok: false, raison });

    if (!reglages.actif) return refus('echange ignore : interrupteur general eteint');
    const etat = superviseur.comptes.get(pid);
    if (etat === null || etat === undefined) return refus('echange ignore : compte inconnu du superviseur');
    if (!etat.accepteEchange) return refus('echange ignore : acceptation eteinte pour ce compte');

    const pret = frame.type === TYPE_PARTENAIRE_PRET;
    // kgt ne vaut validation QUE si le champ 3 est present et vaut 1. Absent,
    // il annonce une coche qui retombe -- ce que le serveur envoie deux fois,
    // une par partie, a la conclusion de chaque echange.
    if (pret) {
      const coche = champ(frame, CHAMP_PRET);
      if (coche === null || coche.value !== 1n) return;
    }

    const qui = champ(frame, pret ? CHAMP_VALIDANT : CHAMP_PROPOSANT);
    if (qui === null) return refus(`echange refuse : aucun ${pret ? 'validant' : 'proposant'} dans la trame`);
    if (!autresNotres(superviseur, pid).some((id) => id === qui.value)) {
      return refus(`echange refuse : ${pret ? 'validant' : 'proposant'} ${qui.value} inconnu de l'application`);
    }

    const trame = pret ? TRAME_VALIDATION : TRAME_ACCEPTATION;
    if (delai === null) return emettre(pid, etat, trame, pret, 0);
    const retardMs = delai.minMs + Math.floor(alea() * (delai.maxMs - delai.minMs + 1));
    planifier(() => emettre(pid, etat, trame, pret, retardMs), retardMs);
  };
}

module.exports = {
  TRAME_ACCEPTATION, TRAME_VALIDATION, DELAI_REACTION,
  TYPE_PROPOSITION, TYPE_PARTENAIRE_PRET,
  CHAMP_PROPOSANT, CHAMP_PRET, CHAMP_VALIDANT,
  creerAccepteurEchange, reecrireProposition, CHAMP_CONFIRMATION,
};
