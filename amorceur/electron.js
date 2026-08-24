'use strict';
// Point d'entree du paquet. Avec jsc.js, c'est le SEUL fichier de l'amorceur
// qui reste en clair: il installe le chargeur de bytecode, il ne peut donc pas
// etre lui-meme compile. Le garder minuscule est deliberat.
//
// La seule logique toleree ici: dire pourquoi le demarrage a echoue. Une
// exception a ce niveau n'ouvre qu'une fenetre « Error » sans texte utile, et
// un executable package n'a pas de console.
const fs = require('node:fs');
const path = require('node:path');

try {
  require('./jsc');
  require('./principal');
} catch (e) {
  try {
    const racine = path.join(process.env.APPDATA || __dirname, 'Replicate');
    fs.mkdirSync(racine, { recursive: true });
    const ligne = `${new Date().toISOString()} demarrage impossible: ${e && e.stack ? e.stack : e}`;
    fs.appendFileSync(path.join(racine, 'amorceur.log'), ligne + String.fromCharCode(10));
  } catch (e2) {
    // Meme le journal a echoue: il ne reste que la fenetre d'Electron.
  }
  throw e;
}
