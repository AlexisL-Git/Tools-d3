'use strict';
const {
  trameMettreEnVente, trameAbonner, trameDesabonner, trameStats,
  lirePrixMarche, lireStatsPrix, lireStock, lirePileMaj, lirePileDisparue, lirePrixMoyens,
} = require('./trames');
const { deciderPose } = require('./prix');
const { candidats, paquets } = require('./stock');

// Poser des lots en hotel de vente, un compte a la fois.
//
// Mesure: docs/superpowers/specs/2026-09-01-trames-mise-en-vente.md.
// Conception: docs/superpowers/specs/2026-09-01-mise-en-vente-design.md.
//
// CE MODULE A DEUX ROLES, comme reprix.js, et pour la meme raison.
//
// 1. UNE ECOUTE PERMANENTE. Elle memorise ivx — les piles du joueur — et ivi,
//    les prix moyens du catalogue. ivx arrive QUAND LE JOUEUR OUVRE SON
//    PANNEAU DE VENTE: c'est le client qui la demande, de lui-meme, par un
//    itr. Un module qui ne se reveillerait qu'au clic aurait deja rate la
//    seule trame qui dit ce qu'on possede.
//
// 2. UNE PASSE, declenchee par le bouton. D'ou lancer(pid), un point d'entree
//    de plus: un bouton n'est pas une trame.
//
// ON N'EMET PAS NOTRE PROPRE itr. Les quatre itr mesures l'ont tous ete par le
// client, au moment ou le joueur ouvrait ou filtrait son panneau. Rien ne dit
// que le serveur accepte un itr isole, et on n'acheterait que la fraicheur
// d'un stock deja frais.

// LE RYTHME, A DEUX ECHELLES.
//
// Poser quatre lots identiques, c'est taper Entree quatre fois: le prix est
// deja saisi, la quantite deja choisie. D'ou une rafale courte a l'interieur
// d'un paquet. Signale en jeu le 01/09: « en moins de 0,5 seconde j'ai mis 4
// lots de 100 en HDV ».
const DELAI_RAFALE_MIN = 90;
const DELAI_RAFALE_MAX = 260;

// ENTRE DEUX OBJETS, LE DELAI LONG — et c'est lui qui rachete le realisme que
// la rafale depense. Ces deux bornes sont celles de reprix.js, corrigees APRES
// essai en jeu: la premiere version tenait 150 a 600 ms et s'etait fait
// signaler d'un « ca met en vente un peu trop vite ».
//
// Avec la rafale et ces bornes, 300 lots prennent 5 min 43 s, soit 0,88 lot
// par seconde en moyenne. Descendre le delai d'objet a 400-1400 ms ramenerait
// la moyenne a 1,5-2,6/s, c'est-a-dire exactement la cadence qui avait paru
// trop vive.
const DELAI_OBJET_MIN = 900;
const DELAI_OBJET_MAX = 2600;

// LA PAUSE FRANCHE, comptee EN VISITES D'OBJET et non en lots: la rafale est
// le geste atomique, on ne la coupe pas en son milieu.
const PAUSE_MIN = 2000;
const PAUSE_MAX = 7000;
const AVANT_PAUSE_MIN = 20;
const AVANT_PAUSE_MAX = 30;

// Au-dela, on considere que la reponse ne viendra pas. Le serveur repond en
// 30 ms sur les mesures.
const DELAI_REPONSE = 4000;

const auHasard = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// Le temps entre deux lots d'un meme paquet. Pure: le hasard entre par
// argument, donc les bornes se testent sans piloter d'horloge.
function rythmeRafale(hasard = Math.random) {
  return DELAI_RAFALE_MIN + Math.floor(hasard() * (DELAI_RAFALE_MAX - DELAI_RAFALE_MIN + 1));
}

// Le temps d'une visite d'objet a la suivante, avec la pause quand le compteur
// tombe. Rend le delai ET le compteur pour la visite suivante.
//
// ELLE NE S'APPELLE PAS rythmeObjet, ET C'EST VOLONTAIRE. reprix.js exporte
// deja un rythmeObjet(hasard) qui rend un NOMBRE et ne pause pas; celle-ci
// prend un compteur et rend { ms, compteur }. Deux modules freres, deux
// signatures, un seul nom: la confusion serait garantie au premier qui lit les
// deux. — le compteur est REARME en
// meme temps que la pause est servie, sans quoi il resterait a zero et toutes
// les visites suivantes pauseraient aussi.
function rythmeVisite(compteur, hasard = Math.random) {
  const entre = (min, max) => min + Math.floor(hasard() * (max - min + 1));
  let ms = entre(DELAI_OBJET_MIN, DELAI_OBJET_MAX);
  let suivant = compteur - 1;
  if (suivant <= 0) {
    ms += entre(PAUSE_MIN, PAUSE_MAX);
    suivant = entre(AVANT_PAUSE_MIN, AVANT_PAUSE_MAX);
  }
  return { ms, compteur: suivant };
}

function creerVente({ superviseur, reglages = {}, onCompteRendu = () => {} }) {
  // Ce que l'ecoute permanente retient, par client.
  const stocks = new Map();     // pid -> [{ uid, gid, qte, avecEffets }]
  const prixMoyens = new Map(); // pid -> Map(gid -> prix moyen unitaire)
  const passes = new Map();     // pid -> la passe en cours

  const pilesConnues = (pid) => (stocks.get(pid) || []).filter((p) => !p.avecEffets).length;
  const enCours = (pid) => passes.has(pid);

  function onTrame({ pid, dir, frame }) {
    if (frame === null || frame === undefined || dir !== 'in') return;

    if (frame.type === 'ivx' || frame.type === 'iwb') {
      const piles = lireStock(frame);
      // Une trame qui ne rend aucune pile n'efface pas ce qu'on sait: le
      // bouton deviendrait inerte sans raison visible.
      if (piles.length > 0) stocks.set(pid, piles);
      return;
    }
    if (frame.type === 'ivi') {
      const table = lirePrixMoyens(frame);
      if (table.size > 0) prixMoyens.set(pid, table);
      return;
    }
  }

  function lancer(pid) {
    if (passes.has(pid)) {
      onCompteRendu({ pid, ok: false, raison: 'une passe tourne deja sur ce compte' });
      return;
    }
    const etat = superviseur.comptes.get(pid);
    if (etat === null || etat === undefined) {
      onCompteRendu({ pid, ok: false, raison: 'ce compte n est pas pilote' });
      return;
    }
    const piles = stocks.get(pid) || [];
    if (piles.length === 0) {
      onCompteRendu({ pid, ok: false, raison: 'ouvre l hotel de vente une fois pour que je voie ton stock' });
      return;
    }
    const lots = candidats({ piles, prixMoyens: prixMoyens.get(pid) || new Map() });
    if (lots.length === 0) {
      onCompteRendu({ pid, ok: false, raison: 'aucune ressource vendable dans ton stock' });
      return;
    }
    demarrer(pid, etat, piles, lots);
  }

  function arreter(pid) {
    const passe = passes.get(pid);
    if (passe === undefined) return;
    terminer(pid, passe, 'arret demande', true);
  }

  // Remplace en Task 5 par l'automate complet.
  function demarrer(pid, etat, piles, lots) {
    passes.set(pid, { etatArme: etat, piles, lots, minuteurs: new Set() });
    superviseur.emettre(pid, trameAbonner(lots[0].gid));
  }
  function terminer(pid, passe) {
    passes.delete(pid);
    onCompteRendu({ pid, fini: true, bilan: { poses: 0, sautes: 0, echecs: 0, objetsAbandonnes: 0 }, raison: null });
  }

  return { onTrame, lancer, arreter, pilesConnues, enCours };
}

module.exports = {
  creerVente, rythmeRafale, rythmeVisite,
  DELAI_RAFALE_MIN, DELAI_RAFALE_MAX, DELAI_OBJET_MIN, DELAI_OBJET_MAX,
  PAUSE_MIN, PAUSE_MAX, DELAI_REPONSE,
};
