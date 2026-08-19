'use strict';

const { needsRewrite, accountFields } = require('./replicate');

// Etat appris d'UN compte, a partir de son seul trafic.
//
// Le Replicate doit fonctionner avec 1 a 8 clients simultanes. Rejouer
// l'action du maitre chez les autres suppose de connaitre, pour chacun, les
// valeurs qui lui sont propres — celles que src/protocol/replicate.js classe
// en nature 'compte'. Aucune ne peut etre devinee: chacune doit etre relevee
// dans le flux du client concerne.
//
// Ce qui est acquis:
//   characterId — la requete sortante `kvw` le porte en champ 1 des la
//   connexion. Mesure le 19/08 sur notre propre chaine (665809125670), et
//   confirmee par recoupement avec le champ `fsor` de HavenBagEnterRequest
//   releve independamment le meme jour sur le produit de krm35.
//
// Ce qui manque:
//   skillInstanceUid — propre au client, il varie d'un compte a l'autre pour
//   un meme elementId. Le launcher de krm35 le diffuse dans un tableau
//   `interactiveElements` dont les entrees ont la forme
//   { ganv, ganw, skillId, skillInstanceUid }, ou `ganv` vaut skillInstanceUid
//   et `ganw` skillId. Le message entrant qui le porte n'a pas encore ete
//   identifie: c'est la prochaine mesure a faire.

const KVW_CHARACTER_ID = { type: 'kvw', champ: 1 };

class EtatCompte {
  constructor({ pid, port = null } = {}) {
    this.pid = pid;
    this.port = port;
    this.characterId = null;
    // elementId -> skillInstanceUid, propre a ce compte.
    this.skillParElement = new Map();
    this.trames = 0;
  }

  get pret() {
    return this.characterId !== null;
  }

  // Une trame decodee par src/codec/rawProto.js, dans un sens ou l'autre.
  observer(frame) {
    if (frame === null) return;
    this.trames++;
    if (frame.kind !== 'request' || frame.type !== KVW_CHARACTER_ID.type) return;
    const champ = (frame.payload || []).find((f) => f.no === KVW_CHARACTER_ID.champ);
    if (champ && typeof champ.value === 'bigint') this.characterId = champ.value;
  }

  apprendreSkill(elementId, skillInstanceUid) {
    this.skillParElement.set(String(elementId), skillInstanceUid);
  }

  // Ce qu'il faudrait substituer pour rejouer ce message chez ce compte, et ce
  // qui manque encore pour le faire. Renvoyer explicitement les manques evite
  // d'emettre une trame a moitie traduite.
  peutRejouer(typeMessage) {
    if (!needsRewrite(typeMessage)) return { possible: true, manque: [] };
    const manque = [];
    for (const champ of accountFields(typeMessage)) {
      if (champ === 'fsor' && this.characterId === null) manque.push('characterId');
      if (champ === 'skillInstanceUid') manque.push('skillInstanceUid');
    }
    return { possible: manque.length === 0, manque };
  }
}

// Un client = un process, un port de proxy, un etat. La ligne CONNECT ne dit
// pas quel compte se connecte: c'est le port d'ecoute qui les distingue, d'ou
// un proxy par client plutot qu'un proxy partage.
class Comptes {
  constructor() {
    this._parPid = new Map();
  }

  ajouter({ pid, port }) {
    const e = new EtatCompte({ pid, port });
    this._parPid.set(pid, e);
    return e;
  }

  get(pid) {
    return this._parPid.get(pid) || null;
  }

  retirer(pid) {
    return this._parPid.delete(pid);
  }

  get tous() {
    return [...this._parPid.values()];
  }

  // Le maitre est le compte a l'origine de l'action; tous les autres la
  // rejouent.
  esclaves(pidMaitre) {
    return this.tous.filter((e) => e.pid !== pidMaitre);
  }
}

module.exports = { EtatCompte, Comptes, KVW_CHARACTER_ID };
