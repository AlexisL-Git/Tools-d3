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
  //
  // REMESURE LE 08/09 AU SOIR: le nom devient `hiu`, et la mesure donne enfin
  // les NUMEROS DE CHAMP, que personne n'avait releves — ce message n'etant
  // jamais reecrit, nul n'en avait eu besoin.
  //
  //   41325 ms  iva { 1=540330 5=20506 }   le clic sur le zaap
  //   42467 ms  hiu { 3=191105026 }        la destination choisie
  //   35771 ms  hiu { 1=5 3=84806401 }     un voyage, avec son type
  //
  // LE CHAMP 1 EST ABSENT QUAND IL VAUT ZERO, et c'est la regle protobuf, pas
  // une variante de message: la sortie d'un zaap ne porte que la carte, un
  // voyage lance au ctrl-clic porte en plus le type 5.
  hiu: {
    name: 'TeleportRequest',
    fields: {
      destinationType: { no: 1, nature: 'monde', sur: 'mesure', note: 'enumeration; 5 sur un voyage, absent (donc 0) depuis un zaap' },
      destinationMapId: { no: 3, nature: 'monde', sur: 'mesure' },
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
  //
  // REMESURE LE 08/09: le nom devient `jpp`, la STRUCTURE ne bouge pas. Le
  // drapeau « parfois absent » l'est encore — journal-combat.log a 62366 ms
  // porte un `jpp { 1 = 73401091 }` sans champ 2. La mesure du 28/08 ci-dessus
  // tient telle quelle: elle porte sur une condition de POSITION, que ni un
  // nom ni un numero de champ ne changent.
  jpp: {
    name: 'MapChangeRequest',
    fields: {
      mapId: { no: 1, nature: 'monde', sur: 'mesure' },
      autoPilot: { no: 2, nature: 'monde', sur: 'mesure', note: 'drapeau, parfois absent' },
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
    perime: true,
    fields: { mapId: { nature: 'monde', sur: 'mesure' } },
    verbatim: true,
    rejouable: false,
  },
  //
  // REMESURE LE 08/09 AU SOIR: le nom devient `imp`, et LES TROIS CHAMPS ONT
  // CHANGE DE NUMERO — la carte passe en 1, l'action en 2, le PNJ reste en 3.
  //
  //   58050 ms  imp { 1=101450251 2=3  3=-20001 }   parler au PNJ de l'Almanax
  //  219435 ms  imp { 1=101451273 2=11 3=-20001 }   acheter chez un marchand
  //  244673 ms  imp { 1=120063489 2=3  3=-20000 }   parler au PNJ d'un donjon
  //
  // CE QUI A LEVE UN DOUTE SERIEUX. Le matin meme, ce message avait ete ECARTE:
  // on ne l'avait vu que sur la carte d'un hotel de vente, ou ses actions 5 et
  // 6 pouvaient etre « vendre / acheter » a l'HDV plutot qu'un choix chez un
  // PNJ, et le repertorier a tort aurait fait ouvrir l'HDV aux mules. La
  // session du soir tranche: l'ACTION 3 chez deux PNJ ordinaires, et 3 etait
  // deja « parler » dans la mesure du 29/08, avant le patch. Un seul message
  // sert les deux cas.
  //
  // LES NUMEROS D'ACTION, EUX, ONT BOUGE: 3 reste « parler », mais l'achat au
  // marchand vaut 11 la ou il valait 1, et l'HDV repond a 5 et 6. Le champ
  // decrit le monde dans tous les cas, il se recopie tel quel.
  imp: {
    name: 'NpcGenericActionRequest',
    fields: {
      npcActionId: { no: 2, nature: 'monde', sur: 'mesure', note: '3 = parler (inchange depuis le 29/08), 11 = acheter au marchand, 5 et 6 a l HDV' },
      npcMapId: { no: 1, nature: 'monde', sur: 'mesure', note: 'suit toujours le mapId du contexte' },
      npcId: { no: 3, nature: 'monde', sur: 'mesure', note: 'instance de PNJ sur la carte: -20000, -20001…' },
    },
    verbatim: true,
  },
  // REMESURE LE 08/09 AU SOIR: `inh`, meme forme, un champ unique. Onze
  // reponses relevees entre 59279 et 193983 ms, sur trois dialogues de quete —
  // 13557, 19015, 19184, 19182, puis 19189 a 19185, puis 13564 et 13565. Meme
  // ordre de grandeur que le 25088 mesure le 02/09 avant le patch.
  inh: {
    name: 'NpcDialogReplyRequest',
    fields: {
      fqmg: { no: 1, nature: 'monde', sur: 'mesure', note: 'identifiant de reponse dans l arbre de dialogue; nom reel inconnu, krm35 ne l a pas non plus' },
    },
    verbatim: true,
  },
  // REMESURE LE 08/09 AU SOIR: `kiy`, toujours sans un champ.
  //
  // CE QUE LA MESURE DIT EXACTEMENT, ET C'EST PLUS ETROIT QU'AVANT. Les trois
  // `kiy` de la session suivent la fermeture d'un ECHANGE: l'hotel de vente a
  // 129255 ms, la boutique du marchand a 230048 et 230049 ms (deux fois de
  // suite, ce que le rejeu reproduira sans dommage — une trame vide chez une
  // mule qui n'a rien d'ouvert est ignoree).
  //
  // UN DIALOGUE QUI S'ACHEVE NE PRODUIT AUCUNE REQUETE: le serveur le ferme
  // lui-meme, par un `kja { 1 = 1 }` entrant (61976 ms, la fin du dialogue de
  // l'Almanax). Le client n'emet donc rien dans ce cas, ni avant ni apres le
  // patch — l'ancienne mesure du 02/09 voyait `kla` accompagner un RAMASSAGE,
  // pas la fin d'un dialogue.
  kiy: {
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
  //
  // REMESURE LE 08/09 AU SOIR: `kaa`, et LA FORME N'A PAS BOUGE.
  //
  //   219435 ms  imp { 1=101451273 2=11 3=-20001 }  ouvre la boutique
  //   229028 ms  kaa { 1=13365 2=1 }                L'ACHAT
  //   229060 ms  <- imo { 1=-1 2=13365 3=-1 }       le serveur renvoie le type
  //   229063 ms  <- isa { ...5{ 5=13365 } }         l'objet entre dans le sac
  //   229065 ms  <- itt { 2=4170290 }               les kamas retombent
  //
  // ET L'AUTRE MOITIE TIENT TOUJOURS: la meme session porte, 90 s plus tot,
  // l'achat de dix ecumes de mer A L'HOTEL DE VENTE — `kei { 1=31964 2=10
  // 5=79071 }`, l'ancien `kbm`. Il n'est PAS repertorie, et c'est ce qui
  // garantit que les mules n'achetent jamais a l'HDV. Ne pas ajouter `kei`.
  kaa: {
    name: 'AchatMarchandRequest',
    fields: {
      objetType: { no: 1, nature: 'monde', sur: 'mesure', note: 'type d article (13365 le 08/09, 6765 le 29/08), renvoye tel quel par imo et isa' },
      quantite: { no: 2, nature: 'monde', sur: 'mesure', note: 'valait 1 sur les trois achats mesures' },
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
  // VERIFIE EN JEU LE 03/09 par l'utilisateur, sur un objet ramasse par le
  // maitre: la mule l'a eu aussi. C'est la seule preuve qui compte ici.
  //
  // LE NOM EST LE NOTRE: ce type ne figurait pas dans le canal de krm35.
  ido: {
    name: 'ObjetQueteRamasseRequest',
    perime: true,
    fields: {
      objetGid: { no: 1, nature: 'monde', sur: 'mesure', note: 'identifiant d objet (1633 = l objet de quete mesure), identique chez le maitre et chez la mule, renvoye par lqn.4' },
    },
    verbatim: true,
  },
  // Releve lors de la premiere capture courte, absent de la recolte de 20 min
  // faute de donjon visite. Sans champ observe, donc rejouable tel quel.
  //
  // REMESURE LE 08/09 AU SOIR: `kie`, toujours sans un champ, et cette fois
  // avec le donjon autour.
  //
  //   244673 ms  imp { 1=120063489 2=3 3=-20000 }  parler au PNJ du donjon
  //   245889 ms  inh { 1=10530 }                   la reponse qui fait ENTRER
  //   249802 ms  hps { 1=-20000 }                  le combat, a l'interieur
  //   256831 ms  kie { }                           LA SORTIE
  //   256862 ms  <- jpw { 1=120063489 }            retour sur la carte d'entree
  //
  // L'ENTREE EN DONJON EST DONC MESUREE, ELLE AUSSI, et l'hypothese d'aout
  // tenait: elle passe par le PNJ, donc par `imp` puis `inh`, tous deux deja
  // repertories. Rien a ajouter pour elle.
  kie: {
    name: 'DungeonExitRequest',
    fields: {},
    verbatim: true,
  },
  // REMESURE LE 08/09 AU SOIR: `ize`, et LE CHAMP PASSE DU 2 AU 1.
  //
  //   260160 ms  ize { 1=677012898086 }   l'entree en havre-sac
  //   260198 ms  <- jpw { 1=162791424 }   la carte du havre-sac
  //   260564 ms  <- jpo { 6=162791424 … } son contenu
  //
  // 677012898086 est exactement le characterId que `kth` annonce a la
  // connexion (10711 ms de la meme session). C'EST LE SEUL DES HUIT TYPES
  // REMESURES CE SOIR-LA QUI DEMANDE UNE REECRITURE: une mule qui rejouerait
  // ces octets tels quels entrerait dans le havre-sac DU MAITRE.
  ize: {
    name: 'HavenBagEnterRequest',
    fields: {
      fsor: { no: 1, nature: 'compte', sur: 'mesure', note: 'identifiant du personnage; egal au champ id du contexte, et a kth.1; champ 2 avant le patch' },
    },
    verbatim: false,
  },
  // LE REJEU EST REFUSE QUAND LA MULE EST LOIN DE L'ELEMENT, et c'est une
  // CONDITION QUE LA TRAME NE PORTE PAS — la position, comme pour `jqk`. La
  // mesure du 03/09 (journal-dev.log de 17h35) ne laisse pas de place au doute:
  //
  //   MAITRE 933318 --> iwo { 1=11122 2=489396 }   le clic sur l'objet de quete
  //                 <-- iwn ... 5=676438999334     accepte, l'objet part chez lui
  //   MULE   933607     rejeu iwo ecrit (+288 ms)
  //                 <-- iwq { 2=489396 3=11122 }   REFUSE, rien dans le sac
  //   MULE   951001 --> jrw { … }                  la mule MARCHE jusqu'a l'objet
  //          951570 --> iwo { 1=11122 2=489396 }   LES MEMES OCTETS
  //                 <-- iwn ... 5=677030854950     ACCEPTE, elle a l'objet
  //
  // Meme personnage, meme trame, resultat oppose: seule la position change.
  // Refait a l'identique sur l'element 489391 dans la meme session. Le numero
  // propre au compte n'y est pour rien — maitre et mule ont le meme (11122).
  //
  // ECARTE, mesure a l'appui: « le maitre vide l'element ». Sur l'element
  // 538796, le rejeu de la mule a ete ACCEPTE 286 ms apres l'usage du maitre.
  //
  // TRANCHE LE 03/09, NE RIEN CORRIGER. Trois pistes ont ete posees a
  // l'utilisateur — attendre l'arrivee de la mule avant d'injecter, lui
  // fabriquer son deplacement, ou ne rien faire — et il a choisi de ne rien
  // faire: le rejeu passe deja quand les persos sont ensemble (zaap, porte,
  // `hjc`), et c'est ainsi qu'il joue. Ce n'est pas un defaut oublie.
  // REMESURE LE 08/09, patch 3.6.11.12. Journal-hdv.log a 19731 ms et
  // journal-archi.log a 18543 ms: le MEME geste dans deux sessions, le clic
  // sur l'etal de l'hotel de vente.
  //
  //   --> iva { 1 = 515300  5 = 6191 }          LE CLIC
  //   <-- ivf { 2 = 515300  3 = 677012898086 }  l'element repond au maitre
  //   <-- isb { ... }                           l'interface s'ouvre
  //
  // LES DEUX CHAMPS ONT ECHANGE LEUR PLACE ET LEUR NUMERO. Ce n'est pas
  // l'empreinte qui les a identifies — elle ne distingue pas deux varints —
  // mais une CORRESPONDANCE DE VALEUR: 6191 est exactement l'uid que `jpo`
  // annonce pour l'element 515300 sur cette carte, et 515300 l'un des 300
  // elementId de la meme annonce. Voir JPO_ELEMENTS dans src/protocol/compte.js.
  //
  // LA SUBSTITUTION EST GARDEE, bien que les deux clients de la session du
  // 08/09 aient recu LE MEME uid pour un meme element (540848 -> 684 chez les
  // deux). Elle ne coute rien quand l'uid est partage — la valeur substituee
  // est alors identique a celle du maitre — et elle rattrape le cas contraire,
  // que la mesure du 19/08 avait releve. La retirer demanderait de prouver que
  // l'uid est TOUJOURS partage; cette preuve n'existe pas.
  iva: {
    name: 'InteractiveUseRequest',
    fields: {
      elementId: { no: 1, nature: 'monde', sur: 'mesure', note: 'le meme noeud sur la carte pour tous les joueurs; champ 2 avant le patch' },
      skillInstanceUid: { no: 5, nature: 'compte', sur: 'mesure', note: 'annonce par jpo.8[].5.2 pour cet element; champ 1 avant le patch' },
    },
    verbatim: false,
  },
};

// LES TYPES DONT LE NOM EST PERIME, et qu'aucune mesure du 08/09 ne permet de
// retrouver.
//
// Le patch 3.6.11.12 a REATTRIBUE tous les noms: sur les 150 releves avant et
// 35 apres, deux coincidaient, et par hasard. Un appariement structurel
// (src/dev/appariement.js) retrouve un message A CONDITION QUE LE GESTE AIT
// ETE FAIT pendant une mesure — sans trame, il n'y a rien a apparier. Les neuf
// gestes ci-dessous n'ont ete faits dans aucune des trois mesures du 08/09:
// teleportation par zaap, reponse dans un arbre de dialogue, fermeture de
// dialogue, achat chez un marchand PNJ, ramassage d'un objet de quete, sortie
// de donjon, entree en havre-sac, demande d'infos de carte, action generique
// de PNJ.
//
// LEURS ENTREES RESTENT ICI, sous leur ancien nom, et c'est delibere: elles
// portent des mesures reelles — la nature de chaque champ, les refus mesures,
// la raison de chaque absence — qu'une remesure de nom ne refera pas. Elles
// sont INERTES tant que le nom est perime: aucune trame ne s'appelle plus
// ainsi, donc `lookup` rend null et le duplicateur passe son chemin.
//
// L'ACTION GENERIQUE DE PNJ (`iov`) MERITE SA PROPRE MISE EN GARDE. La session
// du 08/09 porte un candidat, `imp { 1 = 73400322  2 = 5  3 = -1 }`: la carte
// courante, un petit code d'action, un identifiant d'acteur negatif — et il
// ouvre bien un echange. MAIS il apparait UNIQUEMENT sur la carte d'un hotel
// de vente, ou il precede de 68 ms un `isb`, et ses deux valeurs d'action (5
// et 6) ressemblent autant a « vendre / acheter » a l'HDV qu'a un choix chez
// un PNJ. Le repertorier sur cette base ferait courir le risque exact que
// l'entree `kea` documente plus haut: FAIRE OUVRIR L'HOTEL DE VENTE AUX MULES,
// que l'utilisateur a explicitement exclu. Il faut une mesure sur un PNJ
// ORDINAIRE — un marchand, un PNJ de quete — pour trancher.
const PERIMES = Object.entries(MESSAGES)
  .filter(([, m]) => m.perime === true)
  .map(([k]) => k);

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

module.exports = { MESSAGES, PERIMES, lookup, lookupByName, needsRewrite, accountFields, estRejouable };
