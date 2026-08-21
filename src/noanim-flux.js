'use strict';
const { FrameReassembler, writeVarint } = require('./codec/framing');
const { traduire } = require('./noanim');

// L'enveloppe de flux du no-anim: cadrage, etat par connexion, desarmement.
//
// src/noanim.js traduit UNE trame. Ce module-ci decide quelles trames lui
// donner, et surtout dans quels cas ne rien faire du tout.
//
// POURQUOI UN REASSEMBLEUR. Un chunk TCP ne porte pas un nombre entier de
// trames: il peut en couper une en deux, ou en contenir trois. On ne peut donc
// pas traduire un chunk, seulement des trames completes. Les octets d'une
// trame incomplete sont retenus jusqu'a ce qu'elle le soit -- un changement de
// rythme, pas de contenu.
//
// POURQUOI UN MODE INERTE DEFINITIF. Si le reassembleur se desynchronise une
// fois, il ne se resynchronise jamais: toutes les longueurs suivantes sont
// lues au mauvais endroit. Continuer a transformer detruirait la connexion de
// jeu. On repart alors les octets tels quels et on ne retouche plus jamais a
// cette connexion, jusqu'a sa fermeture.
//
// POURQUOI ETEINT SIGNIFIE INTOUCHE. Tant que reglages.actif est faux, ce
// module rend null sans rien lire: le proxy ecrit les octets d'origine, et le
// chemin de relais est exactement celui d'avant cette fonction. C'est la
// condition posee avant d'accepter que le proxy touche au chemin critique.

function creerTransformateurFlux({ reglages, onCompteRendu = () => {} }) {
  // conn.id -> { reassembleur, inerte }
  const etats = new Map();

  return function transformer(buf, conn) {
    if (!reglages.actif) return null;

    let etat = etats.get(conn.id);
    if (etat === undefined) {
      etat = { reassembleur: new FrameReassembler(), inerte: false };
      etats.set(conn.id, etat);
    }
    if (etat.inerte) return null;

    let trames = [];
    try {
      trames = etat.reassembleur.push(buf);
    } catch (e) {
      // Desynchronise: on ne sait plus ou commencent les trames. On rend le
      // chunk tel quel et on ne touche plus a cette connexion.
      etat.inerte = true;
      onCompteRendu({ conn: conn.id, raison: `cadrage perdu, connexion relayee telle quelle : ${e.message}` });
      return buf;
    }

    if (trames.length === 0) return Buffer.alloc(0);

    const morceaux = [];
    for (const brute of trames) {
      let r = { octets: [], raison: null };
      try { r = traduire(brute); }
      catch (e) { r = { octets: [], raison: `traduction en echec, trame relayee telle quelle : ${e.message}` }; }
      if (r.raison !== null) onCompteRendu({ conn: conn.id, raison: r.raison });
      const sortantes = r.octets.length === 0 ? [brute] : r.octets;
      for (const t of sortantes) morceaux.push(writeVarint(t.length), t);
    }
    return Buffer.concat(morceaux);
  };
}

module.exports = { creerTransformateurFlux };
