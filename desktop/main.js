'use strict';
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const { Superviseur } = require('../src/superviseur');
const { creerReplicateur } = require('../src/replicateur');
const { creerPasseur } = require('../src/passeur');
const { composer } = require('../src/composer');
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
// Trois ensembles distincts, et les confondre coute cher: `vus` evite de
// retenter sans fin une attache impossible, `prisEnCharge` ne contient que les
// clients dont l'agent est en place — c'est lui que la vue lit — et `erreurs`
// dit pourquoi les autres n'y sont pas.
const vus = new Set();
const prisEnCharge = new Set();
const erreurs = new Map();      // pid -> message d'echec d'attache
const messages = new Map();     // pid -> dernier refus de rejeu, pour l'affichage
let minuteurProcess = null;
let minuteurVue = null;
// Lus a chaque trame par le passeur: modifier ces champs suffit, sans
// reconstruire quoi que ce soit.
const reglagesPasseTour = { actif: false, delaiMs: 0 };

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
  for (const pid of [...vus]) {
    if (vivants.has(pid)) continue;
    vus.delete(pid);
    prisEnCharge.delete(pid);
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
      // Un compte relance doit retrouver son interrupteur enregistre plutot
      // que de repartir a faux a chaque redemarrage de client.
      const clients = await listerClients();
      const idCompte = pidVersCompte(p.pid, clients);
      const etat = superviseur.comptes.get(p.pid);
      if (etat && idCompte !== null) {
        etat.passeTour = favoris.passeTourActif(idCompte);
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
  const clients = await listerClients();
  const exclus = new Set(
    superviseur.comptes.tous.filter((e) => e.exclu).map((e) => pidVersCompte(e.pid, clients)),
  );
  fenetre.webContents.send('etat', {
    replicate: superviseur.arme,
    erreurComptes,
    passeTourActif: reglagesPasseTour.actif,
    delai: favoris.delai(),
    lignes: construireVue({
      comptes,
      clients,
      intercepte: prisEnCharge,
      maitre: superviseur.maitre,
      exclus,
      favoris: new Set(favoris.tous()),
      passeTour: new Set(favoris.tousPasseTour()),
      erreurs,
      messages,
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
  // Le delai enregistre doit survivre au redemarrage de l'application, pas
  // seulement a celui d'un client.
  reglagesPasseTour.delaiMs = Math.round(favoris.delai() * 1000);
  superviseur = new Superviseur({ arme: false, onJournal: journal });

  // Sans ce branchement, le superviseur decode tout et ne rejoue rien:
  // l'interrupteur ne bascule qu'un drapeau que seul rejouer() consulte. La
  // decision est celle du CLI, au mot pres, parce que c'est le meme module.
  //
  // Le superviseur n'accepte qu'un seul onTrame: le passe-tour, politique
  // independante du Replicate, se compose ici plutot que d'ajouter un second
  // point d'entree au superviseur.
  superviseur.onTrame = composer(
    creerReplicateur({
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
      onCompteRendu: ({ pid, ok, raison }) => {
        if (!ok) journal(pid, `passe-tour : ${raison}`);
      },
    }),
  );

  creerFenetre();
  minuteurProcess = setInterval(balayerProcess, PERIODE_PROCESS);
  minuteurVue = setInterval(envoyerEtat, PERIODE_VUE);
  await balayerProcess();
  await envoyerEtat();
});

ipcMain.handle('basculerReplicate', async (_e, actif) => {
  superviseur.arme = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('exclureCompte', async (_e, idCompte, exclu) => {
  // Frontiere de confiance: le renderer est sandboxe mais reste hors de
  // notre controle. Un idCompte non entier ne doit ni chercher de pid ni
  // atteindre l'etat du superviseur.
  if (!Number.isInteger(idCompte)) return;
  const clients = await listerClients();
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

ipcMain.handle('basculerPasseTour', async (_e, actif) => {
  reglagesPasseTour.actif = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('basculerPasseTourCompte', async (_e, idCompte, actif) => {
  // La frontiere IPC est la frontiere de confiance: on ne laisse pas une
  // valeur non numerique atteindre le fichier de reglages.
  if (!Number.isInteger(idCompte)) return;
  favoris.marquerPasseTour(idCompte, Boolean(actif));
  const clients = await listerClients();
  const pid = compteVersPid(idCompte, clients);
  const etat = pid === null ? null : superviseur.comptes.get(pid);
  if (etat) etat.passeTour = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('reglerDelai', async (_e, secondes) => {
  const v = Number(secondes);
  if (!Number.isFinite(v) || v < 0) return;
  favoris.reglerDelai(v);
  reglagesPasseTour.delaiMs = Math.round(v * 1000);
  await envoyerEtat();
});

app.on('window-all-closed', async () => {
  // On arrete d'abord de produire du travail (plus aucun tick ne peut
  // rattacher un agent Frida ou renvoyer un etat), ensuite seulement on
  // demonte le superviseur.
  if (minuteurProcess !== null) clearInterval(minuteurProcess);
  if (minuteurVue !== null) clearInterval(minuteurVue);
  minuteurProcess = null;
  minuteurVue = null;
  if (superviseur) await superviseur.arreter();
  app.quit();
});
