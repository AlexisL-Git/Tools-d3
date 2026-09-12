'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { creerHistorique, PASSES_GARDEES } = require('../src/pepites/historique');

function dossier() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pepites-'));
}

function passe(quand) {
  return { quand, prixQuand: quand - 1000, pid: 42, lignes: [] };
}

test('un fichier absent rend un historique vide, sans erreur', () => {
  const erreurs = [];
  const h = creerHistorique({
    chemin: path.join(dossier(), 'pepites.json'),
    onErreur: (e) => erreurs.push(e),
  });
  assert.deepStrictEqual(h.lire(), []);
  assert.strictEqual(h.dernier(), null);
  // UN FICHIER ABSENT N'EST PAS UNE ERREUR: c'est le premier lancement.
  assert.deepStrictEqual(erreurs, []);
});

test('une passe ajoutee se relit', () => {
  const c = path.join(dossier(), 'pepites.json');
  const h = creerHistorique({ chemin: c, onErreur: () => {} });
  h.ajouter(passe(1000));
  assert.strictEqual(h.lire().length, 1);
  assert.strictEqual(h.dernier().quand, 1000);
  // Une instance neuve sur le meme fichier doit voir la meme chose.
  const h2 = creerHistorique({ chemin: c, onErreur: () => {} });
  assert.strictEqual(h2.dernier().quand, 1000);
});

test('l historique garde les 30 dernieres passes et jette les plus vieilles', () => {
  assert.strictEqual(PASSES_GARDEES, 30);
  const h = creerHistorique({ chemin: path.join(dossier(), 'pepites.json'), onErreur: () => {} });
  for (let i = 0; i < PASSES_GARDEES + 5; i += 1) h.ajouter(passe(i));
  const tout = h.lire();
  assert.strictEqual(tout.length, PASSES_GARDEES);
  assert.strictEqual(tout[0].quand, 5);
  assert.strictEqual(h.dernier().quand, PASSES_GARDEES + 4);
});

// UN HISTORIQUE PERDU NE VAUT PAS UN BLOCAGE, mais il ne se perd pas en
// silence non plus: la spec demande les deux.
test('un fichier corrompu repart a vide et se journalise', () => {
  const c = path.join(dossier(), 'pepites.json');
  fs.writeFileSync(c, 'ceci n est pas du json', 'utf8');
  const erreurs = [];
  const h = creerHistorique({ chemin: c, onErreur: (e) => erreurs.push(e) });
  assert.deepStrictEqual(h.lire(), []);
  assert.strictEqual(erreurs.length, 1);
});

// Le fichier est relu a la main quand on debugue. Une entree dont la forme ne
// tient pas ne doit pas faire tomber le panneau.
test('une passe de forme inconnue est ecartee sans faire tomber le reste', () => {
  const c = path.join(dossier(), 'pepites.json');
  fs.writeFileSync(c, JSON.stringify({
    passes: [{ quand: 1, prixQuand: 0, pid: 1, lignes: [] }, { pas: 'une passe' }, null, 7],
  }), 'utf8');
  const h = creerHistorique({ chemin: c, onErreur: () => {} });
  assert.strictEqual(h.lire().length, 1);
});

test('un fichier sans tableau de passes repart a vide', () => {
  const c = path.join(dossier(), 'pepites.json');
  fs.writeFileSync(c, JSON.stringify({ autre: 1 }), 'utf8');
  const h = creerHistorique({ chemin: c, onErreur: () => {} });
  assert.deepStrictEqual(h.lire(), []);
});
