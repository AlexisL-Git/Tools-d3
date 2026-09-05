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

// Au-dela, une entree retenue ne protege plus de rien.
//
// Les actions dangereuses sont pour l'essentiel des combats de quete, faits
// une fois: passe un mois, l'entree ne fait plus que bloquer. Si l'action est
// encore dangereuse, le degat se reproduit UNE fois et elle est retenue de
// nouveau. C'est le prix, il est assume — il n'y a plus de bouton pour
// oublier, et une entree fausse eternelle est le defaut qu'on corrige.
const MS_OUBLI = 30 * 24 * 60 * 60 * 1000;

// LE RYTHME DES PASSES HDV: quatre facteurs sans unite et une expiration en
// millisecondes. Meme nature que le reste du fichier -- des nombres, rien qui
// designe une personne.
//
// POURQUOI DES FACTEURS ET PAS DES MILLISECONDES. Un seul jeu pilote les deux
// fonctions HDV, mais elles ne partent pas des memes bornes: reprix.js espace
// ses lots de 900 a 2600 ms quand vente.js y met une rafale de 90 a 260. Des
// millisecondes communes auraient force a elire un gagnant, et le perdant
// retrouvait la cadence signalee en jeu le 01/09. La demonstration complete
// est en tete de src/hdv/reprix.js.
//
// TOUT A 1 VAUT « COMPORTEMENT D'AVANT », et c'est toute la migration: le
// fichier d'un ami qui monte de version n'a pas la cle et retrouve exactement
// les cadences mesurees. La forme suffit, aucun drapeau de version.
const RYTHME_HDV_DEFAUT = { lot: 1, objet: 1, pause: 1, frequencePause: 1, reponseMs: 4000 };
const FACTEURS_HDV = ['lot', 'objet', 'pause', 'frequencePause'];

// SOUS 0,25 LA RAFALE TOMBE SOUS 25 MS -- ce n'est plus une frappe. Au-dela de
// 4, une passe de 300 lots depasse l'heure sans que rien ne le laisse deviner.
// Le panneau borne deja ses curseurs; ces bornes-ci sont celles qui comptent,
// parce que le fichier se relit a la main.
const FACTEUR_MIN = 0.25;
const FACTEUR_MAX = 4;
// L'expiration n'est pas un facteur et ne suit pas les profils: c'est de la
// robustesse, pas du realisme. Elle a donc ses propres bornes.
const REPONSE_MIN = 500;
const REPONSE_MAX = 30000;

const borner = (v, min, max) => Math.min(max, Math.max(min, v));

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
    // cle -> date d'apprentissage en millisecondes, pour l'expiration.
    this._combats = new Map();
    // LA PETITE FENETRE FLOTTANTE. Trois choses seulement: si elle etait
    // ouverte, dans quel sens, et ou elle etait posee.
    //
    // Elle repart FERMEE si le fichier ne dit rien. Le fichier d'un ami qui
    // passe de la 0.2.6 a cette version n'a pas la cle: il ne doit pas voir
    // apparaitre une fenetre qu'il n'a pas demandee, au milieu de son ecran.
    //
    // La position vaut null tant qu'elle n'a pas ete choisie: c'est main.js
    // qui pose alors la fenetre en haut a droite de l'ecran courant. Retenir
    // un couple 0,0 par defaut la collerait dans un coin sur une machine dont
    // on ne connait pas la definition.
    this._overlay = { ouvert: false, sens: 'horizontal', x: null, y: null };
    // La pierre d'ame equipee part ETEINTE chez qui n'a jamais ouvert le
    // fichier, et c'est voulu: une pierre d'ame capture aussi les monstres
    // ordinaires, donc allumee en permanence elle gacherait les grosses pierres.
    this._pdaArchi = false;
    // Voir RYTHME_HDV_DEFAUT: neutre au depart, donc identique a l'existant.
    this._hdvRythme = { ...RYTHME_HDV_DEFAUT };
  }

  // Le seul sens autre qu'horizontal. Ecrit une fois ici plutot que teste a
  // trois endroits.
  static get SENS() { return ['horizontal', 'vertical']; }

  charger() {
    // Doit rester visible apres le catch: c'est la qu'on decide de reecrire
    // le fichier une fois les entrees perimees ecartees.
    let reecrire = false;
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
      // LES ANCIENNES ENTREES SONT DES CHAINES, ET ON LES JETTE. Elles ont
      // ete apprises par une regle qu'on sait fausse — le maitre entrant en
      // combat, c'est-a-dire jouer normalement. Les convertir reviendrait a
      // conserver exactement les blocages qu'on veut supprimer. La forme
      // suffit a reconnaitre la migration, aucun drapeau de version n'est
      // necessaire.
      if (Array.isArray(json.combats)) {
        const limite = Date.now() - MS_OUBLI;
        for (const c of json.combats) {
          if (c === null || typeof c !== 'object') continue;
          if (typeof c.cle !== 'string' || c.cle.length === 0) continue;
          if (!Number.isFinite(c.le) || c.le < limite) continue;
          this._combats.set(c.cle, c.le);
        }
        // Reecrire tout de suite ce qui a ete ecarte: sans cela une liste
        // jetee reviendrait a chaque lecture jusqu'au prochain reglage touche.
        if (this._combats.size !== json.combats.length) reecrire = true;
      }
      // Meme discipline que les touches: chaque champ est repris seulement si
      // sa forme est connue. Un sens inconnu ou une position qui n'est pas un
      // entier retombe sur le defaut, sans faire echouer le chargement — perdre
      // la place d'une fenetre est benin, perdre les reglages ne l'est pas.
      if (json.overlay !== null && typeof json.overlay === 'object' && !Array.isArray(json.overlay)) {
        const o = json.overlay;
        if (typeof o.ouvert === 'boolean') this._overlay.ouvert = o.ouvert;
        if (Favoris.SENS.includes(o.sens)) this._overlay.sens = o.sens;
        if (Number.isInteger(o.x)) this._overlay.x = o.x;
        if (Number.isInteger(o.y)) this._overlay.y = o.y;
      }
      if (typeof json.pdaArchi === 'boolean') this._pdaArchi = json.pdaArchi;
      // Meme discipline que `touches` et `overlay`: chaque champ n'est repris
      // que si sa forme est connue, et il est BORNE a la lecture -- un fichier
      // edite a la main ne doit pas pouvoir imposer une cadence que le panneau
      // refuserait.
      if (json.hdvRythme !== null && typeof json.hdvRythme === 'object'
          && !Array.isArray(json.hdvRythme)) {
        const o = json.hdvRythme;
        for (const nom of FACTEURS_HDV) {
          if (Number.isFinite(o[nom])) {
            this._hdvRythme[nom] = borner(o[nom], FACTEUR_MIN, FACTEUR_MAX);
          }
        }
        if (Number.isFinite(o.reponseMs)) {
          this._hdvRythme.reponseMs = Math.round(borner(o.reponseMs, REPONSE_MIN, REPONSE_MAX));
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
      this._combats = new Map();
      this._overlay = { ouvert: false, sens: 'horizontal', x: null, y: null };
      this._pdaArchi = false;
      this._hdvRythme = { ...RYTHME_HDV_DEFAUT };
    }
    if (reecrire) this._ecrire();
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
    return [...this._combats.keys()];
  }

  apprendreCombat(cle) {
    if (typeof cle !== 'string' || cle.length === 0) return;
    this._combats.set(cle, Date.now());
    this._ecrire();
  }

  // LE RECOURS quand OMNI a retenu a tort. La liste est faite de numeros:
  // personne ne peut deviner quelle entree est fautive, donc on vide tout.
  //
  // PLUS AUCUN APPELANT depuis le 2026-09-01: l'utilisateur a fait retirer le
  // bouton « Oublier les combats » de la fenetre, en disant qu'il signalerait
  // le probleme s'il se presentait. La methode reste, et le recours avec elle:
  // vider le tableau `combats` de favoris.json revient exactement a l'appeler.
  // Ne pas la supprimer comme du code mort sans reposer la question.
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

  // Une COPIE: modifier ce qui est rendu changerait le reglage sans passer par
  // l'ecriture du fichier, et la place de la fenetre serait perdue au
  // redemarrage sans que rien ne le signale.
  overlay() {
    return { ...this._overlay };
  }

  // Reglage PARTIEL: on n'ecrit que les champs presents. La position part a
  // chaque lacher de souris, le sens seulement quand on bascule, l'ouverture
  // seulement au bouton. Un remplacement complet ferait perdre les deux autres
  // a chaque geste.
  reglerOverlay(reglage) {
    if (reglage === null || typeof reglage !== 'object' || Array.isArray(reglage)) return;
    if (typeof reglage.ouvert === 'boolean') this._overlay.ouvert = reglage.ouvert;
    if (Favoris.SENS.includes(reglage.sens)) this._overlay.sens = reglage.sens;
    if (Number.isInteger(reglage.x)) this._overlay.x = reglage.x;
    if (Number.isInteger(reglage.y)) this._overlay.y = reglage.y;
    this._ecrire();
  }

  // LE RYTHME DES PASSES HDV. Rendu par COPIE: main.js en garde une reference
  // que les deux modules relisent a chaque tirage, et une copie garantit qu'ils
  // ne peuvent pas modifier ce qui sera ecrit sur le disque.
  hdvRythme() {
    return { ...this._hdvRythme };
  }

  // PARTIEL PAR CONSTRUCTION: le panneau envoie le champ qui vient de bouger,
  // pas les cinq a chaque frappe. Un champ absent garde donc sa valeur.
  reglerHdvRythme(partiel) {
    if (partiel === null || typeof partiel !== 'object') return;
    for (const nom of FACTEURS_HDV) {
      if (Number.isFinite(partiel[nom])) {
        this._hdvRythme[nom] = borner(partiel[nom], FACTEUR_MIN, FACTEUR_MAX);
      }
    }
    if (Number.isFinite(partiel.reponseMs)) {
      this._hdvRythme.reponseMs = Math.round(borner(partiel.reponseMs, REPONSE_MIN, REPONSE_MAX));
    }
    this._ecrire();
  }

  // L'interrupteur de la pierre d'ame equipee a l'entree en combat.
  pdaArchi() {
    return this._pdaArchi;
  }

  marquerPdaArchi(actif) {
    this._pdaArchi = actif === true;
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
        combats: [...this._combats].map(([cle, le]) => ({ cle, le })),
        overlay: this.overlay(),
        pdaArchi: this._pdaArchi,
        hdvRythme: this.hdvRythme(),
      };
      fs.writeFileSync(this.chemin, JSON.stringify(contenu), 'utf8');
    } catch (e) {
      // Perdre les reglages est benin; empecher l'application de fonctionner
      // ne l'est pas.
    }
  }
}

module.exports = { Favoris, MS_OUBLI, RYTHME_HDV_DEFAUT };
