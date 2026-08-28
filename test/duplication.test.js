'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { MESSAGES, lookup, lookupByName, needsRewrite, accountFields, estRejouable } = require('../src/protocol/omni');

test('les neuf types répliqués sont présents', () => {
  assert.strictEqual(Object.keys(MESSAGES).length, 9);
  for (const k of ['hjc', 'jqk', 'jrh', 'iov', 'ioy', 'kla', 'jbn', 'iwo', 'kjw']) {
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
  for (const k of ['hjc', 'iov', 'ioy', 'kla', 'jbn', 'iwo', 'kjw']) {
    assert.strictEqual(estRejouable(k), true, k);
  }
  assert.strictEqual(estRejouable('inconnu'), null, 'un type hors table ne se juge pas');
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
