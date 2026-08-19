'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decodeRaw, decodeFrameRaw, render } = require('../src/codec/rawProto');

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');

test('lit un varint simple', () => {
  assert.deepStrictEqual(decodeRaw(hex('08 96 01')), [{ no: 1, wire: 0, value: 150n }]);
});

// uid = -1 est encode sur dix octets tous bits a 1. Sans conversion signee il
// se lirait 18446744073709551615, ce qui masquerait completement sa nature.
test('rend un varint négatif comme tel', () => {
  const out = decodeRaw(hex('10 ff ff ff ff ff ff ff ff ff 01'));
  assert.strictEqual(out[0].value, -1n);
});

test('reconnaît une chaîne imprimable', () => {
  const out = decodeRaw(Buffer.concat([hex('0a 13'), Buffer.from('type.ankama.com/jsj')]));
  assert.strictEqual(out[0].kind, 'string');
  assert.strictEqual(out[0].value, 'type.ankama.com/jsj');
});

test('descend dans un sous-message', () => {
  const out = decodeRaw(hex('12 03 08 96 01'));
  assert.strictEqual(out[0].kind, 'message');
  assert.strictEqual(out[0].value[0].value, 150n);
});

test('rend null sur des octets qui ne sont pas du protobuf', () => {
  assert.strictEqual(decodeRaw(hex('ff ff ff')), null);
});

// Trame reelle, relevee le 19/08 sur la socket 0x604 du proxy de l'esclave:
// c'est l'une des quatre que le proxy de krm35 a injectees.
const HJC_INJECTE = hex(
  '12 2b 0a 1e 0a 13 74 79 70 65 2e 61 6e 6b 61 6d 61 2e 63 6f 6d 2f 68 6a 63' +
  '12 07 08 03 18 82 90 90 5b 10 ff ff ff ff ff ff ff ff ff 01',
);

test('décode une trame réelle du jeu', () => {
  const f = decodeFrameRaw(HJC_INJECTE);
  assert.notStrictEqual(f, null);
  assert.strictEqual(f.kind, 'request');
  assert.strictEqual(f.type, 'hjc');
  assert.strictEqual(f.uid, -1n);
});

test('le contenu du Any est décodé en champs', () => {
  const f = decodeFrameRaw(HJC_INJECTE);
  const nums = f.payload.map((x) => [x.no, x.value]);
  assert.deepStrictEqual(nums, [[1, 3n], [3, 191105026n]]);
});

test('rend null sur une trame sans enveloppe reconnaissable', () => {
  assert.strictEqual(decodeFrameRaw(hex('08 01')), null);
});

test('render produit un texte lisible', () => {
  const txt = render(decodeRaw(hex('12 03 08 96 01')));
  assert.match(txt, /2 \{/, 'le tag 0x12 est le champ 2, pas le champ 1');
  assert.match(txt, /1 = 150/);
});
