'use strict';
const fs = require('node:fs');
const path = require('node:path');
const protobuf = require('protobufjs');

class Registry {
  constructor(root) {
    this.root = root;
    this._cache = new Map();
  }

  typeNameFromUrl(typeUrl) {
    const slash = typeUrl.lastIndexOf('/');
    return slash === -1 ? typeUrl : typeUrl.slice(slash + 1);
  }

  lookup(name) {
    if (this._cache.has(name)) return this._cache.get(name);
    let type = null;
    try {
      type = this.root.lookupType(name);
    } catch (err) {
      type = null;
    }
    this._cache.set(name, type);
    return type;
  }

  decodeAny(any) {
    const name = this.typeNameFromUrl(any.type_url || any.typeUrl || '');
    const type = this.lookup(name);
    if (type === null) return { name, payload: null, unknown: true };
    return { name, payload: type.toObject(type.decode(any.value), { defaults: true }), unknown: false };
  }
}

async function loadRegistry(protoDirs) {
  const files = [];
  for (const dir of protoDirs) {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith('.proto')) files.push(path.join(dir, entry));
    }
  }
  if (files.length === 0) throw new Error(`aucun .proto trouvé dans ${protoDirs.join(', ')}`);
  const root = await protobuf.load(files);
  return new Registry(root);
}

module.exports = { loadRegistry, Registry };
