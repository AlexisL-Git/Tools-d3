'use strict';
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const { Superviseur } = require('../src/superviseur');
const { lireComptes } = require('../src/comptes/zaap');
const { listerClients } = require('../src/comptes/clients');
const { construireVue } = require('../src/comptes/vue');
const { Favoris } = require('../src/comptes/favoris');
const { findDofusProcesses } = require('../src/injector');

const PERIODE_PROCESS = 500;    // prise en charge des nouveaux clients
const PERIODE_VUE = 2000;       // rafraichissement de la liste affichee

let fenetre = null;
let superviseur = null;
let favoris = null;
let comptes = [];
let erreurComptes = null;
const prisEnCharge = new Set();

function journal(pid, texte) {
  console.log(`[${pid}] ${texte}`);
}

// Prend en charge tout nouveau client. La connexion au serveur de jeu s'ouvre
// des l'ecran de connexion: un client deja lance ne peut plus etre rattrape,
// d'ou l'etat « non intercepte » plutot qu'une tentative vouee a l'echec.
async function balayerProcess() {
  let procs = [];
  try { procs = await findDofusProcesses(); } catch (e) { return; }

  const vivants = new Set(procs.map((p) => p.pid));
  for (const pid of [...prisEnCharge]) {
    if (vivants.has(pid)) continue;
    prisEnCharge.delete(pid);
    await superviseur.retirer(pid);
  }

  for (const p of procs) {
    if (prisEnCharge.has(p.pid) || prisEnCharge.size >= 8) continue;
    prisEnCharge.add(p.pid);
    try {
      await superviseur.ajouter({ pid: p.pid, nom: p.name });
    } catch (e) {
      journal(p.pid, `attache impossible : ${e.message}`);
    }
  }
}

async function envoyerEtat() {
  if (fenetre === null || fenetre.isDestroyed()) return;
  const clients = await listerClients();
  const exclus = new Set(
    superviseur.comptes.tous.filter((e) => e.exclu).map((e) => pidVersCompte(e.pid, clients)),
  );
  fenetre.webContents.send('etat', {
    replicate: superviseur.arme,
    erreurComptes,
    lignes: construireVue({
      comptes,
      clients,
      intercepte: prisEnCharge,
      maitre: superviseur.maitre,
      exclus,
      favoris: new Set(favoris.tous()),
    }),
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
    width: 720,
    height: 560,
    title: 'Replicate',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  fenetre.removeMenu();
  fenetre.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  const lecture = lireComptes();
  comptes = lecture.comptes;
  erreurComptes = lecture.erreur;

  favoris = new Favoris(path.join(app.getPath('userData'), 'favoris.json')).charger();
  superviseur = new Superviseur({ arme: false, onJournal: journal });

  creerFenetre();
  setInterval(balayerProcess, PERIODE_PROCESS);
  setInterval(envoyerEtat, PERIODE_VUE);
  await balayerProcess();
  await envoyerEtat();
});

ipcMain.handle('basculerReplicate', async (_e, actif) => {
  superviseur.arme = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('exclureCompte', async (_e, idCompte, exclu) => {
  const clients = await listerClients();
  const pid = compteVersPid(idCompte, clients);
  const etat = pid === null ? null : superviseur.comptes.get(pid);
  if (etat) etat.exclu = Boolean(exclu);
  await envoyerEtat();
});

ipcMain.handle('marquerFavori', async (_e, idCompte, favori) => {
  favoris.marquer(idCompte, Boolean(favori));
  await envoyerEtat();
});

app.on('window-all-closed', async () => {
  if (superviseur) await superviseur.arreter();
  app.quit();
});
