'use strict';

const HEADER_SIZE = 1 + 8 + 4;

function encodeRecord({ direction, timestamp, payload }) {
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt8(direction === 'in' ? 0 : 1, 0);
  header.writeDoubleLE(timestamp, 1);
  header.writeUInt32LE(payload.length, 9);
  return Buffer.concat([header, payload]);
}

function decodeRecords(buf) {
  const records = [];
  let offset = 0;
  while (offset + HEADER_SIZE <= buf.length) {
    const direction = buf.readUInt8(offset) === 0 ? 'in' : 'out';
    const timestamp = buf.readDoubleLE(offset + 1);
    const length = buf.readUInt32LE(offset + 9);
    const start = offset + HEADER_SIZE;
    if (start + length > buf.length) break;
    records.push({ direction, timestamp, payload: Buffer.from(buf.subarray(start, start + length)) });
    offset = start + length;
  }
  return records;
}

module.exports = { encodeRecord, decodeRecords, HEADER_SIZE };
