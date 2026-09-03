'use strict';

// Table des messages effectivement repliques, et nature de chacun de leurs
// champs.
//
// Etablie le 19/08/2026 en ecoutant le canal de coordination du produit de
// krm35 pendant 20 minutes de jeu reel (5 Mo). Le launcher y publie, pour
// chaque action, le nom obfusque, le nom reel et les champs decodes: la table
// n'a pas ete deduite, elle a ete lue.
//
// PERIMETRE. Huit types a l'origine, et ce total n'avait pas bouge de la 6e a
// la 20e minute de la recolte. OMNI ne duplique pas le combat, les metiers ni
// l'inventaire: il duplique les interactions. La banque elle-meme ne produit
// aucun message propre — l'ouvrir revient a parler a un PNJ, donc au triplet
// NpcGenericActionRequest / NpcDialogReplyRequest / DialogLeaveRequest.
//
// DEUX EXCEPTIONS, mesurees et ajoutees a la demande de l'utilisateur.
//
// La premiere, le 29/08:
// `kea`, l'achat chez un marchand PNJ. Elle ne remet pas en cause la regle —
// l'achat A L'HOTEL DE VENTE (`kbm`) reste dehors, volontairement, et le
// commentaire de `kea` explique pourquoi cette absence est le mecanisme.
//
// La seconde, le 03/09: `ido`, le ramassage d'un objet de quete. Meme cas de
// figure — une interaction que le clic du maitre ne produisait que chez lui.
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
      // 3 sur les 21 occurrences de la recolte du 19/08 — mais la valeur 1 a
      // ete mesuree le 29/08: c'est « acheter/vendre » la ou 3 est « parler ».
      // Le champ decrit le monde dans les deux cas, il se recopie tel quel.
      npcActionId: { nature: 'monde', sur: 'mesure', note: '3 = parler, 1 = acheter/vendre (mesure 29/08)' },
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
  // L'ACHAT CHEZ UN MARCHAND PNJ — celui dont le dialogue offre « parler » ou
  // « acheter/vendre ». Mesure du 29/08, deux sessions (17:41 et 19:58), memes
  // deux clients, meme marchand (npcId -20000, carte 192413696):
  //
  //     --> iov { 1=1 2=192413696 3=-20000 }   ouvre la boutique
  //         rejeu iov ecrit (+272 ms)          elle s'ouvre AUSSI chez la mule
  //     --> kea { 1=6765 2=1 }                 l'achat d'un Lailait a 4 kamas
  //     <-- lqn { 2=252 4=6765 4=386757953 }   l'objet entre dans le sac
  //     <-- ivf { 1=3941470 }                  3941474 -> 3941470, soit -4
  //
  // LE CHAMP 1 EST UN TYPE D'OBJET, PAS UN EXEMPLAIRE. Deux preuves: il vaut
  // 6765 dans les DEUX sessions pour le meme article, et le serveur le renvoie
  // tel quel dans sa confirmation `lqn`, a cote de 386757953 — celui-la est
  // l'exemplaire cree dans le sac du maitre, et il n'apparait QUE dans la
  // reponse. La requete ne porte donc rien qui appartienne au maitre: ni
  // identifiant de personnage, ni uid de session. D'ou verbatim.
  //
  // LA CONDITION QUE LA TRAME NE PORTE PAS — celle qui a tue `jqk` — est ici
  // DEJA REMPLIE: le serveur exige que la boutique soit ouverte, et elle l'est
  // chez la mule, prouve par le `kbd` qu'elle recoit 30 ms apres le rejeu du
  // `iov`. C'est ce qui distingue ce cas de `jqk` et de `jrh`.
  //
  // CE QUI N'EST PAS ICI COMPTE AUTANT: `kbm`, l'achat a l'HOTEL DE VENTE,
  // mesure dans la meme session (`kbm { 1=1116 2=67 3=1 }`, -67 kamas pour une
  // Graine de Sesame). L'utilisateur veut acheter au marchand et JAMAIS a
  // l'HDV. Comme l'HDV a son propre type, il suffit de ne pas le repertorier:
  // un type hors table n'est jamais rejoue. La contrainte tient a une ABSENCE,
  // pas a une regle. Ne pas ajouter `kbm` sans le lui demander.
  //
  // LE NOM EST LE NOTRE. Les neuf premieres entrees tenaient le leur du canal
  // de krm35; ce type-la n'y figurait pas, il a ete identifie par la mesure.
  // Les noms de champs aussi sont de nous, d'ou `sur: 'mesure'` sans nom reel.
  kea: {
    name: 'AchatMarchandRequest',
    fields: {
      objetType: { no: 1, nature: 'monde', sur: 'mesure', note: 'type d article (6765 = Lailait), identique dans les deux sessions et renvoye par lqn' },
      quantite: { no: 2, nature: 'monde', sur: 'mesure', note: 'valait 1 sur les deux achats mesures' },
    },
    verbatim: true,
  },
  // MESURE du 02/09 (journal-dev.log, 23h41 locales, deux clients sur la meme
  // carte). L'utilisateur clique l'objet de quete: le maitre le ramasse, la
  // mule le regarde. C'est le defaut rapporte le 03/09.
  //
  //   MAITRE  240286 ms  --> ido { 1=1633 }        LE CLIC SUR L'OBJET
  //                      --> kla {  }              meme milliseconde: le dialogue se ferme
  //                      <-- lqn { 2=54 4=1633 }   l'objet entre dans le sac
  //                      <-- ief { 1=1633 }        la quete avance
  //           240345 ms      rejeu kla ecrit       SEUL kla partait: ido n'etait pas ici
  //   MULE    242512 ms  --> ido { 1=1633 }        clic A LA MAIN, 2,2 s plus tard
  //                      <-- lqn { 2=54 4=1633 }   MEMES reponses, meme objet
  //                      <-- ief { 1=1633 }
  //
  // LE CHAMP 1 EST UN IDENTIFIANT D'OBJET, PAS UN EXEMPLAIRE, et il ne vient
  // pas du maitre: 1633 chez les deux personnages pour le meme objet, et le
  // serveur le renvoie tel quel dans `lqn.4`. Meme raisonnement que `kea`, et
  // meme conclusion: verbatim.
  //
  // LA CONDITION QUE LA TRAME NE PORTE PAS — celle qui a tue `jqk` — est ici
  // REMPLIE PAR LA MULE ELLE-MEME, et la mesure le prouve: son `ido` manuel a
  // ete accepte 2,2 s apres celui du maitre, sans autre clic que celui-la,
  // apres son propre rejeu du `iwo` qui ouvre l'interaction. Une mule qui n'a
  // pas la quete a la bonne etape se fait ignorer par le serveur: aucun degat
  // mesure, contrairement a `jqk`.
  //
  // POURQUOI `ido` N'EST PAS UN TYPE SENSIBLE (src/garde-combat.js) alors qu'il
  // ressemble a une interaction de quete: le maitre emet `ido` et `kla` dans LA
  // MEME milliseconde. Un plancher de 250 ms sur `ido` seul ferait arriver la
  // fermeture du dialogue AVANT le ramassage chez la mule — l'ordre des deux
  // rejeux s'inverserait. Le garde protegerait d'un combat non mesure au prix
  // du defaut qu'on corrige. Si un ramassage se met un jour a lancer un
  // combat, c'est le couple (ido, kla) qu'il faudra retarder ensemble.
  //
  // LE NOM EST LE NOTRE: ce type ne figurait pas dans le canal de krm35.
  ido: {
    name: 'ObjetQueteRamasseRequest',
    fields: {
      objetGid: { no: 1, nature: 'monde', sur: 'mesure', note: 'identifiant d objet (1633 = l objet de quete mesure), identique chez le maitre et chez la mule, renvoye par lqn.4' },
    },
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
