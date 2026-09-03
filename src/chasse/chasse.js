'use strict';
const { lireStock, lirePile, lirePileMaj, lirePileDisparue } = require('../hdv/trames');
const { choisir, POSITION_PIERRE } = require('./pierres');
const { trameEquiper, lirePosition, lireGroupeAttaque, lireGroupes } = require('./trames');

// Au-dela, on considere que l'ordre s'est perdu. Le serveur a repondu en 40 ms
// a la mesure; trois secondes sont deux ordres de grandeur au-dessus, et il
// reste quinze secondes de preparation pour reagir.
const DELAI_REPONSE_MS = 3000;

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

  function entrerEnCombat(pid, idGroupe) {
    const carte = cartes.get(pid);
    const groupe = carte === undefined ? undefined : carte.get(idGroupe);
    // UN GROUPE INCONNU N'EQUIPE RIEN. La liste des acteurs arrive a l'arrivee
    // sur la carte; un groupe qui n'y est pas est un trou dans ce qu'on sait,
    // pas une invitation a deviner.
    if (groupe === undefined) { rendre(pid, { quoi: 'groupe-inconnu', idGroupe }); return; }

    const verdict = choisir({ niveauMax: groupe.niveauMax, piles: stocks.get(pid) || [] });
    if (verdict.quoi !== 'equiper') {
      rendre(pid, { ...verdict, niveauMax: groupe.niveauMax });
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
      rendre(pid, { quoi: 'echec', gid: verdict.gid, niveauMax: groupe.niveauMax });
      return;
    }
    // UN ORDRE SANS REPONSE DOIT SE VOIR. C'est le defaut qui a rendu la
    // seance du 03/09 au soir incomprehensible: OMNI a dit « envoye », le
    // serveur a ignore l'ordre sans un mot, et rien n'a jamais signale que la
    // pierre n'etait pas equipee. Le silence est desormais un compte rendu.
    const ms = delaiReponseMs();
    const minuteur = ms > 0 ? setTimeout(() => {
      attentes.delete(pid);
      rendre(pid, { quoi: 'sans-reponse', gid: verdict.gid, niveauMax: groupe.niveauMax });
    }, ms) : null;
    if (minuteur !== null && typeof minuteur.unref === 'function') minuteur.unref();
    attentes.set(pid, { uid: verdict.uid, gid: verdict.gid, minuteur });
    rendre(pid, { quoi: 'envoye', gid: verdict.gid, niveauMax: groupe.niveauMax });
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
      const piles = stocks.get(pid);
      if (piles === undefined) return;
      // Meme forme qu'une pile d'ivx, au champ 3 de la trame.
      const el = (frame.payload || []).find((f) => f.no === 3);
      const pile = el === undefined ? null : lirePile(el);
      if (pile !== null && !piles.some((p) => p.uid === pile.uid)) piles.push(pile);
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
      if (idGroupe !== null) entrerEnCombat(pid, idGroupe);
    }
  }

  return { onTrame, armer, estAllume: () => allume };
}

module.exports = { creerChasse };
