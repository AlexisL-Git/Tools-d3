'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// LES CLASSES DU PANNEAU DES PEPITES NE DOIVENT ENTRER EN COLLISION AVEC
// AUCUNE AUTRE. Ce test est le frere de pda-archi-panneau.test.js, et il
// existe pour la meme raison: le 2026-09-04, une classe nommee `case` a
// heriter d'un `display: grid` pose ailleurs, et les coches d'un archimonstre
// se sont empilees verticalement. Le balisage etait juste, le code aussi, et
// rien dans le projet ne pouvait le dire -- ni les tests, ni le navigateur.
//
// Assertion sur le SOURCE: le chemin concerne demanderait un vrai navigateur.

const html = fs.readFileSync(
  path.join(__dirname, '..', 'desktop', 'index.html'), 'utf8',
);

const bloc = html.match(/const PEP = \{([\s\S]*?)\};/);
const classes = bloc === null
  ? []
  : [...bloc[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('le panneau declare ses classes en un seul endroit', () => {
  assert.notStrictEqual(bloc, null, 'la table PEP est introuvable dans index.html');
  assert.ok(classes.length >= 5, `seulement ${classes.length} classes trouvees`);
});

// LE PREFIXE EST LA GARDE.
test('toutes les classes du panneau sont prefixees pep-', () => {
  assert.deepStrictEqual(classes.filter((c) => !c.startsWith('pep-')), []);
});

// Un prefixe ne sert a rien si le reste de la feuille de style s'en sert
// aussi: la seconde moitie de la garde.
test('aucune regle hors du panneau ne definit une classe pep-', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const regles = [...style.matchAll(/\.(pep-[a-z0-9-]+)/g)].map((m) => m[1]);
  const inconnues = regles.filter(
    (c) => !classes.includes(c)
      && !['pep-corps', 'pep-pied', 'pep-cherche', 'pep-table'].includes(c),
  );
  assert.deepStrictEqual(inconnues, []);
});

// LE PANNEAU N'EMPRUNTE PAS LES CLASSES DE L'AUTRE. Elles appartiennent au
// tableau des archimonstres, dont le test interdit qu'une regle etrangere en
// definisse -- et une reprise silencieuse ferait dependre notre mise en page
// de la sienne.
test('le panneau des pepites n emprunte aucune classe arc-', () => {
  const debut = html.indexOf('<div class="pep-vue"');
  assert.notStrictEqual(debut, -1, 'le panneau des pepites est introuvable');
  const fin = html.indexOf('</div>', html.indexOf('id="pepPied"'));
  const markup = html.slice(debut, fin);
  assert.deepStrictEqual([...markup.matchAll(/class="(arc-[a-z0-9- ]+)"/g)].map((m) => m[1]), []);
});

// Les identifiants que le script va chercher par getElementById. Une faute de
// frappe ici rend un panneau muet, et c'est exactement le genre de panne que
// rien ne signale.
test('les identifiants attendus par le script existent dans le balisage', () => {
  for (const id of ['vuePepites', 'pepCorps', 'pepPied', 'pepChercheTexte', 'pepFermer']) {
    assert.ok(html.includes(`id="${id}"`), `id="${id}" manque`);
  }
});
