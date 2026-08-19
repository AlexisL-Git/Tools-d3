'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Comptes marques par l'utilisateur comme etant a lancer.
//
// Sans effet en phase 1, ou le lancement reste manuel: la selection est
// enregistree des maintenant parce que c'est elle que la phase 4 utilisera.
//
// Le fichier ne contient QUE des identifiants numeriques de compte. Ni login,
// ni jeton, rien qui pose probleme s'il est partage ou sauvegarde.
class Favoris {
  constructor(chemin) {
    this.chemin = chemin;
    this._ids = new Set();
  }

  charger() {
    try {
      const json = JSON.parse(fs.readFileSync(this.chemin, 'utf8'));
      if (Array.isArray(json.favoris)) {
        this._ids = new Set(json.favoris.filter((n) => Number.isInteger(n)));
      }
    } catch (e) {
      // Fichier absent ou corrompu: on repart d'une liste vide plutot que de
      // faire echouer le demarrage de l'application.
      this._ids = new Set();
    }
    return this;
  }

  estFavori(id) {
    return this._ids.has(id);
  }

  marquer(id, favori) {
    if (favori) this._ids.add(id);
    else this._ids.delete(id);
    this._ecrire();
  }

  tous() {
    return [...this._ids];
  }

  _ecrire() {
    try {
      fs.mkdirSync(path.dirname(this.chemin), { recursive: true });
      fs.writeFileSync(this.chemin, JSON.stringify({ favoris: this.tous() }), 'utf8');
    } catch (e) {
      // Perdre les favoris est benin; empecher l'application de fonctionner
      // ne l'est pas.
    }
  }
}

module.exports = { Favoris };
