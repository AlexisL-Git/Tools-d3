'use strict';
const fs = require('node:fs');
const path = require('node:path');

// LES NOTES DE VERSION, LUES DEPUIS LE FICHIER EMBARQUE DANS L'ARCHIVE.
//
// Ce module est du confort: il ne doit JAMAIS empecher OMNI de tourner. Toute
// anomalie (fichier absent, JSON casse, entree mal formee) se solde par moins
// de notes affichees, jamais par une exception. Le devlog est le seul endroit
// de l'application dont la panne doit rester invisible.

const FORMAT_VERSION = /^\d+\.\d+\.\d+$/;

function entreeValide(e) {
  return !!e && typeof e === 'object' && !Array.isArray(e)
    && typeof e.version === 'string' && FORMAT_VERSION.test(e.version)
    && Array.isArray(e.notes) && e.notes.length > 0
    && e.notes.every((n) => typeof n === 'string' && n.length > 0);
}

// Comparaison NUMERIQUE, segment par segment. Comparer les chaines mettrait
// 0.10.0 avant 0.9.1 — faux des que le numero du milieu passe a deux chiffres.
function comparerDecroissant(a, b) {
  const ga = a.version.split('.').map(Number);
  const gb = b.version.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (ga[i] !== gb[i]) return gb[i] - ga[i];
  }
  return 0;
}

function lireDevlog(chemin) {
  let brut;
  try {
    brut = fs.readFileSync(chemin, 'utf8');
  } catch {
    return [];
  }
  let donnees;
  try {
    donnees = JSON.parse(brut);
  } catch {
    return [];
  }
  if (!Array.isArray(donnees)) return [];
  return donnees.filter(entreeValide).sort(comparerDecroissant);
}

// Resolu depuis __dirname: le code tourne depuis
// %APPDATA%\OMNI\versions\<v>\desktop\, pas depuis le dossier du paquet.
const CHEMIN = path.join(__dirname, 'devlog.json');

module.exports = { lireDevlog, CHEMIN };
