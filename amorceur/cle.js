'use strict';
const fs = require('node:fs');
const path = require('node:path');

// La cle est en clair, et c'est assume: elle sert a etre renvoyee au serveur,
// donc l'application doit pouvoir la lire, donc son proprietaire aussi. Le
// levier de controle est la revocation cote serveur, pas ce fichier.
function creerCle(racine) {
  const fichier = path.join(racine, 'cle.txt');
  return {
    lire() {
      try {
        const v = fs.readFileSync(fichier, 'utf8').trim();
        return v.length ? v : null;
      } catch (e) {
        return null;
      }
    },
    ecrire(cle) {
      try {
        fs.mkdirSync(racine, { recursive: true });
        fs.writeFileSync(fichier, String(cle).trim());
      } catch (e) {
        // Une cle non enregistree fait reapparaitre l'ecran au prochain
        // lancement. Desagreable, jamais bloquant: on ne leve pas.
      }
    },
    oublier() {
      try { fs.unlinkSync(fichier); } catch (e) { /* rien a oublier */ }
    },
  };
}

module.exports = { creerCle };
