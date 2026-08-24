'use strict';
// Mesure prealable au durcissement: le bytecode V8 n'est pas portable. Des
// donnees mises en cache par un V8 ne se rechargent que dans le MEME V8, d'ou
// la compilation avec l'Electron du paquet et non avec node.
const vm = require('node:vm');
const v8 = require('node:v8');
const Module = require('node:module');

v8.setFlagsFromString('--no-lazy');
const source = 'module.exports = 40 + 2;';
const script = new vm.Script(source, { produceCachedData: true });
const cache = script.cachedData;

const relu = new vm.Script(source, { cachedData: cache });
console.log('rejete par V8 :', relu.cachedDataRejected);
console.log('valeur        :', relu.runInThisContext());
console.log('version V8    :', process.versions.v8);
console.log('Module.wrap   :', typeof Module.wrap);
