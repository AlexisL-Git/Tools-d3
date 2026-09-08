'use strict';

// L'abandon groupe, et lui seul.
//
// CE QUE C'EST. Le maitre abandonne un combat, les mules qui sont dans LE MEME
// combat que lui abandonnent aussi. Sans cela, il faut abandonner a la main sur
// chaque client apres un donjon rate.
//
// LE CRITERE EST UN FAIT, PAS UN JUGEMENT. On ne cherche jamais a savoir si un
// combat est « de quete » ou « normal »: on regarde qui combat avec qui. Un
// combat de quete est solo — la mule n'y est pas, donc rien ne part. L'exigence
// de l'utilisateur est satisfaite sans un seul cas particulier dans le code.
//
// LES TRAMES, mesurees le 2026-09-01, journal complet dans
// docs/superpowers/specs/2026-09-01-trames-abandon.md:
//
//   90873ms [26784 maitre] --> request kme {  }        l'abandon, VIDE
//   90902ms [23436 mule]   <-- event jzu { … }         +29 ms: la liste des
//                                                      restants, sans le maitre
//
//   87463ms [23436 mule]   <-- event kmk { 2={1=428 2=7 3=-1} …
//                                          2={1=274 2=3 3=676438999334}
//                                          2={1=217 2=3 3=677048221990} }
//   87463ms [26784 maitre] <-- event kmk { … la meme, octet pour octet … }
//
// `kme` NE PORTE AUCUN CHAMP, comme `kla`. Rien dedans n'appartient au compte
// emetteur: elle se re-emet telle quelle, sans substitution.
//
// POURQUOI PAS LE NUMERO DE COMBAT. Il existe — `kau { 5=198 }`, recu par les
// deux — mais il est AUSSI diffuse a qui VOIT un combat depuis sa carte
// (mesure: les deux clients recoivent kau {5=90} en arrivant sur une carte,
// sans etre en combat). Un numero recu ne prouve pas la participation; une
// `kmk` de combat, si.
//
// L'ETAT PERIME EST SANS DANGER. La mesure n'a pas livre de trame de fin de
// combat, et on n'en a pas besoin: l'ensemble d'un client est REMPLACE a chaque
// `kmk` de combat, donc un combat neuf ecrase le precedent. Un pid retire
// laisse une entree morte, sans effet.
//
// ------------------------------------------------------------------------
// RONDE DE CORRECTION 1, 2026-09-01 (nuit). Branche en jeu: le maitre
// abandonne, la mule ne bouge pas, aucune ligne `abandon :` au journal.
//
// LE DEFAUT: `TYPE_JOUEUR = 3` reposait sur une coincidence. Le champ 2 d'une
// entree de `kmk` n'est PAS un type d'acteur — c'est son ORIENTATION sur la
// carte (0 a 7). Le champ 1 est sa CELLULE (0 a 559). Dans la mesure
// d'origine, les cinq monstres regardaient tous vers 7 et les deux joueurs
// vers 3: d'ou la fausse lecture « 7 = monstre, 3 = joueur ».
//
// LA CONTRE-PREUVE, mesuree cette nuit (journal-dev.log, maitre pid 10352 =
// 676438999334, mule pid 11024 = 677048221990):
//
//   40217ms [11024] <-- event kmk { 2={1=200 2=7 3=-1} 2={1=203 2=5 3=-2}
//                                    2={1=262 2=5 3=-3} 2={1=303 2=5 3=-4}
//                                    2={1=204 2=5 3=677048221990} }
//   59422ms [11024] <-- event kmk { 2={1=200 2=7 3=-1} 2={1=203 2=5 3=-2}
//                                    2={1=262 2=5 3=-3} 2={1=303 2=5 3=-4}
//                                    2={1=188 2=1 3=676438999334}
//                                    2={1=204 2=5 3=677048221990} }
//   61130ms [10352] --> request kme {  }
//
// Des monstres a orientation 7 ET 5, la mule a l'orientation 5, le maitre a
// l'orientation 1. Aucune entree a l'orientation 3: l'ancien filtre rendait
// donc null pour la mule, rien n'etait retenu, et le kme du maitre ne
// trouvait personne. Le silence total du journal s'explique entierement par
// la.
//
// CE QUI DISTINGUE VRAIMENT UN JOUEUR D'UN MONSTRE: le SIGNE de l'identifiant
// au champ 3, pas le champ 2. Les monstres d'un combat portent de petits
// identifiants NEGATIFS (-1, -2, -3, -4); les joueurs portent leur
// characterId, un grand entier positif.
//
// LA CORRECTION. `combattantsDe` (ex-`joueursDe`) retient desormais TOUS les
// identifiants du champ 3, sans filtrer sur l'orientation — TYPE_JOUEUR et
// CHAMP_TYPE decrivaient une chose qui n'existe pas, ils sont retires. Elle
// ne rend un ensemble que si la liste porte AU MOINS UN identifiant negatif:
// `kmk` sert aussi a lister les acteurs d'une CARTE, et une telle liste nomme
// le maitre sans qu'il combatte avec qui que ce soit — un combat contre des
// monstres, lui, porte toujours au moins un negatif.
//
// CONSEQUENCE ASSUMEE. Un combat JOUEUR CONTRE JOUEUR, sans le moindre
// monstre, ne fait lever aucun negatif: `combattantsDe` y rend null comme
// pour une liste de carte, et l'abandon groupe n'y declenche rien. Un
// abandon rate, jamais un abandon de trop — le meme choix que pour l'etat
// perime plus haut dans ce fichier.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur, comme src/invitation.js et src/passeur.js.

// La liste des combattants, envoyee une fois au demarrage du combat.
//
// REMESURE LE 08/09, patch 3.6.11.12: elle s'appelle `kkr`, et ses entrees ont
// change de numero AVEC leurs champs.
//
//   kmk.2[] = { 1: cellule, 2: orientation, 3: identifiant }
//   kkr.1[] = { 1: identifiant, 2: orientation, 4: cellule }
//
// Mesure sur journal-combat.log (42532 ms, un combat solo) et journal-hdv.log
// (523006 ms, quatre clients): l'identifiant du champ 1 est un characterId
// connu par ailleurs (677012898086, celui que `kth` annonce a la connexion) ou
// un negatif de monstre, et le champ 4 tient dans 0..559 comme une cellule.
// `kkr` n'apparait QUE pendant les combats — zero occurrence dans
// journal-archi.log, qui n'en compte aucun.
const TYPE_COMBATTANTS = 'kkr';

// Les types qui disent « je quitte ce combat ». Une liste, parce que la phase
// de placement pourrait en avoir un a elle: a confirmer en jeu.
//
// REMESURE LE 08/09 AU SOIR: `kjy`, toujours sans un champ.
//
//   249802 ms  --> hps { 1 = -20000 }   l'attaque, dans un donjon
//   250311 ms  --> kul/kui, kty, kuh    le placement
//   251539 ms  --> jyo { 1 = 1 }        pret
//   252970 ms  --> kjy { }              L'ABANDON
//   253007 ms  <-- jvn { 1 = <maitre> } le serveur ferme le tour du maitre
//   254340 ms  <-- jwe { 4 = 2768 … }   le combat se solde
//   254372 ms  <-- jpw { 1 = 121373185 }  retour sur la carte
//
// C'EST LE SEUL SORTANT DU COMBAT QUI NE SOIT PAS UN ACCUSE D'ANIMATION: entre
// le debut du tour et la fin du combat, tout le reste est `jro` et `jvk`,
// emis par dizaines. `jvv`, le passe-tour remesure le meme jour, n'apparait
// nulle part dans cette session — l'utilisateur n'a passe aucun tour.
const TYPES_ABANDON = ['kjy'];

// Dans kkr: une entree repetee par combattant au champ 1. Dans chaque entree,
// le champ 1 est l'IDENTIFIANT, le champ 2 l'ORIENTATION (0 a 7, sans rapport
// avec le role de l'acteur) et le champ 4 la CELLULE (0 a 559).
const CHAMP_COMBATTANT = 1;
const CHAMP_ID = 1;

// Les identifiants (characterId ET identifiants de monstre) d'une liste de
// combattants, ou null si la liste ne decrit pas un combat.
//
// NULL PLUTOT QU'UN ENSEMBLE VIDE, et la difference porte tout le mecanisme:
// `kmk` sert aussi a lister les acteurs d'une CARTE, ou personne ne combat.
// Un ensemble vide ecraserait la liste du combat en cours et ferait rater
// l'abandon; null la laisse en place. Le signal qui distingue les deux n'est
// pas un champ de type (voir la correction plus haut) mais la presence d'au
// moins un identifiant NEGATIF: un monstre. Une liste de carte n'en porte
// jamais; un combat contre des monstres en porte toujours au moins un.
function combattantsDe(frame) {
  if (frame === null || typeof frame !== 'object') return null;
  const ids = new Set();
  let auMoinsUnMonstre = false;
  for (const f of frame.payload || []) {
    if (f === null || f.no !== CHAMP_COMBATTANT || !Array.isArray(f.value)) continue;
    const id = f.value.find((x) => x && x.no === CHAMP_ID);
    if (id === undefined || id.value === undefined || id.value === null) continue;
    // Le decodeur rend des BigInt sur certains champs et des nombres sur
    // d'autres, et 676438999334n !== 676438999334. Tout passe en chaine, sans
    // quoi la comparaison serait toujours fausse et la politique inerte — sans
    // rien dire. Meme precaution que cleDe() dans src/garde-combat.js.
    ids.add(String(id.value));
    // Number() sur un BigInt ne perd pas le signe, seule chose qui nous
    // interesse ici — peu importe qu'il perde la precision au-dela de 2^53.
    if (Number(id.value) < 0) auMoinsUnMonstre = true;
  }
  return auMoinsUnMonstre ? ids : null;
}

// superviseur   — porte `arme`, emettre(pid, octets), comptes.get(pid) et
//                 comptes.esclaves(pid)
// onCompteRendu — recoit { pid, ok, raison, octets }, un appel par esclave vise
function creerAbandonGroupe({ superviseur, onCompteRendu = () => {} }) {
  // pid -> ensemble des identifiants (characterId ET monstres, en chaines)
  // qui combattent avec lui. Le maitre y figure comme les autres.
  const combattants = new Map();

  return function onTrame({ pid, dir, frame, brute, estMaitre }) {
    if (frame === null || frame === undefined) return;

    // 1. Apprendre, chez TOUS les clients. Le duplicateur et la garde combat
    // sortent tous deux sur !estMaitre: aucun des deux ne voit le trafic des
    // mules, et c'est la raison d'etre de ce module.
    if (dir === 'in') {
      if (frame.type !== TYPE_COMBATTANTS) return;
      const vus = combattantsDe(frame);
      if (vus !== null) combattants.set(pid, vus);
      return;
    }

    // 2. Repliquer, sur le maitre seul. OMNI NE REPARE QUE CE QU'IL A CAUSE:
    // sans duplication armee, les mules ne sont pas entrees dans ce combat a
    // sa suite, et l'abandon ne les regarde pas.
    if (!estMaitre || !superviseur.arme) return;
    if (!TYPES_ABANDON.includes(frame.type)) return;

    // L'entree du maitre n'est jamais relue: ce qu'on compare, c'est la liste
    // de chaque ESCLAVE au characterId du maitre, lu dans le superviseur. Rien
    // a effacer ici, donc; sa prochaine kmk de combat l'ecrasera de toute
    // facon. Une ligne l'effacait, avec un commentaire qui s'attribuait le
    // merite du « second abandon ne renvoie rien » — merite qui revient a la
    // suppression faite dans la boucle ci-dessous. Revue du 01/09.
    const etat = superviseur.comptes.get(pid);
    const idMaitre = etat === null || etat === undefined ? null : etat.characterId;
    if (idMaitre === null || idMaitre === undefined) return;
    const cleMaitre = String(idMaitre);

    for (const esclave of superviseur.comptes.esclaves(pid)) {
      const siens = combattants.get(esclave.pid);
      if (siens === undefined || !siens.has(cleMaitre)) continue;
      // Consomme: c'est CETTE suppression, et elle seule, qui fait qu'un
      // second abandon sur le meme combat ne renvoie rien.
      combattants.delete(esclave.pid);
      // Chaque esclave dans son propre essai, comme les etapes de
      // src/garde-combat.js: une socket morte sur l'un ne doit pas priver les
      // suivants de leur abandon.
      try {
        const r = superviseur.emettre(esclave.pid, brute);
        onCompteRendu({ pid: esclave.pid, ok: r.ok, raison: r.raison, octets: r.octets });
      } catch (e) {
        onCompteRendu({ pid: esclave.pid, ok: false, raison: `abandon en erreur : ${e.message}` });
      }
    }
  };
}

module.exports = {
  creerAbandonGroupe, combattantsDe,
  TYPE_COMBATTANTS, TYPES_ABANDON,
  CHAMP_COMBATTANT, CHAMP_ID,
};
