'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encodeRecord, decodeRecords } = require('../src/capture/format');
const { Recorder } = require('../src/capture/recorder');
const { Player } = require('../src/capture/player');

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-')), 'capture.bin');
}

test('un enregistrement fait un aller-retour', () => {
  const rec = { direction: 'in', timestamp: 1755400000000, payload: Buffer.from('abc') };
  const out = decodeRecords(encodeRecord(rec));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].direction, 'in');
  assert.strictEqual(out[0].timestamp, 1755400000000);
  assert.strictEqual(out[0].payload.toString(), 'abc');
});

test('plusieurs enregistrements concaténés se décodent dans l ordre', () => {
  const a = encodeRecord({ direction: 'in', timestamp: 1, payload: Buffer.from('aa') });
  const b = encodeRecord({ direction: 'out', timestamp: 2, payload: Buffer.from('bbb') });
  const out = decodeRecords(Buffer.concat([a, b]));
  assert.deepStrictEqual(out.map((r) => r.direction), ['in', 'out']);
  assert.deepStrictEqual(out.map((r) => r.payload.toString()), ['aa', 'bbb']);
});

test('un enregistrement tronqué est ignoré plutôt que de faire planter', () => {
  const full = encodeRecord({ direction: 'in', timestamp: 1, payload: Buffer.from('abcdef') });
  const out = decodeRecords(full.subarray(0, full.length - 2));
  assert.deepStrictEqual(out, []);
});

test('une charge vide est supportée', () => {
  const out = decodeRecords(encodeRecord({ direction: 'out', timestamp: 5, payload: Buffer.alloc(0) }));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].payload.length, 0);
});

test('Recorder écrit un fichier que Player relit', () => {
  const file = tmpFile();
  const rec = new Recorder(file);
  rec.write('in', Buffer.from('un'));
  rec.write('out', Buffer.from('deux'));
  rec.close();

  const records = Player.load(file).records();
  assert.deepStrictEqual(records.map((r) => r.direction), ['in', 'out']);
  assert.deepStrictEqual(records.map((r) => r.payload.toString()), ['un', 'deux']);
  assert.ok(records[0].timestamp > 0);
});

test('le descripteur de socket est conservé', () => {
  const out = decodeRecords(
    Buffer.concat([
      encodeRecord({ direction: 'in', timestamp: 1, payload: Buffer.from('a'), socket: 1234 }),
      encodeRecord({ direction: 'out', timestamp: 2, payload: Buffer.from('b'), socket: 5678 }),
    ])
  );
  assert.deepStrictEqual(out.map((r) => r.socket), [1234, 5678]);
});

test('socket vaut 0 par défaut', () => {
  const out = decodeRecords(encodeRecord({ direction: 'in', timestamp: 1, payload: Buffer.from('x') }));
  assert.strictEqual(out[0].socket, 0);
});

test('Recorder transmet la socket et cumule les octets', () => {
  const file = tmpFile();
  const rec = new Recorder(file);
  rec.write('in', Buffer.from('abc'), 99);
  rec.write('in', Buffer.from('de'), 99);
  rec.close();
  assert.strictEqual(rec.bytes, 5);
  assert.deepStrictEqual(Player.load(file).records().map((r) => r.socket), [99, 99]);
});
