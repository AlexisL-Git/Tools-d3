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
      // `raw` porte toujours les octets exacts du champ, quel que soit le
      // kind devine ci-dessous. Un champ LEN est ambigu par construction:
      // une chaine, un sous-message et une suite d'octets quelconque
      // (comme des varints empaquetes) sont indiscernables sans schema.
      // Devriner un `string` ou un `message` a tort n'est pas grave pour la
      // lecture, mais l'etait pour un appelant qui exigeait `Buffer.isBuffer
      // (value)`: un chemin de deplacement, une fois sur dix, tombe en
      // 'string' ou 'message' et se faisait refuser a tort (IMPORTANT de
      // revue finale). Lire `raw` au lieu de `value` evite de dependre du
      // kind devine.
      const raw = Buffer.from(sub);
      const text = sub.toString('latin1');
      if (n > 3 && PRINTABLE.test(text)) out.push({ no, wire, value: text, kind: 'string', raw });
      else {
        // Un sous-message et une suite d'octets quelconque sont indiscernables
        // a priori: on tente le decodage et on retombe sur les octets bruts.
        const inner = depth > 0 && n > 0 ? decodeRaw(sub, depth - 1) : null;
        if (inner !== null) out.push({ no, wire, value: inner, kind: 'message', raw });
        else out.push({ no, wire, value: raw, kind: 'bytes', raw });
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
//
// LES NUMEROS DE CETTE ENVELOPPE NE SONT PAS STABLES. Le patch 3.6.11.12 du
// 08/09 les a rebattus: le sens entrant est passe du kind 1 au kind 2, le
// sortant du 2 au 1, et le Any des events du champ 1 au CHAMP 3. Le cout a
// ete total et SILENCIEUX — 292 trames sur 296 rendues null, donc HDV, PDA et
// passe-tour eteints d'un coup, sans une ligne d'erreur.
//
// Les etiquettes suivent donc le protocole COURANT, celui de 3.6.11.12: mesure
// du 08/09 sur 63 requetes sortantes, toutes en kind 1, et sur 244 events
// entrants, tous en kind 2. Relire une trame d'aout avec cette table lui donne
// l'etiquette de l'autre sens — c'est assume: aucune logique metier ne consomme
// `kind`, et une table qui mentirait sur le protocole d'aujourd'hui tromperait
// a chaque lecture plutot qu'une fois par archive.
const KINDS = { 1: 'request', 2: 'event', 3: 'response' };

const PREFIXE_URL = 'type.ankama.com/';

// On RECONNAIT le Any a sa forme plutot qu'a son numero: un message dont le
// champ 1 est un type_url. Figer le numero, c'est se recasser au prochain
// patch — il a deja bouge. La forme, elle, tient depuis le 19/08.
function trouverAny(champs) {
  for (const f of champs || []) {
    if (f.kind !== 'message') continue;
    const url = field(f.value, 1);
    if (url !== null && url.kind === 'string' && String(url.value).startsWith(PREFIXE_URL)) return f;
  }
  return null;
}

function decodeFrameRaw(frame) {
  const top = decodeRaw(frame, 6);
  if (top === null || top.length === 0) return null;

  for (const [no, kind] of Object.entries(KINDS)) {
    const box = field(top, Number(no));
    if (box === null || box.kind !== 'message') continue;

    const content = trouverAny(box.value);
    const uid = field(box.value, 2);
    if (content === null) continue;

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

// --- Encodage ---
//
// Rejouer une action sur un autre compte suppose parfois d'y remplacer un
// champ. Une retouche octet par octet ne tient pas: changer un entier change
// sa longueur en varint, donc celle de tous les messages qui l'englobent. Il
// faut reconstruire la trame.

function encodeVarint(v) {
  let x = typeof v === 'bigint' ? v : BigInt(v);
  // Un nombre negatif s'encode sur dix octets, en complement a deux sur 64
  // bits: c'est ainsi que uid = -1 apparait dans le trafic reel.
  if (x < 0n) x += 1n << 64n;
  const out = [];
  do {
    let b = Number(x & 0x7fn);
    x >>= 7n;
    if (x > 0n) b |= 0x80;
    out.push(b);
  } while (x > 0n);
  return Buffer.from(out);
}

function encodeRaw(fields) {
  const morceaux = [];
  for (const f of fields) {
    const cle = encodeVarint((BigInt(f.no) << 3n) | BigInt(f.wire));
    if (f.wire === WIRE.VARINT) {
      morceaux.push(cle, encodeVarint(f.value));
    } else if (f.wire === WIRE.LEN) {
      let corps;
      if (f.kind === 'message') corps = encodeRaw(f.value);
      else if (f.kind === 'string') corps = Buffer.from(f.value, 'latin1');
      else corps = Buffer.from(f.value);
      morceaux.push(cle, encodeVarint(corps.length), corps);
    } else if (f.wire === WIRE.I64) {
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(typeof f.value === 'bigint' ? f.value : BigInt(f.value));
      morceaux.push(cle, b);
    } else if (f.wire === WIRE.I32) {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(Number(f.value));
      morceaux.push(cle, b);
    } else {
      throw new Error(`type de fil ${f.wire} non encodable`);
    }
  }
  return Buffer.concat(morceaux);
}

// Remplace la valeur d'un champ du contenu applicatif, en laissant intacts
// l'enveloppe, l'URL de type et l'uid. Rend la trame reconstruite, sans
// prefixe de longueur.
function remplacerChamp(frameBrute, noChamp, valeur) {
  const top = decodeRaw(frameBrute, 6);
  if (top === null) return null;

  for (const boite of top) {
    if (boite.kind !== 'message') continue;
    const contenu = boite.value.find((f) => f.no === 1 && f.kind === 'message');
    if (!contenu) continue;
    const valeurAny = contenu.value.find((f) => f.no === 2 && f.kind === 'message');
    if (!valeurAny) return null;
    const cible = valeurAny.value.find((f) => f.no === noChamp);
    if (!cible) return null;
    cible.value = typeof valeur === 'bigint' ? valeur : BigInt(valeur);
    cible.wire = WIRE.VARINT;
    delete cible.kind;
    return encodeRaw(top);
  }
  return null;
}

module.exports = { decodeRaw, decodeFrameRaw, encodeRaw, encodeVarint, remplacerChamp, render, asSigned, WIRE };
