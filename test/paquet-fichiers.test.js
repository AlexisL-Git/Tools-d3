'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { FICHIERS_DESKTOP, DOSSIERS_DESKTOP } = require('../outils/faire-etape');

// LA SECONDE LISTE BLANCHE, celle qu'on oublie.
//
// Deux fichiers decident de ce qui part chez les amis, et ils ne disent pas la
// meme chose:
//
//   outils/faire-paquet-code.js  emporte desktop/ EN ENTIER, recursivement;
//   outils/faire-etape.js        n'emporte que les fichiers qu'il NOMME.
//
// L'archive publiee est fabriquee depuis le dossier d'etape. C'est donc la
// liste de faire-etape.js qui gagne, et un fichier absent de cette liste ne
// part pas — sans erreur, sans avertissement, sans rien.
//
// Ca s'est deja produit deux fois. Une premiere avec les polices: index.html
// partait chez les amis SANS elles, et l'interface retombait sur la police
// systeme apres une mise a jour (d'ou DOSSIERS_DESKTOP). Une seconde avec
// devlog.json: le bouton « Quoi de neuf » aurait voyage sans ses notes, et le
// panneau aurait ete vide chez tout le monde. Les deux fois, tous les tests
// etaient verts et le code etait juste.
//
// Ce test fait le rapprochement que personne ne pense a faire: tout ce qui est
// pose a la racine de desktop/ doit etre nomme quelque part.

const DESKTOP = path.join(__dirname, '..', 'desktop');
// Fabrication et dependances: produits ici, jamais distribues tels quels.
const HORS_SUJET = new Set(['dist', 'etape-paquet', 'node_modules']);

test('tout fichier pose a la racine de desktop/ est nomme dans FICHIERS_DESKTOP', () => {
  const presents = fs.readdirSync(DESKTOP, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
  const oublies = presents.filter((n) => !FICHIERS_DESKTOP.includes(n));
  assert.deepStrictEqual(
    oublies, [],
    `desktop/${oublies.join(', desktop/')} ne partira PAS chez les amis : `
    + 'ajoute-le a FICHIERS_DESKTOP dans outils/faire-etape.js',
  );
});

test('tout sous-dossier de desktop/ est nomme dans DOSSIERS_DESKTOP', () => {
  const presents = fs.readdirSync(DESKTOP, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !HORS_SUJET.has(e.name))
    .map((e) => e.name);
  const oublies = presents.filter((n) => !DOSSIERS_DESKTOP.includes(n));
  assert.deepStrictEqual(
    oublies, [],
    `desktop/${oublies.join('/, desktop/')}/ ne partira PAS chez les amis : `
    + 'ajoute-le a DOSSIERS_DESKTOP dans outils/faire-etape.js',
  );
});

// Les deux listes ne servent a rien si elles nomment des fichiers disparus:
// faire-etape.js copie FICHIERS_DESKTOP sans garde d'existence et leverait
// ENOENT en pleine fabrication, au pire moment.
test('aucune des deux listes ne nomme un fichier absent du depot', () => {
  for (const f of FICHIERS_DESKTOP) {
    assert.ok(fs.existsSync(path.join(DESKTOP, f)), `FICHIERS_DESKTOP nomme desktop/${f}, absent`);
  }
  for (const d of DOSSIERS_DESKTOP) {
    assert.ok(fs.existsSync(path.join(DESKTOP, d)), `DOSSIERS_DESKTOP nomme desktop/${d}/, absent`);
  }
});
