'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { FONCTIONS, NOMS, estConnue } = require('../src/droits/liste');
const copieServeur = require('../serveur-maj/lib/fonctions');

test('les sept fonctions verrouillables, et elles seules', () => {
  assert.deepStrictEqual(NOMS, [
    'abandon', 'passe-tour', 'invitation', 'echange', 'songe', 'overlay', 'hdv',
  ]);
});

test('le replicate et le garde-combat ne sont pas verrouillables', () => {
  // Le premier est l outil lui-meme, le second est une protection: la couper
  // ferait ouvrir un combat a chaque mule (degat mesure le 28/08).
  assert.strictEqual(estConnue('replicate'), false);
  assert.strictEqual(estConnue('duplication'), false);
  assert.strictEqual(estConnue('garde-combat'), false);
});

test('chaque fonction porte un libelle non vide', () => {
  for (const f of FONCTIONS) {
    assert.strictEqual(typeof f.libelle, 'string');
    assert.ok(f.libelle.length > 0, `libelle vide pour ${f.nom}`);
  }
});

test('aucun nom en double', () => {
  assert.strictEqual(new Set(NOMS).size, NOMS.length);
});

test('LA COPIE DU SERVEUR EST IDENTIQUE', () => {
  // serveur-maj se deploie seul et ne peut pas require ../../src. La copie est
  // donc inevitable; ce test est ce qui l empeche de deriver en silence.
  assert.deepStrictEqual(copieServeur.FONCTIONS, FONCTIONS);
  assert.deepStrictEqual(copieServeur.NOMS, NOMS);
});
