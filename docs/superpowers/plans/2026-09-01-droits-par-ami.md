# Droits par ami et par fonction — plan de mise en œuvre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** donner à Draxus un interrupteur par ami et par fonction dans le panneau d'administration ; le code est livré à tout le monde, mais une fonction non accordée n'est pas branchée chez l'ami.

**Architecture :** une table `droits` côté serveur (une ligne = un droit accordé), une route `GET /api/droits` calquée sur `/api/manifeste`, et côté application une veille qui redemande la liste toutes les 60 s. Les politiques qui écoutent le trafic passent par une porte qui lit les droits du moment ; l'overlay et l'HDV, déclenchés par un bouton, sont grisés et non branchés.

**Tech Stack :** Node.js CommonJS, `node:test` + `node:assert`, Neon (postgres) côté serveur, Electron côté application. Aucune dépendance nouvelle.

**Spec :** `docs/superpowers/specs/2026-09-01-droits-par-ami-design.md`

## Global Constraints

- **Aucun fichier neuf dans `desktop/`.** Un fichier neuf y exige une entrée à la main dans la liste blanche `FICHIERS_DESKTOP` de `outils/faire-etape.js`, sinon il manque dans l'archive publiée et le panneau arrive vide chez tout le monde. Tous les fichiers neufs vont dans `src/` (copié en entier) ou dans `serveur-maj/`.
- **Ne jamais toucher à `amorceur/`.** L'archive de mise à jour ne contient que `desktop/`, `src/` et `package.json` : ce qui vit dans l'amorceur ne se corrige plus par une mise à jour.
- **`serveur-maj/` est déployé séparément** (`npx vercel --prod` depuis ce dossier). Son code **ne peut pas** faire `require('../../src/...')`. D'où la copie de la liste, gardée par un test — voir tâche 1.
- **Fermé par défaut** : pas de ligne en base = pas le droit ; fichier de cache absent ou cassé = aucun droit.
- **`injoignable` et `404` ne se confondent jamais.** Réseau coupé → on ne change rien. 404 → tout tombe.
- Style du dépôt : `'use strict';` en tête, fabriques `creerX({ ... })` à dépendances injectées, commentaires en français qui disent **pourquoi**.
- `npm test` doit rester vert à chaque commit (830 tests au départ).

---

### Task 1: La liste des fonctions, à un seul endroit

**Files:**
- Create: `src/droits/liste.js`
- Create: `serveur-maj/lib/fonctions.js`
- Test: `test/droits-liste.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: `FONCTIONS` (tableau de `{ nom, libelle }`), `NOMS` (tableau de chaînes), `estConnue(nom) -> boolean`. Les deux fichiers exportent **exactement** la même chose.

Le serveur et l'application ne peuvent pas partager un fichier : `serveur-maj/` se déploie seul. Deux copies, donc — et un test qui échoue à la seconde où elles divergent. C'est le même piège que les deux listes blanches de fabrication du paquet, qui a coûté une archive vide publiée.

- [ ] **Step 1: Write the failing test**

```js
// test/droits-liste.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { FONCTIONS, NOMS, estConnue } = require('../src/droits/liste');
const copieServeur = require('../serveur-maj/lib/fonctions');

test('les sept fonctions verrouillables, et elles seules', () => {
  assert.deepStrictEqual(NOMS, [
    'abandon', 'passe-tour', 'invitation', 'echange', 'songe', 'overlay', 'hdv',
  ]);
});

test('le replicate et le garde-combat ne sont pas verrouillables', () => {
  // Le premier est l outil lui-meme, le second est une protection: la couper
  // ferait ouvrir un combat a chaque mule (degat mesure le 28/08).
  assert.strictEqual(estConnue('replicate'), false);
  assert.strictEqual(estConnue('duplication'), false);
  assert.strictEqual(estConnue('garde-combat'), false);
});

test('chaque fonction porte un libelle non vide', () => {
  for (const f of FONCTIONS) {
    assert.strictEqual(typeof f.libelle, 'string');
    assert.ok(f.libelle.length > 0, `libelle vide pour ${f.nom}`);
  }
});

test('aucun nom en double', () => {
  assert.strictEqual(new Set(NOMS).size, NOMS.length);
});

test('LA COPIE DU SERVEUR EST IDENTIQUE', () => {
  // serveur-maj se deploie seul et ne peut pas require ../../src. La copie est
  // donc inevitable; ce test est ce qui l empeche de deriver en silence.
  assert.deepStrictEqual(copieServeur.FONCTIONS, FONCTIONS);
  assert.deepStrictEqual(copieServeur.NOMS, NOMS);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/droits-liste.test.js`
Expected: FAIL, « Cannot find module '../src/droits/liste' »

- [ ] **Step 3: Write the implementation**

```js
// src/droits/liste.js
'use strict';

// LES FONCTIONS VERROUILLABLES, ET ELLES SEULES.
//
// Un seul endroit cote application. Le panneau d administration lit la meme
// liste, servie par sa propre copie (serveur-maj/lib/fonctions.js): deux
// listes qui derivent, c est le panneau qui coche une fonction que l app ne
// connait pas. Un test compare les deux.
//
// Le replicate (duplication) et le garde-combat n y sont pas: le premier est
// l outil lui-meme -- une cle sans lui ne sert a rien -- le second est une
// protection, et la couper ferait ouvrir un combat a chaque mule.
const FONCTIONS = [
  { nom: 'abandon', libelle: 'abandon de combat groupe' },
  { nom: 'passe-tour', libelle: 'passe-tour' },
  { nom: 'invitation', libelle: 'acceptation d invitation de groupe' },
  { nom: 'echange', libelle: 'acceptation d echange' },
  { nom: 'songe', libelle: 'acceptation d invitation a un songe' },
  { nom: 'overlay', libelle: 'barre flottante' },
  { nom: 'hdv', libelle: 'mise a jour des prix en hotel de vente' },
];

const NOMS = FONCTIONS.map((f) => f.nom);

function estConnue(nom) {
  return NOMS.includes(nom);
}

module.exports = { FONCTIONS, NOMS, estConnue };
```

Puis `serveur-maj/lib/fonctions.js` : **le même fichier, mot pour mot**, avec un en-tête qui dit d'où il vient.

```js
// serveur-maj/lib/fonctions.js
'use strict';

// COPIE DE src/droits/liste.js. Ne pas modifier ici sans modifier la-bas:
// serveur-maj se deploie seul (npx vercel --prod depuis ce dossier) et ne
// peut pas require un fichier hors de son arborescence.
// test/droits-liste.test.js compare les deux et echoue si elles divergent.
const FONCTIONS = [
  { nom: 'abandon', libelle: 'abandon de combat groupe' },
  { nom: 'passe-tour', libelle: 'passe-tour' },
  { nom: 'invitation', libelle: 'acceptation d invitation de groupe' },
  { nom: 'echange', libelle: 'acceptation d echange' },
  { nom: 'songe', libelle: 'acceptation d invitation a un songe' },
  { nom: 'overlay', libelle: 'barre flottante' },
  { nom: 'hdv', libelle: 'mise a jour des prix en hotel de vente' },
];

const NOMS = FONCTIONS.map((f) => f.nom);

function estConnue(nom) {
  return NOMS.includes(nom);
}

module.exports = { FONCTIONS, NOMS, estConnue };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/droits-liste.test.js` puis `npm test`
Expected: PASS, et le total passe de 830 à 835.

- [ ] **Step 5: Commit**

```bash
git add src/droits/liste.js serveur-maj/lib/fonctions.js test/droits-liste.test.js
git commit -m "feat(droits): la liste des fonctions verrouillables, et sa copie serveur"
```

---

### Task 2: La table, la lecture, la route

**Files:**
- Modify: `serveur-maj/lib/db.js` (fonction `ecrireSchema`, après la table `lancements`)
- Create: `serveur-maj/lib/droits.js`
- Create: `serveur-maj/api/droits.js`
- Test: `serveur-maj/test/api-droits.test.js`

**Interfaces:**
- Consumes: `verifierCle(sql, cle) -> { ok, nom }` de `lib/amis.js`.
- Produces: `droitsDe(sql, cle) -> string[]`, `listerDroits(sql) -> [{cle, fonction}]`, `accorder(sql, cle, fonction)`, `retirer(sql, cle, fonction)`, et `traiterDroits({ cle, sql }) -> { statut, corps }`.

- [ ] **Step 1: Write the failing test**

```js
// serveur-maj/test/api-droits.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { traiterDroits } = require('../api/droits');

function fauxSql(reponses) {
  return () => Promise.resolve(reponses.length ? reponses.shift() : []);
}

test('sans cle, 404', async () => {
  const r = await traiterDroits({ cle: undefined, sql: fauxSql([]) });
  assert.strictEqual(r.statut, 404);
});

test('cle inconnue, 404 et aucun droit divulgue', async () => {
  const r = await traiterDroits({ cle: 'zzz', sql: fauxSql([[]]) });
  assert.strictEqual(r.statut, 404);
  assert.strictEqual(r.corps, null);
});

test('cle valide, 200 et la liste des fonctions accordees', async () => {
  // 1er SELECT: verifierCle rend le nom. 2e: UPDATE derniere_vue. 3e: les droits.
  const sql = fauxSql([[{ nom: 'Ilan' }], [], [{ fonction: 'songe' }, { fonction: 'hdv' }]]);
  const r = await traiterDroits({ cle: 'ok', sql });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, { droits: ['songe', 'hdv'] });
});

test('cle valide sans aucun droit, 200 et une liste vide', async () => {
  // FERME PAR DEFAUT: un ami neuf n a rien, et ce n est pas une erreur.
  const sql = fauxSql([[{ nom: 'Neuf' }], [], []]);
  const r = await traiterDroits({ cle: 'ok', sql });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, { droits: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test serveur-maj/test/api-droits.test.js`
Expected: FAIL, « Cannot find module '../api/droits' »

- [ ] **Step 3: Write the implementation**

Dans `serveur-maj/lib/db.js`, à la fin de `ecrireSchema`, **avant** le `INSERT INTO config` final :

```js
  // Les droits accordes, une ligne par (ami, fonction). Pas de colonne actif:
  // accorder c est inserer, retirer c est supprimer. Un booleen en plus
  // offrirait deux facons de dire non, et une ligne actif=false serait un
  // droit qui n en est pas un.
  await sql`CREATE TABLE IF NOT EXISTS droits (
    cle      TEXT NOT NULL,
    fonction TEXT NOT NULL,
    PRIMARY KEY (cle, fonction)
  )`;
```

```js
// serveur-maj/lib/droits.js
'use strict';

// Toutes les requetes passent par l interpolation tag de Neon: les valeurs
// sont parametrees, jamais concatenees.

async function droitsDe(sql, cle) {
  const lignes = await sql`SELECT fonction FROM droits WHERE cle = ${cle}`;
  return lignes.map((l) => l.fonction);
}

async function listerDroits(sql) {
  return sql`SELECT cle, fonction FROM droits ORDER BY cle, fonction`;
}

async function accorder(sql, cle, fonction) {
  // ON CONFLICT DO NOTHING: cocher deux fois n est pas une erreur.
  await sql`INSERT INTO droits (cle, fonction) VALUES (${cle}, ${fonction})
            ON CONFLICT (cle, fonction) DO NOTHING`;
  return { ok: true };
}

async function retirer(sql, cle, fonction) {
  await sql`DELETE FROM droits WHERE cle = ${cle} AND fonction = ${fonction}`;
  return { ok: true };
}

module.exports = { droitsDe, listerDroits, accorder, retirer };
```

```js
// serveur-maj/api/droits.js
'use strict';
const { creerClient, appliquerSchema } = require('../lib/db');
const { verifierCle } = require('../lib/amis');
const { droitsDe } = require('../lib/droits');

// Logique pure, sans HTTP: c est elle qu on teste.
async function traiterDroits({ cle, sql }) {
  if (!cle) return { statut: 404, corps: null };
  // verifierCle AVANT toute lecture: une cle revoquee ne doit rien apprendre.
  const v = await verifierCle(sql, cle);
  if (!v.ok) return { statut: 404, corps: null };
  return { statut: 200, corps: { droits: await droitsDe(sql, cle) } };
}

module.exports = async (req, res) => {
  try {
    const sql = creerClient();
    await appliquerSchema(sql);
    const cle = req.headers['x-cle'];
    const { statut, corps } = await traiterDroits({ cle, sql });
    res.statusCode = statut;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(corps === null ? '' : JSON.stringify(corps));
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end('');
  }
};
module.exports.traiterDroits = traiterDroits;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test serveur-maj/test/api-droits.test.js` puis `npm test`
Expected: PASS, 4 tests de plus.

- [ ] **Step 5: Commit**

```bash
git add serveur-maj/lib/db.js serveur-maj/lib/droits.js serveur-maj/api/droits.js serveur-maj/test/api-droits.test.js
git commit -m "feat(droits): la table, la lecture et la route /api/droits"
```

---

### Task 3: Les cases à cocher du panneau

**Files:**
- Modify: `serveur-maj/api/admin.js` (imports en tête, puis le `switch` de `traiterAdmin`)
- Modify: `serveur-maj/web/admin.html` (la boucle `for (const a of amis)`, vers la ligne 154)
- Test: `serveur-maj/test/api-admin.test.js` (ajouts)

**Interfaces:**
- Consumes: `listerDroits`, `accorder`, `retirer` (tâche 2) ; `FONCTIONS`, `estConnue` (`serveur-maj/lib/fonctions.js`, tâche 1).
- Produces: trois actions admin — `fonctions` (la liste à afficher), `droits` (toutes les lignes accordées), `droit` (`{ cle, fonction, actif }`).

- [ ] **Step 1: Write the failing test**

```js
// a ajouter dans serveur-maj/test/api-admin.test.js
const { FONCTIONS } = require('../lib/fonctions');

test('action fonctions: la liste a afficher', async () => {
  const r = await traiterAdmin({
    motDePasse: 'secret', action: 'fonctions', sql: fauxSql([]), motDePasseAttendu: 'secret',
  });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, FONCTIONS);
});

test('action droit: une fonction inconnue est refusee', async () => {
  // Sans cette garde, une faute de frappe au panneau ecrit une ligne que
  // l application ne lira jamais, et la case resterait cochee pour rien.
  const r = await traiterAdmin({
    motDePasse: 'secret', action: 'droit',
    corps: { cle: 'abc', fonction: 'replicate', actif: true },
    sql: fauxSql([]), motDePasseAttendu: 'secret',
  });
  assert.strictEqual(r.statut, 400);
});

test('action droit: sans cle, 400', async () => {
  const r = await traiterAdmin({
    motDePasse: 'secret', action: 'droit',
    corps: { fonction: 'hdv', actif: true },
    sql: fauxSql([]), motDePasseAttendu: 'secret',
  });
  assert.strictEqual(r.statut, 400);
});

test('action droit: accorder puis retirer', async () => {
  const requetes = [];
  const sql = (chaines, ...valeurs) => { requetes.push({ chaines, valeurs }); return Promise.resolve([]); };
  const ok = await traiterAdmin({
    motDePasse: 'secret', action: 'droit',
    corps: { cle: 'abc', fonction: 'hdv', actif: true },
    sql, motDePasseAttendu: 'secret',
  });
  assert.strictEqual(ok.statut, 200);
  assert.ok(requetes[0].chaines.join('').includes('INSERT INTO droits'));
  await traiterAdmin({
    motDePasse: 'secret', action: 'droit',
    corps: { cle: 'abc', fonction: 'hdv', actif: false },
    sql, motDePasseAttendu: 'secret',
  });
  assert.ok(requetes[1].chaines.join('').includes('DELETE FROM droits'));
});

test('sans le mot de passe, les droits ne se lisent pas', async () => {
  const r = await traiterAdmin({
    motDePasse: 'faux', action: 'droits', sql: fauxSql([]), motDePasseAttendu: 'secret',
  });
  assert.strictEqual(r.statut, 404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test serveur-maj/test/api-admin.test.js`
Expected: FAIL, « action inconnue » → statut 400 là où 200 est attendu.

- [ ] **Step 3: Write the implementation**

En tête de `serveur-maj/api/admin.js` :

```js
const { listerDroits, accorder, retirer } = require('../lib/droits');
const { FONCTIONS, estConnue } = require('../lib/fonctions');
```

Dans le `switch`, juste après `case 'basculer':` :

```js
    case 'fonctions':
      // La liste que le panneau dessine. Servie plutot que recopiee dans la
      // page: une seule source, et le panneau suit une fonction ajoutee sans
      // qu on touche au HTML.
      return { statut: 200, corps: FONCTIONS };
    case 'droits':
      return { statut: 200, corps: await listerDroits(sql) };
    case 'droit': {
      if (!corps.cle) return { statut: 400, corps: { erreur: 'cle requise' } };
      // Une fonction hors liste ecrirait une ligne que l application ne lit
      // jamais: la case resterait cochee sans rien accorder.
      if (!estConnue(corps.fonction)) return { statut: 400, corps: { erreur: 'fonction inconnue' } };
      if (corps.actif) await accorder(sql, corps.cle, corps.fonction);
      else await retirer(sql, corps.cle, corps.fonction);
      return { statut: 200, corps: { ok: true } };
    }
```

Dans `serveur-maj/web/admin.html`, dans `rafraichir()`, avant la boucle des amis :

```js
    const fonctions = await api('fonctions', {});
    const lignesDroits = await api('droits', {});
    const accordes = new Map();
    for (const d of lignesDroits) {
      if (!accordes.has(d.cle)) accordes.set(d.cle, new Set());
      accordes.get(d.cle).add(d.fonction);
    }
```

Puis, dans la boucle, après le bouton `activer/desactiver`, une seconde ligne de tableau qui porte les cases :

```js
      const trDroits = document.createElement('tr');
      const tdDroits = document.createElement('td');
      tdDroits.colSpan = 6;
      const siens = accordes.get(a.cle) || new Set();
      for (const f of fonctions) {
        const label = document.createElement('label');
        label.style.marginRight = '12px';
        const c = document.createElement('input');
        c.type = 'checkbox';
        c.checked = siens.has(f.nom);
        c.onchange = async () => {
          c.disabled = true;
          try { await api('droit', { cle: a.cle, fonction: f.nom, actif: c.checked }); }
          finally { c.disabled = false; }
        };
        label.append(c, document.createTextNode(' ' + f.libelle));
        tdDroits.append(label);
      }
      const tout = document.createElement('button');
      tout.textContent = 'tout cocher';
      tout.onclick = async () => {
        // La cle de Draxus doit tout avoir sans sept clics.
        for (const f of fonctions) await api('droit', { cle: a.cle, fonction: f.nom, actif: true });
        rafraichir();
      };
      tdDroits.append(tout);
      trDroits.append(tdDroits);
      t.append(trDroits);
```

**Ne pas appeler `rafraichir()` sur une case cochée** : le tableau se redessinerait sous le doigt à chaque clic. La case porte déjà son propre état ; seul « tout cocher » redessine.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test serveur-maj/test/api-admin.test.js` puis `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add serveur-maj/api/admin.js serveur-maj/web/admin.html serveur-maj/test/api-admin.test.js
git commit -m "feat(droits): les cases a cocher par ami dans le panneau"
```

---

### Task 4: La veille

**Files:**
- Create: `src/droits/veille.js`
- Test: `test/droits-veille.test.js`

**Interfaces:**
- Consumes: `NOMS` de `src/droits/liste.js`.
- Produces: `creerVeille({ base, lireCle, cache, chercher, planifier, arreterMinuteur, onChangement, periodeMs }) -> { droits(), demarrer(), arreter() }`. `droits()` rend un tableau de noms, jamais `null`. `cache` est `{ lire() -> string[]|null, ecrire(noms) }`. Aussi exporté : `creerCacheFichier(chemin)` et `PERIODE_MS`.

- [ ] **Step 1: Write the failing test**

```js
// test/droits-veille.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerVeille } = require('../src/droits/veille');
const { NOMS } = require('../src/droits/liste');

function fauxCache(depart = null) {
  let valeur = depart;
  return { lire: () => valeur, ecrire: (v) => { valeur = v; }, valeur: () => valeur };
}

// Un faux planifier qui retient le rappel au lieu de dormir.
function fauxTemps() {
  const rappels = [];
  return {
    planifier: (fn) => { rappels.push(fn); return rappels.length; },
    arreterMinuteur: () => {},
    tic: async () => { const fn = rappels.pop(); if (fn) await fn(); },
  };
}

function reponse(statut, corps) {
  return Promise.resolve({ status: statut, ok: statut === 200, json: async () => corps });
}

test('sans cle (mode developpement), tous les droits et aucune requete', async () => {
  let appels = 0;
  const v = creerVeille({
    base: 'https://x', lireCle: () => null, cache: fauxCache(),
    chercher: () => { appels += 1; return reponse(200, { droits: [] }); },
    ...fauxTemps(),
  });
  await v.demarrer();
  assert.deepStrictEqual(v.droits(), NOMS);
  assert.strictEqual(appels, 0, 'le depot ne doit jamais interroger le service');
});

test('au demarrage, le cache est applique avant toute reponse', async () => {
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(['songe']),
    chercher: () => new Promise(() => {}), // jamais resolue
    ...fauxTemps(),
  });
  v.demarrer();
  assert.deepStrictEqual(v.droits(), ['songe']);
});

test('sans cache, aucun droit: ferme par defaut', () => {
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => new Promise(() => {}), ...fauxTemps(),
  });
  v.demarrer();
  assert.deepStrictEqual(v.droits(), []);
});

test('une reponse 200 applique la liste et ecrit le cache', async () => {
  const cache = fauxCache(null);
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache,
    chercher: () => reponse(200, { droits: ['hdv', 'songe'] }), ...fauxTemps(),
  });
  await v.demarrer();
  assert.deepStrictEqual(v.droits(), ['hdv', 'songe']);
  assert.deepStrictEqual(cache.valeur(), ['hdv', 'songe']);
});

test('une fonction inconnue du serveur est ignoree', async () => {
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => reponse(200, { droits: ['hdv', 'teleportation'] }), ...fauxTemps(),
  });
  await v.demarrer();
  assert.deepStrictEqual(v.droits(), ['hdv']);
});

test('INJOIGNABLE NE RETIRE RIEN', async () => {
  // Le test qui compte. Confondre une coupure de reseau et une revocation
  // retirerait ses fonctions a tout le monde des que Vercel eternue.
  const t = fauxTemps();
  let tour = 0;
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => { tour += 1; return tour === 1 ? reponse(200, { droits: ['hdv'] }) : Promise.reject(new Error('ECONNRESET')); },
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
  });
  await v.demarrer();
  assert.deepStrictEqual(v.droits(), ['hdv']);
  await t.tic();
  assert.deepStrictEqual(v.droits(), ['hdv'], 'un incident reseau ne revoque personne');
});

test('un 404 fait tout tomber', async () => {
  const t = fauxTemps();
  let tour = 0;
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => { tour += 1; return tour === 1 ? reponse(200, { droits: ['hdv'] }) : reponse(404, null); },
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
  });
  await v.demarrer();
  await t.tic();
  assert.deepStrictEqual(v.droits(), []);
});

test('onChangement dit ce qui est gagne et ce qui est perdu', async () => {
  const t = fauxTemps();
  const vus = [];
  let tour = 0;
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => { tour += 1; return reponse(200, { droits: tour === 1 ? ['hdv', 'songe'] : ['songe'] }); },
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
    onChangement: (c) => vus.push(c),
  });
  await v.demarrer();
  await t.tic();
  assert.deepStrictEqual(vus[0].gagnes, ['hdv', 'songe']);
  assert.deepStrictEqual(vus[1].perdus, ['hdv']);
});

test('sans changement, onChangement ne dit rien', async () => {
  const t = fauxTemps();
  const vus = [];
  const v = creerVeille({
    base: 'https://x', lireCle: () => 'CLE', cache: fauxCache(null),
    chercher: () => reponse(200, { droits: ['hdv'] }),
    planifier: t.planifier, arreterMinuteur: t.arreterMinuteur,
    onChangement: (c) => vus.push(c),
  });
  await v.demarrer();
  await t.tic();
  assert.strictEqual(vus.length, 1, 'un seul evenement: le premier');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/droits-veille.test.js`
Expected: FAIL, « Cannot find module '../src/droits/veille' »

- [ ] **Step 3: Write the implementation**

```js
// src/droits/veille.js
'use strict';
const fs = require('node:fs');
const { NOMS } = require('./liste');

const PERIODE_MS = 60000;
const DELAI_MS = 5000;

// LE CACHE SUR DISQUE. C est ce qu on applique au demarrage, avant la premiere
// reponse. Sans lui, un lancement hors ligne enleverait tout.
//
// Un fichier absent ou casse vaut AUCUN DROIT, jamais une exception: le defaut
// ferme est le meme que cote serveur.
function creerCacheFichier(chemin) {
  return {
    lire() {
      try {
        const v = JSON.parse(fs.readFileSync(chemin, 'utf8'));
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
      } catch (e) {
        return null;
      }
    },
    ecrire(noms) {
      try { fs.writeFileSync(chemin, JSON.stringify(noms)); }
      catch (e) { /* un cache non ecrit se rattrape au prochain tour */ }
    },
  };
}

// TROIS ETATS, JAMAIS CONFONDUS -- meme vocabulaire que amorceur/canal.js:
//   200          la liste, on l applique
//   injoignable  incident reseau: ON NE CHANGE RIEN
//   404          cle revoquee: tout tombe
//
// Confondre les deux derniers ferait qu une coupure de connexion retirerait
// ses fonctions a tout le monde. C est l erreur que canal.js evite deja.
function creerVeille({
  base, lireCle, cache,
  chercher = globalThis.fetch, planifier = setTimeout, arreterMinuteur = clearTimeout,
  onChangement = () => {}, periodeMs = PERIODE_MS,
}) {
  let courants = [];
  let minuteur = null;
  let arrete = false;

  function appliquer(nouveaux) {
    // Une fonction que cette version ne connait pas est ignoree: le panneau
    // peut avoir de l avance sur le code installe chez l ami.
    const apres = nouveaux.filter((n) => NOMS.includes(n));
    const gagnes = apres.filter((n) => !courants.includes(n));
    const perdus = courants.filter((n) => !apres.includes(n));
    courants = apres;
    if (gagnes.length || perdus.length) onChangement({ gagnes, perdus, droits: apres });
  }

  async function interroger() {
    let r;
    try {
      r = await chercher(base + '/api/droits', {
        headers: { 'x-cle': lireCle() },
        signal: AbortSignal.timeout(DELAI_MS),
      });
    } catch (e) {
      return; // injoignable: on ne change rien, surtout pas les droits.
    }
    if (r.status === 404) { appliquer([]); cache.ecrire([]); return; }
    if (r.status !== 200) return; // 500 chez nous n est pas une revocation.
    let corps;
    try { corps = await r.json(); } catch (e) { return; }
    const liste = corps && Array.isArray(corps.droits) ? corps.droits : [];
    appliquer(liste);
    cache.ecrire(courants);
  }

  function reprogrammer() {
    if (arrete) return;
    minuteur = planifier(async () => { await interroger(); reprogrammer(); }, periodeMs);
  }

  return {
    droits() { return courants; },
    async demarrer() {
      // PAS DE CLE = MODE DEVELOPPEMENT. C est la machine de Draxus, lancee sur
      // le depot sans passer par l amorceur: tous les droits, aucune requete.
      // Une veille qui verrouillerait le depot rendrait le developpement
      // impossible.
      if (!lireCle()) { appliquer(NOMS); return; }
      const duCache = cache.lire();
      appliquer(Array.isArray(duCache) ? duCache : []);
      await interroger();
      reprogrammer();
    },
    arreter() { arrete = true; if (minuteur !== null) arreterMinuteur(minuteur); },
  };
}

module.exports = { creerVeille, creerCacheFichier, PERIODE_MS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/droits-veille.test.js` puis `npm test`
Expected: PASS, 9 tests de plus.

- [ ] **Step 5: Commit**

```bash
git add src/droits/veille.js test/droits-veille.test.js
git commit -m "feat(droits): la veille, avec cache disque et trois etats distincts"
```

---

### Task 5: La porte

**Files:**
- Create: `src/droits/porte.js`
- Test: `test/droits-porte.test.js`

**Interfaces:**
- Consumes: rien (la porte reçoit une fonction `droits()`).
- Produces: `creerPorte({ droits }) -> protege(nom, politique) -> onTrame(evenement)`.

- [ ] **Step 1: Write the failing test**

```js
// test/droits-porte.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerPorte } = require('../src/droits/porte');

test('avec le droit, la trame passe', () => {
  const vues = [];
  const protege = creerPorte({ droits: () => ['songe'] });
  protege('songe', (e) => vues.push(e))({ pid: 1 });
  assert.strictEqual(vues.length, 1);
});

test('sans le droit, la politique n est jamais appelee', () => {
  const vues = [];
  const protege = creerPorte({ droits: () => [] });
  protege('songe', (e) => vues.push(e))({ pid: 1 });
  assert.strictEqual(vues.length, 0);
});

test('LES DROITS SONT RELUS A CHAQUE TRAME', () => {
  // Une porte qui prendrait une copie au demarrage laisserait tourner une
  // fonction retiree jusqu a la fermeture d OMNI. La veille remplace la liste
  // toutes les 60 s: la porte doit voir le changement au coup suivant.
  const vues = [];
  let accordes = ['songe'];
  const protege = creerPorte({ droits: () => accordes });
  const politique = protege('songe', (e) => vues.push(e));
  politique({ pid: 1 });
  accordes = [];
  politique({ pid: 1 });
  assert.strictEqual(vues.length, 1);
});

test('une exception de la politique traverse la porte', () => {
  // composer() attrape et signale; la porte ne doit pas avaler a sa place,
  // sinon une politique morte redevient un silence.
  const protege = creerPorte({ droits: () => ['hdv'] });
  assert.throws(() => protege('hdv', () => { throw new Error('boum'); })({ pid: 1 }), /boum/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/droits-porte.test.js`
Expected: FAIL, « Cannot find module '../src/droits/porte' »

- [ ] **Step 3: Write the implementation**

```js
// src/droits/porte.js
'use strict';

// LA PORTE: une politique n est appelee que si son droit est accorde.
//
// Elle ne retient pas les droits, elle les DEMANDE a chaque trame. La veille
// remplace la liste toutes les 60 s, et une porte qui aurait pris une copie au
// demarrage laisserait tourner une fonction retiree jusqu a la fermeture.
//
// Elle n attrape aucune exception: composer() le fait deja, et le fait en
// SIGNALANT. Avaler ici rendrait une politique morte indiscernable d une
// politique sans travail -- le mode d echec le plus couteux de ce projet.
function creerPorte({ droits }) {
  return function protege(nom, politique) {
    return function onTrame(evenement) {
      if (!droits().includes(nom)) return;
      politique(evenement);
    };
  };
}

module.exports = { creerPorte };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/droits-porte.test.js` puis `npm test`
Expected: PASS, 4 tests de plus.

- [ ] **Step 5: Commit**

```bash
git add src/droits/porte.js test/droits-porte.test.js
git commit -m "feat(droits): la porte, relue a chaque trame"
```

---

### Task 6: Le branchement dans l'application

**Files:**
- Modify: `desktop/main.js` — imports (vers la ligne 15), création de la veille (avant `superviseur.onTrame = composer(`, ligne 966), la liste de `composer()` (966-1082), la charge utile de `envoyerEtat()` (657), les gestionnaires `majPrixHdv` (1304) et `basculerOverlay` (1323)
- Modify: `desktop/index.html` — le bouton HDV et le bouton overlay de la barre du bas
- Test: aucun test neuf — `desktop/main.js` n'est pas testable sans Electron. **C'est la tâche 7 qui la vérifie.**

**Interfaces:**
- Consumes: `creerVeille`, `creerCacheFichier` (tâche 4), `creerPorte` (tâche 5), `NOMS` (tâche 1).
- Produces: le champ `droits` dans l'état envoyé au panneau.

- [ ] **Step 1: Ajouter les imports et créer la veille**

En tête de `desktop/main.js`, avec les autres `require` :

```js
const { creerVeille, creerCacheFichier } = require('../src/droits/veille');
const { creerPorte } = require('../src/droits/porte');
```

Juste avant `superviseur.onTrame = composer(` :

```js
  // LES DROITS ACCORDES A CETTE CLE. Relus toutes les 60 s: Draxus coupe une
  // case au panneau, la fonction s arrete ici dans la minute.
  //
  // app.getPath('userData') est %APPDATA%\OMNI: le meme dossier que cle.txt,
  // impose par Windows a l application installee.
  const dossierDonnees = app.getPath('userData');
  veille = creerVeille({
    base: 'https://paquets-maj.vercel.app',
    lireCle: () => {
      try { return fs.readFileSync(path.join(dossierDonnees, 'cle.txt'), 'utf8').trim() || null; }
      catch (e) { return null; }   // pas de cle = mode developpement = tous les droits
    },
    cache: creerCacheFichier(path.join(dossierDonnees, 'droits.json')),
    onChangement: ({ gagnes, perdus }) => {
      // UNE FONCTION QUI DISPARAIT EN SILENCE, c est exactement le mode
      // d echec que ce depot documente quatre fois. Elle se dit.
      if (perdus.length) noterAvis(`Droits : ${perdus.join(', ')} — retiré`);
      else if (gagnes.length) noterAvis(`Droits : ${gagnes.join(', ')} — activé`);
      // L HDV est le seul a avoir un travail qui dure: on l arrete net.
      if (perdus.includes('hdv')) {
        for (const etat of superviseur.comptes.tous) reprix.arreter(etat.pid);
      }
      envoyerEtat();
    },
  });
  veille.demarrer();
  const protege = creerPorte({ droits: () => veille.droits() });
```

Déclarer `let veille = null;` à côté des autres variables de module (près de `let reprix = null;`).

- [ ] **Step 2: Faire passer les cinq politiques d'écoute par la porte**

Dans l'appel à `composer()`, envelopper **cinq** politiques et **elles seules**. `creerDuplicateur` et `creerGardeCombat` restent nus.

```js
  superviseur.onTrame = composer(
    creerDuplicateur({ /* inchangé */ }),
    creerGardeCombat({ /* inchangé */ }),
    protege('abandon', creerAbandonGroupe({ /* inchangé */ })),
    protege('passe-tour', creerPasseur({ /* inchangé */ })),
    protege('invitation', creerAccepteur({ /* inchangé */ })),
    protege('echange', creerAccepteurEchange({ /* inchangé */ })),
    protege('songe', creerAccepteurSonge({ /* inchangé */ })),
    protege('hdv', reprix.onTrame),
    noterTrafic(),
    diagnostic(superviseur),
    { onErreur: /* inchangé */ },
  );
```

- [ ] **Step 3: Interdire les deux boutons côté processus principal**

Un bouton grisé se contourne avec les outils de développement d'Electron : la vraie garde est ici.

Dans `ipcMain.handle('majPrixHdv', ...)`, en première ligne du corps :

```js
  if (!veille.droits().includes('hdv')) return { ok: false, raison: 'HDV : pas activé sur ta clé' };
```

Dans `ipcMain.handle('basculerOverlay', ...)`, en première ligne du corps :

```js
  if (!veille.droits().includes('overlay')) { noterAvis('Barre flottante : pas activée sur ta clé'); envoyerEtat(); return; }
```

- [ ] **Step 4: Envoyer les droits au panneau**

Dans `fenetre.webContents.send('etat', { ... })`, ajouter un champ :

```js
    // Ce que cette cle a le droit d utiliser. La page grise le reste.
    droits: veille.droits(),
```

- [ ] **Step 5: Griser les boutons dans la page**

Les deux boutons ne sont pas au même endroit : **l'HDV est un bouton par ligne de compte** (`desktop/index.html:930`, classe `hdv`, déjà grisable — la règle CSS `.hdv:disabled` existe ligne 277), **l'overlay est unique** (`#boverlay`, ligne 492).

L'état arrive dans `window.app.surEtat((etat) => {` (ligne 1090) mais `majRang(r, l)` (ligne 1000) ne le reçoit pas. Poser une variable de module plutôt que changer sa signature — déclarer à côté des autres variables du script :

```js
  // Ce que cette cle a le droit d utiliser, tel que le processus principal
  // vient de le dire. Lue par majRang(), qui ne recoit pas l etat.
  let droitsCourants = [];
```

Première ligne du corps de `surEtat` :

```js
    droitsCourants = etat.droits || [];
```

Puis, dans `majRang`, **remplacer** les lignes 1070-1074 :

```js
    // Le menu n'a de sens que sur un client en jeu, et seulement si la cle a
    // le droit. `hdvLots` a zero veut dire que kby n'est jamais passee.
    const droitHdv = droitsCourants.includes('hdv');
    const hdvPossible = droitHdv && l.pid !== null && l.pid !== undefined && l.etat !== 'hors-ligne';
    r.hdv.disabled = !hdvPossible;
    if (!hdvPossible) r.menuHdv.hidden = true;
    r.hdv.classList.toggle('tourne', Boolean(l.hdvEnCours));
    r.hdv.title = !droitHdv
      ? 'pas activé sur ta clé'
      : (l.hdvEnCours ? 'une mise à jour des prix est en cours' : 'hôtel de vente');
```

Et pour l'overlay, dans `surEtat`, près de la ligne 1126 qui manipule déjà `bov` :

```js
    const droitOverlay = droitsCourants.includes('overlay');
    bov.disabled = !droitOverlay;
    if (!droitOverlay) bov.title = 'pas activé sur ta clé';
```

- [ ] **Step 6: Vérifier que rien n'est cassé**

Run: `npm test`
Expected: PASS, 830 + 17 tests, aucun échec. (Le suite ne couvre pas `main.js` ; ce pas vérifie qu'aucun module n'a été cassé.)

- [ ] **Step 7: Commit**

```bash
git add desktop/main.js desktop/index.html
git commit -m "feat(droits): brancher la veille, la porte et les deux boutons"
```

---

### Task 7: La vérification en vrai

**Files:** aucun. **Rien de ce qui suit ne se prouve par un test unitaire**, et ce dépôt a déjà payé deux fois le prix d'une lecture validée par 16 tests et deux revues.

À faire avec un vrai ami (la clé `test` en base sert à vérifier sans toucher à un vrai compte) :

- [ ] **Step 1: Le déploiement du serveur — TOUJOURS avant toute publication de version**

```bash
cd serveur-maj && npx vercel --prod
```

**Aucun dépôt git n'est connecté au projet Vercel `paquets-maj`** : pousser ne déploie rien.

**Ordre impératif, jamais l'inverse** : la table `droits` part vide, et Vercel rend 404 aussi bien pour une route pas encore déployée que pour une clé révoquée. `src/droits/veille.js` distingue les deux par le `Content-Type` de la réponse (un 404 sans JSON est traité comme injoignable, pas comme une révocation), mais rien ne protège contre l'ordre inverse : publier la version avant `npx vercel --prod` ferait interroger une route qui n'existe pas encore sur l'ancien déploiement, ou pire, laisserait la fenêtre ouverte à une vraie révocation si le déploiement suit de près. Ce Step doit donc être terminé, vérifié, avant de toucher au Step 8 (publication de la version).

- [ ] **Step 2: Cocher tous les amis déjà installés, avant de publier**

La table `droits` part vide : le jour de la publication, chaque ami déjà installé se retrouve à zéro droit jusqu'à ce que Draxus coche ses cases. Sans ce Step, la première conséquence visible de la branche serait que plus rien ne marche chez personne, silencieusement, jusqu'au prochain passage au panneau.

Ouvrir `https://paquets-maj.vercel.app/api/admin` (une fois le Step 1 fait). Pour **chaque ami déjà installé** (pas seulement la clé `test`), tout cocher : les sept fonctions qu'il avait de fait avant cette branche (tout partait chez tout le monde). Vérifier qu'aucun ami existant ne reste avec une ligne vide.

- [ ] **Step 3: Les cases apparaissent**

Ouvrir `https://paquets-maj.vercel.app/api/admin`. Sous chaque ami, sept cases. Cocher `songe` pour la clé `test`, recharger : la case doit rester cochée.

- [ ] **Step 4: Le mode développement n'est pas verrouillé**

Lancer OMNI sur le dépôt (`outils/lancer-diag.vbs`). **Tous les boutons doivent être actifs**, et le journal ne doit montrer aucune requête vers `/api/droits`.

- [ ] **Step 5: Un droit retiré se voit en moins d'une minute**

Chez un ami en cours de session, décocher `hdv` au panneau. Chronométrer : le bouton doit se griser et le pied de page afficher « Droits : hdv — retiré » **en moins de 60 secondes**, sans qu'il relance quoi que ce soit.

- [ ] **Step 6: Une coupure de réseau ne retire rien**

Couper le wifi de la machine de test pendant deux minutes avec des droits accordés. **Aucun bouton ne doit se griser.** C'est le cas que le dessin protège en premier.

- [ ] **Step 7: Le paquet de 480 Mo n'est pas redemandé**

Publier la version au panneau (le Step 1 doit déjà être fait — jamais l'inverse), puis regarder `%APPDATA%\OMNI\amorceur.log` chez l'ami : il doit porter `version X installee` et rien d'autre. **Exigence explicite de Draxus.**

- [ ] **Step 8: Commit du compte rendu**

Ajouter les mesures en tête de `src/droits/veille.js` (les délais constatés, ce qui a été vu à l'écran), comme le font `src/songes.js` et `src/abandon-combat.js`.

```bash
git add src/droits/veille.js
git commit -m "docs(droits): verifie en jeu, les delais constates"
```

---

## Ordre et dépendances

1 → 2 → 3 (le serveur, bout en bout) et 1 → 4 → 5 → 6 (l'application). Les tâches 2-3 et 4-5 sont indépendantes entre elles : elles peuvent avancer en parallèle une fois la tâche 1 posée. La tâche 6 a besoin de 4 et 5. La tâche 7 a besoin de tout.

## Ce que ce plan ne fait pas

- Il ne fabrique ni ne publie de version. Le numéro suivant, l'entrée de `devlog.json` et l'archive se font après la tâche 7, avec le rituel habituel (`outils/faire-etape.js` lancé par le binaire packagé, puis panneau).
- Il ne touche pas au replicate ni au garde-combat.
- Il ne crée aucun fichier dans `desktop/`.
