'use strict';
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const { app } = require('electron');

const { creerDepot } = require('./depot');
const { creerCle } = require('./cle');
const { creerCanal } = require('./canal');
const { creerEcrans } = require('./ecran');
const { demarrer } = require('./demarrage');
const { creerSignalement } = require('./signalement');
const { extraire } = require('./archive');
const { rendreResolvable } = require('./resolution');

const BASE = 'https://paquets-maj.vercel.app';
// Fixe, en developpement comme dans le paquet: app.getPath('userData') vaut
// %APPDATA%\Electron quand on lance npm run app, et le depot changerait de
// place entre les deux.
const RACINE = path.join(app.getPath('appData'), 'OMNI');
const VERSION_PAQUET = require('../package.json').version;

// Les dependances du code versionne restent dans le paquet: frida et
// protobufjs ne se mettent pas a jour. Un .node natif ne se charge pas depuis
// une archive asar — d'ou app.asar.unpacked, propose lui aussi.
function dossiersDeDependances() {
  const racineApp = app.getAppPath();
  return [
    path.join(racineApp, 'node_modules'),
    path.join(racineApp + '.unpacked', 'node_modules'),
  ];
}

// La version embarquee est une ARCHIVE, pas une copie de dossier: fs.cpSync ne
// traverse pas l'asar de facon fiable, un readFileSync d'un seul fichier oui.
// Et cela fait passer le premier lancement par exactement le meme chemin de
// code qu'une mise a jour.
function installerInitiale(depot) {
  const archive = path.join(__dirname, 'version-initiale.tgz');
  try {
    extraire(fs.readFileSync(archive), depot.dossierDe(VERSION_PAQUET));
  } catch (e) {
    console.error('[amorceur] version initiale non installable:', e.message);
    try { fs.appendFileSync(path.join(RACINE, 'amorceur.log'), `version initiale non installable: ${e.message}` + String.fromCharCode(10)); } catch (e2) { /* rien */ }
  }
}

const TITRES = {
  'cle-refusee': "Cette cle n'est plus valide",
  'sans-cle': 'Aucune cle saisie',
  'coupe-circuit': 'OMNI est momentanement arrete',
  'aucune-version': 'Aucune version installee',
};

// Un ami n'a pas de terminal, et un executable package n'a pas de console:
// sans ce fichier, toute panne de l'amorceur est muette. Il est court et
// borne — pas de trames, pas d'etat interne, juste les decisions.
function journal(texte) {
  const ligne = `${new Date().toISOString()} ${texte}`;
  console.log('[amorceur]', texte);
  try {
    fs.mkdirSync(RACINE, { recursive: true });
    fs.appendFileSync(path.join(RACINE, 'amorceur.log'), ligne + '\n');
  } catch (e) {
    // Journaliser ne doit jamais empecher de demarrer.
  }
}

// Les dernieres lignes du journal, jointes a un refus. Prises a l'envoi, elles
// couvrent le lancement qui a plante et celui qui le signale — c'est ce qu'on
// veut lire. Le fichier est court par construction: une ligne par decision.
function dernieresLignes(n) {
  const lignes = fs.readFileSync(path.join(RACINE, 'amorceur.log'), 'utf8').split('\n');
  return lignes.slice(-n).join('\n');
}

// Mode developpement: on charge le code du depot tel quel, sans passer par le
// service ni par le depot de versions. Sans lui, modifier un fichier du depot
// ne change rien a l'ecran — l'application charge ce qui est installe dans
// %APPDATA%, pas ce qu'on vient d'ecrire.
//
//   $env:OMNI_DEV='C:\Users\Utilisateur\mm'
//   .\desktop\dist\OMNI-win32-x64\OMNI.exe
//
// Ni cle ni mise a jour ici: c'est une variable d'environnement posee sur sa
// propre machine par qui a deja le code sous les yeux.
function chargerDepotLocal(chemin) {
  const entree = path.join(chemin, 'desktop', 'main.js');
  if (!fs.existsSync(entree)) {
    throw new Error(`OMNI_DEV=${chemin}: pas de desktop/main.js a cet endroit`);
  }
  process.env.OMNI_VERSION = 'dev';
  require(entree);
}

async function principal() {
  // CRITIQUE: sans ce gestionnaire, Electron quitte l'application des que la
  // derniere fenetre se ferme — donc AU MOMENT ou l'ecran de saisie est
  // detruit, avant meme l'appel au service. Celui de desktop/main.js ne compte
  // pas: il n'est enregistre qu'une fois la version chargee, bien trop tard.
  // Mesure du 2026-08-25: la cle etait saisie, l'application mourait dans la
  // seconde, sans une ligne de journal ni cle.txt ecrit.
  app.on('window-all-closed', () => {});

  if (process.env.OMNI_DEV) {
    journal(`mode developpement: ${process.env.OMNI_DEV}`);
    chargerDepotLocal(process.env.OMNI_DEV);
    return;
  }

  const depot = creerDepot(RACINE);
  const canal = creerCanal({ base: BASE });
  const cle = creerCle(RACINE);
  const ecrans = creerEcrans();
  const resultat = await demarrer({
    depot, canal, cle, ecrans,
    installerInitiale: () => installerInitiale(depot),
    versionPaquet: VERSION_PAQUET,
    journal,
  });

  // Envoye ici, sur le chemin 'charger' COMME sur le chemin 'arreter': un
  // ami bloque par le coupe-circuit ne doit pas faire perdre un refus. Rien
  // ici ne doit empecher la suite: signalement.envoyer n'est pas cense
  // lever, mais on se protege quand meme.
  const signalement = creerSignalement({ depot, canal, lireJournal: dernieresLignes });
  try {
    const envoi = await signalement.envoyer(cle.lire(), resultat.version || null);
    if (envoi.etat !== 'ok' && envoi.etat !== 'sans-cle') {
      journal(`remontee d etat non aboutie: ${envoi.etat}`);
    }
  } catch (e) {
    journal(`remontee d etat impossible: ${e && e.message ? e.message : e}`);
  }

  if (resultat.action === 'arreter') {
    journal(`arret: ${resultat.raison}`);
    await ecrans.afficherArret({
      titre: TITRES[resultat.raison] || 'OMNI ne peut pas demarrer',
      message: resultat.message || '',
    });
    app.quit();
    return;
  }

  // Le temoin ne s'efface que quand la fenetre a fini de charger. Un require
  // qui rend la main ne prouve rien: desktop/main.js travaille dans
  // app.whenReady().then(...), bien apres.
  app.on('browser-window-created', (_e, fenetre) => {
    fenetre.webContents.once('did-finish-load', () => depot.effacerTemoin());
  });

  const resolution = rendreResolvable({
    dossierVersion: resultat.dossier,
    dossiers: dossiersDeDependances(),
  });
  journal(`dependances resolues par ${resolution.methode}`);
  process.env.OMNI_VERSION = resultat.version;
  const entree = path.join(resultat.dossier, 'desktop', 'main.js');
  if (!fs.existsSync(entree)) {
    await ecrans.afficherArret({
      titre: 'Version incomplete',
      message: `Le point d'entree est absent de la version ${resultat.version}.`,
    });
    app.quit();
    return;
  }
  journal(`chargement de la version ${resultat.version}`);
  require(entree);
}

// L'ecran de saisie est une fenetre: il faut qu'Electron soit pret avant.
// Toute exception ici laisserait l'application morte et muette: elle est
// journalisee et montree, jamais avalee.
app.whenReady().then(principal).catch(async (e) => {
  journal(`panne de l'amorceur: ${e && e.stack ? e.stack : e}`);
  try {
    await creerEcrans().afficherArret({ titre: "OMNI n'a pas pu demarrer", message: String(e && e.message ? e.message : e) });
  } catch (e2) { /* meme le dialogue a echoue */ }
  app.quit();
});
