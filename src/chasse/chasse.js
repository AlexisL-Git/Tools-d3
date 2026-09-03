'use strict';
const {
  lireStock, lirePile, lirePileMaj, lirePileDisparue, POSITION_INVENTAIRE,
} = require('../hdv/trames');
const { combattantsDe, TYPE_COMBATTANTS } = require('../abandon-combat');
const { choisir, POSITION_PIERRE } = require('./pierres');
const { trameEquiper, lirePosition, lireGroupeAttaque, lireGroupes } = require('./trames');

// Au-dela, on considere que l'ordre s'est perdu. Le serveur a repondu en 40 ms
// a la mesure; trois secondes sont deux ordres de grandeur au-dessus, et il
// reste quinze secondes de preparation pour reagir.
const DELAI_REPONSE_MS = 3000;

// Deux clients qui voient le meme groupe partir emettent leur `kmu` a quelques
// millisecondes d'ecart; cinq secondes couvrent largement l'ecart sans jamais
// avaler deux combats successifs, la preparation durant a elle seule 18 s.
const FENETRE_COMBAT_MS = 5000;

// Le temps qu'on laisse a une mule pour arriver dans le combat apres que le
// groupe a quitte la carte. Elle peut avoir la moitie de la carte a traverser,
// et la phase de preparation dure 18 s: une minute est large des deux cotes,
// assez pour les retardataires, trop court pour attraper le combat suivant.
const FENETRE_ARRIVEE_MS = 60000;

// La chasse a l'archimonstre: equiper la bonne pierre d'ame, et rien d'autre.
//
// Conception: docs/superpowers/specs/2026-09-03-chasse-pierre-ame-design.md.
//
// CE QUI REND LA FONCTION SIMPLE, c'est qu'on peut changer d'equipement en
// PHASE DE PREPARATION, verifie en jeu le 03/09. On declenche donc sur l'entree
// en combat, pas sur la lecture de la carte avant l'attaque, et il n'y a jamais
// besoin de reconnaitre un archimonstre: le combat est deja le sien, puisque
// c'est l'utilisateur qui l'a lance.
//
// LA FENETRE EST LARGE: 18 secondes de preparation mesurees, ordre confirme en
// 40 ms. Aucun rythme a etaler, aucun delai a menager, contrairement a l'hotel
// de vente ou le flot lui-meme est le risque.
//
// L'INTERRUPTEUR N'EST PAS UN CONFORT. Une pierre d'ame capture aussi les
// monstres ordinaires: allumee en permanence, la chasse remplirait des Enormes
// pierres avec des Bouftous.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur, comme src/hdv/vente.js.
function creerChasse({
  superviseur, actif = false, reglages = {}, onCompteRendu = () => {},
}) {
  // Ce que l'ecoute permanente retient, par client.
  const stocks = new Map();   // pid -> [pile]
  const cartes = new Map();   // pid -> Map(idGroupe -> { niveauMax, monstres })
  const attentes = new Map(); // pid -> { uid, gid }

  let allume = actif === true;

  const delaiReponseMs = () => (Number.isFinite(reglages.delaiReponseMs)
    ? reglages.delaiReponseMs : DELAI_REPONSE_MS);

  function oublier(pid) {
    const attente = attentes.get(pid);
    if (attente === undefined) return;
    if (attente.minuteur !== null) clearTimeout(attente.minuteur);
    attentes.delete(pid);
  }

  // Eteindre OUBLIE les attentes: sinon une confirmation tardive conclurait au
  // rallumage suivant, sur un combat qui n'a plus rien a voir.
  function armer(valeur) {
    allume = valeur === true;
    if (!allume) for (const pid of [...attentes.keys()]) oublier(pid);
  }

  const nomDe = (pid) => {
    const etat = superviseur.comptes.get(pid);
    return etat && etat.nom ? etat.nom : String(pid);
  };

  // LA CLE S'APPELLE `compte`, PAS `nom`: `choisir` rend deja un `nom`, celui
  // de la pierre qui manque, et l'etalement ci-dessous l'ecraserait.
  const rendre = (pid, rendu) => onCompteRendu({ pid, compte: nomDe(pid), ...rendu });

  // Remettre notre copie de l'inventaire d'aplomb apres une pose reussie. Sans
  // ca, le combat suivant relirait une pile source intacte et une position 31
  // vide, et reequiperait pour rien.
  //
  // Les autres mouvements de piles (`iua`, `ivj`, `ium`) ne sont PAS ecoutes:
  // le prochain `ivx` remet tout d'aplomb, et la seule chose qu'on ait besoin
  // de savoir entre deux, c'est ou est la pierre.
  function noterPierrePosee(pid, attente, uidPose) {
    const piles = stocks.get(pid);
    if (piles === undefined) return;
    if (uidPose === attente.uid) return; // la pile n'a pas eu a se scinder
    const source = piles.find((p) => p.uid === attente.uid);
    if (source !== undefined) source.qte -= 1;
    piles.push({ uid: uidPose, gid: attente.gid, qte: 1, avecEffets: true, pos: POSITION_PIERRE });
  }

  // DEUX TRAMES, DEUX ROLES, ET C'EST TOUTE LA CONCEPTION DE CE MODULE.
  //
  // `kmu` dit QUOI EQUIPER: le groupe quitte la carte, on en connait le niveau.
  // Mais elle n'est recue que par les clients presents sur la carte a cet
  // instant. Mesure du 03/09 a 14h40: sur trois clients, UN SEUL l'a recue,
  // les deux autres etant encore en chemin.
  //
  // `kmk` dit QUAND EQUIPER, pour chaque client separement: c'est la liste des
  // combattants, et elle n'arrive qu'une fois le client REELLEMENT dans le
  // combat. Une mule encore en deplacement ne peut rien equiper — le jeu
  // refuse — donc on l'attend au lieu de tirer trop tot.
  //
  // Meme critere que src/abandon-combat.js pour reconnaitre un combat contre
  // des monstres: au moins un identifiant NEGATIF dans la liste. `kmk` sert
  // aussi a lister les acteurs d'une carte, ou tout est positif.
  let combat = null;
  const maintenant = () => (typeof reglages.maintenant === 'function'
    ? reglages.maintenant() : Date.now());

  function noterGroupe(pidSource, idGroupe) {
    const carte = cartes.get(pidSource);
    const groupe = carte === undefined ? undefined : carte.get(idGroupe);
    // UN GROUPE INCONNU N'EQUIPE RIEN. La liste des acteurs arrive a l'arrivee
    // sur la carte; un groupe qui n'y est pas est un trou dans ce qu'on sait,
    // pas une invitation a deviner.
    if (groupe === undefined) { rendre(pidSource, { quoi: 'groupe-inconnu', idGroupe }); return; }

    // Le meme depart vu par plusieurs clients ne rouvre pas un combat: sans
    // cette garde, la seconde `kmu` remettrait a zero la liste de ceux qui sont
    // deja equipes, et tout le monde recevrait un second ordre.
    const t = maintenant();
    if (combat !== null && combat.idGroupe === idGroupe
        && t - combat.quand < FENETRE_COMBAT_MS) return;
    combat = { idGroupe, niveauMax: groupe.niveauMax, quand: t, faits: new Set() };
  }

  function rejointLeCombat(pid) {
    if (combat === null) return;
    // Un combat trop vieux n'est plus le notre: une mule qui traine ne doit pas
    // faire equiper sur la foi d'un groupe vu il y a cinq minutes.
    if (maintenant() - combat.quand > FENETRE_ARRIVEE_MS) { combat = null; return; }
    if (combat.faits.has(pid)) return;
    combat.faits.add(pid);
    equiperPour(pid, combat.niveauMax);
  }

  function equiperPour(pid, niveauMax) {
    const verdict = choisir({ niveauMax, piles: stocks.get(pid) || [] });
    if (verdict.quoi !== 'equiper') {
      rendre(pid, { ...verdict, niveauMax });
      return;
    }

    // LA PURGE D'ABORD. On sort ce qui occupe l'emplacement avant de poser,
    // plutot que de compter sur le serveur pour le faire tout seul. Il le fait,
    // c'est mesure, mais un ordre qui ne suppose rien vaut mieux qu'un ordre
    // qui suppose. Demande de Jibef le 2026-09-03 apres avoir vu une pierre
    // etrangere rester en place.
    //
    // ELLE N'EST PAS ATTENDUE. Sa confirmation arriverait avant celle de la
    // pose, et les deux se ressemblent: attendre les deux compliquerait le
    // suivi pour rien. Si la purge echoue, la pose la remplace de toute facon.
    if (verdict.purge !== null && verdict.purge !== undefined) {
      superviseur.emettre(pid, trameEquiper({
        uid: verdict.purge.uid, qte: verdict.purge.qte, position: POSITION_INVENTAIRE,
      }));
    }

    // UNE SEULE PIERRE, PAS LA PILE ENTIERE. Le client, lui, deplace tout le
    // tas quand on equipe a la main (mesure du 03/09, une pile de 89 partie en
    // un ordre a 89). On ne l'imite PAS: decision de Jibef le 2026-09-03, il
    // n'y a aucune raison de mettre 89 pierres sur le personnage pour en
    // remplir une.
    //
    // CE CHOIX A UN PRIX, et c'est tout l'objet de la confirmation plus bas:
    // sortir une unite d'une pile en CREE une neuve, avec un uid neuf (`iua`,
    // mesure du 03/09). L'uid confirme n'est donc pas celui qu'on a envoye.
    const res = superviseur.emettre(pid, trameEquiper({
      uid: verdict.uid, qte: 1, position: POSITION_PIERRE,
    }));
    if (res === null || res === undefined || res.ok !== true) {
      rendre(pid, { quoi: 'echec', gid: verdict.gid, niveauMax });
      return;
    }
    // UN ORDRE SANS REPONSE DOIT SE VOIR. C'est le defaut qui a rendu la
    // seance du 03/09 au soir incomprehensible: OMNI a dit « envoye », le
    // serveur a ignore l'ordre sans un mot, et rien n'a jamais signale que la
    // pierre n'etait pas equipee. Le silence est desormais un compte rendu.
    const ms = delaiReponseMs();
    const minuteur = ms > 0 ? setTimeout(() => {
      attentes.delete(pid);
      rendre(pid, { quoi: 'sans-reponse', gid: verdict.gid, niveauMax });
    }, ms) : null;
    if (minuteur !== null && typeof minuteur.unref === 'function') minuteur.unref();
    attentes.set(pid, { uid: verdict.uid, gid: verdict.gid, minuteur });
    rendre(pid, { quoi: 'envoye', gid: verdict.gid, niveauMax });
  }

  function onTrame({ pid, dir, frame }) {
    if (frame === null || frame === undefined || dir !== 'in') return;

    // L'ECOUTE PERMANENTE TOURNE MEME ETEINTE. Elle ne coute que de la memoire,
    // et sans elle allumer l'interrupteur devant un combat n'aurait aucun effet
    // avant le prochain changement de carte.
    if (frame.type === 'ivx' || frame.type === 'iwb') {
      const piles = lireStock(frame);
      // Une trame qui ne rend aucune pile n'efface pas ce qu'on sait.
      if (piles.length > 0) stocks.set(pid, piles);
      return;
    }

    // LES MOUVEMENTS DE PILES, ET C'EST LA CORRECTION LA PLUS IMPORTANTE DU
    // 03/09 AU SOIR. `ivx` n'arrive qu'a la connexion: sans suivre ce qui bouge
    // ensuite, les uid pourrissent des le premier geste manuel. Ce soir-la
    // Jibef avait deseequipe des pierres a la main entre sa connexion et le
    // combat, notre uid ne designait plus rien, et le serveur a ignore l'ordre
    // sans un mot.
    //
    // Les trois trames se lisent deja chez l'hotel de vente, elles sont
    // reprises telles quelles: `iua` une pile neuve, `ivj` une pile entamee,
    // `ium` une pile disparue.
    if (frame.type === 'iua') {
      // Meme forme qu'une pile d'ivx, au champ 3 de la trame.
      const el = (frame.payload || []).find((f) => f.no === 3);
      const pile = el === undefined ? null : lirePile(el);
      if (pile === null) return;
      const piles = stocks.get(pid);
      if (piles !== undefined && !piles.some((p) => p.uid === pile.uid)) piles.push(pile);

      // C'EST LA VRAIE CONFIRMATION D'UNE POSE, et c'est la lecon du 03/09 au
      // soir. Quand on n'equipe qu'UNE pierre prise dans une pile, le serveur
      // ne DEPLACE rien: il CREE une pile neuve, deja a l'emplacement, et
      // n'emet donc aucun `ivq`. Mesure:
      //
      //   iua { 3={1=31 5={1=9689 3=1 4=242186527}} }   la pierre, en place
      //   ivj { 3={2=242076402 3=10} }                  la source, entamee
      //
      // On attendait un `ivq` qui ne pouvait pas venir, et OMNI concluait
      // « le serveur n'a rien repondu » sur un ordre qui avait parfaitement
      // marche.
      const attente = attentes.get(pid);
      if (allume && attente !== undefined && pile.pos === POSITION_PIERRE) {
        oublier(pid);
        rendre(pid, { quoi: 'equipe', gid: pile.gid });
      }
      return;
    }

    if (frame.type === 'ivj') {
      const maj = lirePileMaj(frame);
      if (maj === null) return;
      const piles = stocks.get(pid);
      if (piles === undefined) return;
      const pile = piles.find((p) => p.uid === maj.uid);
      if (pile !== undefined) pile.qte = maj.qte;
      return;
    }

    if (frame.type === 'ium') {
      const uid = lirePileDisparue(frame);
      if (uid === null) return;
      const piles = stocks.get(pid);
      if (piles === undefined) return;
      const rang = piles.findIndex((p) => p.uid === uid);
      if (rang >= 0) piles.splice(rang, 1);
      return;
    }

    if (frame.type === 'jss') {
      const groupes = lireGroupes(frame);
      // La carte REMPLACE la precedente: un groupe tue n'a pas a survivre.
      if (groupes.size > 0) cartes.set(pid, groupes);
      return;
    }

    // LA POSITION SE SUIT EN CONTINU, allumee ou non: c'est ce qui evite de
    // reequiper au combat suivant une pierre deja en place.
    if (frame.type === 'ivq') {
      const maj = lirePosition(frame);
      if (maj === null) return;
      const piles = stocks.get(pid);
      if (piles !== undefined) {
        const pile = piles.find((p) => p.uid === maj.uid);
        if (pile !== undefined) pile.pos = maj.pos;
      }
      const attente = attentes.get(pid);
      // LA CONFIRMATION NE SE RECONNAIT PAS A L'UID, mais a la POSITION. On
      // envoie une seule pierre prise dans une pile, ce qui en cree une neuve
      // avec un uid neuf: l'uid qui revient n'est donc pas celui qu'on a
      // envoye. Une arrivee en position 31 pendant qu'on attend, c'est la
      // notre, il n'y a rien d'autre qui aille s'y poser a cet instant.
      if (allume && attente !== undefined && maj.pos === POSITION_PIERRE) {
        oublier(pid);
        noterPierrePosee(pid, attente, maj.uid);
        rendre(pid, { quoi: 'equipe', gid: attente.gid });
      }
      return;
    }

    if (!allume) return;

    if (frame.type === 'kmu') {
      const idGroupe = lireGroupeAttaque(frame);
      if (idGroupe !== null) noterGroupe(pid, idGroupe);
      return;
    }

    // LA LISTE DES COMBATTANTS: ce client vient d'entrer dans le combat, et
    // c'est seulement maintenant qu'il peut equiper. Elle arrive plusieurs fois
    // pendant un meme combat, d'ou la liste de ceux qui sont deja servis.
    if (frame.type === TYPE_COMBATTANTS) {
      if (combattantsDe(frame) !== null) rejointLeCombat(pid);
    }
  }

  return { onTrame, armer, estAllume: () => allume };
}

module.exports = { creerChasse };
