'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFrameRaw } = require('../src/codec/rawProto');
const {
  MESSAGES, PERIMES, lookup, lookupByName, needsRewrite, accountFields, estRejouable,
} = require('../src/protocol/omni');

test('les onze types répliqués sont présents', () => {
  assert.strictEqual(Object.keys(MESSAGES).length, 11);
  for (const k of ['hiu', 'jpp', 'jrh', 'imp', 'inh', 'kiy', 'ize', 'iva', 'kie', 'kaa', 'ido']) {
    assert.notStrictEqual(lookup(k), null, `${k} manquant`);
  }
});

test('la recherche par nom réel fonctionne dans les deux sens', () => {
  assert.strictEqual(lookup('hiu').name, 'TeleportRequest');
  assert.strictEqual(lookupByName('TeleportRequest').key, 'hiu');
  assert.strictEqual(lookupByName('Inexistant'), null);
});

// La distinction monde/compte est toute la difficulte du rejeu: recopier un
// identifiant propre au maitre ferait agir l'esclave sur un objet qui n'est
// pas le sien, ou ferait rejeter le message.
test('seuls les messages à champ de compte demandent une réécriture', () => {
  assert.strictEqual(needsRewrite('iva'), true, 'skillInstanceUid est propre au compte');
  assert.strictEqual(needsRewrite('ize'), true, 'fsor est l identifiant du personnage');
  assert.strictEqual(needsRewrite('hiu'), false);
  assert.strictEqual(needsRewrite('kiy'), false, 'sans champ, rien à réécrire');
  assert.strictEqual(needsRewrite('inconnu'), null);
});

test('needsRewrite est cohérent avec le drapeau verbatim', () => {
  for (const [key, m] of Object.entries(MESSAGES)) {
    assert.strictEqual(m.verbatim, !needsRewrite(key), `${key} (${m.name})`);
  }
});

test('les champs à substituer sont nommés', () => {
  assert.deepStrictEqual(accountFields('iva'), ['skillInstanceUid']);
  assert.deepStrictEqual(accountFields('ize'), ['fsor']);
  assert.deepStrictEqual(accountFields('hiu'), []);
});

// Une table dont on ne sait plus ce qui est mesure et ce qui est suppose perd
// sa valeur: chaque champ doit porter son niveau de preuve.
test('chaque champ déclare sa nature et son niveau de preuve', () => {
  for (const [key, m] of Object.entries(MESSAGES)) {
    for (const [name, f] of Object.entries(m.fields)) {
      assert.ok(['monde', 'compte'].includes(f.nature), `${key}.${name}: nature`);
      assert.ok(['mesure', 'infere'].includes(f.sur), `${key}.${name}: preuve`);
    }
  }
});

// MESURE du 28/08 (journal de 20:39 UTC, 3 clients, autofollow du jeu actif):
// sur 32 `jqk` injectes chez les mules, ZERO n a produit une arrivee (`jru`).
// 26 des 30 refus `jqt` du serveur suivent une injection, de 29 ms medianes —
// un aller-retour serveur exactement. AUCUN des 43 `jqk` emis par les clients
// eux-memes n a ete refuse.
//
// LA RAISON: MapChangeRequest n est valide que si le personnage se tient DEJA
// sur la cellule de sortie de la carte. Le maitre y est — il vient d y
// marcher. La mule, elle, est ailleurs sur la carte, et le serveur refuse.
//
// LE COUT: le refus fait ANNULER au client de la mule le deplacement en
// cours. Mesure: les 30 refus ont frappe une mule en train de marcher, et 26
// ont ete suivis d une nouvelle demande de deplacement dans la seconde et
// demie. Tant que le maitre enchaine les cartes, chacun de ses changements
// re-annule la marche de chaque mule: elle boucle sur sa carte sans jamais
// atteindre la sortie. C est le defaut rapporte le 28/08.
//
// L entree RESTE dans la table: elle documente une mesure reelle, et c est
// elle qui porte la raison de ne pas rejouer.
test('le changement de carte est répertorié mais jamais rejoué', () => {
  assert.notStrictEqual(lookup('jpp'), null, 'la mesure reste documentée');
  assert.strictEqual(estRejouable('jpp'), false);
  for (const k of ['hiu', 'imp', 'inh', 'kiy', 'ize', 'iva', 'kie', 'kaa', 'ido']) {
    assert.strictEqual(estRejouable(k), true, k);
  }
  assert.strictEqual(estRejouable('inconnu'), null, 'un type hors table ne se juge pas');
});

// MESURE du 02/09 (journal de 23h41, deux clients sur la meme carte). Le
// maitre ramasse l'objet de quete, la mule le regarde: c'est le defaut
// rapporte le 03/09.
//
//   MAITRE  240286 ms  --> ido { 1=1633 }        le clic sur l'objet
//                      --> kla {  }              meme milliseconde
//                      <-- lqn { 2=54 4=1633 }   l'objet entre dans le sac
//                      <-- ief { 1=1633 }        la quete avance
//           240345 ms      rejeu kla ecrit       SEUL kla partait
//   MULE    242512 ms  --> ido { 1=1633 }        clic a la main, 2,2 s apres
//                      <-- lqn { 2=54 4=1633 }   MEMES reponses
//                      <-- ief { 1=1633 }
//
// Le champ 1 vaut 1633 chez les DEUX personnages pour le meme objet: c'est un
// identifiant d'objet, pas un exemplaire — le serveur le renvoie tel quel dans
// lqn.4, comme pour `kea`. Rien dans la requete n'appartient au maitre.
test('le ramassage d un objet de quête est répliqué tel quel', () => {
  assert.notStrictEqual(lookup('ido'), null, 'ido: le ramassage d un objet de quête');
  assert.strictEqual(estRejouable('ido'), true);
  assert.strictEqual(needsRewrite('ido'), false, 'le champ 1 vaut 1633 chez les deux comptes');
  assert.deepStrictEqual(accountFields('ido'), []);
});

// MESURE sur DEUX sessions du 28/08 (avant et apres le retrait de `jqk`):
// 78 `jrh` injectes chez des mules, 66 SANS LA MOINDRE REPONSE du serveur.
// Les 12 reponses `jss` observees portaient toutes la carte ou la mule se
// tenait DEJA, et coincidaient avec sa propre demande — ce sont ses reponses
// a elle. Aucune, jamais, pour la carte du maitre.
//
// LA RAISON: le serveur ne repond a une demande d infos que pour la carte ou
// se trouve le personnage. Celle du maitre ne le concerne pas.
//
// Contrairement a `jqk`, aucun degat mesure: le serveur ignore, point. Mais
// une trame qui ne peut RIEN produire n a pas a etre ecrite sur la socket
// d un client de jeu.
test('la demande d infos de carte est répertoriée mais jamais rejouée', () => {
  assert.notStrictEqual(lookup('jrh'), null, 'la mesure reste documentée');
  assert.strictEqual(estRejouable('jrh'), false);
});

// MESURE du 29/08, deux sessions (17:41 et 19:58 locales), memes deux clients,
// meme marchand (npcId -20000, carte 192413696). L'utilisateur a achete un
// Lailait a 4 kamas au marchand, puis une Graine de Sesame a 67 kamas a
// l'hotel de vente, dans la MEME session — de quoi comparer les deux achats
// sur le meme serveur a deux minutes d'ecart.
//
//   MARCHAND PNJ
//     --> iov { 1=1 2=192413696 3=-20000 }    ouvre la boutique
//         rejeu iov ecrit (+272 ms)           la boutique s'ouvre chez la mule
//     --> kea { 1=6765 2=1 }                  L'ACHAT
//     <-- ivf { 1=3941470 }                   3941474 -> 3941470, soit -4 kamas
//
//   HOTEL DE VENTE
//     --> iwo { 1=22985 2=515220 }            ouvre l'HDV: un ELEMENT, pas un PNJ
//         rejeu iwo refuse : manque skillInstanceUid
//     --> kbm { 1=1116 2=67 3=1 }             L'ACHAT, avec le prix en champ 2
//     <-- ivf { 1=3941403 }                   3941470 -> 3941403, soit -67 kamas
//
// Les deux prix collent au kama pres, ce qui identifie chaque message sans
// ambiguite. `kea` et `kbm` sont DEUX TYPES DISTINCTS.
//
// C'EST CE QUI REND LA DEMANDE REALISABLE SANS UNE LIGNE DE CONDITION.
// L'utilisateur veut que ses mules achetent au marchand mais JAMAIS a l'HDV.
// Comme l'HDV a son propre type, il suffit de ne pas le repertorier: ce qui
// n'est pas dans la table n'est jamais rejoue (src/duplicateur.js). La
// contrainte est tenue par une ABSENCE, pas par une regle qu'on pourrait
// oublier d'appliquer.
//
// Ce test garde donc les deux moities: `kea` present, `kbm` absent. Ajouter
// `kbm` un jour ferait acheter les mules a l'HDV — le test le dira.
test('l achat au marchand est répliqué, celui de l hôtel de vente n existe pas dans la table', () => {
  assert.notStrictEqual(lookup('kaa'), null, 'kaa: achat au marchand PNJ');
  assert.strictEqual(estRejouable('kaa'), true);
  assert.strictEqual(needsRewrite('kaa'), false, 'ni identifiant de personnage ni uid de session');
  assert.deepStrictEqual(accountFields('kaa'), []);

  assert.strictEqual(lookup('kei'), null, "l'achat en HDV ne doit JAMAIS entrer dans la table");
  assert.strictEqual(estRejouable('kei'), null, 'hors table: ni connu, ni juge');
});

// --- LE REMAPPAGE DU PATCH 3.6.11.12 -------------------------------------
//
// TOUS LES TESTS CI-DESSUS PASSENT SUR UNE TABLE MORTE, et c'est la lecon du
// 08/09: ils confrontent la table a elle-meme. Le patch a reattribue tous les
// noms de messages — sur les onze cles d'origine, AUCUNE n'apparait dans les
// journaux du 08/09 — donc `lookup(frame.type)` rendait null pour chaque
// trame, le duplicateur sortait des sa premiere garde, et plus rien n'etait
// rejoue. Sans erreur, sans ligne de journal: le silence.
//
// CEUX QUI SUIVENT CONFRONTENT LA TABLE A DES OCTETS REELS, releves dans
// journal-hdv.log et journal-combat.log du 08/09. Un nom perime les fait
// echouer; c'est toute leur raison d'etre.
const fixture = (nom) => decodeFrameRaw(
  Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures', nom), 'utf8').trim(), 'hex'),
);

// MESURE du 08/09 (journal-hdv.log, 19731 ms, et journal-archi.log, 18543 ms:
// deux sessions, le meme geste). Le clic sur l'etal de l'hotel de vente:
//
//   --> iva { 1 = 515300  5 = 6191 }         LE CLIC
//   <-- ivf { 2 = 515300  3 = 677012898086 } l'element repond, au maitre
//   <-- isb { ... }                          l'interface s'ouvre
//
// C'est le role exact de l'ancien `iwo`, dont la mesure du 29/08 montrait
// deja qu'il ouvrait l'HDV (`iwo { 1=22985 2=515220 }`). LES DEUX CHAMPS ONT
// ECHANGE LEUR PLACE ET LEUR NUMERO: l'elementId passe du champ 2 au champ 1,
// le skillInstanceUid du champ 1 au champ 5.
test('le clic sur un élément interactif mesuré le 08/09 est répertorié', () => {
  const f = fixture('omni-iva-element.hex');
  assert.strictEqual(f.type, 'iva', 'la fixture porte bien le nom mesuré');
  assert.notStrictEqual(lookup(f.type), null, 'iva: le clic sur un élément interactif');
  assert.strictEqual(lookup(f.type).name, 'InteractiveUseRequest');
  assert.strictEqual(estRejouable(f.type), true);
});

// LE NUMERO DE CHAMP EST LA MOITIE DU REMAPPAGE. Le superviseur lit
// `connu.fields.elementId.no` pour retrouver l'element dans la trame du
// maitre, puis `f.no` pour y substituer le numero de l'esclave: un nom juste
// avec un numero perime rejouerait a cote, ce qui est pire que ne rien
// rejouer. Les valeurs viennent de la trame reelle ci-dessus.
test('les champs de iva portent les numéros mesurés le 08/09', () => {
  const f = fixture('omni-iva-element.hex');
  const connu = lookup('iva');
  const valeur = (no) => f.payload.find((c) => c.no === no).value;

  assert.strictEqual(connu.fields.elementId.no, 1, 'elementId: champ 2 -> 1');
  assert.strictEqual(valeur(connu.fields.elementId.no), 515300n, "l'étal de l'HDV");

  assert.strictEqual(connu.fields.skillInstanceUid.no, 5, 'skillInstanceUid: champ 1 -> 5');
  assert.strictEqual(valeur(connu.fields.skillInstanceUid.no), 6191n);

  assert.strictEqual(needsRewrite('iva'), true, 'le skillInstanceUid reste propre au compte');
  assert.deepStrictEqual(accountFields('iva'), ['skillInstanceUid']);
});

// MESURE du 08/09 (journal-hdv.log, 460275 ms). Le changement de carte garde
// sa structure d'avant le patch — mapId au champ 1, drapeau au champ 2,
// « parfois absent » (une occurrence sans champ 2 dans journal-combat.log a
// 62366 ms) — mais change de nom. Il reste NON REJOUABLE: la mesure du 28/08
// tient, elle porte sur une condition de POSITION que la trame ne porte pas.
test('le changement de carte du 08/09 est répertorié et toujours pas rejoué', () => {
  const f = fixture('omni-jpp-carte.hex');
  assert.strictEqual(f.type, 'jpp');
  assert.notStrictEqual(lookup(f.type), null, 'la mesure du 28/08 reste documentée');
  assert.strictEqual(estRejouable(f.type), false, 'annule la marche des mules');
});

// CE QUI RESTE A REMESURER, et qui doit se voir.
//
// Huit gestes n'ont ete faits dans AUCUNE des trois mesures du 08/09: leurs
// messages n'apparaissent donc nulle part, et aucun appariement structurel ne
// peut les retrouver. Les entrees restent dans la table — elles portent des
// mesures reelles qu'il ne faut pas perdre — mais sous leur nom PERIME, donc
// inertes: aucune trame ne s'appelle plus ainsi.
//
// Les laisser silencieusement serait refaire le defaut qu'on repare. Cette
// liste est le rappel, et le test qui suit interdit de l'oublier.
test('les types encore à remesurer sont déclarés comme tels', () => {
  assert.deepStrictEqual(
    PERIMES.slice().sort(),
    ['ido', 'jrh'],
    'un type remesuré doit sortir de cette liste',
  );
  for (const k of PERIMES) {
    assert.notStrictEqual(lookup(k), null, `${k}: la mesure reste documentée`);
    assert.strictEqual(MESSAGES[k].perime, true, `${k}: doit porter le marqueur`);
  }
  for (const k of ['iva', 'jpp', 'hiu', 'imp', 'inh', 'kiy', 'kaa', 'kie', 'ize']) {
    assert.notStrictEqual(MESSAGES[k].perime, true, `${k} a été remesuré le 08/09`);
  }
});

// --- LA MESURE DU 08/09 AU SOIR ------------------------------------------
//
// Une session de 4,7 min (journal-combat.log, un seul client) ou l'utilisateur
// a joue, dans cet ordre, tous les gestes qui manquaient. C'est la CHRONOLOGIE
// annoncee a l'avance qui identifie ces messages: l'empreinte ne distingue pas
// deux varints, et trois de ces huit types ne portent aucun champ.
//
//   24123 ms  hjj 185860609                      voyage par ctrl-clic (hors table)
//   35771 ms  hiu { 1=5 3=84806401 }             LA TELEPORTATION
//   41325 ms  iva { 1=540330 5=20506 }           le clic sur le zaap
//   42467 ms  hiu { 3=191105026 }                teleportation, sans type
//   58050 ms  imp { 1=101450251 2=3 3=-20001 }   PARLER au PNJ de l'Almanax
//   59279 ms  inh { 1=13557 }                    une reponse de dialogue
//   61976 ms  <- kja { 1=1 }                     LE SERVEUR ferme le dialogue
//  122581 ms  iva { 1=515300 5=6191 }            l'etal de l'HDV
//  128098 ms  kei { 1=31964 2=10 5=79071 }       L'ACHAT EN HDV - reste dehors
//  129255 ms  kiy { }                            fermeture de l'echange
//  219435 ms  imp { 1=101451273 2=11 3=-20001 }  ACHETER chez un marchand
//  229028 ms  kaa { 1=13365 2=1 }                L'ACHAT au marchand
//  230048 ms  kiy { }                            fermeture, deux fois
//  249802 ms  hps { 1=-20000 }                   l'attaque, dans le donjon
//  252970 ms  kjy { }                            L'ABANDON du combat
//  256831 ms  kie { }                            LA SORTIE du donjon
//  260160 ms  ize { 1=677012898086 }             L'ENTREE EN HAVRE-SAC
//
// Chaque test ci-dessous lit les octets de la trame nommee.

// L'ancienne entree ne portait aucun numero de champ - hjc n'etant jamais
// reecrit, personne n'en avait eu besoin. La mesure les donne: le type de
// destination au champ 1, la carte au champ 3. Le champ 1 est ABSENT quand il
// vaut zero (42467 ms, la sortie d'un zaap), ce qui est la regle protobuf et
// non une variante de message.
test('la téléportation mesurée le 08/09 est répertoriée et rejouable', () => {
  const f = fixture('omni-hiu-teleport.hex');
  assert.strictEqual(f.type, 'hiu');
  assert.strictEqual(lookup(f.type).name, 'TeleportRequest');
  assert.strictEqual(estRejouable(f.type), true);
  assert.strictEqual(needsRewrite(f.type), false, 'rien qui appartienne au maître');
  assert.strictEqual(lookup(f.type).fields.destinationMapId.no, 3);
});

// CE QUI LEVE LE DOUTE DU MATIN. `imp` avait ete ecarte parce qu'on ne l'avait
// vu que sur la carte d'un hotel de vente, ou ses actions 5 et 6 pouvaient etre
// « vendre / acheter » plutot qu'un choix chez un PNJ. Ici il porte l'ACTION 3
// chez le PNJ de l'Almanax, puis chez celui d'un donjon - et 3 etait deja
// « parler » dans la mesure du 29/08, avant le patch. Le meme message sert les
// deux, c'est donc bien l'action generique de PNJ.
test('l action de PNJ mesurée le 08/09 est répertoriée', () => {
  const f = fixture('omni-imp-pnj.hex');
  assert.strictEqual(f.type, 'imp');
  const connu = lookup(f.type);
  assert.strictEqual(connu.name, 'NpcGenericActionRequest');
  const valeur = (no) => f.payload.find((c) => c.no === no).value;
  assert.strictEqual(valeur(connu.fields.npcMapId.no), 101450251n, "la carte de l Almanax");
  assert.strictEqual(valeur(connu.fields.npcActionId.no), 3n, 'parler');
  assert.strictEqual(valeur(connu.fields.npcId.no), -20001n, "l instance de PNJ");
});

test('la réponse de dialogue mesurée le 08/09 est répertoriée', () => {
  const f = fixture('omni-inh-dialogue.hex');
  assert.strictEqual(f.type, 'inh');
  assert.strictEqual(lookup(f.type).name, 'NpcDialogReplyRequest');
  assert.strictEqual(estRejouable(f.type), true);
});

// UN DIALOGUE QUI S'ACHEVE NE PRODUIT AUCUNE REQUETE: le serveur le ferme
// lui-meme (`kja` a 61976 ms). Les trois `kiy` de la session suivent tous la
// fermeture d'un ECHANGE - l'hotel de vente a 129255 ms, la boutique du
// marchand a 230048 et 230049 ms. C'est ce que la mesure dit, ni plus ni moins;
// le rejeu, lui, fait le meme travail qu'avant le patch: ce que le maitre
// ferme, les mules le ferment.
test('la fermeture mesurée le 08/09 est répertoriée et sans champ', () => {
  const f = fixture('omni-kiy-fermeture.hex');
  assert.strictEqual(f.type, 'kiy');
  assert.notStrictEqual(lookup(f.type), null);
  assert.deepStrictEqual(lookup(f.type).fields, {}, 'aucun champ, comme avant le patch');
  assert.strictEqual(needsRewrite(f.type), false);
});

// LA MOITIE QUI COMPTE EST L'ABSENCE. L'achat au marchand entre dans la table,
// celui de l'hotel de vente reste dehors - et la session porte les deux, a 90 s
// d'intervalle, ce qui les distingue sans ambiguite:
//
//   kaa { 1=13365 2=1 }           -> imo, puis l'objet 13365 entre dans le sac
//   kei { 1=31964 2=10 5=79071 }  l'achat de dix ecumes de mer EN HDV
//
// Ajouter `kei` un jour ferait acheter les mules a l'HDV; ce test le dira.
test('l achat au marchand du 08/09 est répliqué, celui de l HDV reste dehors', () => {
  const f = fixture('omni-kaa-marchand.hex');
  assert.strictEqual(f.type, 'kaa');
  const connu = lookup(f.type);
  assert.strictEqual(connu.name, 'AchatMarchandRequest');
  const valeur = (no) => f.payload.find((c) => c.no === no).value;
  assert.strictEqual(valeur(connu.fields.objetType.no), 13365n);
  assert.strictEqual(valeur(connu.fields.quantite.no), 1n);

  assert.strictEqual(lookup('kei'), null, "l'achat en HDV ne doit JAMAIS entrer dans la table");
});

test('la sortie de donjon mesurée le 08/09 est répertoriée', () => {
  const f = fixture('omni-kie-donjon.hex');
  assert.strictEqual(f.type, 'kie');
  assert.strictEqual(lookup(f.type).name, 'DungeonExitRequest');
  assert.deepStrictEqual(lookup(f.type).fields, {});
});

// LE SEUL DES HUIT QUI DEMANDE UNE REECRITURE. Le champ passe du 2 au 1, et il
// porte le characterId - celui que `kth` annonce a la connexion, et qu'on
// retrouve ici a l'identique (677012898086). Une mule qui rejouerait la trame
// telle quelle entrerait dans le havre-sac DU MAITRE.
test('l entrée en havre-sac mesurée le 08/09 demande le characterId de l esclave', () => {
  const f = fixture('omni-ize-havresac.hex');
  assert.strictEqual(f.type, 'ize');
  assert.strictEqual(lookup(f.type).name, 'HavenBagEnterRequest');
  assert.strictEqual(needsRewrite(f.type), true);
  assert.deepStrictEqual(accountFields(f.type), ['fsor']);
  assert.strictEqual(lookup(f.type).fields.fsor.no, 1, 'champ 2 -> 1');
  assert.strictEqual(f.payload.find((c) => c.no === 1).value, 677012898086n);
});

