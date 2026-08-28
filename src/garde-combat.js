'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

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
// LA FENETRE. Le rejeu part 16 a 80 ms apres l'action du maitre, et le serveur
// annonce le combat au maitre en 30 ms. Un rejeu retarde peut donc etre annule
// avant d'etre ecrit. C'est tout le mecanisme.
//
// LE SIGNAL. `ieb` sur le flux entrant. Sur 58 changements de carte du journal
// du 28/08, six seulement en portent un — et ce sont exactement les entrees en
// combat. Tous les autres messages de la rafale d'entree (iom, kld, kml, kmp,
// kub, lqn) apparaissent aussi sur des changements de carte ordinaires.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme.

const TYPE_ENTREE_COMBAT = 'ieb';

// Les seuls types rejoues qui peuvent ouvrir un combat. Les cinq autres —
// teleportation, changement de carte, information de carte, havre-sac, sortie
// de donjon — n'en ouvrent aucun, et les retarder ne protegerait de rien.
//
// La valeur est la liste des champs qui IDENTIFIENT l'action, dans l'ordre ou
// ils composent la cle.
const CHAMPS_CLE = {
  iov: [2, 3],   // la carte, puis l'instance de PNJ
  ioy: [1],      // le numero de reponse dans l'arbre de dialogue
  iwo: [2],      // l'element interactif (le champ 1 est propre au compte)
};

const TYPES_SENSIBLES = Object.keys(CHAMPS_CLE);

// Plancher avant l'ecriture du premier esclave, contre 16 ms d'etalement seul.
// Le signal a ete mesure a 30 ms; le facteur 8 couvre la gigue reseau sans
// etre perceptible sur une interaction de quete.
const DELAI_PLANCHER_MS = 250;

// Au-dela, on ne retient plus: un monstre agressif qui saute sur le maitre
// trois secondes apres un dialogue anodin n'a pas a empoisonner la liste.
const FENETRE_APPRENTISSAGE_MS = 2000;

// Au-dela, on ne ferme plus le dialogue des esclaves: il n'y en a plus.
const FENETRE_DIALOGUE_MS = 30000;

const URL_FERMER_DIALOGUE = 'type.ankama.com/kla';

// DialogLeaveRequest, constante et vide. Meme enveloppe que TRAME_PASSE dans
// src/passeur.js: request { Any{ type_url }, uid: -1 }. kla ne porte aucun
// champ (voir src/protocol/omni.js), donc rien n'y depend du destinataire.
//
// L'uid de -1 est repris de la trame jxy mesuree le 20/08, faute d'avoir
// mesure celui d'un kla reel. A confirmer en conditions reelles.
const TRAME_FERMER_DIALOGUE = encodeRaw([
  { no: 2, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'string', value: URL_FERMER_DIALOGUE },
    ] },
    { no: 2, wire: WIRE.VARINT, value: -1n },
  ] },
]);

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

// superviseur — porte arme, annulerRejeux(), emettre(pid, octets) et
//   comptes.esclaves(pidMaitre)
// estApprise  — dit si une cle est deja connue; faux par defaut
// onApprendre — recoit une cle a retenir
// onJournal   — (pid, texte)
// maintenant  — injecte pour que les deux fenetres se testent sans dormir,
//   comme alea et planifier dans le superviseur
function creerGardeCombat({
  superviseur, estApprise = () => false, onApprendre = () => {},
  onJournal = () => {}, maintenant = Date.now,
}) {
  // La derniere action du maitre susceptible d'ouvrir un combat, datee. On ne
  // sait pas encore si elle est dangereuse: c'est le combat qui le dira.
  let derniereAction = { cle: null, instant: 0 };
  // Date a part, parce qu'elle repond a une autre question: faut-il fermer le
  // dialogue des esclaves? Un element interactif n'en ouvre aucun. null tant
  // qu'aucun dialogue n'a ete vu: avec maintenant() injecte, l'horloge de
  // test part d'une petite valeur, et un 0 s'y ferait passer pour "recent".
  let dernierDialogue = null;

  return function onTrame({ pid, dir, frame, estMaitre }) {
    // OMNI NE REPARE QUE CE QU'IL A CAUSE: sans duplication armee, aucun
    // esclave n'a rejoue quoi que ce soit.
    if (frame === null || !estMaitre || !superviseur.arme) return;

    if (dir === 'out') {
      if (!estSensible(frame.type)) return;
      const cle = cleDe(frame.type, frame);
      if (cle !== null) derniereAction = { cle, instant: maintenant() };
      if (frame.type === 'iov' || frame.type === 'ioy') dernierDialogue = maintenant();
      return;
    }

    if (frame.type !== TYPE_ENTREE_COMBAT) return;

    // 1. Ce qui n'est pas encore ecrit ne partira pas.
    const annules = superviseur.annulerRejeux();
    if (annules > 0) onJournal(pid, `garde combat : ${annules} rejeu(x) annule(s)`);

    // 2. Retenir, mais seulement si l'action est fraiche.
    const depuis = maintenant() - derniereAction.instant;
    if (derniereAction.cle !== null && depuis < FENETRE_APPRENTISSAGE_MS) {
      if (!estApprise(derniereAction.cle)) {
        onApprendre(derniereAction.cle);
        onJournal(pid, `garde combat : ${derniereAction.cle} retenue (+${depuis} ms)`);
      }
      // Consommee: un second ieb sur le meme combat ne doit pas la reprendre.
      derniereAction = { cle: null, instant: 0 };
    }

    // 3. Fermer le dialogue des esclaves, s'il y en a un.
    if (dernierDialogue === null || maintenant() - dernierDialogue >= FENETRE_DIALOGUE_MS) return;
    for (const etat of superviseur.comptes.esclaves(pid)) {
      const r = superviseur.emettre(etat.pid, TRAME_FERMER_DIALOGUE);
      if (!r.ok) onJournal(etat.pid, `garde combat : fermeture du dialogue refusee : ${r.raison}`);
    }
  };
}

module.exports = {
  creerGardeCombat,
  estSensible, cleDe, TRAME_FERMER_DIALOGUE,
  TYPES_SENSIBLES, TYPE_ENTREE_COMBAT,
  DELAI_PLANCHER_MS, FENETRE_APPRENTISSAGE_MS, FENETRE_DIALOGUE_MS,
};
