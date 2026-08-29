'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// La frontiere de confiance de l'OVERLAY. Elle est volontairement plus etroite
// que celle du panneau: neuf ordres au lieu de quinze, et aucun qui touche aux
// reglages par compte.
//
// DEUX DE CES CANAUX SONT CEUX DU PANNEAU, mot pour mot: basculerVersCompte et
// definirMaitre. Ce n'est pas une economie de frappe, c'est la garantie que les
// deux fenetres ne peuvent pas se contredire: il n'y a qu'un maitre, et
// l'overlay est une seconde poignee sur le meme ordre. Ne JAMAIS dupliquer ces
// handlers cote main.js pour l'overlay.
//
// LE REPLICATE, LUI, A SON PROPRE CANAL, et c'est voulu. L'interrupteur du
// panneau suspend OMNI EN ENTIER — duplication, passe-tour, invitations,
// echanges, no-anim. Celui d'ici ne coupe que la duplication: on doit pouvoir
// l'arreter le temps d'un combat sans eteindre le reste. Les deux volontes
// sont retenues separement et le superviseur n'emet que si elles sont
// d'accord, voir armerSuperviseur() dans desktop/main.js.
//
// Comme pour desktop/preload.js: chaque nom ci-dessous doit avoir son
// ipcMain.handle dans desktop/main.js. Un canal manquant ne casse rien au
// demarrage, il se voit seulement au moment ou l'utilisateur clique, sous la
// forme d'un picto qui « ne fait rien ».
contextBridge.exposeInMainWorld('overlay', {
  surEtat: (rappel) => ipcRenderer.on('etat', (_e, etat) => rappel(etat)),

  // Les deux ordres partages avec le panneau, et celui qui ne l'est pas.
  basculerVersCompte: (idCompte) => ipcRenderer.invoke('basculerVersCompte', idCompte),
  definirMaitre: (idCompte) => ipcRenderer.invoke('definirMaitre', idCompte),
  basculerReplGroupe: () => ipcRenderer.invoke('basculerReplGroupe'),

  // Les ordres propres a la fenetre flottante.
  basculerSens: () => ipcRenderer.invoke('overlayBasculerSens'),
  fermer: () => ipcRenderer.invoke('overlayFermer'),
  // La taille est MESUREE sur la page, jamais estimee ici: le nombre de pictos
  // change des qu'un client se ferme, et une fenetre plus large que sa barre
  // laisserait une zone morte qui avale les clics destines au jeu.
  taille: (largeur, hauteur) => ipcRenderer.invoke('overlayTaille', largeur, hauteur),

  // Le deplacement, code a la main. Mesure du 2026-08-29: une fenetre
  // `focusable: false` recoit bien les clics, mais le glissement natif
  // (-webkit-app-region: drag) n'a pas ete verifie dans cet etat, alors que
  // celui-ci l'a ete. On garde ce qui est prouve.
  prendre: (ecart) => ipcRenderer.invoke('overlayPrendre', ecart),
  bouger: () => ipcRenderer.invoke('overlayBouger'),
  lacher: () => ipcRenderer.invoke('overlayLacher'),
});
