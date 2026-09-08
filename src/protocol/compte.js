'use strict';

const { needsRewrite, accountFields } = require('./omni');

// Etat appris d'UN compte, a partir de son seul trafic.
//
// Le OMNI doit fonctionner avec 1 a 8 clients simultanes. Rejouer
// l'action du maitre chez les autres suppose de connaitre, pour chacun, les
// valeurs qui lui sont propres — celles que src/protocol/omni.js classe
// en nature 'compte'. Aucune ne peut etre devinee: chacune doit etre relevee
// dans le flux du client concerne.
//
// Ce qui est acquis:
//   characterId — la requete sortante le porte en champ 1 des la connexion.
//   Mesure le 19/08 sur notre propre chaine (665809125670), et confirmee par
//   recoupement avec le champ `fsor` de HavenBagEnterRequest releve
//   independamment le meme jour sur le produit de krm35.
//
//   Le message s'appelait `kvw`; il s'appelle `kth` depuis le patch 3.6.11.12
//   du 08/09, qui a renomme tout le protocole. Le champ, lui, n'a pas bouge.
//   Ce nom perime a coute trois fonctions d'un coup — echange, garde-combat,
//   abandon-combat — toutes eteintes en silence faute de characterId.
//
// Ce qui manque:
//   skillInstanceUid — propre au client, il varie d'un compte a l'autre pour
//   un meme elementId. Le launcher de krm35 le diffuse dans un tableau
//   `interactiveElements` dont les entrees ont la forme
//   { ganv, ganw, skillId, skillInstanceUid }, ou `ganv` vaut skillInstanceUid
//   et `ganw` skillId. Le message entrant qui le porte n'a pas encore ete
//   identifie: c'est la prochaine mesure a faire.

const KVW_CHARACTER_ID = { type: 'kth', champ: 1 };

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
//
// REMESURE LE 08/09, patch 3.6.11.12. Le message s'appelle desormais `jpo`, et
// TOUS les numeros ont bouge — la liste comme les champs de chaque entree:
//
//   jpo.8[] = { 2: elementTypeId, 3: actif, 4: elementId,
//               5: { 1: ?, 2: skillInstanceUid, 3: skillId } }
//
// MEME METHODE QU'AU 19/08, LA CORRELATION: sur la carte de l'hotel de vente
// (journal-hdv.log a 18875 ms), l'element 515300 est annonce avec
// 5{ 1=51 2=6191 3=355 } — et 856 ms plus tard le clic part en
// `iva { 1 = 515300  5 = 6191 }`. Refait sur l'element 540848, annonce a 684 et
// clique a 684. C'est le champ 2, et lui seul, qui se retrouve dans le clic.
//
// LE CHAMP 5 N'EST PAS LE SEUL A PORTER DES COMPETENCES: certaines entrees
// portent un champ 6 de meme forme (l'element 498565 de la meme carte). Les
// deux clics mesures ont tire du champ 5; `champ()` prend la premiere
// occurrence, donc le champ 5 quand il existe. UN ELEMENT DONT LE CHAMP 5
// MANQUE reste sans uid, et son rejeu est refuse plutot que devine — c'est le
// comportement voulu tant qu'aucune mesure ne dit ce que porte le champ 6.
//
// PLUSIEURS COMPETENCES PAR ELEMENT existent aussi (540848 en annonce cinq).
// Les deux mesures ont cliqué la PREMIERE; departager par skillId demanderait
// que le clic le porte, et il ne le porte pas.
const JPO_ELEMENTS = { type: 'jpo', liste: 8, skills: 5, uid: 2, elementId: 4 };

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

    if (frame.type === JPO_ELEMENTS.type) this._apprendreElements(frame.payload);
  }

  _apprendreElements(payload) {
    for (const entree of payload || []) {
      if (entree.no !== JPO_ELEMENTS.liste || entree.kind !== 'message') continue;
      const id = champ(entree.value, JPO_ELEMENTS.elementId);
      const skills = champ(entree.value, JPO_ELEMENTS.skills);
      if (!id || !skills || skills.kind !== 'message') continue;
      const uid = champ(skills.value, JPO_ELEMENTS.uid);
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

module.exports = { EtatCompte, Comptes, KVW_CHARACTER_ID, JPO_ELEMENTS };
