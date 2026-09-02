'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// LE PIEGE DES DEUX LISTES BLANCHES, encore une fois (revue finale du
// 2026-09-01, constat 8). Deja coute une archive vide au projet une premiere
// fois (FICHIERS_DESKTOP / faire-paquet-code.js, voir test/paquet-fichiers
// .test.js) et une seconde (FONCTIONS, voir test/droits-liste.test.js: "LA
// COPIE DU SERVEUR EST IDENTIQUE").
//
// desktop/main.js recopie 'https://paquets-maj.vercel.app', deja present dans
// amorceur/principal.js -- amorceur/ n est pas require-able depuis desktop/
// (paquets separes), donc la duplication est inevitable. Ce test est ce qui
// l empeche de deriver en silence: une URL qui bouge d un cote sans l autre
// ferait interroger le mauvais service pour la veille des droits.

const AMORCEUR = path.join(__dirname, '..', 'amorceur', 'principal.js');
const MAIN_JS = path.join(__dirname, '..', 'desktop', 'main.js');

test('la base vercel de desktop/main.js est identique a celle de amorceur/principal.js', () => {
  const amorceur = fs.readFileSync(AMORCEUR, 'utf8');
  const mainJs = fs.readFileSync(MAIN_JS, 'utf8');

  const dansAmorceur = amorceur.match(/const BASE = '(https:\/\/[^']+)'/);
  const dansMain = mainJs.match(/base: '(https:\/\/[^']+)'/);

  assert.ok(dansAmorceur, "amorceur/principal.js: const BASE = '...' introuvable -- le motif attendu a change");
  assert.ok(dansMain, "desktop/main.js: base: '...' introuvable dans l appel a creerVeille -- le motif attendu a change");
  assert.strictEqual(
    dansMain[1], dansAmorceur[1],
    'desktop/main.js et amorceur/principal.js pointent vers deux bases differentes',
  );
});
