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

// Le OMNI et le passe-tour sont independants: si l'un jette, l'autre doit
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

// Le silence est le mode d'echec qui a coute le plus cher a ce projet: une
// politique morte et une politique sans rien a faire produisent le meme
// journal vide. Une exception doit toujours ressortir quelque part.
test('une exception est signalee a onErreur avec la trame en cause', () => {
  const vus = [];
  const boum = new Error('boum');
  const evenement = { pid: 7, dir: 'in', frame: { type: 'jxz' } };
  composer(() => { throw boum; }, { onErreur: (x) => vus.push(x) })(evenement);
  assert.strictEqual(vus.length, 1);
  assert.strictEqual(vus[0].erreur, boum);
  assert.strictEqual(vus[0].evenement, evenement);
});

test('onErreur n empeche pas les politiques suivantes de voir la trame', () => {
  const vues = [];
  const erreurs = [];
  const f = composer(
    () => { throw new Error('boum'); },
    (e) => vues.push(e),
    { onErreur: (x) => erreurs.push(x) },
  );
  f({ pid: 1 });
  assert.strictEqual(vues.length, 1);
  assert.strictEqual(erreurs.length, 1);
});

// Sans onErreur, l'exception part sur la sortie d'erreur: aucun chemin ne
// mene au silence.
test('sans onErreur l exception va sur la sortie d erreur', () => {
  const vraiConsole = console.error;
  const dits = [];
  console.error = (...a) => dits.push(a);
  try { composer(() => { throw new Error('boum'); })({ pid: 1 }); }
  finally { console.error = vraiConsole; }
  assert.strictEqual(dits.length, 1);
});
