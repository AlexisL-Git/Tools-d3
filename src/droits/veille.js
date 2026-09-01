'use strict';
const fs = require('node:fs');
const { NOMS } = require('./liste');

const PERIODE_MS = 60000;
const DELAI_MS = 5000;

// LE CACHE SUR DISQUE. C est ce qu on applique au demarrage, avant la premiere
// reponse. Sans lui, un lancement hors ligne enleverait tout.
//
// Un fichier absent ou casse vaut AUCUN DROIT, jamais une exception: le defaut
// ferme est le meme que cote serveur.
function creerCacheFichier(chemin) {
  return {
    lire() {
      try {
        const v = JSON.parse(fs.readFileSync(chemin, 'utf8'));
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
      } catch (e) {
        return null;
      }
    },
    ecrire(noms) {
      try { fs.writeFileSync(chemin, JSON.stringify(noms)); }
      catch (e) { /* un cache non ecrit se rattrape au prochain tour */ }
    },
  };
}

// TROIS ETATS, JAMAIS CONFONDUS -- meme vocabulaire que amorceur/canal.js:
//   200          la liste, on l applique
//   injoignable  incident reseau: ON NE CHANGE RIEN
//   404          cle revoquee: tout tombe
//
// Confondre les deux derniers ferait qu une coupure de connexion retirerait
// ses fonctions a tout le monde. C est l erreur que canal.js evite deja.
function creerVeille({
  base, lireCle, cache,
  chercher = globalThis.fetch, planifier = setTimeout, arreterMinuteur = clearTimeout,
  onChangement = () => {}, periodeMs = PERIODE_MS,
}) {
  let courants = [];
  let minuteur = null;
  let arrete = false;

  function appliquer(nouveaux) {
    // Une fonction que cette version ne connait pas est ignoree: le panneau
    // peut avoir de l avance sur le code installe chez l ami.
    const apres = nouveaux.filter((n) => NOMS.includes(n));
    const gagnes = apres.filter((n) => !courants.includes(n));
    const perdus = courants.filter((n) => !apres.includes(n));
    courants = apres;
    if (gagnes.length || perdus.length) onChangement({ gagnes, perdus, droits: apres });
  }

  async function interroger() {
    let r;
    try {
      r = await chercher(base + '/api/droits', {
        headers: { 'x-cle': lireCle() },
        signal: AbortSignal.timeout(DELAI_MS),
      });
    } catch (e) {
      return; // injoignable: on ne change rien, surtout pas les droits.
    }
    if (r.status === 404) { appliquer([]); cache.ecrire([]); return; }
    if (r.status !== 200) return; // 500 chez nous n est pas une revocation.
    let corps;
    try { corps = await r.json(); } catch (e) { return; }
    const liste = corps && Array.isArray(corps.droits) ? corps.droits : [];
    appliquer(liste);
    cache.ecrire(courants);
  }

  function reprogrammer() {
    if (arrete) return;
    minuteur = planifier(async () => { await interroger(); reprogrammer(); }, periodeMs);
  }

  return {
    droits() { return courants; },
    async demarrer() {
      // PAS DE CLE = MODE DEVELOPPEMENT. C est la machine de Draxus, lancee sur
      // le depot sans passer par l amorceur: tous les droits, aucune requete.
      // Une veille qui verrouillerait le depot rendrait le developpement
      // impossible.
      if (!lireCle()) { appliquer(NOMS); return; }
      const duCache = cache.lire();
      appliquer(Array.isArray(duCache) ? duCache : []);
      await interroger();
      reprogrammer();
    },
    arreter() { arrete = true; if (minuteur !== null) arreterMinuteur(minuteur); },
  };
}

module.exports = { creerVeille, creerCacheFichier, PERIODE_MS };
