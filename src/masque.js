'use strict';
const { readVarint } = require('./codec/framing');

// Les trames qu'OMNI accepte a la place du joueur ne doivent pas atteindre le
// client. Ce module les retire du flux descendant, et rien d'autre.
//
// POURQUOI. L'acceptation automatique s'ecrit sur la socket AMONT
// (src/superviseur.js, emettre): le serveur la recoit, l'applique, et le
// compte rejoint bien le groupe. Mais le client de jeu, lui, ne voit jamais
// passer cette acceptation -- il ne l'a pas produite, et elle ne redescend pas
// vers lui. Son panneau d'invitation reste donc affiche, indefiniment.
//
// CE PANNEAU NE PEUT PAS ETRE FERME PAR LE RESEAU, et c'est demontre, pas
// suppose:
//
//   - Le serveur recoit des octets IDENTIQUES dans les deux cas. La trame
//     construite par src/invitation.js reproduit celle du client octet pour
//     octet (mesure du 20/08), sur la meme connexion. Le serveur ne peut donc
//     pas distinguer un clic humain d'une injection, et ce qu'il renvoie
//     ensuite est le meme dans les deux cas.
//   - Les invites ont bien rejoint le groupe, vu a l'ecran (constat du
//     25/08): ils ont donc recu et affiche les trames de composition du
//     groupe. Si l'une d'elles fermait le panneau, il serait ferme.
//   - `ijx` part avec uid = -1, y compris quand c'est le vrai client qui
//     l'emet. L'enveloppe a un champ de correlation et le client ne s'en sert
//     pas: il n'attend aucune reponse. La fermeture n'est pas dans un rappel
//     de reponse, elle est locale au clic.
//
// D'ou la seule issue: ne pas fermer le panneau, mais l'empecher de s'ouvrir.
// Le panneau nait de la trame entrante; si le client ne la recoit pas, il n'y
// a rien a fermer. Le compte rejoint le groupe sans qu'aucune fenetre ne
// s'affiche.
//
// POURQUOI PAS DE REASSEMBLEUR ICI, contrairement a src/noanim-flux.js. Le
// no-anim REECRIT des trames: il lui faut donc tenir un reassembleur sur le
// chemin d'ecriture, et c'est ce qui l'oblige a refuser definitivement toute
// connexion qu'il n'a pas suivie depuis son premier octet. Retirer une trame
// entiere ne demande pas ca: on lit les trames du chunk sur place, sans rien
// retenir. Le prix est un cas ou l'on ne peut rien faire -- la trame marquee
// commence dans le chunk precedent, deja ecrit au client -- et alors on ne
// retire rien du tout. Le panneau s'affiche, comme avant cette fonction. Ce
// cas est rare pour ce qu'on masque: une invitation est un evenement isole,
// que le serveur envoie seul, pas noye dans un segment plein.
//
// LE MARQUAGE VIENT DE L'ACCEPTEUR, JAMAIS D'UN FILTRE RECOPIE ICI. Le proxy
// appelle onData('in') AVANT d'ecrire au client (src/proxy/server.js): quand
// ce module voit le chunk, l'accepteur a deja decide, sur son propre filtre,
// avec ses propres droits. On ne masque donc QUE ce qui a effectivement ete
// accepte. Un filtre recopie ici pourrait diverger du sien et avaler
// l'invitation d'un vrai ami -- une invitation perdue en silence est bien pire
// qu'un panneau qui reste.

// pid -> trames brutes a retirer du PROCHAIN chunk descendant de ce compte.
//
// Une marque ne vit qu'un chunk: `transformer` la reprend et la vide des son
// premier appel, arme ou non. Sans cela, une marque posee sur une connexion
// dont le chunk n'a pas pu etre lu masquerait une invitation ULTERIEURE, que
// personne n'aurait decide d'accepter.
function creerMasque({ onCompteRendu = () => {} } = {}) {
  const parPid = new Map();

  // Appelee par l'accepteur au moment ou il decide d'accepter, pas au moment
  // ou il emet: l'echange differe son emission de 150 a 600 ms, et le chunk
  // sera ecrit au client bien avant l'echeance.
  function marquer(pid, brute) {
    if (!Buffer.isBuffer(brute) || brute.length === 0) return;
    const liste = parPid.get(pid);
    if (liste === undefined) parPid.set(pid, [brute]);
    else liste.push(brute);
  }

  // Rend les octets a ecrire au client, ou null pour « rien a faire, ecris
  // l'original ». Le null n'est pas une politesse: il garantit qu'un compte
  // sans marque traverse ce module sans qu'un seul octet soit recopie.
  function transformer(buf, conn) {
    if (!conn || conn.pid === undefined) return null;
    const marques = parPid.get(conn.pid);
    parPid.delete(conn.pid);
    if (marques === undefined || !Buffer.isBuffer(buf) || buf.length === 0) return null;

    const morceaux = [];
    let retirees = 0;
    let i = 0;
    while (i < buf.length) {
      let entete = null;
      try { entete = readVarint(buf, i); } catch (e) { entete = null; }
      // Longueur illisible, ou trame incomplete a la fin du chunk: on ne sait
      // plus ou commencent les suivantes. Tout le reste part tel quel.
      if (entete === null || i + entete.bytes + entete.value > buf.length) break;

      const debut = i;
      const apresEntete = i + entete.bytes;
      const fin = apresEntete + entete.value;
      const brute = buf.subarray(apresEntete, fin);

      // Egalite EXACTE avec une trame qu'on a vue arriver. C'est ce qui rend
      // le retrait sur: les octets [debut, fin) sont alors, a coup sur, cette
      // trame et son prefixe de longueur -- une unite complete du fil. Meme si
      // la lecture avait demarre de travers, retirer ces octets-la reste
      // juste.
      const rang = marques.findIndex((m) => m.equals(brute));
      if (rang === -1) morceaux.push(buf.subarray(debut, fin));
      else {
        marques.splice(rang, 1);
        retirees += 1;
        onCompteRendu({ pid: conn.pid, conn: conn.id, raison: `trame acceptee par OMNI masquee au client (${brute.length} o)` });
      }
      i = fin;
    }

    // Ce qui reste marque n'a pas ete trouve, et ne le sera plus: la trame est
    // arrivee dans CE chunk-ci, l'accepteur venait de la voir. Elle commence
    // donc dans le chunk precedent, deja ecrit au client. Le dire, sinon
    // l'utilisateur voit un panneau rester juste apres une ligne
    // « invitation : acceptee », sans rien qui relie les deux.
    for (const restee of marques) {
      onCompteRendu({
        pid: conn.pid, conn: conn.id,
        raison: `trame acceptee par OMNI, pas pu etre masquee au client (${restee.length} o a cheval sur deux chunks) : le panneau restera affiche`,
      });
    }

    if (retirees === 0) return null;
    if (i < buf.length) morceaux.push(buf.subarray(i));
    return Buffer.concat(morceaux);
  }

  return { marquer, transformer };
}

// Le superviseur n'accepte qu'UN transformateur du flux descendant, et il y en
// a desormais deux. Ils s'enchainent dans cet ordre: le no-anim REECRIT des
// trames, le masquage en RETIRE -- le masquage travaille donc sur ce que le
// client verrait vraiment, pas sur des octets que le no-anim aurait deja
// remplaces.
//
// LE CONTRAT `null` SURVIT A LA COMPOSITION, et c'est tout l'objet de cette
// fonction. `null` veut dire « je n'ai touche a rien, ecris l'original ». Une
// composition naive qui rendrait toujours un Buffer ferait tomber la Garantie
// 1 du no-anim: eteint ne signifierait plus intouche, et chaque octet du
// chemin critique serait recopie pour rien.
// VARIADIQUE DEPUIS LE 09/09: ils sont trois — le no-anim REECRIT, le masquage
// RETIRE, la fermeture de pop-up INSERE. L'ordre est celui des arguments, et il
// compte: chacun travaille sur ce que le client verrait vraiment si les
// precedents s'arretaient la.
function composerDescendant(...fonctions) {
  const f = (buf, conn) => {
    // `null` tant que personne n'a touche a rien: c'est ce qui garantit qu'une
    // chaine entierement inerte ne recopie pas un seul octet.
    let courant = null;
    for (const g of fonctions) {
      const sortie = g(courant === null ? buf : courant, conn);
      if (Buffer.isBuffer(sortie)) courant = sortie;
    }
    return courant;
  };
  // Sans ce relais, l'etat par connexion du no-anim ne serait plus jamais
  // purge: le superviseur appelle fermer() sur CE qu'on lui a donne.
  f.fermer = (id) => {
    for (const g of fonctions) if (typeof g.fermer === 'function') g.fermer(id);
  };
  return f;
}

module.exports = { creerMasque, composerDescendant };
