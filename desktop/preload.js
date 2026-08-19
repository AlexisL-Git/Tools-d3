'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Le renderer n'a acces ni au reseau, ni aux process, ni au disque. Il recoit
// un etat et emet trois ordres, rien d'autre.
contextBridge.exposeInMainWorld('app', {
  surEtat: (rappel) => ipcRenderer.on('etat', (_e, etat) => rappel(etat)),
  basculerReplicate: (actif) => ipcRenderer.invoke('basculerReplicate', actif),
  exclureCompte: (idCompte, exclu) => ipcRenderer.invoke('exclureCompte', idCompte, exclu),
  marquerFavori: (idCompte, favori) => ipcRenderer.invoke('marquerFavori', idCompte, favori),
});
