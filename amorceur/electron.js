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
const { extraire } = require('./archive');

const BASE = 'https://paquets-maj.vercel.app';
// Fixe, en developpement comme dans le paquet: app.getPath('userData') vaut
// %APPDATA%\Electron quand on lance npm run app, et le depot changerait de
// place entre les deux.
const RACINE = path.join(app.getPath('appData'), 'Replicate');
const VERSION_PAQUET = require('../package.json').version;

// Le code versionne vit hors du paquet et doit quand meme trouver frida et
// protobufjs: ses require remontent depuis %APPDATA%\...\versions\<v>\ et n'y
// trouveraient rien. On etend donc la resolution vers le node_modules du
// PAQUET. Un .node natif ne se charge pas depuis une archive asar — d'ou
// app.asar.unpacked, ajoute lui aussi.
function etendreResolution() {
  const racineApp = app.getAppPath();
  const supplements = [
    path.join(racineApp, 'node_modules'),
    path.join(racineApp + '.unpacked', 'node_modules'),
  ].filter((p) => fs.existsSync(p));
  const origine = Module._nodeModulePaths;
  Module._nodeModulePaths = function (depuis) {
    return origine.call(this, depuis).concat(supplements);
  };
  return supplements;
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
  'coupe-circuit': 'Replicate est momentanement arrete',
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

async function principal() {
  // CRITIQUE: sans ce gestionnaire, Electron quitte l'application des que la
  // derniere fenetre se ferme — donc AU MOMENT ou l'ecran de saisie est
  // detruit, avant meme l'appel au service. Celui de desktop/main.js ne compte
  // pas: il n'est enregistre qu'une fois la version chargee, bien trop tard.
  // Mesure du 2026-08-25: la cle etait saisie, l'application mourait dans la
  // seconde, sans une ligne de journal ni cle.txt ecrit.
  app.on('window-all-closed', () => {});

  const depot = creerDepot(RACINE);
  const ecrans = creerEcrans();
  const resultat = await demarrer({
    depot,
    canal: creerCanal({ base: BASE }),
    cle: creerCle(RACINE),
    ecrans,
    installerInitiale: () => installerInitiale(depot),
    versionPaquet: VERSION_PAQUET,
    journal,
  });

  if (resultat.action === 'arreter') {
    journal(`arret: ${resultat.raison}`);
    await ecrans.afficherArret({
      titre: TITRES[resultat.raison] || 'Replicate ne peut pas demarrer',
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

  etendreResolution();
  process.env.REPLICATE_VERSION = resultat.version;
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
    await creerEcrans().afficherArret({ titre: "Replicate n'a pas pu demarrer", message: String(e && e.message ? e.message : e) });
  } catch (e2) { /* meme le dialogue a echoue */ }
  app.quit();
});
