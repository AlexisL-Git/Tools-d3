'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFrameRaw } = require('../src/codec/rawProto');
const { lireStock, POSITION_INVENTAIRE } = require('../src/hdv/trames');

const fixture = (nom) => decodeFrameRaw(
  Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures', nom), 'utf8').trim(), 'hex'),
);

// L'inventaire de connexion du 03/09: 471 piles, 454 rangees, 17 portees.
// UNE SEULE pile n'a pas de champ 1 -- l'amulette, position 0. La lire comme
// 63 la ferait passer pour rangee, et le compte tomberait a 455 et 16.
test('lireStock rend la position, et un champ absent vaut 0 et non 63', () => {
  const piles = lireStock(fixture('chasse-ivx-inventaire.hex'));
  assert.strictEqual(piles.length, 471);
  assert.strictEqual(piles.filter((p) => p.pos === POSITION_INVENTAIRE).length, 454);
  assert.strictEqual(piles.filter((p) => p.pos !== POSITION_INVENTAIRE).length, 17);
  assert.strictEqual(piles.filter((p) => p.pos === 0).length, 1);
});

// La position 31 est l'emplacement de la pierre d'ame, mesure du 03/09.
test('la pierre d ame portee se trouve en position 31', () => {
  const piles = lireStock(fixture('chasse-ivx-inventaire.hex'));
  const portees = piles.filter((p) => p.pos === 31);
  assert.strictEqual(portees.length, 1);
  assert.strictEqual(portees[0].gid, 9687);
  assert.strictEqual(portees[0].uid, 233525940);
  assert.strictEqual(portees[0].qte, 47);
});
