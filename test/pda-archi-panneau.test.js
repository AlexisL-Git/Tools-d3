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
    (c) => !classesArchi.includes(c)
      && !['arc-table', 'arc-corps', 'arc-pied', 'arc-filtres', 'arc-relire',
        'arc-filtres-liste', 'arc-onglets', 'arc-segmente', 'arc-discret', 'arc-pastille'].includes(c),
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
    dataset: {}, style: {}, children: [], ecouteurs: [],
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener(t, f) { if (t === 'click') this.ecouteurs.push(f); },
    setAttribute() {},
    append(...k) { this.children.push(...k); },
    appendChild(k) { this.children.push(k); },
    querySelectorAll: () => [], querySelector: () => null,
    // Cliquer POUR DE VRAI: sans ca, le cablage d'un bouton n'est jamais
    // execute, et c'est exactement la ou se cachaient les pannes muettes.
    clic() { return Promise.all(this.ecouteurs.map((f) => f({ stopPropagation() {} }))); },
  };
}

// Les boutons de la barre de filtres, LUS DANS LE HTML plutot que recopies:
// ajouter un bouton dans la page le fait entrer ici tout seul.
function boutonsDeLaBarre() {
  const barre = html.slice(html.indexOf('<div class="arc-filtres">'), html.indexOf('<div class="arc-corps"'));
  return [...barre.matchAll(/data-(vue|filtre|quoi)="([^"]+)"/g)].map((m) => {
    const n = noeud();
    n.dataset[m[1]] = m[2];
    return n;
  });
}

// Ouvre le panneau comme le ferait un clic sur le bouton d'une ligne, et rend
// les noeuds pour qu'on puisse regarder ce qui s'y est ecrit.
async function ouvrirLePanneau({
  vise = 101, vue = 'liste', echoue = false, complet = false, viseComplet = false,
} = {}) {
  const appels = { table: 0, relire: 0, args: [] };
  const { ARCHIMONSTRES } = require('../src/pda-archi/archimonstres');
  const tout = new Set(ARCHIMONSTRES.map((a) => a.id));
  // `viseComplet`: celui dont on clique le bouton a TOUT, l'autre n'a RIEN.
  // C'est la configuration du bug du 05/09, et elle ne ressemble a aucune des
  // deux autres.
  const comptes = () => {
    if (complet) {
      return [{ pid: 101, nom: 'Un', ames: tout }, { pid: 102, nom: 'Deux', ames: tout }];
    }
    if (viseComplet) {
      return [{ pid: 101, nom: 'Un', ames: tout }, { pid: 102, nom: 'Deux', ames: new Set() }];
    }
    return [
      { pid: 101, nom: 'Un', ames: new Set([2272]) },
      { pid: 102, nom: 'Deux', ames: new Set() },
    ];
  };
  const table = construire({ comptes: comptes() });
  const parId = new Map();
  const boutons = boutonsDeLaBarre();
  const document = {
    getElementById: (id) => {
      if (!parId.has(id)) parId.set(id, noeud());
      return parId.get(id);
    },
    createElement: () => noeud(),
    querySelectorAll: (sel) => (sel === '.arc-filtres button' ? boutons : []),
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
        tableauArchi: async (...args) => {
          appels.table += 1;
          appels.args.push(args);
          if (echoue) throw new Error('le service a refusé');
          return table;
        },
        archiRelire: async () => {
          appels.relire += 1;
          return { ok: true, demandes: 2, total: 2 };
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
  return { parId, appels, boutons };
}

test('un clic sur le bouton d une ligne ouvre le panneau', async () => {
  const { parId } = await ouvrirLePanneau();
  assert.strictEqual(parId.get('vueArchi').hidden, false);
});

test('le tableau se remplit', async () => {
  const { parId } = await ouvrirLePanneau();
  const corps = parId.get('arcCorps').innerHTML;
  assert.ok(corps.includes('Pichakoté le Dégoutant'), 'le tableau doit nommer les archimonstres');
  assert.ok(parId.get('arcPied').innerHTML.includes('286'), 'le pied doit donner le total');
});

test('la vue par zone se remplit aussi', async () => {
  const { parId } = await ouvrirLePanneau({ vue: 'zones' });
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
  const { parId } = await ouvrirLePanneau({ echoue: true });
  assert.strictEqual(parId.get('vueArchi').hidden, false);
  assert.match(parId.get('arcCorps').innerHTML, /n’a pas pu être construit/);
  assert.match(parId.get('arcCorps').innerHTML, /le service a refusé/);
});

// LE BOUTON ROND: redemander l'inventaire de tous les clients, sans
// reconnexion. `ivx` ne tombe qu'a la connexion, donc sans lui une capture
// faite en jouant n'apparaissait qu'apres un aller-retour par l'ecran de
// connexion.
//
// Il fait DEUX choses, et l'ordre compte: il demande, puis il relit. Demander
// sans relire ne montrerait rien; relire sans demander relirait l'ancien.
test('le bouton rond redemande les inventaires puis relit le tableau', async () => {
  const { parId, appels } = await ouvrirLePanneau();
  assert.strictEqual(appels.table, 1);
  await parId.get('arcRelire').onclick();
  assert.strictEqual(appels.relire, 1, 'il doit demander');
  assert.strictEqual(appels.table, 2, 'puis relire');
});

test('le bouton rond dit ce qu il a fait', async () => {
  const { parId } = await ouvrirLePanneau();
  await parId.get('arcRelire').onclick();
  assert.match(parId.get('arcAvis').textContent, /2/);
});

// LES FILTRES DISPARAISSENT DANS LA VUE PAR ZONE. Ils n'y ont aucun effet: les
// laisser, meme gris, promet un geste qui n'existe pas. Demande de Jibef le
// 2026-09-04.
test('les filtres ne s affichent pas dans la vue par zone', async () => {
  const { parId } = await ouvrirLePanneau({ vue: 'zones' });
  assert.strictEqual(parId.get('arcFiltresListe').hidden, true);
});

test('les filtres reviennent dans la vue liste', async () => {
  const { parId } = await ouvrirLePanneau({ vue: 'liste' });
  assert.strictEqual(parId.get('arcFiltresListe').hidden, false);
});

// LE SELECTEUR DE COLLECTION: les 286 archimonstres, ou les 51 boss du Dofus
// Ocre. La quete demande les deux, ce sont deux tables et un seul panneau.
//
// Changer de collection DEMANDE UNE NOUVELLE TABLE, contrairement au changement
// de vue qui redessine ce qu'on a deja: c'est le process principal qui croise.
test('le selecteur de collection redemande la table des boss', async () => {
  const { appels, boutons } = await ouvrirLePanneau();
  assert.deepStrictEqual(appels.args, [['archi']]);
  await boutons.find((b) => b.dataset.quoi === 'boss').clic();
  assert.deepStrictEqual(appels.args.at(-1), ['boss']);
});

test('le selecteur de vue, lui, ne redemande rien', async () => {
  const { appels, boutons } = await ouvrirLePanneau();
  await boutons.find((b) => b.dataset.vue === 'zones').clic();
  assert.strictEqual(appels.table, 1, 'la vue par zone voyage deja avec la table');
});

// LE BOUTON D'UN PERSONNAGE COMPLET NE VIDE PAS LA VUE PAR ZONE, et c'est le
// bug du 05/09. Le panneau s'ouvre TOUJOURS par le bouton d'une ligne: quand
// « manquant » se restreignait a ce personnage, ouvrir depuis celui qui avait
// tout affichait « plus rien a chasser » alors que ses trois mules n'avaient
// rien pris. On lisait donc une collection finie qui ne l'etait pas.
test('ouverte d un complet, la vue par zone montre ce qui manque aux autres', async () => {
  const { parId } = await ouvrirLePanneau({ vue: 'zones', viseComplet: true });
  const corps = parId.get('arcCorps').innerHTML;
  assert.ok(corps.includes('Amakna'), 'Deux n a rien pris en Amakna');
  assert.doesNotMatch(corps, /plus rien/i);
});

// PLUS RIEN A CHASSER DOIT SE DIRE. Depuis que les zones terminees
// disparaissent, une collection finie rend une liste vide -- et un panneau
// blanc ne se distingue pas d'un panneau casse.
test('la vue par zone dit quand il ne reste plus rien', async () => {
  const { parId } = await ouvrirLePanneau({ vue: 'zones', complet: true });
  assert.match(parId.get('arcCorps').innerHTML, /plus rien/i);
});

// LES DEUX ONGLETS DE COLLECTION PORTENT UNE ICONE, et c'est ce qui les
// distingue au premier coup d'oeil du reste de la barre. Un futur remaniement
// qui les reduirait a du texte ferait retomber la barre dans ce qu'elle etait:
// sept boutons identiques sur une ligne.
test('chaque onglet de collection porte une icone', () => {
  const barre = html.slice(html.indexOf('<div class="arc-filtres">'), html.indexOf('<div class="arc-corps"'));
  for (const quoi of ['archi', 'boss']) {
    const marque = barre.indexOf(`data-quoi="${quoi}"`);
    assert.ok(marque >= 0, `le bouton ${quoi} est introuvable`);
    const debut = barre.lastIndexOf('<button', marque);
    assert.match(barre.slice(debut, barre.indexOf('</button>', marque)), /<svg/,
      `le bouton ${quoi} n a pas d icone`);
  }
});

// DEPUIS LA PASTILLE, C'EST ELLE QUI PORTE L'ETAT ACTIF: les segments n'ont
// plus de remplissage a eux. Un groupe segmente qui perdrait sa pastille
// n'aurait donc plus AUCUN signal d'etat -- trois boutons identiques dont
// aucun ne dit lequel est choisi.
test('chaque groupe segmente porte sa pastille', () => {
  const barre = html.slice(html.indexOf('<div class="arc-filtres">'), html.indexOf('<div class="arc-corps"'));
  const groupes = barre.match(/class="arc-segmente[^"]*"/g) || [];
  const pastilles = barre.match(/class="arc-pastille"/g) || [];
  assert.ok(groupes.length >= 2, 'les deux groupes segmentes sont introuvables');
  assert.strictEqual(pastilles.length, groupes.length, 'un groupe segmente n a pas de pastille');
});
