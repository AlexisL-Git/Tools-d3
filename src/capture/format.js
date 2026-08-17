'use strict';

// Enregistrement, en petit-boutien :
//   [u8  direction]   0 = in, 1 = out
//   [f64 timestamp]   millisecondes epoch
//   [u32 socket]      identifiant de socket (0 = inconnu / source proxy)
//   [u32 length]
//   [bytes payload]
//
// Le champ socket est indispensable pour les captures par hook send/recv :
// elles voient toutes les sockets du process, et réassembler des trames en
// mélangeant plusieurs flux TCP produit du n'importe quoi.
const HEADER_SIZE = 1 + 8 + 4 + 4;

function encodeRecord({ direction, timestamp, payload, socket = 0 }) {
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt8(direction === 'in' ? 0 : 1, 0);
  header.writeDoubleLE(timestamp, 1);
  header.writeUInt32LE(socket >>> 0, 9);
  header.writeUInt32LE(payload.length, 13);
  return Buffer.concat([header, payload]);
}

function decodeRecords(buf) {
  const records = [];
  let offset = 0;
  while (offset + HEADER_SIZE <= buf.length) {
    const direction = buf.readUInt8(offset) === 0 ? 'in' : 'out';
    const timestamp = buf.readDoubleLE(offset + 1);
    const socket = buf.readUInt32LE(offset + 9);
    const length = buf.readUInt32LE(offset + 13);
    const start = offset + HEADER_SIZE;
    if (start + length > buf.length) break;
    records.push({
      direction,
      timestamp,
      socket,
      payload: Buffer.from(buf.subarray(start, start + length)),
    });
    offset = start + length;
  }
  return records;
}

module.exports = { encodeRecord, decodeRecords, HEADER_SIZE };
