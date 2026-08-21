'use strict';
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const { Superviseur } = require('../src/superviseur');
const { creerReplicateur } = require('../src/replicateur');
const { creerPasseur } = require('../src/passeur');
const { creerAccepteur } = require('../src/invitation');
const { creerTransformateurFlux } = require('../src/noanim-flux');
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
// Lu a chaque trame par l'accepteur: modifier ce champ suffit.
const reglagesInvitation = { actif: false };
// Lu a chaque chunk par le transformateur: modifier ce champ suffit. Faux =
// le proxy relaie le flux descendant octet pour octet, comme avant.
const reglagesNoAnim = { actif: false };

const DEPART = Date.now();
function journal(pid, texte) {
  const t = String(Date.now() - DEPART).padStart(7);
  console.log(`${t}ms [${pid}] ${texte}`);
}

// Une trame decodee prouve que le trafic traverse le proxy. Un client attache
// sans une seule trame et un client qui n'a rien a dire produisent le meme
// silence, et ce silence a coute deux faux diagnostics.
function premiereTrame() {
  const vus = new Set();
  return function onTrame({ pid, dir, frame }) {
    if (dir !== 'in' || frame === null || vus.has(pid)) return;
    vus.add(pid);
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
        etat.accepteInvitation = favoris.invitationActive(idCompte);
        etat.noAnim = favoris.noAnimActif(idCompte);
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
  }

  const exclus = new Set(
    superviseur.comptes.tous.filter((e) => e.exclu).map((e) => pidVersCompte(e.pid, clients)),
  );
  // La case affichee vient de l'etat vivant, celui que le passeur consulte a
  // chaque trame — par symetrie avec `exclus`. Une case rendue depuis le seul
  // fichier pourrait montrer eteint ce qui emet encore.
  const passeTour = new Set(
    superviseur.comptes.tous.filter((e) => e.passeTour).map((e) => pidVersCompte(e.pid, clients)),
  );
  // Comme `passeTour`: la case affichee vient de l'etat vivant, celui que
  // l'accepteur consulte a chaque trame, pas du seul fichier.
  const invitation = new Set(
    superviseur.comptes.tous.filter((e) => e.accepteInvitation).map((e) => pidVersCompte(e.pid, clients)),
  );
  // Comme les trois autres: la case affichee vient de l'etat vivant.
  const noAnim = new Set(
    superviseur.comptes.tous.filter((e) => e.noAnim).map((e) => pidVersCompte(e.pid, clients)),
  );
  // IMPORTANT de revue finale: reglagesNoAnim.actif etait recalcule ICI a
  // chaque tick (noAnim.size > 0), donc basculerNoAnim() n'avait aucun effet
  // propre -- le bouton ANIM se rallumait ou se rallumait jamais selon les
  // cases par compte, pas selon le clic. Comme reglagesPasseTour.actif et
  // reglagesInvitation.actif, c'est desormais un interrupteur general
  // independant, mis a jour uniquement par l'IPC basculerNoAnim.
  fenetre.webContents.send('etat', {
    replicate: superviseur.arme,
    erreurComptes,
    passeTourActif: reglagesPasseTour.actif,
    invitationActive: reglagesInvitation.actif,
    noAnimActif: reglagesNoAnim.actif,
    delai: favoris.delai(),
    lignes: construireVue({
      comptes,
      clients,
      intercepte: prisEnCharge,
      maitre: superviseur.maitre,
      exclus,
      favoris: new Set(favoris.tous()),
      passeTour,
      invitation,
      noAnim,
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
  superviseur = new Superviseur({
    arme: false,
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
  });

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
    premiereTrame(),
    // Une politique qui leve doit se voir. C'est ce qui manquait: le passeur
    // pouvait echouer sur une trame sans laisser la moindre trace.
    { onErreur: ({ evenement, erreur }) => journal(evenement.pid, `POLITIQUE EN ECHEC sur ${evenement.frame && evenement.frame.type} : ${erreur.stack}`) },
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

ipcMain.handle('basculerInvitation', async (_e, actif) => {
  reglagesInvitation.actif = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('basculerInvitationCompte', async (_e, idCompte, actif) => {
  // La frontiere IPC est la frontiere de confiance: on ne laisse pas une
  // valeur non numerique atteindre le fichier de reglages.
  if (!Number.isInteger(idCompte)) return;
  favoris.marquerInvitation(idCompte, Boolean(actif));
  const clients = await listerClients();
  const pid = compteVersPid(idCompte, clients);
  const etat = pid === null ? null : superviseur.comptes.get(pid);
  if (etat) etat.accepteInvitation = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('basculerNoAnim', async (_e, actif) => {
  // IMPORTANT de revue finale: aligne sur ses jumeaux basculerPasseTour et
  // basculerInvitation (lignes 293 et 310). L'ancien code n'ecrivait jamais
  // reglagesNoAnim.actif (envoyerEtat() l'ecrasait a chaque tick), et
  // effacait en plus les cases par compte de favoris.json a l'extinction --
  // un interrupteur general ne doit couper que la fonction, pas la memoire
  // des comptes que l'utilisateur a cochee.
  reglagesNoAnim.actif = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('basculerNoAnimCompte', async (_e, idCompte, actif) => {
  // La frontiere IPC est la frontiere de confiance: on ne laisse pas une
  // valeur non numerique atteindre le fichier de reglages.
  if (!Number.isInteger(idCompte)) return;
  favoris.marquerNoAnim(idCompte, Boolean(actif));
  const clients = await listerClients();
  const pid = compteVersPid(idCompte, clients);
  const etat = pid === null ? null : superviseur.comptes.get(pid);
  if (etat) etat.noAnim = Boolean(actif);
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
