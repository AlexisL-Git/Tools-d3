'use strict';
// Prepare le dossier d'etape a partir duquel le paquet distribue est fabrique:
// code compile en bytecode, archive de la version initiale, et rien d'autre.
//
// A LANCER AVEC LE BINAIRE PACKAGE, qui porte le V8 d'Electron — un cache
// produit par node ne se recharge pas dans Electron:
//   $env:ELECTRON_RUN_AS_NODE='1'
//   .\desktop\dist\OMNI-win32-x64\OMNI.exe outils\faire-etape.js
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
// Les sous-dossiers de desktop/ a emporter. Sans cette liste, index.html
// partait chez les amis SANS SES POLICES: elles sont embarquees dans le depot
// justement pour qu OMNI demarre sans reseau, et l interface retombait sur la
// police systeme apres une mise a jour.
const DOSSIERS_DESKTOP = ['polices'];

function copier() {
  // GARDE: une suppression recursive TRAVERSE une jonction Windows et efface
  // ce qu'elle vise. Une jonction node_modules laissee par une version
  // precedente de ce script a vide le node_modules du depot. On la detache
  // avant toute suppression, toujours.
  const lien = path.join(ETAPE, 'node_modules');
  try {
    if (fs.lstatSync(lien).isSymbolicLink()) fs.unlinkSync(lien);
  } catch (e) {
    // Pas de lien: rien a detacher.
  }
  fs.rmSync(ETAPE, { recursive: true, force: true });
  fs.mkdirSync(ETAPE, { recursive: true });
  for (const d of DOSSIERS) {
    fs.cpSync(path.join(RACINE, d), path.join(ETAPE, d), { recursive: true });
  }
  fs.mkdirSync(path.join(ETAPE, 'desktop'), { recursive: true });
  for (const f of FICHIERS_DESKTOP) {
    fs.copyFileSync(path.join(RACINE, 'desktop', f), path.join(ETAPE, 'desktop', f));
  }
  for (const d of DOSSIERS_DESKTOP) {
    const source = path.join(RACINE, 'desktop', d);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(ETAPE, 'desktop', d), { recursive: true });
  }
  fs.copyFileSync(path.join(RACINE, 'package.json'), path.join(ETAPE, 'package.json'));
  // L'archive embarquee est refabriquee plus bas, a partir du code COMPILE:
  // celle du depot contient du .js lisible.
  fs.rmSync(path.join(ETAPE, 'amorceur', 'version-initiale.tgz'), { force: true });
}

// Les dependances de production, et elles seules, sont COPIEES dans l'etape.
//
// Une jonction vers le node_modules du depot avait paru plus economique. Elle
// a coute cher: l'elagage du packager l'a traversee et a vide le node_modules
// DU DEPOT. Une copie ne peut pas faire ca.
function dependancesProduction() {
  const vus = new Set();
  const file = Object.keys(JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8')).dependencies || {});
  while (file.length) {
    const nom = file.shift();
    if (vus.has(nom)) continue;
    const dossier = path.join(RACINE, 'node_modules', nom);
    if (!fs.existsSync(dossier)) continue;
    vus.add(nom);
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(dossier, 'package.json'), 'utf8'));
      file.push(...Object.keys(pj.dependencies || {}));
    } catch (e) {
      // Un module sans package.json lisible n'a pas de dependances a suivre.
    }
  }
  return [...vus];
}

function copierDependances() {
  const noms = dependancesProduction();
  for (const nom of noms) {
    fs.cpSync(path.join(RACINE, 'node_modules', nom), path.join(ETAPE, 'node_modules', nom),
      { recursive: true, dereference: true });
  }
  return noms;
}

function main() {
  if (typeof process.versions.electron !== 'string') {
    console.error('ERREUR: a lancer avec le binaire package (ELECTRON_RUN_AS_NODE=1).');
    console.error('Un cache produit par node ne se recharge pas dans Electron.');
    process.exit(1);
  }
  copier();

  // MESURE du 2026-08-25: le processus GRAPHIQUE d'Electron refuse un cache
  // produit ailleurs — ses drapeaux V8 ne sont pas ceux du mode Node, et les
  // drapeaux font partie de ce que V8 valide. Compiler avec le binaire en mode
  // Node donne donc un paquet qui ouvre une fenetre « Error ». Tant qu'on ne
  // compile pas DEPUIS un processus graphique, le bytecode reste desactive.
  if (process.env.OMNI_BYTECODE === 'oui') {
    const laisses = [];
    const compiles = parcourir(ETAPE, laisses);
    console.log(`${compiles} fichiers compiles (V8 ${process.versions.v8})`);
    for (const l of laisses) console.log('  laisse en clair:', path.relative(ETAPE, l));
  } else {
    console.log('bytecode DESACTIVE (OMNI_BYTECODE=oui pour l activer)');
  }

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
  const noms = copierDependances();
  console.log(`node_modules: ${noms.length} dependances de production copiees`);

  console.log('');
  console.log('etape prete. Fabriquer le paquet: npm run pack');
}

if (require.main === module) main();
module.exports = { copier, ETAPE };
