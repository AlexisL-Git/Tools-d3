'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ecrireArchive, lireArchive } = require('../amorceur/archive');

const RACINE = path.join(__dirname, '..');
const CHEMIN = 'desktop/sons/ping.ogg';

test('le son existe et c est bien un Ogg', () => {
  const brut = fs.readFileSync(path.join(RACINE, CHEMIN));
  assert.strictEqual(brut.subarray(0, 4).toString('latin1'), 'OggS');
});

// Le paquet part chez les amis dans un tar.gz ecrit ici (amorceur/archive.js).
// Un fichier binaire relu octet pour octet, c est la seule preuve que le son
// arrivera jouable et pas denature par un aller-retour en texte.
test('le son traverse l archive sans une seule modification', () => {
  const brut = fs.readFileSync(path.join(RACINE, CHEMIN));
  const relu = lireArchive(ecrireArchive([{ chemin: CHEMIN, contenu: brut }]));
  assert.strictEqual(relu.length, 1);
  assert.strictEqual(relu[0].chemin, CHEMIN);
  assert.ok(relu[0].contenu.equals(brut), 'le contenu relu differe de l original');
});

// L en-tete tar refuse au-dela de 100 caracteres, et faire-paquet-code.js
// leve alors au moment de la fabrication -- trop tard.
test('le chemin du son tient dans un en-tete tar', () => {
  assert.ok(Buffer.byteLength(CHEMIN, 'utf8') <= 100);
});
