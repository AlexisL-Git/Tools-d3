'use strict';

// Table des messages effectivement repliques, et nature de chacun de leurs
// champs.
//
// Etablie le 19/08/2026 en ecoutant le canal de coordination du produit de
// krm35 pendant 20 minutes de jeu reel (5 Mo). Le launcher y publie, pour
// chaque action, le nom obfusque, le nom reel et les champs decodes: la table
// n'a pas ete deduite, elle a ete lue.
//
// PERIMETRE. Huit types, et ce total n'a pas bouge de la 6e a la 20e minute.
// Replicate ne duplique pas le combat, les metiers, l'inventaire ni les
// echanges: il duplique les interactions. La banque elle-meme ne produit aucun
// message propre — l'ouvrir revient a parler a un PNJ, donc au triplet
// NpcGenericActionRequest / NpcDialogReplyRequest / DialogLeaveRequest.
//
// NATURE DES CHAMPS. Rejouer une action sur un second compte suppose de savoir
// quoi recopier et quoi reconstruire:
//
//   'monde'  — decrit une chose partagee par tous les joueurs (une carte, un
//              PNJ, un noeud de ressource, une reponse dans un arbre de
//              dialogue). Se recopie tel quel.
//   'compte' — propre au client emetteur. Doit etre remplace par l'equivalent
//              de l'esclave, sinon le serveur rejette ou agit sur le mauvais
//              objet.
//
// Le champ `sur` distingue ce qui a ete mesure de ce qui est infere.

const MESSAGES = {
  hjc: {
    name: 'TeleportRequest',
    fields: {
      destinationType: { nature: 'monde', sur: 'mesure', note: 'enumeration, encore obfusquee ("HIK_ECDQ")' },
      destinationMapId: { nature: 'monde', sur: 'mesure' },
    },
    // Trame relevee identique octet pour octet chez le maitre et chez
    // l'esclave: aucune substitution.
    verbatim: true,
  },
  jqk: {
    name: 'MapChangeRequest',
    fields: {
      mapId: { nature: 'monde', sur: 'mesure' },
      autoPilot: { nature: 'monde', sur: 'mesure', note: 'drapeau, parfois absent' },
    },
    verbatim: true,
  },
  jrh: {
    name: 'MapInformationRequest',
    fields: { mapId: { nature: 'monde', sur: 'mesure' } },
    verbatim: true,
  },
  iov: {
    name: 'NpcGenericActionRequest',
    fields: {
      npcActionId: { nature: 'monde', sur: 'mesure', note: 'toujours 3 sur 21 occurrences' },
      npcMapId: { nature: 'monde', sur: 'mesure', note: 'suit toujours le mapId du contexte' },
      npcId: { nature: 'monde', sur: 'mesure', note: 'instance de PNJ sur la carte: -20000, -20001…' },
    },
    verbatim: true,
  },
  ioy: {
    name: 'NpcDialogReplyRequest',
    fields: {
      fqmg: { nature: 'monde', sur: 'infere', note: 'identifiant de reponse dans l arbre de dialogue; nom reel inconnu, krm35 ne l a pas non plus' },
    },
    verbatim: true,
  },
  kla: {
    name: 'DialogLeaveRequest',
    fields: {},
    verbatim: true,
  },
  // Releve lors de la premiere capture courte, absent de la recolte de 20 min
  // faute de donjon visite. Sans champ observe, donc rejouable tel quel.
  // L'ENTREE en donjon n'a pas ete observee: selon les donjons elle passe par
  // un PNJ (deja couvert) ou par un element interactif, auquel cas elle
  // retomberait sur iwo et sa substitution de skillInstanceUid.
  kjw: {
    name: 'DungeonExitRequest',
    fields: {},
    verbatim: true,
  },
  jbn: {
    name: 'HavenBagEnterRequest',
    fields: {
      // fsor vaut exactement le champ `id` que le launcher joint au message de
      // coordination, c'est-a-dire l'identifiant du personnage emetteur.
      fsor: { nature: 'compte', sur: 'infere', note: 'identifiant du personnage; egal au champ id du contexte' },
    },
    verbatim: false,
  },
  iwo: {
    name: 'InteractiveUseRequest',
    fields: {
      skillInstanceUid: { nature: 'compte', sur: 'mesure', note: 'differait entre maitre et esclave sur une meme action' },
      elementId: { nature: 'monde', sur: 'mesure', note: 'identique entre maitre et esclave: le meme noeud sur la carte' },
    },
    verbatim: false,
  },
};

const byName = new Map(Object.entries(MESSAGES).map(([k, v]) => [v.name, { key: k, ...v }]));

function lookup(key) {
  return MESSAGES[key] || null;
}

function lookupByName(name) {
  return byName.get(name) || null;
}

// Les messages dont tous les champs decrivent le monde peuvent etre rejoues
// octet pour octet; les autres doivent etre reconstruits avec l'etat de
// l'esclave.
function needsRewrite(key) {
  const m = MESSAGES[key];
  if (!m) return null;
  return Object.values(m.fields).some((f) => f.nature === 'compte');
}

function accountFields(key) {
  const m = MESSAGES[key];
  if (!m) return null;
  return Object.entries(m.fields).filter(([, f]) => f.nature === 'compte').map(([n]) => n);
}

module.exports = { MESSAGES, lookup, lookupByName, needsRewrite, accountFields };
