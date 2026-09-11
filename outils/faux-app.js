'use strict';

// LE FAUX window.app DU BANC D'ESSAI.
// Conception: docs/superpowers/specs/2026-09-10-interface-locale-design.md
//
// CE FICHIER EST CHARGE PAR LE NAVIGATEUR autant que par les tests Node: pas
// un seul require, et une double exposition gardee en fin de fichier.
//
// LA LISTE DES CANAUX EST CELLE DE desktop/preload.js, NOM POUR NOM. Le piege
// est ecrit en tete de ce fichier-la: un canal manquant ne casse rien au
// chargement, il se voit au clic, sous la forme d'un bouton qui « ne fait
// rien ». Un test compare les deux listes.
//
// Le shim ne rejoue AUCUNE regle metier. Il ecrit le champ demande et reemet
// l'etat: le banc sert le comportement de la page, pas la logique du produit.

// TOUT LE FICHIER VIT DANS CETTE FONCTION, ET CE N'EST PAS DU STYLE.
// faux-app.js et le <script> de desktop/index.html sont deux scripts
// CLASSIQUES: ils partagent la meme portee lexicale de premier niveau. Les
// deux recopient COLONNES (ici et index.html:2164) -- au premier niveau, la
// seconde declaration jette « Identifier 'COLONNES' has already been
// declared » et le script d'index.html n'est JAMAIS execute. La page affiche
// alors son ossature, sans une seule ligne, et sans un mot ailleurs que dans
// la console. La fonction rend la collision impossible, pour COLONNES comme
// pour tout nom qu'on ajoutera ici plus tard.
//
// Le corps n'est pas indente: garder le diff lisible vaut mieux que deplacer
// 180 lignes d'un cran. `module` reste visible ici -- Node passe le module
// en parametre de son propre enrobage, toute fonction imbriquee y accede.
(function () {

// Recopie de src/comptes/colonnes.js (lecture seule, inaccessible ici: ce
// fichier est charge par le navigateur, aucun require n'y survivrait).
// desktop/index.html:2164-2170 fait deja la meme recopie pour la meme raison.
// SOURCE DE VERITE: src/comptes/colonnes.js. Les cinq noms sont ceux que
// desktop/index.html:2196 envoie via b.dataset.colonne -- jamais un champ de
// ligne -- et 'repl' est la seule inversee (cochee = NON exclue).
const COLONNES = {
  repl: { champ: 'exclu', inverse: true },
  tour: { champ: 'passeTour', inverse: false },
  groupe: { champ: 'invitation', inverse: false },
  anim: { champ: 'noAnim', inverse: false },
  echange: { champ: 'echange', inverse: false },
};

function creerFauxApp(etatInitial, deps) {
  const options = deps || {};
  const chercher = options.fetch || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  const journal = options.journal || ((m) => console.warn(m));

  let etat = etatInitial;
  const abonnesEtat = [];
  const abonnesAmbiance = [];
  const abonnesAlerte = [];

  const emettre = () => { for (const r of abonnesEtat) r(etat); };
  const ligneParId = (id) => etat.lignes.find((l) => l.id === id);
  const lignePid = (pid) => etat.lignes.find((l) => l.pid === pid);
  const inconnu = (nom, args) => journal(`[banc] canal inconnu : ${nom}(${JSON.stringify(args)})`);
  // basculerVersCompte et boutonSouris sont des canaux CONNUS (voir plus bas):
  // les journaliser comme « inconnu » remplirait la console en usage normal,
  // basculerVersCompte partant a chaque clic sur le nom d'une ligne.
  const inerte = (nom, args) => journal(`[banc] canal sans effet sur le banc : ${nom}(${JSON.stringify(args)})`);

  // Un champ booleen d'une ligne, par identifiant de compte.
  const poser = (id, champ, valeur) => {
    const l = ligneParId(id);
    if (l) l[champ] = !!valeur;
    emettre();
  };

  const app = {
    // --- reception -------------------------------------------------------
    // DIVERGENCE ASSUMEE D'AVEC ELECTRON: le vrai ipcRenderer.on('etat', ...)
    // n'appelle jamais son rappel de facon synchrone -- le premier etat reel
    // arrive apres did-finish-load. Ici il n'y a pas de tick de chargement a
    // attendre, donc appeler tout de suite est ce qui evite un ecran vide
    // jusqu'au prochain evenement.
    surEtat: (rappel) => { abonnesEtat.push(rappel); rappel(etat); },
    surAmbiance: (rappel) => { abonnesAmbiance.push(rappel); },
    surPdaArchiAlerte: (rappel) => { abonnesAlerte.push(rappel); },

    // --- la fenetre: un onglet n'a pas de cadre --------------------------
    fenetreReduire: async () => {},
    fenetreFermer: async () => {},

    // --- la chasse a l archimonstre --------------------------------------
    pdaArchiArmer: async (actif) => { etat.pdaArchi = !!actif; emettre(); },
    pdaArchiRepli: async (actif) => { etat.pdaArchiRepli = !!actif; emettre(); },
    archiRelire: async () => { emettre(); },

    // --- les cases -------------------------------------------------------
    basculerColonne: async (nom, ids) => {
      const colonne = COLONNES[nom];
      // desktop/main.js:1999 fait `if (!parNom.has(nom)) return;`: un nom de
      // colonne inconnu ne doit rien ecrire, ici non plus.
      if (!colonne) { inconnu('basculerColonne', [nom, ids]); return; }
      const vises = Array.isArray(ids) ? ids : [];
      // Ce que la case AFFICHE pour cette ligne, inversion comprise: pour
      // 'repl', la case affiche !l.exclu.
      const affiche = (l) => (colonne.inverse ? !l[colonne.champ] : Boolean(l[colonne.champ]));
      // Le losange dit « tous » seulement si TOUTES les lignes visees
      // affichent coche: la bascule vise donc l'inverse de l'etat d'ensemble
      // courant (semantique « indetermine -> tout cocher »).
      const tous = vises.every((id) => { const l = ligneParId(id); return l && affiche(l); });
      const cible = !tous;
      for (const id of vises) {
        const l = ligneParId(id);
        if (l) l[colonne.champ] = colonne.inverse ? !cible : cible;
      }
      emettre();
    },
    exclureCompte: async (id, exclu) => poser(id, 'exclu', exclu),
    basculerPasseTourCompte: async (id, actif) => poser(id, 'passeTour', actif),
    basculerInvitationCompte: async (id, actif) => poser(id, 'invitation', actif),
    basculerNoAnimCompte: async (id, actif) => poser(id, 'noAnim', actif),
    basculerEchangeCompte: async (id, actif) => poser(id, 'echange', actif),

    // --- qui commande ----------------------------------------------------
    definirMaitre: async (id) => {
      for (const l of etat.lignes) l.estMaitre = false;
      const l = ligneParId(id);
      if (l) l.estMaitre = true;
      etat.sansMaitre = !etat.lignes.some((x) => x.estMaitre);
      emettre();
    },
    basculerVersCompte: async (id) => { inerte('basculerVersCompte', [id]); },

    // --- les raccourcis --------------------------------------------------
    reglerTouche: async (id, accelerateur) => {
      const l = ligneParId(id);
      if (l) l.touche = accelerateur || null;
      emettre();
    },

    // --- l hotel de vente ------------------------------------------------
    majPrixHdv: async (pid) => { const l = lignePid(pid); if (l) l.message = 'passe de prix (banc)'; emettre(); },
    mettreEnVenteHdv: async (pid) => { const l = lignePid(pid); if (l) l.message = 'mise en vente (banc)'; emettre(); },
    reglerHdvRythme: async (partiel) => { etat.hdvRythme = { ...etat.hdvRythme, ...(partiel || {}) }; emettre(); },
    reglerHdvGarde: async (partiel) => { etat.hdvGarde = { ...etat.hdvGarde, ...(partiel || {}) }; emettre(); },

    // --- la barre flottante et la souris ---------------------------------
    basculerOverlay: async () => { etat.overlayOuvert = !etat.overlayOuvert; emettre(); },
    boutonSouris: async (clic) => { inerte('boutonSouris', [clic]); },

    reglerDelai: async (secondes) => {
      const v = Number(secondes);
      etat.delai = Number.isFinite(v) && v >= 0 ? v : 0;
      emettre();
    },

    // --- fermer des clients ----------------------------------------------
    fermerUnClient: async (id) => {
      const l = ligneParId(id);
      if (l) { l.pid = null; l.etat = 'hors-ligne'; l.suivi = false; l.pilotable = false; l.estMaitre = false; }
      etat.sansMaitre = !etat.lignes.some((x) => x.estMaitre);
      emettre();
    },
    fermerTousLesClients: async () => {
      for (const l of etat.lignes) {
        l.pid = null; l.etat = 'hors-ligne'; l.suivi = false; l.pilotable = false; l.estMaitre = false;
      }
      etat.sansMaitre = true;
      emettre();
    },

    // --- les lectures: Node calcule, la page affiche ----------------------
    tableauArchi: async (quoi) => {
      const r = await chercher(`/faux/tableau-archi?quoi=${encodeURIComponent(quoi || 'archi')}`);
      return r.json();
    },
    devlog: async () => {
      const r = await chercher('/faux/devlog');
      return r.json();
    },
    // Le seul canal dont l'absence de handler est NORMALE cote OMNI: chez un
    // ami, l'invoke rejette et la page n'affiche rien. Le banc, lui, est en
    // mode dev: il repond.
    etatMajGit: async () => ({ etat: 'a-jour', retard: 0, branche: 'banc' }),

    // --- accessoires de banc, hors contrat preload.js ---------------------
    __etat: () => etat,
    __inconnu: inconnu,
    __ambiance: () => { for (const r of abonnesAmbiance) r(); },
    __alerte: (a) => { for (const r of abonnesAlerte) r(a); },
  };

  return app;
}

// Cote navigateur: l'etat initial est pose par l'injection du serveur, et un
// bouton discret declenche le son d'ambiance a la demande -- sans lui il
// faudrait attendre une minuterie qui, sur le banc, n'existe pas.
if (typeof window !== 'undefined') {
  window.app = creerFauxApp(window.__FAUX_ETAT__);
  window.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('button');
    b.textContent = 'banc : ambiance';
    b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;opacity:.5;font:11px sans-serif';
    b.onclick = () => window.app.__ambiance();
    document.body.appendChild(b);
  });
  // Tu enregistres, l'onglet se recharge. Sans ca, le Simple Browser demande
  // un clic droit puis « Reload » a chaque essai -- exactement le frottement
  // que le banc existe pour supprimer.
  if (typeof EventSource !== 'undefined') {
    new EventSource('/faux/rechargement').onmessage = () => location.reload();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { creerFauxApp };
}

}());
