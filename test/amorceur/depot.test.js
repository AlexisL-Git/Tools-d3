'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { creerDepot, comparerVersions } = require('../../amorceur/depot');

function racineTemporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'depot-'));
}

function installer(racine, version) {
  const d = path.join(racine, 'versions', version);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'marqueur.txt'), version);
  return d;
}

test('un depot vierge ne plante pas et ne propose aucune version', () => {
  const d = creerDepot(racineTemporaire());
  assert.deepStrictEqual(d.lire(), { version: null, essai: null, refusees: [] });
  assert.strictEqual(d.choisirVersion().version, null);
});

test('un courante.json illisible est traite comme vierge', () => {
  const racine = racineTemporaire();
  fs.mkdirSync(path.join(racine, 'versions'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'versions', 'courante.json'), '{ ceci n est pas du json');
  const d = creerDepot(racine);
  assert.strictEqual(d.lire().version, null);
});

test('choisirVersion rend la version courante quand aucun temoin ne traine', () => {
  const racine = racineTemporaire();
  installer(racine, '0.2.0');
  const d = creerDepot(racine);
  d.ecrire({ version: '0.2.0', essai: null, refusees: [] });
  assert.deepStrictEqual(d.choisirVersion(), { version: '0.2.0', refusee: null });
});

test('un temoin reste fait refuser la version et revenir a la precedente', () => {
  const racine = racineTemporaire();
  installer(racine, '0.2.0');
  installer(racine, '0.3.0');
  const d = creerDepot(racine);
  d.ecrire({ version: '0.3.0', essai: '0.3.0', refusees: [] });
  const choix = d.choisirVersion();
  assert.deepStrictEqual(choix, { version: '0.2.0', refusee: '0.3.0' });
  // La decision est persistee: un relancement ne la reprend pas a zero.
  assert.deepStrictEqual(d.lire().refusees, ['0.3.0']);
  assert.strictEqual(d.lire().essai, null);
  assert.strictEqual(d.lire().version, '0.2.0');
});

test('une version refusee n est plus jamais choisie', () => {
  const racine = racineTemporaire();
  installer(racine, '0.2.0');
  installer(racine, '0.3.0');
  const d = creerDepot(racine);
  d.ecrire({ version: '0.2.0', essai: null, refusees: ['0.3.0'] });
  assert.strictEqual(d.choisirVersion().version, '0.2.0');
});

test('si toutes les versions installees sont refusees, on rend null plutot que de mentir', () => {
  const racine = racineTemporaire();
  installer(racine, '0.2.0');
  const d = creerDepot(racine);
  d.ecrire({ version: '0.2.0', essai: '0.2.0', refusees: [] });
  assert.strictEqual(d.choisirVersion().version, null);
});

test('versionsInstallees trie par version, pas par chaine', () => {
  const racine = racineTemporaire();
  installer(racine, '0.9.0');
  installer(racine, '0.10.0');
  const d = creerDepot(racine);
  assert.deepStrictEqual(d.versionsInstallees(), ['0.9.0', '0.10.0']);
});

test('comparerVersions traite les nombres comme des nombres', () => {
  assert.ok(comparerVersions('0.10.0', '0.9.0') > 0);
  assert.ok(comparerVersions('1.0.0', '0.99.99') > 0);
  assert.strictEqual(comparerVersions('0.3.0', '0.3.0'), 0);
});

test('le temoin se pose et s efface', () => {
  const racine = racineTemporaire();
  const d = creerDepot(racine);
  d.poserTemoin('0.4.0');
  assert.strictEqual(d.lire().essai, '0.4.0');
  d.effacerTemoin();
  assert.strictEqual(d.lire().essai, null);
});

test('refuser n ajoute pas deux fois la meme version', () => {
  const d = creerDepot(racineTemporaire());
  d.refuser('0.5.0');
  d.refuser('0.5.0');
  assert.deepStrictEqual(d.lire().refusees, ['0.5.0']);
});
