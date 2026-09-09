'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

// Le dialogue rejoue, une etape a la fois et au rythme de la mule.
//
// POURQUOI CE MODULE EXISTE. Mesure du 09/09, journal-bug-0909.log, un maitre
// (17460) et trois mules devant le PNJ -20008, une quete en cours chez le seul
// maitre:
//
//   1048810 [15896] <-- imw { 1=2681 3={2=195} {2=193} {2=2284} }
//   1049082 [17460] --> inh { 1=56180 }        le maitre repond
//   1049111 [17460] <-- imw { 1=43122 ... }    il avance
//   1049371 [15896] rejeu inh ecrit (+283 ms)  la mule rejoue la meme reponse
//   1049400 [15896] <-- imw { 1=2681 ... }     LA MEME QUESTION
//   1049401 [15896] <-- log { 1=418 2=1 }      une erreur, chez la mule seule
//
// 56180 est une reponse DE QUETE: elle n'existe que dans l'arbre du maitre. Le
// serveur renvoie donc la meme question, et le dialogue de la mule NE SE FERME
// JAMAIS. Le maitre, lui, termine — le serveur lui envoie `kja` — mais `kja`
// est ENTRANT, et le duplicateur ne rejoue que le sortant: rien ne dit aux
// mules de fermer.
//
// CE QUE CA COUTE, ET C'EST LA LE VRAI DEFAUT. Une fenetre restee ouverte fait
// refuser le PNJ suivant:
//
//   1059598 [8328] rejeu imp ecrit (+358 ms)
//   1059627 [8328] <-- imq { }        refus: elle est deja en dialogue
//
// au lieu de `inn` + `imw`. Une seule reponse ratee casse tous les PNJ
// suivants. La preuve inverse est dans le meme journal: a 1037317 ms le maitre
// ferme SA fenetre a la main, le `kiy` se rejoue, et les trois mules se
// debloquent d'un coup.
//
// LA REGLE. Une etape par mule a la fois; la suivante attend que le serveur ait
// repondu A CETTE MULE. Une mule ne peut donc plus repondre a une question
// qu'elle n'a pas recue. Et quoi qu'il arrive — refus, silence, fin de file —
// la fenetre finit fermee.
//
// Le detail vit dans docs/superpowers/specs/2026-09-09-file-dialogue-design.md.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du reseau: il se teste
// avec un double du superviseur, une horloge et un planificateur injectes.

// Les trois requetes du maitre qui composent un dialogue. Elles sont
// repertoriees dans src/protocol/omni.js, toutes trois `verbatim`: les octets
// du maitre partent tels quels.
const TYPE_OUVERTURE = 'imp';
const TYPE_REPONSE = 'inh';
const TYPE_FERMETURE = 'kiy';

// Ce que la MULE recoit, et qui fait avancer sa file. Ces trois-la ne sont PAS
// dans src/protocol/omni.js: cette table decrit ce qui se REJOUE, et aucun de
// ceux-ci ne se rejoue.
const TYPE_QUESTION = 'imw';
const TYPE_REFUS_OUVERTURE = 'imq';
const TYPE_FERME = 'kja';
const CHAMP_QUESTION = 1;

// Le temps qu'il faut a quelqu'un pour lire une reponse et cliquer. Meme
// raisonnement que DELAI_REACTION dans src/echange.js.
//
// IL REMPLACE L'ETALEMENT CUMULE pour le dialogue, et c'est voulu: un compteur
// cumule le long d'une boucle n'a plus de sens quand chaque mule avance a son
// propre rythme. Trois tirages independants dans une fenetre de 450 ms
// suffisent a supprimer la simultaneite parfaite, seul role de l'etalement.
const DELAI_ETAPE = { minMs: 150, maxMs: 600 };

// Au-dela, on considere que le serveur ne repondra pas. La file se vide et la
// fenetre se ferme: mieux vaut une mule qui n'a pas suivi qu'une mule bloquee.
const DELAI_ATTENTE_MS = 3000;

const URL_FERMETURE = 'type.ankama.com/kiy';

// Constante: la fermeture ne recopie rien du dialogue en cours, comme
// TRAME_ACCEPTATION. Les octets sont ceux du jeu (journal-bug-0909.log,
// 918394 ms).
const TRAME_FERMETURE = encodeRaw([
  { no: 1, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'string', value: URL_FERMETURE },
      // Pas de champ 2: Any.value est vide, et un champ vide ne s'ecrit pas.
    ] },
    // uid = -1, comme toutes les requetes observees.
    { no: 2, wire: WIRE.VARINT, value: -1n },
  ] },
]);

const champ = (frame, no) => (frame.payload || []).find((f) => f.no === no) || null;

// superviseur   — porte emettre(pid, octets), comptes.get(pid),
//                 comptes.esclaves(pidMaitre) et le drapeau arme.
// onCompteRendu — recoit les sorties anormales: { pid, ok, raison, type }.
// delai         — { minMs, maxMs } entre deux etapes.
// alea, planifier, annuler, maintenant — injectes pour que la file se teste
//                 sans dormir.
function creerFileDialogue({
  superviseur, onCompteRendu = () => {}, delai = DELAI_ETAPE,
  alea = Math.random, planifier = setTimeout, annuler = clearTimeout,
  maintenant = () => Date.now(),
}) {
  // pid -> etat de file. ABSENT VEUT DIRE RIEN EN COURS: il n'y a pas de second
  // etat a tenir en accord avec celui-ci.
  const files = new Map();

  const etatDe = (pid) => {
    let e = files.get(pid);
    if (e === undefined) {
      e = {
        etapes: [], enVol: false, attend: null, minuteur: null,
        question: null, ouvert: false,
      };
      files.set(pid, e);
    }
    return e;
  };

  const retard = () => delai.minMs + Math.floor(alea() * (delai.maxMs - delai.minMs + 1));

  function leverAttente(e) {
    if (e.minuteur !== null) { annuler(e.minuteur); e.minuteur = null; }
    e.attend = null;
  }

  // La SEULE fonction qui ferme. Toutes les sorties passent par elle: c'est ce
  // qui garantit qu'aucune mule ne reste avec une fenetre ouverte.
  function fermer(pid, e) {
    if (!e.ouvert) return;
    e.ouvert = false;
    e.question = null;
    const etat = superviseur.comptes.get(pid);
    if (!superviseur.arme || etat === null || etat === undefined || etat.exclu) return;
    superviseur.emettre(pid, TRAME_FERMETURE);
  }

  // Une mule qui ne peut pas suivre: on vide sa file, on ferme, et on le DIT.
  // Une mule qui decroche en silence ressemble trait pour trait a une mule
  // inactive — le mode d'echec le plus couteux du projet.
  function echec(pid, raison) {
    const e = files.get(pid);
    if (e === undefined) return;
    const type = e.attend === null ? null : e.attend.type;
    e.etapes.length = 0;
    leverAttente(e);
    fermer(pid, e);
    onCompteRendu({ pid, ok: false, raison, type });
  }

  function avancer(pid) {
    const e = files.get(pid);
    if (e === undefined || e.enVol || e.attend !== null) return;
    const etape = e.etapes.shift();
    if (etape === undefined) {
      // FIN DE FILE: on ne ferme QUE si le maitre a fini son propre dialogue.
      // Entre deux de ses clics la file est vide et la fenetre ouverte — c'est
      // l'etat NORMAL d'un dialogue en cours, pas une mule oubliee. Fermer la
      // aurait coupe la mule pendant que le maitre lit sa reponse.
      if (e.maitreAFini) fermer(pid, e);
      return;
    }
    e.enVol = true;
    planifier(() => emettre(pid, etape), retard());
  }

  function emettre(pid, etape) {
    const e = files.get(pid);
    if (e === undefined) return;
    e.enVol = false;
    const etat = superviseur.comptes.get(pid);
    // Relu A L'ECHEANCE, pas a l'empilage: entre les deux, la case du compte a
    // pu se decocher, le client se fermer, et Windows reattribuer le pid a un
    // AUTRE client Dofus. Meme garde que src/passeur.js et src/echange.js.
    if (!superviseur.arme || etat === null || etat === undefined || etat.exclu) return;

    // OUVRIR FERME D'ABORD. C'est la ceinture, en plus des bretelles: meme si
    // `kja` etait renomme par un patch et que plus rien ne fermait, le `imq {}`
    // du 09/09 — le serveur qui refuse d'ouvrir parce qu'un dialogue traine —
    // deviendrait impossible.
    if (etape.type === TYPE_OUVERTURE && e.ouvert) fermer(pid, e);

    superviseur.emettre(pid, etape.brute);

    // DEMANDER L'OUVERTURE VAUT OUVERTURE tant qu'on n'a pas la preuve du
    // contraire. Sans cette ligne, une mule qui ouvre et a qui le serveur ne
    // repond jamais ne serait JAMAIS fermee: on croirait n'avoir rien ouvert.
    // Le prix de l'inverse est nul — une fermeture chez une mule qui n'a rien
    // d'ouvert est ignoree par le serveur (mesure du 08/09, deux `kiy` de
    // suite a 230048 et 230049 ms).
    if (etape.type === TYPE_OUVERTURE) e.ouvert = true;

    // Une fermeture n'appelle aucune reponse du serveur: armer une attente
    // derriere elle bloquerait la file 3 s a chaque dialogue termine.
    if (etape.type === TYPE_FERMETURE) {
      e.ouvert = false;
      e.question = null;
      avancer(pid);
      return;
    }

    // On retient la question d'AVANT l'envoi: si la MEME revient, la reponse a
    // ete refusee.
    e.attend = { type: etape.type, question: e.question };
    e.minuteur = planifier(
      () => echec(pid, 'aucune reponse du serveur en 3 s'), DELAI_ATTENTE_MS,
    );
  }

  // Empile une action du maitre chez chaque esclave. `esclaves()` ecarte deja
  // les comptes dont la case de rejeu est decochee.
  function pousser({ pidMaitre, type, brute }) {
    for (const etat of superviseur.comptes.esclaves(pidMaitre)) {
      const e = etatDe(etat.pid);
      // Le maitre agit de nouveau: son dialogue precedent est derriere nous.
      e.maitreAFini = false;
      e.etapes.push({ type, brute });
      avancer(etat.pid);
    }
  }

  function onTrame({ pid, dir, frame, estMaitre }) {
    if (dir !== 'in' || frame === null || frame === undefined) return;

    // LA FIN DU DIALOGUE DU MAITRE n'arrive que par un message ENTRANT — c'est
    // pour ca que le duplicateur ne pouvait pas la voir, il ne rejoue que le
    // sortant. Chaque mule finit sa file, PUIS ferme.
    if (estMaitre) {
      if (frame.type !== TYPE_FERME) return;
      for (const [autre, e] of files) { e.maitreAFini = true; avancer(autre); }
      return;
    }

    const e = files.get(pid);
    if (e === undefined) return;

    if (frame.type === TYPE_QUESTION) {
      const q = champ(frame, CHAMP_QUESTION);
      const valeur = q === null ? null : q.value;
      const attente = e.attend;
      e.ouvert = true;
      // LA MEME QUESTION QU'AVANT: la reponse a ete refusee. C'est le seul
      // signal de refus qui existe — le serveur ne renvoie aucune erreur que
      // nous sachions lire.
      if (attente !== null && attente.type === TYPE_REPONSE
          && attente.question !== null && valeur === attente.question) {
        echec(pid, 'la mule n a pas cette reponse');
        return;
      }
      e.question = valeur;
      leverAttente(e);
      avancer(pid);
      return;
    }

    if (frame.type === TYPE_REFUS_OUVERTURE) {
      echec(pid, 'la mule n a pas pu ouvrir le dialogue');
      return;
    }

    if (frame.type === TYPE_FERME) {
      // Le serveur referme de lui-meme a la derniere reponse d'un arbre: il n'y
      // a plus rien a fermer, et un kiy de plus partirait dans le vide.
      e.ouvert = false;
      e.question = null;
      leverAttente(e);
      avancer(pid);
    }
  }

  return { onTrame, pousser };
}

module.exports = {
  creerFileDialogue, DELAI_ETAPE, DELAI_ATTENTE_MS, TRAME_FERMETURE,
  TYPE_OUVERTURE, TYPE_REPONSE, TYPE_FERMETURE,
  TYPE_QUESTION, TYPE_REFUS_OUVERTURE, TYPE_FERME, CHAMP_QUESTION,
};
