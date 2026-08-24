'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

// Pourquoi ecrire un lecteur tar plutot que d'installer le paquet `tar`:
// l'amorceur ne peut pas se mettre a jour lui-meme et ne doit dependre que de
// Node. Le format tient en 512 octets d'en-tete par fichier, et ecrire les
// deux moities garantit qu'elles se comprennent — un tar.exe systeme emet des
// en-tetes pax que ce lecteur ignorerait.
const BLOC = 512;

function octal(n, largeur) {
  // Le champ se termine par un NUL: on ecrit largeur-1 chiffres.
  return n.toString(8).padStart(largeur - 1, '0') + '\0';
}

function enTete(chemin, taille) {
  const h = Buffer.alloc(BLOC, 0);
  const nom = Buffer.from(chemin, 'utf8');
  if (nom.length > 100) throw new Error('chemin trop long pour un en-tete tar: ' + chemin);
  nom.copy(h, 0);
  h.write(octal(0o644, 8), 100);          // mode
  h.write(octal(0, 8), 108);              // uid
  h.write(octal(0, 8), 116);              // gid
  h.write(octal(taille, 12), 124);        // taille
  h.write(octal(0, 12), 136);             // mtime: fixe, pour que deux archives
                                          // du meme code aient le meme sha256
  h.write('        ', 148);               // somme: huit espaces pendant le calcul
  h.write('0', 156);                      // type: fichier ordinaire
  h.write('ustar\0', 257);
  h.write('00', 263);
  let somme = 0;
  for (const o of h) somme += o;
  h.write(somme.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

function ecrireArchive(fichiers) {
  const morceaux = [];
  for (const f of fichiers) {
    const contenu = Buffer.isBuffer(f.contenu) ? f.contenu : Buffer.from(f.contenu);
    morceaux.push(enTete(f.chemin, contenu.length));
    morceaux.push(contenu);
    const reste = contenu.length % BLOC;
    if (reste !== 0) morceaux.push(Buffer.alloc(BLOC - reste, 0));
  }
  morceaux.push(Buffer.alloc(BLOC * 2, 0));   // fin d'archive
  return zlib.gzipSync(Buffer.concat(morceaux));
}

function chaine(buf, debut, longueur) {
  const zone = buf.subarray(debut, debut + longueur);
  const fin = zone.indexOf(0);
  return zone.subarray(0, fin === -1 ? zone.length : fin).toString('utf8');
}

function lireArchive(gz) {
  const brut = zlib.gunzipSync(gz);   // leve si ce n'est pas du gzip
  const fichiers = [];
  let i = 0;
  let finVue = false;
  while (i + BLOC <= brut.length) {
    const h = brut.subarray(i, i + BLOC);
    if (h.every((o) => o === 0)) { finVue = true; break; }   // bloc nul: fin d'archive
    const chemin = chaine(h, 0, 100);
    const taille = parseInt(chaine(h, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156]);
    i += BLOC;
    if (i + taille > brut.length) throw new Error('archive tronquee: ' + chemin);
    if (type === '0' || type === '\0') {
      fichiers.push({ chemin, contenu: Buffer.from(brut.subarray(i, i + taille)) });
    }
    i += Math.ceil(taille / BLOC) * BLOC;
  }
  // Le marqueur de fin est la SEULE preuve que l'archive est complete. Sans
  // cette verification, une archive coupee juste apres un fichier entier se
  // lit sans broncher et installe une version amputee.
  if (!finVue) throw new Error('archive tronquee: marqueur de fin absent');
  return fichiers;
}

// Refuse tout ce qui sortirait de `destination`. La verification porte sur le
// chemin RESOLU, pas sur la chaine brute: '..' peut se cacher derriere un
// separateur inhabituel, un chemin resolu ne ment pas.
function cheminSur(destination, chemin) {
  const cible = path.resolve(destination, chemin);
  const racine = path.resolve(destination) + path.sep;
  if (!cible.startsWith(racine)) throw new Error('chemin hors du dossier de destination: ' + chemin);
  return cible;
}

function extraire(gz, destination) {
  const fichiers = lireArchive(gz);
  // On verifie TOUS les chemins avant d'ecrire quoi que ce soit: une archive
  // moitie extraite est pire qu'une archive refusee.
  const cibles = fichiers.map((f) => ({ cible: cheminSur(destination, f.chemin), contenu: f.contenu }));
  for (const c of cibles) {
    fs.mkdirSync(path.dirname(c.cible), { recursive: true });
    fs.writeFileSync(c.cible, c.contenu);
  }
  return cibles.length;
}

function empreinte(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = { ecrireArchive, lireArchive, extraire, empreinte };
