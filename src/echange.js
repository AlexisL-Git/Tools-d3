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

module.exports = {
  TRAME_ACCEPTATION, TRAME_VALIDATION,
  TYPE_PROPOSITION, TYPE_PARTENAIRE_PRET,
  CHAMP_PROPOSANT, CHAMP_PRET, CHAMP_VALIDANT,
};
