'use strict';

const DEFAULT_MAX_FRAME = 8 * 1024 * 1024;

function readVarint(buf, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result += (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) return { value: result, bytes: pos - offset };
    shift += 7;
    if (shift > 35) throw new Error('varint trop long');
  }
  return null;
}

function writeVarint(value) {
  const bytes = [];
  let v = value;
  do {
    let byte = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) byte |= 0x80;
    bytes.push(byte);
  } while (v > 0);
  return Buffer.from(bytes);
}

class FrameReassembler {
  constructor({ maxFrame = DEFAULT_MAX_FRAME } = {}) {
    this._buf = Buffer.alloc(0);
    this._maxFrame = maxFrame;
  }

  get pending() {
    return this._buf.length;
  }

  getBuffer() {
    return Buffer.from(this._buf);
  }

  flush() {
    const octets = Buffer.from(this._buf);
    this._buf = Buffer.alloc(0);
    return octets;
  }

  push(chunk) {
    this._buf = this._buf.length === 0 ? chunk : Buffer.concat([this._buf, chunk]);
    const frames = [];
    for (;;) {
      const header = readVarint(this._buf, 0);
      if (header === null) break;
      if (header.value > this._maxFrame) {
        throw new Error(`trame trop grande: ${header.value} octets`);
      }
      const total = header.bytes + header.value;
      if (this._buf.length < total) break;
      frames.push(Buffer.from(this._buf.subarray(header.bytes, total)));
      this._buf = Buffer.from(this._buf.subarray(total));
    }
    return frames;
  }
}

module.exports = { readVarint, writeVarint, FrameReassembler, DEFAULT_MAX_FRAME };
