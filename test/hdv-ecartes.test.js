'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { noterEcart, PLAFOND_ECARTES } = require('../src/hdv/ecartes');

const ligne = (sur = {}) => ({
  gid: 13731, taille: 10, lots: 1, motif: 'trop-haut', vise: 7000001, borne: 7600, moyenUnitaire: 152, ...sur,
});

test('une ligne inconnue est ajoutee telle quelle, son nom en plus', () => {
  const ecartes = [];
  noterEcart(ecartes, ligne());
  assert.deepStrictEqual(ecartes, [{ ...ligne(), nom: 'Pierre Médicinale' }]);
});

// LE NOM SE POSE ICI PARCE QUE C'EST ICI QUE LA LIGNE NAIT, et que les deux
// passes y passent: la mise en vente comme la mise a jour des prix. Le poser
// plus loin le ferait poser deux fois, ou une seule.
test('la ligne porte le nom de l objet, pas seulement son gid', () => {
  const ecartes = [];
  noterEcart(ecartes, ligne({ gid: 289 }));
  assert.strictEqual(ecartes[0].nom, 'Blé');
});

// UN GID INCONNU NE DOIT RIEN CASSER. La table date du jour ou on l'a
// fabriquee; un objet ajoute par Ankama depuis passera par la, et il doit
// s'ecarter comme les autres — l'affichage retombera sur son numero.
test('un gid absent de la table laisse un nom nul, la ligne reste', () => {
  const ecartes = [];
  noterEcart(ecartes, ligne({ gid: 999999 }));
  assert.strictEqual(ecartes.length, 1);
  assert.strictEqual(ecartes[0].nom, null);
});

// LA LIGNE DE L'APPELANT N'EST PAS TOUCHEE. vente.js et reprix.js construisent
// leur objet et le passent; noterEcart en garde une copie nommee plutot que
// d'ecrire dans le leur.
test('la ligne passee par l appelant n est pas modifiee', () => {
  const ecartes = [];
  const brute = ligne();
  noterEcart(ecartes, brute);
  assert.strictEqual('nom' in brute, false);
});

// LE GROUPEMENT EST LA RAISON D'ETRE DU MODULE. Un marche delirant ecarte un
// paquet entier d'un coup, et un paquet median fait quatre lots: sans
// groupement, la moindre passe sortirait des centaines de lignes identiques.
test('deux lots du meme gid, meme taille et meme motif tiennent en une ligne', () => {
  const ecartes = [];
  noterEcart(ecartes, ligne({ lots: 4 }));
  noterEcart(ecartes, ligne({ lots: 2 }));
  assert.strictEqual(ecartes.length, 1);
  assert.strictEqual(ecartes[0].lots, 6);
});

// Le motif fait partie de la cle: le meme objet peut sortir par le haut sur un
// creneau et par le bas sur un autre, et melanger les deux mentirait.
test('le meme lot ecarte pour deux motifs differents fait deux lignes', () => {
  const ecartes = [];
  noterEcart(ecartes, ligne({ motif: 'trop-haut' }));
  noterEcart(ecartes, ligne({ motif: 'trop-bas' }));
  assert.strictEqual(ecartes.length, 2);
});

test('la taille fait partie de la cle : un lot de 10 n est pas un lot de 100', () => {
  const ecartes = [];
  noterEcart(ecartes, ligne({ taille: 10 }));
  noterEcart(ecartes, ligne({ taille: 100 }));
  assert.strictEqual(ecartes.length, 2);
});

// LE PLAFOND PORTE SUR LES LIGNES, JAMAIS SUR LES LOTS. Une passe partie de
// travers sur un stock entier remplirait sinon l'IPC; le compte des lignes
// retenues, lui, doit rester exact.
test('au-dela du plafond, aucune ligne neuve n est ajoutee', () => {
  const ecartes = [];
  for (let gid = 0; gid < PLAFOND_ECARTES + 50; gid += 1) noterEcart(ecartes, ligne({ gid }));
  assert.strictEqual(ecartes.length, PLAFOND_ECARTES);
});

test('une ligne deja connue continue de compter ses lots au-dela du plafond', () => {
  const ecartes = [];
  for (let gid = 0; gid < PLAFOND_ECARTES + 50; gid += 1) noterEcart(ecartes, ligne({ gid }));
  noterEcart(ecartes, ligne({ gid: 0, lots: 7 }));
  assert.strictEqual(ecartes.length, PLAFOND_ECARTES);
  assert.strictEqual(ecartes[0].lots, 8);
});
