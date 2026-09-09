'use strict';
const { readVarint, writeVarint } = require('./codec/framing');
const { decodeFrameRaw } = require('./codec/rawProto');

// La pop-up d'echange qui reste affichee chez la mule, et rien d'autre.
//
// LE DEFAUT. OMNI accepte l'echange en ecrivant sur la socket AMONT: le serveur
// le voit, l'echange se fait. Mais le client de la mule ne voit jamais passer
// cette acceptation — il ne l'a pas produite — et sa pop-up « accepter /
// refuser » attend un clic qui n'arrivera pas. Elle reste affichee APRES la fin
// de l'echange.
//
// POURQUOI PAS LE MASQUAGE, qui regle ce probleme pour l'invitation. Essai en
// jeu du 04/09: `jyv` masquee, la mule ne voit plus DU TOUT qu'elle est en
// echange et ne peut plus rien y deposer. Cette trame ne fait pas qu'ouvrir un
// panneau, elle EST ce qui apprend l'echange au client. Ecarte definitivement —
// voir docs/superpowers/specs/2026-09-04-panneau-invitation-masquage-design.md.
//
// CE QUI FERME LA POP-UP, mesure le 09/09 (journal-bug-0909.log). Le maitre
// annule sa proposition, acceptation automatique eteinte:
//
//   5160802 [17460] --> kiy { }         le maitre annule
//   5160833  [8328] <-- jzi { 1=11 }    la mule recoit ceci
//   5160844  [8328] --> kiy { }         son client referme TOUT SEUL
//
// Et voici ce qu'elle recoit a la fin d'un echange REUSSI, le meme jour:
//
//   5208283  [8328] <-- jzi { 1=11 2=1 }
//
// LE MEME MESSAGE, A UN CHAMP PRES. Le champ 2 dit « l'echange a abouti », et
// c'est cette version-la qui ne ferme pas la pop-up. Sans le champ 2, le client
// comprend « la demande est annulee » et referme.
//
// D'OU LA SOLUTION: a la fin d'un echange qu'OMNI a accepte tout seul, glisser
// la version SANS champ 2 dans le flux descendant, juste derriere celle du
// serveur. A cet instant l'echange est deja conclu cote serveur: il n'y a plus
// rien a casser. C'est ce qui rend ce geste sur, la ou masquer `jyv` au debut
// rendait la mule aveugle.
//
// EFFET DE BORD MESURE, PAS SUPPOSE: comme dans la mesure ci-dessus, le client
// enverra un `kiy` de lui-meme derriere. A cet instant la mule n'a rien d'autre
// d'ouvert — l'echange vient de se conclure — donc ce `kiy` ne ferme rien.
//
// POURQUOI ICI ET PAS DANS src/masque.js. Ce module INSERE une trame, l'autre
// en RETIRE une. Le geste est symetrique mais la raison ne l'est pas: le
// masquage empeche un panneau de naitre, celui-ci ferme une fenetre nee d'une
// trame qu'on a laissee passer expres. Les melanger aurait fait un module qui
// s'appelle « masque » et qui ajoute des octets.

// Les deux trames sont CONSTANTES: elles ne portent rien de l'echange en cours.
// Octets releves en jeu le 09/09.
const TRAME_FIN_ECHANGE = Buffer.from(
  '121d1a1b0a13747970652e616e6b616d612e636f6d2f6a7a691204080b1001', 'hex',
);
const TRAME_ANNULATION = Buffer.from(
  '121b1a190a13747970652e616e6b616d612e636f6d2f6a7a691202080b', 'hex',
);

// Ce qui part sur le fil: le prefixe de longueur, puis la trame. Le
// reassembleur du client attend exactement ca.
const PAQUET_ANNULATION = Buffer.concat([
  writeVarint(TRAME_ANNULATION.length), TRAME_ANNULATION,
]);

const TYPE_FIN = 'jzi';
const CHAMP_ABOUTI = 2;

// La fin d'echange REUSSIE, celle qui laisse la pop-up. On decode plutot que de
// comparer les octets: un champ de plus dans la trame du serveur — une date, un
// compteur — ferait echouer une egalite exacte EN SILENCE, et la pop-up
// reviendrait sans que rien ne le dise. Le type et la presence du champ 2
// suffisent a decider.
function estFinReussie(brute) {
  let frame = null;
  try { frame = decodeFrameRaw(brute); } catch (e) { return false; }
  if (frame === null || frame === undefined || frame.type !== TYPE_FIN) return false;
  return (frame.payload || []).some((f) => f.no === CHAMP_ABOUTI);
}

function estFin(brute) {
  let frame = null;
  try { frame = decodeFrameRaw(brute); } catch (e) { return false; }
  return frame !== null && frame !== undefined && frame.type === TYPE_FIN;
}

// onCompteRendu — recoit ce qui a ete insere, ou ce qui n'a pas pu l'etre.
function creerFermeturePopup({ onCompteRendu = () => {} } = {}) {
  // pid -> vrai si OMNI a accepte un echange pour ce compte et que la pop-up
  // est donc restee. ABSENT VEUT DIRE RIEN A FERMER.
  const marques = new Set();

  // Appelee quand l'accepteur accepte, pas quand il valide: c'est
  // l'acceptation qui laisse la pop-up.
  function marquer(pid) {
    marques.add(pid);
  }

  // Rend les octets a ecrire au client, ou null pour « rien a faire, ecris
  // l'original ». Le null n'est pas une politesse: il garantit qu'un compte
  // sans marque traverse ce module sans qu'un seul octet soit recopie — meme
  // contrat que src/masque.js.
  function transformer(buf, conn) {
    if (!conn || conn.pid === undefined) return null;
    if (!marques.has(conn.pid)) return null;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return null;

    const morceaux = [];
    let inserees = 0;
    let i = 0;
    while (i < buf.length) {
      let entete = null;
      try { entete = readVarint(buf, i); } catch (e) { entete = null; }
      // Longueur illisible, ou trame incomplete a la fin du chunk: on ne sait
      // plus ou commencent les suivantes. Tout le reste part tel quel — meme
      // prudence que le masquage, et pour la meme raison.
      if (entete === null || i + entete.bytes + entete.value > buf.length) break;

      const debut = i;
      const fin = i + entete.bytes + entete.value;
      const brute = buf.subarray(i + entete.bytes, fin);
      morceaux.push(buf.subarray(debut, fin));

      if (estFin(brute)) {
        // Un echange qui se termine, de quelque facon que ce soit, solde la
        // marque: sans ca, un echange annule laisserait une marque armee qui
        // ferait inserer la trame a la fin de l'echange SUIVANT.
        marques.delete(conn.pid);
        if (estFinReussie(brute)) {
          // ICI, et pas ailleurs: [debut, fin) est une trame complete, donc
          // cette position EST une frontiere. C'est la seule garantie qui rend
          // l'insertion sure.
          morceaux.push(PAQUET_ANNULATION);
          inserees += 1;
          onCompteRendu({
            pid: conn.pid, conn: conn.id,
            raison: `pop-up d echange fermee chez le client (${PAQUET_ANNULATION.length} o inseres)`,
          });
        }
        // Avancer AVANT de sortir: ce qui suit dans le chunk est recopie a
        // partir de `i`, et sortir sans avancer republierait cette trame.
        i = fin;
        break;
      }
      i = fin;
    }

    if (inserees === 0) return null;
    if (i < buf.length) morceaux.push(buf.subarray(i));
    return Buffer.concat(morceaux);
  }

  return { marquer, transformer };
}

module.exports = {
  creerFermeturePopup, TRAME_FIN_ECHANGE, TRAME_ANNULATION, PAQUET_ANNULATION,
  TYPE_FIN, CHAMP_ABOUTI,
};
