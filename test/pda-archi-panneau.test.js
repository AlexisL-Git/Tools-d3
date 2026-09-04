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

// LE PANNEAU S'OUVRE VRAIMENT, et c'est le seul test qui execute son code.
//
// Le 04/09, une reecriture de `dessinerZones` a emporte la fonction qui la
// suivait, `gardeLigne`. `dessinerArchi()` levait donc un ReferenceError -- et
// comme l'erreur tombait dans une fonction `async` dont personne n'attrapait le
// rejet, le clic sur le bouton ne faisait RIEN. Pas de message, pas de trace,
// rien. Ni le navigateur ni les tests de source ne pouvaient le dire.
//
// Le DOM de facade ne simule que ce que ce chemin touche. Il n'a pas vocation a
// grandir: le jour ou il faudrait vraiment un navigateur, c'est qu'il faut un
// vrai navigateur.
const vm = require('node:vm');
const { construire } = require('../src/pda-archi/tableau');

function noeud() {
  return {
    textContent: '', innerHTML: '', hidden: true, disabled: false, title: '',
    dataset: {}, style: {}, children: [],
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {}, setAttribute() {},
    append(...k) { this.children.push(...k); },
    appendChild(k) { this.children.push(k); },
    querySelectorAll: () => [], querySelector: () => null,
  };
}

// Ouvre le panneau comme le ferait un clic sur le bouton d'une ligne, et rend
// les noeuds pour qu'on puisse regarder ce qui s'y est ecrit.
async function ouvrirLePanneau({ vise = 101, vue = 'liste', echoue = false } = {}) {
  const table = construire({
    comptes: [
      { pid: 101, nom: 'Un', ames: new Set([2272]) },
      { pid: 102, nom: 'Deux', ames: new Set() },
    ],
    vise,
  });
  const parId = new Map();
  const document = {
    getElementById: (id) => {
      if (!parId.has(id)) parId.set(id, noeud());
      return parId.get(id);
    },
    createElement: () => noeud(),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
    body: noeud(),
  };
  const contexte = {
    document,
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    window: {
      addEventListener() {},
      app: {
        surEtat() {},
        surPdaArchiAlerte() {},
        tableauArchi: async () => {
          if (echoue) throw new Error('le service a refusé');
          return table;
        },
      },
    },
  };
  contexte.window.document = document;
  vm.createContext(contexte);
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  vm.runInContext(
    script + '\n;globalThis.__ouvrir = ouvrirArchi; globalThis.__vue = (v) => { arcVue = v; };',
    contexte,
  );
  if (vue !== 'liste') contexte.__vue(vue);
  await contexte.__ouvrir(vise);
  return parId;
}

test('un clic sur le bouton d une ligne ouvre le panneau', async () => {
  const parId = await ouvrirLePanneau();
  assert.strictEqual(parId.get('vueArchi').hidden, false);
});

test('le tableau se remplit', async () => {
  const parId = await ouvrirLePanneau();
  const corps = parId.get('arcCorps').innerHTML;
  assert.ok(corps.includes('Pichakoté le Dégoutant'), 'le tableau doit nommer les archimonstres');
  assert.ok(parId.get('arcPied').innerHTML.includes('286'), 'le pied doit donner le total');
});

test('la vue par zone se remplit aussi', async () => {
  const parId = await ouvrirLePanneau({ vue: 'zones' });
  const corps = parId.get('arcCorps').innerHTML;
  assert.ok(corps.includes('Amakna'), 'la vue par zone doit nommer les zones');
});

// UN CLIC QUI NE FAIT RIEN EST LE PIRE DES ECHECS DE CE PROJET, et celui-ci
// s'est produit deux fois sur ce seul panneau. `ouvrirArchi` est `async`: toute
// exception y devient un rejet que personne n'attrape, et le panneau reste
// simplement ferme. L'utilisateur, lui, voit un bouton casse.
//
// Le panneau doit donc s'ouvrir MEME EN ECHEC, et dire pourquoi.
test('une ouverture qui echoue s ouvre quand meme et le dit', async () => {
  const parId = await ouvrirLePanneau({ echoue: true });
  assert.strictEqual(parId.get('vueArchi').hidden, false);
  assert.match(parId.get('arcCorps').innerHTML, /n’a pas pu être construit/);
  assert.match(parId.get('arcCorps').innerHTML, /le service a refusé/);
});
