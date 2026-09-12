'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { tauxDe, TAUX, JEU } = require('../src/pepites/taux');

// 4 049, ET LE CHIFFRE EST FIGE ICI, comme les 21 748 objets et les 286
// archimonstres. Les taux BOUGENT d'une version du jeu a l'autre -- mesure le
// 11/09: 22 divergences entre le client live et la beta installee. Le jour ou
// Ankama y touche, c'est ce test qui tombe le premier et rappelle que
// outils/faire-pepites.js existe.
test('la table porte les 4 049 objets recyclables', () => {
  assert.strictEqual(Object.keys(TAUX).length, 4049);
});

test('la table dit contre quelle version du jeu elle a ete verifiee', () => {
  assert.match(JEU, /^\d+\.\d+\.\d+\.\d+$/);
});

test('un gid connu rend son taux', () => {
  assert.strictEqual(tauxDe(303), 0.003000000026077032);
  assert.strictEqual(tauxDe(13731), 0.07114285714285715);
});

// LES TRAMES DONNENT DES NOMBRES, LE JSON PORTE DES CHAINES.
test('le gid marche en nombre comme en chaine', () => {
  assert.strictEqual(tauxDe('303'), 0.003000000026077032);
});

// UN OBJET NON RECYCLABLE N'EST PAS DANS LA TABLE. Il rend null, et surtout
// pas 0: une division par zero rendrait l'infini, qui trierait en tete du
// classement -- exactement le pire objet presente comme le meilleur.
test('un objet non recyclable rend null', () => {
  assert.strictEqual(tauxDe(44), null);
  assert.strictEqual(tauxDe(999999), null);
});

test('une cle heritee d Object ne passe pas pour un taux', () => {
  assert.strictEqual(tauxDe('toString'), null);
  assert.strictEqual(tauxDe('constructor'), null);
});

test('ni null ni undefined ne cassent la table', () => {
  assert.strictEqual(tauxDe(null), null);
  assert.strictEqual(tauxDe(undefined), null);
});
