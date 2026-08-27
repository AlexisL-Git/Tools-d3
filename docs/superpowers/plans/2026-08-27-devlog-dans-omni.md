# Devlog consultable depuis OMNI — plan d'implementation

> **Pour les agents :** SOUS-SKILL REQUISE : utiliser superpowers:subagent-driven-development (recommande) ou superpowers:executing-plans pour executer ce plan tache par tache. Les etapes utilisent des cases a cocher (`- [ ]`).

**But :** rendre le numero de version cliquable en bas de la fenetre d'OMNI, pour ouvrir un panneau qui raconte ce que chaque version a apporte.

**Architecture :** un fichier `desktop/devlog.json` porte tout l'historique et voyage dans l'archive de code (donc il arrive par la mise a jour automatique, sans reinstallation). Un module `desktop/devlog.js` le lit et le valide. Le rendu, en `contextIsolation: true`, y accede par un canal IPC (`ipcMain.handle('devlog')` + `app.devlog()` dans le preload), comme les quinze autres ordres du pont.

**Pile technique :** Electron, JavaScript CommonJS, aucun framework, aucune dependance nouvelle. Tests : `node --test` (module natif).

**Spec :** `docs/superpowers/specs/2026-08-27-devlog-dans-omni-design.md`
**Branche :** `feat/devlog` (deja creee, spec commitee en `2b0e281`)

## Contraintes globales

- **Aucune dependance nouvelle.** L'archive de code ne transporte pas `node_modules` : un `require` d'un paquet non present dans le paquet casse OMNI chez tous les amis.
- **Le rendu n'a acces ni au disque, ni au reseau, ni aux process** (`desktop/main.js:522-525` : `contextIsolation: true`, `nodeIntegration: false`). Toute lecture de fichier passe par `preload.js` + `ipcMain.handle`.
- **`.barre-titre` est `-webkit-app-region: drag`** (`desktop/index.html:95`). Tout element cliquable pose dedans **doit** porter `-webkit-app-region: no-drag`, sinon Windows traite le clic comme un deplacement de fenetre et **le bouton ne fait rien**. C'est deja le cas de `.fenetre-boutons` (ligne 107) et `.maitre-inter` (ligne 126).
- **`test/pont-ipc.test.js` verifie le pont dans LES DEUX SENS** : ce que `index.html` appelle doit etre expose par `preload.js`, et rien d'expose ne doit rester inutilise. Ajouter `devlog` au preload sans l'appeler depuis `index.html` fait **echouer** la suite.
- **Francais partout** : identifiants, commentaires, notes du devlog. Le depot n'a pas un seul identifiant anglais dans le code metier.
- **Le devlog est du confort.** Aucune anomalie de lecture ne doit lever une exception qui remonte a la fenetre. Fichier absent, JSON casse, entree mal formee : moins de notes affichees, jamais un plantage.
- **Ne rien inventer dans les notes.** Chaque affirmation retroactive doit correspondre a un commit reel, verifie par `git log`.
- **Suite complete :** `npm test` a la racine (= `node --test`). Reference avant travaux : **601 tests verts**.

---

### Tache 1 : le module de lecture `desktop/devlog.js`

**Fichiers :**
- Creer : `desktop/devlog.js`
- Creer : `test/devlog.test.js`

**Interfaces :**
- Consomme : rien.
- Produit : `lireDevlog(chemin)` → `Array<{version: string, le?: string, notes: string[]}>`, trie par version decroissante, `[]` en cas de probleme. Et `CHEMIN` → chaine, chemin absolu de `desktop/devlog.json` resolu depuis `__dirname`.

- [ ] **Etape 1 : ecrire le test qui echoue**

Creer `test/devlog.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { lireDevlog, CHEMIN } = require('../desktop/devlog');

// Le devlog est du confort. Ces tests portent tous la meme exigence: aucune
// entree du module ne doit lever, quoi qu'on lui donne. Une exception ici
// remonterait par le canal IPC jusqu'a la fenetre, pour du texte decoratif.

function fichierTemporaire(contenu) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'devlog-'));
  const chemin = path.join(dossier, 'devlog.json');
  fs.writeFileSync(chemin, contenu);
  return chemin;
}

test('un fichier valide rend ses entrees', () => {
  const chemin = fichierTemporaire(JSON.stringify([
    { version: '0.2.5', le: '2026-08-27', notes: ['deux'] },
    { version: '0.2.4', le: '2026-08-26', notes: ['un', 'et demi'] },
  ]));
  const entrees = lireDevlog(chemin);
  assert.strictEqual(entrees.length, 2);
  assert.strictEqual(entrees[0].version, '0.2.5');
  assert.deepStrictEqual(entrees[1].notes, ['un', 'et demi']);
});

test('les entrees sortent en ordre decroissant, quel que soit l ordre du fichier', () => {
  const chemin = fichierTemporaire(JSON.stringify([
    { version: '0.2.4', notes: ['a'] },
    { version: '0.10.0', notes: ['b'] },
    { version: '0.9.1', notes: ['c'] },
  ]));
  // 0.10.0 > 0.9.1: la comparaison est numerique, pas alphabetique. Une
  // comparaison de chaines mettrait 0.10.0 AVANT 0.9.1 dans le mauvais sens.
  assert.deepStrictEqual(
    lireDevlog(chemin).map((e) => e.version),
    ['0.10.0', '0.9.1', '0.2.4'],
  );
});

test('un fichier absent rend un tableau vide sans lever', () => {
  assert.deepStrictEqual(lireDevlog(path.join(os.tmpdir(), 'devlog-inexistant-xyz.json')), []);
});

test('un JSON invalide rend un tableau vide sans lever', () => {
  assert.deepStrictEqual(lireDevlog(fichierTemporaire('{ pas du json')), []);
});

test('un JSON valide qui n est pas un tableau rend un tableau vide', () => {
  assert.deepStrictEqual(lireDevlog(fichierTemporaire('{"version":"0.2.5"}')), []);
});

test('une entree sans notes utilisables est ecartee, les autres restent', () => {
  const chemin = fichierTemporaire(JSON.stringify([
    { version: '0.2.5', notes: ['bonne'] },
    { version: '0.2.4' },
    { version: '0.2.3', notes: 'pas un tableau' },
    { version: '0.2.2', notes: [42] },
    { version: '0.2.1', notes: [] },
  ]));
  assert.deepStrictEqual(lireDevlog(chemin).map((e) => e.version), ['0.2.5']);
});

test('une entree sans version, ou de format invalide, est ecartee', () => {
  const chemin = fichierTemporaire(JSON.stringify([
    { notes: ['sans version'] },
    { version: 'dev', notes: ['pas x.y.z'] },
    { version: ['0.2.5'], notes: ['version en tableau'] },
    { version: '0.2.5', notes: ['bonne'] },
  ]));
  assert.deepStrictEqual(lireDevlog(chemin).map((e) => e.version), ['0.2.5']);
});

test('null et une entree nulle ne font pas lever', () => {
  assert.deepStrictEqual(lireDevlog(fichierTemporaire('null')), []);
  assert.deepStrictEqual(lireDevlog(fichierTemporaire('[null, 3, "x"]')), []);
});

test('CHEMIN pointe dans desktop/', () => {
  assert.strictEqual(path.basename(CHEMIN), 'devlog.json');
  assert.strictEqual(path.basename(path.dirname(CHEMIN)), 'desktop');
});
```

- [ ] **Etape 2 : lancer le test pour le voir echouer**

Executer : `node --test test/devlog.test.js`
Attendu : ECHEC, `Cannot find module '../desktop/devlog'`.

- [ ] **Etape 3 : ecrire le module minimal**

Creer `desktop/devlog.js` :

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// LES NOTES DE VERSION, LUES DEPUIS LE FICHIER EMBARQUE DANS L'ARCHIVE.
//
// Ce module est du confort: il ne doit JAMAIS empecher OMNI de tourner. Toute
// anomalie (fichier absent, JSON casse, entree mal formee) se solde par moins
// de notes affichees, jamais par une exception. Le devlog est le seul endroit
// de l'application dont la panne doit rester invisible.

const FORMAT_VERSION = /^\d+\.\d+\.\d+$/;

function entreeValide(e) {
  return !!e && typeof e === 'object' && !Array.isArray(e)
    && typeof e.version === 'string' && FORMAT_VERSION.test(e.version)
    && Array.isArray(e.notes) && e.notes.length > 0
    && e.notes.every((n) => typeof n === 'string' && n.length > 0);
}

// Comparaison NUMERIQUE, segment par segment. Comparer les chaines mettrait
// 0.10.0 avant 0.9.1 — faux des que le numero du milieu passe a deux chiffres.
function comparerDecroissant(a, b) {
  const ga = a.version.split('.').map(Number);
  const gb = b.version.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (ga[i] !== gb[i]) return gb[i] - ga[i];
  }
  return 0;
}

function lireDevlog(chemin) {
  let brut;
  try {
    brut = fs.readFileSync(chemin, 'utf8');
  } catch {
    return [];
  }
  let donnees;
  try {
    donnees = JSON.parse(brut);
  } catch {
    return [];
  }
  if (!Array.isArray(donnees)) return [];
  return donnees.filter(entreeValide).sort(comparerDecroissant);
}

// Resolu depuis __dirname: le code tourne depuis
// %APPDATA%\OMNI\versions\<v>\desktop\, pas depuis le dossier du paquet.
const CHEMIN = path.join(__dirname, 'devlog.json');

module.exports = { lireDevlog, CHEMIN };
```

- [ ] **Etape 4 : lancer le test pour le voir passer**

Executer : `node --test test/devlog.test.js`
Attendu : SUCCES, 9 tests passent.

- [ ] **Etape 5 : commiter**

```bash
git add desktop/devlog.js test/devlog.test.js
git commit -m "feat(devlog): module de lecture des notes de version"
```

---

### Tache 2 : le fichier `desktop/devlog.json` et son historique

**Fichiers :**
- Creer : `desktop/devlog.json`
- Modifier : `test/devlog.test.js` (ajouter le test du fichier reel a la fin)

**Interfaces :**
- Consomme : `lireDevlog`, `CHEMIN` de la tache 1.
- Produit : `desktop/devlog.json`, lu par la tache 3.

- [ ] **Etape 1 : ecrire le test qui echoue**

Ajouter a la fin de `test/devlog.test.js` :

```js
// CE TEST-CI EST LE PLUS UTILE DES NEUF. Les autres portent sur des fichiers
// fabriques; celui-ci lit le fichier REEL qui part chez les amis. Une virgule
// en trop dans devlog.json rendrait le panneau vide chez tout le monde, sans
// un message, et rien d'autre ne l'attraperait.
test('le devlog reel du depot se lit et n est pas vide', () => {
  const entrees = lireDevlog(CHEMIN);
  assert.ok(entrees.length >= 4, `devlog.json rend ${entrees.length} entrees`);
  const versions = entrees.map((e) => e.version);
  for (const attendue of ['0.2.1', '0.2.2', '0.2.3', '0.2.4']) {
    assert.ok(versions.includes(attendue), `${attendue} manque au devlog`);
  }
});

test('chaque entree du devlog reel porte une date au format AAAA-MM-JJ', () => {
  for (const e of lireDevlog(CHEMIN)) {
    assert.match(e.le, /^\d{4}-\d{2}-\d{2}$/, `date invalide sur ${e.version}`);
  }
});
```

- [ ] **Etape 2 : lancer le test pour le voir echouer**

Executer : `node --test test/devlog.test.js`
Attendu : ECHEC, `devlog.json rend 0 entrees` (le fichier n'existe pas encore, `lireDevlog` rend `[]`).

- [ ] **Etape 3 : verifier l'historique avant d'ecrire quoi que ce soit**

Les commits de publication de chaque version sont connus. Les relire pour ne rien affirmer de faux :

```bash
git log --oneline --no-merges bfe3e71..ae7e066   # 0.2.1
git log --oneline --no-merges ae7e066..df6a158   # 0.2.2
git log --oneline --no-merges df6a158..979bc01   # 0.2.3
git log --oneline --no-merges 979bc01..6f5bf0c   # 0.2.4 (23 commits)
```

Si une note ci-dessous ne correspond a aucun commit de sa plage, **la retirer** plutot que la garder. Mieux vaut une entree courte qu'une entree fausse.

- [ ] **Etape 4 : ecrire le fichier**

Creer `desktop/devlog.json`. Contenu, derive des commits ci-dessus (`ae7e066` journal reduit ; `c302926` l'amorceur survit a la fermeture de l'ecran de cle ; `05b806a` le code versionne retrouve ses dependances ; `9cea842` renommage OMNI ; `a5aeb58` refonte du panneau ; `85bb78f` noms a tirets ; remontee d'etat de la version 0.2.4) :

```json
[
  {
    "version": "0.2.4",
    "le": "2026-08-26",
    "notes": [
      "Le launcher s'appelle OMNI.",
      "Panneau refait : raccourcis clavier par compte, bascule vers la fenêtre d'un compte.",
      "Les personnages dont le nom contient un tiret sont enfin reconnus.",
      "OMNI signale au service la version qu'il fait tourner, pour repérer ceux qui restent en arrière."
    ]
  },
  {
    "version": "0.2.3",
    "le": "2026-08-25",
    "notes": [
      "Une version installée par la mise à jour retrouve tout ce qu'il lui faut pour démarrer.",
      "Paquet allégé des outils de développement."
    ]
  },
  {
    "version": "0.2.2",
    "le": "2026-08-25",
    "notes": [
      "OMNI ne se ferme plus tout seul juste après la saisie de la clé."
    ]
  },
  {
    "version": "0.2.1",
    "le": "2026-08-24",
    "notes": [
      "Moins de traces écrites sur le disque."
    ]
  }
]
```

L'entree `0.2.5` n'est **pas** ecrite ici : elle appartient a la tache 5, qui publie.

- [ ] **Etape 5 : lancer les tests du devlog**

Executer : `node --test test/devlog.test.js`
Attendu : SUCCES, 11 tests passent.

- [ ] **Etape 6 : commiter**

```bash
git add desktop/devlog.json test/devlog.test.js
git commit -m "feat(devlog): historique des versions 0.2.1 a 0.2.4"
```

---

### Tache 3 : le canal IPC

**Fichiers :**
- Modifier : `desktop/main.js` (require en tete, puis un `ipcMain.handle` a la suite des autres, apres `fermerTousLesClients` vers la ligne 948)
- Modifier : `desktop/preload.js` (une entree dans `exposeInMainWorld`)

**Interfaces :**
- Consomme : `lireDevlog`, `CHEMIN` de la tache 1 ; `desktop/devlog.json` de la tache 2.
- Produit : `window.app.devlog()` → `Promise<Array<{version, le, notes}>>`, consomme par la tache 4.

**Attention :** `test/pont-ipc.test.js` echoue tant que la tache 4 n'a pas ajoute l'appel `window.app.devlog(` dans `index.html` (test « le preload n expose rien que l interface n utilise »). C'est attendu : les taches 3 et 4 se referment mutuellement. Ne pas « reparer » ce test en retirant la ligne du preload.

- [ ] **Etape 1 : ajouter le require en tete de `desktop/main.js`**

Apres la ligne 20, `const { findDofusProcesses } = require('../src/injector');` — la derniere du bloc de requires — ajouter :

```js
const { lireDevlog, CHEMIN: CHEMIN_DEVLOG } = require('./devlog');
```

- [ ] **Etape 2 : ajouter le gestionnaire dans `desktop/main.js`**

Juste apres le bloc `ipcMain.handle('fermerTousLesClients', ...)` (il se termine vers la ligne 957, avant `app.on('window-all-closed', ...)`), ajouter :

```js
// LU UNE SEULE FOIS, AU PREMIER CLIC. Le fichier est fige pour la duree de
// l'execution — il fait partie de la version installee. Le mettre dans le flux
// d'etat, qui repart vers la fenetre toutes les deux secondes, ferait relire un
// fichier a chaque tour pour du texte qui ne bouge jamais.
let devlogEnMemoire = null;
ipcMain.handle('devlog', () => {
  if (devlogEnMemoire === null) devlogEnMemoire = lireDevlog(CHEMIN_DEVLOG);
  return devlogEnMemoire;
});
```

- [ ] **Etape 3 : exposer le canal dans `desktop/preload.js`**

Avant la ligne `fermerUnClient: (idCompte) => ipcRenderer.invoke('fermerUnClient', idCompte),`, ajouter :

```js
  // Les notes de version, lues au premier clic sur le numero. Lecture seule,
  // sans parametre: c'est le seul canal qui rend des donnees plutot que
  // d'emettre un ordre.
  devlog: () => ipcRenderer.invoke('devlog'),
```

- [ ] **Etape 4 : verifier que le pont est coherent cote main**

Executer : `node --test test/pont-ipc.test.js`
Attendu : ECHEC sur un seul test — « le preload n expose rien que l interface n utilise », message `devlog est exposé sans être appelé`. Les trois autres tests du fichier passent. Cet echec disparait a la tache 4.

- [ ] **Etape 5 : commiter**

```bash
git add desktop/main.js desktop/preload.js
git commit -m "feat(devlog): canal IPC pour lire les notes de version"
```

---

### Tache 4 : le numero cliquable et le panneau « Quoi de neuf »

**Fichiers :**
- Modifier : `desktop/index.html` — CSS (a la suite de `.titre-etat`, vers la ligne 106), balisage (ligne 367), gestionnaire Echap (vers la ligne 465), remplissage de la barre d'etat (lignes 859-860), et un bloc de script pour le panneau.

**Interfaces :**
- Consomme : `window.app.devlog()` de la tache 3.
- Produit : rien pour les taches suivantes.

- [ ] **Etape 1 : ajouter le CSS**

Dans le `<style>`, juste apres la regle `.titre-etat { ... }` (elle se termine ligne 106), ajouter :

```css
  /* LE `no-drag` N'EST PAS DECORATIF. `.barre-titre` est `-webkit-app-region:
     drag` : sans cette ligne, Windows avale le clic comme un deplacement de
     fenetre et le bouton ne fait RIEN, sans le moindre message. Meme raison
     que sur `.fenetre-boutons` et `.maitre-inter`. */
  .version-lien {
    -webkit-app-region: no-drag;
    background: transparent; border: 0; padding: 0;
    font: inherit; color: inherit; letter-spacing: inherit;
    text-transform: inherit; cursor: pointer;
    border-bottom: 1px dotted var(--bord);
  }
  .version-lien:hover { color: var(--texte); border-bottom-color: var(--arme); }

  /* Un panneau DANS la fenetre, pas une fenetre modale: le depot s'y refuse
     deja (confirmation en place pour la fermeture d'un client). */
  .quoi-de-neuf {
    position: absolute; inset: 38px 0 0 0; z-index: 20;
    background: var(--fond); display: flex; flex-direction: column;
  }
  .qdn-tete {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 12px 12px 15px; border-bottom: 1px solid var(--filet);
  }
  .qdn-tete b { font-size: 13px; letter-spacing: .06em; text-transform: uppercase; }
  .qdn-tete button {
    margin-left: auto; width: 30px; height: 30px;
    background: transparent; border: 0; color: var(--attenue);
    font-size: 15px; cursor: pointer;
  }
  .qdn-tete button:hover { color: var(--texte); }
  .qdn-corps { overflow-y: auto; padding: 6px 15px 18px; }
  .qdn-version { padding: 12px 0; border-bottom: 1px solid var(--filet); }
  .qdn-version:last-child { border-bottom: 0; }
  .qdn-titre { display: flex; align-items: baseline; gap: 8px; }
  .qdn-titre b { font-size: 14px; }
  .qdn-titre .date { font-size: 11px; color: var(--attenue); }
  .qdn-titre .ici {
    font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
    color: var(--arme-encre); background: var(--arme);
    padding: 2px 6px; border-radius: 999px; font-weight: 700;
  }
  .qdn-version ul { margin: 7px 0 0; padding-left: 18px; }
  .qdn-version li { font-size: 13px; line-height: 1.5; margin-bottom: 3px; color: var(--texte); }
  .qdn-vide { padding: 30px 0; text-align: center; color: var(--attenue); font-size: 13.5px; }
```

- [ ] **Etape 2 : changer le balisage de la barre de titre**

Remplacer la ligne 367 :

```html
  <span class="titre-etat" id="titreEtat"></span>
```

par :

```html
  <span class="titre-etat"><button class="version-lien" id="versionBouton" title="Voir ce qui a changé"></button><span id="titreEtat"></span></span>
```

Puis, juste avant `<div class="barre-nav">` (vers la ligne 397), ajouter le panneau :

```html
<div class="quoi-de-neuf" id="quoiDeNeuf" hidden>
  <div class="qdn-tete">
    <b>Quoi de neuf</b>
    <button id="qdnFermer" title="Fermer (Échap)">✕</button>
  </div>
  <div class="qdn-corps" id="qdnCorps"></div>
</div>
```

- [ ] **Etape 3 : couper le texte de la barre d'etat en deux**

Remplacer les lignes 859-860 :

```js
    document.getElementById('titreEtat').textContent =
      (etat.version || 'dev') + ' · ' + enJeu + ' compte' + (enJeu > 1 ? 's' : '') + ' en jeu';
```

par :

```js
    // Le numero est un bouton a part: il ouvre le devlog. Le reste du texte
    // suit dans son propre span, sinon le rafraichissement de l'etat
    // ecraserait le bouton toutes les deux secondes.
    versionCourante = etat.version || 'dev';
    document.getElementById('versionBouton').textContent = versionCourante;
    document.getElementById('titreEtat').textContent =
      ' · ' + enJeu + ' compte' + (enJeu > 1 ? 's' : '') + ' en jeu';
```

- [ ] **Etape 4 : ecrire le panneau**

Ajouter ce bloc dans le script, apres la fonction `libelleTouche` (vers la ligne 455) — il doit etre dans la meme portee que le gestionnaire `keydown` modifie a l'etape 5 :

```js
  // ---------------- le devlog ----------------
  // Charge au PREMIER clic seulement, puis garde. Le fichier fait partie de la
  // version installee: il ne change pas tant qu'OMNI tourne.
  let versionCourante = 'dev';
  let devlogCharge = null;

  function fermerQuoiDeNeuf() {
    document.getElementById('quoiDeNeuf').hidden = true;
  }

  function rendreDevlog(entrees) {
    const corps = document.getElementById('qdnCorps');
    corps.textContent = '';
    if (!entrees.length) {
      const vide = document.createElement('div');
      vide.className = 'qdn-vide';
      vide.textContent = 'Pas de notes pour cette version.';
      corps.append(vide);
      return;
    }
    for (const e of entrees) {
      const bloc = document.createElement('div');
      bloc.className = 'qdn-version';
      const titre = document.createElement('div');
      titre.className = 'qdn-titre';
      const num = document.createElement('b');
      num.textContent = e.version;
      titre.append(num);
      if (e.le) {
        const date = document.createElement('span');
        date.className = 'date';
        date.textContent = e.le;
        titre.append(date);
      }
      if (e.version === versionCourante) {
        const ici = document.createElement('span');
        ici.className = 'ici';
        ici.textContent = 'la tienne';
        titre.append(ici);
      }
      bloc.append(titre);
      const ul = document.createElement('ul');
      for (const n of e.notes) {
        const li = document.createElement('li');
        // textContent, jamais innerHTML: les notes sont du texte, et ce
        // fichier arrive par le reseau au meme titre que le reste du code.
        li.textContent = n;
        ul.append(li);
      }
      bloc.append(ul);
      corps.append(bloc);
    }
  }

  async function ouvrirQuoiDeNeuf() {
    if (devlogCharge === null) {
      try {
        devlogCharge = await window.app.devlog();
      } catch {
        devlogCharge = [];   // le devlog ne casse jamais la fenetre
      }
    }
    rendreDevlog(devlogCharge);
    document.getElementById('quoiDeNeuf').hidden = false;
  }

  document.getElementById('versionBouton').onclick = ouvrirQuoiDeNeuf;
  document.getElementById('qdnFermer').onclick = fermerQuoiDeNeuf;
```

- [ ] **Etape 5 : brancher Echap**

Dans le gestionnaire `window.addEventListener('keydown', ...)` (vers la ligne 465), ajouter une ligne **avant** `if (ecoute === null) return;` :

```js
  window.addEventListener('keydown', (e) => {
    // Echap ferme le devlog — mais seulement si aucune saisie de touche n'est
    // en cours: pendant une saisie, Echap doit garder son sens d'annulation.
    if (e.key === 'Escape' && ecoute === null && !document.getElementById('quoiDeNeuf').hidden) {
      fermerQuoiDeNeuf();
      return;
    }
    if (ecoute === null) return;
```

Le reste du gestionnaire ne change pas.

- [ ] **Etape 6 : verifier le pont, maintenant complet**

Executer : `node --test test/pont-ipc.test.js`
Attendu : SUCCES, 4 tests. L'echec de la tache 3 a disparu : `devlog` est appele par `index.html`, expose par `preload.js`, ecoute par `main.js`.

- [ ] **Etape 7 : lancer la suite complete**

Executer : `npm test`
Attendu : SUCCES. **612 tests** (601 avant + 11 du devlog).

- [ ] **Etape 8 : verifier EN LANCANT l'application**

Deux fois dans ce projet, un defaut n'est apparu qu'au lancement, invisible dans le code et dans les tests. Le `-webkit-app-region: drag` est exactement ce genre de piege : les tests ne peuvent pas l'attraper.

```powershell
Get-Process OMNI -ErrorAction SilentlyContinue   # doit etre vide
```

Lancer `F:\omni_project\desktop\dist\OMNI-win32-x64\OMNI.exe` — **pas** `npm run app` (Smart App Control refuse `electron.exe` non signe).

Attention : l'executable du paquet charge la version **installee** dans `%APPDATA%\OMNI\versions\<v>\`, pas le code du depot. Pour voir les modifications, copier `desktop/index.html`, `desktop/main.js`, `desktop/preload.js` et `desktop/devlog.js` (+ `desktop/devlog.json`) dans le dossier de la version courante, ou passer par la tache 5.

**Pas de capture d'ecran du bureau.** Demander a l'utilisateur ce qu'il voit :
1. le numero de version est-il souligne en pointille en bas ?
2. le clic ouvre-t-il le panneau (c'est le test du `no-drag`) ?
3. la version en cours porte-t-elle la pastille « la tienne » ?
4. Echap ferme-t-il le panneau ?

- [ ] **Etape 9 : commiter**

```bash
git add desktop/index.html
git commit -m "feat(devlog): numero de version cliquable et panneau Quoi de neuf"
```

---

### Tache 5 : publier la version 0.2.5

**Fichiers :**
- Modifier : `package.json` (champ `version`)
- Modifier : `package-lock.json` (deux champs `version`)
- Modifier : `desktop/devlog.json` (entree `0.2.5` en tete)

**Interfaces :**
- Consomme : tout ce qui precede.
- Produit : l'archive `desktop/dist/code-0.2.5.tar.gz` et son sha256, a publier depuis le panneau.

**Cette tache demande des actions de l'utilisateur** (mot de passe admin, panneau web). Ne pas tenter de les faire a sa place.

- [ ] **Etape 1 : ecrire l'entree 0.2.5 dans `desktop/devlog.json`**

L'ajouter **en tete** du tableau :

```json
  {
    "version": "0.2.5",
    "le": "2026-08-27",
    "notes": [
      "Le numéro de version en bas de la fenêtre est cliquable : il ouvre ces notes.",
      "Tu peux désormais voir ce que chaque mise à jour a changé."
    ]
  },
```

- [ ] **Etape 2 : passer les versions a 0.2.5**

```bash
npm version 0.2.5 --no-git-tag-version
```

Verifier : `package.json` et `package-lock.json` portent `0.2.5`.

- [ ] **Etape 3 : lancer la suite complete**

Executer : `npm test`
Attendu : SUCCES, 612 tests. Le test « le devlog reel du depot se lit » couvre la nouvelle entree.

- [ ] **Etape 4 : commiter**

```bash
git add package.json package-lock.json desktop/devlog.json
git commit -m "chore: publier la version 0.2.5"
```

- [ ] **Etape 5 : fabriquer l'archive de code**

OMNI doit etre arrete (`Get-Process OMNI` vide), sinon la fabrication echoue en EBUSY.

```powershell
$env:ELECTRON_RUN_AS_NODE = 1
.\desktop\dist\OMNI-win32-x64\OMNI.exe outils\faire-etape.js
```

Attendu : `desktop/dist/code-0.2.5.tar.gz` ecrit, avec son nombre de fichiers et son sha256 affiches. **Noter le sha256.**

Verifier que le devlog est bien dedans — sans lui, la fonctionnalite part a moitie :

```bash
tar -tzf desktop/dist/code-0.2.5.tar.gz | grep devlog
```

Attendu : `desktop/devlog.js` **et** `desktop/devlog.json`.

- [ ] **Etape 6 : publier depuis le panneau (utilisateur)**

Le mot de passe admin est tape par l'utilisateur ; `DATABASE_URL` est *Sensitive* et inaccessible en local. Lui demander de :
1. ouvrir <https://paquets-maj.vercel.app/api/admin> et se connecter ;
2. choisir `desktop/dist/code-0.2.5.tar.gz` ;
3. **triple-cliquer** le champ version avant de taper — il se pre-remplit depuis le nom du fichier, et taper dedans ajoute a la suite (piege deja paye : `0.2.40.2.4`) ;
4. televerser, puis activer `0.2.5`.

- [ ] **Etape 7 : verifier la publication**

Demander a l'utilisateur d'ouvrir le panneau et de confirmer que `0.2.5` est la version active, puis relancer OMNI et lire le journal :

```bash
tail -n 5 "$APPDATA/OMNI/amorceur.log"
cat "$APPDATA/OMNI/versions/courante.json"
```

Attendu : `version 0.2.5 installee`, puis `chargement de la version 0.2.5`, et `courante.json` a `"version": "0.2.5"`. Le code ne journalise que les echecs : l'absence de ligne d'echec vaut succes.

Puis demander a l'utilisateur de cliquer sur `0.2.5` en bas de la fenetre et de decrire ce qu'il voit. **C'est la seule preuve qui compte** : la chaine complete, depuis un paquet non modifie a la main.

- [ ] **Etape 8 : pousser la branche**

```bash
git push -u origin feat/devlog
```

Ne pas fusionner dans `master` sans l'accord de l'utilisateur : la skill superpowers:finishing-a-development-branch couvre cette decision.

---

## Ce qui n'est PAS dans ce plan

- Aucune saisie des notes depuis le panneau admin (ecarte dans le spec).
- Aucune notification « nouvelle version » : le devlog se consulte, il ne s'impose pas.
- Aucun changement cote `serveur-maj/` : ce plan ne touche pas au service.
- Pas de refabrication du paquet de 480 Mo : le devlog voyage dans l'archive de code.
