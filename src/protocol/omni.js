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
// OMNI ne duplique pas le combat, les metiers, l'inventaire ni les
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
  // NE SE REJOUE PAS. Mesure du 28/08 (journal de 20:39 UTC, trois clients,
  // suivi de groupe du jeu actif): sur 32 injections chez des mules, ZERO n a
  // produit une arrivee (`jru`); 26 des 30 refus `jqt` du serveur suivent une
  // injection de 29 ms medianes — un aller-retour serveur. Aucun des 43 `jqk`
  // emis par les clients EUX-MEMES n a ete refuse.
  //
  // La requete n est valide que si le personnage se tient DEJA sur la cellule
  // de sortie: le maitre y a marche, la mule est ailleurs sur la carte. Rien
  // dans la trame ne peut corriger cela — ce n est pas un champ a substituer,
  // c est une POSITION a occuper.
  //
  // Et le refus coute cher: il fait annuler au client de la mule le
  // deplacement en cours. Les 30 refus mesures ont tous frappe une mule en
  // train de marcher, 26 ont ete suivis d une nouvelle demande de marche dans
  // la seconde et demie. Tant que le maitre enchaine les cartes, chacun de ses
  // changements re-annule la marche des mules, qui bouclent sur place. Une
  // mule n echappe qu a la faveur d une pause du maitre (mesuree: 4,7 s).
  //
  // L entree reste ici: elle documente une mesure reelle, et c est elle qui
  // porte la raison du refus. Le deplacement de carte en carte est le travail
  // du suivi de groupe du jeu, pas le notre.
  jqk: {
    name: 'MapChangeRequest',
    fields: {
      mapId: { nature: 'monde', sur: 'mesure' },
      autoPilot: { nature: 'monde', sur: 'mesure', note: 'drapeau, parfois absent' },
    },
    verbatim: true,
    rejouable: false,
  },
  // NE SE REJOUE PAS NON PLUS. Mesure sur les deux sessions du 28/08, avant et
  // apres le retrait de `jqk`: 78 injections chez des mules, 66 SANS LA
  // MOINDRE REPONSE. Les 12 reponses `jss` observees portaient la carte ou la
  // mule se tenait deja et coincidaient avec sa propre demande: ce sont ses
  // reponses a elle. Aucune, jamais, pour la carte du maitre.
  //
  // Le serveur ne repond a une demande d infos que pour la carte ou se trouve
  // le personnage — meme condition de POSITION que `jqk`, en plus large.
  //
  // Aucun degat mesure ici, contrairement a `jqk`: le serveur ignore, point.
  // Le retrait ne repare donc rien, il cesse d ecrire pour rien sur la socket
  // d un client de jeu.
  jrh: {
    name: 'MapInformationRequest',
    fields: { mapId: { nature: 'monde', sur: 'mesure' } },
    verbatim: true,
    rejouable: false,
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
      // Champ 2, mesure: la trame injectee chez l'esclave portait
      // 677057659174 la ou le maitre valait 665809125670 — l'identifiant de
      // personnage de chacun, celui que la requete kvw annonce a la connexion.
      fsor: { no: 2, nature: 'compte', sur: 'mesure', note: 'identifiant du personnage; egal au champ id du contexte, et a kvw.1' },
    },
    verbatim: false,
  },
  iwo: {
    name: 'InteractiveUseRequest',
    fields: {
      skillInstanceUid: { no: 1, nature: 'compte', sur: 'mesure', note: 'differait entre maitre et esclave sur une meme action' },
      elementId: { no: 2, nature: 'monde', sur: 'mesure', note: 'identique entre maitre et esclave: le meme noeud sur la carte' },
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

// Repertorie ne veut pas dire rejouable. Un message peut etre parfaitement
// decode, sans champ propre au compte, et rester INJOUABLE chez une mule
// parce que le serveur en verifie une condition que la trame ne porte pas —
// la position du personnage, par exemple. `rejouable: false` porte ce cas,
// avec sa mesure. Absent, il vaut vrai: un type repertorie se rejoue.
//
// null pour un type hors table, comme needsRewrite: ne pas connaitre et
// refuser sont deux reponses differentes.
function estRejouable(key) {
  const m = MESSAGES[key];
  if (!m) return null;
  return m.rejouable !== false;
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

module.exports = { MESSAGES, lookup, lookupByName, needsRewrite, accountFields, estRejouable };
