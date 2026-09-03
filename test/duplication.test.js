'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { MESSAGES, lookup, lookupByName, needsRewrite, accountFields, estRejouable } = require('../src/protocol/omni');

test('les onze types répliqués sont présents', () => {
  assert.strictEqual(Object.keys(MESSAGES).length, 11);
  for (const k of ['hjc', 'jqk', 'jrh', 'iov', 'ioy', 'kla', 'jbn', 'iwo', 'kjw', 'kea', 'ido']) {
    assert.notStrictEqual(lookup(k), null, `${k} manquant`);
  }
});

test('la recherche par nom réel fonctionne dans les deux sens', () => {
  assert.strictEqual(lookup('hjc').name, 'TeleportRequest');
  assert.strictEqual(lookupByName('TeleportRequest').key, 'hjc');
  assert.strictEqual(lookupByName('Inexistant'), null);
});

// La distinction monde/compte est toute la difficulte du rejeu: recopier un
// identifiant propre au maitre ferait agir l'esclave sur un objet qui n'est
// pas le sien, ou ferait rejeter le message.
test('seuls les messages à champ de compte demandent une réécriture', () => {
  assert.strictEqual(needsRewrite('iwo'), true, 'skillInstanceUid est propre au compte');
  assert.strictEqual(needsRewrite('jbn'), true, 'fsor est l identifiant du personnage');
  assert.strictEqual(needsRewrite('hjc'), false);
  assert.strictEqual(needsRewrite('kla'), false, 'sans champ, rien à réécrire');
  assert.strictEqual(needsRewrite('inconnu'), null);
});

test('needsRewrite est cohérent avec le drapeau verbatim', () => {
  for (const [key, m] of Object.entries(MESSAGES)) {
    assert.strictEqual(m.verbatim, !needsRewrite(key), `${key} (${m.name})`);
  }
});

test('les champs à substituer sont nommés', () => {
  assert.deepStrictEqual(accountFields('iwo'), ['skillInstanceUid']);
  assert.deepStrictEqual(accountFields('jbn'), ['fsor']);
  assert.deepStrictEqual(accountFields('hjc'), []);
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
  assert.notStrictEqual(lookup('jqk'), null, 'la mesure reste documentée');
  assert.strictEqual(estRejouable('jqk'), false);
  for (const k of ['hjc', 'iov', 'ioy', 'kla', 'jbn', 'iwo', 'kjw', 'kea', 'ido']) {
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
  assert.notStrictEqual(lookup('kea'), null, 'kea: achat au marchand PNJ');
  assert.strictEqual(estRejouable('kea'), true);
  assert.strictEqual(needsRewrite('kea'), false, 'ni identifiant de personnage ni uid de session');
  assert.deepStrictEqual(accountFields('kea'), []);

  assert.strictEqual(lookup('kbm'), null, "l'achat en HDV ne doit JAMAIS entrer dans la table");
  assert.strictEqual(estRejouable('kbm'), null, 'hors table: ni connu, ni juge');
});
