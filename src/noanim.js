'use strict';
const { decodeFrameRaw, encodeRaw, WIRE } = require('./codec/rawProto');

// La suppression des animations de deplacement en combat, et elle seule.
//
// LA REGLE. Mesuree le 2026-08-21 en observant le proxy de krm35, trois
// captures. Detail complet et octets dans
// docs/superpowers/specs/2026-08-21-trames-deplacement-combat.md.
//
//   recu du serveur   jsj { 1: chemin, 2: …, 5: acteur }
//   rendu au client   jwe { 3: acteur, 14: 4, 35: { 1: derniere case, 2: acteur } }
//                     PUIS le jsj d'origine, inchange
//
// Le champ 1 de jsj porte le chemin en varints EMPAQUETES, une case par
// varint, du depart a l'arrivee. Les pas mesures valent toujours ±13, ±14 ou
// ±15: c'est le voisinage d'une grille Dofus.
//
// La pose precede le deplacement et ne le remplace pas: le client recoit
// l'acteur a destination avant l'ordre de bouger, donc l'animation n'a plus de
// trajet a parcourir. Verifie sur 48 poses sur 51.
//
// ON N'ENLEVE RIEN. Le proxy de krm35 retire par ailleurs des trames jwe
// d'action 300, dont l'effet n'est pas etabli. On ne l'imite pas: une trame
// supprimee a tort est un effet de jeu perdu, une trame ajoutee en trop n'est
// qu'une position confirmee.
//
// AU MOINDRE DOUTE, NE RIEN CHANGER. Ce module est sur le chemin critique du
// jeu: une trame mal reconstruite tue la connexion, la ou une animation de
// trop ne coute rien. `octets: []` fait relayer les octets d'origine, et c'est
// la valeur de retour de tous les chemins de doute.

const TYPE_DEPLACEMENT = 'jsj';
const CHAMP_CHEMIN = 1;
const CHAMP_ACTEUR_JSJ = 5;
const ACTION_POSE = 4n;
const CHAMP_ACTEUR_POSE = 3;
const TYPE_ACTION = 14;
const BRANCHE_POSE = 35;
const URL_JWE = 'type.ankama.com/jwe';

const champ = (fields, no) => (fields || []).find((f) => f.no === no) || null;

// Les varints empaquetes d'un champ `bytes`. Un varint tronque en fin de
// tampon est ignore plutot que de rendre une case fausse.
function casesDuChemin(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    let v = 0n;
    let decalage = 0n;
    let complet = false;
    while (i < buf.length) {
      const octet = buf[i++];
      v |= BigInt(octet & 0x7f) << decalage;
      if ((octet & 0x80) === 0) { complet = true; break; }
      decalage += 7n;
      if (decalage > 63n) return out;
    }
    if (!complet) break;
    out.push(v);
  }
  return out;
}

// L'enveloppe est celle de tous les evenements observes: Message{ event = 1 },
// event{ Any content = 1 }, Any{ string type_url = 1, bytes value = 2 }. Un
// evenement ne porte pas d'uid, contrairement aux requetes.
function construirePose(idCase, acteur) {
  return encodeRaw([
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: URL_JWE },
        { no: 2, wire: WIRE.LEN, kind: 'message', value: [
          { no: CHAMP_ACTEUR_POSE, wire: WIRE.VARINT, value: acteur },
          { no: TYPE_ACTION, wire: WIRE.VARINT, value: ACTION_POSE },
          { no: BRANCHE_POSE, wire: WIRE.LEN, kind: 'message', value: [
            { no: 1, wire: WIRE.VARINT, value: idCase },
            { no: 2, wire: WIRE.VARINT, value: acteur },
          ] },
        ] },
      ] },
    ] },
  ]);
}

function traduire(brute) {
  let decodee = null;
  try { decodee = decodeFrameRaw(brute); }
  catch (e) { return { octets: [], raison: `trame indecodable, relayee telle quelle : ${e.message}` }; }
  if (decodee === null) return { octets: [], raison: 'trame indecodable, relayee telle quelle' };
  if (decodee.type !== TYPE_DEPLACEMENT) return { octets: [], raison: null };

  const chemin = champ(decodee.payload, CHAMP_CHEMIN);
  if (chemin === null || !Buffer.isBuffer(chemin.value)) {
    return { octets: [], raison: 'deplacement sans chemin, relaye tel quel' };
  }
  const cases = casesDuChemin(chemin.value);
  if (cases.length === 0) return { octets: [], raison: 'chemin vide, relaye tel quel' };

  const acteur = champ(decodee.payload, CHAMP_ACTEUR_JSJ);
  if (acteur === null || typeof acteur.value !== 'bigint') {
    return { octets: [], raison: 'deplacement sans acteur, relaye tel quel' };
  }

  try {
    const pose = construirePose(cases[cases.length - 1], acteur.value);
    // La pose D'ABORD, le deplacement d'origine ENSUITE et inchange.
    return { octets: [pose, brute], raison: null };
  } catch (e) {
    return { octets: [], raison: `pose non construite, relayee telle quelle : ${e.message}` };
  }
}

module.exports = {
  traduire, construirePose, casesDuChemin,
  TYPE_DEPLACEMENT, CHAMP_CHEMIN, CHAMP_ACTEUR_JSJ, ACTION_POSE,
};
