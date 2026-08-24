'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// La frontiere de confiance de l'ecran de saisie: un seul verbe.
contextBridge.exposeInMainWorld('ecran', {
  envoyer: (cle) => ipcRenderer.send('cle-saisie', cle),
});
