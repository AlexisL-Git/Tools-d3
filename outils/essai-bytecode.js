'use strict';
// Mesure prealable au durcissement: le bytecode V8 n'est pas portable. Des
// donnees mises en cache par un V8 ne se rechargent que dans le MEME V8, d'ou
// la compilation avec l'Electron du paquet et non avec node.
//
// A LANCER AVEC LE BINAIRE PACKAGE, qui porte le V8 d'Electron:
//   $env:ELECTRON_RUN_AS_NODE='1'
//   .\desktop\dist\Replicate-win32-x64\Replicate.exe outils\essai-bytecode.js
const vm = require('node:vm');
const v8 = require('node:v8');
const Module = require('node:module');
const { compilerSource, envelopper } = require('./compiler-bytecode');

v8.setFlagsFromString('--no-lazy');

// 1. Va-et-vient brut, sur une expression simple.
const source = '40 + 2';
const script = new vm.Script(source, { produceCachedData: true });
const relu = new vm.Script(source, { cachedData: script.cachedData });
console.log('rejete par V8   :', relu.cachedDataRejected);
console.log('valeur          :', relu.runInThisContext());

// 2. Va-et-vient reel: un module CommonJS complet, enveloppe comme Node le
//    fait, recharge par le chargeur de l'amorceur.
const jsc = compilerSource('module.exports = { somme: (a, b) => a + b };');
const longueur = jsc.readUInt32LE(0);
const cache = jsc.subarray(36);
const scriptModule = new vm.Script(' '.repeat(longueur), { cachedData: cache });
console.log('module rejete   :', scriptModule.cachedDataRejected);
const faux = { exports: {} };
scriptModule.runInThisContext().call(faux.exports, faux.exports, require, faux, 'x.js', '.');
console.log('module rendu    :', faux.exports.somme(40, 2));

console.log('version V8      :', process.versions.v8);
console.log('version Node    :', process.versions.node);
console.log('Module.wrap     :', typeof Module.wrap);
console.log('enveloppe testee:', envelopper('x').slice(0, 40) + '...');
