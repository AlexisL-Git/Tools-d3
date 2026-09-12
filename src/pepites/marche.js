'use strict';
const {
  trameAbonner, trameDesabonner, trameStats, lireStatsPrix, TAILLES,
} = require('../hdv/trames');
const { voisinServi } = require('../hdv/prix');
const { rythmeObjet, DELAI_REPONSE } = require('../hdv/reprix');

// Le vrai prix du marche des objets du classement des pepites, lu a
// l'ouverture d'un etal.
//
// Conception: docs/superpowers/specs/2026-09-11-pepites-prix-marche-design.md.
//
// C'EST LE FRERE DE reprix.js, et il en reprend la forme eprouvee: un gid a la
// fois, abonnement, lecture, desabonnement, au rythme valide en jeu le 01/09.
//
// CE QU'IL N'A PAS, ET QUE reprix.js A: la boucle de relecture apres emission.
// reprix.js relit les prix apres chaque mise a jour de lot parce qu'il MODIFIE
// le marche. Ici on ne fait que lire: aucune de nos emissions ne change un
// prix, donc il n'y a rien a relire.
//
// CE MODULE EMET, ET C'EST UNE PREMIERE DANS LE PROJET sur un geste qui n'est
// pas un clic dans OMNI. reprix.js et vente.js emettent sur un bouton; la
// passe part ici sur l'ouverture d'un etal. Trois choses la bornent: elle ne
// demarre que sur `isb`, elle ne touche que les candidats qu'on lui donne, et
// elle reprend le rythme deja juge acceptable en jeu.

// La liste de l'etal. SEUL l'hotel de vente la fait redescendre -- le clic est
// un `iva`, le meme message qu'un zaap ou une porte (garde-hdv.js:39, mesure
// du 09/09: elle arrive 32 ms apres le clic).
//
// C'est le seul nom de trame cite en dur ici, et il l'est deja dans
// garde-hdv.js et vente.js.
const OUVERTURE_ETAL = 'isb';

// Le prix a l'unite, tire des quatre creneaux 1 / 10 / 100 / 1000.
//
// LE ZERO N'EST PAS UN PRIX, c'est « aucune offre a cette taille ». On deduit
// alors du creneau servi le plus proche, ramene a l'unite: voisinServi() de
// prix.js porte cette recherche, y compris sa regle subtile « a distance
// egale, on prend le plus petit », parce qu'un creneau de petite taille est
// plus liquide et son prix unitaire mieux etabli.
function prixUnitaire(quatre) {
  if (!Array.isArray(quatre)) return null;
  const direct = Number(quatre[0]);
  if (direct > 0) return direct;
  const i = voisinServi(quatre, 0);
  if (i === -1) return null;
  const u = Math.floor(Number(quatre[i]) / TAILLES[i]);
  return u > 0 ? u : null;
}

function creerMarche({
  superviseur,
  candidats,
  reglages = {},
  onPrix = () => {},
  onAvancement = () => {},
  onFin = () => {},
}) {
  const passes = new Map();

  const delaiObjet = () => (Number.isFinite(reglages.delaiObjetMs)
    ? reglages.delaiObjetMs
    : rythmeObjet(Math.random, reglages.rythme));
  const delaiReponse = () => (Number.isFinite(reglages.delaiReponseMs)
    ? reglages.delaiReponseMs
    : DELAI_REPONSE);

  // ON COMPARE L'IDENTITE DE L'ETAT, PAS LE PID. Windows recycle les pid: un
  // client relance pendant la passe rendrait le meme numero et heriterait de
  // la passe du precedent (passeur.js:120).
  const memeClient = (pid, passe) => superviseur.comptes.get(pid) === passe.etatArme;

  function terminer(pid, raison) {
    const passe = passes.get(pid);
    if (passe === undefined) return;
    if (passe.minuteur !== null) clearTimeout(passe.minuteur);
    passes.delete(pid);
    onFin({ pid, bilan: { ...passe.bilan, raison: raison === undefined ? null : raison } });
  }

  function emettre(pid, passe, trame) {
    const r = superviseur.emettre(pid, trame);
    if (r === null || r === undefined || r.ok !== true) {
      terminer(pid, r && r.raison ? r.raison : 'emission refusee');
      return false;
    }
    return true;
  }

  function suivant(pid) {
    const passe = passes.get(pid);
    if (passe === undefined) return;
    if (!memeClient(pid, passe)) { terminer(pid, 'le client a disparu'); return; }
    if (passe.reste.length === 0) { terminer(pid); return; }
    passe.gid = passe.reste.shift();
    if (!emettre(pid, passe, trameAbonner(passe.gid))) return;
    if (!emettre(pid, passe, trameStats(passe.gid))) return;
    // LE DELAI MAXIMAL PAR ETAPE N'ABANDONNE QUE CE GID, pas la passe: regle
    // de reprix.js. Un etal ferme cesse de repondre, et c'est aussi par ce
    // chemin que la passe s'epuise proprement.
    passe.minuteur = setTimeout(() => {
      passe.bilan.echecs += 1;
      finirObjet(pid);
    }, delaiReponse());
    if (passe.minuteur.unref) passe.minuteur.unref();
  }

  function finirObjet(pid) {
    const passe = passes.get(pid);
    if (passe === undefined) return;
    if (passe.minuteur !== null) { clearTimeout(passe.minuteur); passe.minuteur = null; }
    // ON SE DESABONNE. Tant qu'on l'est, le serveur POUSSE un prix a chaque
    // mouvement du marche sur ce gid: sans cela la passe laisse derriere elle
    // autant de flux ouverts que d'objets visites.
    if (passe.gid !== null) emettre(pid, passe, trameDesabonner(passe.gid));
    passe.gid = null;
    passe.bilan.faits += 1;
    onAvancement({ pid, fait: passe.bilan.faits, total: passe.total });
    if (!passes.has(pid)) return;
    const t = setTimeout(() => suivant(pid), delaiObjet());
    if (t.unref) t.unref();
  }

  function demarrer(pid) {
    // DEUX PASSES CONCURRENTES DOUBLERAIENT LE DEBIT D'EMISSIONS. Une seconde
    // ouverture d'etal pendant une passe est donc ignoree, pas mise en file.
    if (passes.has(pid)) return;
    const etatArme = superviseur.comptes.get(pid);
    if (etatArme === null || etatArme === undefined) return;
    const gids = (typeof candidats === 'function' ? candidats() : []) || [];
    if (gids.length === 0) return;
    passes.set(pid, {
      etatArme,
      reste: [...gids],
      total: gids.length,
      gid: null,
      minuteur: null,
      bilan: { tarifes: 0, sansOffre: 0, echecs: 0, faits: 0 },
    });
    suivant(pid);
  }

  function onTrame({ pid, dir, frame }) {
    if (frame === null || frame === undefined || dir !== 'in') return;
    if (frame.type === OUVERTURE_ETAL) { demarrer(pid); return; }
    const passe = passes.get(pid);
    if (passe === undefined || passe.gid === null) return;
    if (!memeClient(pid, passe)) { terminer(pid, 'le client a disparu'); return; }
    const stats = lireStatsPrix(frame);
    if (stats === null || stats.gid !== passe.gid) return;
    const prix = prixUnitaire(stats.prix);
    // UN MARCHE VIDE N'EST PAS UN ECHEC: l'objet existe, personne n'en vend.
    // Les deux appellent des reactions differentes, donc le bilan les separe.
    if (prix === null) passe.bilan.sansOffre += 1;
    else { passe.bilan.tarifes += 1; onPrix({ pid, gid: stats.gid, prix, quand: Date.now() }); }
    finirObjet(pid);
  }

  const enCours = (pid) => passes.has(pid);

  return { onTrame, enCours };
}

module.exports = { creerMarche, prixUnitaire, OUVERTURE_ETAL };
