'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { creerClient } = require('./lib/db');
const { ecrireManifeste } = require('./lib/manifeste');

function preparerPublication({ version, contenuArchive, ecrireFichier }) {
  const sha256 = crypto.createHash('sha256').update(contenuArchive).digest('hex');
  const chemin = path.join(__dirname, 'paquets', `${version}.tar.gz`);
  ecrireFichier(chemin, contenuArchive);
  return { chemin, sha256 };
}

// Orchestration reelle: appelee quand on lance `npm run publier <archive>`.
// L'archive est fabriquee par le sous-projet B; ici on la prend telle quelle.
async function main() {
  const archive = process.argv[2];
  const version = process.argv[3];
  if (!archive || !version) {
    console.error('usage: node publier.js <archive.tar.gz> <version>');
    process.exit(1);
  }
  const contenu = fs.readFileSync(archive);
  fs.mkdirSync(path.join(__dirname, 'paquets'), { recursive: true });
  const { chemin, sha256 } = preparerPublication({
    version, contenuArchive: contenu,
    ecrireFichier: (c, d) => fs.writeFileSync(c, d),
  });
  console.log(`archive ecrite: ${chemin}`);
  console.log(`sha256: ${sha256}`);
  // L'archive doit etre DEPLOYEE avant que le manifeste la designe: on
  // deploie a la main (npx vercel --prod) APRES ce script, puis on relance
  // avec --activer pour basculer le manifeste. Deux temps, pour qu'aucun
  // client ne recoive un manifeste pointant une archive pas encore en ligne.
  if (process.argv.includes('--activer')) {
    const sql = creerClient();
    await ecrireManifeste(sql, { version, sha256 });
    console.log('manifeste bascule sur la version', version);
  } else {
    console.log('archive prete. Deploie (npx vercel --prod), puis relance avec --activer.');
  }
}

if (require.main === module) main();
module.exports = { preparerPublication };
