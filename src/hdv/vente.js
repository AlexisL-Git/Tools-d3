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
//
// LA PASSE S'ARRETE AU PREMIER kge NON CONFIRME. On ne sait distinguer ni le
// plafond de lots de l'hotel de vente, ni le manque de kamas pour la taxe, ni
// un simple hoquet — et on n'a pas a le faire: les trois demandent la meme
// chose, s'arreter. C'est aussi ce qui dispense de mesurer le plafond et la
// taxe. S'arreter a tort coute un clic; continuer a tort coute des centaines
// d'emissions inutiles.

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
// tombe. Rend le delai ET le compteur pour la visite suivante: LE COMPTEUR EST
// REARME en meme temps que la pause est servie, sans quoi il resterait a zero
// et toutes les visites suivantes pauseraient aussi.
//
// ELLE NE S'APPELLE PAS rythmeObjet, ET C'EST VOLONTAIRE. reprix.js exporte
// deja un rythmeObjet(hasard) qui rend un NOMBRE et ne pause pas; celle-ci
// prend un compteur et rend { ms, compteur }. Deux modules freres, deux
// signatures, un seul nom: la confusion serait garantie au premier qui lit les
// deux.
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

  // Des delais explicites court-circuitent le rythme: c'est ce qui rend les
  // tests synchrones. En usage reel ils ne sont jamais fournis.
  const delaiObjetMs = (passe) => {
    const r = reglages.delaiObjetMs;
    if (Number.isFinite(r)) return r;
    const { ms, compteur } = rythmeVisite(passe.avantPause);
    passe.avantPause = compteur;
    return ms;
  };
  const delaiRafaleMs = () => {
    const r = reglages.delaiRafaleMs;
    return Number.isFinite(r) ? r : rythmeRafale();
  };
  const delaiReponseMs = () => {
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
  // reponse est deja en retard ». Zero desarme donc le minuteur.
  function expirer(passe, fn, ms) {
    if (ms <= 0) return null;
    return plusTard(passe, fn, ms);
  }

  // L'AVANCEMENT SE COMPTE LA OU LES LOTS QUITTENT LA FILE, et nulle part
  // ailleurs. Meme regle que chez reprix.js, et ici elle est obligatoire: a
  // l'expiration d'un kbt on compte `objetsAbandonnes += 1` et on vide la
  // file, sans que les LOTS de ce paquet soient comptes nulle part — ni poses,
  // ni sautes, ni echecs. Un restant deduit de ces trois-la resterait donc
  // bloque pour toujours sur un stock ou un seul objet s'abandonne.
  //
  // LE TOTAL NE SERA PAS ATTEINT, et c'est assume: la passe s'arrete au
  // plafond de l'hotel de vente, quelques centaines de lots avant d'epuiser
  // les candidats. Le restant dit ce qui pourrait encore partir, pas ce qui
  // partira.
  function avancer(pid, passe, n) {
    if (n <= 0) return;
    passe.restant -= n;
    onCompteRendu({ pid, poses: passe.bilan.poses, restant: passe.restant, total: passe.bilan.lots });
  }

  function annulerMinuteurs(passe) {
    for (const t of passe.minuteurs) clearTimeout(t);
    passe.minuteurs.clear();
  }

  // LA GARDE D'IDENTITE, reprise de passeur.js. On compare l'OBJET d'etat, pas
  // le pid: Windows recycle les numeros, et un client relance pendant la passe
  // rendrait un autre etat sous le meme pid. Herite de la passe du precedent,
  // il recevrait des kge portant les uid de piles de quelqu'un d'autre.
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

  // Passe au paquet suivant, en se desabonnant du precedent. Tant qu'on reste
  // abonne, le serveur continue de pousser des kgp pour rien.
  //
  // ON SE DESABONNE MEME QUAND LE GID NE CHANGE PAS. Un paquet est une visite,
  // et deux paquets du meme objet portent des tailles differentes: relire le
  // marche entre les deux est precisement ce que la regle « un lot par kgp »
  // conserve de sens.
  function paquetSuivant(pid, passe) {
    annulerMinuteurs(passe);
    if (passe.gid !== null && !envoyer(pid, passe, trameDesabonner(passe.gid))) return;
    passe.gid = null;
    passe.paquet = null;
    passe.prix = null;
    passe.attentePile = null;

    if (passe.paquets.length === 0) { terminer(pid, passe, null, false); return; }

    const paquet = passe.paquets.shift();

    // L'ouverture de l'objet suivant EST DIFFEREE. Entre les deux, passe.gid
    // vaut null: les kbt et kgp qui trainent encore sont donc ignores, ce qui
    // est exactement ce qu'on veut — ils portent sur l'objet qu'on quitte.
    //
    // LA PREMIERE VISITE, ELLE, NE PAIE PAS CE DELAI — meme raison que le
    // premier lot d'un paquet ne paie pas la rafale, un cran plus haut: ce
    // delai espace DEUX objets, et au depart il n'y a pas d'objet precedent.
    // Le geste qui vient d'avoir lieu, c'est le clic. Le servir quand meme
    // laissait 1,4 a 2,6 s de silence entre le clic et le premier keh —
    // signale en jeu comme « une grande attente au tout debut ». Il n'est pas
    // consomme non plus: sans visite precedente, il n'y a pas d'intervalle a
    // decompter du compteur de pause.
    const attente = passe.premiereVisite ? 0 : delaiObjetMs(passe);
    passe.premiereVisite = false;

    plusTard(passe, () => {
      if (!passes.has(pid)) return;
      if (!vivant(pid, passe)) { terminer(pid, passe, 'le client a disparu pendant la passe', false); return; }
      passe.gid = paquet.gid;
      passe.paquet = paquet;
      passe.file = paquet.lots.slice();
      if (!envoyer(pid, passe, trameAbonner(paquet.gid))) return;
      if (!envoyer(pid, passe, trameStats(paquet.gid))) return;

      // Si kbt n'arrive jamais, on abandonne CE paquet et on continue. Une
      // passe pendue ressemblerait trait pour trait a une passe qui travaille.
      expirer(passe, () => {
        if (!passes.has(pid)) return;
        // LA GARDE D'IDENTITE VAUT AUSSI POUR LES MINUTEURS, et c'est le cas
        // qu'on oublie: une expiration arrive jusqu'a quatre secondes apres
        // l'envoi, largement de quoi laisser un autre client reprendre le pid.
        // paquetSuivant emet un trameDesabonner des sa premiere ligne, donc
        // sans cette garde on parle dans la session de quelqu'un d'autre.
        if (!vivant(pid, passe)) { terminer(pid, passe, 'le client a disparu pendant la passe', false); return; }
        passe.bilan.objetsAbandonnes += 1;
        avancer(pid, passe, passe.file.length);
        passe.file = [];
        paquetSuivant(pid, passe);
      }, delaiReponseMs());
    }, attente);
  }

  // Les lots DEJA POSES pendant cette passe pour ce gid et cette taille. C'est
  // ce que deciderPose compare au minimum du marche pour savoir si le minimum
  // est deja le notre — et donc s'aligner au lieu de sous-coter.
  function nosDuPaquet(passe) {
    return passe.poses.filter((l) => l.gid === passe.gid);
  }

  // LE PRIX DU PAQUET, DECIDE UNE FOIS. Un paquet sans prix decidable — le
  // marche est a 1 kama, ou l'extrapolation sort du garde-fou — n'emet rien du
  // tout: ses lots sont comptes sautes et on passe a l'objet suivant.
  function decidePaquet(pid, passe, marche) {
    const moyens = prixMoyens.get(pid);
    const prix = deciderPose({
      marche,
      nos: nosDuPaquet(passe),
      taille: passe.paquet.taille,
      moyenUnitaire: (moyens && moyens.get(passe.gid)) || 0,
    });
    if (prix === null) {
      passe.bilan.sautes += passe.file.length;
      avancer(pid, passe, passe.file.length);
      passe.file = [];
      paquetSuivant(pid, passe);
      return;
    }
    passe.prix = prix;
    passe.premier = true;
    poserSuivant(pid, passe);
  }

  // Le prix du paquet est decide UNE FOIS, a l'arrivee de kbt. Ensuite on pose
  // en rafale: tous les lots partent au meme prix, donc il n'y a rien a
  // relire. Si un concurrent passe dessous pendant la rafale, nos derniers
  // lots sont un cran trop haut — et c'est exactement ce que « mettre a jour
  // les prix » rattrape.
  function poserSuivant(pid, passe) {
    if (!passes.has(pid)) return;

    while (passe.file.length > 0) {
      const lot = passe.file[0];
      const reste = passe.quantites.get(lot.uidPile);
      // ivj FAIT AUTORITE. Notre decoupage date du lancement; si la pile a
      // fondu entre-temps, emettre dessus poserait un lot qu'on n'a plus.
      if (reste === undefined || reste < lot.taille) {
        passe.file.shift();
        passe.bilan.sautes += 1;
        avancer(pid, passe, 1);
        continue;
      }
      passe.file.shift();
      avancer(pid, passe, 1);
      const envoi = trameMettreEnVente({ prix: passe.prix, uidPile: lot.uidPile, taille: lot.taille });
      plusTard(passe, () => {
        if (!passes.has(pid)) return;
        if (!vivant(pid, passe)) { terminer(pid, passe, 'le client a disparu pendant la passe', false); return; }
        if (!envoyer(pid, passe, envoi)) return;
        // ON N'ATTEND UNE CONFIRMATION QU'APRES AVOIR DEMANDE. Armer
        // attentePile avant l'envoi ouvrait une fenetre de 90 a 260 ms — le
        // delai de rafale — pendant laquelle un ivj sur la MEME pile
        // satisfaisait confirmer(). Or confirmer() annule les minuteurs: le
        // kge en attente d'envoi etait supprime, et le lot compte comme pose
        // sans jamais partir.
        //
        // Le cas n'est pas theorique: un paquet est fait de lots tires d'une
        // MEME pile, le paquet median en compte quatre, et ivj se declenche
        // pour tout mouvement de cette pile — y compris une vente faite a la
        // main par le joueur, qui est precisement devant son hotel de vente.
        passe.attentePile = lot.uidPile;
        passe.enVol = lot;
        // LE SERVEUR N'A JAMAIS ETE OBSERVE EN TRAIN DE REFUSER UN kge.
        // L'absence de confirmation est donc le seul signal disponible — et
        // c'est aussi ce qui implemente « jusqu'a ce qu'il n'y ait plus de
        // place ou plus de kamas » sans connaitre ni le plafond ni la taxe.
        expirer(passe, () => {
          if (!passes.has(pid) || passe.attentePile !== lot.uidPile) return;
          // Meme garde, meme raison: terminer() se desabonne, et un
          // desabonnement envoye au client qui a repris le pid part dans sa
          // session a lui.
          if (!vivant(pid, passe)) { terminer(pid, passe, 'le client a disparu pendant la passe', false); return; }
          passe.bilan.echecs += 1;
          terminer(pid, passe, 'refus du serveur — plus de place ou plus de kamas', true);
        }, delaiReponseMs());
      // LE PREMIER LOT D'UN PAQUET NE PAIE PAS LA RAFALE: le delai d'objet
      // vient deja d'etre servi par paquetSuivant, et kbt d'arriver. Ajouter
      // la rafale par-dessus compterait deux fois le meme geste, 1530 fois sur
      // le stock de mesure.
      }, passe.premier ? 0 : delaiRafaleMs());
      passe.premier = false;
      return;
    }

    paquetSuivant(pid, passe);
  }

  // Un kge confirme: la pile a fondu de la taille du lot, ou elle a disparu.
  function confirmer(pid, passe, uid, reste) {
    if (passe.attentePile !== uid) return;
    annulerMinuteurs(passe);
    passe.attentePile = null;
    if (reste === null) passe.quantites.delete(uid);
    else passe.quantites.set(uid, reste);
    passe.bilan.poses += 1;
    passe.poses.push({ gid: passe.gid, taille: passe.enVol.taille, prix: passe.prix });
    onCompteRendu({
      pid, poses: passe.bilan.poses, restant: passe.restant, total: passe.bilan.lots,
    });
    poserSuivant(pid, passe);
  }

  function demarrer(pid, etat, piles, lots) {
    const groupes = paquets(lots);
    const quantites = new Map();
    for (const p of piles) if (!p.avecEffets) quantites.set(p.uid, p.qte);
    const passe = {
      etatArme: etat,
      paquets: groupes,
      paquet: null,
      file: [],
      gid: null,
      prix: null,
      premier: true,
      premiereVisite: true,
      attentePile: null,
      enVol: null,
      quantites,
      poses: [],
      minuteurs: new Set(),
      // Tire au depart pour que deux passes ne pausent pas au meme rang.
      avantPause: auHasard(AVANT_PAUSE_MIN, AVANT_PAUSE_MAX),
      restant: lots.length,
      bilan: { lots: lots.length, poses: 0, sautes: 0, echecs: 0, objetsAbandonnes: 0 },
    };
    passes.set(pid, passe);
    // LE SEUL COMPTE RENDU MARQUE `debut`, emis AVANT la premiere trame: il
    // permet a l'IHM de rafraichir des le clic, une fois par passe. Les
    // suivants attendent le tick d'affichage — envoyer l'etat a chaque lot
    // lancerait un powershell.exe par lot.
    onCompteRendu({ pid, debut: true, restant: passe.restant, total: passe.bilan.lots });
    paquetSuivant(pid, passe);
  }

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
      if (stats === null || stats.gid !== passe.gid || passe.prix !== null) return;
      annulerMinuteurs(passe);
      decidePaquet(pid, passe, stats.prix);
      return;
    }

    if (frame.type === 'kgp') {
      // On lit kgp pour tenir le marche a jour, mais on NE REDECIDE PAS: le
      // prix du paquet est arrete une fois pour toutes.
      const marche = lirePrixMarche(frame);
      if (marche === null || marche.gid !== passe.gid || passe.prix !== null) return;
      annulerMinuteurs(passe);
      decidePaquet(pid, passe, marche.prix);
      return;
    }

    if (frame.type === 'ivj') {
      const maj = lirePileMaj(frame);
      if (maj !== null) confirmer(pid, passe, maj.uid, maj.qte);
      return;
    }

    if (frame.type === 'ium') {
      const uid = lirePileDisparue(frame);
      if (uid !== null) confirmer(pid, passe, uid, null);
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

  return { onTrame, lancer, arreter, pilesConnues, enCours };
}

module.exports = {
  creerVente, rythmeRafale, rythmeVisite,
  DELAI_RAFALE_MIN, DELAI_RAFALE_MAX, DELAI_OBJET_MIN, DELAI_OBJET_MAX,
  PAUSE_MIN, PAUSE_MAX, DELAI_REPONSE,
};
