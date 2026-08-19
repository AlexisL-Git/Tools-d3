'use strict';

// Decodage protobuf SANS schema.
//
// Les 1414 .proto du cache sont perimes face au client actuel, et les classes
// du jeu sont obfusquees. Mais le format protobuf est auto-descriptif: chaque
// champ porte son numero et son type de fil. On peut donc lire la structure
// d'un message inconnu — sans les noms, mais avec les valeurs, ce qui suffit
// pour comparer deux trames champ par champ et reperer ce qu'un relais
// substitue au passage.

const WIRE = { VARINT: 0, I64: 1, LEN: 2, I32: 5 };

function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  let i = pos;
  while (i < buf.length) {
    const byte = buf[i++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: result, next: i };
    shift += 7n;
    if (shift > 63n) return null;
  }
  return null;
}

// Un varint negatif est encode sur 10 octets, tous bits a 1 en tete. Sans cette
// conversion, uid = -1 se lirait 18446744073709551615.
function asSigned(v) {
  return v >= 1n << 63n ? v - (1n << 64n) : v;
}

const PRINTABLE = /^[\x20-\x7e]+$/;

function decodeRaw(buf, depth = 4) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    const key = readVarint(buf, pos);
    if (key === null) return null;
    pos = key.next;
    const no = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    if (no === 0) return null;

    if (wire === WIRE.VARINT) {
      const v = readVarint(buf, pos);
      if (v === null) return null;
      pos = v.next;
      out.push({ no, wire, value: asSigned(v.value) });
    } else if (wire === WIRE.LEN) {
      const len = readVarint(buf, pos);
      if (len === null) return null;
      const n = Number(len.value);
      const end = len.next + n;
      if (end > buf.length) return null;
      const sub = buf.subarray(len.next, end);
      pos = end;
      const text = sub.toString('latin1');
      if (n > 3 && PRINTABLE.test(text)) out.push({ no, wire, value: text, kind: 'string' });
      else {
        // Un sous-message et une suite d'octets quelconque sont indiscernables
        // a priori: on tente le decodage et on retombe sur les octets bruts.
        const inner = depth > 0 && n > 0 ? decodeRaw(sub, depth - 1) : null;
        if (inner !== null) out.push({ no, wire, value: inner, kind: 'message' });
        else out.push({ no, wire, value: Buffer.from(sub), kind: 'bytes' });
      }
    } else if (wire === WIRE.I64) {
      if (pos + 8 > buf.length) return null;
      out.push({ no, wire, value: buf.readBigUInt64LE(pos) });
      pos += 8;
    } else if (wire === WIRE.I32) {
      if (pos + 4 > buf.length) return null;
      out.push({ no, wire, value: buf.readUInt32LE(pos) });
      pos += 4;
    } else {
      return null;
    }
  }
  return out;
}

const field = (fields, no) => (fields || []).find((f) => f.no === no) || null;

// Structure etablie par la mesure du 19/08, et conforme au modele de
// src/codec/envelope.js:
//   Message { event = 1 | request = 2 | response = 3 }
//   chacun  { Any content = 1 ; int64 uid = 2 }
//   Any     { string type_url = 1 ; bytes value = 2 }
const KINDS = { 1: 'event', 2: 'request', 3: 'response' };

function decodeFrameRaw(frame) {
  const top = decodeRaw(frame, 6);
  if (top === null || top.length === 0) return null;

  for (const [no, kind] of Object.entries(KINDS)) {
    const box = field(top, Number(no));
    if (box === null || box.kind !== 'message') continue;

    const content = field(box.value, 1);
    const uid = field(box.value, 2);
    if (content === null || content.kind !== 'message') continue;

    const typeUrl = field(content.value, 1);
    const value = field(content.value, 2);
    return {
      kind,
      uid: uid === null ? null : uid.value,
      type: typeUrl === null ? null : String(typeUrl.value).replace(/^type\.ankama\.com\//, ''),
      payload: value === null ? null : value.value,
    };
  }
  return null;
}

function render(fields, indent = '') {
  if (!Array.isArray(fields)) return String(fields);
  return fields
    .map((f) => {
      if (f.kind === 'message') return `${indent}${f.no} {\n${render(f.value, indent + '  ')}\n${indent}}`;
      if (f.kind === 'bytes') return `${indent}${f.no} = 0x${f.value.toString('hex')}`;
      if (f.kind === 'string') return `${indent}${f.no} = ${JSON.stringify(f.value)}`;
      return `${indent}${f.no} = ${f.value}`;
    })
    .join('\n');
}

module.exports = { decodeRaw, decodeFrameRaw, render, asSigned, WIRE };
