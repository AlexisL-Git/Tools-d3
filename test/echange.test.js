'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { TRAME_ACCEPTATION, TRAME_VALIDATION } = require('../src/echange');
const { decodeFrameRaw } = require('../src/codec/rawProto');

// Octets releves le 22/08, identiques a chaque occurrence et dans les deux
// sens. Voir docs/superpowers/specs/2026-08-22-trames-echange.md.
const HEX_ACCEPTATION =
  '12220a150a13747970652e616e6b616d612e636f6d2f6b676910ffffffffffffffffff01';
const HEX_VALIDATION =
  '12280a1b0a13747970652e616e6b616d612e636f6d2f6b657012040801100110ffffffffffffffffff01';

test('la trame d acceptation est celle mesuree', () => {
  assert.strictEqual(TRAME_ACCEPTATION.toString('hex'), HEX_ACCEPTATION);
  assert.notStrictEqual(decodeFrameRaw(TRAME_ACCEPTATION), null);
});

test('la trame de validation est celle mesuree', () => {
  assert.strictEqual(TRAME_VALIDATION.toString('hex'), HEX_VALIDATION);
  assert.notStrictEqual(decodeFrameRaw(TRAME_VALIDATION), null);
});
