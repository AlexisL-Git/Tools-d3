'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { MessageStats } = require('../src/stats');

test('compte les messages par nom', () => {
  const s = new MessageStats();
  s.record({ name: 'hdv', unknown: false });
  s.record({ name: 'hdv', unknown: false });
  s.record({ name: 'abc', unknown: true });
  assert.strictEqual(s.total, 3);
  assert.deepStrictEqual(s.top(1), [{ name: 'hdv', count: 2, unknown: false }]);
});

test('unknownRatio vaut 0 sans message', () => {
  assert.strictEqual(new MessageStats().unknownRatio(), 0);
});

test('unknownRatio reflète la proportion d inconnus', () => {
  const s = new MessageStats();
  s.record({ name: 'a', unknown: false });
  s.record({ name: 'b', unknown: true });
  s.record({ name: 'c', unknown: true });
  assert.ok(Math.abs(s.unknownRatio() - 2 / 3) < 1e-9);
});

test('top trie par fréquence décroissante', () => {
  const s = new MessageStats();
  for (let i = 0; i < 5; i++) s.record({ name: 'beaucoup', unknown: false });
  for (let i = 0; i < 2; i++) s.record({ name: 'peu', unknown: false });
  assert.deepStrictEqual(s.top(2).map((r) => r.name), ['beaucoup', 'peu']);
});
