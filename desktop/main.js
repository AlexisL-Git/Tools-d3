'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, globalShortcut, dialog, screen } = require('electron');

const { Superviseur } = require('../src/superviseur');
const { creerDuplicateur, ETALEMENT_REJEU } = require('../src/duplicateur');
const { creerGardeCombat } = require('../src/garde-combat');
const { creerAbandonGroupe } = require('../src/abandon-combat');
const { creerPasseur } = require('../src/passeur');
const { creerMasque, composerDescendant } = require('../src/masque');
const { creerAccepteur } = require('../src/invitation');
const { creerAccepteurEchange, DELAI_REACTION } = require('../src/echange');
const { creerAccepteurSonge, DELAI_REACTION: DELAI_SONGE } = require('../src/songes');
const { creerTransformateurFlux } = require('../src/noanim-flux');
const hdvReprix = require('../src/hdv/reprix');
const hdvVente = require('../src/hdv/vente');
const { creerReprix } = hdvReprix;
const { creerVente } = hdvVente;

// LES BORNES DE DEPART DES DEUX MODULES, envoyees telles quelles au panneau.
// Il en a besoin pour montrer ce qu'un facteur DONNE en millisecondes -- « x1,6 »
// ne veut rien dire tant qu'on ne voit pas 1440-4160. Les recopier dans la page
// les aurait laissees deriver au premier ajustement mesure en jeu.
const HDV_BORNES = {
  reprix: {
    lot: [hdvReprix.DELAI_MIN, hdvReprix.DELAI_MAX],
    objet: [hdvReprix.DELAI_OBJET_MIN, hdvReprix.DELAI_OBJET_MAX],
    pause: [hdvReprix.PAUSE_MIN, hdvReprix.PAUSE_MAX],
    avantPause: [hdvReprix.AVANT_PAUSE_MIN, hdvReprix.AVANT_PAUSE_MAX],
  },
  vente: {
    lot: [hdvVente.DELAI_RAFALE_MIN, hdvVente.DELAI_RAFALE_MAX],
    objet: [hdvVente.DELAI_OBJET_MIN, hdvVente.DELAI_OBJET_MAX],
    pause: [hdvVente.PAUSE_MIN, hdvVente.PAUSE_MAX],
    avantPause: [hdvVente.AVANT_PAUSE_MIN, hdvVente.AVANT_PAUSE_MAX],
  },
};
const { PLAFOND_ECARTES } = require('../src/hdv/ecartes');
const { creerPdaArchi } = require('../src/pda-archi/pda-archi');
const { creerCollection } = require('../src/pda-archi/collection');
const { trameLireInventaire } = require('../src/pda-archi/trames');
const { estArchimonstre } = require('../src/pda-archi/archimonstres');
const { construire: construireTableauArchi } = require('../src/pda-archi/tableau');
const { composer } = require('../src/composer');
const { lireComptes } = require('../src/comptes/zaap');
const { listerClients, fermerClients } = require('../src/comptes/clients');
const { construireVue } = require('../src/comptes/vue');
const { resoudreMaitre } = require('../src/comptes/maitre');
const { creerEmblemes } = require('../src/comptes/emblemes');
const { ordonner } = require('../src/comptes/ordre');
const { pourOverlay, etatTour } = require('../src/comptes/overlay');
const { COLONNES, parNom, cibleBascule, etatColonne } = require('../src/comptes/colonnes');
const { Favoris, RYTHME_HDV_DEFAUT } = require('../src/comptes/favoris');
const { findDofusProcesses } = require('../src/injector');
const { lireDevlog, CHEMIN: CHEMIN_DEVLOG } = require('./devlog');
const { estSouris, depuisBouton } = require('../src/comptes/raccourcis');
const { creerVeille, creerCacheFichier } = require('../src/droits/veille');
const { creerPorte } = require('../src/droits/porte');

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
// LA PETITE FENETRE FLOTTANTE, posee sur le jeu. Elle n'existe que si
// l'utilisateur l'a ouverte: null est son etat normal.
let overlay = null;
// L'ecart entre le curseur et le coin de l'overlay pendant un glissement. Null
// quand personne ne la deplace.
let priseOverlay = null;
// Les lignes du dernier envoi d'etat. Elles servent a rafraichir l'overlay
// sans tout recalculer -- reconstruire la vue demande un listerClients(), qui
// passe par powershell -- et a l'action groupee de sa colonne « Répl. ».
let dernieresLignes = [];
let superviseur = null;
// La mise a jour des prix en hotel de vente. Declaree ici, et pas seulement
// dans le composer, parce qu'un BOUTON doit pouvoir la lancer: c'est le seul
// module d'OMNI qui repond a autre chose qu'a une trame.
let reprix = null;
let vente = null;
// La pierre d'ame equipee a l'entree en combat. Declaree ici comme la vente: le panneau lit son
// etat, l'interrupteur l'arme, et la perte du droit doit pouvoir la desarmer.
let pdaArchi = null;

// LES AMES CAPTUREES, POUR LE TABLEAU DES ARCHIMONSTRES.
//
// Creee tout de suite, et pas dans demarrer() comme les politiques: elle ne
// depend de rien -- ni du superviseur, ni des reglages, ni d'un droit. Elle ne
// fait qu'ecouter.
//
// ELLE N'EST PAS DERRIERE `protege`, et c'est voulu: src/droits/liste.js
// verrouille des ACTIONS, ce qu'OMNI emet vers le jeu. Celle-ci n'emet rien,
// elle lit et elle affiche.
const collectionArchi = creerCollection();
// LES DROITS ACCORDES A CETTE CLE. Relus par la veille toutes les 60 s: voir
// sa creation dans app.whenReady(). null tant qu'elle n'existe pas encore --
// jamais interroge avant, la fenetre n'est pas encore ouverte.
let veille = null;
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
// CE QUI N'EST PAS PARTI A LA DERNIERE PASSE D'HOTEL DE VENTE, et pourquoi.
//
// Le bilan d'une passe ne vit que le temps du compte rendu; le panneau, lui,
// est redessine a chaque tick. Sans cette carte, le tableau des ecartes
// disparaitrait au premier rafraichissement — c'est-a-dire dans les deux
// secondes, avant meme d'avoir ete lu.
//
// pid -> { quoi: 'vente' | 'prix', lots, lignes: [...], tronque }
const ecartesHdv = new Map();

// UNE PASSE SANS ECART EFFACE LA PRECEDENTE. Sans cette suppression, un tableau
// vieux d'une heure resterait consultable sous un compte rendu tout neuf qui,
// lui, dit que tout est parti — et c'est l'ancien qu'on croirait.
//
// Rend le nombre de LOTS ecartes, pas de lignes: c'est ce que le compte rendu
// annonce, et une ligne peut porter six lots.
function retenirEcartes(pid, quoi, ecartes) {
  const lignes = ecartes || [];
  if (lignes.length === 0) { ecartesHdv.delete(pid); return 0; }
  const lots = lignes.reduce((n, e) => n + e.lots, 0);
  ecartesHdv.set(pid, { quoi, lots, lignes, tronque: lignes.length >= PLAFOND_ECARTES });
  return lots;
}

const suffixeEcartes = (lots) => (lots > 0 ? `, ${lots} écartés — clic pour le détail` : '');
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
// basculerVersCompte() abandonnait EN SILENCE dans trois cas:
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
let ordreAffiche = [];          // pids, dans l'ordre affiche

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
  if (ordreAffiche.length === 0) return;
  try {
    fermerClients(ordreAffiche);
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

// Meme trou, cote promesses: basculerVersCompte() lance
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
// Ces cinq objets sont relus a chaque trame par les politiques: modifier le
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
const reglagesSonge = { actif: false };

// LE RYTHME DES DEUX PASSES HDV, dans un objet a part parce qu'il ne se lit pas
// comme les cinq precedents: eux portent un `actif`, lui porte cinq nombres.
//
// PASSE PAR REFERENCE AUX DEUX MODULES, ET RELU A CHAQUE TIRAGE. C'est ce qui
// permet de changer de profil pendant qu'une passe tourne: elle prend le
// nouveau rythme au lot suivant. Reconstruire les modules aurait ete l'autre
// facon de faire, et elle est impossible ici -- ils portent l'ecoute permanente
// des kby et des ivx, celles qui n'arrivent qu'a l'ouverture du HDV. Les
// reconstruire perdrait le stock deja ecoute.
//
// Le champ est REMPLACE (jamais mute) a chaque reglage: favoris.hdvRythme()
// rend une copie, donc rien ici ne peut modifier ce qui part sur le disque.
const reglagesHdv = { rythme: { ...RYTHME_HDV_DEFAUT } };

// LES TRAMES QU'OMNI ACCEPTE A LA PLACE DU JOUEUR NE DOIVENT PAS ATTEINDRE SON
// CLIENT: sinon le panneau d'invitation, et la fenetre de proposition
// d'echange, restent affiches pour toujours sur chaque compte invite --
// l'acceptation part sur la socket amont, le client ne la voit jamais passer,
// et rien dans ce qui redescend ne ferme ce que seul son propre clic ferme. La
// demonstration complete est en tete de src/masque.js.
const masque = creerMasque({
  onCompteRendu: ({ pid, conn, raison }) => journal(pid, `masque (connexion ${conn}) : ${raison}`),
});

// Suspendre n'efface rien: les cases par compte restent ou elles sont, et on
// reprend exactement dans l'etat d'avant.
//
function appliquerActif(actif) {
  const v = Boolean(actif);
  superviseur.arme = v;
  reglagesPasseTour.actif = v;
  reglagesInvitation.actif = v;
  reglagesNoAnim.actif = v;
  reglagesEchange.actif = v;
  reglagesSonge.actif = v;
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

// LES OCTETS BRUTS, sur un troisieme interrupteur: OMNI_CAPTURE_OCTETS=1.
//
// Pose le 01/09 pour mesurer les trames de l'hotel de vente, et GARDE: la mise
// en vente attend son propre spike, qui aura besoin exactement de ceci. Il ne
// coute rien tant qu'on ne l'allume pas — son interrupteur lui est propre, et
// aucun lanceur ordinaire ne le pose.
//
// `champsCourts` resume tout champ imbrique en `{…}`. Cela a suffi jusqu'ici
// parce que les trames qui nous interessaient etaient plates: kfz porte deux
// identifiants et un drapeau, jxy ne porte rien. Les trames du HDV ne le sont
// pas — un contenu de banque et une liste de prix sont des listes de messages,
// et c'est justement leur INTERIEUR qu'il faut lire. Sans les octets, la
// capture dirait `2={…}` neuf fois de suite et n'apprendrait rien.
//
// En aout la mesure se faisait en deux passes, decouverte puis octets, parce
// qu'elle se faisait EN COMBAT: plusieurs milliers de trames, illisibles si
// chacune traine son hexadecimal. Le HDV est calme — hors combat le flux se
// compte en dizaines de trames par minute — donc une passe unique suffit et
// epargne une session de jeu.
//
// Le dump est borne PAR TRAME, et la borne est reglable: OMNI_CAPTURE_OCTETS_MAX.
// Ce qui deborde est signale, jamais tronque en silence — une trame coupee sans
// le dire se lirait comme une trame complete et ferait conclure sur des champs
// absents.
//
// La borne a d'abord valu 2048, et c'etait trop court: la liste des lots en
// vente fait 8908 octets, dont 2146 seulement etaient lisibles. Une borne qui
// coupe la seule trame qu'on mesure ne protege de rien. Le defaut passe donc a
// 256 Ko, ce qui couvre aussi le plus gros paquet du login (89 746 octets).
// Regler plus bas reste possible pour une mesure en combat, ou le volume est
// le vrai probleme.
const CAPTURE_OCTETS = process.env.OMNI_CAPTURE_OCTETS === '1';
const OCTETS_MAX = Number(process.env.OMNI_CAPTURE_OCTETS_MAX) > 0
  ? Number(process.env.OMNI_CAPTURE_OCTETS_MAX)
  : 262144;

// L'hexadecimal par lignes de 32 octets, indente sous la ligne `cap :` qu'il
// documente. Le format est celui de trames-echange.md, ou il s'est relu sans
// outil.
function hexDump(brute) {
  if (!Buffer.isBuffer(brute) || brute.length === 0) return [];
  const vus = brute.subarray(0, OCTETS_MAX);
  const lignes = [];
  for (let i = 0; i < vus.length; i += 32) {
    lignes.push(`        ${String(i).padStart(4, '0')}  ${vus.subarray(i, i + 32).toString('hex')}`);
  }
  if (brute.length > OCTETS_MAX) {
    lignes.push(`        ---- TRONQUE: ${brute.length} octets au total, ${OCTETS_MAX} montres`);
  }
  return lignes;
}

// Les champs de premier niveau, en une ligne courte. Un champ imbrique ou
// binaire est resume: sa taille suffit a le reconnaitre, son contenu noierait
// le journal.
// PROFONDEUR. Un champ imbrique etait resume par {…}, sa taille seule. La
// mesure du 01/09 a montre ce que ce resume coutait: la liste des combattants
// (`kmk`) est entierement imbriquee, et elle est restee invisible tant que la
// capture s'arretait au premier niveau. Deux niveaux et 600 caracteres la
// rendent lisible sans noyer le journal.
function champsCourts(payload, profondeur = 2, budget = 600) {
  const out = [];
  for (const f of payload || []) {
    if (f.kind === 'message') {
      if (profondeur > 0) out.push(`${f.no}={${champsCourts(f.value, profondeur - 1, budget)}}`);
      else out.push(`${f.no}={…}`);
    }
    else if (f.kind === 'bytes') out.push(`${f.no}=<${(f.raw || f.value || '').length}o>`);
    else out.push(`${f.no}=${f.value}`);
    if (out.join(' ').length > budget) { out.push('…'); break; }
  }
  return out.join(' ');
}

function diagnostic(sup) {
  const idsVus = new Map();   // pid -> characterId deja journalise
  return function onTrame({ pid, dir, frame, brute, estMaitre }) {
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
      if (CAPTURE_OCTETS) for (const l of hexDump(brute)) journal(pid, l);
      return;
    }

    // Les trois messages de tour sont marques: jzc l'ouvre, jyj dit qu'il est
    // a nous, jxh le termine.
    const moi = id !== null && id !== undefined
      && (frame.payload || []).some((f) => (f.no === 1 || f.no === 2) && f.value === id);
    const tour = ['jzc', 'jyj', 'jxh'].includes(frame.type) ? ' *' : '  ';
    journal(pid, `cap :${tour}<-- ${frame.kind} ${frame.type} { ${champsCourts(frame.payload)} }`
      + `${moi ? '  <-- MOI' : ''}`);
    if (CAPTURE_OCTETS) for (const l of hexDump(brute)) journal(pid, l);
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
    ecartesHdv.delete(pid);
    // Meme raison que les deux lignes ci-dessus, et elle compte davantage ici:
    // un pid recycle par Windows heriterait de la COLLECTION du client
    // precedent, et afficherait les archimonstres d'un autre personnage.
    collectionArchi.oublier(pid);
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

  // L'ordre voulu par l'utilisateur, applique aux lignes envoyees au
  // panneau. C'est le seul consommateur de l'ORDRE: carteComptes et
  // ordreAffiche, construits juste apres, ne s'en servent que par id ou
  // comme ensemble complet de pids. L'ordre de Zaap n'a aucune raison
  // d'etre celui de l'equipe.
  const rangees = ordonner(lignes, favoris.ordre());
  lignes.length = 0;
  lignes.push(...rangees);

  // CE QUE LE MENU HDV DE CHAQUE LIGNE DOIT SAVOIR. Pose ici et pas dans
  // construireVue: la vue est une fonction pure qui ne connait que des comptes
  // et des clients, alors que le nombre de lots en vente est un etat du
  // sequenceur. `hdvLots` a zero veut dire « le HDV n'a pas encore ete
  // ouvert », et c'est ce qui desactive l'entree de menu -- avec sa raison.
  for (const l of lignes) {
    const aUnPid = l.pid !== null && l.pid !== undefined && reprix !== null;
    l.hdvLots = aUnPid ? reprix.lotsConnus(l.pid).length : 0;
    l.hdvEnCours = aUnPid ? reprix.enCours(l.pid) : false;
    l.hdvPiles = aUnPid && vente !== null ? vente.pilesConnues(l.pid) : 0;
    l.hdvVenteEnCours = aUnPid && vente !== null ? vente.enCours(l.pid) : false;
    // Le tableau de la DERNIERE passe finie, s'il y a eu des ecartes. Il part
    // avec la ligne parce qu'il se lit avec elle: le compte rendu annonce le
    // nombre, le tableau dit lesquels.
    l.hdvEcartes = aUnPid ? (ecartesHdv.get(l.pid) || null) : null;
  }

  // La carte des pids et la liste des pids affiches, tenues a jour ici:
  // c'est le seul endroit qui connaisse a la fois les comptes, les clients
  // et l'ordre voulu. carteComptes sert a basculerVersCompte() -- qui repond
  // au clic sur une identite, au raccourci clavier par compte ET au bouton de
  // souris par compte (les deux poses dans poserRaccourcis()), c'est la
  // fonctionnalite meme qui a rendu la navigation cyclique inutile -- et a la
  // fermeture d'un client depuis sa ligne (fermerUnClient), toutes deux par
  // id. ordreAffiche sert a fermerClientsConnus, sur le chemin
  // process.on('exit') — comme ensemble complet de pids a fermer, jamais
  // dans son ordre.
  carteComptes = new Map();
  ordreAffiche = [];
  for (const l of lignes) {
    if (l.pid === null || l.pid === undefined) continue;
    if (l.id !== null && l.id !== undefined) carteComptes.set(l.id, l.pid);
    ordreAffiche.push(l.pid);
  }

  // La touche assignee a chaque compte, pour l'afficher sur sa ligne.
  const touches = favoris.touches();
  for (const l of lignes) l.touche = l.id === null ? null : (touches[l.id] || null);

  // Le nombre d'archimonstres de chaque personnage, pour le bouton de sa ligne.
  //
  // `null`, ET SURTOUT PAS 0, tant que son inventaire n'a pas ete lu: `ivx`
  // n'arrive qu'a la connexion, donc un client lance AVANT OMNI n'en enverra
  // jamais. Un zero le ferait passer pour un personnage sans une seule ame.
  //
  // On compte ici plutot que de construire le tableau entier: cet envoi part a
  // chaque tick, et croiser 286 lignes par personnage a ce rythme serait payer
  // cher un chiffre.
  const amesParPid = collectionArchi.etat();
  for (const l of lignes) {
    const ames = l.pid === null || l.pid === undefined ? undefined : amesParPid.get(l.pid);
    l.archi = ames === undefined ? null : [...ames].filter(estArchimonstre).length;
  }

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
    pdaArchi: pdaArchi !== null && pdaArchi.estAllume(),
    // Sans maitre, rien ne se replique. L absence de duplication et une panne
    // produisent le meme silence: l en-tete doit dire lequel des deux.
    sansMaitre: superviseur.maitre === null,
    erreurComptes,
    delai: favoris.delai(),
    hdvRythme: favoris.hdvRythme(),
    hdvBornes: HDV_BORNES,
    avisBascule: avisCourant(),
    // Pour que le bouton de la barre du bas dise s'il ouvre ou s'il ferme.
    overlayOuvert: overlay !== null && !overlay.isDestroyed(),
    // Ce que cette cle a le droit d utiliser. La page grise le reste.
    droits: veille.droits(),
    lignes,
  });

  // Les lignes du dernier envoi, retenues pour deux usages qui ne peuvent pas
  // se permettre de tout recalculer: le rafraichissement immediat de l'overlay
  // au changement de fenetre, et l'action groupee de sa colonne « Répl. ».
  // Reconstruire la vue demande un listerClients(), qui passe par powershell.
  dernieresLignes = lignes;
  rafraichirOverlay();
}

// L'overlay recoit une vue REDUITE des memes lignes, jamais l'etat du panneau
// tel quel: la reduction est ecrite et testee dans src/comptes/overlay.js,
// hors d'Electron. La page ne decide de rien.
//
// Appele au tick d'etat ET a chaque changement de fenetre au premier plan.
function rafraichirOverlay() {
  if (overlay === null || overlay.isDestroyed()) return;
  overlay.webContents.send('etat', {
    // L'etat d'ENSEMBLE de la colonne « Répl. »: 'tous', 'partiel' ou 'aucun'.
    // C'est le meme calcul que le losange du titre de colonne, fait ici pour
    // que les deux fenetres montrent la meme chose sans que la page ait a le
    // refaire — et sans qu'elles puissent en donner deux versions.
    repl: etatColonne(dernieresLignes, 'repl'),
    // LE PASSE-TOUR EN DEUX TAS: { meneur, mules }. Le meneur seul d'un cote,
    // tous les autres comptes en jeu de l'autre — le bouton de la barre est
    // coupe en deux et les deux moities sont independantes. Le calcul est
    // ecrit et teste dans src/comptes/overlay.js, hors d'Electron.
    tour: etatTour(dernieresLignes),
    // `passe-tour` est une fonction VERROUILLABLE (src/droits/liste.js). Le
    // panneau grise sa colonne quand la cle ne l'a pas; sans cet envoi la barre
    // ne pourrait pas en faire autant, et un ami sans le droit cliquerait dans
    // le vide sans rien comprendre.
    peutTour: veille.droits().includes('passe-tour'),
    actif: favoris.actif(),
    sansMaitre: superviseur.maitre === null,
    sens: favoris.overlay().sens,
    // `enAvant` est le pid de la fenetre au premier plan, alimente par les
    // agents. Il sert a ENCADRER le picto correspondant, jamais a decider qui
    // commande: voir src/comptes/overlay.js.
    pictos: pourOverlay(dernieresLignes, superviseur.enAvant),
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

  // L'OVERLAY PART AVEC LE PANNEAU. Sans cela, fermer le panneau ne
  // declencherait pas window-all-closed tant que l'overlay vit: OMNI resterait
  // en memoire, sans fenetre visible dans la barre des taches — l'overlay est
  // skipTaskbar — et le relancer donnerait deux instances. Le meme piege que
  // la fermeture bornee plus bas, par un autre chemin.
  fenetre.on('closed', () => { fermerOverlay(); });
}

// --- l'overlay --------------------------------------------------------------
//
// Une deuxieme fenetre, sans cadre, posee sur le jeu: un picto de classe par
// compte EN JEU, et l'interrupteur du replicate. Elle n'invente aucun
// comportement — basculerVersCompte, definirMaitre et basculerActif sont les
// ordres du panneau, appeles depuis un autre endroit. C'est ce qui garantit
// que les deux fenetres ne peuvent pas se contredire.
//
// TROIS CHOIX PAYES D'UNE MESURE, faite le 2026-08-29 sur une fenetre d'essai
// chargee par le binaire packagee (voir la conception):
//
//   focusable: false — 12 clics gauches et 8 clics droits recus, tous avec
//     document.hasFocus() a faux, et pas un evenement 'focus' sur la fenetre.
//     On peut donc couper le replicate en plein combat sans que Dofus perde la
//     main. C'est toute la raison d'etre de cette fenetre.
//
//   showInactive() plutot que show() — show() donnerait le focus a l'ouverture,
//     ce que la ligne precedente cherche precisement a eviter.
//
//   le deplacement code a la main — le glissement natif (-webkit-app-region)
//     s'appuie sur le focus et n'a PAS ete verifie dans cet etat; celui-ci l'a
//     ete, trois glissements enregistres. On garde ce qui est prouve.
//
// La taille n'est pas ecrite ici: la barre change de largeur des qu'un client
// se ferme, et c'est la page qui mesure son propre rendu (canal overlayTaille).
// Une fenetre plus large que sa barre laisserait une zone transparente qui
// avale les clics destines au jeu.
function creerOverlay() {
  if (overlay !== null && !overlay.isDestroyed()) {
    overlay.showInactive();
    return;
  }

  const place = favoris.overlay();
  overlay = new BrowserWindow({
    width: 320,
    height: 60,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    // Elle n'a pas sa place dans la barre des taches: ce n'est pas une
    // application de plus, c'est une poignee sur celle-ci.
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    title: 'OMNI',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
    },
  });

  // 'screen-saver' est le niveau le plus haut qu'Electron expose, le seul qui
  // ait une chance de tenir au-dessus d'un jeu. Reste a verifier en jeu: c'est
  // la troisieme inconnue de la conception, encore ouverte. Repli connu si
  // elle tombe: jouer en fenetre, ce qui est deja le cas en multi-compte.
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.removeMenu();

  // La position enregistree, ou le coin haut droit de l'ecran de travail. On
  // ne retient pas 0,0 par defaut: sur une machine dont on ne connait pas la
  // definition, ca collerait la barre dans un angle.
  if (Number.isInteger(place.x) && Number.isInteger(place.y)) {
    overlay.setPosition(place.x, place.y);
  } else {
    const zone = screen.getPrimaryDisplay().workArea;
    overlay.setPosition(zone.x + zone.width - 360, zone.y + 40);
  }

  overlay.once('ready-to-show', () => {
    overlay.showInactive();
    // Le premier etat ne doit pas attendre le tick de 2 s: la barre resterait
    // vide au moment ou l'utilisateur vient de cliquer pour l'ouvrir.
    envoyerEtat();
  });
  overlay.on('closed', () => { overlay = null; priseOverlay = null; });
  overlay.loadFile(path.join(__dirname, 'overlay.html'));
}

function fermerOverlay() {
  if (overlay === null || overlay.isDestroyed()) { overlay = null; return; }
  overlay.destroy();
  overlay = null;
  priseOverlay = null;
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
  // Meme raison pour le rythme des passes HDV.
  reglagesHdv.rythme = favoris.hdvRythme();

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
    // L'encadre de l'overlay doit suivre le regard, pas le minuteur. Sans ce
    // rappel, il n'apparaissait qu'au tick d'etat suivant — jusqu'a deux
    // secondes de retard, et l'air de ne pas s'actualiser du tout quand on
    // enchaine les bascules plus vite que ca.
    //
    // On ne renvoie QUE l'etat de l'overlay: reconstruire la vue complete
    // demande un listerClients(), qui passe par powershell. Le faire a chaque
    // changement de fenetre serait hors de proportion.
    onEnAvant: () => rafraichirOverlay(),
    transformerEntrant: composerDescendant(creerTransformateurFlux({
      reglages: reglagesNoAnim,
      // CRITICAL de revue finale: sans ce predicat, le transformateur ne
      // consultait que le drapeau general (noAnim.size > 0) et armait DONC
      // TOUS les comptes des qu'un seul avait sa case cochee. Comme ses
      // trois jumeaux (passeur, accepteur), la decision doit se prendre par
      // compte, sur l'etat vivant que balayerProcess()/envoyerEtat()
      // synchronisent depuis favoris.json.
      estArmePourCompte: (pid) => {
        // Le droit se relit ici a chaque connexion evaluee, comme la porte le
        // fait pour les politiques de composer(): un droit retire doit mordre
        // dans la minute, pas a la prochaine fermeture d'OMNI.
        //
        // veille est encore null a la lecture de ce fichier (elle n'est
        // affectee que plus bas, au chargement) mais estArmePourCompte est
        // une fermeture: elle n'est appelee que bien plus tard, une fois
        // veille construite. Le test veille === null n'est donc pas un filet
        // pour cette fenetre de demarrage precise -- il ferme par defaut si
        // jamais veille venait a manquer, comme partout ailleurs dans ce
        // dessin.
        if (veille === null || !veille.droits().includes('no-anim')) return false;
        const etat = superviseur.comptes.get(pid);
        return etat !== null && Boolean(etat.noAnim);
      },
      onCompteRendu: ({ conn, pid, raison }) => journal(pid, `no-anim (connexion ${conn}) : ${raison}`),
    // ... puis, apres lui, le masquage des trames qu'OMNI a acceptees a la
    // place du joueur. Le no-anim REECRIT, le masque RETIRE: dans cet ordre,
    // le masque travaille sur ce que le client verrait vraiment.
    }), (buf, conn) => masque.transformer(buf, conn)),
    onSouris: ({ clic }) => jouerSouris(clic),
  });

  // Sans ce branchement, le superviseur decode tout et ne rejoue rien:
  // l'interrupteur ne bascule qu'un drapeau que seul rejouer() consulte. La
  // decision est celle du CLI, au mot pres, parce que c'est le meme module.
  //
  // Le superviseur n'accepte qu'un seul onTrame: le passe-tour, politique
  // independante du OMNI, se compose ici plutot que d'ajouter un second
  // point d'entree au superviseur.
  // LA MISE A JOUR DES PRIX EN HOTEL DE VENTE.
  //
  // Elle ecoute EN PERMANENCE, meme quand aucune passe ne tourne: `kby` --
  // la liste de nos lots en vente -- n'arrive qu'a l'ouverture du HDV. Un
  // module qui ne se reveillerait qu'au clic du bouton aurait deja rate la
  // seule trame qui dit ce qu'on vend.
  reprix = creerReprix({
    superviseur,
    reglages: reglagesHdv,
    onCompteRendu: (r) => {
      // Un refus au lancement: le bouton a ete clique et rien ne va partir.
      // C'est exactement ce que l'utilisateur ne peut pas deviner.
      if (r.ok === false) {
        messages.set(r.pid, `HDV : ${r.raison}`);
        journal(r.pid, `hdv refus : ${r.raison}`);
        envoyerEtat();
        return;
      }
      if (r.fini) {
        const b = r.bilan;
        const ecartes = retenirEcartes(r.pid, 'prix', b.ecartes);
        messages.set(r.pid, (r.raison
          ? `HDV : arrêt — ${r.raison} (${b.maj} mis à jour)`
          : `HDV : ${b.maj} mis à jour, ${b.laisses} déjà au meilleur prix, ${b.echecs} échoués`)
          + suffixeEcartes(ecartes));
        journal(r.pid, `hdv fin : ${b.maj} maj, ${b.laisses} laisses, ${b.echecs} echecs, `
          + `${ecartes} ecartes` + (r.raison ? ` — ${r.raison}` : ''));
        envoyerEtat();
        return;
      }
      // LE DEBUT EST LE SEUL AVANCEMENT QUI ENVOIE L'ETAT, et il le fait UNE
      // FOIS PAR PASSE. Sans lui, le clic restait sans reponse visible jusqu'au
      // tick suivant, alors que c'est precisement l'instant ou l'utilisateur
      // attend de savoir combien de lots vont y passer.
      if (r.debut) {
        messages.set(r.pid, `HDV : ${r.total} lots à mettre à jour`);
        journal(r.pid, `hdv debut : ${r.total} lots`);
        envoyerEtat();
        return;
      }
      // LES AVANCEMENTS SUIVANTS, EUX, N'ENVOIENT RIEN. envoyerEtat() lance
      // powershell.exe par clientsRecents(): l'appeler a chaque lot ferait
      // 376 lancements sur le compte de mesure. Le tick de 2 s les affiche.
      if (r.restant !== undefined) {
        messages.set(r.pid, `HDV : ${r.restant} lots restants sur ${r.total}`);
      }
    },
  });

  // LA MISE EN VENTE.
  //
  // Elle ecoute EN PERMANENCE, comme la mise a jour des prix et pour la meme
  // raison: ivx — la liste des piles — arrive quand le joueur ouvre son
  // panneau de vente, pas quand il clique sur le bouton. La difference est que
  // c'est le CLIENT qui la demande, de lui-meme: OMNI n'emet aucun itr.
  vente = creerVente({
    superviseur,
    reglages: reglagesHdv,
    onCompteRendu: (r) => {
      if (r.ok === false) {
        messages.set(r.pid, `HDV : ${r.raison}`);
        journal(r.pid, `vente refus : ${r.raison}`);
        envoyerEtat();
        return;
      }
      if (r.fini) {
        const b = r.bilan;
        const ecartes = retenirEcartes(r.pid, 'vente', b.ecartes);
        messages.set(r.pid, (r.raison
          ? `HDV : arrêt — ${r.raison} (${b.poses} lots posés)`
          : `HDV : ${b.poses} lots posés, ${b.sautes} sautés, ${b.echecs} échoués`)
          + suffixeEcartes(ecartes));
        journal(r.pid, `vente fin : ${b.poses} poses, ${b.sautes} sautes, ${b.echecs} echecs, `
          + `${b.objetsAbandonnes} objets abandonnes, ${ecartes} ecartes`
          + (r.raison ? ` — ${r.raison}` : ''));
        envoyerEtat();
        return;
      }
      // MEME REGLE QUE POUR L'ACTUALISATION: le debut envoie l'etat une fois,
      // les avancements suivants attendent le tick de 2 s.
      if (r.debut) {
        messages.set(r.pid, `HDV : ${r.total} lots à mettre en vente`);
        journal(r.pid, `vente debut : ${r.total} lots candidats`);
        envoyerEtat();
        return;
      }
      // LE RESTANT NE TOMBERA PAS A ZERO, et c'est assume. Le stock de mesure
      // porte 6495 lots candidats; la passe s'arretera au plafond de l'hotel
      // de vente, quelques centaines avant. Le chiffre dit ce qui POURRAIT
      // encore partir — c'est ce qu'on sait, et l'avancement se lit dessus.
      if (r.restant !== undefined) {
        messages.set(r.pid, `HDV : ${r.poses} posés — ${r.restant} lots restants`);
      }
    },
  });
  // LA CHASSE A L'ARCHIMONSTRE.
  //
  // Elle ecoute EN PERMANENCE elle aussi, et meme eteinte: sans cela, allumer
  // l'interrupteur devant un combat n'aurait aucun effet avant le prochain
  // changement de carte, l'inventaire et la carte n'arrivant qu'a ce
  // moment-la.
  pdaArchi = creerPdaArchi({
    superviseur,
    actif: favoris.pdaArchi(),
    onCompteRendu: (r) => {
      if (r.quoi === 'equipe') {
        journal(r.pid, `PdA archi : pierre ${r.gid} equipee`);
        messages.delete(r.pid);
        return;
      }
      if (r.quoi === 'deja' || r.quoi === 'envoye') {
        journal(r.pid, `PdA archi : ${r.quoi} ${r.gid}`);
        return;
      }
      // LES CAS OU LA CAPTURE EST IMPOSSIBLE, ET EUX SEULS, remontent au
      // panneau et font biper: c'est pendant la phase de preparation qu'on les
      // regarde, et a ce moment-la on regarde le jeu, pas OMNI.
      //
      // `r.nom` est le nom de la PIERRE qui manque, `r.compte` celui du
      // personnage: src/pda-archi/pda-archi.js les separe expres.
      const textes = {
        manque: `PdA archi : pas de ${r.nom} pour du niveau ${r.niveauMax}`,
        'hors-portee': `PdA archi : niveau ${r.niveauMax}, aucune pierre ne couvre`,
        'groupe-inconnu': 'PdA archi : groupe inconnu, rien equipe',
        // Le combat est bien reconnu, mais personne n'a vu partir son groupe:
        // OMNI lance en cours de combat, ou l'attaquant n'est pas un de nos
        // clients. Sans niveau on ne choisit pas de pierre, et se taire est
        // exactement ce qui a rendu le bug du 04/09 introuvable.
        'niveau-inconnu': 'PdA archi : niveau du groupe inconnu, rien equipe',
        echec: 'PdA archi : ordre refuse',
        // Le serveur n'a rien repondu en 3 s alors qu'il repond en 40 ms.
        'sans-reponse': `PdA archi : ${r.gid} pas equipee, le serveur n a rien repondu`,
      };
      const texte = textes[r.quoi];
      if (texte === undefined) return;
      journal(r.pid, texte);
      messages.set(r.pid, texte);
      if (fenetre !== null && !fenetre.isDestroyed()) {
        fenetre.webContents.send('pdaArchiAlerte', { pid: r.pid, texte });
      }
    },
  });

  // LES DROITS ACCORDES A CETTE CLE. Relus toutes les 60 s: Draxus coupe une
  // case au panneau, la fonction s arrete ici dans la minute.
  //
  // PAS app.getPath('userData'): package.json ne pose ni productName ni
  // app.setName (name: "mm"), donc userData vaut %APPDATA%\mm, pas
  // %APPDATA%\OMNI. cle.txt est ecrit par amorceur/cle.js dans
  // %APPDATA%\OMNI -- meme expression que la RACINE de
  // amorceur/principal.js, reprise ici pour lire le meme fichier.
  const dossierDonnees = path.join(app.getPath('appData'), 'OMNI');
  // REVUE FINALE (meme raisonnement que sur creerGardeCombat plus bas) :
  // onJournal seul est un piege ici aussi. journal() ne s'ecrit que sous
  // OMNI_JOURNAL=complet -- jamais chez un ami -- et onJournal est l'UNIQUE
  // canal par lequel la veille signale un rappel onChangement qui leve ou
  // une ecriture de cache en echec (voir src/droits/veille.js). Sans le
  // second canal, ces deux pannes deviendraient invisibles precisement chez
  // qui n'a pas de console attachee. Les deux canaux, donc : journal() pour
  // la mesure fine (utile sous lancer-diag.vbs), noterAvis() + envoyerEtat()
  // pour que l'ami devant OMNI le voie -- meme pied de page qui s'efface
  // seul, deja le canal des evenements ponctuels sans destinataire unique.
  const onJournalVeille = (pid, texte) => {
    journal(pid, texte);
    noterAvis(texte);
    envoyerEtat();
  };
  veille = creerVeille({
    base: 'https://paquets-maj.vercel.app',
    lireCle: () => {
      // OMNI_DEV distingue la machine de Draxus (le depot lance hors
      // paquet, via outils/lancer-dev.vbs) d'un poste ami. Sans cet
      // echappement, un cle.txt reel laisse dans %APPDATA%\OMNI par un
      // test de l amorceur verrouillerait le depot: le mode developpement
      // doit rester "tous les droits, aucune requete" quel que soit ce que
      // ce dossier contient.
      if (process.env.OMNI_DEV) return null;
      try { return fs.readFileSync(path.join(dossierDonnees, 'cle.txt'), 'utf8').trim() || null; }
      catch (e) { return null; }   // pas de cle = mode developpement = tous les droits
    },
    cache: creerCacheFichier(path.join(dossierDonnees, 'droits.json'), { onJournal: onJournalVeille }),
    // Meme onJournal que le cache juste au-dessus : voir la note REVUE
    // FINALE ci-dessus.
    onJournal: onJournalVeille,
    onChangement: ({ gagnes, perdus }) => {
      // UNE FONCTION QUI DISPARAIT EN SILENCE, c est exactement le mode
      // d echec que ce depot documente quatre fois. Elle se dit.
      if (perdus.length) noterAvis(`Droits : ${perdus.join(', ')} — retiré`);
      else if (gagnes.length) noterAvis(`Droits : ${gagnes.join(', ')} — activé`);
      // Les deux travaux de l hotel de vente sont les seuls a durer, et
      // chacun repond a son propre droit: retirer la mise a jour des prix
      // ne doit pas arreter une mise en vente en cours, ni l inverse.
      if (perdus.includes('hdv')) {
        for (const etat of superviseur.comptes.tous) reprix.arreter(etat.pid);
      }
      if (perdus.includes('vente')) {
        for (const etat of superviseur.comptes.tous) vente.arreter(etat.pid);
      }
      // La fonction se desarme, mais son reglage enregistre ne bouge pas: le
      // droit rendu, elle repart comme l utilisateur l avait laissee.
      if (perdus.includes('pda-archi') && pdaArchi !== null) pdaArchi.armer(false);
      // Sans ca la barre flottante deja ouverte restait a l ecran apres un
      // retrait de droit: la garde IPC de basculerOverlay ne couvre que la
      // bascule, pas une fenetre deja la. PAS de reglerOverlay(false) ici:
      // ce n est pas un choix de l ami, rendre le droit doit rendre la
      // fenetre sans qu il ait a la rouvrir.
      if (perdus.includes('overlay')) fermerOverlay();
      envoyerEtat();
    },
  });
  veille.demarrer();
  const protege = creerPorte({ droits: () => veille.droits() });

  superviseur.onTrame = composer(
    creerDuplicateur({
      superviseur,
      estApprise: (cle) => favoris !== null && favoris.combats().includes(cle),
      onCompteRendu: ({ type, nom, rendu }) => {
        // Un refus est la seule chose que l'utilisateur ne peut pas deviner: un
        // compte qui ne rejoue pas ressemble a un compte inactif. On garde le
        // dernier par client, efface des que le rejeu repasse.
        for (const r of rendu) {
          // Un refus n a pas de trace datee ailleurs: `messages` n affiche que
          // le dernier, et il s efface au rejeu suivant. Sous
          // OMNI_JOURNAL=complet, chaque refus doit se dater comme un envoi.
          if (!r.ok) journal(r.pid, `rejeu ${type} refuse : ${r.raison}`);
          if (r.ok) messages.delete(r.pid);
          else messages.set(r.pid, `${nom} : ${r.raison}`);
        }
      },
    }),
    creerGardeCombat({
      superviseur,
      // La liste vit dans les reglages: le garde ne la connait pas, il
      // demande. Les reglages sont poses avant la fenetre, donc avant tout
      // client, mais la garde evite de dependre de cet ordre.
      estApprise: (cle) => favoris !== null && favoris.combats().includes(cle),
      // REVUE FINALE : le garde etait muet en usage normal. onJournal ne
      // s'ecrit que sous OMNI_JOURNAL=complet -- jamais chez l'utilisateur ni
      // chez ses amis -- donc l'apprentissage d'une action et l'annulation de
      // rejeux ne laissaient aucune trace visible. C'est precisement le mode
      // d'echec le plus couteux du projet : une chose qui « ne fait rien »
      // sans que rien ne le relie a sa cause.
      //
      // noterAvis() plutot que la Map `messages` : ces deux evenements
      // concernent le maitre et ce qu'il vient de declencher chez TOUS ses
      // esclaves, pas un compte en particulier -- `messages` est affichee sur
      // la ligne d'UN compte et n'a pas de ligne naturelle pour ca. Le pied de
      // page, qui s'efface seul, est deja le canal des evenements ponctuels
      // sans destinataire unique (voir avisBascule plus haut).
      onApprendre: (cle) => {
        if (favoris !== null) favoris.apprendreCombat(cle);
        noterAvis(`combat : action retenue, elle ne sera plus rejouée (${cle})`);
      },
      onAnnulation: (n) => noterAvis(
        n === 1 ? 'combat : 1 rejeu en attente annulé' : `combat : ${n} rejeux en attente annulés`,
      ),
      onJournal: journal,
    }),
    protege('abandon', creerAbandonGroupe({
      superviseur,
      // Les deux canaux, pour deux raisons differentes. `journal()` ne s'ecrit
      // que sous OMNI_JOURNAL=complet et sert la mesure; `messages` est ce que
      // l'utilisateur voit sur la ligne du compte. Une politique qui ne parle
      // qu'a journal() est muette en usage normal -- le piege paye le 29/08
      // sur les songes.
      //
      // Le succes efface le message precedent, comme le fait le duplicateur au
      // rejeu suivant: une mule qui a bien abandonne n'a rien a signaler.
      onCompteRendu: ({ pid, ok, raison }) => {
        if (ok) journal(pid, 'abandon : replique chez la mule');
        else journal(pid, `abandon : ${raison}`);
        if (ok) messages.delete(pid);
        else messages.set(pid, `abandon : ${raison}`);
      },
    })),
    protege('passe-tour', creerPasseur({
      superviseur,
      reglages: reglagesPasseTour,
      onCompteRendu: ({ pid, ok, raison, declencheur }) => {
        // Le jalon declencheur, et pas seulement le fait d'avoir emis: c'est
        // lui qui a dit que la relance d'ouverture avait survecu.
        if (ok) journal(pid, `passe-tour : jxy emis (sur ${declencheur})`);
        else journal(pid, `passe-tour : ${raison}`);
      },
    })),
    protege('invitation', creerAccepteur({
      superviseur,
      reglages: reglagesInvitation,
      masquer: (pid, brute) => masque.marquer(pid, brute),
      onCompteRendu: ({ pid, ok, raison, groupe }) => {
        if (ok) journal(pid, `invitation : acceptee (groupe ${groupe})`);
        else journal(pid, `invitation : ${raison}`);
      },
    })),
    protege('echange', creerAccepteurEchange({
      superviseur,
      reglages: reglagesEchange,
      delai: DELAI_REACTION,
      // PAS DE `masquer:` ICI, ET C'EST UNE MESURE, PAS UN OUBLI. Essai en jeu
      // du 2026-09-04: `kfz` masquee, le compte invite ne voit plus du tout
      // qu'il est en echange -- il ne peut donc plus rien y deposer. Cette
      // trame ne fait pas qu'ouvrir un panneau, elle EST ce qui apprend
      // l'echange au client. Voir le spec du 2026-09-04.
      onCompteRendu: ({ pid, ok, raison, validation, retardMs }) => {
        if (ok) journal(pid, `echange : ${validation ? 'valide' : 'accepte'} apres ${retardMs} ms`);
        else journal(pid, `echange : ${raison}`);
      },
    })),
    protege('songe', creerAccepteurSonge({
      superviseur,
      reglages: reglagesSonge,
      delai: DELAI_SONGE,
      onCompteRendu: ({ pid, ok, raison, retardMs }) => {
        if (ok) journal(pid, `songe : invitation acceptee apres ${retardMs} ms`);
        else journal(pid, `songe : ${raison}`);
        // journal() ne s'ecrit que sous OMNI_JOURNAL=complet: en usage normal
        // ni le succes ni le refus n'y seraient jamais vus. `messages` est le
        // canal qui atterrit dans le panneau, sur la ligne du compte -- les
        // deux sont complementaires, ni l'un ni l'autre ne remplace l'autre.
        //
        // Cette Map est PARTAGEE avec le duplicateur (rejeu, plus haut): un
        // refus de songe peut donc ecraser brievement un refus de rejeu
        // affiche sur la meme ligne. Accepte, parce que les songes sont rares.
        if (ok) messages.delete(pid);
        else messages.set(pid, raison);
      },
    })),
    protege('hdv', reprix.onTrame),
    protege('vente', vente.onTrame),
    protege('pda-archi', pdaArchi.onTrame),
    // Sans porte: elle ne fait que lire l'inventaire pour le tableau.
    collectionArchi.onTrame,
    noterTrafic(),
    // DIAGNOSTIC TEMPORAIRE — voir diagnostic() plus haut.
    diagnostic(superviseur),
    // Une politique qui leve doit se voir. C'est ce qui manquait: le passeur
    // pouvait echouer sur une trame sans laisser la moindre trace.
    { onErreur: ({ evenement, erreur }) => journal(evenement.pid, `POLITIQUE EN ECHEC sur ${evenement.frame && evenement.frame.type} : ${erreur.stack}`) },
  );

  // L'etat enregistre de l'interrupteur unique, applique aux six politiques
  // d'un coup.
  appliquerActif(favoris.actif());

  creerFenetre();
  // L'overlay revient s'il etait ouvert au dernier arret, et seulement dans ce
  // cas: un ami qui passe de la 0.2.6 a cette version n'a pas la cle dans son
  // fichier, il ne doit pas voir surgir une fenetre qu'il n'a pas demandee.
  // Et seulement si le droit tient encore: sans ce garde-fou, le droit
  // overlay coupe entre deux lancements serait contourne au demarrage
  // suivant, avant meme que la veille n'ait eu la chance de le redire.
  if (veille.droits().includes('overlay') && favoris.overlay().ouvert) creerOverlay();
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
  const r = superviseur.basculerVers(pid);
  if (!r.ok) {
    journal(pid, `bascule refusee : ${r.raison}`);
    // 'client inconnu' vient de basculerVers() quand ce pid n'a jamais ete
    // passe a superviseur.ajouter() (voir balayerProcess : plafond de 8
    // clients, ou pid vu par clientsRecents() avant le prochain balayage).
    // Ce n'est PAS le cas d'un client lance avant OMNI: celui-la s'attache
    // sans probleme (voir src/comptes/vue.js, etat "non-intercepte"), donc
    // basculerVers() y reussit. La raison technique reste dans le journal.
    noterAvis(r.raison === 'client inconnu'
      ? 'bascule impossible : client pas encore pris en charge par OMNI'
      : `bascule impossible : ${r.raison}`);
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

// LE SEUL RECOURS quand OMNI a retenu a tort qu'une action lance un combat.
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

// L'ACTION GROUPEE DE LA COLONNE « Répl. », declenchee depuis l'overlay.
//
// C'est le MEME geste que le clic sur le titre de colonne dans le panneau: il
// pose la meme valeur pour tous les comptes affiches, en ecrivant dans les
// memes cases que les clics individuels. Il n'y a donc aucun second etat
// cache, et les deux fenetres ne peuvent pas se contredire.
//
// La difference avec basculerColonne: la cible n'est pas fournie par le
// renderer. L'overlay ne tient pas la liste des lignes, et de toute facon le
// fichier de reglages fait foi — deux clics rapides ne doivent pas partir de
// deux lectures differentes de l'affichage.
ipcMain.handle('basculerReplGroupe', async () => {
  // carteComptes ne porte QUE les comptes affiches qui ont un client en cours
  // et un identifiant: exactement ceux que l'overlay montre.
  const ids = [...carteComptes.keys()];
  if (ids.length === 0) return;
  await basculerColonneAvec('repl', ids);
});

// LE PASSE-TOUR DE LA BARRE, EN DEUX MOITIES INDEPENDANTES.
//
// 'meneur' ne touche que le compte qui commande, 'mules' tous les autres. C'est
// la seule chose que ce canal decide: le reste est celui du titre de colonne
// « Tour » du panneau, appele avec un tas au lieu de la liste entiere. Donc
// aucun second etat cache, les memes cases par compte, et la cible recalculee
// cote principal depuis le fichier de reglages — deux clics rapides ne partent
// pas de deux lectures differentes de l'affichage.
//
// Le meneur qui change emporte son reglage avec lui: les deux tas sont refaits
// a chaque appel depuis dernieresLignes, l'ancien meneur retombe dans les mules.
ipcMain.handle('basculerTourGroupe', async (_e, cible) => {
  if (cible !== 'meneur' && cible !== 'mules') return;
  // La fenetre peut rester ouverte apres un retrait de droit: la garde est ici,
  // pas seulement dans le grisage de la page.
  if (!veille.droits().includes('passe-tour')) {
    noterAvis('Passe-tour : pas activé sur ta clé');
    await envoyerEtat();
    return;
  }
  // Le meme ensemble que les pictos et que etatTour(): les comptes en jeu qui
  // portent un identifiant. carteComptes ne retient qu'eux.
  const meneurs = dernieresLignes
    .filter((l) => l.estMaitre && l.id !== null && l.id !== undefined && carteComptes.has(l.id))
    .map((l) => l.id);
  const ids = cible === 'meneur'
    ? meneurs
    : [...carteComptes.keys()].filter((id) => !meneurs.includes(id));
  if (ids.length === 0) return;
  await basculerColonneAvec('tour', ids);
});

// --- les ordres propres a l'overlay -----------------------------------------
//
// Aucun de ces canaux ne touche au replicate, au maitre ni aux cases par
// compte: pour cela l'overlay appelle les canaux DU PANNEAU. Ici on ne regle
// que la fenetre elle-meme.

// LES DEUX ENTREES DU MENU HDV, POSE SUR CHAQUE LIGNE DE COMPTE.
//
// Le jalon global de la barre du bas a disparu avec elles: il ne pouvait pas
// designer « le compte de la ligne », qui est precisement la cible retenue.
//
// Une seule voie pour lancer ET arreter. Le menu affiche « Arrêter » pendant la
// passe, donc le geste est sans ambiguite, et un second clic ne peut jamais
// lancer une passe par-dessus une autre.
ipcMain.handle('majPrixHdv', async (_e, pid) => {
  // Le bouton grise cote page, mais un bouton grise se contourne avec les
  // outils de developpement d Electron: la vraie garde est ici. noterAvis()
  // pour que ce contournement ne soit pas un refus totalement muet -- meme
  // symetrie que la garde overlay juste en dessous.
  if (!veille.droits().includes('hdv')) {
    noterAvis('HDV : pas activé sur ta clé');
    envoyerEtat();
    return { ok: false, raison: 'HDV : pas activé sur ta clé' };
  }
  if (reprix === null || !Number.isInteger(pid)) return;
  if (reprix.enCours(pid)) reprix.arreter(pid);
  else reprix.lancer(pid);
  await envoyerEtat();
});

// LA CHASSE A L'ARCHIMONSTRE. Un interrupteur, rien de plus: il n'y a pas de
// passe a lancer ni a arreter, elle reagit a l'entree en combat.
//
// Le refus quand le droit manque est EXPLICITE, meme raison que pour le HDV
// juste au-dessus: une case qui se decoche toute seule sans un mot est un
// bouton qui « ne fait rien ».
// LE TABLEAU DES ARCHIMONSTRES: 286 lignes, une colonne par personnage.
//
// Construit A LA DEMANDE, jamais dans l'envoi d'etat: le panneau ne l'affiche
// que quand on ouvre la vue, et croiser 286 lignes par personnage a chaque tick
// serait payer cher un tableau que personne ne regarde.
//
// LES NOMS VIENNENT DES DERNIERES LIGNES ENVOYEES, pas d'un nouveau
// listerClients(): celui-ci passe par powershell, et ouvrir un tableau ne doit
// pas attendre un process. Un personnage vu il y a une seconde est le bon.
//
// LE PERSONNAGE SUIVI NE TRAVERSE PLUS L'IPC, et c'est la correction du 05/09.
// Un `vise` partait avec la demande et restreignait « manquant » a lui seul
// dans la vue par zone: un personnage complet effacait des zones ou les trois
// autres avaient tout a prendre. La colonne suivie ne vit plus que dans le
// panneau, ou elle surligne et filtre la liste sans rien croiser.
ipcMain.handle('tableauArchi', (_e, quoi) => construireTableauArchi({
  // La collection demandee. Une valeur inconnue rend les archimonstres: le
  // panneau ne peut pas casser sur une faute de frappe.
  quoi: typeof quoi === 'string' ? quoi : 'archi',
  comptes: (dernieresLignes || [])
    .filter((l) => l.pid !== null && l.pid !== undefined)
    .map((l) => ({
      pid: l.pid,
      nom: l.personnage || l.nickname,
      // `null` quand l'inventaire n'a pas ete lu, un Set vide quand il l'a ete
      // et qu'il ne porte aucune ame. tableau.js compte sur la difference.
      ames: collectionArchi.etat().get(l.pid) || null,
    })),
}));

// REDEMANDER L'INVENTAIRE DE TOUS LES CLIENTS, sans se deconnecter.
//
// `ivx` ne tombe qu'a la connexion: sans ce bouton, une capture faite pendant
// la partie n'apparaissait qu'apres une reconnexion. `itr` est la demande que
// le jeu emet lui-meme en ouvrant un panneau de rangement, et le serveur repond
// en 38 ms (mesure du 01/09, trois fois sur trois).
//
// ELLE N'EST PAS VERROUILLABLE PAR CLE, et c'est un choix. Cette fonction emet
// desormais quelque chose -- ce qui ne fait plus d'elle une pure lectrice -- mais
// ce qu'elle emet est une LECTURE, celle que le client fait tout seul, et qui ne
// change rien dans le jeu. Decision reversible: l'ajouter a src/droits/liste.js
// et a serveur-maj/lib/fonctions.js serait deux lignes et un test.
//
// LA REPONSE ARRIVE PAR L'ECOUTE ORDINAIRE, pas ici: le `ivx` qui revient passe
// par collectionArchi.onTrame comme n'importe quelle trame. Ce handler ne rend
// donc que ce qu'il a pu DEMANDER, jamais ce qui est revenu -- et la page attend
// avant de relire.
ipcMain.handle('archiRelire', () => {
  if (superviseur === null) return { ok: false, demandes: 0, total: 0 };
  const pids = (dernieresLignes || [])
    .filter((l) => l.pid !== null && l.pid !== undefined && l.etat !== 'hors-ligne')
    .map((l) => l.pid);
  let demandes = 0;
  for (const pid of pids) {
    const res = superviseur.emettre(pid, trameLireInventaire());
    if (res !== null && res !== undefined && res.ok === true) demandes += 1;
    else journal(pid, 'archi : la demande d inventaire n est pas partie');
  }
  return { ok: demandes > 0, demandes, total: pids.length };
});

ipcMain.handle('pdaArchiArmer', async (_e, actif) => {
  if (pdaArchi === null) return { ok: false, raison: 'PdA archi : pas encore prete' };
  if (actif === true && !veille.droits().includes('pda-archi')) {
    noterAvis('PdA archi : pas activé sur ta clé');
    await envoyerEtat();
    return { ok: false, raison: 'PdA archi : pas activé sur ta clé' };
  }
  pdaArchi.armer(actif === true);
  favoris.marquerPdaArchi(actif === true);
  await envoyerEtat();
  return { ok: true };
});

// LA MISE EN VENTE. Une seule voie pour lancer ET arreter, comme la mise a
// jour des prix: le menu affiche « Arrêter » pendant la passe, donc le geste
// est sans ambiguite et un second clic ne peut pas lancer une passe par-dessus
// une autre.
ipcMain.handle('mettreEnVenteHdv', async (_e, pid) => {
  // Meme garde que majPrixHdv juste au-dessus: le bouton grise cote page se
  // contourne avec les outils de developpement d Electron, la vraie garde est
  // ici. noterAvis() pour que le refus ne soit pas muet.
  if (!veille.droits().includes('vente')) {
    noterAvis('Mise en vente : pas activé sur ta clé');
    envoyerEtat();
    return;
  }
  if (vente === null || !Number.isInteger(pid)) return;
  if (vente.enCours(pid)) vente.arreter(pid);
  else vente.lancer(pid);
  await envoyerEtat();
});

// Le bouton de la barre du bas. Il bascule: ouvrir si fermee, fermer sinon.
ipcMain.handle('basculerOverlay', async () => {
  // Meme garde que majPrixHdv: le bouton grise se contourne avec les outils
  // de developpement d Electron.
  if (!veille.droits().includes('overlay')) { noterAvis('Barre flottante : pas activée sur ta clé'); envoyerEtat(); return; }
  if (overlay !== null && !overlay.isDestroyed()) {
    fermerOverlay();
    favoris.reglerOverlay({ ouvert: false });
  } else {
    favoris.reglerOverlay({ ouvert: true });
    creerOverlay();
  }
  await envoyerEtat();
});

// La croix de l'overlay. Elle enregistre la fermeture: rouvrir OMNI ne doit
// pas ramener une fenetre qu'on vient d'ecarter.
ipcMain.handle('overlayFermer', async () => {
  fermerOverlay();
  favoris.reglerOverlay({ ouvert: false });
  await envoyerEtat();
});

ipcMain.handle('overlayBasculerSens', async () => {
  const sens = favoris.overlay().sens === 'vertical' ? 'horizontal' : 'vertical';
  favoris.reglerOverlay({ sens });
  await envoyerEtat();
});

// La taille MESUREE sur la page. On borne ce qui arrive du renderer: il est
// sandboxe mais reste hors de notre controle, et setBounds accepterait une
// fenetre de 30 000 px sans broncher.
ipcMain.handle('overlayTaille', (_e, largeur, hauteur) => {
  if (overlay === null || overlay.isDestroyed()) return;
  if (!Number.isFinite(largeur) || !Number.isFinite(hauteur)) return;
  const l = Math.min(2000, Math.max(60, Math.round(largeur)));
  const h = Math.min(2000, Math.max(40, Math.round(hauteur)));
  const [x, y] = overlay.getPosition();
  overlay.setBounds({ x, y, width: l, height: h });
});

ipcMain.handle('overlayPrendre', (_e, ecart) => {
  if (overlay === null || overlay.isDestroyed()) return;
  if (ecart === null || typeof ecart !== 'object') return;
  if (!Number.isFinite(ecart.x) || !Number.isFinite(ecart.y)) return;
  priseOverlay = { dx: ecart.x, dy: ecart.y };
});

// Appele en continu pendant le glissement. On lit la position REELLE du
// curseur a l'ecran plutot que celle rapportee par la page: la fenetre bouge
// sous le curseur, ce qui fausse toute coordonnee relative a elle.
ipcMain.handle('overlayBouger', () => {
  if (overlay === null || overlay.isDestroyed() || priseOverlay === null) return;
  const p = screen.getCursorScreenPoint();
  overlay.setPosition(Math.round(p.x - priseOverlay.dx), Math.round(p.y - priseOverlay.dy));
});

// C'est le LACHER qui enregistre, pas chaque mouvement: autrement le fichier
// de reglages serait reecrit cent fois par glissement.
ipcMain.handle('overlayLacher', () => {
  priseOverlay = null;
  if (overlay === null || overlay.isDestroyed()) return;
  const [x, y] = overlay.getPosition();
  favoris.reglerOverlay({ x, y });
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
  await basculerColonneAvec(nom, ids);
});

// Le corps est EXTRAIT pour que l'overlay l'appelle aussi, sans que le geste
// existe en deux copies. Deux copies de cette logique divergeraient un jour, et
// le titre de colonne et l'overlay se mettraient a faire deux choses
// differentes sous le meme nom.
async function basculerColonneAvec(nom, ids) {
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
}

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
  // Meme garde que majPrixHdv et basculerOverlay: le bouton grise cote page
  // se contourne avec les outils de developpement d Electron, la vraie garde
  // est ici.
  if (!veille.droits().includes('no-anim')) {
    noterAvis('Animations : pas activé sur ta clé');
    envoyerEtat();
    return;
  }
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

// Le panneau envoie le champ qui vient de bouger, pas les cinq: favoris fusionne
// et BORNE, puis on relit la version bornee. Renvoyer ce qu'on vient de recevoir
// afficherait une valeur que le disque ne porte pas.
ipcMain.handle('reglerHdvRythme', async (_e, partiel) => {
  if (partiel === null || typeof partiel !== 'object') return;
  // Les champs arrivent du DOM, donc en chaines. Meme conversion que
  // reglerDelai, faite ici pour que favoris n'ait a connaitre que des nombres.
  const nombres = {};
  for (const [nom, valeur] of Object.entries(partiel)) {
    const v = Number(valeur);
    if (Number.isFinite(v)) nombres[nom] = v;
  }
  favoris.reglerHdvRythme(nombres);
  reglagesHdv.rythme = favoris.hdvRythme();
  journal('hdv', `rythme : ${JSON.stringify(reglagesHdv.rythme)}`);
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

// LE RETARD SUR LE DEPOT, EN MODE DEV SEULEMENT.
//
// Sous OMNI_DEV le code execute EST celui du depot, et rien ne dit quand
// origin/master a avance: l'amorceur sort avant son canal reseau, il n'y a ni
// manifeste ni version_vue. Ces deux canaux comblent ce trou.
//
// La garde n'est pas de la discretion, elle est technique: un ami n'a pas de
// depot, il n'y a rien a comparer chez lui. Hors mode dev les deux canaux
// N'EXISTENT PAS, et window.app.etatMajGit() rejette -- l'interface le prend
// pour ce que c'est et n'affiche rien. Meme forme que la garde des droits:
// une fonction qui n'a rien a faire ici ne doit pas exister ici.
if (process.env.OMNI_DEV) {
  const { etatDepot } = require('../src/dev/maj-git');
  const racineDepot = process.env.OMNI_DEV;

  // UN ECHEC NE DOIT PAS ETRE MUET, ET journal() SEUL EST UN PIEGE: il sort
  // sur `if (!JOURNAL_COMPLET) return`, donc il n'ecrit rien sous
  // outils/lancer-dev.vbs, qui ne pose pas OMNI_JOURNAL. Meme raisonnement et
  // memes deux canaux que onJournalVeille pour les droits: journal() pour la
  // mesure fine sous lancer-diag.vbs, noterAvis() pour que ce soit lisible a
  // l'ecran. Le bloc du panneau affiche deja la raison, mais elle disparait au
  // clic suivant; le bandeau, lui, reste.
  function signalerMajGit(texte) {
    journal(0, `maj git: ${texte}`);
    noterAvis(`Mise à jour : ${texte}`);
    envoyerEtat();
  }

  ipcMain.handle('etatMajGit', async () => {
    const r = await etatDepot({ racine: racineDepot });
    if (r.etat === 'inconnu') signalerMajGit(`vérification impossible — ${r.raison}`);
    return r;
  });

}

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
  // Meme invariant pour la veille des droits: un reveil pendant le demontage
  // appellerait onChangement sur un superviseur deja en train de disparaitre.
  if (veille !== null) veille.arreter();

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
