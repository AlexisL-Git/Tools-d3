'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerPorte } = require('../src/droits/porte');

test('avec le droit, la trame passe', () => {
  const vues = [];
  const protege = creerPorte({ droits: () => ['songe'] });
  protege('songe', (e) => vues.push(e))({ pid: 1 });
  assert.strictEqual(vues.length, 1);
});

test('sans le droit, la politique n est jamais appelee', () => {
  const vues = [];
  const protege = creerPorte({ droits: () => [] });
  protege('songe', (e) => vues.push(e))({ pid: 1 });
  assert.strictEqual(vues.length, 0);
});

test('LES DROITS SONT RELUS A CHAQUE TRAME', () => {
  // Une porte qui prendrait une copie au demarrage laisserait tourner une
  // fonction retiree jusqu a la fermeture d OMNI. La veille remplace la liste
  // toutes les 60 s: la porte doit voir le changement au coup suivant.
  const vues = [];
  let accordes = ['songe'];
  const protege = creerPorte({ droits: () => accordes });
  const politique = protege('songe', (e) => vues.push(e));
  politique({ pid: 1 });
  accordes = [];
  politique({ pid: 1 });
  assert.strictEqual(vues.length, 1);
});

test('une exception de la politique traverse la porte', () => {
  // composer() attrape et signale; la porte ne doit pas avaler a sa place,
  // sinon une politique morte redevient un silence.
  const protege = creerPorte({ droits: () => ['hdv'] });
  assert.throws(() => protege('hdv', () => { throw new Error('boum'); })({ pid: 1 }), /boum/);
});
