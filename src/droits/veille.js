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
function creerCacheFichier(chemin, { onJournal = console.error } = {}) {
  // "se rattrape au prochain tour" suppose une panne passagere. Si elle ne
  // l est pas (dossier en lecture seule, disque plein...), le fichier n existe
  // jamais et chaque lancement hors ligne rendra zero droit sans un mot: on le
  // signale une fois, pas a chaque tentative -- sinon le journal se remplirait
  // d une ligne identique toutes les minutes sans rien dire de plus.
  let dejaSignale = false;
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
      catch (e) {
        if (!dejaSignale) {
          dejaSignale = true;
          onJournal('droits', `cache droits: ecriture en echec, se rattrapera si la panne est passagere (${chemin}) : ${e.message}`);
        }
      }
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
  // Meme motif que garde-combat.js et superviseur.js: (pid, texte). Lance par
  // outils/lancer-dev.vbs, OMNI n a pas de console attachee -- console.error
  // ne reste un defaut valable qu au developpement. desktop/main.js branche
  // ce rappel sur journal(), qui ecrit aussi dans un fichier.
  onJournal = console.error,
}) {
  let courants = [];
  let minuteur = null;
  let arrete = false;
  // Un seul demarrage. Sans cette garde, un deuxieme appel a demarrer()
  // referme sa propre chaine planifier/reprogrammer par-dessus la premiere:
  // `minuteur` n'en retient que la derniere, et arreter() ne coupe plus que
  // celle-la -- l'autre continue d'interroger le service indefiniment.
  let dejaDemarre = false;

  function appliquer(nouveaux) {
    // Une fonction que cette version ne connait pas est ignoree: le panneau
    // peut avoir de l avance sur le code installe chez l ami.
    const apres = nouveaux.filter((n) => NOMS.includes(n));
    const gagnes = apres.filter((n) => !courants.includes(n));
    const perdus = courants.filter((n) => !apres.includes(n));
    courants = apres;
    if (gagnes.length || perdus.length) {
      // Meme regle que composer.js: une exception ici ne doit ni se
      // propager (elle romprait la chaine interroger/reprogrammer et
      // tuerait la boucle en silence) ni disparaitre sans laisser de trace
      // (un onChangement mort ressemblerait alors a un onChangement qui n a
      // rien a faire). Chez nous onChangement touche reprix et l etat de
      // l ami: elle peut lever, et l ami ne doit pas en payer ses droits.
      try {
        onChangement({ gagnes, perdus, droits: apres });
      } catch (e) {
        onJournal('droits', `veille droits: onChangement en echec, la boucle continue : ${e.stack}`);
      }
    }
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
    if (r.status === 404) {
      // Vercel rend 404 aussi bien pour une cle revoquee que pour une route
      // qui n existe pas encore (version publiee avant `npx vercel --prod`).
      // Confondre les deux viderait les droits de tous les amis pendant la
      // fenetre de deploiement -- exactement l erreur que ce fichier existe
      // pour eviter. serveur-maj/api/droits.js pose toujours un Content-Type
      // JSON, meme sur son propre 404; une page d erreur de plateforme est du
      // HTML. Donc: pas de JSON => pas notre route => injoignable, pas revoque.
      const ct = r.headers && typeof r.headers.get === 'function' ? r.headers.get('content-type') : null;
      if (!ct || !ct.includes('application/json')) return;
      appliquer([]); cache.ecrire([]); return;
    }
    if (r.status !== 200) return; // 500 chez nous n est pas une revocation.
    let corps;
    try { corps = await r.json(); } catch (e) { return; } // corps illisible: incident, pas une revocation.
    // Un 200 dont le corps n a pas de tableau droits (bug transitoire du
    // service, derive d API) n est pas non plus une revocation: seul un 404
    // franc revoque. Sans ce garde-fou, un { } malforme viderait tout le
    // monde exactement comme une vraie coupure de cle.
    if (!corps || !Array.isArray(corps.droits)) return;
    appliquer(corps.droits);
    cache.ecrire(courants);
  }

  function reprogrammer() {
    if (arrete) return;
    minuteur = planifier(async () => {
      // Le rappel peut avoir ete arme avant un arreter() -- notamment dans
      // les tests, ou le faux minuteur n annule rien reellement. On revalide
      // donc l etat au reveil, pas seulement avant de re-planifier.
      if (arrete) return;
      await interroger();
      reprogrammer();
    }, periodeMs);
  }

  return {
    droits() { return courants; },
    async demarrer() {
      if (dejaDemarre) return; // une seule chaine, jamais deux en parallele.
      dejaDemarre = true;
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
