'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { composer } = require('../src/composer');

test('chaque fonction recoit le meme evenement', () => {
  const vus = [[], []];
  const f = composer((e) => vus[0].push(e), (e) => vus[1].push(e));
  const evenement = { pid: 1, dir: 'in' };
  f(evenement);
  assert.deepStrictEqual(vus[0], [evenement]);
  assert.deepStrictEqual(vus[1], [evenement]);
});

// Le Replicate et le passe-tour sont independants: si l'un jette, l'autre doit
// quand meme voir la trame.
test('une fonction qui jette n empeche pas les suivantes', () => {
  const vues = [];
  const f = composer(() => { throw new Error('boum'); }, (e) => vues.push(e));
  assert.doesNotThrow(() => f({ pid: 1 }));
  assert.strictEqual(vues.length, 1);
});

test('composer sans fonction ne jette pas', () => {
  assert.doesNotThrow(() => composer()({ pid: 1 }));
});
