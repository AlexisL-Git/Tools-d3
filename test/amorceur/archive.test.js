'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ecrireArchive, lireArchive, extraire, empreinte } = require('../../amorceur/archive');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'archive-'));
}

test('aller-retour: ce qui sort est exactement ce qui est entre', () => {
  const fichiers = [
    { chemin: 'desktop/main.js', contenu: Buffer.from("console.log('salut');\n") },
    { chemin: 'src/vide.js', contenu: Buffer.alloc(0) },
    // Un contenu plus grand qu'un bloc, pour verifier le remplissage a 512.
    { chemin: 'src/gros.bin', contenu: crypto.randomBytes(1500) },
  ];
  const lu = lireArchive(ecrireArchive(fichiers));
  assert.strictEqual(lu.length, 3);
  for (const attendu of fichiers) {
    const trouve = lu.find((f) => f.chemin === attendu.chemin);
    assert.ok(trouve, 'fichier absent: ' + attendu.chemin);
    assert.ok(trouve.contenu.equals(attendu.contenu), 'contenu different: ' + attendu.chemin);
  }
});

test('les caracteres non ASCII du contenu survivent', () => {
  const contenu = Buffer.from('délai réglé à 0,5 s — échange accepté\n', 'utf8');
  const lu = lireArchive(ecrireArchive([{ chemin: 'a.txt', contenu }]));
  assert.ok(lu[0].contenu.equals(contenu));
});

test('extraire ecrit les fichiers et cree les dossiers', () => {
  const dest = tmp();
  const buf = ecrireArchive([{ chemin: 'src/comptes/vue.js', contenu: Buffer.from('x') }]);
  extraire(buf, dest);
  assert.strictEqual(fs.readFileSync(path.join(dest, 'src', 'comptes', 'vue.js'), 'utf8'), 'x');
});

test('un chemin qui remonte hors de la destination est refuse', () => {
  const dest = tmp();
  const buf = ecrireArchive([{ chemin: '../evade.txt', contenu: Buffer.from('non') }]);
  assert.throws(() => extraire(buf, dest), /hors du dossier/i);
  assert.strictEqual(fs.existsSync(path.join(path.dirname(dest), 'evade.txt')), false);
});

test('un chemin absolu est refuse', () => {
  const dest = tmp();
  const buf = ecrireArchive([{ chemin: '/etc/passwd', contenu: Buffer.from('non') }]);
  assert.throws(() => extraire(buf, dest), /hors du dossier|absolu/i);
});

test('une archive tronquee leve au lieu de rendre des fichiers a moitie lus', () => {
  const buf = ecrireArchive([{ chemin: 'a.txt', contenu: Buffer.alloc(2000, 65) }]);
  const zlib = require('node:zlib');
  const brut = zlib.gunzipSync(buf);
  const tronque = zlib.gzipSync(brut.subarray(0, brut.length - 1024));
  assert.throws(() => lireArchive(tronque));
});

test('un buffer qui n est pas du gzip leve', () => {
  assert.throws(() => lireArchive(Buffer.from('ceci n est pas une archive')));
});

test('empreinte rend le sha256 hexadecimal du buffer', () => {
  const b = Buffer.from('paquet-test');
  const attendu = crypto.createHash('sha256').update(b).digest('hex');
  assert.strictEqual(empreinte(b), attendu);
});
