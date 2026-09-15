'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Assertion sur le SOURCE, comme pepites-panneau et pda-archi-panneau: le
// chemin concerne demanderait un vrai navigateur.

const RACINE = path.join(__dirname, '..');
const rail = fs.readFileSync(path.join(RACINE, 'desktop', 'vues', 'rail.js'), 'utf8');
const html = fs.readFileSync(path.join(RACINE, 'desktop', 'index.html'), 'utf8');
const etape = fs.readFileSync(path.join(RACINE, 'outils', 'faire-etape.js'), 'utf8');

// DEUX FAITS VERIFIES SEPAREMENT, et non par une seule regex. Le module est
// charge par un <script type="module"> EN LIGNE qui fait l import: le chemin
// n est donc pas dans la balise ouvrante, et une regex qui l y chercherait
// echouerait sur du code juste.
test('le rail est charge comme module', () => {
  assert.ok(
    html.includes('<script type="module">'),
    'rail.js doit etre charge en type="module" : en script classique, ses '
    + 'declarations de premier niveau entreraient en collision avec celles '
    + 'de faux-app.js sur le banc -- le piege raconte en tete de ce fichier-la',
  );
  assert.ok(
    html.includes('vues/rail.js'),
    'la page ne charge jamais vues/rail.js : le rail ne commutera pas',
  );
});

test('vues/ part chez les amis', () => {
  assert.ok(
    /DOSSIERS_DESKTOP\s*=\s*\[[^\]]*'vues'/.test(etape),
    "desktop/vues/ n est pas dans DOSSIERS_DESKTOP : le rail ne partira pas, "
    + 'et la fenetre arrivera sans navigation',
  );
});

// LE CHOIX DE L AMI SURVIT A LA FERMETURE, ET L ABSENCE DE CHOIX SUIT
// WINDOWS. Les deux moities comptent: retenir sans defaut donne un clair
// force au premier lancement, suivre sans retenir fait oublier le choix a
// chaque demarrage.
test('le theme est retenu, et le defaut ne force rien', () => {
  assert.ok(rail.includes('localStorage'), 'le choix de theme n est pas retenu');
  assert.ok(
    rail.includes('removeAttribute'),
    'sans retrait de l attribut, on ne peut jamais revenir a « suivre Windows » : '
    + 'tant qu un data-theme est pose, prefers-color-scheme ne dit plus rien',
  );
});

// LIRE localStorage PEUT LEVER. Fenetre privee, donnees de site effacees,
// stockage bloque: l accesseur jette au lieu de rendre null. Sans garde, le
// module meurt a la premiere ligne de son montage et le rail ne commute
// plus -- la fenetre garde son premier ecran, pour toujours, en silence.
test('la lecture du theme est gardee', () => {
  const i = rail.indexOf('localStorage.getItem');
  assert.notStrictEqual(i, -1, 'le theme ne se relit jamais');
  const autour = rail.slice(Math.max(0, i - 400), i);
  assert.ok(
    autour.includes('try {'),
    'localStorage.getItem doit etre dans un try : il leve en fenetre privee',
  );
});
