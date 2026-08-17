'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const injector = require('../src/injector');

test('le module injector expose son interface', () => {
  assert.strictEqual(typeof injector.redirect, 'function');
  assert.strictEqual(typeof injector.findDofusProcesses, 'function');
  assert.strictEqual(typeof injector.agentSource, 'function');
});

test('la source de l agent hooke connect et réécrit la sockaddr', () => {
  const src = injector.agentSource(9999);
  assert.ok(src.includes("'connect'"), 'doit hooker connect');
  assert.ok(src.includes('writeByteArray'), 'doit réécrire la sockaddr');
  assert.ok(src.includes('9999'), 'doit injecter le port du proxy');
});

test('l agent ne contient aucune évasion anti-cheat', () => {
  const src = injector.agentSource(9999);
  for (const interdit of ['CreateProcessW', 'gethostname', 'GetHostNameW', 'CreateFileW', 'IOPlatformUUID']) {
    assert.ok(!src.includes(interdit), `hors périmètre : ${interdit}`);
  }
});

test('findDofusProcesses ne lève pas si aucun Dofus ne tourne', async () => {
  const found = await injector.findDofusProcesses();
  assert.ok(Array.isArray(found));
});
