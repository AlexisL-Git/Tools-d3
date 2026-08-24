'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ecrireArchive, empreinte } = require('../amorceur/archive');

// Ce qui part chez les amis: le code applicatif, rien d'autre. L'amorceur en
// est exclu — il vit dans le paquet et ne se met pas a jour; l'y mettre ferait
// charger un amorceur par un amorceur.
const DOSSIERS = ['src', 'desktop'];
const FICHIERS = ['package.json'];
const EXCLUS = new Set(['dist', 'node_modules']);

function parcourir(racine, relatif, sortie) {
  const absolu = path.join(racine, relatif);
  for (const e of fs.readdirSync(absolu, { withFileTypes: true })) {
    if (EXCLUS.has(e.name)) continue;
    const rel = relatif + '/' + e.name;
    if (e.isDirectory()) parcourir(racine, rel, sortie);
    else if (e.isFile()) sortie.push({ chemin: rel, contenu: fs.readFileSync(path.join(racine, rel)) });
  }
}

function listerFichiersVersion(racine) {
  const sortie = [];
  for (const d of DOSSIERS) {
    if (fs.existsSync(path.join(racine, d))) parcourir(racine, d, sortie);
  }
  for (const f of FICHIERS) {
    if (fs.existsSync(path.join(racine, f))) {
      sortie.push({ chemin: f, contenu: fs.readFileSync(path.join(racine, f)) });
    }
  }
  // Ordre stable: deux fabrications du meme code doivent donner la meme
  // empreinte, sinon on ne peut plus verifier ce qui a ete publie.
  return sortie.sort((a, b) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0));
}

function fabriquer(racine) {
  const fichiers = listerFichiersVersion(racine);
  const archive = ecrireArchive(fichiers);
  const version = JSON.parse(fs.readFileSync(path.join(racine, 'package.json'), 'utf8')).version;
  return { archive, sha256: empreinte(archive), version, nombreFichiers: fichiers.length };
}

function main() {
  const sortie = process.argv[2];
  if (!sortie) {
    console.error('usage: node outils/faire-paquet-code.js <sortie.tar.gz>');
    process.exit(1);
  }
  const racine = path.join(__dirname, '..');
  const r = fabriquer(racine);
  fs.writeFileSync(sortie, r.archive);
  console.log(`version ${r.version}, ${r.nombreFichiers} fichiers, ${r.archive.length} octets`);
  console.log(`sha256: ${r.sha256}`);
  console.log(`ecrit: ${sortie}`);
}

if (require.main === module) main();
module.exports = { listerFichiersVersion, fabriquer };
