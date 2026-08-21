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

function creerTransformateurFlux({ reglages, estArmePourCompte = null, onCompteRendu = () => {} }) {
  // conn.id -> { reassembleur, inerte }
  const etats = new Map();

  // Armee pour CETTE connexion precise: le drapeau general ET, si un
  // predicat par compte est fourni, l'etat de ce compte precis (CRITICAL de
  // revue finale -- sans le predicat, activer le no-anim sur un compte
  // l'armait sur tous, car reglages.actif etait la SEULE porte). Sans
  // predicat, seul le drapeau general compte, pour ne rien changer aux
  // appelants qui n'en fournissent pas.
  function armeePour(conn) {
    if (!reglages.actif) return false;
    if (typeof estArmePourCompte !== 'function') return true;
    return estArmePourCompte(conn.pid);
  }

  return function transformer(buf, conn) {
    // IMPORTANT: refuse de transformer si conn est absent ou son id n'est pas defini.
    if (!conn || conn.id === undefined) return buf;

    const armee = armeePour(conn);

    // Gestion de l'extinction en cours de flux (CRITICAL 2), qu'elle soit
    // generale ou propre a ce compte.
    if (!armee) {
      let etat = etats.get(conn.id);
      if (etat !== undefined) {
        if (etat.inerte) {
          // Connexion desynchronisee: relayer l'original, pas de traitement.
          return buf;
        }
        if (etat.reassembleur.pending > 0) {
          // Des octets sont bufferises: les rendre avec le chunk courant, puis oublier l'etat.
          const octetsEnAttente = etat.reassembleur.flush();
          etats.delete(conn.id);
          return Buffer.concat([octetsEnAttente, buf]);
        }
      }
      // Aucun etat, ou etat sans donnees bufferisees: Garantie 1.
      return null;
    }

    let etat = etats.get(conn.id);
    if (etat === undefined) {
      etat = { reassembleur: new FrameReassembler(), inerte: false };
      etats.set(conn.id, etat);
    }
    if (etat.inerte) return null;

    let trames = [];
    const octetsAvantPush = etat.reassembleur.getBuffer();
    try {
      trames = etat.reassembleur.push(buf);
    } catch (e) {
      // Desynchronise: on ne sait plus ou commencent les trames. On rend les octets
      // en attente suivis du chunk courant, on vide le tampon interne pour eviter
      // une duplication si la connexion passe en extinction, puis on passe inerte
      // (CRITICAL 1 + correction de la duplication).
      const sortie = Buffer.concat([octetsAvantPush, buf]);
      etat.reassembleur.flush();
      etat.inerte = true;
      onCompteRendu({ conn: conn.id, pid: conn.pid, raison: `cadrage perdu, connexion relayee telle quelle : ${e.message}` });
      return sortie;
    }

    if (trames.length === 0) return Buffer.alloc(0);

    const morceaux = [];
    for (const brute of trames) {
      let r = { octets: [], raison: null };
      try { r = traduire(brute); }
      catch (e) { r = { octets: [], raison: `traduction en echec, trame relayee telle quelle : ${e.message}` }; }
      if (r.raison !== null) onCompteRendu({ conn: conn.id, pid: conn.pid, raison: r.raison });
      const sortantes = r.octets.length === 0 ? [brute] : r.octets;
      for (const t of sortantes) morceaux.push(writeVarint(t.length), t);
    }
    return Buffer.concat(morceaux);
  };
}

module.exports = { creerTransformateurFlux };
