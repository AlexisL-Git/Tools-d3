'use strict';
const { lireStock } = require('../hdv/trames');
const { choisir, POSITION_PIERRE } = require('./pierres');
const { trameEquiper, lirePosition, lireGroupeAttaque, lireGroupes } = require('./trames');

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
function creerChasse({ superviseur, actif = false, onCompteRendu = () => {} }) {
  // Ce que l'ecoute permanente retient, par client.
  const stocks = new Map();   // pid -> [pile]
  const cartes = new Map();   // pid -> Map(idGroupe -> { niveauMax, monstres })
  const attentes = new Map(); // pid -> { uid, gid }

  let allume = actif === true;

  // Eteindre OUBLIE les attentes: sinon une confirmation tardive conclurait au
  // rallumage suivant, sur un combat qui n'a plus rien a voir.
  function armer(valeur) {
    allume = valeur === true;
    if (!allume) attentes.clear();
  }

  const nomDe = (pid) => {
    const etat = superviseur.comptes.get(pid);
    return etat && etat.nom ? etat.nom : String(pid);
  };

  // LA CLE S'APPELLE `compte`, PAS `nom`: `choisir` rend deja un `nom`, celui
  // de la pierre qui manque, et l'etalement ci-dessous l'ecraserait.
  const rendre = (pid, rendu) => onCompteRendu({ pid, compte: nomDe(pid), ...rendu });

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

    const res = superviseur.emettre(pid, trameEquiper({
      uid: verdict.uid, qte: verdict.qte, position: POSITION_PIERRE,
    }));
    if (res === null || res === undefined || res.ok !== true) {
      rendre(pid, { quoi: 'echec', gid: verdict.gid, niveauMax: groupe.niveauMax });
      return;
    }
    attentes.set(pid, { uid: verdict.uid, gid: verdict.gid });
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
      if (allume && attente !== undefined && attente.uid === maj.uid
          && maj.pos === POSITION_PIERRE) {
        attentes.delete(pid);
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
