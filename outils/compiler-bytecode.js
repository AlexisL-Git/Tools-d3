'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const v8 = require('node:v8');
const crypto = require('node:crypto');
const Module = require('node:module');

// A LANCER AVEC L'ELECTRON DU PAQUET, jamais avec node:
//   .\node_modules\electron\dist\electron.exe outils\compiler-bytecode.js <dossier>
// Le cache V8 ne se recharge que dans le moteur qui l'a produit.
v8.setFlagsFromString('--no-lazy');

// Meme enveloppe que celle de Node autour d'un module CommonJS: le cache doit
// correspondre au code reellement execute au chargement. Module.wrap est
// deprecie — on ecrit l'enveloppe a la main quand il a disparu, c'est une
// chaine fixe et non une reconstitution approximative.
function envelopper(source) {
  if (typeof Module.wrap === 'function') return Module.wrap(source);
  return '(function (exports, require, module, __filename, __dirname) { ' + source + '\n});';
}

function compilerSource(source) {
  const enveloppe = envelopper(source);
  const script = new vm.Script(enveloppe, { produceCachedData: true });
  if (!script.cachedData) throw new Error('V8 n a produit aucun cache');
  // Voir amorceur/jsc.js pour le format: longueur, puis empreinte du cache.
  // Un cache abime tue le processus au lieu d'etre rejete — l'empreinte est
  // ce qui permet de le refuser AVANT de le donner a V8.
  const entete = Buffer.alloc(4);
  entete.writeUInt32LE(Buffer.byteLength(enveloppe), 0);
  const empreinte = crypto.createHash('sha256').update(script.cachedData).digest();
  return Buffer.concat([entete, empreinte, script.cachedData]);
}

function compilerFichier(chemin) {
  const jsc = compilerSource(fs.readFileSync(chemin, 'utf8'));
  fs.writeFileSync(chemin.replace(/\.js$/, '.jsc'), jsc);
  fs.rmSync(chemin);
}

// Ce qui ne peut PAS etre compile, et pourquoi:
//   node_modules     une dependance declare son point d'entree en .js dans son
//                    package.json; le compiler rend le module introuvable
//   electron.js      point d'entree du paquet: il installe le chargeur de
//                    bytecode, il ne peut donc pas etre lui-meme du bytecode
//   jsc.js           le chargeur lui-meme, meme raison
//   *preload*.js     Electron lit ces fichiers COMME DU TEXTE et les execute;
//                    il n'a aucune idee de notre format
const DOSSIERS_EXCLUS = new Set(['node_modules']);
const FICHIERS_EXCLUS = new Set(['electron.js', 'jsc.js']);

function estExclu(nom) {
  return FICHIERS_EXCLUS.has(nom) || nom.includes('preload');
}

function parcourir(dossier, laisses = []) {
  let n = 0;
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const c = path.join(dossier, e.name);
    if (e.isDirectory()) {
      if (DOSSIERS_EXCLUS.has(e.name)) continue;
      n += parcourir(c, laisses);
    } else if (e.name.endsWith('.js')) {
      if (estExclu(e.name)) { laisses.push(c); continue; }
      compilerFichier(c);
      n += 1;
    }
  }
  return n;
}

function main() {
  const cible = process.argv[2];
  if (!cible) {
    console.error('usage: electron.exe outils/compiler-bytecode.js <dossier>');
    process.exit(1);
  }
  const laisses = [];
  const n = parcourir(cible, laisses);
  console.log(`${n} fichiers compiles (V8 ${process.versions.v8})`);
  // Les exceptions sont ANNONCEES, pas tues: pretendre qu'il ne reste aucun
  // .js lisible alors qu'il en reste quatre serait un mensonge de plus.
  for (const l of laisses) console.log('laisse en clair:', path.relative(cible, l));
}

if (require.main === module) main();
module.exports = { compilerSource, compilerFichier, envelopper, parcourir, estExclu };
