'use strict';
const path = require('node:path');
const { BrowserWindow, ipcMain, dialog } = require('electron');

// Ce module ne decide de rien: il affiche et rend ce qui a ete saisi. Toute la
// logique vit dans demarrage.js, qui est teste — une fenetre ne l'est pas.
function creerEcrans() {
  // Rend la cle saisie, ou null si l'ami ferme la fenetre. Le null est
  // significatif: demarrer() le traduit en arret, une chaine vide non.
  function demanderCle({ message } = {}) {
    return new Promise((resoudre) => {
      const f = new BrowserWindow({
        width: 460, height: 260, title: 'OMNI', resizable: false,
        webPreferences: {
          preload: path.join(__dirname, 'ecran-preload.js'),
          contextIsolation: true, sandbox: true, nodeIntegration: false,
          devTools: false,
        },
      });
      f.removeMenu();
      let rendu = false;
      const finir = (valeur) => {
        if (rendu) return;
        rendu = true;
        ipcMain.removeListener('cle-saisie', surSaisie);
        if (!f.isDestroyed()) f.destroy();
        resoudre(valeur);
      };
      const surSaisie = (_e, cle) => finir(String(cle));
      ipcMain.on('cle-saisie', surSaisie);
      f.on('closed', () => finir(null));
      f.loadFile(path.join(__dirname, 'ecran.html'),
        message ? { search: '?message=' + encodeURIComponent(message) } : undefined);
    });
  }

  // Un ami n'a pas de terminal: un arret doit se voir. Le dialogue natif
  // suffit ici — il n'y a plus rien a piloter derriere.
  async function afficherArret({ titre, message }) {
    await dialog.showMessageBox({ type: 'warning', title: 'OMNI', message: titre, detail: message || '' });
  }

  return { demanderCle, afficherArret };
}

module.exports = { creerEcrans };
