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
    // Comptes dont les animations de deplacement sont supprimees. Meme nature
    // que les trois listes precedentes: que des identifiants numeriques.
    this._noAnim = new Set();
    // Comptes qui acceptent seuls les echanges proposes. Meme nature que les
    // quatre listes precedentes: que des identifiants numeriques.
    this._echange = new Set();
    // Le compte qui commande. Un seul, ou aucun: ce n'est donc pas une liste
    // mais un identifiant, et null vaut « personne ne commande, rien ne se
    // replique ». Meme nature que le reste du fichier: un entier.
    this._maitre = null;
    // L'INTERRUPTEUR UNIQUE. OMNI agit, ou il est suspendu.
    //
    // Il a remplace cinq interrupteurs generaux, un par fonction. Ce modele
    // avait deux niveaux — general ET par compte — que rien ne reliait a
    // l'ecran: une case cochee sous un general eteint ne faisait rien, sans que
    // ca se voie. Les cases par compte sont desormais la seule verite, le titre
    // de colonne est une action groupee, et celui-ci suspend l'ensemble.
    //
    // SUSPENDRE N'EFFACE RIEN, c'est toute sa difference avec decocher: on
    // reprend exactement dans l'etat d'avant.
    //
    // Il repart au repos si le fichier ne dit rien: le superviseur porte « arme
    // = false doit le rester tant qu'on n'a pas decide d'ecrire pour de bon sur
    // le reseau », et un demarrage arme sans geste conscient irait contre.
    this._actif = false;
    // Un raccourci global par compte, pour mettre sa fenetre au premier plan.
    // idCompte -> accelerateur Electron.
    this._touches = new Map();
    // L'ordre voulu par l'utilisateur. C'est l'ordre qu'affiche le panneau,
    // et rien de plus -- voir src/comptes/ordre.js.
    this._ordre = [];
    // Les actions vues lancer un combat chez le maitre. Rejouer l'une d'elles
    // ferait ouvrir a chaque esclave SON PROPRE combat — mesure le 28/08.
    this._combats = new Set();
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
      if (Array.isArray(json.noAnim)) {
        this._noAnim = new Set(json.noAnim.filter((n) => Number.isInteger(n)));
      }
      if (Array.isArray(json.echange)) {
        this._echange = new Set(json.echange.filter((n) => Number.isInteger(n)));
      }
      if (typeof json.delai === 'number' && json.delai >= 0) this._delai = json.delai;
      if (Number.isInteger(json.maitre)) this._maitre = json.maitre;
      // Une touche n'est retenue que si son compte est un entier et sa valeur
      // une chaine: le fichier ne porte que ce dont on connait la forme.
      if (json.touches !== null && typeof json.touches === 'object' && !Array.isArray(json.touches)) {
        for (const [cle, valeur] of Object.entries(json.touches)) {
          const id = Number(cle);
          if (Number.isInteger(id) && typeof valeur === 'string' && valeur.length) {
            this._touches.set(id, valeur);
          }
        }
      }
      if (Array.isArray(json.ordre)) {
        this._ordre = [...new Set(json.ordre.filter((n) => Number.isInteger(n)))];
      }
      // Un booleen, ou rien: toute autre forme vaut « au repos ».
      if (typeof json.actif === 'boolean') this._actif = json.actif;
      if (Array.isArray(json.combats)) {
        for (const c of json.combats) {
          if (typeof c === 'string' && c.length) this._combats.add(c);
        }
      }
    } catch (e) {
      // Fichier absent ou corrompu: on repart d'une liste vide plutot que de
      // faire echouer le demarrage de l'application.
      this._ids = new Set();
      this._passeTour = new Set();
      this._invitation = new Set();
      this._noAnim = new Set();
      this._echange = new Set();
      this._delai = 0;
      this._maitre = null;
      this._actif = false;
      this._touches = new Map();
      this._ordre = [];
      this._combats = new Set();
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

  noAnimActif(id) {
    return this._noAnim.has(id);
  }

  marquerNoAnim(id, actif) {
    if (actif) this._noAnim.add(id);
    else this._noAnim.delete(id);
    this._ecrire();
  }

  tousNoAnim() {
    return [...this._noAnim];
  }

  echangeActif(id) {
    return this._echange.has(id);
  }

  marquerEchange(id, actif) {
    if (actif) this._echange.add(id);
    else this._echange.delete(id);
    this._ecrire();
  }

  tousEchange() {
    return [...this._echange];
  }

  maitre() {
    return this._maitre;
  }

  // Toute valeur qui n'est pas un entier vaut « aucun maitre ». C'est ce qui
  // permet au meme appel de desepingler: reglerMaitre(null) efface le choix,
  // sans quoi revenir a « personne ne commande » serait impossible une fois un
  // compte designe.
  reglerMaitre(id) {
    this._maitre = Number.isInteger(id) ? id : null;
    this._ecrire();
  }

  // Une copie: l'appelant ne doit pas pouvoir modifier l'etat interne en
  // ecrivant dans l'objet rendu, sans quoi le fichier et la memoire divergent.
  actif() {
    return this._actif;
  }

  reglerActif(actif) {
    this._actif = Boolean(actif);
    this._ecrire();
  }

  touches() {
    return Object.fromEntries(this._touches);
  }

  toucheDe(id) {
    return this._touches.get(id) || null;
  }

  // Une meme touche sur deux comptes rendrait le second inatteignable: la
  // derniere assignation gagne, et la precedente est liberee.
  reglerTouche(id, accelerateur) {
    if (!Number.isInteger(id)) return;
    if (accelerateur === null || accelerateur === undefined) {
      this._touches.delete(id);
      this._ecrire();
      return;
    }
    if (typeof accelerateur !== 'string' || accelerateur.length === 0) return;
    for (const [autre, valeur] of [...this._touches]) {
      if (valeur === accelerateur && autre !== id) this._touches.delete(autre);
    }
    this._touches.set(id, accelerateur);
    this._ecrire();
  }

  combats() {
    return [...this._combats];
  }

  apprendreCombat(cle) {
    if (typeof cle !== 'string' || cle.length === 0) return;
    this._combats.add(cle);
    this._ecrire();
  }

  // LE SEUL RECOURS quand OMNI a retenu a tort. La liste est faite de numeros:
  // personne ne peut deviner quelle entree est fautive, donc on vide tout.
  oublierCombats() {
    this._combats.clear();
    this._ecrire();
  }

  ordre() {
    return [...this._ordre];
  }

  reglerOrdre(ids) {
    if (!Array.isArray(ids)) return;
    this._ordre = [...new Set(ids.filter((n) => Number.isInteger(n)))];
    this._ecrire();
  }

  _ecrire() {
    try {
      fs.mkdirSync(path.dirname(this.chemin), { recursive: true });
      const contenu = {
        delai: this._delai,
        favoris: this.tous(),
        passeTour: this.tousPasseTour(),
        invitation: this.tousInvitation(),
        noAnim: this.tousNoAnim(),
        echange: this.tousEchange(),
        maitre: this._maitre,
        actif: this._actif,
        touches: this.touches(),
        ordre: this._ordre,
        combats: this.combats(),
      };
      fs.writeFileSync(this.chemin, JSON.stringify(contenu), 'utf8');
    } catch (e) {
      // Perdre les reglages est benin; empecher l'application de fonctionner
      // ne l'est pas.
    }
  }
}

module.exports = { Favoris };
