'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { shannonEntropy } = require('../src/analysis/entropy');
const { probeFraming, verdict } = require('../src/analysis/framingProbe');
const { writeVarint } = require('../src/codec/framing');

test('l entropie d un buffer constant vaut 0', () => {
  assert.strictEqual(shannonEntropy(Buffer.alloc(1000, 0x41)), 0);
});

test('l entropie de données aléatoires approche 8', () => {
  const e = shannonEntropy(crypto.randomBytes(65536));
  assert.ok(e > 7.9, `attendu > 7.9, obtenu ${e}`);
});

test('l entropie d un buffer vide vaut 0', () => {
  assert.strictEqual(shannonEntropy(Buffer.alloc(0)), 0);
});

test('probeFraming consomme tout un flux bien formé', () => {
  const payloads = [Buffer.alloc(10, 1), Buffer.alloc(200, 2), Buffer.alloc(30, 3)];
  const stream = Buffer.concat(payloads.map((p) => Buffer.concat([writeVarint(p.length), p])));
  const r = probeFraming([stream]);
  assert.strictEqual(r.frames, 3);
  assert.strictEqual(r.bytesTotal, stream.length);
  assert.ok(r.ratio > 0.99, `ratio ${r.ratio}`);
});

test('probeFraming consomme peu sur du bruit aléatoire', () => {
  const r = probeFraming([crypto.randomBytes(65536)]);
  assert.ok(r.ratio < 0.9, `ratio ${r.ratio} — du bruit ne devrait pas se réassembler proprement`);
});

test('verdict conclut au clair sur entropie basse et ratio haut', () => {
  assert.strictEqual(verdict({ entropy: 5.2, ratio: 0.99 }).conclusion, 'clair');
});

test('verdict conclut au chiffré sur entropie haute', () => {
  assert.strictEqual(verdict({ entropy: 7.95, ratio: 0.2 }).conclusion, 'chiffré');
});

test('verdict reste indéterminé sur des signaux contradictoires', () => {
  assert.strictEqual(verdict({ entropy: 7.95, ratio: 0.99 }).conclusion, 'indéterminé');
});
