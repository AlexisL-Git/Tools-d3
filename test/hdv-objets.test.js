'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { nomDe, OBJETS } = require('../src/hdv/objets');

// 21 748, ET LE CHIFFRE EST FIGE ICI, comme les 286 archimonstres. Le jour ou
// Ankama ajoute des objets, c'est ce test qui tombe le premier et rappelle que
// outils/faire-objets.js existe. Sans lui, la table vieillirait en silence et
// les nouveaux objets s'afficheraient en gids nus sans que personne comprenne
// pourquoi.
test('la table porte les 21 748 objets du jeu', () => {
  assert.strictEqual(Object.keys(OBJETS).length, 21748);
});

test('un gid connu rend son nom', () => {
  assert.strictEqual(nomDe(289), 'Blé');
  assert.strictEqual(nomDe(13731), 'Pierre Médicinale');
});

// LES TRAMES DONNENT DES NOMBRES, LE JSON PORTE DES CHAINES. Les deux doivent
// marcher: rien ne garantit qu'un gid n'ait pas traverse un JSON.parse en
// chemin, et un `null` silencieux sur un objet present serait invisible.
test('le gid marche en nombre comme en chaine', () => {
  assert.strictEqual(nomDe('289'), 'Blé');
});

// UN GID INCONNU NE VAUT PAS UNE CHAINE VIDE. L'affichage retombe sur le
// numero, qui est ce qu'on recopie dans le jeu; du blanc ne se recopie pas.
test('un gid absent rend null', () => {
  assert.strictEqual(nomDe(999999), null);
});

// La table est un objet nu, donc `OBJETS['toString']` rendrait une fonction.
// Un gid qui porte le nom d'une propriete d'Object ne doit pas sortir de nom.
test('une cle heritee d Object ne passe pas pour un nom', () => {
  assert.strictEqual(nomDe('toString'), null);
  assert.strictEqual(nomDe('constructor'), null);
});

test('ni null ni undefined ne cassent la table', () => {
  assert.strictEqual(nomDe(null), null);
  assert.strictEqual(nomDe(undefined), null);
});
