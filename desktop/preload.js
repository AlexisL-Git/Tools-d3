'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Le renderer n'a acces ni au reseau, ni aux process, ni au disque. Il recoit
// un etat et emet treize ordres, rien d'autre: armer le OMNI, exclure un
// compte, le mettre en favori, l'interrupteur general du passe-tour, celui
// d'un compte, le delai, l'interrupteur general de l'acceptation des
// invitations de groupe et celui d'un compte, l'interrupteur general du
// no-anim et celui d'un compte, l'interrupteur general de l'acceptation des
// echanges et celui d'un compte, et la fermeture de tous les clients. Chacun
// est valide cote main.js — c'est ici que passe la frontiere de confiance, et
// elle ne s'elargit pas sans raison.
contextBridge.exposeInMainWorld('app', {
  surEtat: (rappel) => ipcRenderer.on('etat', (_e, etat) => rappel(etat)),
  basculerDuplication: (actif) => ipcRenderer.invoke('basculerDuplication', actif),
  exclureCompte: (idCompte, exclu) => ipcRenderer.invoke('exclureCompte', idCompte, exclu),
  marquerFavori: (idCompte, favori) => ipcRenderer.invoke('marquerFavori', idCompte, favori),
  basculerPasseTour: (actif) => ipcRenderer.invoke('basculerPasseTour', actif),
  basculerPasseTourCompte: (idCompte, actif) => ipcRenderer.invoke('basculerPasseTourCompte', idCompte, actif),
  reglerDelai: (secondes) => ipcRenderer.invoke('reglerDelai', secondes),
  basculerInvitation: (actif) => ipcRenderer.invoke('basculerInvitation', actif),
  basculerInvitationCompte: (idCompte, actif) => ipcRenderer.invoke('basculerInvitationCompte', idCompte, actif),
  basculerNoAnim: (actif) => ipcRenderer.invoke('basculerNoAnim', actif),
  basculerNoAnimCompte: (idCompte, actif) => ipcRenderer.invoke('basculerNoAnimCompte', idCompte, actif),
  basculerEchange: (actif) => ipcRenderer.invoke('basculerEchange', actif),
  basculerEchangeCompte: (idCompte, actif) => ipcRenderer.invoke('basculerEchangeCompte', idCompte, actif),
  fermerTousLesClients: () => ipcRenderer.invoke('fermerTousLesClients'),
});
