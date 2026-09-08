'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Le renderer n'a acces ni au reseau, ni aux process, ni au disque. Il recoit
// un etat et emet quinze ordres, rien d'autre. Chacun est valide cote
// main.js: c'est ici que passe la frontiere de confiance, et elle ne s'elargit
// pas sans raison.
//
// LA LISTE EST EXHAUSTIVE ET LE RESTE. Un canal retire par megarde ne casse
// rien au demarrage: il ne se voit qu'au moment ou l'utilisateur clique, sous
// la forme d'un bouton qui « ne fait rien ». C'est arrive le 2026-08-25, en
// retirant les cinq interrupteurs generaux: cinq canaux voisins sont partis
// avec eux, et quatre des cinq cases par compte sont devenues inertes.
// Verification: chaque nom ci-dessous doit avoir son ipcMain.handle dans
// desktop/main.js, et reciproquement pour tout ce que l'interface appelle.
contextBridge.exposeInMainWorld('app', {
  surEtat: (rappel) => ipcRenderer.on('etat', (_e, etat) => rappel(etat)),

  // L'heure du son d'ambiance. Canal en RECEPTION SEULE et sans donnee: il
  // previent, il ne porte rien, et il n'ouvre ni reseau, ni disque, ni
  // process. La minuterie qui l'emet vit dans desktop/main.js, pas ici:
  // Electron ralentit les minuteries des fenetres reduites, et celle d'OMNI
  // passe sa vie derriere le jeu.
  surAmbiance: (rappel) => ipcRenderer.on('ambiance', () => rappel()),

  // La fenetre sans cadre. Pas d'agrandir: elle n'est pas redimensionnable.
  fenetreReduire: () => ipcRenderer.invoke('fenetreReduire'),
  fenetreFermer: () => ipcRenderer.invoke('fenetreFermer'),

  // L'action groupee d'un titre de colonne.
  // La chasse a l'archimonstre: l'interrupteur, et l'alerte quand la capture
  // est impossible. Les DEUX doivent exister cote main.js, voir l'avertissement
  // en tete de ce fichier.
  pdaArchiArmer: (actif) => ipcRenderer.invoke('pdaArchiArmer', actif),
  // La montee en calibre quand le stock de la tranche exacte est vide.
  pdaArchiRepli: (actif) => ipcRenderer.invoke('pdaArchiRepli', actif),

  // Le tableau des archimonstres, construit a la demande cote main.js.
  tableauArchi: (quoi) => ipcRenderer.invoke('tableauArchi', quoi),
  // Redemander l'inventaire de tous les clients, sans reconnexion.
  archiRelire: () => ipcRenderer.invoke('archiRelire'),
  surPdaArchiAlerte: (rappel) => ipcRenderer.on('pdaArchiAlerte', (_e, a) => rappel(a)),
  basculerColonne: (nom, ids) => ipcRenderer.invoke('basculerColonne', nom, ids),

  // Les cinq cases d'une ligne. `exclureCompte` est l'inversee des cinq:
  // cochee veut dire « suit le meneur », donc exclu vaut le contraire.
  exclureCompte: (idCompte, exclu) => ipcRenderer.invoke('exclureCompte', idCompte, exclu),
  basculerPasseTourCompte: (idCompte, actif) => ipcRenderer.invoke('basculerPasseTourCompte', idCompte, actif),
  basculerInvitationCompte: (idCompte, actif) => ipcRenderer.invoke('basculerInvitationCompte', idCompte, actif),
  basculerNoAnimCompte: (idCompte, actif) => ipcRenderer.invoke('basculerNoAnimCompte', idCompte, actif),
  basculerEchangeCompte: (idCompte, actif) => ipcRenderer.invoke('basculerEchangeCompte', idCompte, actif),

  // Qui commande, et la bascule vers la fenetre d'un compte.
  definirMaitre: (idCompte) => ipcRenderer.invoke('definirMaitre', idCompte),
  basculerVersCompte: (idCompte) => ipcRenderer.invoke('basculerVersCompte', idCompte),

  // Les raccourcis. `reglerOrdre` existe cote main.js mais n'est PAS expose:
  // la poignee de reordonnancement n'est pas encore faite, et la frontiere de
  // confiance ne s'elargit pas par anticipation.
  reglerTouche: (idCompte, accelerateur) => ipcRenderer.invoke('reglerTouche', idCompte, accelerateur),

  // Vide la liste des actions connues pour lancer un combat.

  // Ouvre ou ferme la petite fenetre flottante posee sur le jeu. Elle a son
  // propre preload, plus etroit: desktop/overlay-preload.js.
  // Le menu HDV de chaque ligne de compte. `majPrixHdv` lance la passe, ou
  // l'arrete si elle tourne deja: une seule voie pour les deux gestes.
  majPrixHdv: (pid) => ipcRenderer.invoke('majPrixHdv', pid),
  mettreEnVenteHdv: (pid) => ipcRenderer.invoke('mettreEnVenteHdv', pid),
  basculerOverlay: () => ipcRenderer.invoke('basculerOverlay'),

  // Un appui de bouton fait DANS la fenetre d'OMNI. Les appuis faits sur un
  // client Dofus remontent par son agent, sans passer par ici.
  boutonSouris: (clic) => ipcRenderer.invoke('boutonSouris', clic),

  reglerDelai: (secondes) => ipcRenderer.invoke('reglerDelai', secondes),
  // Le rythme des passes HDV. Partiel: le champ qui vient de bouger, pas les cinq.
  reglerHdvRythme: (partiel) => ipcRenderer.invoke('reglerHdvRythme', partiel),
  // Les garde-fous de prix HDV: facteur d'ecart et plafond. Partiel de meme.
  reglerHdvGarde: (partiel) => ipcRenderer.invoke('reglerHdvGarde', partiel),
  // Les notes de version, lues au premier clic sur le numero. Lecture seule,
  // sans parametre: c'est le seul canal qui rend des donnees plutot que
  // d'emettre un ordre.
  devlog: () => ipcRenderer.invoke('devlog'),

  // Le retard sur le depot, en lecture seule. Ce canal n'a d'ipcMain que sous
  // OMNI_DEV: chez un ami l'invoke rejette, et l'interface n'affiche
  // simplement rien. C'est le seul de la liste dont l'absence de handler est
  // NORMALE, d'ou cette note -- sans elle, la regle du fichier ferait croire a
  // un canal oublie.
  etatMajGit: () => ipcRenderer.invoke('etatMajGit'),
  fermerUnClient: (idCompte) => ipcRenderer.invoke('fermerUnClient', idCompte),
  fermerTousLesClients: () => ipcRenderer.invoke('fermerTousLesClients'),
});
