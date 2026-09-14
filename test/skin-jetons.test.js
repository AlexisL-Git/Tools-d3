'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// UN JETON EMPLOYE MAIS JAMAIS DECLARE NE FAIT PAS D ERREUR: var(--truc)
// sans repli rend la propriete invalide, et l element retombe sur sa valeur
// heritee. Un fond disparait, un texte passe en noir sur noir, et rien --
// ni le navigateur, ni les tests -- ne dit pourquoi.
//
// Ce test relie les deux bouts: tout var(--x) ecrit dans desktop/skin/ doit
// trouver son --x: declare dans jetons.css.

const SKIN = path.join(__dirname, '..', 'desktop', 'skin');
const JETONS = path.join(SKIN, 'jetons.css');

const declares = () => {
  const src = fs.readFileSync(JETONS, 'utf8');
  return new Set([...src.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
};

test('jetons.css declare les deux themes', () => {
  const src = fs.readFileSync(JETONS, 'utf8');
  assert.ok(src.includes('[data-theme="sombre"]'), 'le theme sombre manque');
  assert.ok(
    src.includes('prefers-color-scheme'),
    'le suivi du theme de Windows manque : sans lui, le defaut ne suit rien',
  );
});

test('tout jeton employe dans skin/ est declare dans jetons.css', () => {
  const connus = declares();
  const inconnus = new Set();
  for (const f of fs.readdirSync(SKIN)) {
    if (!f.endsWith('.css')) continue;
    const src = fs.readFileSync(path.join(SKIN, f), 'utf8');
    for (const m of src.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
      if (!connus.has(m[1])) inconnus.add(`${f} : ${m[1]}`);
    }
  }
  assert.deepStrictEqual([...inconnus], []);
});
