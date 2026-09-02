'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { NOMS } = require('../src/droits/liste');

// desktop/main.js n a pas de test, par decision du proprietaire (revue finale
// du 2026-09-01, constat 6): rien ne verifiait que les noms passes a
// protege(...) et testes par droits().includes(...) / droitsCourants
// .includes(...) correspondent a NOMS. Une faute de frappe -- protege
// ('passetour', ...) -- donne une fonction morte pour tout le monde et pour
// toujours, sans un mot: le nom cible n existe pas dans NOMS, la porte ne le
// trouve donc jamais dans les droits accordes, et rien ne le distingue d une
// fonction simplement non accordee.
//
// Meme motif que test/paquet-fichiers.test.js: on reconcilie une liste
// blanche en lisant la source plutot qu en la recopiant a la main.

const MAIN_JS = path.join(__dirname, '..', 'desktop', 'main.js');
const INDEX_HTML = path.join(__dirname, '..', 'desktop', 'index.html');

function extraire(texte, regex) {
  const trouves = [];
  let m;
  const r = new RegExp(regex, 'g');
  while ((m = r.exec(texte)) !== null) trouves.push(m[1]);
  return trouves;
}

test('chaque nom passe a protege(...) ou compare a des droits, dans desktop/, est un nom connu', () => {
  const mainJs = fs.readFileSync(MAIN_JS, 'utf8');
  const indexHtml = fs.readFileSync(INDEX_HTML, 'utf8');

  const trouves = new Set([
    ...extraire(mainJs, /protege\('([a-z-]+)'/),
    ...extraire(mainJs, /droits\(\)\.includes\('([a-z-]+)'\)/),
    ...extraire(indexHtml, /droitsCourants\.includes\('([a-z-]+)'\)/),
  ]);

  const inconnus = [...trouves].filter((n) => !NOMS.includes(n));
  assert.deepStrictEqual(
    inconnus, [],
    `desktop/ verrouille ${inconnus.join(', ')}, absent de NOMS (src/droits/liste.js) : `
    + 'faute de frappe probable -- cette fonction serait morte pour tout le monde, sans un mot',
  );

  const manquants = NOMS.filter((n) => !trouves.has(n));
  assert.deepStrictEqual(
    manquants, [],
    `NOMS contient ${manquants.join(', ')}, jamais verrouille nulle part dans desktop/ : `
    + 'droit consultatif jamais branche, ou nom deplace sans mettre a jour ce test',
  );
});
