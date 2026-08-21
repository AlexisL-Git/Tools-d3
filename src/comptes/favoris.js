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
    // Comptes dont le passe-tour est actif, et delai global en secondes.
    // Comme les favoris: que des identifiants numeriques et un nombre.
    this._passeTour = new Set();
    this._delai = 0;
    // Comptes qui acceptent seuls les invitations de groupe. Meme nature que
    // les deux listes precedentes: que des identifiants numeriques.
    this._invitation = new Set();
  }

  charger() {
    try {
      const json = JSON.parse(fs.readFileSync(this.chemin, 'utf8'));
      if (Array.isArray(json.favoris)) {
        this._ids = new Set(json.favoris.filter((n) => Number.isInteger(n)));
      }
      if (Array.isArray(json.passeTour)) {
        this._passeTour = new Set(json.passeTour.filter((n) => Number.isInteger(n)));
      }
      if (Array.isArray(json.invitation)) {
        this._invitation = new Set(json.invitation.filter((n) => Number.isInteger(n)));
      }
      if (typeof json.delai === 'number' && json.delai >= 0) this._delai = json.delai;
    } catch (e) {
      // Fichier absent ou corrompu: on repart d'une liste vide plutot que de
      // faire echouer le demarrage de l'application.
      this._ids = new Set();
      this._passeTour = new Set();
      this._invitation = new Set();
      this._delai = 0;
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

  passeTourActif(id) {
    return this._passeTour.has(id);
  }

  marquerPasseTour(id, actif) {
    if (actif) this._passeTour.add(id);
    else this._passeTour.delete(id);
    this._ecrire();
  }

  delai() {
    return this._delai;
  }

  reglerDelai(secondes) {
    const v = Number(secondes);
    this._delai = Number.isFinite(v) && v >= 0 ? v : 0;
    this._ecrire();
  }

  tousPasseTour() {
    return [...this._passeTour];
  }

  invitationActive(id) {
    return this._invitation.has(id);
  }

  marquerInvitation(id, actif) {
    if (actif) this._invitation.add(id);
    else this._invitation.delete(id);
    this._ecrire();
  }

  tousInvitation() {
    return [...this._invitation];
  }

  _ecrire() {
    try {
      fs.mkdirSync(path.dirname(this.chemin), { recursive: true });
      const contenu = {
        delai: this._delai,
        favoris: this.tous(),
        passeTour: this.tousPasseTour(),
        invitation: this.tousInvitation(),
      };
      fs.writeFileSync(this.chemin, JSON.stringify(contenu), 'utf8');
    } catch (e) {
      // Perdre les reglages est benin; empecher l'application de fonctionner
      // ne l'est pas.
    }
  }
}

module.exports = { Favoris };
