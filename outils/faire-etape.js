'use strict';
// Prepare le dossier d'etape a partir duquel le paquet distribue est fabrique:
// code compile en bytecode, archive de la version initiale, et rien d'autre.
//
// A LANCER AVEC LE BINAIRE PACKAGE, qui porte le V8 d'Electron — un cache
// produit par node ne se recharge pas dans Electron:
//   $env:ELECTRON_RUN_AS_NODE='1'
//   .\desktop\dist\Replicate-win32-x64\Replicate.exe outils\faire-etape.js
//
// Puis, avec node ordinaire: npm run pack
const fs = require('node:fs');
const path = require('node:path');
const { parcourir } = require('./compiler-bytecode');
const { fabriquer } = require('./faire-paquet-code');

const RACINE = path.join(__dirname, '..');
const ETAPE = path.join(RACINE, 'desktop', 'etape-paquet');

// Ce qui part chez les amis, et RIEN d'autre. Tout ce qui n'est pas nomme ici
// reste ici: captures de trames, notes de conception, outils de fabrication.
const DOSSIERS = ['amorceur', 'src'];
const FICHIERS_DESKTOP = ['main.js', 'preload.js', 'index.html'];

function copier() {
  fs.rmSync(ETAPE, { recursive: true, force: true });
  fs.mkdirSync(ETAPE, { recursive: true });
  for (const d of DOSSIERS) {
    fs.cpSync(path.join(RACINE, d), path.join(ETAPE, d), { recursive: true });
  }
  fs.mkdirSync(path.join(ETAPE, 'desktop'), { recursive: true });
  for (const f of FICHIERS_DESKTOP) {
    fs.copyFileSync(path.join(RACINE, 'desktop', f), path.join(ETAPE, 'desktop', f));
  }
  fs.copyFileSync(path.join(RACINE, 'package.json'), path.join(ETAPE, 'package.json'));
  // L'archive embarquee est refabriquee plus bas, a partir du code COMPILE:
  // celle du depot contient du .js lisible.
  fs.rmSync(path.join(ETAPE, 'amorceur', 'version-initiale.tgz'), { force: true });
}

function main() {
  if (typeof process.versions.electron !== 'string') {
    console.error('ERREUR: a lancer avec le binaire package (ELECTRON_RUN_AS_NODE=1).');
    console.error('Un cache produit par node ne se recharge pas dans Electron.');
    process.exit(1);
  }
  copier();

  const laisses = [];
  const compiles = parcourir(ETAPE, laisses);
  console.log(`${compiles} fichiers compiles (V8 ${process.versions.v8})`);
  for (const l of laisses) console.log('  laisse en clair:', path.relative(ETAPE, l));

  // L'archive de la version initiale contient le MEME code compile que celui
  // qu'un ami recevra par une mise a jour: un seul chemin de code, pas deux.
  const r = fabriquer(ETAPE);
  fs.writeFileSync(path.join(ETAPE, 'amorceur', 'version-initiale.tgz'), r.archive);
  const publiable = path.join(RACINE, 'desktop', 'dist', `code-${r.version}.tar.gz`);
  fs.mkdirSync(path.dirname(publiable), { recursive: true });
  fs.writeFileSync(publiable, r.archive);

  console.log('');
  console.log(`version   : ${r.version}`);
  console.log(`archive   : ${r.nombreFichiers} fichiers, ${r.archive.length} octets`);
  console.log(`sha256    : ${r.sha256}`);
  console.log(`a publier : ${publiable}`);
  // Les dependances restent celles du depot: une jonction suffit, le
  // packager la traverse et n'emporte que les dependances de production.
  // Elle est posee APRES la compilation, qui ne doit jamais toucher a
  // node_modules — un module y declare son point d'entree en .js.
  const lien = path.join(ETAPE, 'node_modules');
  if (!fs.existsSync(lien)) fs.symlinkSync(path.join(RACINE, 'node_modules'), lien, 'junction');
  console.log(`node_modules: jonction vers ${path.join(RACINE, 'node_modules')}`);

  console.log('');
  console.log('etape prete. Fabriquer le paquet: npm run pack');
}

if (require.main === module) main();
module.exports = { copier, ETAPE };
