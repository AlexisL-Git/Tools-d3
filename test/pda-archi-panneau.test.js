'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// LES CLASSES DU TABLEAU DES ARCHIMONSTRES NE DOIVENT ENTRER EN COLLISION AVEC
// AUCUNE AUTRE, et ce test existe parce que c'est arrive.
//
// Le 2026-09-04, la premiere version nommait ses cellules `case`. Or `.case`
// existait deja: c'est le losange des cinq colonnes d'une ligne de compte, et
// il porte `display: grid`. Les `<td class="case">` heritaient de ce display,
// sortaient donc de la mise en table, et les quatre coches d'un archimonstre
// s'empilaient VERTICALEMENT dans la premiere colonne au lieu de se repartir
// sur les quatre personnages.
//
// Le balisage etait juste -- 286 lignes, 6 cellules chacune, verifie -- et le
// code aussi. Seul le nom d'une classe etait deja pris, et RIEN dans le
// projet ne pouvait le dire: ni les tests, ni le navigateur, qui n'a aucune
// raison de se plaindre. La photo du panneau a ete le seul signal.
//
// Assertion sur le SOURCE, comme celle du pont IPC: le chemin concerne
// demanderait un vrai navigateur.

const html = fs.readFileSync(
  path.join(__dirname, '..', 'desktop', 'index.html'), 'utf8',
);

// La table des classes du panneau, declaree en un seul endroit expres: c'est
// ce qui rend ce test possible.
const bloc = html.match(/const ARC = \{([\s\S]*?)\};/);
const classesArchi = bloc === null
  ? []
  : [...bloc[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('le panneau declare ses classes en un seul endroit', () => {
  assert.notStrictEqual(bloc, null, 'la table ARC est introuvable dans index.html');
  assert.ok(classesArchi.length >= 5, `seulement ${classesArchi.length} classes trouvees`);
});

// LE PREFIXE EST LA GARDE. Une classe prefixee ne peut pas tomber sur celle
// d'un autre morceau du panneau, et c'est exactement ce qui a manque.
test('toutes les classes du tableau sont prefixees arc-', () => {
  const nues = classesArchi.filter((c) => !c.startsWith('arc-'));
  assert.deepStrictEqual(nues, []);
});

// Un prefixe ne sert a rien si le reste de la feuille de style s'en sert
// aussi: la seconde moitie de la garde.
test('aucune regle hors du panneau ne definit une classe arc-', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const regles = [...style.matchAll(/\.(arc-[a-z0-9-]+)/g)].map((m) => m[1]);
  const inconnues = regles.filter(
    (c) => !classesArchi.includes(c) && !['arc-table', 'arc-corps', 'arc-pied', 'arc-filtres'].includes(c),
  );
  assert.deepStrictEqual(inconnues, []);
});

// Une classe declaree mais jamais stylee est une coquille qui ne se voit qu'a
// l'oeil, sur le panneau ouvert.
test('chaque classe declaree est stylee quelque part', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const sansStyle = classesArchi.filter((c) => !style.includes('.' + c));
  assert.deepStrictEqual(sansStyle, []);
});

// L'EN-TETE COLLE DOIT ETRE OPAQUE, SINON IL NE COLLE A RIEN.
//
// Le 04/09, la colonne suivie recevait `background: rgba(255,255,255,.05)` --
// un voile, pose pour la reperer. Mais cette regle vient APRES celle qui donne
// `var(--fond)` a l'en-tete: elle ne posait pas un voile PAR-DESSUS le fond,
// elle REMPLACAIT le fond. L'en-tete devenait donc translucide, et les coches
// lui passaient au travers pendant le defilement.
//
// La regle: toute declaration de fond qui touche l'en-tete du tableau doit
// contenir la couleur de fond opaque. Un voile se pose en PLUS, jamais A LA
// PLACE.
test('tout fond pose sur l en-tete du tableau reste opaque', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const sansStyleDeCommentaire = style.replace(/\/\*[\s\S]*?\*\//g, '');
  const regles = [...sansStyleDeCommentaire.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

  const fautives = [];
  for (const [, selecteur, corps] of regles) {
    if (!selecteur.includes('.arc-table th')) continue;
    for (const [, valeur] of corps.matchAll(/background(?:-color)?\s*:\s*([^;]+)/g)) {
      if (!valeur.includes('var(--fond)')) fautives.push(selecteur.trim() + ' -> ' + valeur.trim());
    }
  }
  assert.deepStrictEqual(fautives, []);
});
