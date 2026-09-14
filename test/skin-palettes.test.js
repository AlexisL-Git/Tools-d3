'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// LES DEUX PALETTES COHABITENT PENDANT LA REFONTE, ET C EST LE PIEGE.
// L ancienne declare --fond a #0F1418 (sombre), la nouvelle a #E7EBE4 (clair
// papier). Toutes deux posees sur :root, la seconde ecrase la premiere et
// l application devient illisible -- sans une erreur, sans un avertissement,
// le CSS ne se plaint jamais d une redeclaration.
//
// L ancienne palette porte donc un prefixe --v0- le temps du chantier. Ce
// test garde les deux bouts: aucun jeton nu ne subsiste dans l ancien bloc,
// et le compte des --v0- ne remonte jamais.

const INDEX = path.join(__dirname, '..', 'desktop', 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');

// Les douze noms de l ancienne palette, sans prefixe.
const ANCIENS = [
  'fond', 'releve', 'filet', 'bord', 'texte', 'attenue',
  'arme', 'arme-encre', 'commande', 'commande-encre', 'alerte', 'ui',
];

test('aucun jeton de l ancienne palette ne subsiste sans prefixe', () => {
  const nus = ANCIENS.filter(
    (n) => new RegExp(`var\\(--${n}\\)`).test(html),
  );
  assert.deepStrictEqual(
    nus, [],
    `--${nus.join(', --')} entre en collision avec la nouvelle palette : `
    + 'renomme-les en --v0-...',
  );
});

test('les douze jetons prefixes sont declares', () => {
  for (const n of ANCIENS) {
    assert.ok(
      html.includes(`--v0-${n}:`),
      `--v0-${n} n est pas declare dans desktop/index.html`,
    );
  }
});
