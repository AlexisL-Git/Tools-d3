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
//
// POURQUOI UNE CONNEXION DEJA EN COURS EST REFUSEE DEFINITIVEMENT (CRITICAL
// de revue finale). Armer une connexion deja ouverte fait lire un
// FrameReassembler neuf a partir d'un decalage arbitraire du flux: il n'y a
// aucun moyen de savoir si l'octet suivant commence une trame ou en coupe
// une en deux. Continuer produirait un cadrage au hasard, et donc le meme
// gel silencieux qu'un cadrage perdu, mais sans le compte rendu qui
// accompagne d'ordinaire ce cas-la. La seule connexion transformable est
// celle suivie depuis son PREMIER octet: toute connexion vue pour la
// premiere fois pendant que le no-anim (general ou pour ce compte) est
// eteint est marquee refusee pour de bon, meme si elle est rallumee plus
// tard. Meme sort pour une connexion suivie depuis le debut mais eteinte EN
// PLEIN MILIEU d'une trame: les octets bufferises sont rendus tels quels
// (rien n'est perdu), mais la frontiere de trame suivante est desormais
// inconnue, donc plus jamais transformable non plus. C'est une limitation
// acceptable et honnete: le no-anim ne prend effet que sur les connexions
// ouvertes apres son activation.

function creerTransformateurFlux({
  reglages, estArmePourCompte = null, onCompteRendu = () => {},
  // Reecriture de trames dans le flux descendant. Null = le module se
  // comporte exactement comme avant. { reglages, estArmePourCompte, reecrire }
  // sinon: les deux premiers arment par compte comme pour le no-anim, le
  // troisieme rend un Buffer de remplacement pour une trame, ou null pour la
  // laisser intacte. C'est l'operation native de ce module: `traduire` rend
  // deja des octets de remplacement pour le no-anim.
  reecriture = null,
}) {
  // conn.id -> etat. Deux statuts possibles:
  //   'suivie'  -- reassembleur suivi depuis un octet initial connu, donc
  //                transformable tant qu'il n'est pas devenu inerte.
  //   'refusee' -- vue pour la premiere fois hors armement, ou desynchronisee
  //                par une extinction en plein milieu d'une trame: jamais
  //                transformee, relais brut definitif. `avertie` evite de
  //                remplir le journal a chaque chunk d'une connexion refusee.
  const etats = new Map();

  // Armee pour CETTE connexion precise: le drapeau general ET, si un
  // predicat par compte est fourni, l'etat de ce compte precis (CRITICAL de
  // revue finale -- sans le predicat, activer le no-anim sur un compte
  // l'armait sur tous, car reglages.actif etait la SEULE porte). Sans
  // predicat, seul le drapeau general compte, pour ne rien changer aux
  // appelants qui n'en fournissent pas.
  function noAnimArmeePour(conn) {
    if (!reglages.actif) return false;
    if (typeof estArmePourCompte !== 'function') return true;
    return estArmePourCompte(conn.pid);
  }

  // Second predicat d'armement, sur le modele exact de noAnimArmeePour: la
  // reecriture a son propre interrupteur et son propre armement par compte,
  // independants de ceux du no-anim.
  function reecritureArmeePour(conn) {
    if (reecriture === null || !reecriture.reglages.actif) return false;
    if (typeof reecriture.estArmePourCompte !== 'function') return true;
    return reecriture.estArmePourCompte(conn.pid);
  }

  // Vraie si l'UNE OU L'AUTRE des deux fonctions est armee -- sinon la
  // reecriture ne marcherait que quand le no-anim est allume aussi. Toutes
  // les decisions de cadrage (suivie / refusee / inerte / extinction) restent
  // branchees ici, donc sur « au moins une fonction veut transformer ».
  function armeePour(conn) {
    return noAnimArmeePour(conn) || reecritureArmeePour(conn);
  }

  function transformer(buf, conn) {
    // IMPORTANT: refuse de transformer si conn est absent ou son id n'est pas defini.
    if (!conn || conn.id === undefined) return buf;

    const armee = armeePour(conn);
    let etat = etats.get(conn.id);

    // Premiere apparition de cette connexion pour ce transformateur.
    if (etat === undefined) {
      if (!armee) {
        // Rien a perdre ici: le proxy relaie deja l'original (Garantie 1).
        // On se souvient seulement que cette connexion n'a pas ete suivie
        // depuis son premier octet, pour la refuser si elle est armee plus
        // tard.
        etats.set(conn.id, { statut: 'refusee', avertie: false });
        return null;
      }
      etat = { statut: 'suivie', reassembleur: new FrameReassembler(), inerte: false };
      etats.set(conn.id, etat);
    }

    if (etat.statut === 'refusee') {
      // Un seul compte rendu par connexion refusee, seulement si on a
      // vraiment essaye de la transformer: le trafic ordinaire (no-anim
      // jamais active) ne doit pas remplir le journal.
      if (armee && !etat.avertie) {
        etat.avertie = true;
        onCompteRendu({
          conn: conn.id, pid: conn.pid,
          raison: 'connexion deja en cours au moment de l\'armement, relayee telle quelle definitivement',
        });
      }
      // null, pas buf: par symetrie avec le reste de ce module, "refusee"
      // ne calcule jamais rien, elle laisse le proxy relayer l'original.
      return null;
    }

    // A partir d'ici, etat.statut === 'suivie'.
    if (!armee) {
      if (etat.inerte) return buf;
      if (etat.reassembleur.pending > 0) {
        // Extinction en plein milieu d'une trame: on rend les octets en
        // attente suivis du chunk courant (rien n'est perdu), puis on
        // marque la connexion refusee pour de bon -- la frontiere de trame
        // suivante n'est plus connue, la reprendre plus tard serait le
        // meme risque qu'une connexion jamais suivie.
        const octetsEnAttente = etat.reassembleur.flush();
        etats.set(conn.id, { statut: 'refusee', avertie: false });
        return Buffer.concat([octetsEnAttente, buf]);
      }
      // Extinction pile sur une frontiere de trame: rien en attente, rien a
      // perdre, et la connexion reste 'suivie' pour un rallumage sans
      // risque -- le reassembleur est vide, donc a jour.
      return null;
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

    const reecrit = reecritureArmeePour(conn);
    const traduit = noAnimArmeePour(conn);
    const morceaux = [];
    for (const brute of trames) {
      // Le remplacement porte son propre prefixe de longueur, recalcule sur
      // SA longueur -- pas celle de l'original. Une trame reecrite n'a aucune
      // raison de faire la meme taille; reprendre celle de l'original
      // desynchroniserait le reassembleur du client, donc le gel silencieux
      // que ce module existe pour eviter.
      if (reecrit) {
        let remplacement = null;
        try { remplacement = reecriture.reecrire(brute); }
        catch (e) {
          remplacement = null;
          onCompteRendu({ conn: conn.id, pid: conn.pid, raison: `reecriture en echec, trame relayee : ${e.message}` });
        }
        if (remplacement !== null) {
          onCompteRendu({ conn: conn.id, pid: conn.pid, raison: 'proposition d\'echange reecrite (champ 4 a zero)' });
          morceaux.push(writeVarint(remplacement.length), remplacement);
          continue;
        }
      }
      if (!traduit) { morceaux.push(writeVarint(brute.length), brute); continue; }
      let r = { octets: [], raison: null };
      try { r = traduire(brute); }
      catch (e) { r = { octets: [], raison: `traduction en echec, trame relayee telle quelle : ${e.message}` }; }
      if (r.raison !== null) onCompteRendu({ conn: conn.id, pid: conn.pid, raison: r.raison });
      const sortantes = r.octets.length === 0 ? [brute] : r.octets;
      for (const t of sortantes) morceaux.push(writeVarint(t.length), t);
    }
    return Buffer.concat(morceaux);
  }

  // Purge l'etat d'une connexion fermee (IMPORTANT de revue finale): sans
  // cela, chaque connexion laisse une entree permanente dans `etats`,
  // jusqu'a 8 Mo pour une connexion desynchronisee. Propriete ajoutee sur la
  // fonction plutot que changement de signature: les appelants qui ignorent
  // fermer() continuent d'appeler transformer(buf, conn) sans rien changer.
  transformer.fermer = (connId) => { etats.delete(connId); };

  return transformer;
}

module.exports = { creerTransformateurFlux };
