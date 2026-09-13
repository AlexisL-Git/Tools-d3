'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');
const { estSensible, DELAI_PLANCHER_MS } = require('./garde-combat');

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

// LE REESSAI D'OUVERTURE. Mesure du 13/09 (journal-bug-0909.log, mule 9276,
// zaapi -20004): la MEME trame `imp` est refusee a 115267 ms et acceptee a
// 122324 ms, identique octet pour octet. Entre les deux, la mule a marche
// (`jpt` a 119740 et 121356 ms). Le refus porte donc sur une POSITION, pas sur
// le contenu de la trame — meme condition que celle qui a ecarte `jpp` et
// `jrh` le 28/08.
//
// On renvoie le meme clic, et c'est le suivi de groupe DU JEU qui amene la
// mule a portee. OMNI ne fabrique aucun deplacement: l'utilisateur a ecarte
// cette piste le 03/09, et de nouveau le 13/09.
//
// SIX ESSAIS AU TOTAL, donc cinq reessais: 4 s, plus le delai humain du
// premier envoi. Au-dela, une mule qui n'est pas arrivee est bloquee ailleurs,
// et insister n'y changerait rien.
const ESSAIS_OUVERTURE = 6;
const DELAI_REESSAI_MS = 800;

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
  superviseur, onCompteRendu = () => {}, onJournal = () => {}, delai = DELAI_ETAPE,
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
        minuteurEtape: null, question: null, ouvert: false, notre: false,
        ouverture: null, essais: 0,
      };
      files.set(pid, e);
    }
    return e;
  };

  // LE PLANCHER DU GARDE-COMBAT, rendu a la file le 13/09. Le delai humain
  // seul ne suffit pas: il se tire des 150 ms, et le serveur annonce le combat
  // du maitre en 149 ms (journal-bug-0909.log, 832531 -> 832680). Sous le
  // plancher, l'etape part avant que le garde ait pu l'annuler.
  //
  // Il ne s'applique qu'aux types que le garde surveille. Une fermeture
  // (`kiy`) n'ouvre aucun combat, et la retarder ne protegerait de rien.
  const retard = (type) => {
    const humain = delai.minMs + Math.floor(alea() * (delai.maxMs - delai.minMs + 1));
    return estSensible(type) ? Math.max(humain, DELAI_PLANCHER_MS) : humain;
  };

  function leverAttente(e) {
    if (e.minuteur !== null) { annuler(e.minuteur); e.minuteur = null; }
    e.attend = null;
  }

  // La SEULE fonction qui ferme. Toutes les sorties passent par elle: c'est ce
  // qui garantit qu'aucune mule ne reste avec une fenetre ouverte.
  //
  // ELLE NE FERME QUE CE QUE LA FILE A OUVERT. Defaut mesure le 13/09: quand
  // l'utilisateur prend la main sur une mule et parle a un PNJ, la question
  // arrivait ici comme une des notres et la file fermait 38 ms plus tard
  // (journal-bug-0909.log, 309330 -> 309368). Un dialogue ouvert a la main
  // n'appartient pas a la file.
  //
  // `force` est reserve a « ouvrir ferme d'abord »: la, il FAUT faire place
  // nette, quelle que soit l'origine du dialogue qui traine, sans quoi le
  // serveur refuse l'ouverture par un `imq {}` (mesure du 09/09).
  function fermer(pid, e, force = false) {
    if (!e.ouvert) return;
    if (!force && !e.notre) return;
    e.ouvert = false;
    e.notre = false;
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
    e.ouverture = null;
    e.essais = 0;
    fermer(pid, e);
    onCompteRendu({ pid, ok: false, raison, type });
  }

  // Le serveur n'a rien renvoye dans le delai. Ce que ca veut dire depend de ce
  // qu'on attendait, et LES DEUX CAS SONT OPPOSES:
  //
  //   - apres une REPONSE, la fenetre est ouverte et le dialogue ne bouge plus:
  //     c'est exactement la mule bloquee du 09/09. On ferme, on le dit.
  //   - apres une OUVERTURE, l'absence de question est NORMALE: la boutique
  //     d'un marchand passe par le meme `imp` (action 11) et repond par sa
  //     liste d'articles, pas par une question. Fermer la aurait ferme la
  //     boutique des mules 3 s apres l'ouverture — donc avant l'achat, qui
  //     vient une dizaine de secondes plus tard (mesure du 08/09: ouverture a
  //     219435 ms, achat a 229028 ms). On leve l'attente et on continue, sans
  //     compte rendu: une boutique n'est pas un incident.
  //
  // La fenetre d'une mule dont l'ouverture est restee muette sera fermee par
  // l'ouverture suivante — c'est a ca que sert « ouvrir ferme d'abord ».
  function abandonner(pid, type) {
    if (type === TYPE_REPONSE) return echec(pid, 'aucune reponse du serveur en 3 s');
    const e = files.get(pid);
    if (e === undefined) return;
    leverAttente(e);
    avancer(pid);
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
    // Retenu: sans lui, une etape en vol ne peut plus etre annulee, et c'est
    // exactement ce que le garde-combat avait perdu.
    e.minuteurEtape = planifier(() => emettre(pid, etape), retard(etape.type));
  }

  function emettre(pid, etape, estReessai = false) {
    const e = files.get(pid);
    if (e === undefined) return;
    e.enVol = false;
    e.minuteurEtape = null;
    const etat = superviseur.comptes.get(pid);
    // Relu A L'ECHEANCE, pas a l'empilage: entre les deux, la case du compte a
    // pu se decocher, le client se fermer, et Windows reattribuer le pid a un
    // AUTRE client Dofus. Meme garde que src/passeur.js et src/echange.js.
    if (!superviseur.arme || etat === null || etat === undefined || etat.exclu) return;

    // OUVRIR FERME D'ABORD. C'est la ceinture, en plus des bretelles: meme si
    // `kja` etait renomme par un patch et que plus rien ne fermait, le `imq {}`
    // du 09/09 — le serveur qui refuse d'ouvrir parce qu'un dialogue traine —
    // deviendrait impossible.
    if (etape.type === TYPE_OUVERTURE && e.ouvert) fermer(pid, e, true);

    // LE RANG DE L'ESSAI, remis a 1 pour une ouverture NEUVE seulement. Un
    // reessai repasse par ici: sans `estReessai`, le compteur repartirait de 1
    // a chaque tour et la mule insisterait sans fin.
    if (etape.type === TYPE_OUVERTURE) {
      e.ouverture = etape;
      if (!estReessai) e.essais = 1;
    }

    const rendu = superviseur.emettre(pid, etape.brute);

    // LA LIGNE QUI MANQUAIT. La file ecrit par superviseur.emettre(), qui ne
    // journalise pas — contrairement a rejouer(). Le 09/09 on lisait encore
    // « rejeu imp ecrit (+358 ms) » dans le journal; le 13/09 plus rien pour
    // imp, inh ni kiy, et ce trou a coute une soiree de diagnostic: on ne
    // voyait pas si le clic partait. La capture ne les voit pas non plus — une
    // trame injectee est ecrite sur la socket amont sans repasser par le
    // reassembleur.
    const rang = etape.type === TYPE_OUVERTURE
      ? ` (essai ${e.essais}/${ESSAIS_OUVERTURE})` : '';
    if (rendu !== null && rendu !== undefined && rendu.ok === false) {
      onJournal(pid, `rejeu ${etape.type} refuse : ${rendu.raison}`);
    } else onJournal(pid, `rejeu ${etape.type} ecrit${rang}`);

    // DEMANDER L'OUVERTURE VAUT OUVERTURE tant qu'on n'a pas la preuve du
    // contraire. Sans cette ligne, une mule qui ouvre et a qui le serveur ne
    // repond jamais ne serait JAMAIS fermee: on croirait n'avoir rien ouvert.
    // Le prix de l'inverse est nul — une fermeture chez une mule qui n'a rien
    // d'ouvert est ignoree par le serveur (mesure du 08/09, deux `kiy` de
    // suite a 230048 et 230049 ms).
    // LA FILE EST CHEZ ELLE DES QU'ELLE A ECRIT. Une ouverture, evidemment,
    // mais une REPONSE aussi: OMNI attache a des clients deja en jeu, ou une
    // mule reintegree en plein dialogue, commence sa file par un `inh` sans
    // ouverture avant lui. Sans cette ligne, la question suivante ne la ferait
    // plus avancer et sa pile resterait bloquee jusqu'au delai de 3 s.
    if (etape.type === TYPE_OUVERTURE) e.ouvert = true;
    if (etape.type !== TYPE_FERMETURE) e.notre = true;

    // Une fermeture n'appelle aucune reponse du serveur: armer une attente
    // derriere elle bloquerait la file 3 s a chaque dialogue termine.
    if (etape.type === TYPE_FERMETURE) {
      e.ouvert = false;
      // ET LA FILE N'EST PLUS CHEZ ELLE. Sans cette ligne, `notre` survivait a
      // toute fermeture rejouee: la file se croyait encore proprietaire, et le
      // dialogue suivant — meme ouvert a la main par l'utilisateur — avancait
      // jusqu'a « fin de file, le maitre a fini », donc se fermait tout seul
      // (zaapi, mesure du 13/09, 122364 -> 122402 ms).
      e.notre = false;
      e.question = null;
      avancer(pid);
      return;
    }

    // On retient la question d'AVANT l'envoi: si la MEME revient, la reponse a
    // ete refusee.
    e.attend = { type: etape.type, question: e.question };
    e.minuteur = planifier(() => abandonner(pid, etape.type), DELAI_ATTENTE_MS);
  }

  // CE QUI N'EST PAS ENCORE PARTI NE PARTIRA PAS. Le pendant, pour la file, de
  // superviseur.annulerRejeux(): le garde-combat appelle les deux quand le
  // maitre entre en combat.
  //
  // LA FILE ENTIERE, PAS SEULEMENT L'ETAPE EN VOL. Retirer la seule etape en
  // vol ne faisait que la REPOUSSER: les etapes encore empilees restaient, et
  // la prochaine action du maitre relancait la file — donc la reponse de quete
  // qui ouvre le combat, avec un tour de retard. Verifie en jeu de tete le
  // 13/09 sur la file doublee (`imp` puis `inh`): l'`inh` repartait.
  //
  // ON N'EMET RIEN, comme le garde depuis le 02/09: une mule dont l'etape est
  // annulee avant son envoi n'a jamais ouvert la fenetre. Celle qui l'avait
  // deja ouverte sera fermee par l'ouverture suivante — c'est a ca que sert
  // « ouvrir ferme d'abord » dans emettre().
  function annulerEnVol(pidMaitre) {
    let annules = 0;
    for (const etat of superviseur.comptes.esclaves(pidMaitre)) {
      const e = files.get(etat.pid);
      if (e === undefined) continue;
      if (e.enVol && e.minuteurEtape !== null) {
        annuler(e.minuteurEtape);
        e.minuteurEtape = null;
        e.enVol = false;
        annules += 1;
      }
      annules += e.etapes.length;
      e.etapes.length = 0;
      // CE QUI N'EST PAS PARTI NE PARTIRA PAS, le reessai compris: sans ces
      // deux lignes, le minuteur annule laisserait une ouverture prete a
      // repartir au refus suivant.
      e.ouverture = null;
      e.essais = 0;
    }
    return annules;
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
      // PAS LA NOTRE: l'utilisateur a pris la main sur cette mule. On retient
      // qu'une fenetre est ouverte -- « ouvrir ferme d'abord » en aura besoin
      // -- et on ne fait rien d'autre. Ni avancer, ni fermer, ni compte rendu:
      // ce dialogue ne nous regarde pas.
      if (!e.notre) return;
      // LA MEME QUESTION QU'AVANT: la reponse a ete refusee. C'est le seul
      // signal de refus qui existe — le serveur ne renvoie aucune erreur que
      // nous sachions lire.
      if (attente !== null && attente.type === TYPE_REPONSE
          && attente.question !== null && valeur === attente.question) {
        echec(pid, 'la mule n a pas cette reponse');
        return;
      }
      e.question = valeur;
      // La question est arrivee: plus rien a reessayer.
      e.ouverture = null;
      e.essais = 0;
      leverAttente(e);
      avancer(pid);
      return;
    }

    if (frame.type === TYPE_REFUS_OUVERTURE) {
      // ON RENVOIE LE MEME CLIC. Voir ESSAIS_OUVERTURE en tete: le refus porte
      // sur la position de la mule, pas sur la trame.
      //
      // Le reessai repasse par emettre(), donc par « ouvrir ferme d'abord »:
      // il couvre du meme coup l'AUTRE sens de `imq` — un dialogue qui traine,
      // mesure le 09/09 — sans avoir a distinguer les deux causes, ce que
      // `imq {}` ne permet pas: il est vide.
      if (e.attend !== null && e.attend.type === TYPE_OUVERTURE
          && e.ouverture !== null && e.essais < ESSAIS_OUVERTURE) {
        const aRenvoyer = e.ouverture;
        e.essais += 1;
        leverAttente(e);
        // OCCUPEE jusqu'a l'echeance: sans ca, avancer() tirerait l'etape
        // suivante entre deux essais et la reponse partirait avant la question.
        e.enVol = true;
        e.minuteurEtape = planifier(
          () => emettre(pid, aRenvoyer, true), DELAI_REESSAI_MS,
        );
        return;
      }
      echec(pid, `la mule n a pas pu ouvrir le dialogue (${e.essais} essai(s), trop loin ?)`);
      return;
    }

    if (frame.type === TYPE_FERME) {
      // Le serveur referme de lui-meme a la derniere reponse d'un arbre: il n'y
      // a plus rien a fermer, et un kiy de plus partirait dans le vide.
      e.ouvert = false;
      e.notre = false;
      e.question = null;
      leverAttente(e);
      avancer(pid);
    }
  }

  return { onTrame, pousser, annulerEnVol };
}

module.exports = {
  creerFileDialogue, DELAI_ETAPE, DELAI_ATTENTE_MS, TRAME_FERMETURE,
  ESSAIS_OUVERTURE, DELAI_REESSAI_MS,
  TYPE_OUVERTURE, TYPE_REPONSE, TYPE_FERMETURE,
  TYPE_QUESTION, TYPE_REFUS_OUVERTURE, TYPE_FERME, CHAMP_QUESTION,
};
