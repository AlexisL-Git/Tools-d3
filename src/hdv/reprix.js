'use strict';
const {
  trameMajPrix, trameAbonner, trameDesabonner, trameStats,
  lirePrixMarche, lireStatsPrix, lireNosLots, lireLotPose, lireLotRetire, lirePrixMoyens,
} = require('./trames');
const { decider } = require('./prix');

// Remettre nos lots en vente au prix du marche, un compte a la fois.
//
// Mesure: docs/superpowers/specs/2026-09-01-trames-hdv.md.
// Conception: docs/superpowers/specs/2026-09-01-maj-prix-hdv-design.md.
//
// CE MODULE A DEUX ROLES, et le premier est ce qui rend le second possible.
//
// 1. UNE ECOUTE PERMANENTE. Il est compose dans composer() comme le passeur, et
//    tourne meme quand aucune passe n'est lancee. Il memorise `kby` — nos lots
//    en vente — et `ivi` — les 9861 prix moyens du catalogue.
//
//    kby n'arrive QU'A L'OUVERTURE de l'hotel de vente. Un module qui ne se
//    reveillerait qu'au clic du bouton aurait deja rate la seule trame qui dit
//    ce qu'on vend. C'est pour cela que l'ecoute ne s'arrete jamais.
//
// 2. UNE PASSE, declenchee par le bouton. D'ou `lancer(pid)`, un point d'entree
//    de plus que le passeur: un bouton n'est pas une trame.
//
// UN LOT PAR kgp. Chaque kch fait pousser un kgp par le serveur, avec notre
// nouveau prix dedans. Decider dix lots du meme objet sur une seule lecture du
// marche les ferait se sous-coter les uns les autres — le defaut ne se verrait
// qu'apres coup, la marchandise bradee. L'automate attend donc le kgp avant de
// decider le lot suivant. C'est la seule raison d'etre du drapeau `fraiche`.
//
// CE N'EST PAS CE RYTHME qui laissait des lots jumeaux en arriere (signale le
// 03/09): la passe les voyait tous, et decider() les laissait tous des qu'UN
// seul d'entre eux touchait le minimum. Cette regle-la vit dans prix.js.
//
// Ni Electron, ni Frida, ni disque: il se teste avec un double du superviseur,
// comme le passeur et l'accepteur d'echange.

// LE RYTHME, ET POURQUOI IL N'EST PAS QU'UN DELAI.
//
// La premiere version tenait 150 a 600 ms, reprises de DELAI_REACTION dans
// echange.js. C'etait un mauvais emprunt: la-bas il s'agit de REAGIR a une
// fenetre qui s'ouvre — voir, viser, cliquer. Ici il s'agit de reprendre un
// prix, c'est-a-dire lire le marche, decider, saisir un nombre et valider.
// Rien a voir. Signale en jeu le 01/09: « ca met en vente un peu trop vite ».
//
// A 375 ms de moyenne, la passe tenait 2,5 lots par seconde pendant plusieurs
// minutes d'affilee. Aucune main ne fait ca.
const DELAI_MIN = 900;
const DELAI_MAX = 2600;

// ELARGIR L'INTERVALLE NE SUFFIT PAS. Un tirage uniforme, meme lent, produit
// une cadence d'une regularite qu'aucun humain ne tient: la moyenne ne devie
// jamais, et c'est cette stabilite meme qui se remarque sur trois cents envois.
//
// On y ajoute donc une PAUSE FRANCHE tous les vingt a trente lots — quelqu'un
// qui leve les yeux, verifie autre chose, revient. C'est ce qui casse la
// cadence au lieu de seulement la ralentir.
const PAUSE_MIN = 2000;
const PAUSE_MAX = 7000;
const AVANT_PAUSE_MIN = 20;
const AVANT_PAUSE_MAX = 30;

// LE PASSAGE D'UN OBJET AU SUIVANT SE RYTHME AUSSI.
//
// Il ne l'etait pas: desabonnement, abonnement et demande de statistiques
// partaient d'affilee, puis on enchainait des la reponse. Sur une passe ou
// rien n'a besoin d'etre change — le cas le plus frequent des le second
// passage — cela donnait 108 objets fois trois trames en quelques secondes.
// C'est le motif meme qu'on venait de corriger sur les kch, et sous cette
// forme il est plus visible encore, puisque rien ne le ralentit.
//
// Le geste est plus court: consulter un objet, c'est le choisir dans une liste
// et lire ses prix, pas saisir un nombre et valider. D'ou un delai plus court
// que celui des kch — mais zero n'est pas defendable.
const DELAI_OBJET_MIN = 400;
const DELAI_OBJET_MAX = 1400;

// Au-dela, on considere que la reponse ne viendra pas. Le serveur repond en
// 30 ms sur les mesures; deux secondes laissent une marge tres large.
const DELAI_REPONSE = 4000;

const auHasard = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// Le rythme d'un lot au suivant, en fonction du nombre de lots restants avant
// la prochaine pause. Fonction PURE: le hasard entre par l'argument, donc elle
// se teste aux deux bornes sans piloter d'horloge.
//
// Rend le delai a attendre et le compteur pour le lot suivant.
// Le temps de passer d'un objet au suivant. Pure, comme rythme().
function rythmeObjet(hasard = Math.random) {
  return DELAI_OBJET_MIN + Math.floor(hasard() * (DELAI_OBJET_MAX - DELAI_OBJET_MIN + 1));
}

function rythme(compteur, hasard = Math.random) {
  const entre = (min, max) => min + Math.floor(hasard() * (max - min + 1));
  let ms = entre(DELAI_MIN, DELAI_MAX);
  let suivant = compteur - 1;
  // Le compteur est REARME en meme temps que la pause est servie: sans cela il
  // resterait a zero, et tous les lots suivants pauseraient aussi.
  if (suivant <= 0) {
    ms += entre(PAUSE_MIN, PAUSE_MAX);
    suivant = entre(AVANT_PAUSE_MIN, AVANT_PAUSE_MAX);
  }
  return { ms, compteur: suivant };
}

function creerReprix({ superviseur, reglages = {}, onCompteRendu = () => {} }) {
  // Ce que l'ecoute permanente retient, par client.
  const nosLots = new Map();    // pid -> [{ uid, gid, taille, prix, duree }]
  const prixMoyens = new Map(); // pid -> Map(gid -> prix moyen unitaire)
  const passes = new Map();     // pid -> la passe en cours

  // Un delaiMs explicite court-circuite le rythme: c'est ce qui rend les tests
  // synchrones. En usage reel il n'est jamais fourni.
  const delaiEnvoi = (passe) => {
    const r = reglages.delaiMs;
    if (Number.isFinite(r)) return r;
    const { ms, compteur } = rythme(passe.avantPause);
    passe.avantPause = compteur;
    return ms;
  };
  const delaiObjet = () => {
    const r = reglages.delaiObjetMs;
    return Number.isFinite(r) ? r : rythmeObjet();
  };
  const delaiReponse = () => {
    const r = reglages.delaiReponseMs;
    return Number.isFinite(r) ? r : DELAI_REPONSE;
  };

  // Un delai nul s'execute TOUT DE SUITE plutot qu'au tour de boucle suivant:
  // les tests avancent alors de facon synchrone, et chaque assertion porte sur
  // un etat stable plutot que sur une course.
  function plusTard(passe, fn, ms) {
    if (ms <= 0) { fn(); return null; }
    const t = setTimeout(() => { passe.minuteurs.delete(t); fn(); }, ms);
    passe.minuteurs.add(t);
    return t;
  }

  // LES DEUX DELAIS NE SE LISENT PAS PAREIL A ZERO. Un delai d'envoi nul veut
  // dire « tout de suite »; un delai d'expiration nul voudrait dire « la
  // reponse est deja en retard », ce qui n'a aucun sens. Zero desarme donc le
  // minuteur — c'est ce qui rend les tests synchrones sans les faire expirer
  // avant d'avoir recu quoi que ce soit.
  function expirer(passe, fn, ms) {
    if (ms <= 0) return null;
    return plusTard(passe, fn, ms);
  }

  function annulerMinuteurs(passe) {
    for (const t of passe.minuteurs) clearTimeout(t);
    passe.minuteurs.clear();
  }

  // LA GARDE D'IDENTITE, reprise de passeur.js. On compare l'OBJET d'etat, pas
  // le pid: Windows recycle les numeros, et un client relance pendant la passe
  // rendrait un autre etat sous le meme pid. Herite de la passe du precedent,
  // il recevrait des kch portant les uid de quelqu'un d'autre.
  function vivant(pid, passe) {
    return superviseur.comptes.get(pid) === passe.etatArme;
  }

  function envoyer(pid, passe, octets) {
    const res = superviseur.emettre(pid, octets);
    if (res && res.ok === false) {
      terminer(pid, passe, res.raison || 'envoi refuse', false);
      return false;
    }
    return true;
  }

  function terminer(pid, passe, raison, seDesabonner = true) {
    annulerMinuteurs(passe);
    passes.delete(pid);
    // On ne parle pas a un client disparu: `seDesabonner` est faux quand c'est
    // precisement lui qui a disparu, ou quand l'envoi vient d'echouer.
    if (seDesabonner && passe.gid !== null) superviseur.emettre(pid, trameDesabonner(passe.gid));
    onCompteRendu({ pid, fini: true, bilan: passe.bilan, raison: raison || null });
  }

  // Passe au gid suivant, en se desabonnant du precedent. Tant qu'on reste
  // abonne, le serveur continue de pousser des kgp pour rien.
  function gidSuivant(pid, passe) {
    annulerMinuteurs(passe);
    if (passe.gid !== null && !envoyer(pid, passe, trameDesabonner(passe.gid))) return;
    passe.gid = null;
    passe.marche = null;
    passe.fraiche = false;
    passe.attenteUid = null;

    if (passe.gids.length === 0) { terminer(pid, passe, null, false); return; }

    const gid = passe.gids.shift();

    // L'ouverture de l'objet suivant EST DIFFEREE. Entre les deux, passe.gid
    // vaut null: les kbt et kgp qui trainent encore sont donc ignores, ce qui
    // est exactement ce qu'on veut — ils portent sur l'objet qu'on vient de
    // quitter.
    //
    // LE PREMIER OBJET, LUI, NE PAIE PAS CE DELAI: il espace DEUX objets, et
    // au depart il n'y a pas d'objet precedent — le geste qui vient d'avoir
    // lieu, c'est le clic. Meme regle que dans vente.js, ou la servir laissait
    // plusieurs secondes de silence apres le clic.
    const attente = passe.premiereVisite ? 0 : delaiObjet();
    passe.premiereVisite = false;

    plusTard(passe, () => {
      if (!passes.has(pid)) return;
      if (!vivant(pid, passe)) { terminer(pid, passe, 'le client a disparu pendant la passe', false); return; }
      passe.gid = gid;
      passe.file = passe.parGid.get(gid).slice();
      if (!envoyer(pid, passe, trameAbonner(gid))) return;
      if (!envoyer(pid, passe, trameStats(gid))) return;

      // Si kbt n'arrive jamais, on abandonne CE gid et on continue. Une passe
      // pendue ressemblerait trait pour trait a une passe qui travaille.
      expirer(passe, () => {
        if (!passes.has(pid)) return;
        passe.bilan.echecs += passe.file.length;
        passe.file = [];
        gidSuivant(pid, passe);
      }, delaiReponse());
    }, attente);
  }

  // Les lots du gid courant, tels qu'ils sont MAINTENANT: c'est ce que decider()
  // compare au minimum du marche pour savoir s'il est deja a nous.
  function nosDuGid(pid, gid) {
    return (nosLots.get(pid) || []).filter((l) => l.gid === gid);
  }

  function traiter(pid, passe) {
    if (!passes.has(pid)) return;
    // Tant que le marche n'a pas ete relu depuis notre dernier envoi, on ne
    // decide rien: c'est la regle « un lot par kgp ».
    if (!passe.fraiche || passe.attenteUid !== null) return;

    while (passe.file.length > 0) {
      const lot = passe.file.shift();
      const moyens = prixMoyens.get(pid);
      const prix = decider({
        marche: passe.marche,
        nos: nosDuGid(pid, passe.gid),
        taille: lot.taille,
        // OU CE LOT-CI EN EST, et pas seulement ou en sont les autres. La file
        // est figee au lancement, mais chaque lot n'y passe qu'une fois: son
        // prix y est donc bien celui d'avant sa propre mise a jour.
        prixActuel: lot.prix,
        moyenUnitaire: (moyens && moyens.get(passe.gid)) || 0,
      });

      onCompteRendu({ pid, avance: passe.bilan.total - passe.file.length, total: passe.bilan.total });

      // Rien a faire sur ce lot: le marche n'a pas bouge, donc la lecture reste
      // valable et on enchaine sans attendre de kgp.
      if (prix === null) { passe.bilan.laisses += 1; continue; }

      passe.fraiche = false;
      passe.attenteUid = lot.uid;
      const envoi = trameMajPrix({ uid: lot.uid, prix, taille: lot.taille });
      // LE PREMIER LOT DE LA PASSE NE PAIE PAS LE DELAI D'ENVOI, meme
      // raisonnement qu'au-dessus: il espace deux kch, et celui-la n'a pas de
      // predecesseur. Sans lui, ouvrir l'objet tout de suite ne servait a
      // rien: l'ecran restait immobile jusqu'au premier prix repris. Le
      // compteur de pause n'est pas decompte non plus — il n'y a pas
      // d'intervalle a compter.
      const attente = passe.premierLot ? 0 : delaiEnvoi(passe);
      passe.premierLot = false;
      plusTard(passe, () => {
        if (!passes.has(pid)) return;
        if (!vivant(pid, passe)) { terminer(pid, passe, 'le client a disparu pendant la passe', false); return; }
        if (!envoyer(pid, passe, envoi)) return;
        // Le serveur n'a jamais ete observe en train de REFUSER un kch. On ne
        // sait donc pas s'il repond quelque chose: l'absence de confirmation
        // est le seul signal sur lequel on puisse s'appuyer.
        expirer(passe, () => {
          if (!passes.has(pid) || passe.attenteUid !== lot.uid) return;
          passe.bilan.echecs += 1;
          passe.attenteUid = null;
          passe.fraiche = true;
          traiter(pid, passe);
        }, delaiReponse());
      }, attente);
      return;
    }

    gidSuivant(pid, passe);
  }

  function onTrame({ pid, dir, frame }) {
    if (frame === null || frame === undefined || dir !== 'in') return;

    // --- L'ecoute permanente, hors de toute passe ---
    if (frame.type === 'kby') {
      nosLots.set(pid, lireNosLots(frame));
      return;
    }
    if (frame.type === 'ivi') {
      const table = lirePrixMoyens(frame);
      if (table.size > 0) prixMoyens.set(pid, table);
      return;
    }

    const passe = passes.get(pid);
    if (passe === undefined) return;

    if (!vivant(pid, passe)) {
      terminer(pid, passe, 'le client a disparu pendant la passe', false);
      return;
    }

    if (frame.type === 'kbt') {
      const stats = lireStatsPrix(frame);
      // Le kbt SANS champ 3 est l'accuse du desabonnement precedent, et il
      // arrive juste avant la vraie reponse: lireStatsPrix rend null dessus.
      if (stats === null || stats.gid !== passe.gid) return;
      annulerMinuteurs(passe);
      passe.marche = stats.prix;
      passe.fraiche = true;
      traiter(pid, passe);
      return;
    }

    if (frame.type === 'kgp') {
      const marche = lirePrixMarche(frame);
      if (marche === null || marche.gid !== passe.gid) return;
      passe.marche = marche.prix;
      passe.fraiche = true;
      traiter(pid, passe);
      return;
    }

    if (frame.type === 'kes') {
      const lot = lireLotPose(frame);
      if (lot === null || passe.attenteUid === null || lot.gid !== passe.gid) return;
      // L'UID A CHANGE: une mise a jour est un retrait suivi d'une repose.
      // Sans ce remplacement, une seconde passe emettrait des kch sur des
      // identifiants morts.
      const liste = nosLots.get(pid) || [];
      const i = liste.findIndex((l) => l.uid === passe.attenteUid);
      if (i !== -1) liste[i] = lot;
      passe.bilan.maj += 1;
      passe.attenteUid = null;
      annulerMinuteurs(passe);
      traiter(pid, passe);
      return;
    }

    if (frame.type === 'ken') {
      // ken arrive AUSSI pour les lots des autres joueurs tant qu'on est
      // abonne: plusieurs dizaines observees sans qu'on ait rien fait. Le
      // notre est suivi par kes, pas par lui.
      const uid = lireLotRetire(frame);
      if (uid === null) return;
      const liste = nosLots.get(pid) || [];
      if (uid === passe.attenteUid) return;
      const i = liste.findIndex((l) => l.uid === uid);
      if (i !== -1) liste.splice(i, 1);
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
    const mes = nosLots.get(pid) || [];
    if (mes.length === 0) {
      onCompteRendu({ pid, ok: false, raison: 'ouvre l hotel de vente une fois pour que je voie tes lots' });
      return;
    }

    // Regroupes par objet: un abonnement par gid, et tous ses lots a la suite.
    const parGid = new Map();
    for (const lot of mes) {
      if (!parGid.has(lot.gid)) parGid.set(lot.gid, []);
      parGid.get(lot.gid).push(lot);
    }

    const passe = {
      etatArme: etat,
      parGid,
      gids: [...parGid.keys()],
      gid: null,
      file: [],
      marche: null,
      fraiche: false,
      premiereVisite: true,
      premierLot: true,
      attenteUid: null,
      minuteurs: new Set(),
      // Lots restants avant la prochaine pause. Tire au depart pour que deux
      // passes ne pausent pas au meme rang.
      avantPause: auHasard(AVANT_PAUSE_MIN, AVANT_PAUSE_MAX),
      bilan: { total: mes.length, maj: 0, laisses: 0, echecs: 0 },
    };
    passes.set(pid, passe);
    gidSuivant(pid, passe);
  }

  function arreter(pid) {
    const passe = passes.get(pid);
    if (passe === undefined) return;
    terminer(pid, passe, 'arret demande', true);
  }

  // Pour l'IHM: le bouton reste desactive tant que la liste est vide, et le
  // compte rendu affiche son nombre.
  const lotsConnus = (pid) => nosLots.get(pid) || [];
  const enCours = (pid) => passes.has(pid);

  return { onTrame, lancer, arreter, lotsConnus, enCours };
}

module.exports = {
  creerReprix, rythme, rythmeObjet,
  DELAI_MIN, DELAI_MAX, PAUSE_MIN, PAUSE_MAX, DELAI_OBJET_MIN, DELAI_OBJET_MAX, DELAI_REPONSE,
};
