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

// Le serveur annonce a chaque client, a l'arrivee sur une carte, la liste des
// elements interactifs AVEC le numero d'action propre a ce client. Mesure le
// 19/08 par correlation: la valeur emise dans un clic (iwo.1) n'apparaissait
// dans tout le flux entrant qu'a un seul endroit, jss.11[].4.1.
//
//   jss.11[] = { 1: actif, 4: { 1: skillInstanceUid, 2: skillId },
//                5: elementId, 6: elementTypeId }
//
// C'est le tableau que le launcher de krm35 publie sous le nom
// interactiveElements, ou `ganv` vaut skillInstanceUid et `ganw` skillId.
const JSS_ELEMENTS = { type: 'jss', liste: 11, skills: 4, uid: 1, elementId: 5 };

const champ = (champs, no) => (champs || []).find((f) => f.no === no) || null;

class EtatCompte {
  constructor({ pid, port = null } = {}) {
    this.pid = pid;
    this.port = port;
    this.characterId = null;
    // Un compte exclu reste observe — on continue d'apprendre son
    // characterId et ses elements de carte — mais ne recoit plus les actions
    // du maitre. Reactiver l'exclusion ne demande donc aucun rattrapage.
    this.exclu = false;
    // Passe-tour automatique en combat. Independant de `exclu`: un compte peut
    // suivre le maitre sans passer ses tours, ou l'inverse.
    this.passeTour = false;
    // Acceptation automatique des invitations de groupe. Independant de
    // `exclu` et de `passeTour`.
    this.accepteInvitation = false;
    // Suppression des animations de deplacement en combat. Independant des
    // trois autres interrupteurs.
    this.noAnim = false;
    // Acceptation automatique de l'echange propose par un autre de nos
    // clients. Independant de `exclu`, `passeTour` et `accepteInvitation`.
    this.accepteEchange = false;
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

    if (frame.type === KVW_CHARACTER_ID.type) {
      const c = champ(frame.payload, KVW_CHARACTER_ID.champ);
      if (c && typeof c.value === 'bigint') this.characterId = c.value;
      return;
    }

    if (frame.type === JSS_ELEMENTS.type) this._apprendreElements(frame.payload);
  }

  _apprendreElements(payload) {
    for (const entree of payload || []) {
      if (entree.no !== JSS_ELEMENTS.liste || entree.kind !== 'message') continue;
      const id = champ(entree.value, JSS_ELEMENTS.elementId);
      const skills = champ(entree.value, JSS_ELEMENTS.skills);
      if (!id || !skills || skills.kind !== 'message') continue;
      const uid = champ(skills.value, JSS_ELEMENTS.uid);
      if (uid && typeof uid.value === 'bigint') this.apprendreSkill(id.value, uid.value);
    }
  }

  apprendreSkill(elementId, skillInstanceUid) {
    this.skillParElement.set(String(elementId), skillInstanceUid);
  }

  skillPour(elementId) {
    const v = this.skillParElement.get(String(elementId));
    return v === undefined ? null : v;
  }

  // Ce qu'il faudrait substituer pour rejouer ce message chez ce compte, et ce
  // qui manque encore pour le faire. Renvoyer explicitement les manques evite
  // d'emettre une trame a moitie traduite.
  // `contexte` porte ce que le message du maitre designe: pour un clic sur un
  // element interactif, l'elementId — le meme pour tous les joueurs — a partir
  // duquel chaque compte retrouve SON propre numero d'action.
  peutRejouer(typeMessage, contexte = {}) {
    if (!needsRewrite(typeMessage)) return { possible: true, manque: [] };
    const manque = [];
    for (const nom of accountFields(typeMessage)) {
      if (nom === 'fsor' && this.characterId === null) manque.push('characterId');
      if (nom === 'skillInstanceUid') {
        if (contexte.elementId === undefined) manque.push('elementId du maître');
        else if (this.skillPour(contexte.elementId) === null) {
          manque.push(`skillInstanceUid pour l'élément ${contexte.elementId}`);
        }
      }
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
    return this.tous.filter((e) => e.pid !== pidMaitre && !e.exclu);
  }
}

module.exports = { EtatCompte, Comptes, KVW_CHARACTER_ID };
