'use strict';
// Fabrique le paquet distribuable a partir du dossier d'etape produit par
// outils/faire-etape.js. Passe par l'API du packager plutot que par sa ligne
// de commande: les options y sont ecrites une fois, lisibles, sans dependre de
// la facon dont le shell traite `**`.
//
// L'extraction des binaires natifs n'est pas une precaution de style: un
// `.node` ne se charge PAS depuis une archive asar. Verifier apres coup que
// app.asar.unpacked contient bien frida_binding.node — l'entree reste listee
// dans l'asar meme quand elle est extraite, et cette liste ment donc a qui la
// lit trop vite.
const path = require('node:path');
const fs = require('node:fs');
const { packager } = require('@electron/packager');

const RACINE = path.join(__dirname, '..');
const ETAPE = path.join(RACINE, 'desktop', 'etape-paquet');
const SORTIE = path.join(RACINE, 'desktop', 'dist');

async function main() {
  if (!fs.existsSync(path.join(ETAPE, 'package.json'))) {
    console.error("ERREUR: pas de dossier d'etape. Lancer d'abord, avec le binaire package:");
    console.error('  ELECTRON_RUN_AS_NODE=1 Replicate.exe outils/faire-etape.js');
    process.exit(1);
  }
  const chemins = await packager({
    dir: ETAPE,
    name: 'Replicate',
    platform: 'win32',
    arch: 'x64',
    out: SORTIE,
    overwrite: true,
    prune: true,
    // Tout binaire natif sort de l'archive: un .node ne se charge pas depuis
    // un asar. C'est exactement a quoi sert app.asar.unpacked.
    asar: { unpack: '**/*.node' },
  });
  console.log('paquet ecrit:', chemins.join(', '));
}

main().catch((e) => {
  console.error('fabrication du paquet en echec:', e.message);
  process.exit(1);
});
