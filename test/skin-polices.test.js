'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// OMNI DOIT DEMARRER SANS RESEAU. Les maquettes de labo-omni/ appellent
// Outfit et Plus Jakarta Sans depuis Google Fonts; la production ne le peut
// pas. Ce test est le frere de paquet-fichiers.test.js, et il existe pour la
// meme raison: le jour ou index.html est parti chez les amis sans ses
// polices, l interface est retombee sur la police systeme apres une mise a
// jour, tous les tests verts et le code juste.

const DESKTOP = path.join(__dirname, '..', 'desktop');
const POLICES = path.join(DESKTOP, 'polices');

const ATTENDUES = ['outfit.woff2', 'plus-jakarta-sans.woff2'];

test('les deux polices du nouveau skin sont embarquees', () => {
  for (const f of ATTENDUES) {
    const chemin = path.join(POLICES, f);
    assert.ok(fs.existsSync(chemin), `desktop/polices/${f} manque`);
    assert.ok(
      fs.statSync(chemin).size > 4096,
      `desktop/polices/${f} fait moins de 4 Ko : fichier tronque ou page d erreur`,
    );
  }
});

// LA SECONDE MOITIE DE LA GARDE. Embarquer les fichiers ne sert a rien si
// une feuille continue d appeler l hote en ligne: la page se chargerait
// quand meme au bureau, et seulement chez l ami hors ligne elle tomberait.
test('aucune feuille de desktop n appelle une police en ligne', () => {
  const fautifs = [];
  const parcourir = (dossier) => {
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
      const p = path.join(dossier, e.name);
      if (e.isDirectory()) { parcourir(p); continue; }
      if (!/\.(html|css)$/.test(e.name)) continue;
      const texte = fs.readFileSync(p, 'utf8');
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(texte)) {
        fautifs.push(path.relative(DESKTOP, p));
      }
    }
  };
  parcourir(DESKTOP);
  assert.deepStrictEqual(
    fautifs, [],
    `${fautifs.join(', ')} appelle Google Fonts : embarque la police`,
  );
});
