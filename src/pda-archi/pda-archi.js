'use strict';
const {
  lireStock, lirePile, lirePileMaj, lirePileDisparue, POSITION_INVENTAIRE,
  RANGEMENT_INVENTAIRE,
} = require('../hdv/trames');
const { combattantsDe, TYPE_COMBATTANTS } = require('../abandon-combat');
const { choisir, POSITION_PIERRE } = require('./pierres');
const {
  trameEquiper, lirePosition, lireGroupes, lireEntreeCombat,
} = require('./trames');

// Au-dela, on considere que l'ordre s'est perdu. Le serveur a repondu en 40 ms
// a la mesure; trois secondes sont deux ordres de grandeur au-dessus, et il
// reste quinze secondes de preparation pour reagir.
const DELAI_REPONSE_MS = 3000;

// Combien de combats on retient le niveau. Un personnage n'est que dans un
// combat a la fois, mais cette table est indexee par COMBAT et non par
// personnage: sans borne elle grandirait a chaque combat de la session.
const COMBATS_RETENUS = 32;

// Combien de fois on retente dans un MEME combat quand le serveur ne repond
// pas. Trois: au-dela, ce n'est pas une question de rythme, et mitrailler un
// serveur qui se tait n'a jamais rien equipe.
const ESSAIS_MAX = 3;

// La chasse a l'archimonstre: equiper la bonne pierre d'ame, et rien d'autre.
//
// Conception: docs/superpowers/specs/2026-09-03-pda-archi-design.md.
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
function creerPdaArchi({
  superviseur, actif = false, reglages = {}, repli = () => false,
  onCompteRendu = () => {},
}) {
  // Ce que l'ecoute permanente retient, par client.
  const stocks = new Map();   // pid -> [pile]
  const cartes = new Map();   // pid -> Map(idGroupe -> { niveauMax, monstres })
  const attentes = new Map(); // pid -> { uid, gid }

  let allume = actif === true;

  const delaiReponseMs = () => (Number.isFinite(reglages.delaiReponseMs)
    ? reglages.delaiReponseMs : DELAI_REPONSE_MS);

  // LE REPLI DE CALIBRE EST UNE FONCTION, PAS UN BOOLEEN, et pour la meme
  // raison que `delaiReponseMs` juste au-dessus: la case se coche dans OMNI
  // pendant qu'un client est connecte. Fige a la construction, elle n'aurait
  // rien change avant un redemarrage -- et personne n'aurait compris pourquoi.
  const monterEnCalibre = () => repli() === true;

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

  // LE FILET SE TEND APRES LE SAUT, ET C'EST LA CORRECTION DU 05/09.
  //
  // La purge partait AVANT la pose. Elle reussissait -- c'est un ordre banal --
  // et quand la pose qui suivait n'aboutissait pas, le personnage restait NU
  // pour tout le combat, `servis` interdisant la moindre nouvelle tentative.
  // N'importe quelle cause suffisait: uid perime, ordre perdu, refus du serveur.
  // Le compte rendu disait « le serveur n a rien repondu », ce qui etait vrai et
  // ne disait pas le pire.
  //
  // CE QUE JIBEF VOULAIT RESTE ENTIER: rien d'etranger ne demeure a
  // l'emplacement. Seul le moment change. Et le serveur desequipe tout seul --
  // mesure du 03/09, poser en 31 renvoie en 63 ce qui s'y trouvait -- donc dans
  // le cas ordinaire notre copie voit deja la pierre partie et il n'y a rien a
  // faire. La purge redevient ce qu'elle aurait toujours du etre: un filet pour
  // le cas ou le serveur ne l'a pas fait.
  //
  // UN FILET NE SE TEND PAS AVANT LE SAUT: pas de pose confirmee, pas de purge,
  // et le personnage garde sa pierre inadaptee. Elle vaut infiniment mieux que
  // pas de pierre.
  function purgerApresPose(pid, attente) {
    const purge = attente.purge;
    if (purge === null || purge === undefined) return;
    // ON NE PURGE QUE CE QU'ON CROIT ENCORE EN PLACE. Un uid deja renvoye en
    // inventaire par le serveur n'a pas besoin d'un ordre de plus.
    const piles = stocks.get(pid);
    if (piles !== undefined) {
      const occupant = piles.find((p) => p.uid === purge.uid);
      if (occupant === undefined || occupant.pos !== POSITION_PIERRE) return;
      occupant.pos = POSITION_INVENTAIRE;
    }
    superviseur.emettre(pid, trameEquiper({
      uid: purge.uid, qte: purge.qte, position: POSITION_INVENTAIRE,
    }));
  }

  // LA CLE EST LE COMBAT, ET C'EST TOUTE LA CONCEPTION DE CE MODULE.
  //
  // `kae` dit DANS QUEL COMBAT se trouve un client, et le nomme: un identifiant
  // commun a tous les clients du meme combat, different au combat suivant. Elle
  // dit aussi QUOI EQUIPER quand le combattant ajoute est le groupe de
  // monstres, dont la carte donne le niveau.
  //
  // `kmk` reste le signal « ce client est REELLEMENT dans le combat », mesure
  // du 03/09: une mule encore en deplacement ne recoit pas la liste des
  // combattants, et le jeu lui refuserait l'equipement.
  //
  // CE QUI A DISPARU LE 04/09, ET POURQUOI. La version precedente tenait UN
  // combat, global, ouvert sur `kmu` et referme par le temps: une fenetre de
  // 5 s contre les doublons, une de 60 s contre les retardataires, et la liste
  // des personnages deja servis. Trois etats qui perimaient, et trois `return`
  // MUETS quand ils perimaient. Jibef a vu un personnage rejoindre un combat
  // deja lance sans rien equiper et sans un mot dans le journal: c'etait l'un
  // de ces trois. Un identifiant de combat rend les trois inutiles.
  //
  // IL N'Y A PLUS AUCUNE HORLOGE ICI. Un retardataire servi au bout de trois
  // minutes l'est comme celui qui arrive en deux secondes, puisque c'est le
  // meme combat; et le combat suivant porte un autre identifiant meme sur le
  // meme groupe et la meme carte (mesure: journal-chasse6.log, groupe -20002
  // en combat 211 puis en combat 55).
  const niveaux = new Map();    // idCombat -> niveauMax du groupe attaque
  const combats = new Map();    // pid -> idCombat ou ce client se trouve
  const servis = new Map();     // pid -> dernier idCombat pour lequel il a equipe
  const sansNiveau = new Map(); // pid -> idCombat deja signale sans niveau
  const essais = new Map();     // pid -> { idCombat, n } tentatives de ce combat
  // ET IL EST INDEXE PAR COMBAT, COMME SES TROIS VOISINS. C'etait un Set qu'on
  // ne vidait JAMAIS, et c'est le bug du 05/09 au matin: des le deuxieme combat
  // de la session la garde de `tenter` laissait tout passer, et le declencheur
  // devenait `kae` -- « un combattant est ajoute au combat » -- au lieu de
  // `kmk` -- « ce client a recu la liste, il y est vraiment ». Le jeu refuse un
  // changement d'equipement a un client qui n'y est pas encore, en silence.
  //
  // Mesure, journal-dev.log du 05/09: aux combats 1 et 2 les mules etaient
  // servies 2,6 a 6,4 s APRES l'attaquant et rien ne ratait; aux combats 3 a 6
  // elles tiraient toutes 29 ms AVANT lui, et l'attaquant -- seul a envoyer
  // assez tard -- reussissait quatre fois sur quatre pendant qu'elles echouaient.
  //
  // C'est la derniere des trois sorties muettes du 04/09: `servis` et
  // `sansNiveau` avaient ete reindexes par combat, celui-ci est reste monotone.
  const enCombat = new Map(); // pid -> idCombat dont il a recu la liste

  function noterNiveau(idCombat, niveauMax) {
    if (niveaux.has(idCombat)) return;
    niveaux.set(idCombat, niveauMax);
    // Map garde l'ordre d'insertion: la premiere cle est la plus ancienne.
    while (niveaux.size > COMBATS_RETENUS) niveaux.delete(niveaux.keys().next().value);
  }

  // Tout ce qu'il faut pour equiper: savoir dans quel combat est ce client, et
  // connaitre le niveau de ce combat. Les deux arrivent dans un ordre qui
  // varie — mesure du 04/09, le `kae` du joueur precede celui du groupe d'une
  // milliseconde — donc on rappelle cette fonction chaque fois que l'un des
  // deux progresse, plutot que de parier sur l'ordre.
  // `signaler` n'est vrai que sur le chemin de `kmk`, et c'est une precaution
  // contre un bandeau rouge a chaque combat. Mesure du 04/09: le `kae` du
  // joueur precede celui du groupe d'une milliseconde, donc entre les deux le
  // niveau est legitimement inconnu. Se plaindre la serait crier au loup une
  // fois par combat. `kmk` retombe a chaque tour: un combat vraiment sans
  // niveau sera signale au tour suivant, une seconde plus tard.
  function tenter(pid, signaler = false) {
    const idCombat = combats.get(pid);
    if (idCombat === undefined) return;
    if (enCombat.get(pid) !== idCombat) return;
    // DEJA SERVI POUR CE COMBAT. Pas une fenetre de temps, l'identifiant du
    // combat lui-meme. `kmk` tombe six fois en trois millisecondes au depart
    // (mesure du 04/09) puis de nouveau a chaque tour.
    if (servis.get(pid) === idCombat) return;
    // UN ORDRE EST DEJA EN VOL. La confirmation revient en 34 ms et cinq `kmk`
    // tombent dans cet intervalle: sans cette garde, six ordres pour une pierre.
    if (attentes.has(pid)) return;

    const niveauMax = niveaux.get(idCombat);
    if (niveauMax === undefined) {
      // ON NE DEVINE PAS UN NIVEAU. Mais on ne se tait pas non plus: se taire
      // est ce qui a rendu le bug du 04/09 introuvable. Une fois par combat.
      if (signaler && sansNiveau.get(pid) !== idCombat) {
        sansNiveau.set(pid, idCombat);
        rendre(pid, { quoi: 'niveau-inconnu', idCombat });
      }
      return;
    }
    servis.set(pid, idCombat);
    const fait = essais.get(pid);
    essais.set(pid, {
      idCombat, n: (fait !== undefined && fait.idCombat === idCombat ? fait.n : 0) + 1,
    });
    equiperPour(pid, niveauMax);
  }

  function equiperPour(pid, niveauMax) {
    const verdict = choisir({
      niveauMax, piles: stocks.get(pid) || [], monterEnCalibre: monterEnCalibre(),
    });
    if (verdict.quoi !== 'equiper') {
      rendre(pid, { ...verdict, niveauMax });
      return;
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
      // UN SILENCE N'EST PLUS UNE FIN. `servis` verrouillait le personnage pour
      // tout le combat des le premier envoi: un ordre ignore le laissait sans
      // pierre jusqu'au bout, alors qu'il reste quinze secondes de preparation
      // et que `kmk` retombe a chaque tour. On rend la main, trois fois au plus.
      const fait = essais.get(pid);
      if (fait !== undefined && fait.n < ESSAIS_MAX && servis.get(pid) === fait.idCombat) {
        servis.delete(pid);
      }
    }, ms) : null;
    if (minuteur !== null && typeof minuteur.unref === 'function') minuteur.unref();
    attentes.set(pid, {
      uid: verdict.uid, gid: verdict.gid, minuteur, purge: verdict.purge || null,
    });
    // LE REPLI VOYAGE AVEC LE COMPTE RENDU, sinon le journal ecrirait « 9689
    // equipee » sur un groupe de niveau 120 sans que rien n'explique pourquoi
    // ce n'est pas la Grande. Absent quand la tranche exacte est partie.
    rendre(pid, verdict.repli === undefined
      ? { quoi: 'envoye', gid: verdict.gid, niveauMax }
      : { quoi: 'envoye', gid: verdict.gid, niveauMax, repli: verdict.repli });
  }

  function onTrame({ pid, dir, frame }) {
    if (frame === null || frame === undefined || dir !== 'in') return;

    // L'ECOUTE PERMANENTE TOURNE MEME ETEINTE. Elle ne coute que de la memoire,
    // et sans elle allumer l'interrupteur devant un combat n'aurait aucun effet
    // avant le prochain changement de carte.
    //
    // LA BANQUE EST HORS PERIMETRE, et c'est le bug du 05/09: des personnages
    // se retrouvaient NUS. Meme decision que le tableau des archimonstres
    // (src/pda-archi/collection.js), pour la meme raison, et il a fallu la
    // prendre deux fois parce que la chasse a ete concue la veille de la mesure.
    //
    // DEUX PORTES, ET IL FAUT LES DEUX. `iwb` d'abord: ouvrir le banquier
    // livrait 814 piles qui REMPLACAIENT tout ce qu'on savait de l'inventaire
    // (mesure, test/fixtures/hdv-iwb.hex) -- et aucune ne porte de rangement,
    // donc seul le type de trame les arrete. `ivx` ensuite: le bouton rond
    // « relire les inventaires » demande les rangements 2 et 3 A TOUS LES
    // CLIENTS d'un coup, et la reponse marque alors chaque pile.
    //
    // CE QUE COUTAIT UNE PILE DE BANQUE: `choisir` prend la plus grosse pile,
    // et on stocke ses pierres a la banque, pas dans ses poches. L'ordre
    // partait donc sur un uid qu'on ne peut pas equiper.
    if (frame.type === 'ivx') {
      const piles = lireStock(frame)
        .filter((p) => p.rangement === null || p.rangement === RANGEMENT_INVENTAIRE);
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
        purgerApresPose(pid, attente);
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
        purgerApresPose(pid, attente);
        rendre(pid, { quoi: 'equipe', gid: attente.gid });
      }
      return;
    }

    if (!allume) return;

    // L'ENTREE D'UN COMBATTANT DANS UN COMBAT, et elle porte deux choses.
    if (frame.type === 'kae') {
      const e = lireEntreeCombat(frame);
      if (e === null) return;

      // UN COMBATTANT NEGATIF EST LE GROUPE DE MONSTRES, et il n'est nomme que
      // chez celui qui attaque. C'est lui qui donne le niveau du combat.
      if (e.idActeur < 0) {
        const carte = cartes.get(pid);
        const groupe = carte === undefined ? undefined : carte.get(e.idActeur);
        // UN GROUPE INCONNU N'EQUIPE RIEN, et le dit. La liste des acteurs
        // arrive en meme temps que la carte; un groupe qui n'y est pas est un
        // trou dans ce qu'on sait, pas une invitation a deviner.
        if (groupe === undefined) {
          rendre(pid, { quoi: 'groupe-inconnu', idGroupe: e.idActeur });
          return;
        }
        noterNiveau(e.idCombat, groupe.niveauMax);
        // LE NIVEAU PROFITE A TOUT LE MONDE, pas seulement a l'attaquant: ceux
        // qui attendaient dans ce combat peuvent enfin etre servis.
        for (const [autre, id] of combats) if (id === e.idCombat) tenter(autre);
        return;
      }

      // UN COMBATTANT POSITIF EST UN JOUEUR, et peu importe lequel: si ce
      // client recoit la trame, c'est qu'il est dans ce combat.
      combats.set(pid, e.idCombat);
      tenter(pid);
      return;
    }

    // LA LISTE DES COMBATTANTS: ce client est REELLEMENT dans le combat, et
    // c'est seulement maintenant qu'il peut equiper. Meme critere que
    // src/abandon-combat.js pour reconnaitre un combat contre des monstres: au
    // moins un identifiant NEGATIF. `kmk` sert aussi a lister les acteurs
    // d'une carte, ou tout est positif.
    if (frame.type === TYPE_COMBATTANTS) {
      if (combattantsDe(frame) === null) return;
      // `kmk` tombe AVANT le `kae` du client puis retombe a chaque tour (mesure
      // du 04/09): le premier note un combat encore inconnu, ce qui ne sert a
      // rien et ne coute rien, et c'est celui d'apres qui sert le personnage.
      enCombat.set(pid, combats.get(pid));
      tenter(pid, true);
    }
  }

  return { onTrame, armer, estAllume: () => allume };
}

module.exports = { creerPdaArchi };
