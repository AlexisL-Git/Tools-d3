'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

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

// ============================================================
// CE QUI SUIT EXECUTE VRAIMENT rail.js, comme pda-archi-panneau.test.js
// est « le seul test qui execute son code » pour le panneau archimonstres.
// Les quatre tests ci-dessus ne verifient que le SOURCE: ils resteraient
// verts si montrer() bougeait la mauvaise collection, si l ordre du cycle
// etait invente, ou si le clic sur #btTheme perdait son appel a
// poserTheme(). Celui-ci monte un DOM de facade minimal, exactement assez
// pour ce que monterRail() touche, et verifie le comportement REEL.
//
// rail.js est un module ES (`export function monterRail`), pas un script
// classique comme celui charge par vm.runInContext dans
// pda-archi-panneau.test.js -- il se charge donc par un import() dynamique
// depuis son chemin de fichier, la facon idiomatique de charger un module
// ES depuis un fichier de test CommonJS.
// ============================================================

// Un noeud minimal: juste ce que rail.js appelle sur un bouton ou un
// conteneur .vue -- dataset, classList (toggle/contains), addEventListener,
// et un declencheur de clic explicite pour ne pas dependre d un vrai DOM.
function creerNoeud({ id = null, vue = null, disabled = false } = {}) {
  const classes = new Set();
  const clics = [];
  return {
    id,
    dataset: vue === null ? {} : { vue },
    disabled,
    textContent: '',
    classList: {
      toggle(nom, force) { if (force) classes.add(nom); else classes.delete(nom); },
      contains(nom) { return classes.has(nom); },
    },
    addEventListener(type, f) { if (type === 'click') clics.push(f); },
    // Declenche tous les ecouteurs 'click' poses, comme le ferait un clic
    // reel -- monterRail() n en pose jamais plus d un par noeud, mais rien
    // ne l empeche en theorie.
    clic() { for (const f of clics) f(); },
  };
}

// La racine <html>: seule surface que poserTheme() touche pour data-theme.
function creerRacine() {
  let theme = null;
  return {
    setAttribute(nom, valeur) { if (nom === 'data-theme') theme = valeur; },
    removeAttribute(nom) { if (nom === 'data-theme') theme = null; },
    lireThemePose() { return theme; },
  };
}

// LES CINQ BOUTONS DU RAIL ET LES CINQ .vue, avec les vraies valeurs
// data-vue de desktop/index.html (rail: raccourcis, courses [disabled],
// hotel, archi, reglages) -- pas une liste inventee, pour que le test
// bouge avec la page plutot que de la figer.
const VUES = ['raccourcis', 'courses', 'hotel', 'archi', 'reglages'];

function creerFacade() {
  const racine = creerRacine();
  const boutons = VUES.map((v) => creerNoeud({ vue: v, disabled: v === 'courses' }));
  const conteneurs = VUES.map((v) => creerNoeud({ id: `v-${v}` }));
  const motTheme = creerNoeud();
  const btTheme = creerNoeud();
  const parId = new Map([['motTheme', motTheme], ['btTheme', btTheme]]);

  const document = {
    documentElement: racine,
    querySelectorAll(selecteur) {
      if (selecteur === '.rail button[data-vue]') return boutons;
      if (selecteur === '.vue') return conteneurs;
      return [];
    },
    getElementById: (id) => parId.get(id) || null,
  };

  return { document, racine, boutons, conteneurs, btTheme };
}

// localStorage QUI MARCHE VRAIMENT, en memoire -- ce test ne rejoue pas
// l echec de stockage (deja couvert par « la lecture du theme est gardee »
// ci-dessus, sur le source), il verifie le cycle dans le cas normal.
function creerStockage() {
  const valeurs = new Map();
  return {
    getItem: (cle) => (valeurs.has(cle) ? valeurs.get(cle) : null),
    setItem: (cle, v) => { valeurs.set(cle, v); },
    removeItem: (cle) => { valeurs.delete(cle); },
  };
}

test('le rail commute les vues, ignore Courses desactive, et le theme tourne', async () => {
  const { document, racine, boutons, conteneurs, btTheme } = creerFacade();
  global.document = document;
  global.localStorage = creerStockage();
  try {
    const cheminModule = path.join(RACINE, 'desktop', 'vues', 'rail.js');
    const { monterRail } = await import(url.pathToFileURL(cheminModule).href);

    // L ETAT INITIAL DE LA VRAIE PAGE: raccourcis est actif au chargement
    // (class="actif" en dur dans desktop/index.html). monterRail() ne pose
    // pas cet etat -- il ne fait que cabler les clics -- donc on le simule
    // ici pour verifier que le PROCHAIN clic l eteint bien.
    boutons[0].classList.toggle('actif', true);
    conteneurs[0].classList.toggle('actif', true);

    monterRail();

    // --- un clic sur un bouton du rail bascule la bonne paire ---
    const iHotel = VUES.indexOf('hotel');
    boutons[iHotel].clic();
    for (let i = 0; i < VUES.length; i += 1) {
      assert.strictEqual(
        boutons[i].classList.contains('actif'), i === iHotel,
        `bouton ${VUES[i]}: actif attendu = ${i === iHotel}`,
      );
      assert.strictEqual(
        conteneurs[i].classList.contains('actif'), i === iHotel,
        `vue ${VUES[i]}: actif attendu = ${i === iHotel}`,
      );
    }

    // --- Courses est desactive: le cliquer ne bouge rien ---
    const iCourses = VUES.indexOf('courses');
    boutons[iCourses].clic();
    assert.strictEqual(boutons[iCourses].classList.contains('actif'), false, 'Courses ne devient jamais actif');
    assert.strictEqual(boutons[iHotel].classList.contains('actif'), true, 'hotel reste actif: le clic sur Courses n a rien change');
    assert.strictEqual(conteneurs[iHotel].classList.contains('actif'), true, 'la vue hotel reste affichee');

    // --- le theme tourne: Systeme -> Sombre -> Clair -> Systeme ---
    assert.strictEqual(racine.lireThemePose(), null, 'au montage, aucun theme retenu = suivre Windows');
    btTheme.clic();
    assert.strictEqual(racine.lireThemePose(), 'sombre');
    btTheme.clic();
    assert.strictEqual(racine.lireThemePose(), 'clair');
    btTheme.clic();
    assert.strictEqual(racine.lireThemePose(), null, 'le troisieme clic revient a « suivre Windows »');
  } finally {
    delete global.document;
    delete global.localStorage;
  }
});
