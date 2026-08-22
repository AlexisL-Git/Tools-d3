'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

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

const champ = (frame, no) => (frame.payload || []).find((f) => f.no === no) || null;

// Les characterId de nos AUTRES clients. Notre propre identifiant n'en fait
// jamais partie: il designe le destinataire, pas un proposant.
function autresNotres(superviseur, pid) {
  return superviseur.comptes.tous
    .filter((e) => e.pid !== pid && e.characterId !== null && e.characterId !== undefined)
    .map((e) => e.characterId);
}

// superviseur   — porte emettre(pid, octets), comptes.get(pid) et comptes.tous
// reglages      — { actif }, RELU a chaque trame pour que l'interrupteur
//                 general prenne effet aussitot
// onCompteRendu — recoit ce qui a ete emis, ou refuse et pourquoi
function creerAccepteurEchange({ superviseur, reglages, onCompteRendu = () => {} }) {
  return function onTrame({ pid, dir, frame }) {
    if (dir !== 'in' || frame === null || frame === undefined) return;
    if (frame.type !== TYPE_PROPOSITION) return;

    // Un echange est un evenement rare: dire pourquoi on ne l'accepte pas ne
    // coute rien et repond a la seule question que l'utilisateur se pose.
    const refus = (raison) => onCompteRendu({ pid, ok: false, raison });

    if (!reglages.actif) return refus('echange ignore : interrupteur general eteint');
    const etat = superviseur.comptes.get(pid);
    if (etat === null || etat === undefined) return refus('echange ignore : compte inconnu du superviseur');
    if (!etat.accepteEchange) return refus('echange ignore : acceptation eteinte pour ce compte');

    const proposant = champ(frame, CHAMP_PROPOSANT);
    if (proposant === null) return refus('echange refuse : aucun proposant dans la trame');
    if (!autresNotres(superviseur, pid).some((id) => id === proposant.value)) {
      return refus(`echange refuse : proposant ${proposant.value} inconnu de l'application`);
    }

    const res = superviseur.emettre(pid, TRAME_ACCEPTATION);
    onCompteRendu({ pid, ok: res.ok, raison: res.raison, octets: res.octets });
  };
}

module.exports = {
  TRAME_ACCEPTATION, TRAME_VALIDATION,
  TYPE_PROPOSITION, TYPE_PARTENAIRE_PRET,
  CHAMP_PROPOSANT, CHAMP_PRET, CHAMP_VALIDANT,
  creerAccepteurEchange,
};
