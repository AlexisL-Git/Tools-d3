'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { lireCaptures, candidats } = require('../src/dev/appariement');
const { CATALOGUE } = require('../src/dev/catalogue');

// Retrouve, apres un patch Dofus, les nouveaux noms des messages dont OMNI
// depend. Voir src/dev/appariement.js pour le pourquoi, src/dev/catalogue.js
// pour les empreintes de reference, et la section 5.2 de
// docs/superpowers/specs/2026-08-17-launcher-multi-compte-dofus3-design.md.
//
//   node outils/apparier-protocole.js journal-dev.log
//
// Le journal doit venir d'un lanceur de MESURE (lancer-mesure-hdv.vbs ou
// equivalent): sans OMNI_CAPTURE_OCTETS=1 il n'y a pas d'octets a relire, donc
// pas de structure, donc rien a apparier. C'est le premier chiffre affiche
// ci-dessous qui le dit: zero trame relisible, et la seance est a refaire.
//
// DEUX GESTES A NE PAS FAIRE COUP SUR COUP: accepter une invitation de groupe
// et accepter un songe emettent la MEME empreinte (`1:varint`, sortante). Les
// espacer nettement, et noter l'instant de chacun: c'est la chronologie qui
// les separe, l'outil ne le fera pas.

const fichier = process.argv[2] || 'journal-dev.log';
if (!fs.existsSync(fichier)) {
  console.error(`journal introuvable: ${path.resolve(fichier)}`);
  process.exit(1);
}

const trames = lireCaptures(fs.readFileSync(fichier, 'utf8'));
const entrants = trames.filter((t) => t.sens === 'entrant').length;

console.log(`${fichier}: ${trames.length} trames avec octets (${entrants} entrantes, ${trames.length - entrants} sortantes)`);
if (trames.length === 0) {
  console.log('\nAucune trame relisible. Le journal a-t-il ete produit avec OMNI_CAPTURE_OCTETS=1 ?');
  process.exit(0);
}

// Le bruit de fond aide a juger: un nom vu partout n'est pas le geste qu'on
// cherche, meme si son empreinte colle.
const total = new Map();
for (const t of trames) total.set(t.nom, (total.get(t.nom) || 0) + 1);

for (const r of candidats(CATALOGUE, trames)) {
  console.log(`\n--- ${r.cle}   [${r.sens}, ${r.empreinte}]`);
  if (r.propositions.length === 0) {
    console.log('    aucun candidat — le geste a-t-il ete fait pendant la mesure ?');
    continue;
  }
  for (const p of r.propositions) {
    console.log(`    ${p.nom}   vu ${p.vus}x ici, ${total.get(p.nom)}x dans tout le journal   a ${p.instants.slice(0, 6).join(', ')} ms`);
  }
}
