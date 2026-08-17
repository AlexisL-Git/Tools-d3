'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const protobuf = require('protobufjs');
const { loadRegistry } = require('../src/codec/registry');
const { decodeEnvelope } = require('../src/codec/envelope');

const FIXTURES = path.join(__dirname, 'fixtures', 'proto');

async function buildFrame(kind, { uid = 0, typeName = 'hdv', body = { dzpx: 1, dzpy: 42 } } = {}) {
  const root = await protobuf.load([
    path.join(FIXTURES, 'Envelope.proto'),
    path.join(FIXTURES, 'Sample.proto'),
  ]);
  const Message = root.lookupType('Message');
  const Inner = root.lookupType(typeName);
  const any = {
    type_url: `type.googleapis.com/${typeName}`,
    value: Inner.encode(Inner.create(body)).finish(),
  };
  const content = kind === 'event' ? { content: any } : { uid, content: any };
  return Buffer.from(Message.encode(Message.create({ [kind]: content })).finish());
}

test('typeNameFromUrl extrait le nom du type', async () => {
  const registry = await loadRegistry([FIXTURES]);
  assert.strictEqual(registry.typeNameFromUrl('type.googleapis.com/hdv'), 'hdv');
  assert.strictEqual(registry.typeNameFromUrl('hdv'), 'hdv');
});

test('décode un Event et résout son type', async () => {
  const registry = await loadRegistry([FIXTURES]);
  const out = decodeEnvelope(registry, await buildFrame('event'));
  assert.strictEqual(out.kind, 'event');
  assert.strictEqual(out.name, 'hdv');
  assert.strictEqual(out.unknown, false);
  assert.strictEqual(out.uid, null);
  assert.strictEqual(out.payload.dzpy, 42);
});

test('décode un Request et remonte son uid', async () => {
  const registry = await loadRegistry([FIXTURES]);
  const out = decodeEnvelope(registry, await buildFrame('request', { uid: 7 }));
  assert.strictEqual(out.kind, 'request');
  assert.strictEqual(out.uid, 7);
  assert.strictEqual(out.name, 'hdv');
});

test('décode un Response et remonte son uid', async () => {
  const registry = await loadRegistry([FIXTURES]);
  const out = decodeEnvelope(registry, await buildFrame('response', { uid: 99 }));
  assert.strictEqual(out.kind, 'response');
  assert.strictEqual(out.uid, 99);
});

test('un type inconnu est marqué unknown sans lever', async () => {
  const registry = await loadRegistry([FIXTURES]);
  const root = await protobuf.load([path.join(FIXTURES, 'Envelope.proto')]);
  const Message = root.lookupType('Message');
  const frame = Buffer.from(
    Message.encode(
      Message.create({
        event: { content: { type_url: 'type.googleapis.com/zzz', value: Buffer.from([0x08, 0x01]) } },
      })
    ).finish()
  );
  const out = decodeEnvelope(registry, frame);
  assert.strictEqual(out.unknown, true);
  assert.strictEqual(out.name, 'zzz');
  assert.strictEqual(out.payload, null);
});

test('une trame illisible lève une erreur explicite', async () => {
  const registry = await loadRegistry([FIXTURES]);
  assert.throws(() => decodeEnvelope(registry, Buffer.from([0xff, 0xff, 0xff])), /enveloppe/);
});
