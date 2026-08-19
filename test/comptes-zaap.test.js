'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { lireComptes, cheminParDefaut } = require('../src/comptes/zaap');

const ECHANTILLON = path.join(__dirname, 'fixtures', 'zaap-settings.json');

test('lit les comptes du Settings de Zaap', () => {
  const { comptes, erreur } = lireComptes(ECHANTILLON);
  assert.strictEqual(erreur, null);
  assert.strictEqual(comptes.length, 2);
  assert.strictEqual(comptes[0].id, 10612457);
  assert.strictEqual(comptes[0].nickname, 'BrokenLegs');
  assert.strictEqual(comptes[0].isMain, true);
});

// Le dossier keydata contient les identifiants chiffres: rien dans ce module
// ne doit y toucher, meme indirectement.
test('ne lit jamais le keydata', () => {
  const src = require('node:fs').readFileSync(
    path.join(__dirname, '..', 'src', 'comptes', 'zaap.js'), 'utf8');
  assert.doesNotMatch(src, /keydata/i);
});

test('un fichier absent donne une erreur, pas une exception', () => {
  const { comptes, erreur } = lireComptes(path.join(__dirname, 'inexistant.json'));
  assert.deepStrictEqual(comptes, []);
  assert.match(erreur, /introuvable/);
});

test('un fichier corrompu donne une erreur, pas une exception', (t) => {
  const tmp = path.join(require('node:os').tmpdir(), `zaap-corrompu-${process.pid}.json`);
  require('node:fs').writeFileSync(tmp, '{ceci n est pas du json');
  t.after(() => require('node:fs').unlinkSync(tmp));
  const { comptes, erreur } = lireComptes(tmp);
  assert.deepStrictEqual(comptes, []);
  assert.match(erreur, /illisible/);
});

test('un Settings sans USER_ACCOUNTS donne une liste vide et une erreur', (t) => {
  const tmp = path.join(require('node:os').tmpdir(), `zaap-test-${process.pid}.json`);
  require('node:fs').writeFileSync(tmp, JSON.stringify({ LANGUAGE: 'fr' }));
  t.after(() => require('node:fs').unlinkSync(tmp));
  const { comptes, erreur } = lireComptes(tmp);
  assert.deepStrictEqual(comptes, []);
  assert.match(erreur, /aucun compte/);
});

test('le chemin par défaut pointe vers le Settings de Zaap', () => {
  assert.match(cheminParDefaut(), /zaap[\\/]Settings$/);
});
