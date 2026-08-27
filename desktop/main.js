'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, globalShortcut, dialog } = require('electron');

const { Superviseur } = require('../src/superviseur');
const { creerDuplicateur, ETALEMENT_REJEU } = require('../src/duplicateur');
const { creerPasseur } = require('../src/passeur');
const { creerAccepteur } = require('../src/invitation');
const { creerAccepteurEchange, DELAI_REACTION } = require('../src/echange');
const { creerTransformateurFlux } = require('../src/noanim-flux');
const { composer } = require('../src/composer');
const { lireComptes } = require('../src/comptes/zaap');
const { listerClients, fermerClients } = require('../src/comptes/clients');
const { construireVue } = require('../src/comptes/vue');
const { resoudreMaitre } = require('../src/comptes/maitre');
const { creerEmblemes } = require('../src/comptes/emblemes');
const { ordonner, suivant, precedent } = require('../src/comptes/navigation');
const { COLONNES, parNom, cibleBascule } = require('../src/comptes/colonnes');
const { Favoris } = require('../src/comptes/favoris');
const { findDofusProcesses } = require('../src/injector');
const { lireDevlog, CHEMIN: CHEMIN_DEVLOG } = require('./devlog');
const { estSouris, depuisBouton } = require('../src/comptes/raccourcis');

const PERIODE_PROCESS = 500;    // prise en charge des nouveaux clients
const PERIODE_VUE = 2000;       // rafraichissement de la liste affichee
// Delai laisse a un client fraichement attache pour produire sa premiere
// trame. Mesure: un client lance derriere le proxy ouvre sa connexion des
// l'ecran de connexion et le serveur repond en moins d'une seconde. Passe ce
// delai sans une seule trame, la conclusion est acquise: sa session s'est
// ouverte ailleurs, il est irrattrapable. Genereux expres — se tromper ici
// coute un mauvais conseil (« relance ce client ») a un client parfaitement
// sain.
const DELAI_PREUVE_TRAFIC = 10000;
// Duree pendant laquelle la liste des clients est reutilisee sans redemander a
// Windows. Un client ne va pas apparaitre ni disparaitre en moins d'une
// seconde, et le balayage des process tourne de toute facon toutes les 500 ms.
const FRAICHEUR_CLIENTS = 1000;

let fenetre = null;
let superviseur = null;
let favoris = null;
let emblemes = null;
let comptes = [];
let erreurComptes = null;
// Cinq ensembles distincts, et les confondre coute cher: `vus` evite de
// retenter sans fin une attache impossible, `prisEnCharge` ne contient que les
// clients dont l'agent est en place, `erreurs` dit pourquoi les autres n'y
// sont pas.
//
// `avecTrafic` est celui que la vue lit comme preuve d'interception, et
// prisEnCharge NE SUFFIT PAS: l'agent detourne `connect` pour les connexions a
// venir, donc il s'injecte parfaitement dans un client deja connecte, dont la
// session restera pourtant hors du proxy. Affiche « suit », ce client ne
// rejouait rien — faux positif observe le 22/08 (client a 13:09, application a
// 14:27). Seule une trame decodee le prouve.
//
// `attacheA` date l'attache, pour ne pas remplacer ce faux positif par un faux
// negatif pendant la seconde qui precede la premiere trame.
const vus = new Set();
const prisEnCharge = new Set();
const avecTrafic = new Set();   // pid -> au moins une trame decodee a traverse
const attacheA = new Map();     // pid -> instant de l'attache reussie
const erreurs = new Map();      // pid -> message d'echec d'attache
const messages = new Map();     // pid -> dernier refus de rejeu, pour l'affichage
// LE COUT CACHE DE listerClients(): un lancement de powershell.exe, entre 150
// et 400 ms. Il etait paye a CHAQUE envoi d'etat, donc a chaque clic, et
// l'interface ne repondait qu'au retour du process — c'est tout le « delai
// desagreable » ressenti au clic.
//
// Deux problemes en un, d'ailleurs: l'envoi d'etat revient toutes les 2 s sans
// aucune garde, donc deux appels pouvaient se chevaucher et empiler des
// process. Une seule requete est desormais en vol a la fois.
let clientsCache = { instant: 0, valeur: [], enVol: null };

// LE DERNIER REFUS DE BASCULE, pour l'afficher.
//
// naviguer() et basculerVersCompte() abandonnaient EN SILENCE dans trois cas:
// aucun client pilote, compte sans client, agent pas encore en place. Vu de
// l'utilisateur, la touche « ne faisait rien », et c'est le mode d'echec le
// plus couteux de ce projet — celui qu'aucune trace ne relie a sa cause.
//
// Il s'efface tout seul: un refus vieux de dix secondes ne decrit plus rien.
const DUREE_AVIS = 10000;
let avisBascule = { texte: null, instant: 0 };

// LA CARTE DES PIDS, TENUE A JOUR PAR L'ENVOI D'ETAT.
//
// basculerVersCompte() refaisait un listerClients() pour retrouver le pid d'un
// compte, donc relancait powershell.exe des que le cache avait plus d'une
// seconde: 150 a 400 ms entre le clic et la bascule. Sur un selecteur de
// fenetre, ce delai est tout ce qu'on ressent.
//
// L'etat envoye a l'interface porte deja le pid de chaque ligne, et il est
// reconstruit toutes les 2 s. On le garde ici, et la bascule devient
// instantanee: aucun process a lancer, aucune attente.
let carteComptes = new Map();   // idCompte -> pid
let ordreNavigation = [];       // pids, dans l'ordre affiche

// LE CURSEUR DU CYCLE, et rien d'autre.
//
// « Suivant » partait du client au premier plan, ce qui obligeait a le
// SURVEILLER: chaque agent sondait GetForegroundWindow toutes les 250 ms a
// l'interieur du jeu. Et le resultat surprenait — depuis le navigateur ou
// depuis OMNI, le premier plan est inconnu et « suivant » revenait au premier
// de la liste au lieu d'avancer d'un cran.
//
// C'est desormais un cycle franc: on retient le dernier client vise, et on
// avance a partir de la. Le pid est retenu plutot que l'indice, parce qu'un
// client qui se ferme decale toute la liste et rendrait un indice faux.
let curseurNav = null;

// LA FERMETURE EMPORTE LES CLIENTS, MAIS ON DEMANDE.
//
// LES CLIENTS SONT DEJA CONDAMNES QUAND OMNI S'ARRETE, et c'est structurel:
// chaque client se connecte au serveur de jeu A TRAVERS un proxy local
// qu'heberge OMNI (voir src/proxy/server.js). OMNI meurt, les sockets tombent,
// et le jeu perd sa session — « la connexion a ete perdue ».
//
// Les fermer n'est donc pas une decision agressive: c'est ranger des fenetres
// qui viennent d'etre deconnectees et qu'il faudrait relancer de toute facon.
//
// On demande quand meme. La croix est juste a cote du bouton reduire, et le
// bouton « fermer les clients » exige deja deux clics pour cette raison exacte.
let fermetureAutorisee = false;
// Vrai des que l'utilisateur a repondu a la question de fermeture. Il a peut
// etre choisi de GARDER ses clients: la coupure brutale ci-dessous ne doit pas
// revenir sur sa decision.
let sortieDecidee = false;

async function demanderFermeture() {
  const clients = await clientsRecents();
  if (clients.length === 0) {
    fermetureAutorisee = true;
    if (fenetre && !fenetre.isDestroyed()) fenetre.close();
    return;
  }

  const combien = clients.length;
  const choix = await dialog.showMessageBox(fenetre, {
    type: 'question',
    noLink: true,
    title: 'Fermer OMNI',
    message: combien > 1
      ? `${combien} clients Dofus sont ouverts.`
      : 'Un client Dofus est ouvert.',
    detail: 'Leur connexion au serveur passe par OMNI : ils seront déconnectés '
      + 'de toute façon en le fermant. Les fermer aussi évite de laisser des '
      + 'fenêtres inutilisables.',
    buttons: [
      combien > 1 ? `Fermer OMNI et les ${combien} clients` : 'Fermer OMNI et le client',
      'Laisser les fenêtres ouvertes',
      'Annuler',
    ],
    defaultId: 0,
    cancelId: 2,
  });

  if (choix.response === 2) return;   // annule: la fenetre reste ouverte

  if (choix.response === 0) {
    const rendu = fermerClients(clients.map((c) => c.pid));
    for (const r of rendu) {
      journal(r.pid, r.ok ? 'client ferme a la fermeture d OMNI' : `fermeture impossible : ${r.raison}`);
    }
  }

  sortieDecidee = true;
  fermetureAutorisee = true;
  if (fenetre && !fenetre.isDestroyed()) fenetre.close();
}

// QUAND OMNI SE COUPE SANS PREVENIR.
//
// Plus rien ne peut etre demande, et surtout rien d'asynchrone ne s'executera:
// au moment de mourir, il ne reste que du code synchrone. `fermerClients`
// convient, il repose sur process.kill.
//
// Les pids viennent de la DERNIERE VUE envoyee, jamais de listerClients: celui
// la lance un powershell.exe, et un process qui meurt n'a pas le temps de
// l'attendre.
//
// CE QUI ECHAPPE A TOUT CA: un arret force (taskkill /F, plantage du process
// entier, coupure de courant). Aucun code ne tourne, et les clients survivent.
// Il n'existe pas de moyen d'y remedier depuis l'application elle-meme.
function fermerClientsConnus() {
  if (ordreNavigation.length === 0) return;
  try {
    fermerClients(ordreNavigation);
  } catch (e) {
    // On est deja en train de mourir: il n'y a personne a qui rendre l'echec.
  }
}

process.on('exit', () => {
  if (sortieDecidee) return;   // l'utilisateur a deja tranche
  fermerClientsConnus();
});

// Un signal ne declenche pas 'exit' tout seul: on le provoque, pour passer par
// le meme chemin que le reste.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => process.exit(0));
}

// Une exception non capturee tue le process sans passer par la fermeture
// normale. Elle est journalisee — sinon l'ami n'a aucune trace — puis on sort
// par le chemin habituel, qui emportera les clients.
process.on('uncaughtException', (e) => {
  journal('panne', `exception non capturee : ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});

// Meme trou, cote promesses: naviguer() et basculerVersCompte() lancent
// envoyerEtat() sans l'attendre, et un rejet de cette promesse orpheline ne
// passe par aucun catch. Sans ce filet, il tuerait le process en silence, en
// emportant tous les clients Dofus de l'utilisateur — exactement ce que le
// filet de jouerSouris essaie d'eviter. Meme journalisation, meme sortie que
// uncaughtException: un rejet non rattrape est du meme ordre de gravite
// qu'une exception non capturee, et le laisser continuer sans sortir
// laisserait le process dans un etat que personne n'a valide.
process.on('unhandledRejection', (raison) => {
  journal('panne', `rejet non capture : ${raison && raison.stack ? raison.stack : raison}`);
  process.exit(1);
});

// Le clic sur une identite deplace le curseur, sinon le raccourci suivant
// repartirait d'ou on etait avant le clic.
function poserCurseur(pid) {
  curseurNav = pid;
}

function noterAvis(texte) {
  avisBascule = { texte, instant: Date.now() };
}

function avisCourant() {
  if (avisBascule.texte === null) return null;
  if (Date.now() - avisBascule.instant > DUREE_AVIS) return null;
  return avisBascule.texte;
}

async function clientsRecents() {
  if (Date.now() - clientsCache.instant < FRAICHEUR_CLIENTS) return clientsCache.valeur;
  if (clientsCache.enVol !== null) return clientsCache.enVol;
  clientsCache.enVol = listerClients()
    .then((v) => {
      clientsCache = { instant: Date.now(), valeur: v, enVol: null };
      return v;
    })
    .catch(() => {
      // listerClients rend deja [] sur erreur; ce filet ne sert qu'a ne pas
      // laisser une promesse rejetee coincee dans le cache.
      clientsCache.enVol = null;
      return clientsCache.valeur;
    });
  return clientsCache.enVol;
}

let minuteurProcess = null;
let minuteurVue = null;
// Ces quatre objets sont relus a chaque trame par les politiques: modifier le
// champ suffit, sans rien reconstruire.
//
// LEUR `actif` NE SE REGLE PLUS UN PAR UN. Les cinq interrupteurs generaux ont
// disparu: ils formaient un second niveau que rien ne reliait aux cases par
// compte, et une case cochee sous un general eteint ne faisait rien sans que ca
// se voie. Un interrupteur UNIQUE les pilote maintenant tous les cinq, plus
// `superviseur.arme`. Ce sont les cases par compte qui decident du reste.
const reglagesPasseTour = { actif: false, delaiMs: 0 };
const reglagesInvitation = { actif: false };
const reglagesNoAnim = { actif: false };
const reglagesEchange = { actif: false };

// Suspendre n'efface rien: les cases par compte restent ou elles sont, et on
// reprend exactement dans l'etat d'avant.
function appliquerActif(actif) {
  const v = Boolean(actif);
  superviseur.arme = v;
  reglagesPasseTour.actif = v;
  reglagesInvitation.actif = v;
  reglagesNoAnim.actif = v;
  reglagesEchange.actif = v;
}

const DEPART = Date.now();
// Ni trames brutes, ni etat interne chez un ami: le journal detaille ne
// s'allume que sur demande explicite. Mettre OMNI_JOURNAL=complet pour
// retrouver la sortie qui a servi a diagnostiquer le passe-tour et le no-anim.
const JOURNAL_COMPLET = process.env.OMNI_JOURNAL === 'complet';

// Le journal doit atterrir dans un FICHIER, pas seulement dans la console.
// Lance par outils/lancer-dev.vbs, OMNI tourne sans console attachee: tout ce
// que console.log ecrit est perdu, et un diagnostic muet ressemble trait pour
// trait a un diagnostic qui n'a rien vu. Le meme piege a deja coute une soiree
// sur faire-etape.js.
let cheminJournal = null;
function fichierJournal() {
  if (cheminJournal === null) {
    cheminJournal = process.env.OMNI_JOURNAL_FICHIER
      || path.join(process.env.OMNI_DEV || app.getPath('userData'), 'journal-dev.log');
    try { fs.writeFileSync(cheminJournal, `--- OMNI ${new Date().toISOString()} ---\n`); }
    catch { /* un journal qui ne s'ouvre pas ne doit pas empecher l'app de tourner */ }
  }
  return cheminJournal;
}

function journal(pid, texte) {
  if (!JOURNAL_COMPLET) return;
  const t = String(Date.now() - DEPART).padStart(7);
  const ligne = `${t}ms [${pid}] ${texte}`;
  console.log(ligne);
  try { fs.appendFileSync(fichierJournal(), ligne + '\n'); } catch { /* idem */ }
}

// LA CAPTURE COMPLETE, sur son propre interrupteur: OMNI_CAPTURE=1.
//
// Elle journalise TOUTE trame, dans LES DEUX SENS, avec ses champs de premier
// niveau. C'est elle qui a identifie jyj le 27/08, apres deux diagnostics faux
// tires de correlations. Deux raisons de la garder plutot que de la retirer
// comme la precedente:
//
// - LE SENS SORTANT est la seule mesure de reference qui existe. Notre propre
//   jxy ne s'y voit pas — il est ecrit directement sur la socket amont et ne
//   repasse pas par le reassembleur — donc tout jxy sortant journalise vient
//   de la MAIN de l'utilisateur, et date un instant ou le serveur a
//   effectivement accepte de passer le tour. Aucune correlation ne vaut ca.
// - REGARDER TOUS LES TYPES, et pas seulement ceux qu'on croit utiles. jyj
//   traversait le flux depuis le debut; il figurait meme dans les tests, comme
//   exemple de type SANS interet.
//
// Elle reste couteuse — plusieurs milliers de lignes par combat — d'ou son
// interrupteur separe: OMNI_JOURNAL=complet donne les lignes utiles sans le
// deluge, OMNI_CAPTURE=1 y ajoute le deluge quand il faut mesurer.
const CAPTURE = process.env.OMNI_CAPTURE === '1';

// Les champs de premier niveau, en une ligne courte. Un champ imbrique ou
// binaire est resume: sa taille suffit a le reconnaitre, son contenu noierait
// le journal.
function champsCourts(payload) {
  const out = [];
  for (const f of payload || []) {
    if (f.kind === 'message') out.push(`${f.no}={…}`);
    else if (f.kind === 'bytes') out.push(`${f.no}=<${(f.raw || f.value || '').length}o>`);
    else out.push(`${f.no}=${f.value}`);
    if (out.join(' ').length > 140) { out.push('…'); break; }
  }
  return out.join(' ');
}

function diagnostic(sup) {
  const idsVus = new Map();   // pid -> characterId deja journalise
  return function onTrame({ pid, dir, frame, estMaitre }) {
    if (frame === null) return;

    // Une ligne par changement, hors capture: le characterId et les deux
    // interrupteurs expliquent a eux seuls la plupart des « ca ne fait rien ».
    const etat = sup.comptes.get(pid);
    const id = etat === null ? null : etat.characterId;
    if (idsVus.get(pid) !== id) {
      idsVus.set(pid, id);
      journal(pid, `characterId=${id} passeTour=${etat && etat.passeTour} maitre=${Boolean(estMaitre)}`);
    }

    if (!CAPTURE) return;

    if (dir !== 'in') {
      journal(pid, `cap : --> ${frame.kind} ${frame.type} { ${champsCourts(frame.payload)} }`
        + (frame.type === 'jxy' ? '   <<<<< PASSE A LA MAIN' : ''));
      return;
    }

    // Les trois messages de tour sont marques: jzc l'ouvre, jyj dit qu'il est
    // a nous, jxh le termine.
    const moi = id !== null && id !== undefined
      && (frame.payload || []).some((f) => (f.no === 1 || f.no === 2) && f.value === id);
    const tour = ['jzc', 'jyj', 'jxh'].includes(frame.type) ? ' *' : '  ';
    journal(pid, `cap :${tour}<-- ${frame.kind} ${frame.type} { ${champsCourts(frame.payload)} }`
      + `${moi ? '  <-- MOI' : ''}`);
  };
}

// Une trame decodee prouve que le trafic traverse le proxy. Un client attache
// sans une seule trame et un client qui n'a rien a dire produisent le meme
// silence, et ce silence a coute deux faux diagnostics.
//
// Cette preuve ne sert plus seulement le journal: c'est elle, et non l'attache
// reussie, qui fait passer une ligne a « suit ». D'ou l'ecriture dans
// `avecTrafic`, en plus de la ligne de journal qui reste emise une seule fois.
function noterTrafic() {
  return function onTrame({ pid, dir, frame }) {
    if (dir !== 'in' || frame === null || avecTrafic.has(pid)) return;
    avecTrafic.add(pid);
    journal(pid, 'premiere trame decodee — le trafic passe bien par le proxy');
  };
}

// Prend en charge tout nouveau client. La connexion au serveur de jeu s'ouvre
// des l'ecran de connexion: un client deja lance ne peut plus etre rattrape,
// d'ou l'etat « non intercepte » plutot qu'une tentative vouee a l'echec.
async function balayerProcess() {
  let procs = [];
  try { procs = await findDofusProcesses(); } catch (e) { return; }

  const vivants = new Set(procs.map((p) => p.pid));
  for (const pid of [...vus]) {
    if (vivants.has(pid)) continue;
    vus.delete(pid);
    prisEnCharge.delete(pid);
    // Sans ces deux lignes, un pid recycle par Windows heriterait de la preuve
    // de trafic du client precedent — et repasserait « suit » sans rien avoir
    // montre.
    avecTrafic.delete(pid);
    attacheA.delete(pid);
    erreurs.delete(pid);
    messages.delete(pid);
    await superviseur.retirer(pid);
  }

  for (const p of procs) {
    if (vus.has(p.pid) || vus.size >= 8) continue;
    // Vu, donc plus jamais retente: une attache qui echoue echouerait de meme
    // a chaque tick. Ce n'est pas pour autant un client pris en charge.
    vus.add(p.pid);
    try {
      await superviseur.ajouter({ pid: p.pid, nom: p.name });
      prisEnCharge.add(p.pid);
      attacheA.set(p.pid, Date.now());
      // Un compte relance doit retrouver son interrupteur enregistre plutot
      // que de repartir a faux a chaque redemarrage de client.
      const clients = await clientsRecents();
      const idCompte = pidVersCompte(p.pid, clients);
      const etat = superviseur.comptes.get(p.pid);
      if (etat && idCompte !== null) {
        etat.passeTour = favoris.passeTourActif(idCompte);
        etat.accepteInvitation = favoris.invitationActive(idCompte);
        etat.noAnim = favoris.noAnimActif(idCompte);
        etat.accepteEchange = favoris.echangeActif(idCompte);
        etat.exclu = false;
      }
    } catch (e) {
      // Le pid reste hors de prisEnCharge: l'afficher « suit » ferait attendre
      // un rejeu qui n'arrivera jamais. La vue le montrera en erreur.
      erreurs.set(p.pid, `attache impossible : ${e.message}`);
      journal(p.pid, `attache impossible : ${e.message}`);
    }
  }
}

async function envoyerEtat() {
  if (fenetre === null || fenetre.isDestroyed()) return;
  const clients = await clientsRecents();

  // Resynchronisation de l'etat vivant depuis le fichier de reglages. Basculer
  // un interrupteur ecrit d'abord dans favoris, puis cherche le pid via
  // listerClients() — module qui rend [] sur n'importe quelle erreur comme sur
  // son delai d'attente: c'est un chemin de retour normal, pas une anomalie.
  // Sans cette reprise, l'etat restait a vrai pendant que la case affichee
  // passait a faux, et le passe-tour continuait d'emettre sans interrupteur
  // pour l'arreter. Ce tick revient toutes les 2 s: l'echec se repare seul.
  for (const etat of superviseur.comptes.tous) {
    const idCompte = pidVersCompte(etat.pid, clients);
    if (idCompte === null) continue;
    etat.passeTour = favoris.passeTourActif(idCompte);
    etat.accepteInvitation = favoris.invitationActive(idCompte);
    etat.noAnim = favoris.noAnimActif(idCompte);
    etat.accepteEchange = favoris.echangeActif(idCompte);
  }

  // Le maitre n est plus subi. Il etait decerne par l agent au client dont la
  // fenetre passait au premier plan; il est desormais le compte epingle dans
  // favoris.json, a condition qu il soit lance ET que son trafic soit prouve.
  //
  // Recalcule ici plutot que dans balayerProcess: c est ce tick qui dispose
  // deja de listerClients(), et rien ne justifie un second appel a PowerShell.
  // Le prix est une fenetre de 2 s au plus entre la premiere trame du maitre et
  // sa prise de role, pendant laquelle rien ne se replique. Meme delai que la
  // resynchronisation des interrupteurs juste au-dessus.
  superviseur.maitre = resoudreMaitre({
    epingle: favoris.maitre(),
    clients,
    intercepte: avecTrafic,
  });

  const exclus = new Set(
    superviseur.comptes.tous.filter((e) => e.exclu).map((e) => pidVersCompte(e.pid, clients)),
  );
  // La case affichee vient de l'etat vivant, celui que le passeur consulte a
  // chaque trame — par symetrie avec `exclus`. Une case rendue depuis le seul
  // fichier pourrait montrer eteint ce qui emet encore.
  // LES CASES AFFICHEES VIENNENT DU FICHIER DE REGLAGES, pas de l'etat vivant.
  //
  // Elles en venaient, et c'etait faux des qu'aucun client ne tournait: l'etat
  // vivant ne contient que les comptes ATTACHES, donc les quatre ensembles
  // etaient vides en permanence. Cliquer une case ecrivait bien dans
  // favoris.json et la case ne se cochait jamais — le reglage etait pris,
  // l'interface mentait.
  //
  // Les deux ne divergent pas: l'etat vivant est resynchronise depuis ce meme
  // fichier a chaque tick, quelques lignes plus haut. Le fichier est
  // simplement celui des deux qui existe aussi pour un compte hors ligne.
  const passeTour = new Set(favoris.tousPasseTour());
  const invitation = new Set(favoris.tousInvitation());
  const noAnim = new Set(favoris.tousNoAnim());
  const echange = new Set(favoris.tousEchange());

  // IMPORTANT de revue finale: reglagesNoAnim.actif etait recalcule ICI a
  // chaque tick (noAnim.size > 0), donc basculerNoAnim() n'avait aucun effet
  // propre -- le bouton ANIM se rallumait ou se rallumait jamais selon les
  // cases par compte, pas selon le clic. Comme reglagesPasseTour.actif et
  // reglagesInvitation.actif, c'est desormais un interrupteur general
  // independant, mis a jour uniquement par l'IPC basculerNoAnim.
  // Agent en place, pas encore de trame, et attache trop recente pour
  // conclure. Passe DELAI_PREUVE_TRAFIC, le pid quitte cet ensemble de
  // lui-meme et la vue le montre « non intercepte ».
  const maintenant = Date.now();
  const enAttente = new Set(
    [...prisEnCharge].filter(
      (pid) => !avecTrafic.has(pid)
        && maintenant - (attacheA.get(pid) ?? 0) < DELAI_PREUVE_TRAFIC,
    ),
  );

  const lignes = construireVue({
    comptes,
    clients,
    // `avecTrafic`, PAS `prisEnCharge`: voir le commentaire de ces ensembles.
    intercepte: avecTrafic,
    enAttente,
    maitre: superviseur.maitre,
    exclus,
    favoris: new Set(favoris.tous()),
    passeTour,
    invitation,
    noAnim,
    echange,
    erreurs,
    messages,
  });

  // L'ordre voulu par l'utilisateur. Il ne sert pas qu'a l'affichage: c'est
  // lui que « personnage suivant » parcourt, donc c'est de la memoire
  // musculaire. L'ordre de Zaap n'a aucune raison d'etre celui de l'equipe.
  const rangees = ordonner(lignes, favoris.ordre());
  lignes.length = 0;
  lignes.push(...rangees);

  // La carte des pids et l'ordre de navigation, tenus a jour ici: c'est le
  // seul endroit qui connaisse a la fois les comptes, les clients et l'ordre
  // voulu. Les deux touches de navigation et le clic sur une identite s'en
  // servent sans rien redemander a Windows.
  carteComptes = new Map();
  ordreNavigation = [];
  for (const l of lignes) {
    if (l.pid === null || l.pid === undefined) continue;
    if (l.id !== null && l.id !== undefined) carteComptes.set(l.id, l.pid);
    ordreNavigation.push(l.pid);
  }

  // La touche assignee a chaque compte, pour l'afficher sur sa ligne.
  const touches = favoris.touches();
  for (const l of lignes) l.touche = l.id === null ? null : (touches[l.id] || null);

  // L'embleme de chaque classe vue, s'il est deja en cache. Les absents sont
  // demandes SANS ATTENDRE: le tick suivant les affichera, et d'ici la
  // l'abreviation de classe tient la place. Un envoi d'etat ne doit jamais
  // dependre du reseau.
  for (const l of lignes) {
    l.embleme = emblemes.pour(l.classe);
    if (l.embleme === null && l.classe) emblemes.assurer(l.classe);
  }

  fenetre.webContents.send('etat', {
    // Pose par l'amorceur avant de charger cette version. Quand un ami dit
    // « ca marche pas », le depannage ne commence pas par une devinette.
    version: process.env.OMNI_VERSION || 'dev',
    actif: favoris.actif(),
    // Sans maitre, rien ne se replique. L absence de duplication et une panne
    // produisent le meme silence: l en-tete doit dire lequel des deux.
    sansMaitre: superviseur.maitre === null,
    erreurComptes,
    delai: favoris.delai(),
    nav: favoris.touchesNav(),
    avisBascule: avisCourant(),
    lignes,
  });
}

function pidVersCompte(pid, clients) {
  const c = clients.find((x) => x.pid === pid);
  return c ? c.idCompte : null;
}

function compteVersPid(idCompte, clients) {
  const c = clients.find((x) => x.idCompte === idCompte);
  return c ? c.pid : null;
}

function creerFenetre() {
  fenetre = new BrowserWindow({
    // Taille FIXE, et les deux nombres sont mesurés sur la page réelle, pas
    // estimés. Hauteur: 38 de barre de titre, 42 d'en-tete de colonnes, 50 de
    // barre du bas et 61 par rang, soit 618 px pour huit comptes; les 102 de
    // marge absorbent les deux bandeaux d'avertissement sans faire defiler.
    // Largeur: les titres de colonne portent desormais leur losange d'etat, et
    // « GROUPE » debordait de 9 px dans 44; les colonnes passent a 58.
    width: 1097,
    height: 720,
    resizable: false,
    maximizable: false,
    title: 'OMNI',
    // Sans cadre systeme: la barre de titre est dessinee par index.html, avec
    // ses propres reduire / agrandir / fermer. Un seul bandeau au lieu de deux.
    //
    // La fenetre n'etant pas redimensionnable, l'absence de cadre ne coute
    // rien: il n'y a aucune poignee de bord a viser.
    frame: false,
    backgroundColor: '#161512',
    // La fenetre ne s'affiche qu'une fois peinte: sans cela, un cadre blanc
    // clignote au lancement, tres visible sur un fond aussi sombre.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Un ami ne doit pas pouvoir ouvrir un inspecteur et lire ce qui circule.
      devTools: false,
    },
  });
  // On intercepte la fermeture pour poser la question. Sans cette garde, la
  // fenetre part avant qu'on ait pu demander quoi que ce soit.
  fenetre.on('close', (e) => {
    if (fermetureAutorisee) return;
    e.preventDefault();
    demanderFermeture();
  });

  // M4 et M5 sont « precedent » et « suivant » pour Chromium. La fenetre n'a
  // aucun historique, donc rien ne se passerait — mais on coupe court plutot
  // que de dependre de ce fait. On filtre sur le nom de la commande: appeler
  // preventDefault() sur TOUTES les commandes risquerait de rendre inertes
  // les touches multimedia de l'utilisateur (volume, lecture/pause) tant
  // qu'OMNI a le focus. Electron ne documente pas cet effet, mais on n'a
  // aucune raison de le provoquer.
  fenetre.on('app-command', (e, commande) => {
    if (commande === 'browser-backward' || commande === 'browser-forward') {
      e.preventDefault();
    }
  });

  fenetre.removeMenu();
  fenetre.once('ready-to-show', () => fenetre.show());
  fenetre.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  const lecture = lireComptes();
  comptes = lecture.comptes;
  erreurComptes = lecture.erreur;

  favoris = new Favoris(path.join(app.getPath('userData'), 'favoris.json')).charger();
  // Un fichier PNG par classe, telecharge une fois puis relu du disque. Rien
  // n'est embarque dans le paquet: voir src/comptes/emblemes.js.
  emblemes = creerEmblemes({
    racine: path.join(app.getPath('userData'), 'emblemes'),
    journal: (texte) => journal('emblemes', texte),
  });
  // Le delai enregistre doit survivre au redemarrage de l'application, pas
  // seulement a celui d'un client.
  reglagesPasseTour.delaiMs = Math.round(favoris.delai() * 1000);

  superviseur = new Superviseur({
    // L'interrupteur unique est relu du fichier juste apres la construction,
    // par appliquerActif(). On part au repos: la valeur reelle arrive une
    // ligne plus bas, et un etat arme transitoire n'existe pas.
    arme: false,
    // Les esclaves ne partent plus sur la meme milliseconde: 16 a 80 ms
    // d'ecart tire au hasard entre chacun, cumule. Le plancher tient au pas
    // des minuteurs Windows — voir la constante, partagee avec le CLI.
    etalementRejeu: ETALEMENT_REJEU,
    onJournal: journal,
    transformerEntrant: creerTransformateurFlux({
      reglages: reglagesNoAnim,
      // CRITICAL de revue finale: sans ce predicat, le transformateur ne
      // consultait que le drapeau general (noAnim.size > 0) et armait DONC
      // TOUS les comptes des qu'un seul avait sa case cochee. Comme ses
      // trois jumeaux (passeur, accepteur), la decision doit se prendre par
      // compte, sur l'etat vivant que balayerProcess()/envoyerEtat()
      // synchronisent depuis favoris.json.
      estArmePourCompte: (pid) => {
        const etat = superviseur.comptes.get(pid);
        return etat !== null && Boolean(etat.noAnim);
      },
      onCompteRendu: ({ conn, pid, raison }) => journal(pid, `no-anim (connexion ${conn}) : ${raison}`),
    }),
    onSouris: ({ clic }) => jouerSouris(clic),
  });

  // Sans ce branchement, le superviseur decode tout et ne rejoue rien:
  // l'interrupteur ne bascule qu'un drapeau que seul rejouer() consulte. La
  // decision est celle du CLI, au mot pres, parce que c'est le meme module.
  //
  // Le superviseur n'accepte qu'un seul onTrame: le passe-tour, politique
  // independante du OMNI, se compose ici plutot que d'ajouter un second
  // point d'entree au superviseur.
  superviseur.onTrame = composer(
    creerDuplicateur({
      superviseur,
      onCompteRendu: ({ nom, rendu }) => {
        // Un refus est la seule chose que l'utilisateur ne peut pas deviner: un
        // compte qui ne rejoue pas ressemble a un compte inactif. On garde le
        // dernier par client, efface des que le rejeu repasse.
        for (const r of rendu) {
          if (r.ok) messages.delete(r.pid);
          else messages.set(r.pid, `${nom} : ${r.raison}`);
        }
      },
    }),
    creerPasseur({
      superviseur,
      reglages: reglagesPasseTour,
      onCompteRendu: ({ pid, ok, raison, declencheur }) => {
        // Le jalon declencheur, et pas seulement le fait d'avoir emis: c'est
        // lui qui a dit que la relance d'ouverture avait survecu.
        if (ok) journal(pid, `passe-tour : jxy emis (sur ${declencheur})`);
        else journal(pid, `passe-tour : ${raison}`);
      },
    }),
    creerAccepteur({
      superviseur,
      reglages: reglagesInvitation,
      onCompteRendu: ({ pid, ok, raison, groupe }) => {
        if (ok) journal(pid, `invitation : acceptee (groupe ${groupe})`);
        else journal(pid, `invitation : ${raison}`);
      },
    }),
    creerAccepteurEchange({
      superviseur,
      reglages: reglagesEchange,
      delai: DELAI_REACTION,
      onCompteRendu: ({ pid, ok, raison, validation, retardMs }) => {
        if (ok) journal(pid, `echange : ${validation ? 'valide' : 'accepte'} apres ${retardMs} ms`);
        else journal(pid, `echange : ${raison}`);
      },
    }),
    noterTrafic(),
    // DIAGNOSTIC TEMPORAIRE — voir diagnostic() plus haut.
    diagnostic(superviseur),
    // Une politique qui leve doit se voir. C'est ce qui manquait: le passeur
    // pouvait echouer sur une trame sans laisser la moindre trace.
    { onErreur: ({ evenement, erreur }) => journal(evenement.pid, `POLITIQUE EN ECHEC sur ${evenement.frame && evenement.frame.type} : ${erreur.stack}`) },
  );

  // L'etat enregistre de l'interrupteur unique, applique aux cinq politiques
  // d'un coup.
  appliquerActif(favoris.actif());

  creerFenetre();
  poserRaccourcis();
  minuteurProcess = setInterval(balayerProcess, PERIODE_PROCESS);
  minuteurVue = setInterval(envoyerEtat, PERIODE_VUE);
  await balayerProcess();
  await envoyerEtat();
});

// Les trois commandes de fenetre. Elles vivent ici et pas dans le renderer:
// celui-ci est sandboxe et n'a aucun acces a BrowserWindow.
// Les raccourcis GLOBAUX. Global veut dire que Dofus ne recoit plus la touche
// tant qu'OMNI tourne: c'est le prix a payer pour qu'ils marchent pendant qu'on
// joue, et c'est pour cela que l'interface avertit sur une touche nue.
//
// On repose tout a chaque changement plutot que de tenir un differentiel: il y
// a au plus dix raccourcis, et un differentiel faux laisse une touche fantome
// enregistree jusqu'a la fermeture.

// LES RACCOURCIS SOURIS, qui ne peuvent pas passer par globalShortcut.
//
// Electron ne sait enregistrer que des touches. Un bouton passe donc par un
// second chemin, de l'agent jusqu'ici, et cette table est son aboutissement.
// Elle est refaite en entier a chaque changement, comme les raccourcis
// clavier: un differentiel faux laisserait un bouton fantome actif jusqu'a la
// fermeture.
const actionsSouris = new Map();   // accelerateur -> action

function poserRaccourcis() {
  globalShortcut.unregisterAll();
  actionsSouris.clear();
  if (favoris === null) return;

  const poser = (accelerateur, action) => {
    if (!accelerateur) return;
    // Un bouton n'est pas representable dans un accelerateur Electron: le
    // passer a register() echouerait sans lever, donc en silence.
    if (estSouris(accelerateur)) { actionsSouris.set(accelerateur, action); return; }
    try {
      // register rend faux quand la touche est deja prise par une AUTRE
      // application: on le dit plutot que de laisser croire que ca marche.
      if (!globalShortcut.register(accelerateur, action)) {
        journal('raccourcis', `${accelerateur} refuse (deja pris par une autre application ?)`);
      }
    } catch (e) {
      journal('raccourcis', `${accelerateur} invalide : ${e.message}`);
    }
  };

  for (const [idTexte, accelerateur] of Object.entries(favoris.touches())) {
    const idCompte = Number(idTexte);
    poser(accelerateur, () => basculerVersCompte(idCompte));
  }

  const nav = favoris.touchesNav();
  poser(nav.suivant, () => naviguer(1));
  poser(nav.precedent, () => naviguer(-1));

  // La boucle de sondage ne tourne dans les clients que s'il y a quelque chose
  // a sonder.
  if (superviseur !== null) superviseur.reglerSouris(actionsSouris.size > 0);
}

// Derive un message affichable de n'importe quoi: un throw ou un reject
// peuvent porter autre chose qu'une Error (throw null, Promise.reject() sans
// argument, un objet dont .message ou toString() ne rend pas une chaine...).
//
// TOUT le corps est sous le try, y compris le test instanceof et la lecture de
// .message: ce n'est pas de la precaution decorative, ces deux operations
// peuvent lever a elles seules. .message peut etre un accesseur qui jette, et
// instanceof interroge la chaine de prototypes, donc un Proxy dont le trap
// getPrototypeOf jette fait lever le test lui-meme. Un jet ici sortirait de
// messageErreur avant tout filet et remonterait DANS le catch de jouerSouris,
// cense justement arreter la casse: c'est le crash qu'on veut supprimer.
// Ne pas ressortir la premiere ligne du try en croyant simplifier.
//
// Le repli ne touche a aucune propriete de e, pour la meme raison. String()
// sous try/catch rend toujours une chaine, et une chaine est necessaire: un
// Symbol rendu tel quel leverait plus loin a l'interpolation dans le gabarit.
function messageErreur(e) {
  try {
    const brut = e instanceof Error ? e.message : e;
    return typeof brut === 'string' ? brut : String(brut);
  } catch { return 'erreur inconnue'; }
}

// Un appui de bouton, d'ou qu'il vienne: de l'agent quand Dofus est devant, de
// l'interface quand c'est OMNI. Meme table, meme action.
//
// Un bouton non assigne ne fait rien et ne se journalise pas: l'utilisateur a
// deux boutons sous le pouce et s'en sert pour autre chose.
//
// L'action peut jeter (synchrone) ou rejeter (sa promesse): laisser passer
// l'un ou l'autre declenche uncaughtException, qui fait sortir tout le
// process et emporte les clients Dofus avec lui a la fermeture. Le chemin
// agent est le plus expose: onSouris est appelee depuis un rappel Frida, sans
// aucun autre filet le long de la chaine.
function jouerSouris(clic) {
  const accelerateur = depuisBouton(clic);
  if (accelerateur === null) return;
  const action = actionsSouris.get(accelerateur);
  if (action === undefined) return;
  let r = null;
  try { r = action(); } catch (e) { journal('souris', `${accelerateur} : ${messageErreur(e)}`); return; }
  if (r && typeof r.then === 'function') r.catch((e) => journal('souris', `${accelerateur} : ${messageErreur(e)}`));
}

// Met au premier plan la fenetre du compte demande. Rend un compte rendu
// plutot que de lever: l'appelant peut etre un raccourci global, ou une
// exception non capturee tuerait le process principal en silence.
async function basculerVersCompte(idCompte) {
  // Pas d'attente: le pid vient de la derniere vue envoyee.
  const pid = carteComptes.has(idCompte) ? carteComptes.get(idCompte) : null;
  if (pid === null) {
    journal('bascule', `compte ${idCompte} : aucun client`);
    noterAvis('aucun client lancé pour ce compte');
    await envoyerEtat();
    return;
  }
  poserCurseur(pid);
  const r = superviseur.basculerVers(pid);
  if (!r.ok) {
    journal(pid, `bascule refusee : ${r.raison}`);
    noterAvis(`bascule impossible : ${r.raison}`);
    envoyerEtat();
  }
}

// Le pas suivant ou precedent, dans l'ORDRE AFFICHE. Le point de depart est le
// client au premier plan; s'il est inconnu (navigateur, Zaap, client non pris
// en charge), on entre par le bout correspondant au sens demande.
function naviguer(pas) {
  // Meme raison que ci-dessus: l'ordre affiche est deja connu, et une touche de
  // navigation doit repondre a l'instant.
  //
  // Seuls les clients qu'OMNI pilote: basculer vers un client sans agent
  // echouerait sans rien dire d'utile.
  const navigables = ordreNavigation.filter((p) => superviseur.clients.has(p));
  if (navigables.length === 0) {
    noterAvis(ordreNavigation.length === 0
      ? 'aucun client Dofus détecté'
      : 'aucun client piloté par OMNI — lance-les APRÈS OMNI');
    envoyerEtat();
    return;
  }

  // Le curseur peut designer un client ferme entre-temps: suivant() et
  // precedent() entrent alors par le bout correspondant au sens demande.
  const cible = pas > 0 ? suivant(navigables, curseurNav) : precedent(navigables, curseurNav);
  if (cible === null) return;
  poserCurseur(cible);
  const r = superviseur.basculerVers(cible);
  if (!r.ok) {
    journal(cible, `navigation refusee : ${r.raison}`);
    noterAvis(`navigation impossible : ${r.raison}`);
    envoyerEtat();
  }
}

ipcMain.handle('basculerVersCompte', async (_e, idCompte) => {
  if (!Number.isInteger(idCompte)) return;
  await basculerVersCompte(idCompte);
});

ipcMain.handle('reglerTouche', async (_e, idCompte, accelerateur) => {
  if (!Number.isInteger(idCompte)) return;
  if (accelerateur !== null && typeof accelerateur !== 'string') return;
  favoris.reglerTouche(idCompte, accelerateur);
  poserRaccourcis();
  await envoyerEtat();
});

ipcMain.handle('reglerToucheNav', async (_e, nom, accelerateur) => {
  if (typeof nom !== 'string' || typeof accelerateur !== 'string') return;
  favoris.reglerToucheNav(nom, accelerateur);
  poserRaccourcis();
  await envoyerEtat();
});

// L'interface signale un appui quand c'est la fenetre d'OMNI qui a le focus:
// l'agent, lui, ne voit que les appuis faits sur son client Dofus.
ipcMain.handle('boutonSouris', (_e, clic) => {
  if (clic === null || typeof clic !== 'object') return;
  jouerSouris({
    button: clic.button,
    ctrlKey: Boolean(clic.ctrlKey),
    altKey: Boolean(clic.altKey),
    shiftKey: Boolean(clic.shiftKey),
  });
});

ipcMain.handle('reglerOrdre', async (_e, ids) => {
  if (!Array.isArray(ids) || !ids.every((n) => Number.isInteger(n))) return;
  favoris.reglerOrdre(ids);
  await envoyerEtat();
});

ipcMain.handle('fenetreReduire', () => {
  if (fenetre && !fenetre.isDestroyed()) fenetre.minimize();
});

ipcMain.handle('fenetreFermer', () => {
  // close() et non destroy(): le gestionnaire window-all-closed doit tourner,
  // c'est lui qui arrete les minuteurs et demonte le superviseur, donc qui
  // decharge les agents Frida des clients Dofus.
  if (fenetre && !fenetre.isDestroyed()) fenetre.close();
});

ipcMain.handle('basculerActif', async (_e, actif) => {
  favoris.reglerActif(actif);
  appliquerActif(favoris.actif());
  await envoyerEtat();
});

// L'ACTION GROUPEE d'un titre de colonne: elle pose la meme valeur pour tous
// les comptes de la liste. Ce n'est pas un second etat cache, c'est un geste
// qui ecrit dans les memes cases que les clics individuels.
//
// La cible est calculee cote principal et non cote renderer: le fichier de
// reglages fait foi, et deux clics rapides ne doivent pas partir de deux
// lectures differentes de l'affichage.
ipcMain.handle('basculerColonne', async (_e, nom, ids) => {
  if (!parNom.has(nom)) return;
  if (!Array.isArray(ids) || !ids.every((n) => Number.isInteger(n))) return;

  const clients = await clientsRecents();
  const etatDe = (id) => {
    const pid = compteVersPid(id, clients);
    return pid === null ? null : superviseur.comptes.get(pid);
  };

  // L'etat de la colonne est recalcule ICI, depuis le fichier de reglages et
  // l'etat vivant, jamais depuis ce que le renderer croit afficher: deux clics
  // rapides partiraient sinon de deux lectures differentes.
  const vue = ids.map((id) => {
    const etat = etatDe(id);
    return {
      id,
      exclu: etat === null ? false : Boolean(etat.exclu),
      passeTour: favoris.passeTourActif(id),
      invitation: favoris.invitationActive(id),
      noAnim: favoris.noAnimActif(id),
      echange: favoris.echangeActif(id),
    };
  });
  const cible = cibleBascule(vue, nom);
  if (cible === null) return;

  for (const id of ids) {
    const etat = etatDe(id);
    if (nom === 'repl') {
      // La colonne inversee: cochee veut dire « suit le meneur », donc `exclu`
      // vaut le contraire de la cible.
      if (etat) etat.exclu = !cible;
    } else if (nom === 'tour') {
      favoris.marquerPasseTour(id, cible);
      if (etat) etat.passeTour = cible;
    } else if (nom === 'groupe') {
      favoris.marquerInvitation(id, cible);
      if (etat) etat.accepteInvitation = cible;
    } else if (nom === 'anim') {
      favoris.marquerNoAnim(id, cible);
      if (etat) etat.noAnim = cible;
    } else if (nom === 'echange') {
      favoris.marquerEchange(id, cible);
      if (etat) etat.accepteEchange = cible;
    }
  }
  await envoyerEtat();
});

ipcMain.handle('fermerUnClient', async (_e, idCompte) => {
  if (!Number.isInteger(idCompte)) return;
  // Le pid vient de la derniere vue, comme pour la bascule: aucune raison de
  // relancer powershell pour fermer une fenetre.
  const pid = carteComptes.has(idCompte) ? carteComptes.get(idCompte) : null;
  if (pid === null) {
    noterAvis('aucun client lancé pour ce compte');
    await envoyerEtat();
    return;
  }
  const [r] = fermerClients([pid]);
  journal(pid, r && r.ok ? 'client ferme depuis sa ligne' : `fermeture impossible : ${r && r.raison}`);
  if (r && !r.ok) noterAvis(`fermeture impossible : ${r.raison}`);
  // Le balayage retire le client mort et purge son etat tout seul, sous 500 ms.
  // On rafraichit quand meme pour que la ligne ne mente pas d'ici la.
  await envoyerEtat();
});

ipcMain.handle('definirMaitre', async (_e, idCompte) => {
  // Frontiere de confiance, comme ses voisins: le renderer est sandboxe mais
  // reste hors de notre controle.
  //
  // null est une valeur ATTENDUE ici, pas une erreur: c'est ainsi qu'on
  // desepingle. Sans elle, revenir a « aucun maitre » serait impossible une
  // fois un compte choisi.
  if (idCompte !== null && !Number.isInteger(idCompte)) return;
  favoris.reglerMaitre(idCompte);
  // Le pid du maitre se deduit du compte epingle a chaque envoi d'etat; on
  // rafraichit tout de suite pour que le bouton ne mette pas 2 s a basculer.
  await envoyerEtat();
});

ipcMain.handle('exclureCompte', async (_e, idCompte, exclu) => {
  // Frontiere de confiance: le renderer est sandboxe mais reste hors de
  // notre controle. Un idCompte non entier ne doit ni chercher de pid ni
  // atteindre l'etat du superviseur.
  if (!Number.isInteger(idCompte)) return;
  const clients = await clientsRecents();
  const pid = compteVersPid(idCompte, clients);
  const etat = pid === null ? null : superviseur.comptes.get(pid);
  if (etat) etat.exclu = Boolean(exclu);
  await envoyerEtat();
});

ipcMain.handle('marquerFavori', async (_e, idCompte, favori) => {
  // Meme garde: favoris.json ne doit contenir que des identifiants
  // numeriques, et Favoris.marquer() ne filtre qu'a la lecture, pas a
  // l'ecriture. La validation doit donc se faire ici, cote appelant.
  if (!Number.isInteger(idCompte)) return;
  favoris.marquer(idCompte, Boolean(favori));
  await envoyerEtat();
});

ipcMain.handle('basculerPasseTourCompte', async (_e, idCompte, actif) => {
  // La frontiere IPC est la frontiere de confiance: on ne laisse pas une
  // valeur non numerique atteindre le fichier de reglages.
  if (!Number.isInteger(idCompte)) return;
  favoris.marquerPasseTour(idCompte, Boolean(actif));
  const clients = await clientsRecents();
  const pid = compteVersPid(idCompte, clients);
  const etat = pid === null ? null : superviseur.comptes.get(pid);
  if (etat) etat.passeTour = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('basculerInvitationCompte', async (_e, idCompte, actif) => {
  // La frontiere IPC est la frontiere de confiance: on ne laisse pas une
  // valeur non numerique atteindre le fichier de reglages.
  if (!Number.isInteger(idCompte)) return;
  favoris.marquerInvitation(idCompte, Boolean(actif));
  const clients = await clientsRecents();
  const pid = compteVersPid(idCompte, clients);
  const etat = pid === null ? null : superviseur.comptes.get(pid);
  if (etat) etat.accepteInvitation = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('basculerNoAnimCompte', async (_e, idCompte, actif) => {
  // La frontiere IPC est la frontiere de confiance: on ne laisse pas une
  // valeur non numerique atteindre le fichier de reglages.
  if (!Number.isInteger(idCompte)) return;
  favoris.marquerNoAnim(idCompte, Boolean(actif));
  const clients = await clientsRecents();
  const pid = compteVersPid(idCompte, clients);
  const etat = pid === null ? null : superviseur.comptes.get(pid);
  if (etat) etat.noAnim = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('basculerEchangeCompte', async (_e, idCompte, actif) => {
  // Frontiere de confiance: le renderer est sandboxe mais reste hors de notre
  // controle. Un idCompte non entier ne doit ni chercher de pid ni atteindre
  // l'etat du superviseur.
  if (!Number.isInteger(idCompte)) return;
  favoris.marquerEchange(idCompte, Boolean(actif));
  const clients = await clientsRecents();
  const pid = compteVersPid(idCompte, clients);
  const etat = pid === null ? null : superviseur.comptes.get(pid);
  if (etat) etat.accepteEchange = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('reglerDelai', async (_e, secondes) => {
  const v = Number(secondes);
  if (!Number.isFinite(v) || v < 0) return;
  favoris.reglerDelai(v);
  reglagesPasseTour.delaiMs = Math.round(v * 1000);
  await envoyerEtat();
});

ipcMain.handle('fermerTousLesClients', async () => {
  const clients = await clientsRecents();
  const rendu = fermerClients(clients.map((c) => c.pid));
  for (const r of rendu) {
    journal(r.pid, r.ok ? 'client ferme par le bouton OFF' : `fermeture impossible : ${r.raison}`);
  }
  // Le balayage retire les clients morts et purge leur etat tout seul, sous
  // 500 ms. On rafraichit quand meme pour que la liste ne mente pas d'ici la.
  await envoyerEtat();
});

// LU UNE SEULE FOIS, AU PREMIER CLIC. Le fichier est fige pour la duree de
// l'execution — il fait partie de la version installee. Le mettre dans le flux
// d'etat, qui repart vers la fenetre toutes les deux secondes, ferait relire un
// fichier a chaque tour pour du texte qui ne bouge jamais.
let devlogEnMemoire = null;
ipcMain.handle('devlog', () => {
  if (devlogEnMemoire === null) devlogEnMemoire = lireDevlog(CHEMIN_DEVLOG);
  return devlogEnMemoire;
});

app.on('window-all-closed', async () => {
  // Un raccourci global survit au process s'il n'est pas rendu: Windows le
  // garderait confisque pour Dofus jusqu'a la deconnexion de la session.
  globalShortcut.unregisterAll();
  // On arrete d'abord de produire du travail (plus aucun tick ne peut
  // rattacher un agent Frida ou renvoyer un etat), ensuite seulement on
  // demonte le superviseur.
  if (minuteurProcess !== null) clearInterval(minuteurProcess);
  if (minuteurVue !== null) clearInterval(minuteurVue);
  minuteurProcess = null;
  minuteurVue = null;

  // LA FERMETURE EST BORNEE. `arreter()` decharge les scripts Frida et detache
  // les sessions: ce sont des allers-retours avec des process Dofus qui
  // peuvent etre occupes, en train de mourir, ou deja partis. Une seule de ces
  // attentes qui ne rend jamais la main, et OMNI reste en memoire, fenetre
  // fermee, invisible dans la barre des taches — il faut alors le tuer au
  // gestionnaire, et le lancer a nouveau donne deux instances.
  //
  // On laisse donc trois secondes au demontage propre, puis on quitte de toute
  // facon. Un agent non decharge disparait avec le process a la fin, et le
  // client Dofus n'en garde rien.
  const demontage = superviseur
    ? superviseur.arreter().catch((e) => journal('arret', `demontage: ${e.message}`))
    : Promise.resolve();
  let horsDelai = null;
  await Promise.race([
    demontage,
    new Promise((r) => { horsDelai = setTimeout(r, 3000); }),
  ]);
  if (horsDelai !== null) clearTimeout(horsDelai);

  app.quit();
  // Filet de dernier recours: si une poignee native retenait encore la boucle
  // d'evenements, app.quit() ne suffirait pas. Personne ne doit avoir a tuer
  // OMNI a la main.
  setTimeout(() => app.exit(0), 1500).unref();
});
