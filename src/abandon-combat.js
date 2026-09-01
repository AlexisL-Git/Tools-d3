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
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur, comme src/invitation.js et src/passeur.js.

// La liste des combattants, envoyee une fois au demarrage du combat.
const TYPE_COMBATTANTS = 'kmk';

// Les types qui disent « je quitte ce combat ». Une liste, parce que la phase
// de placement pourrait en avoir un a elle: a confirmer en jeu.
const TYPES_ABANDON = ['kme'];

// Dans kmk: une entree repetee par combattant au champ 2. Dans chaque entree,
// le champ 2 porte le type et le champ 3 l'identifiant.
const CHAMP_COMBATTANT = 2;
const CHAMP_TYPE = 2;
const CHAMP_ID = 3;

// 7 = monstre, 3 = joueur, 1 = acteur de carte hors combat.
const TYPE_JOUEUR = 3;

// Les characterId des joueurs d'une liste de combattants, ou null si la trame
// n'en porte aucun.
//
// NULL PLUTOT QU'UN ENSEMBLE VIDE, et la difference porte tout le mecanisme:
// `kmk` sert aussi a lister les acteurs d'une CARTE, ou personne n'est de type
// 3. Un ensemble vide ecraserait la liste du combat en cours et ferait rater
// l'abandon; null la laisse en place.
function joueursDe(frame) {
  if (frame === null || typeof frame !== 'object') return null;
  const ids = new Set();
  for (const f of frame.payload || []) {
    if (f === null || f.no !== CHAMP_COMBATTANT || !Array.isArray(f.value)) continue;
    const type = f.value.find((x) => x && x.no === CHAMP_TYPE);
    const id = f.value.find((x) => x && x.no === CHAMP_ID);
    if (type === undefined || id === undefined) continue;
    if (Number(type.value) !== TYPE_JOUEUR) continue;
    if (id.value === undefined || id.value === null) continue;
    // Le decodeur rend des BigInt sur certains champs et des nombres sur
    // d'autres, et 676438999334n !== 676438999334. Tout passe en chaine, sans
    // quoi la comparaison serait toujours fausse et la politique inerte — sans
    // rien dire. Meme precaution que cleDe() dans src/garde-combat.js.
    ids.add(String(id.value));
  }
  return ids.size === 0 ? null : ids;
}

// superviseur   — porte `arme`, emettre(pid, octets), comptes.get(pid) et
//                 comptes.esclaves(pid)
// onCompteRendu — recoit { pid, ok, raison, octets }, un appel par esclave vise
function creerAbandonGroupe({ superviseur, onCompteRendu = () => {} }) {
  // pid -> ensemble des characterId (en chaines) qui combattent avec lui. Le
  // maitre y figure comme les autres.
  const combattants = new Map();

  return function onTrame({ pid, dir, frame, brute, estMaitre }) {
    if (frame === null || frame === undefined) return;

    // 1. Apprendre, chez TOUS les clients. Le duplicateur et la garde combat
    // sortent tous deux sur !estMaitre: aucun des deux ne voit le trafic des
    // mules, et c'est la raison d'etre de ce module.
    if (dir === 'in') {
      if (frame.type !== TYPE_COMBATTANTS) return;
      const joueurs = joueursDe(frame);
      if (joueurs !== null) combattants.set(pid, joueurs);
      return;
    }

    // 2. Repliquer, sur le maitre seul. OMNI NE REPARE QUE CE QU'IL A CAUSE:
    // sans duplication armee, les mules ne sont pas entrees dans ce combat a
    // sa suite, et l'abandon ne les regarde pas.
    if (!estMaitre || !superviseur.arme) return;
    if (!TYPES_ABANDON.includes(frame.type)) return;

    // Consomme: un second abandon sur le meme combat ne renvoie rien.
    combattants.delete(pid);

    const etat = superviseur.comptes.get(pid);
    const idMaitre = etat === null || etat === undefined ? null : etat.characterId;
    if (idMaitre === null || idMaitre === undefined) return;
    const cleMaitre = String(idMaitre);

    for (const esclave of superviseur.comptes.esclaves(pid)) {
      const siens = combattants.get(esclave.pid);
      if (siens === undefined || !siens.has(cleMaitre)) continue;
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
  creerAbandonGroupe, joueursDe,
  TYPE_COMBATTANTS, TYPES_ABANDON, TYPE_JOUEUR,
  CHAMP_COMBATTANT, CHAMP_TYPE, CHAMP_ID,
};
