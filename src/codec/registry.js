'use strict';
const fs = require('node:fs');
const path = require('node:path');
const protobuf = require('protobufjs');

// Un registre porte PLUSIEURS roots, cherchés dans l'ordre.
//
// C'est imposé par la réalité du jeu de .proto de Dofus :
//   - l'enveloppe (Message/Event/Request/Response) vit dans _Message.proto,
//     sans package, à la racine du cache ;
//   - les 1414 messages de jeu vivent dans game/ ;
//   - le protocole de connexion vit dans connection/, et ses deux fichiers
//     déclarent chacun un Request dans le MÊME package — les charger dans un
//     root unique lève "duplicate name 'Request'".
//
// Un root par source règle les trois cas sans logique particulière.
class Registry {
  constructor(roots) {
    this.roots = roots;
    this._cache = new Map();
  }

  typeNameFromUrl(typeUrl) {
    const slash = typeUrl.lastIndexOf('/');
    return slash === -1 ? typeUrl : typeUrl.slice(slash + 1);
  }

  lookup(name) {
    if (this._cache.has(name)) return this._cache.get(name);
    let type = null;
    for (const root of this.roots) {
      try {
        type = root.lookupType(name);
        break;
      } catch (err) {
        type = null;
      }
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

function filesOf(source) {
  if (!fs.existsSync(source)) throw new Error(`source introuvable: ${source}`);
  if (fs.statSync(source).isFile()) return [source];
  return fs
    .readdirSync(source)
    .filter((entry) => entry.endsWith('.proto'))
    .map((entry) => path.join(source, entry));
}

// sources: tableau de chemins, chacun étant un fichier .proto ou un répertoire.
// Chaque source devient un root distinct.
async function loadRegistry(sources) {
  const roots = [];
  for (const source of sources) {
    const files = filesOf(source);
    if (files.length === 0) throw new Error(`aucun .proto trouvé dans ${source}`);
    roots.push(await protobuf.load(files));
  }
  if (roots.length === 0) throw new Error('aucune source fournie');
  return new Registry(roots);
}

module.exports = { loadRegistry, Registry };
