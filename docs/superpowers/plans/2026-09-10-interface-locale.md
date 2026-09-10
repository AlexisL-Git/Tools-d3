# Interface locale sur localhost — plan d'implementation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servir l'interface d'OMNI (`desktop/index.html`) sur `http://localhost:8787` avec un faux `window.app` interactif, demarree automatiquement a l'ouverture du projet dans VS Code.

**Architecture:** Trois fichiers dans `outils/`, aucune dependance nouvelle, aucun fichier de production modifie. `faux-etat.js` fabrique l'etat avec le VRAI `construireVue()`; `faux-app.js` est un shim qui pose `window.app` et mute cet etat a chaque ordre; `interface-locale.js` sert `desktop/` en HTTP et injecte les deux dans la page a la volee.

**Tech Stack:** Node >= 18 (`http`, `fs`, `path`), tests `node --test` en CommonJS, VS Code `tasks.json`.

**Spec:** `docs/superpowers/specs/2026-09-10-interface-locale-design.md`

## Global Constraints

- **Aucune dependance nouvelle.** Uniquement les modules du coeur de Node.
- **Aucun fichier de production modifie.** `desktop/index.html`, `desktop/main.js`, `desktop/preload.js` et tout `src/` sont en LECTURE SEULE dans ce plan. Les seules ecritures hors `outils/` sont `.vscode/tasks.json`, `test/*.test.js` et une section du `README.md`.
- **CommonJS partout** (`'use strict';` + `require`), comme le reste du depot.
- **Tests:** fichiers `test/<nom>.test.js`, `require('node:test')` et `require('node:assert')`. Un fichier seul se lance par `node --test test/<nom>.test.js`; la suite entiere par `npm test`.
- **Le serveur ecoute sur `127.0.0.1`**, jamais sur `0.0.0.0`.
- **Port par defaut `8787`**, surchargeable par la variable d'environnement `OMNI_PORT`.
- **Commentaires en francais sans accents**, comme le reste du depot: ils expliquent POURQUOI, pas QUOI.
- **`npm test` doit rester vert** a la fin de chaque tache.

## File Structure

| Fichier | Responsabilite |
|---|---|
| `outils/faux-etat.js` (creer) | Les donnees fictives. Fabrique l'objet `etat` et la liste des comptes pour le tableau archi. Aucun HTTP. |
| `outils/faux-app.js` (creer) | Le shim `window.app`. Pure logique, testable hors navigateur. Aucun HTTP, aucun `require` du depot. |
| `outils/interface-locale.js` (creer) | Le serveur HTTP: fichiers statiques, injection, routes `/faux/*`, rechargement. |
| `.vscode/tasks.json` (creer) | Le demarrage automatique a l'ouverture du dossier. |
| `test/interface-locale-etat.test.js` (creer) | Tache 1 |
| `test/interface-locale-app.test.js` (creer) | Tache 2 |
| `test/interface-locale-serveur.test.js` (creer) | Taches 3, 4 et 5 |
| `README.md` (modifier) | Une section « Voir l'interface sans lancer le jeu » |

---

### Task 1: Le faux etat

**Files:**
- Create: `outils/faux-etat.js`
- Test: `test/interface-locale-etat.test.js`

**Interfaces:**
- Consumes: `construireVue` de `src/comptes/vue.js`; `RYTHME_HDV_DEFAUT` et `GARDE_HDV_DEFAUT` de `src/comptes/favoris.js`; `NOMS` de `src/droits/liste.js`; `estArchimonstre` de `src/pda-archi/archimonstres.js`; les constantes de `src/hdv/reprix.js` et `src/hdv/vente.js`.
- Produces:
  - `fabriquerEtat()` → l'objet envoye sur le canal `etat` par `desktop/main.js:812`. Champs: `version`, `pdaArchi`, `pdaArchiRepli`, `sansMaitre`, `erreurComptes`, `delai`, `hdvRythme`, `hdvGarde`, `hdvBornes`, `avisBascule`, `overlayOuvert`, `droits`, `lignes`.
  - `comptesArchi()` → `[{ pid: number, nom: string, ames: Set<number>|null }]`, tel que `src/pda-archi/tableau.js` l'attend.

- [ ] **Step 1: Write the failing test**

Creer `test/interface-locale-etat.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { fabriquerEtat, comptesArchi } = require('../outils/faux-etat');
const { NOMS } = require('../src/droits/liste');
const hdvReprix = require('../src/hdv/reprix');

// LES SIX ETATS SONT LA RAISON D'ETRE DU FAUX ETAT. Un banc qui ne montre que
// des lignes « intercepte » laisserait passer une regression sur l'affichage
// d'une ligne en erreur ou hors-ligne -- exactement les cas qu'on ne peut pas
// reproduire a la demande avec de vrais clients Dofus.
test('le faux etat couvre les six etats que vue.js sait produire', () => {
  const vus = new Set(fabriquerEtat().lignes.map((l) => l.etat));
  for (const attendu of ['intercepte', 'en-attente', 'non-intercepte', 'erreur', 'hors-ligne', 'inconnu']) {
    assert.ok(vus.has(attendu), `etat absent du faux etat : ${attendu}`);
  }
});

// Rien ne doit etre grise sur le banc: la page grise ce qui n'est pas dans
// `droits`, et un bouton grise sans raison se prend pour un bug de mise en page.
test('le faux etat accorde toutes les fonctions verrouillables', () => {
  assert.deepStrictEqual([...fabriquerEtat().droits].sort(), [...NOMS].sort());
});

test('une ligne et une seule est maitre, et elle est pilotable', () => {
  const etat = fabriquerEtat();
  const maitres = etat.lignes.filter((l) => l.estMaitre);
  assert.strictEqual(maitres.length, 1);
  assert.strictEqual(maitres[0].pilotable, true);
  assert.strictEqual(etat.sansMaitre, false);
});

// Les trois champs que main.js pose APRES construireVue (lignes 785 a 809).
// Les oublier ne casse rien au chargement: ca se voit comme une colonne vide.
test('chaque ligne porte touche, archi et embleme', () => {
  for (const l of fabriquerEtat().lignes) {
    assert.ok('touche' in l, 'touche manquante');
    assert.ok('archi' in l, 'archi manquant');
    assert.strictEqual(l.embleme, null, 'le banc ne telecharge aucun embleme');
  }
});

// `null` et 0 ne veulent pas dire la meme chose: un inventaire pas encore lu
// n'est pas un personnage sans une seule ame. Le banc doit montrer les deux.
test('archi distingue l inventaire non lu du personnage sans ame', () => {
  const lignes = fabriquerEtat().lignes;
  assert.ok(lignes.some((l) => l.archi === null), 'aucune ligne a inventaire non lu');
  assert.ok(lignes.some((l) => l.archi > 0), 'aucune ligne avec des ames');
});

// Recopier les bornes les aurait laissees deriver au premier ajustement
// mesure en jeu -- meme raison que le commentaire de desktop/main.js:25.
test('les bornes hdv viennent des modules, pas d une copie', () => {
  const { hdvBornes } = fabriquerEtat();
  assert.deepStrictEqual(hdvBornes.reprix.lot, [hdvReprix.DELAI_MIN, hdvReprix.DELAI_MAX]);
  assert.deepStrictEqual(hdvBornes.reprix.objet, [hdvReprix.DELAI_OBJET_MIN, hdvReprix.DELAI_OBJET_MAX]);
});

// tableau.js compte sur la difference entre un Set vide et null.
test('les comptes archi melangent inventaires lus et non lus', () => {
  const comptes = comptesArchi();
  assert.ok(comptes.some((c) => c.ames instanceof Set), 'aucun inventaire lu');
  assert.ok(comptes.some((c) => c.ames === null), 'aucun inventaire non lu');
  for (const c of comptes) assert.strictEqual(typeof c.nom, 'string');
});

// Le faux etat est mute par le shim cote navigateur. S'il rendait toujours le
// meme objet, deux onglets partageraient leurs cases a cocher par le serveur.
test('fabriquerEtat rend un objet neuf a chaque appel', () => {
  const a = fabriquerEtat();
  const b = fabriquerEtat();
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.lignes, b.lignes);
  a.lignes[0].passeTour = !a.lignes[0].passeTour;
  assert.notStrictEqual(a.lignes[0].passeTour, b.lignes[0].passeTour);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/interface-locale-etat.test.js`
Expected: FAIL — `Cannot find module '../outils/faux-etat'`.

- [ ] **Step 3: Write the implementation**

Creer `outils/faux-etat.js`:

```js
'use strict';

// LE FAUX ETAT DU BANC D'ESSAI DE L'INTERFACE.
// Conception: docs/superpowers/specs/2026-09-10-interface-locale-design.md
//
// Charge par outils/interface-locale.js et par personne d'autre. Rien ici ne
// part chez les amis: faire-paquet-code.js n'emporte que desktop/ et src/.
//
// LES LIGNES SONT FABRIQUEES PAR LE VRAI construireVue(), jamais ecrites a la
// main. Un faux etat ecrit a la main derive de la vraie forme au premier champ
// ajoute, et le banc se met alors a mentir en silence -- ce qui est pire que
// pas de banc du tout.

const { construireVue } = require('../src/comptes/vue');
const { RYTHME_HDV_DEFAUT, GARDE_HDV_DEFAUT } = require('../src/comptes/favoris');
const { NOMS: DROITS } = require('../src/droits/liste');
const { estArchimonstre } = require('../src/pda-archi/archimonstres');
const hdvReprix = require('../src/hdv/reprix');
const hdvVente = require('../src/hdv/vente');

// Six comptes: un par etat de vue.js, plus le client sans idCompte qui produit
// le sixieme (« inconnu ») en se rangeant tout seul en fin de liste.
const COMPTES = [
  { id: 1, nickname: 'BrokenLegs' },
  { id: 2, nickname: 'squeezie' },
  { id: 3, nickname: 'yoplait' },
  { id: 4, nickname: 'tartiflette' },
  { id: 5, nickname: 'moumoute' },
  { id: 6, nickname: 'gigi' },
];

const CLIENTS = [
  { pid: 101, idCompte: 1, personnage: 'Kroufi', classe: 'Iop' },
  { pid: 102, idCompte: 2, personnage: 'Bellaflore', classe: 'Cra' },
  { pid: 103, idCompte: 3, personnage: 'Pansement', classe: 'Eniripsa' },
  { pid: 104, idCompte: 4, personnage: 'Saignee', classe: 'Sacrieur' },
  { pid: 105, idCompte: 5, personnage: 'Bouclier', classe: 'Feca' },
  // Aucun idCompte: c'est le client « inconnu », celui qu'aucune ligne de
  // compte n'absorbe. Le compte 6 (gigi) reste donc hors-ligne.
  { pid: 106, idCompte: null, personnage: 'Fantome', classe: 'Osamodas' },
];

const MAITRE = 101;

// Les ames de chaque personnage. Un pid ABSENT de cette carte a un inventaire
// NON LU: sa ligne affichera `—` et non `0`.
// Les identifiants sont de vrais archimonstres de src/pda-archi/archimonstres.json.
const AMES = new Map([
  [101, new Set([2354, 2312, 2343])],
  [102, new Set([2354])],
  // Inventaire lu, aucune ame: le zero legitime, a ne pas confondre avec `—`.
  [103, new Set()],
]);

const TOUCHES = { 1: 'F1', 2: 'F2', 3: 'F3' };

const BORNES = {
  reprix: {
    lot: [hdvReprix.DELAI_MIN, hdvReprix.DELAI_MAX],
    objet: [hdvReprix.DELAI_OBJET_MIN, hdvReprix.DELAI_OBJET_MAX],
    pause: [hdvReprix.PAUSE_MIN, hdvReprix.PAUSE_MAX],
    avantPause: [hdvReprix.AVANT_PAUSE_MIN, hdvReprix.AVANT_PAUSE_MAX],
  },
  vente: {
    lot: [hdvVente.DELAI_RAFALE_MIN, hdvVente.DELAI_RAFALE_MAX],
    objet: [hdvVente.DELAI_OBJET_MIN, hdvVente.DELAI_OBJET_MAX],
    pause: [hdvVente.PAUSE_MIN, hdvVente.PAUSE_MAX],
    avantPause: [hdvVente.AVANT_PAUSE_MIN, hdvVente.AVANT_PAUSE_MAX],
  },
};

// Les comptes tels que src/pda-archi/tableau.js les attend. Neufs a chaque
// appel: les Set sont recopies pour qu'un appelant ne puisse pas vider la
// reference partagee.
function comptesArchi() {
  return CLIENTS.map((c) => {
    const ames = AMES.get(c.pid);
    return { pid: c.pid, nom: c.personnage, ames: ames === undefined ? null : new Set(ames) };
  });
}

function fabriquerEtat() {
  const lignes = construireVue({
    comptes: COMPTES,
    clients: CLIENTS,
    // Le pid 104 n'est ni intercepte ni en attente: c'est lui qui produit
    // « non-intercepte », le client lance avant OMNI.
    intercepte: new Set([101, 102, 106]),
    enAttente: new Set([103]),
    erreurs: new Map([[105, 'attache impossible : process not found']]),
    messages: new Map([[102, "InteractiveUseRequest : manque skillInstanceUid pour l'element 4198401"]]),
    maitre: MAITRE,
    exclus: new Set([4]),
    favoris: new Set([1]),
    passeTour: new Set([2, 3]),
    invitation: new Set([1, 2]),
    noAnim: new Set([1]),
    echange: new Set([2]),
  });

  // Les trois champs que desktop/main.js pose APRES construireVue.
  for (const l of lignes) {
    l.touche = l.id === null ? null : (TOUCHES[l.id] || null);
    const ames = l.pid === null || l.pid === undefined ? undefined : AMES.get(l.pid);
    l.archi = ames === undefined ? null : [...ames].filter(estArchimonstre).length;
    // Le banc ne telecharge rien: la page retombe sur l'abreviation de classe,
    // chemin qu'elle sait deja prendre quand le cache d'emblemes est froid.
    l.embleme = null;
  }

  return {
    version: 'dev',
    pdaArchi: false,
    pdaArchiRepli: false,
    sansMaitre: false,
    erreurComptes: null,
    delai: 0,
    hdvRythme: { ...RYTHME_HDV_DEFAUT },
    hdvGarde: { ...GARDE_HDV_DEFAUT },
    hdvBornes: BORNES,
    avisBascule: null,
    overlayOuvert: false,
    droits: [...DROITS],
    lignes,
  };
}

module.exports = { fabriquerEtat, comptesArchi };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/interface-locale-etat.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: aucun echec. Le total de tests augmente de 8.

- [ ] **Step 6: Commit**

```bash
git add outils/faux-etat.js test/interface-locale-etat.test.js
git commit -m "feat(banc): le faux etat de l interface, bati par le vrai construireVue"
```

---

### Task 2: Le faux `window.app`

**Files:**
- Create: `outils/faux-app.js`
- Test: `test/interface-locale-app.test.js`

**Interfaces:**
- Consumes: un objet `etat` de la forme rendue par `fabriquerEtat()` (tache 1).
- Produces: `creerFauxApp(etat, deps)` → l'objet `app`, avec un canal par entree de `desktop/preload.js`.
  - `deps` vaut `{ fetch, journal }`; les deux sont optionnels. `fetch` par defaut `globalThis.fetch`, `journal` par defaut `console.warn`.
  - `app.__etat()` rend l'etat courant (accesseur de test, hors contrat `preload.js`, d'ou le double souligne).

**Note pour l'implementeur:** ce fichier est charge par le navigateur ET par les tests Node. Il n'utilise donc **aucun `require`** et se termine par une double exposition gardee.

- [ ] **Step 1: Write the failing test**

Creer `test/interface-locale-app.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerFauxApp } = require('../outils/faux-app');
const { fabriquerEtat } = require('../outils/faux-etat');

// Chaque canal expose par preload.js doit exister ici sous le MEME nom. Le
// piege est ecrit en tete de desktop/preload.js: un canal manquant ne casse
// rien au chargement, il se voit comme un bouton qui « ne fait rien ». Ce test
// lit le vrai preload.js pour que la liste ne puisse pas deriver.
const fs = require('node:fs');
const path = require('node:path');

test('le shim expose tous les canaux de preload.js', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'preload.js'), 'utf8');
  const bloc = source.slice(source.indexOf('exposeInMainWorld'));
  const canaux = [...bloc.matchAll(/^\s{2}([a-zA-Z]\w*):/gm)].map((m) => m[1]);
  assert.ok(canaux.length > 20, `liste de canaux suspecte : ${canaux.length}`);
  const app = creerFauxApp(fabriquerEtat());
  for (const nom of canaux) {
    assert.strictEqual(typeof app[nom], 'function', `canal absent du shim : ${nom}`);
  }
});

test('surEtat recoit l etat initial tout de suite', () => {
  const app = creerFauxApp(fabriquerEtat());
  let recu = null;
  app.surEtat((e) => { recu = e; });
  assert.ok(recu !== null, 'aucun etat emis');
  assert.strictEqual(recu.version, 'dev');
});

// C'est CE test qui dit que le banc est interactif: cocher laisse coche.
test('basculerPasseTourCompte coche la case et reemet l etat', () => {
  const app = creerFauxApp(fabriquerEtat());
  const recus = [];
  app.surEtat((e) => recus.push(e));
  app.basculerPasseTourCompte(1, true);
  const ligne = recus[recus.length - 1].lignes.find((l) => l.id === 1);
  assert.strictEqual(ligne.passeTour, true);
  assert.strictEqual(recus.length, 2, 'l etat doit etre reemis apres l ordre');
});

test('les quatre autres cases par compte se basculent aussi', () => {
  const app = creerFauxApp(fabriquerEtat());
  app.surEtat(() => {});
  app.basculerInvitationCompte(3, true);
  app.basculerNoAnimCompte(3, true);
  app.basculerEchangeCompte(3, true);
  // exclureCompte est l'inversee de « suit le meneur »: exclu vaut true.
  app.exclureCompte(3, true);
  const l = app.__etat().lignes.find((x) => x.id === 3);
  assert.deepStrictEqual(
    { invitation: l.invitation, noAnim: l.noAnim, echange: l.echange, exclu: l.exclu },
    { invitation: true, noAnim: true, echange: true, exclu: true },
  );
});

test('definirMaitre deplace le maitre sur une seule ligne', () => {
  const app = creerFauxApp(fabriquerEtat());
  app.surEtat(() => {});
  app.definirMaitre(2);
  const lignes = app.__etat().lignes;
  const maitres = lignes.filter((l) => l.estMaitre);
  assert.strictEqual(maitres.length, 1);
  assert.strictEqual(maitres[0].id, 2);
  assert.strictEqual(app.__etat().sansMaitre, false);
});

// Le losange du titre de colonne lit les cinq cases: si l'action groupee ne
// touchait qu'une partie des lignes, il resterait « partiel » pour toujours.
test('basculerColonne bascule toutes les lignes visees', () => {
  const app = creerFauxApp(fabriquerEtat());
  app.surEtat(() => {});
  const ids = app.__etat().lignes.filter((l) => l.id !== null).map((l) => l.id);
  app.basculerColonne('passeTour', ids);
  for (const l of app.__etat().lignes) {
    if (l.id !== null) assert.strictEqual(l.passeTour, true, `ligne ${l.id} non basculee`);
  }
});

test('reglerDelai et reglerTouche ecrivent dans l etat', () => {
  const app = creerFauxApp(fabriquerEtat());
  app.surEtat(() => {});
  app.reglerDelai(3);
  app.reglerTouche(2, 'F7');
  assert.strictEqual(app.__etat().delai, 3);
  assert.strictEqual(app.__etat().lignes.find((l) => l.id === 2).touche, 'F7');
});

// Partiels par construction: le panneau envoie le champ qui vient de bouger,
// pas les cinq. Un champ absent doit garder sa valeur.
test('reglerHdvRythme et reglerHdvGarde sont partiels', () => {
  const app = creerFauxApp(fabriquerEtat());
  app.surEtat(() => {});
  const avant = app.__etat().hdvRythme.pause;
  app.reglerHdvRythme({ lot: 1.6 });
  app.reglerHdvGarde({ facteur: 3 });
  assert.strictEqual(app.__etat().hdvRythme.lot, 1.6);
  assert.strictEqual(app.__etat().hdvRythme.pause, avant, 'un champ absent doit rester');
  assert.strictEqual(app.__etat().hdvGarde.facteur, 3);
});

test('basculerOverlay bascule overlayOuvert', () => {
  const app = creerFauxApp(fabriquerEtat());
  app.surEtat(() => {});
  app.basculerOverlay();
  assert.strictEqual(app.__etat().overlayOuvert, true);
  app.basculerOverlay();
  assert.strictEqual(app.__etat().overlayOuvert, false);
});

test('fermerUnClient retire la ligne du client, fermerTousLesClients les retire toutes', () => {
  const app = creerFauxApp(fabriquerEtat());
  app.surEtat(() => {});
  app.fermerUnClient(3);
  assert.strictEqual(app.__etat().lignes.find((l) => l.id === 3).pid, null);
  app.fermerTousLesClients();
  assert.ok(app.__etat().lignes.every((l) => l.pid === null), 'un client survit');
});

test('les lectures passent par fetch', async () => {
  const appels = [];
  const faux = async (url) => {
    appels.push(url);
    return { ok: true, json: async () => ({ titre: 'Archimonstres', lignes: [] }) };
  };
  const app = creerFauxApp(fabriquerEtat(), { fetch: faux });
  const table = await app.tableauArchi('archi');
  assert.strictEqual(table.titre, 'Archimonstres');
  assert.ok(appels[0].includes('/faux/tableau-archi'), `url inattendue : ${appels[0]}`);
  await app.devlog();
  assert.ok(appels[1].includes('/faux/devlog'), `url inattendue : ${appels[1]}`);
});

test('etatMajGit rend un depot a jour sans reseau', async () => {
  const app = creerFauxApp(fabriquerEtat());
  const r = await app.etatMajGit();
  assert.strictEqual(r.etat, 'a-jour');
});

// Le filet contre le piege de preload.js, vu de l'autre cote: un canal ajoute
// a la page mais pas au shim doit se dire, pas se taire.
test('un canal inconnu est journalise, pas silencieux', () => {
  const dits = [];
  const app = creerFauxApp(fabriquerEtat(), { journal: (m) => dits.push(m) });
  app.__inconnu('canalQuiNExistePas', [1, 2]);
  assert.strictEqual(dits.length, 1);
  assert.ok(dits[0].includes('canalQuiNExistePas'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/interface-locale-app.test.js`
Expected: FAIL — `Cannot find module '../outils/faux-app'`.

- [ ] **Step 3: Write the implementation**

Creer `outils/faux-app.js`:

```js
'use strict';

// LE FAUX window.app DU BANC D'ESSAI.
// Conception: docs/superpowers/specs/2026-09-10-interface-locale-design.md
//
// CE FICHIER EST CHARGE PAR LE NAVIGATEUR autant que par les tests Node: pas
// un seul require, et une double exposition gardee en fin de fichier.
//
// LA LISTE DES CANAUX EST CELLE DE desktop/preload.js, NOM POUR NOM. Le piege
// est ecrit en tete de ce fichier-la: un canal manquant ne casse rien au
// chargement, il se voit au clic, sous la forme d'un bouton qui « ne fait
// rien ». Un test compare les deux listes.
//
// Le shim ne rejoue AUCUNE regle metier. Il ecrit le champ demande et reemet
// l'etat: le banc sert le comportement de la page, pas la logique du produit.

function creerFauxApp(etatInitial, deps) {
  const options = deps || {};
  const chercher = options.fetch || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  const journal = options.journal || ((m) => console.warn(m));

  let etat = etatInitial;
  const abonnesEtat = [];
  const abonnesAmbiance = [];
  const abonnesAlerte = [];

  const emettre = () => { for (const r of abonnesEtat) r(etat); };
  const ligneParId = (id) => etat.lignes.find((l) => l.id === id);
  const lignePid = (pid) => etat.lignes.find((l) => l.pid === pid);
  const inconnu = (nom, args) => journal(`[banc] canal inconnu : ${nom}(${JSON.stringify(args)})`);

  // Un champ booleen d'une ligne, par identifiant de compte.
  const poser = (id, champ, valeur) => {
    const l = ligneParId(id);
    if (l) l[champ] = !!valeur;
    emettre();
  };

  const app = {
    // --- reception -------------------------------------------------------
    surEtat: (rappel) => { abonnesEtat.push(rappel); rappel(etat); },
    surAmbiance: (rappel) => { abonnesAmbiance.push(rappel); },
    surPdaArchiAlerte: (rappel) => { abonnesAlerte.push(rappel); },

    // --- la fenetre: un onglet n'a pas de cadre --------------------------
    fenetreReduire: async () => {},
    fenetreFermer: async () => {},

    // --- la chasse a l archimonstre --------------------------------------
    pdaArchiArmer: async (actif) => { etat.pdaArchi = !!actif; emettre(); },
    pdaArchiRepli: async (actif) => { etat.pdaArchiRepli = !!actif; emettre(); },
    archiRelire: async () => { emettre(); },

    // --- les cases -------------------------------------------------------
    basculerColonne: async (nom, ids) => {
      const vises = Array.isArray(ids) ? ids : [];
      // Le losange dit « tous » seulement si TOUTES les lignes visees le sont:
      // la bascule vise donc l'inverse de l'etat d'ensemble courant.
      const tous = vises.every((id) => { const l = ligneParId(id); return l && l[nom]; });
      for (const id of vises) { const l = ligneParId(id); if (l) l[nom] = !tous; }
      emettre();
    },
    exclureCompte: async (id, exclu) => poser(id, 'exclu', exclu),
    basculerPasseTourCompte: async (id, actif) => poser(id, 'passeTour', actif),
    basculerInvitationCompte: async (id, actif) => poser(id, 'invitation', actif),
    basculerNoAnimCompte: async (id, actif) => poser(id, 'noAnim', actif),
    basculerEchangeCompte: async (id, actif) => poser(id, 'echange', actif),

    // --- qui commande ----------------------------------------------------
    definirMaitre: async (id) => {
      for (const l of etat.lignes) l.estMaitre = false;
      const l = ligneParId(id);
      if (l) l.estMaitre = true;
      etat.sansMaitre = !etat.lignes.some((x) => x.estMaitre);
      emettre();
    },
    basculerVersCompte: async (id) => { inconnu('basculerVersCompte (sans effet sur le banc)', [id]); },

    // --- les raccourcis --------------------------------------------------
    reglerTouche: async (id, accelerateur) => {
      const l = ligneParId(id);
      if (l) l.touche = accelerateur || null;
      emettre();
    },

    // --- l hotel de vente ------------------------------------------------
    majPrixHdv: async (pid) => { const l = lignePid(pid); if (l) l.message = 'passe de prix (banc)'; emettre(); },
    mettreEnVenteHdv: async (pid) => { const l = lignePid(pid); if (l) l.message = 'mise en vente (banc)'; emettre(); },
    reglerHdvRythme: async (partiel) => { etat.hdvRythme = { ...etat.hdvRythme, ...(partiel || {}) }; emettre(); },
    reglerHdvGarde: async (partiel) => { etat.hdvGarde = { ...etat.hdvGarde, ...(partiel || {}) }; emettre(); },

    // --- la barre flottante et la souris ---------------------------------
    basculerOverlay: async () => { etat.overlayOuvert = !etat.overlayOuvert; emettre(); },
    boutonSouris: async (clic) => { inconnu('boutonSouris (sans effet sur le banc)', [clic]); },

    reglerDelai: async (secondes) => {
      const v = Number(secondes);
      etat.delai = Number.isFinite(v) && v >= 0 ? v : 0;
      emettre();
    },

    // --- fermer des clients ----------------------------------------------
    fermerUnClient: async (id) => {
      const l = ligneParId(id);
      if (l) { l.pid = null; l.etat = 'hors-ligne'; l.suivi = false; l.pilotable = false; l.estMaitre = false; }
      etat.sansMaitre = !etat.lignes.some((x) => x.estMaitre);
      emettre();
    },
    fermerTousLesClients: async () => {
      for (const l of etat.lignes) {
        l.pid = null; l.etat = 'hors-ligne'; l.suivi = false; l.pilotable = false; l.estMaitre = false;
      }
      etat.sansMaitre = true;
      emettre();
    },

    // --- les lectures: Node calcule, la page affiche ----------------------
    tableauArchi: async (quoi) => {
      const r = await chercher(`/faux/tableau-archi?quoi=${encodeURIComponent(quoi || 'archi')}`);
      return r.json();
    },
    devlog: async () => {
      const r = await chercher('/faux/devlog');
      return r.json();
    },
    // Le seul canal dont l'absence de handler est NORMALE cote OMNI: chez un
    // ami, l'invoke rejette et la page n'affiche rien. Le banc, lui, est en
    // mode dev: il repond.
    etatMajGit: async () => ({ etat: 'a-jour', retard: 0, branche: 'banc' }),

    // --- accessoires de banc, hors contrat preload.js ---------------------
    __etat: () => etat,
    __inconnu: inconnu,
    __ambiance: () => { for (const r of abonnesAmbiance) r(); },
    __alerte: (a) => { for (const r of abonnesAlerte) r(a); },
  };

  return app;
}

// Cote navigateur: l'etat initial est pose par l'injection du serveur, et un
// bouton discret declenche le son d'ambiance a la demande -- sans lui il
// faudrait attendre une minuterie qui, sur le banc, n'existe pas.
if (typeof window !== 'undefined') {
  window.app = creerFauxApp(window.__FAUX_ETAT__);
  window.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('button');
    b.textContent = 'banc : ambiance';
    b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;opacity:.5;font:11px sans-serif';
    b.onclick = () => window.app.__ambiance();
    document.body.appendChild(b);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { creerFauxApp };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/interface-locale-app.test.js`
Expected: PASS.

Si le premier test echoue en listant des canaux absents, **ajouter ces canaux au shim** — ne pas relacher l'expression reguliere. C'est exactement le service que ce test rend.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: aucun echec.

- [ ] **Step 6: Commit**

```bash
git add outils/faux-app.js test/interface-locale-app.test.js
git commit -m "feat(banc): le faux window.app, interactif et calque sur preload.js"
```

---

### Task 3: Le serveur statique et l'injection

**Files:**
- Create: `outils/interface-locale.js`
- Test: `test/interface-locale-serveur.test.js`

**Interfaces:**
- Consumes: `fabriquerEtat` et `comptesArchi` de `outils/faux-etat.js` (tache 1); le fichier `outils/faux-app.js` (tache 2), servi tel quel.
- Produces:
  - `injecter(html, etat)` → `string`. Insere `<script>window.__FAUX_ETAT__ = ...</script><script src="/faux-app.js"></script>` juste avant le premier `<script>` de la page.
  - `creerServeur()` → `http.Server` non demarre. L'appelant fait `.listen()`.
  - `PORT_DEFAUT` → `8787`.

- [ ] **Step 1: Write the failing test**

Creer `test/interface-locale-serveur.test.js`:

```js
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { creerServeur, injecter } = require('../outils/interface-locale');

let serveur;
let base;

before(async () => {
  serveur = creerServeur();
  await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${serveur.address().port}`;
});

after(async () => {
  // Le flux d'evenements de la tache 5 tient une connexion ouverte: sans
  // closeAllConnections, close() attend indefiniment et la suite se fige.
  if (typeof serveur.closeAllConnections === 'function') serveur.closeAllConnections();
  await new Promise((ok) => serveur.close(ok));
});

// L'injection se fait en memoire. desktop/index.html n'est JAMAIS reecrit:
// c'est la regle qui rend le banc sans danger pour le code de production.
test('l injection precede le premier script de la page', () => {
  const html = '<html><head><style>a{}</style></head><body><script>vrai()</script></body></html>';
  const sorti = injecter(html, { version: 'dev' });
  assert.ok(sorti.indexOf('/faux-app.js') < sorti.indexOf('vrai()'), 'injecte apres le script de la page');
  assert.ok(sorti.includes('__FAUX_ETAT__'));
});

// Un </script> dans les donnees fermerait la balise et casserait la page en
// silence. On echappe le chevron ouvrant, comme partout ailleurs.
test('l injection echappe les chevrons de l etat', () => {
  const sorti = injecter('<script>x</script>', { piege: '</script><script>alert(1)</script>' });
  assert.ok(!sorti.includes('</script><script>alert(1)'), 'chevron non echappe');
  assert.ok(sorti.includes('\\u003c'));
});

test('la racine sert index.html avec l injection', async () => {
  const r = await fetch(`${base}/`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const html = await r.text();
  assert.ok(html.includes('/faux-app.js'), 'injection absente');
  assert.ok(html.includes('__FAUX_ETAT__'), 'etat absent');
});

// L'etat injecte doit etre du JSON relisable: s'il ne l'est pas, la page
// n'affiche rien du tout et l'erreur n'apparait que dans la console.
test('l etat injecte se relit en JSON', async () => {
  const html = await (await fetch(`${base}/`)).text();
  const m = html.match(/window\.__FAUX_ETAT__ = (\{.*?\});<\/script>/s);
  assert.ok(m, 'etat introuvable dans la page');
  const etat = JSON.parse(m[1].replace(/\\u003c/g, '<'));
  assert.strictEqual(etat.version, 'dev');
  assert.ok(etat.lignes.length >= 6);
});

test('le shim est servi en javascript', async () => {
  const r = await fetch(`${base}/faux-app.js`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.ok((await r.text()).includes('creerFauxApp'));
});

test('les polices et le son sont servis avec leur type', async () => {
  const police = await fetch(`${base}/polices/karla.woff2`);
  assert.strictEqual(police.status, 200);
  assert.strictEqual(police.headers.get('content-type'), 'font/woff2');
  const son = await fetch(`${base}/sons/ping.ogg`);
  assert.strictEqual(son.status, 200);
  assert.strictEqual(son.headers.get('content-type'), 'audio/ogg');
});

// Le serveur n'ecoute que sur 127.0.0.1, mais la regle ne coute rien et evite
// d'avoir a y revenir le jour ou quelqu'un le publie « juste pour essayer ».
test('un chemin qui sort de desktop est refuse', async () => {
  const r = await fetch(`${base}/%2e%2e/package.json`);
  assert.strictEqual(r.status, 403);
});

test('un fichier absent rend 404', async () => {
  assert.strictEqual((await fetch(`${base}/rien-du-tout.css`)).status, 404);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/interface-locale-serveur.test.js`
Expected: FAIL — `Cannot find module '../outils/interface-locale'`.

- [ ] **Step 3: Write the implementation**

Creer `outils/interface-locale.js`:

```js
'use strict';

// LE BANC D'ESSAI DE L'INTERFACE, SUR http://localhost:8787
// Conception: docs/superpowers/specs/2026-09-10-interface-locale-design.md
//
// Sert desktop/ tel quel et injecte un faux window.app dans la page. Ce n'est
// PAS un mode de fonctionnement d'OMNI: rien du code de production n'est
// modifie pour lui, et desktop/index.html n'est jamais reecrit -- l'injection
// vit en memoire, le temps d'une reponse.
//
// Lance a l'ouverture du projet par .vscode/tasks.json.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { fabriquerEtat } = require('./faux-etat');

const RACINE = path.join(__dirname, '..', 'desktop');
const SHIM = path.join(__dirname, 'faux-app.js');
const PORT_DEFAUT = 8787;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Le chevron ouvrant devient \u003c: un `</script>` glisse dans une chaine de
// l'etat fermerait la balise injectee et la page ne s'afficherait plus, sans
// un mot ailleurs que dans la console.
function serialiser(etat) {
  return JSON.stringify(etat).replace(/</g, '\\u003c');
}

// Le point d'insertion est le PREMIER `<script>` de la page, retrouve par
// recherche et non par numero de ligne: index.html bouge a chaque seance.
function injecter(html, etat) {
  const balises = `<script>window.__FAUX_ETAT__ = ${serialiser(etat)};</script>`
    + '<script src="/faux-app.js"></script>';
  const i = html.indexOf('<script');
  if (i === -1) return html + balises;
  return html.slice(0, i) + balises + html.slice(i);
}

function repondre(res, code, type, corps) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(corps);
}

function servirFichier(res, chemin) {
  fs.readFile(chemin, (err, contenu) => {
    if (err) return repondre(res, 404, 'text/plain; charset=utf-8', 'introuvable');
    const type = TYPES[path.extname(chemin).toLowerCase()] || 'application/octet-stream';
    return repondre(res, 200, type, contenu);
  });
}

function creerServeur() {
  return http.createServer((req, res) => {
    let chemin;
    try {
      chemin = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch (e) {
      return repondre(res, 400, 'text/plain; charset=utf-8', 'chemin illisible');
    }

    if (chemin === '/' || chemin === '/index.html') {
      return fs.readFile(path.join(RACINE, 'index.html'), 'utf8', (err, html) => {
        if (err) return repondre(res, 500, 'text/plain; charset=utf-8', 'index.html illisible');
        return repondre(res, 200, TYPES['.html'], injecter(html, fabriquerEtat()));
      });
    }

    if (chemin === '/faux-app.js') return servirFichier(res, SHIM);

    const resolu = path.resolve(RACINE, '.' + chemin);
    if (resolu !== RACINE && !resolu.startsWith(RACINE + path.sep)) {
      return repondre(res, 403, 'text/plain; charset=utf-8', 'hors du dossier');
    }
    return servirFichier(res, resolu);
  });
}

if (require.main === module) {
  const port = Number(process.env.OMNI_PORT) || PORT_DEFAUT;
  const serveur = creerServeur();
  // Pas de saut silencieux vers un autre port: l'onglet Simple Browser
  // pointerait dans le vide sans qu'on comprenne pourquoi.
  serveur.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`[banc] le port ${port} est deja pris. OMNI_PORT=xxxx pour en changer.`);
      process.exit(1);
    }
    throw e;
  });
  serveur.listen(port, '127.0.0.1', () => {
    console.log(`[banc] interface d'OMNI sur http://localhost:${port}`);
  });
}

module.exports = { creerServeur, injecter, PORT_DEFAUT };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/interface-locale-serveur.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Look at it for real**

Run: `node outils/interface-locale.js`
Ouvrir `http://localhost:8787` dans un navigateur. Attendu: le panneau d'OMNI, sept lignes, les abreviations de classe a la place des emblemes. `Ctrl+C` pour arreter.

Le tableau des archimonstres n'est PAS encore cense marcher — c'est la tache 4.

- [ ] **Step 6: Commit**

```bash
git add outils/interface-locale.js test/interface-locale-serveur.test.js
git commit -m "feat(banc): le serveur local qui sert l interface et injecte le faux app"
```

---

### Task 4: Les routes de lecture `/faux/*`

**Files:**
- Modify: `outils/interface-locale.js` (ajouter les routes avant la resolution statique)
- Test: `test/interface-locale-serveur.test.js` (ajouter des tests a la suite)

**Interfaces:**
- Consumes: `comptesArchi()` de `outils/faux-etat.js`; `construire` de `src/pda-archi/tableau.js`.
- Produces: `GET /faux/tableau-archi?quoi=<collection>` → le JSON de `construire()`; `GET /faux/devlog` → `desktop/devlog.json` tel quel.

- [ ] **Step 1: Write the failing test**

Ajouter a la fin de `test/interface-locale-serveur.test.js`:

```js
// Le navigateur ne peut pas charger un module CommonJS: c'est Node qui calcule
// le tableau avec le VRAI src/pda-archi/tableau.js, la page qui l'affiche.
test('le tableau archi est calcule par le vrai module', async () => {
  const r = await fetch(`${base}/faux/tableau-archi?quoi=archi`);
  assert.strictEqual(r.status, 200);
  const table = await r.json();
  assert.ok(table.total > 200, `total suspect : ${table.total}`);
  assert.strictEqual(table.lignes.length, table.total);
  assert.ok(Array.isArray(table.comptes) && table.comptes.length > 0);
  assert.ok(table.comptes.some((c) => c.lu === true), 'aucun inventaire lu');
  assert.ok(table.comptes.some((c) => c.lu === false), 'aucun inventaire non lu');
  assert.ok(table.zones, 'la vue par zones manque');
});

// Meme repli que le handler d'OMNI: une valeur inconnue rend les
// archimonstres, le panneau ne peut pas casser sur une faute de frappe.
test('une collection inconnue retombe sur les archimonstres', async () => {
  const a = await (await fetch(`${base}/faux/tableau-archi?quoi=nimportequoi`)).json();
  const b = await (await fetch(`${base}/faux/tableau-archi?quoi=archi`)).json();
  assert.strictEqual(a.titre, b.titre);
});

test('le devlog est servi tel quel', async () => {
  const r = await fetch(`${base}/faux/devlog`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /json/);
  const attendu = require('../desktop/devlog.json');
  assert.deepStrictEqual(await r.json(), attendu);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/interface-locale-serveur.test.js`
Expected: FAIL — les trois nouveaux tests recoivent 404 (la resolution statique ne trouve pas `desktop/faux/...`).

- [ ] **Step 3: Write the implementation**

Dans `outils/interface-locale.js`, ajouter aux requires du haut:

```js
const { comptesArchi } = require('./faux-etat');
const { construire: construireTableauArchi } = require('../src/pda-archi/tableau');
```

(la ligne `const { fabriquerEtat } = require('./faux-etat');` devient
`const { fabriquerEtat, comptesArchi } = require('./faux-etat');`)

Puis, dans `creerServeur()`, inserer ce bloc **juste apres** la route `/faux-app.js` et **avant** le calcul de `resolu`:

```js
    if (chemin === '/faux/tableau-archi') {
      const quoi = new URL(req.url, 'http://127.0.0.1').searchParams.get('quoi');
      const table = construireTableauArchi({
        quoi: typeof quoi === 'string' && quoi ? quoi : 'archi',
        comptes: comptesArchi(),
      });
      return repondre(res, 200, TYPES['.json'], JSON.stringify(table));
    }

    if (chemin === '/faux/devlog') return servirFichier(res, path.join(RACINE, 'devlog.json'));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/interface-locale-serveur.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Look at it for real**

Run: `node outils/interface-locale.js`
Sur `http://localhost:8787`: ouvrir le tableau des archimonstres. Attendu: des lignes, PAS le message « Le tableau n'a pas pu être construit ». Cliquer le numero de version affiche les notes. `Ctrl+C`.

- [ ] **Step 6: Commit**

```bash
git add outils/interface-locale.js test/interface-locale-serveur.test.js
git commit -m "feat(banc): le tableau archi et le devlog, calcules par les vrais modules"
```

---

### Task 5: Le rechargement automatique

**Files:**
- Modify: `outils/interface-locale.js`
- Modify: `outils/faux-app.js` (abonnement `EventSource`)
- Test: `test/interface-locale-serveur.test.js`

**Interfaces:**
- Produces: `creerDiffuseur({ delaiMs })` → `{ abonner(res), signaler(), nombreAbonnes() }`. `signaler()` groupe les appels rapproches: deux signaux a moins de `delaiMs` d'intervalle n'ecrivent qu'un evenement. Exporte pour le test.
- Produces: `GET /faux/rechargement` → flux `text/event-stream`.

- [ ] **Step 1: Write the failing test**

Ajouter a la fin de `test/interface-locale-serveur.test.js`:

```js
const { creerDiffuseur } = require('../outils/interface-locale');

// fs.watch emet souvent DEUX evenements pour un seul enregistrement
// d'editeur. Sans regroupement, l'onglet se rechargerait deux fois -- et le
// second rechargement arrive pendant le premier.
test('deux signaux rapproches ne font qu un evenement', async () => {
  const diffuseur = creerDiffuseur({ delaiMs: 10 });
  const ecrits = [];
  diffuseur.abonner({ write: (t) => ecrits.push(t), on: () => {} });
  diffuseur.signaler();
  diffuseur.signaler();
  await new Promise((ok) => setTimeout(ok, 40));
  assert.strictEqual(ecrits.length, 1, `evenements ecrits : ${ecrits.length}`);
  assert.ok(ecrits[0].includes('data:'));
});

test('deux signaux espaces font deux evenements', async () => {
  const diffuseur = creerDiffuseur({ delaiMs: 10 });
  const ecrits = [];
  diffuseur.abonner({ write: (t) => ecrits.push(t), on: () => {} });
  diffuseur.signaler();
  await new Promise((ok) => setTimeout(ok, 40));
  diffuseur.signaler();
  await new Promise((ok) => setTimeout(ok, 40));
  assert.strictEqual(ecrits.length, 2);
});

test('la route de rechargement ouvre un flux d evenements', async () => {
  const ctrl = new AbortController();
  const r = await fetch(`${base}/faux/rechargement`, { signal: ctrl.signal });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  ctrl.abort();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/interface-locale-serveur.test.js`
Expected: FAIL — `creerDiffuseur is not a function`.

- [ ] **Step 3: Write the implementation**

Dans `outils/interface-locale.js`, ajouter apres la fonction `injecter`:

```js
// LE REGROUPEMENT N'EST PAS UN LUXE: fs.watch emet souvent deux evenements
// pour un seul enregistrement d'editeur, et le second rechargement d'onglet
// arriverait pendant le premier.
function creerDiffuseur(options) {
  const delaiMs = (options && options.delaiMs) || 100;
  const abonnes = new Set();
  let minuterie = null;

  return {
    abonner(res) {
      abonnes.add(res);
      res.on('close', () => abonnes.delete(res));
    },
    signaler() {
      if (minuterie !== null) return;
      minuterie = setTimeout(() => {
        minuterie = null;
        for (const res of abonnes) res.write('data: recharge\n\n');
      }, delaiMs);
      // Une minuterie en vol ne doit pas retenir le process au moment de
      // fermer le serveur.
      if (typeof minuterie.unref === 'function') minuterie.unref();
    },
    nombreAbonnes: () => abonnes.size,
  };
}
```

Dans `creerServeur()`, au tout debut de la fonction (avant le `return http.createServer`):

```js
  const diffuseur = creerDiffuseur({ delaiMs: 100 });
  // Les deux fichiers qui changent pendant une seance de mise en page. Le shim
  // n'y est pas: le modifier demande de toute facon un rechargement complet du
  // serveur, qui redemarre la tache et donc l'onglet.
  for (const cible of [path.join(RACINE, 'index.html'), path.join(__dirname, 'faux-etat.js')]) {
    try {
      const veilleur = fs.watch(cible, () => diffuseur.signaler());
      veilleur.unref();
    } catch (e) {
      console.warn(`[banc] surveillance impossible : ${cible}`);
    }
  }
```

Et, dans le gestionnaire de requete, **avant** la route `/faux/tableau-archi`:

```js
    if (chemin === '/faux/rechargement') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write('\n');
      return diffuseur.abonner(res);
    }
```

Enfin, ajouter `creerDiffuseur` a `module.exports`:

```js
module.exports = { creerServeur, injecter, creerDiffuseur, PORT_DEFAUT };
```

Dans `outils/faux-app.js`, dans le bloc `if (typeof window !== 'undefined')`, ajouter avant la fin du bloc:

```js
  // Tu enregistres, l'onglet se recharge. Sans ca, le Simple Browser demande
  // un clic droit puis « Reload » a chaque essai -- exactement le frottement
  // que le banc existe pour supprimer.
  if (typeof EventSource !== 'undefined') {
    new EventSource('/faux/rechargement').onmessage = () => location.reload();
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/interface-locale-serveur.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Look at it for real**

Run: `node outils/interface-locale.js`, ouvrir `http://localhost:8787`, puis modifier une couleur dans `desktop/index.html` et enregistrer. Attendu: l'onglet se recharge seul, une fois et pas deux. **Annuler la modification** (`git checkout desktop/index.html`) avant de continuer.

- [ ] **Step 6: Run the whole suite and commit**

```bash
npm test
git add outils/interface-locale.js outils/faux-app.js test/interface-locale-serveur.test.js
git commit -m "feat(banc): l onglet se recharge a l enregistrement"
```

---

### Task 6: Le demarrage automatique dans VS Code

**Files:**
- Create: `.vscode/tasks.json`
- Modify: `README.md` (nouvelle section apres « Travailler en local, sans rien publier »)

**Interfaces:**
- Consumes: `node outils/interface-locale.js` (tache 3).
- Produces: rien de programmatique. Verification manuelle.

- [ ] **Step 1: Write the task file**

Creer `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "OMNI — interface locale",
      "detail": "Sert desktop/index.html sur http://localhost:8787 avec un faux etat",
      "type": "shell",
      "command": "node outils/interface-locale.js",
      "isBackground": true,
      "runOptions": { "runOn": "folderOpen" },
      "presentation": {
        "panel": "dedicated",
        "reveal": "silent",
        "showReuseMessage": false
      },
      "problemMatcher": []
    }
  ]
}
```

- [ ] **Step 2: Verify the task file is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('.vscode/tasks.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Add the README section**

Dans `README.md`, inserer cette section **juste apres** la section « Travailler en local, sans rien publier » (avant « Publier une mise a jour aux amis »):

```markdown
## Voir l'interface sans lancer le jeu

```powershell
node outils\interface-locale.js   # http://localhost:8787
```

Un banc d'essai: la page d'OMNI servie en HTTP avec un **faux etat** — six
comptes fictifs couvrant les six etats, aucune connexion a Dofus. Les cases
cochent, le maitre change, le tableau des archimonstres se construit. Utile
pour travailler la mise en page sans refabriquer le paquet ni ouvrir un seul
client.

VS Code lance ce serveur tout seul a l'ouverture du dossier
(`.vscode/tasks.json`); il demande **une fois** d'autoriser les taches
automatiques du dossier. L'onglet, lui, s'ouvre a la main la premiere fois —
`Ctrl+Shift+P`, « Simple Browser: Show », `http://localhost:8787` — et VS Code
le restaure ensuite a chaque reouverture.

Ce banc ne rejoue aucune regle metier: cocher « passe-tour » y coche une case,
rien de plus. Il ne part pas dans le paquet des amis (`outils/` n'est pas
emporte par `faire-paquet-code.js`).
```

- [ ] **Step 4: Verify the whole thing end to end**

1. `npm test` → aucun echec.
2. Fermer VS Code, rouvrir le dossier `F:\omni_project`.
3. Autoriser les taches automatiques si VS Code le demande.
4. Le terminal montre `[banc] interface d'OMNI sur http://localhost:8787`.
5. `Ctrl+Shift+P` → « Simple Browser: Show » → `http://localhost:8787`.
6. La page montre **sept lignes**, une par etat, avec les abreviations de classe.
7. Cocher « passe-tour » sur une ligne: la case **reste** cochee.
8. Cliquer le titre de la colonne: toutes les lignes basculent, le losange change.
9. Cliquer une autre ligne en maitre: le marqueur se deplace.
10. Ouvrir le tableau des archimonstres: des lignes, pas de message d'erreur.
11. La console du navigateur (F12) ne montre **aucun** `[banc] canal inconnu`.
    S'il y en a, **ajouter le canal manquant a `outils/faux-app.js`** et relancer.
12. Fermer et rouvrir le dossier: la tache repart, l'onglet Simple Browser revient.

- [ ] **Step 5: Commit**

```bash
git add .vscode/tasks.json README.md
git commit -m "feat(banc): demarrage automatique a l ouverture du projet dans VS Code"
```

---

## Ce que ce plan ne fait pas

Ecrit dans la spec, repete ici pour l'implementeur qui ne lirait que le plan:

- **Aucun etat reel.** Le banc ne parle pas a un OMNI qui tourne.
- **Aucune regle metier rejouee.** Le shim ecrit un champ, il n'exerce pas `src/`.
- **L'overlay (`desktop/overlay.html`) n'est pas servi.**
- **Rien n'entre dans le paquet des amis.**
