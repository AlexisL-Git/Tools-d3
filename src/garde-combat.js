'use strict';
const { combattantsDe, TYPE_COMBATTANTS } = require('./abandon-combat');

// Le garde contre les combats dupliques, et lui seul.
//
// LE PROBLEME. La duplication rejoue fidelement les actions du maitre, et
// c'est sa fidelite qui coute le combat: quand une quete propose un combat
// solo, la reponse de dialogue du maitre est rejouee chez chaque esclave, et
// chacun lance LE SIEN. Mesure le 28/08: identifiants de combat distincts,
// -20147 chez le maitre, -20148 chez l'esclave. Ils n'entrent pas dans le
// combat du maitre, ils en ouvrent un chacun.
//
// Au moment de l'envoi, RIEN ne distingue une reponse qui declenche un combat
// d'une reponse ordinaire: c'est un numero dans un arbre de dialogue.
//
// LA FENETRE. Le rejeu d'un type sensible ne part pas avant
// DELAI_PLANCHER_MS + 16 ms, soit 266 ms, et le serveur annonce le combat au
// maitre en 61 ms. Un rejeu retarde peut donc etre annule avant d'etre ecrit.
// C'est tout le mecanisme.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme.
//
// UN SEUL SIGNAL, POUR LES DEUX MOITIES: `kmk`, la liste des combattants.
// L'apprentissage l'utilise depuis le 01/09, l'annulation depuis le 02/09.
//
// CE QUE L'APPRENTISSAGE RETIENT: une mule recoit une liste de combattants qui
// NE CONTIENT PAS le maitre. C'est le degat lui-meme, pas un indice. Verifie en
// jeu deux fois le 01/09. Il ne suffisait pas que le maitre se batte: entrer en
// combat apres avoir parle a un PNJ, C'EST JOUER NORMALEMENT.
//
// CE QUI DECLENCHE L'ANNULATION: le maitre recoit une `kmk` de combat. Mesure
// du 02/09 sur un combat de quete, `docs/superpowers/specs/
// 2026-09-02-garde-combat-signal-kmk-design.md`:
//
//   4386485 ms  --> ioy { 1=25088 }   l'action du maitre
//   4386546 ms  <-- kmk { …3=-1 }     +61 ms, le combat est annonce
//
// LE SIGNAL PRECEDENT ETAIT FAUX, et c'est le defaut corrige le 02/09. Le garde
// annulait sur un `ieb` entrant, jamais identifie, retenu sur une correlation
// du 28/08. Deux mesures l'ont demonte: `ieb` n'existe pas sur une attaque
// ordinaire (01/09), et il arrive SANS AUCUN COMBAT sur une simple recolte
// (02/09). Ses deux champs valaient `1642/9828` sur un combat de quete le
// 02/09 — identiques a ceux du 28/08 sur la meme etape, a cinq jours d'ecart —
// et `1639/9815` sur un ramassage sans combat. Ce sont des identifiants de
// PROGRESSION DE QUETE. Toute avancee de quete coupait les rejeux de toutes les
// mules; c'est ce que voyait l'ami qui rapportait « 3 rejeux en attente
// annules » sans jamais combattre.
//
// NE PAS REINTRODUIRE DE SIGNAL RAPIDE DEVINE. `kmk` a 61 ms laisse plus de
// 200 ms de marge; c'est mesure, et ca suffit.
//
// LE GARDE N'EMET RIEN. La fermeture du dialogue des esclaves (un `kla`) est
// partie le 02/09, a la demande de l'utilisateur: une mule dont le rejeu vient
// d'etre annule n'a jamais ouvert le dialogue, et celle qui l'a ouvert peut le
// garder.

// Les seuls types rejoues qui peuvent ouvrir un combat. Les cinq autres —
// teleportation, changement de carte, information de carte, havre-sac, sortie
// de donjon — n'en ouvrent aucun, et les retarder ne protegerait de rien.
//
// La valeur est la liste des champs qui IDENTIFIENT l'action, dans l'ordre ou
// ils composent la cle.
//
// `ido` (le ramassage d'un objet de quete, repertorie le 03/09) N'EST PAS ICI,
// et c'est delibere: le maitre emet `ido` et `kla` dans la MEME milliseconde.
// Un plancher sur `ido` seul ferait fermer le dialogue de la mule AVANT son
// ramassage — les deux rejeux s'inverseraient. Le retarder demanderait de
// retarder le couple entier.
const CHAMPS_CLE = {
  iov: [2, 3],   // la carte, puis l'instance de PNJ
  ioy: [1],      // le numero de reponse dans l'arbre de dialogue
  iwo: [2],      // l'element interactif (le champ 1 est propre au compte)
};

const TYPES_SENSIBLES = Object.keys(CHAMPS_CLE);

// Plancher avant l'ecriture du premier esclave, contre 16 ms d'etalement seul.
// Le signal a ete mesure a 61 ms le 02/09; le facteur 4 couvre la gigue reseau
// sans etre perceptible sur une interaction de quete.
const DELAI_PLANCHER_MS = 250;

// Au-dela, on ne retient plus: un monstre agressif qui saute sur le maitre
// trois secondes apres un dialogue anodin n'a pas a empoisonner la liste.
const FENETRE_APPRENTISSAGE_MS = 2000;

function estSensible(type) {
  return Object.prototype.hasOwnProperty.call(CHAMPS_CLE, type);
}

// La cle qui identifie une action, ou null si elle ne s'identifie pas.
//
// UNE CLE PARTIELLE EST PIRE QUE PAS DE CLE: elle bloquerait une autre action
// que celle qu'on a vue lancer un combat. Un champ manquant rend donc null,
// jamais une cle amputee.
function cleDe(type, frame) {
  if (!estSensible(type)) return null;
  if (frame === null || typeof frame !== 'object') return null;
  const champs = frame.payload;
  if (!Array.isArray(champs)) return null;

  const parties = [type];
  for (const no of CHAMPS_CLE[type]) {
    const f = champs.find((x) => x && x.no === no);
    if (f === undefined || f.value === undefined || f.value === null) return null;
    // Le decodeur rend des BigInt: String() les met dans la meme forme que les
    // nombres, sans quoi la liste apprise ne reconnaitrait jamais l'action.
    parties.push(String(f.value));
  }
  return parties.join(':');
}

// superviseur — porte arme, annulerRejeux(), emettre(pid, octets),
//   comptes.esclaves(pidMaitre) et comptes.get(pid), qui rend
//   { pid, characterId }
// estApprise   — dit si une cle est deja connue; faux par defaut
// onApprendre  — recoit une cle a retenir
// onAnnulation — recoit le nombre de rejeux annules, jamais appele a zero.
//   Distinct de onJournal: celui-ci n'est visible que sous OMNI_JOURNAL=complet,
//   alors que l'annulation d'un rejeu en attente est un evenement que
//   l'utilisateur doit voir en usage normal, sans quoi rien ne relie
//   l'absence de suivi d'un esclave a sa cause.
// onJournal    — (pid, texte)
// maintenant   — injecte pour que les deux fenetres se testent sans dormir,
//   comme alea et planifier dans le superviseur
function creerGardeCombat({
  superviseur, estApprise = () => false, onApprendre = () => {},
  onAnnulation = () => {}, onJournal = () => {}, maintenant = Date.now,
}) {
  // La derniere action du maitre susceptible d'ouvrir un combat, datee, avec
  // le pid de qui l'a emise. Le pid sert a retrouver SON characterId quand la
  // kmk d'un esclave arrive: c'est lui qu'on cherche dans la liste.
  let derniereAction = { cle: null, instant: 0, pidMaitre: null };

  return function onTrame({ pid, dir, frame, estMaitre }) {
    // OMNI NE REPARE QUE CE QU'IL A CAUSE: sans duplication armee, aucun
    // esclave n'a rejoue quoi que ce soit.
    if (frame === null || !superviseur.arme) return;

    // LE TRAFIC DES ESCLAVES, que ce module ignorait entierement. C'est la
    // seule facon de voir le degat: le maitre, lui, ne sait pas dans quel
    // combat sont ses mules.
    if (!estMaitre) {
      if (dir !== 'in' || frame.type !== TYPE_COMBATTANTS) return;
      if (derniereAction.cle === null) return;
      if (maintenant() - derniereAction.instant >= FENETRE_APPRENTISSAGE_MS) return;
      // OMNI NE REPARE QUE CE QU'IL A CAUSE, ENCORE: un compte EXCLU de la
      // duplication (comptes.esclaves() le filtre deja, voir
      // src/protocol/compte.js) n'a rejoue aucune action du maitre. Son
      // combat, quel qu'il soit, ne nous regarde pas -- meme s'il s'ouvre
      // dans la fenetre. Sans cette garde, exclure un compte de la
      // duplication ne l'excluait pas de la retention.
      if (!superviseur.comptes.esclaves(derniereAction.pidMaitre).some((e) => e.pid === pid)) return;
      const siens = combattantsDe(frame);
      // null: une liste de carte, personne ne combat.
      if (siens === null) return;
      const etatMaitre = superviseur.comptes.get(derniereAction.pidMaitre);
      const idMaitre = etatMaitre === null || etatMaitre === undefined
        ? null : etatMaitre.characterId;
      if (idMaitre === null || idMaitre === undefined) {
        // Le characterId n'est appris que d'un `kvw` sortant (voir
        // src/protocol/compte.js); OMNI attache a des process deja lances
        // peut donc ne jamais le voir. LE SILENCE EST LE MODE D'ECHEC LE
        // PLUS COUTEUX DE CE PROJET (voir src/composer.js): sans cette
        // ligne, la politique s'eteint pour toute la session sans qu'aucune
        // trace ne le dise.
        onJournal(pid, 'garde combat : characterId du maitre inconnu, rien ne sera retenu');
        return;
      }
      // Le maitre est dans la liste: la mule l'a rejoint, tout va bien.
      if (siens.has(String(idMaitre))) return;

      const cle = derniereAction.cle;
      // Consommee AVANT d'apprendre: deux mules entrant chacune dans son
      // combat ne doivent produire qu'une entree, et onApprendre peut lever.
      derniereAction = { cle: null, instant: 0, pidMaitre: null };
      if (estApprise(cle)) return;
      try {
        onApprendre(cle);
        onJournal(pid, `garde combat : ${cle} retenue — cette mule combat sans le maitre`);
      } catch (e) {
        onJournal(pid, `garde combat : apprentissage de ${cle} en erreur : ${e.message}`);
      }
      return;
    }

    if (dir === 'out') {
      if (!estSensible(frame.type)) return;
      const cle = cleDe(frame.type, frame);
      if (cle !== null) derniereAction = { cle, instant: maintenant(), pidMaitre: pid };
      return;
    }

    // LE MAITRE ENTRE EN COMBAT: ce qui n'est pas encore ecrit ne partira pas.
    //
    // Meme trame et meme lecture que chez l'esclave, quinze lignes plus haut.
    // combattantsDe() rend null sur une liste d'acteurs de CARTE, ou personne
    // ne combat: c'est l'identifiant negatif d'un monstre, et lui seul, qui
    // fait d'une kmk une liste de combat.
    //
    // derniereAction n'est PAS consommee ici, et c'est delibere: la kmk du
    // maitre arrive avant celle de la mule (61 ms contre quelques centaines),
    // et l'apprentissage a besoin de l'action pour la retenir. « Restaurer la
    // symetrie » avec la branche esclave tuerait la retention en silence.
    if (frame.type !== TYPE_COMBATTANTS) return;
    if (combattantsDe(frame) === null) return;

    const annules = superviseur.annulerRejeux();
    if (annules > 0) {
      onJournal(pid, `garde combat : ${annules} rejeu(x) annule(s)`);
      onAnnulation(annules);
    }
  };
}

module.exports = {
  creerGardeCombat,
  estSensible, cleDe,
  TYPES_SENSIBLES,
  DELAI_PLANCHER_MS, FENETRE_APPRENTISSAGE_MS,
};
