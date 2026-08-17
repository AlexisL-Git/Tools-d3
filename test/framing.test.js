'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { readVarint, writeVarint, FrameReassembler } = require('../src/codec/framing');

function frame(payload) {
  return Buffer.concat([writeVarint(payload.length), payload]);
}

test('writeVarint/readVarint font un aller-retour', () => {
  for (const n of [0, 1, 127, 128, 300, 16383, 16384, 1000000]) {
    const buf = writeVarint(n);
    assert.deepStrictEqual(readVarint(buf, 0), { value: n, bytes: buf.length }, `valeur ${n}`);
  }
});

test('readVarint retourne null sur un varint incomplet', () => {
  assert.strictEqual(readVarint(Buffer.from([0x80]), 0), null);
});

test('une trame complète dans un seul chunk', () => {
  const r = new FrameReassembler();
  const out = r.push(frame(Buffer.from('hello')));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].toString(), 'hello');
  assert.strictEqual(r.pending, 0);
});

test('deux trames dans un seul chunk', () => {
  const r = new FrameReassembler();
  const out = r.push(Buffer.concat([frame(Buffer.from('aa')), frame(Buffer.from('bbb'))]));
  assert.deepStrictEqual(out.map(String), ['aa', 'bbb']);
});

test('une trame coupée octet par octet est reconstituée', () => {
  const payload = Buffer.alloc(300, 0x41);
  const full = frame(payload);
  const r = new FrameReassembler();
  const collected = [];
  for (const byte of full) collected.push(...r.push(Buffer.from([byte])));
  assert.strictEqual(collected.length, 1);
  assert.ok(collected[0].equals(payload));
});

test('un préfixe varint coupé entre deux chunks est reconstitué', () => {
  const payload = Buffer.alloc(300, 0x42);
  const full = frame(payload);
  const r = new FrameReassembler();
  assert.deepStrictEqual(r.push(full.subarray(0, 1)), []);
  const out = r.push(full.subarray(1));
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].equals(payload));
});

test('une trame surdimensionnée lève une erreur', () => {
  const r = new FrameReassembler({ maxFrame: 16 });
  assert.throws(() => r.push(frame(Buffer.alloc(64))), /trame trop grande/);
});

test('pending reflète les octets en attente', () => {
  const r = new FrameReassembler();
  r.push(frame(Buffer.alloc(100)).subarray(0, 10));
  assert.strictEqual(r.pending, 10);
});
