# Mise à jour auto — Sous-projet A : infrastructure Vercel + base

> **Pour les agents :** SOUS-SKILL REQUISE — `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans`, tâche par tâche. Cases à cocher pour le suivi.

**Objectif :** un service qui sert un manifeste et une archive de code aux seules clés valides, plus un panneau d'administration pour gérer les amis, plus une commande de publication.

**Architecture :** un sous-projet `serveur-maj/` dans le dépôt `mm`, déployé comme **projet Vercel séparé** (Root Directory = `serveur-maj`). Trois fonctions serverless, une base Neon, un panneau HTML. Se construit, se teste et se déploie sans toucher à l'application Electron.

**Pile :** Node ≥18, `@neondatabase/serverless`, Vercel, `node:test`.

## Contraintes globales

Elles s'appliquent à **toutes** les tâches.

- **`npm test` est le seul point d'entrée** dans `serveur-maj/`. Vérifier que la suite **imprime son total** (`ℹ tests N`).
- **Aucune fonction ne fait confiance à son appelant.** `/api/manifeste` et `/api/paquet` rendent **404** — pas 401, pas 403 — sans clé valide : un 404 ne révèle pas que la ressource existe. `/api/admin` rend 404 sans le mot de passe admin.
- **Le mot de passe admin et `DATABASE_URL` vivent en variables d'environnement Vercel**, jamais dans le code, jamais commités.
- **Fichiers de fonction distincts**, un par route (`api/manifeste.js`, `api/paquet.js`, `api/admin.js`). Vercel mappe chaque fichier à `/api/<nom>`. Ne pas utiliser de routeur fourre-tout `[...path].js` : le piège du 404 vide sur segments multiples a déjà été payé sur `dofus-commerce`.
- **La protection de déploiement Vercel doit être désactivée** sur ce projet (elle renvoie une page de connexion de ~480 Ko à chaque requête). C'est un réglage du tableau de bord, pas du code — rappelé à la tâche de déploiement.
- **Toute décision engageant un compte externe** (créer le projet Vercel, la base Neon, accepter des CGU) est prise par l'utilisateur, jamais par un agent. Les tâches concernées s'arrêtent et le lui demandent.
- **Le code accède à la base par une couche unique** (`serveur-maj/lib/amis.js`, `serveur-maj/lib/manifeste.js`) qui reçoit son client `sql` en argument, pour être testable avec un faux `sql` sans base réelle.
- **PowerShell / Windows** : ne pas chaîner git avec `if ($?)`. Commits en français, à l'impératif.

## Structure des fichiers

| fichier | responsabilité | tâche |
|---|---|---|
| `serveur-maj/package.json` | dépendances, scripts | 1 |
| `serveur-maj/vercel.json` | durée max des fonctions | 1 |
| `serveur-maj/lib/db.js` | crée le client Neon depuis `DATABASE_URL`, applique le schéma | 1 |
| `serveur-maj/lib/amis.js` | vérifier une clé, lister/créer/basculer un ami | 2 |
| `serveur-maj/lib/manifeste.js` | lire et écrire la ligne de manifeste | 3 |
| `serveur-maj/api/manifeste.js` | fonction : clé → manifeste ou 404 | 4 |
| `serveur-maj/api/paquet.js` | fonction : clé → archive ou 404 | 5 |
| `serveur-maj/api/admin.js` | fonction : mot de passe → panneau + pilotage | 6 |
| `serveur-maj/web/admin.html` | le panneau | 6 |
| `serveur-maj/publier.js` | script de publication | 7 |
| `serveur-maj/test/*.test.js` | tests des couches lib | 2, 3 |

Le stockage : l'archive publiée est un fichier `serveur-maj/paquets/<version>.tar.gz`
livré avec le projet et lu par `/api/paquet`. Le manifeste (version, sha256,
actif, message) est **une ligne unique** en base, lue par `/api/manifeste`.

---

### Tâche 1 : ossature du sous-projet et accès base

**Fichiers :**
- Créer : `serveur-maj/package.json`, `serveur-maj/vercel.json`, `serveur-maj/lib/db.js`
- Créer : `serveur-maj/.gitignore`

**Interfaces :**
- Produit : `creerClient()` → un client `sql` Neon ; `appliquerSchema(sql)` → crée les tables si absentes.

- [x] **Étape 1 : package.json**

```json
{
  "name": "replicate-serveur-maj",
  "version": "0.1.0",
  "private": true,
  "description": "Service de mise a jour et distribution de Replicate",
  "scripts": {
    "test": "node --test",
    "publier": "node publier.js"
  },
  "engines": { "node": ">=18" },
  "dependencies": { "@neondatabase/serverless": "^0.10.4" }
}
```

- [x] **Étape 2 : vercel.json et .gitignore**

`serveur-maj/vercel.json` :

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": { "api/*.js": { "maxDuration": 10 } }
}
```

`serveur-maj/.gitignore` :

```
node_modules/
.vercel/
```

Les archives publiées `paquets/*.tar.gz` **sont** commitées — elles font
partie du déploiement. Ne pas les ignorer.

- [x] **Étape 3 : la couche base**

`serveur-maj/lib/db.js` :

```js
'use strict';
const { neon } = require('@neondatabase/serverless');

// Un client par invocation de fonction: le driver serverless de Neon ne
// maintient pas de pool, chaque requete est un appel HTTP autonome.
function creerClient() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL absente');
  return neon(process.env.DATABASE_URL);
}

// Idempotent: sur pour etre appele a chaque demarrage. Deux tables:
//   amis      une ligne par ami, la cle est l'identifiant
//   config    UNE seule ligne (id=1) portant le manifeste courant
async function appliquerSchema(sql) {
  await sql`CREATE TABLE IF NOT EXISTS amis (
    cle TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    actif BOOLEAN NOT NULL DEFAULT true,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    derniere_vue TIMESTAMPTZ
  )`;
  await sql`CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    version TEXT,
    sha256 TEXT,
    actif BOOLEAN NOT NULL DEFAULT true,
    message TEXT,
    CHECK (id = 1)
  )`;
  await sql`INSERT INTO config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
}

module.exports = { creerClient, appliquerSchema };
```

- [x] **Étape 4 : vérifier que le module se charge**

Run: `cd serveur-maj && node -e "require('./lib/db')" && npm install`
Attendu : aucune erreur ; `node_modules` créé.

`npm install` n'exécute pas les postinstall sur cette machine, mais
`@neondatabase/serverless` est du JS pur, sans étape native — rien à
reconstruire.

- [x] **Étape 5 : commiter**

```bash
git add serveur-maj/package.json serveur-maj/vercel.json serveur-maj/.gitignore serveur-maj/lib/db.js
git commit -m "feat(maj): ossature du serveur de mise a jour et acces base"
```

---

### Tâche 2 : la couche « amis »

**Fichiers :**
- Créer : `serveur-maj/lib/amis.js`
- Créer : `serveur-maj/test/amis.test.js`

**Interfaces :**
- Produit :
  - `verifierCle(sql, cle)` → `{ ok: true, nom }` si la clé existe et `actif`, sinon `{ ok: false }`. Met `derniere_vue` à `now()` quand `ok`.
  - `listerAmis(sql)` → tableau `{ cle, nom, actif, cree_le, derniere_vue }`.
  - `creerAmi(sql, nom, genererCle)` → `{ cle, nom }`. `genererCle` injecté pour les tests.
  - `basculerAmi(sql, cle, actif)` → `{ ok }`.

**Le faux `sql`** des tests est une fonction tag qui enregistre la requête et
rend une réponse programmée. Les fonctions ci-dessous n'utilisent que des
requêtes paramétrées via l'interpolation tag de Neon — **jamais** de
concaténation de chaîne, sinon injection SQL.

- [x] **Étape 1 : écrire les tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { verifierCle, listerAmis, creerAmi, basculerAmi } = require('../lib/amis');

// Faux client Neon: une fonction tag qui rend la reponse en tete de file et
// journalise l'appel. Chaque requete rend un tableau, comme le vrai driver.
function fauxSql(reponses = []) {
  const appels = [];
  const sql = (chaines, ...valeurs) => {
    appels.push({ texte: chaines.join('?'), valeurs });
    return Promise.resolve(reponses.length ? reponses.shift() : []);
  };
  sql.appels = appels;
  return sql;
}

test('une cle active est acceptee et sa derniere_vue mise a jour', async () => {
  const sql = fauxSql([[{ nom: 'Kevin' }], []]);
  const r = await verifierCle(sql, 'abc');
  assert.deepStrictEqual(r, { ok: true, nom: 'Kevin' });
  // Deux requetes: le SELECT, puis l'UPDATE derniere_vue.
  assert.strictEqual(sql.appels.length, 2);
  assert.match(sql.appels[1].texte, /derniere_vue/);
});

test('une cle inconnue est refusee, sans UPDATE', async () => {
  const sql = fauxSql([[]]);
  const r = await verifierCle(sql, 'zzz');
  assert.deepStrictEqual(r, { ok: false });
  assert.strictEqual(sql.appels.length, 1);
});

test('une cle inactive est refusee', async () => {
  // Le SELECT filtre sur actif=true: une cle inactive rend 0 ligne.
  const sql = fauxSql([[]]);
  assert.deepStrictEqual(await verifierCle(sql, 'off'), { ok: false });
});

test('creerAmi genere une cle et insere', async () => {
  const sql = fauxSql([[]]);
  const r = await creerAmi(sql, 'Marie', () => 'cle-fixe');
  assert.deepStrictEqual(r, { cle: 'cle-fixe', nom: 'Marie' });
  assert.match(sql.appels[0].texte, /INSERT INTO amis/i);
  assert.ok(sql.appels[0].valeurs.includes('cle-fixe'));
  assert.ok(sql.appels[0].valeurs.includes('Marie'));
});

test('listerAmis rend les lignes telles quelles', async () => {
  const lignes = [{ cle: 'a', nom: 'A', actif: true }];
  assert.deepStrictEqual(await listerAmis(fauxSql([lignes])), lignes);
});

test('basculerAmi passe le booleen et la cle', async () => {
  const sql = fauxSql([[]]);
  await basculerAmi(sql, 'a', false);
  assert.ok(sql.appels[0].valeurs.includes(false));
  assert.ok(sql.appels[0].valeurs.includes('a'));
});
```

- [x] **Étape 2 : lancer, vérifier l'échec**

```bash
cd serveur-maj && npm test
```
Attendu : `Cannot find module '../lib/amis'`.

- [x] **Étape 3 : implémenter**

```js
'use strict';

// Toutes les requetes passent par l'interpolation tag de Neon: les valeurs
// sont parametrees, jamais concatenees. C'est ce qui empeche l'injection.
async function verifierCle(sql, cle) {
  const lignes = await sql`SELECT nom FROM amis WHERE cle = ${cle} AND actif = true`;
  if (lignes.length === 0) return { ok: false };
  await sql`UPDATE amis SET derniere_vue = now() WHERE cle = ${cle}`;
  return { ok: true, nom: lignes[0].nom };
}

async function listerAmis(sql) {
  return sql`SELECT cle, nom, actif, cree_le, derniere_vue FROM amis ORDER BY cree_le`;
}

async function creerAmi(sql, nom, genererCle) {
  const cle = genererCle();
  await sql`INSERT INTO amis (cle, nom) VALUES (${cle}, ${nom})`;
  return { cle, nom };
}

async function basculerAmi(sql, cle, actif) {
  await sql`UPDATE amis SET actif = ${actif} WHERE cle = ${cle}`;
  return { ok: true };
}

module.exports = { verifierCle, listerAmis, creerAmi, basculerAmi };
```

- [x] **Étape 4 : lancer, vérifier le passage, commiter**

```bash
npm test
git add serveur-maj/lib/amis.js serveur-maj/test/amis.test.js
git commit -m "feat(maj): couche amis, verification et gestion des cles"
```

---

### Tâche 3 : la couche « manifeste »

**Fichiers :**
- Créer : `serveur-maj/lib/manifeste.js`
- Créer : `serveur-maj/test/manifeste.test.js`

**Interfaces :**
- Produit :
  - `lireManifeste(sql)` → `{ version, sha256, actif, message }`.
  - `ecrireManifeste(sql, { version, sha256 })` → met à jour version et sha256 de la ligne unique, sans toucher `actif`/`message`.
  - `basculerService(sql, actif, message)` → met à jour `actif` et `message` (le coupe-circuit global).

- [x] **Étape 1 : écrire les tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { lireManifeste, ecrireManifeste, basculerService } = require('../lib/manifeste');

function fauxSql(reponses = []) {
  const appels = [];
  const sql = (c, ...v) => { appels.push({ texte: c.join('?'), valeurs: v }); return Promise.resolve(reponses.length ? reponses.shift() : []); };
  sql.appels = appels;
  return sql;
}

test('lireManifeste rend la ligne unique', async () => {
  const sql = fauxSql([[{ version: '0.2.0', sha256: 'abc', actif: true, message: null }]]);
  assert.deepStrictEqual(await lireManifeste(sql), { version: '0.2.0', sha256: 'abc', actif: true, message: null });
});

// La ligne config est garantie par appliquerSchema; mais si elle manque, ne
// pas planter: rendre un manifeste inerte plutot qu'une exception.
test('lireManifeste sans ligne rend un manifeste vide non plantant', async () => {
  const r = await lireManifeste(fauxSql([[]]));
  assert.strictEqual(r.version, null);
  assert.strictEqual(r.actif, false);
});

test('ecrireManifeste met version et sha, jamais actif', async () => {
  const sql = fauxSql([[]]);
  await ecrireManifeste(sql, { version: '0.3.0', sha256: 'def' });
  assert.match(sql.appels[0].texte, /UPDATE config SET/i);
  assert.ok(sql.appels[0].valeurs.includes('0.3.0'));
  assert.ok(!/actif/i.test(sql.appels[0].texte));
});

test('basculerService ecrit actif et message', async () => {
  const sql = fauxSql([[]]);
  await basculerService(sql, false, 'maintenance');
  assert.ok(sql.appels[0].valeurs.includes(false));
  assert.ok(sql.appels[0].valeurs.includes('maintenance'));
});
```

- [x] **Étape 2 : lancer, vérifier l'échec**

```bash
npm test
```

- [x] **Étape 3 : implémenter**

```js
'use strict';

async function lireManifeste(sql) {
  const lignes = await sql`SELECT version, sha256, actif, message FROM config WHERE id = 1`;
  if (lignes.length === 0) return { version: null, sha256: null, actif: false, message: null };
  return lignes[0];
}

async function ecrireManifeste(sql, { version, sha256 }) {
  await sql`UPDATE config SET version = ${version}, sha256 = ${sha256} WHERE id = 1`;
}

async function basculerService(sql, actif, message) {
  await sql`UPDATE config SET actif = ${actif}, message = ${message} WHERE id = 1`;
}

module.exports = { lireManifeste, ecrireManifeste, basculerService };
```

- [x] **Étape 4 : lancer, vérifier le passage, commiter**

```bash
npm test
git add serveur-maj/lib/manifeste.js serveur-maj/test/manifeste.test.js
git commit -m "feat(maj): couche manifeste et coupe-circuit global"
```

---

### Tâche 4 : la fonction `/api/manifeste`

**Fichiers :**
- Créer : `serveur-maj/api/manifeste.js`
- Créer : `serveur-maj/test/api-manifeste.test.js`

**Interfaces :**
- Consomme : `verifierCle` (T2), `lireManifeste` (T3), `creerClient`/`appliquerSchema` (T1).
- Produit : un gestionnaire `(req, res)` ; et une fonction pure `traiterManifeste({ cle, sql })` → `{ statut, corps }`, pour tester sans HTTP.

La clé arrive dans l'en-tête `x-cle`. La logique testable est séparée du
transport HTTP : `traiterManifeste` ne connaît ni `req` ni `res`.

- [x] **Étape 1 : écrire les tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { traiterManifeste } = require('../api/manifeste');

function fauxSql(reponses) {
  const sql = (c, ...v) => Promise.resolve(reponses.length ? reponses.shift() : []);
  return sql;
}

test('sans cle, 404', async () => {
  const r = await traiterManifeste({ cle: undefined, sql: fauxSql([]) });
  assert.strictEqual(r.statut, 404);
});

test('cle inconnue, 404', async () => {
  const r = await traiterManifeste({ cle: 'zzz', sql: fauxSql([[]]) });
  assert.strictEqual(r.statut, 404);
});

test('cle valide, 200 et le manifeste', async () => {
  // 1er SELECT: verifierCle rend le nom. 2e: UPDATE derniere_vue. 3e: lireManifeste.
  const sql = fauxSql([[{ nom: 'Kevin' }], [], [{ version: '0.2.0', sha256: 'abc', actif: true, message: null }]]);
  const r = await traiterManifeste({ cle: 'ok', sql });
  assert.strictEqual(r.statut, 200);
  assert.strictEqual(r.corps.version, '0.2.0');
  assert.strictEqual(r.corps.sha256, 'abc');
});
```

- [x] **Étape 2 : lancer, vérifier l'échec**

```bash
npm test
```

- [x] **Étape 3 : implémenter**

```js
'use strict';
const { creerClient, appliquerSchema } = require('../lib/db');
const { verifierCle } = require('../lib/amis');
const { lireManifeste } = require('../lib/manifeste');

// Logique pure, sans HTTP: c'est elle qu'on teste.
async function traiterManifeste({ cle, sql }) {
  if (!cle) return { statut: 404, corps: null };
  const v = await verifierCle(sql, cle);
  if (!v.ok) return { statut: 404, corps: null };
  const manifeste = await lireManifeste(sql);
  return { statut: 200, corps: manifeste };
}

module.exports = async (req, res) => {
  try {
    const sql = creerClient();
    await appliquerSchema(sql);
    const cle = req.headers['x-cle'];
    const { statut, corps } = await traiterManifeste({ cle, sql });
    res.statusCode = statut;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(corps === null ? '' : JSON.stringify(corps));
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end('');
  }
};
module.exports.traiterManifeste = traiterManifeste;
```

- [x] **Étape 4 : lancer, vérifier le passage, commiter**

```bash
npm test
git add serveur-maj/api/manifeste.js serveur-maj/test/api-manifeste.test.js
git commit -m "feat(maj): fonction /api/manifeste, 404 sans cle valide"
```

---

### Tâche 5 : la fonction `/api/paquet`

**Fichiers :**
- Créer : `serveur-maj/api/paquet.js`
- Créer : `serveur-maj/test/api-paquet.test.js`

**Interfaces :**
- Consomme : `verifierCle` (T2), `lireManifeste` (T3).
- Produit : `traiterPaquet({ cle, sql, lireFichier })` → `{ statut, corps, type }`. `lireFichier(version)` injecté rend le contenu de l'archive ou lève si absente.

L'archive vit dans `serveur-maj/paquets/<version>.tar.gz`. La fonction lit la
version courante dans le manifeste, puis sert le fichier correspondant. En
production, `lireFichier` lit depuis le disque bundlé ; les tests l'injectent.

- [x] **Étape 1 : écrire les tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { traiterPaquet } = require('../api/paquet');

function fauxSql(reponses) {
  const sql = (c, ...v) => Promise.resolve(reponses.length ? reponses.shift() : []);
  return sql;
}

test('sans cle valide, 404 et le fichier n est jamais lu', async () => {
  let lu = false;
  const r = await traiterPaquet({ cle: 'zzz', sql: fauxSql([[]]), lireFichier: () => { lu = true; } });
  assert.strictEqual(r.statut, 404);
  assert.strictEqual(lu, false);
});

test('cle valide, l archive de la version courante est servie', async () => {
  const sql = fauxSql([[{ nom: 'K' }], [], [{ version: '0.2.0', sha256: 'abc', actif: true, message: null }]]);
  const r = await traiterPaquet({ cle: 'ok', sql, lireFichier: (v) => Buffer.from(`archive-${v}`) });
  assert.strictEqual(r.statut, 200);
  assert.strictEqual(r.corps.toString(), 'archive-0.2.0');
  assert.strictEqual(r.type, 'application/gzip');
});

// Version annoncee mais fichier absent: 404, pas 500. Ne pas exposer une
// erreur serveur pour une incoherence de publication.
test('archive absente, 404', async () => {
  const sql = fauxSql([[{ nom: 'K' }], [], [{ version: '9.9.9', sha256: 'x', actif: true, message: null }]]);
  const r = await traiterPaquet({ cle: 'ok', sql, lireFichier: () => { throw new Error('ENOENT'); } });
  assert.strictEqual(r.statut, 404);
});
```

- [x] **Étape 2 : lancer, vérifier l'échec**

```bash
npm test
```

- [x] **Étape 3 : implémenter**

```js
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { creerClient, appliquerSchema } = require('../lib/db');
const { verifierCle } = require('../lib/amis');
const { lireManifeste } = require('../lib/manifeste');

async function traiterPaquet({ cle, sql, lireFichier }) {
  if (!cle) return { statut: 404, corps: null };
  const v = await verifierCle(sql, cle);
  if (!v.ok) return { statut: 404, corps: null };
  const manifeste = await lireManifeste(sql);
  if (!manifeste.version) return { statut: 404, corps: null };
  try {
    const corps = lireFichier(manifeste.version);
    return { statut: 200, corps, type: 'application/gzip' };
  } catch (e) {
    return { statut: 404, corps: null };
  }
}

module.exports = async (req, res) => {
  try {
    const sql = creerClient();
    await appliquerSchema(sql);
    const cle = req.headers['x-cle'];
    // includeFiles bundle paquets/ avec la fonction; on lit depuis __dirname.
    const lireFichier = (version) =>
      fs.readFileSync(path.join(__dirname, '..', 'paquets', `${version}.tar.gz`));
    const { statut, corps, type } = await traiterPaquet({ cle, sql, lireFichier });
    res.statusCode = statut;
    if (corps === null) return res.end('');
    res.setHeader('Content-Type', type);
    res.end(corps);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end('');
  }
};
module.exports.traiterPaquet = traiterPaquet;
```

Ajouter à `serveur-maj/vercel.json`, pour que le dossier `paquets/` soit livré
avec la fonction :

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "api/*.js": { "maxDuration": 10 },
    "api/paquet.js": { "maxDuration": 10, "includeFiles": "paquets/**" }
  }
}
```

- [x] **Étape 4 : lancer, vérifier le passage, commiter**

```bash
npm test
git add serveur-maj/api/paquet.js serveur-maj/test/api-paquet.test.js serveur-maj/vercel.json
git commit -m "feat(maj): fonction /api/paquet, archive servie sur cle valide"
```

---

### Tâche 6 : la fonction `/api/admin` et le panneau

**Fichiers :**
- Créer : `serveur-maj/api/admin.js`
- Créer : `serveur-maj/web/admin.html`
- Créer : `serveur-maj/test/api-admin.test.js`

**Interfaces :**
- Consomme : `listerAmis`, `creerAmi`, `basculerAmi` (T2), `basculerService` (T3).
- Produit : `traiterAdmin({ motDePasse, action, corps, sql, genererCle, motDePasseAttendu })` → `{ statut, corps }`.

Le mot de passe arrive dans l'en-tête `x-admin`. Les actions : `lister`,
`creer` (`{ nom }`), `basculer` (`{ cle, actif }`), `service` (`{ actif,
message }`). Une requête `GET` sans action sert le HTML du panneau.

**La comparaison du mot de passe doit être à temps constant** —
`crypto.timingSafeEqual` — pour ne pas fuir sa longueur ni ses préfixes par le
temps de réponse. Une comparaison `===` est un défaut de sécurité ici.

- [x] **Étape 1 : écrire les tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { traiterAdmin } = require('../api/admin');

function fauxSql(reponses = []) {
  const sql = (c, ...v) => Promise.resolve(reponses.length ? reponses.shift() : []);
  return sql;
}
const SECRET = 'motdepasse-admin';

test('mauvais mot de passe, 404', async () => {
  const r = await traiterAdmin({ motDePasse: 'faux', action: 'lister', sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 404);
});

test('sans mot de passe, 404', async () => {
  const r = await traiterAdmin({ motDePasse: undefined, action: 'lister', sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 404);
});

test('lister rend les amis', async () => {
  const amis = [{ cle: 'a', nom: 'A', actif: true }];
  const r = await traiterAdmin({ motDePasse: SECRET, action: 'lister', sql: fauxSql([amis]), motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, amis);
});

test('creer rend la nouvelle cle', async () => {
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'creer', corps: { nom: 'Marie' },
    sql: fauxSql([[]]), genererCle: () => 'k', motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, { cle: 'k', nom: 'Marie' });
});

test('creer sans nom, 400', async () => {
  const r = await traiterAdmin({ motDePasse: SECRET, action: 'creer', corps: {}, sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 400);
});

test('action inconnue, 400', async () => {
  const r = await traiterAdmin({ motDePasse: SECRET, action: 'xyz', sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(r.statut, 400);
});
```

- [x] **Étape 2 : lancer, vérifier l'échec**

```bash
npm test
```

- [x] **Étape 3 : implémenter la fonction**

```js
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { creerClient, appliquerSchema } = require('../lib/db');
const { listerAmis, creerAmi, basculerAmi } = require('../lib/amis');
const { basculerService } = require('../lib/manifeste');

// Comparaison a temps constant: une comparaison ordinaire revele la longueur
// et les prefixes du secret par le temps de reponse.
function memeSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function traiterAdmin({ motDePasse, action, corps = {}, sql, genererCle, motDePasseAttendu }) {
  if (!memeSecret(motDePasse, motDePasseAttendu)) return { statut: 404, corps: null };
  const gen = genererCle || (() => crypto.randomBytes(24).toString('hex'));
  switch (action) {
    case 'lister':
      return { statut: 200, corps: await listerAmis(sql) };
    case 'creer':
      if (!corps.nom) return { statut: 400, corps: { erreur: 'nom requis' } };
      return { statut: 200, corps: await creerAmi(sql, corps.nom, gen) };
    case 'basculer':
      if (!corps.cle) return { statut: 400, corps: { erreur: 'cle requise' } };
      await basculerAmi(sql, corps.cle, Boolean(corps.actif));
      return { statut: 200, corps: { ok: true } };
    case 'service':
      await basculerService(sql, Boolean(corps.actif), corps.message || null);
      return { statut: 200, corps: { ok: true } };
    default:
      return { statut: 400, corps: { erreur: 'action inconnue' } };
  }
}

module.exports = async (req, res) => {
  try {
    const motDePasse = req.headers['x-admin'];
    const attendu = process.env.ADMIN_MDP;
    // GET sans en-tete admin ET sans action: on sert la page. Elle demandera
    // le mot de passe et le mettra dans x-admin pour toutes ses requetes.
    if (req.method === 'GET' && !req.headers['x-admin']) {
      const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'admin.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(html);
    }
    let corps = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      corps = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    }
    const action = (req.query && req.query.action) || corps.action;
    const sql = creerClient();
    await appliquerSchema(sql);
    const r = await traiterAdmin({ motDePasse, action, corps, sql, motDePasseAttendu: attendu });
    res.statusCode = r.statut;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(r.corps === null ? '' : JSON.stringify(r.corps));
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end('');
  }
};
module.exports.traiterAdmin = traiterAdmin;
```

- [x] **Étape 4 : écrire le panneau**

`serveur-maj/web/admin.html` — page autonome, sans dépendance externe. Elle
demande le mot de passe une fois, le garde en mémoire (jamais sur disque), et
l'envoie dans `x-admin`. Contenu minimal :

```html
<!doctype html><meta charset="utf-8"><title>Replicate — amis</title>
<style>
  body { font: 14px system-ui; background:#16181d; color:#e6e8ec; margin:0; padding:20px; }
  input,button { font:inherit; padding:6px 10px; border-radius:6px; border:1px solid #3a3f4b; background:#22252c; color:#e6e8ec; }
  button { cursor:pointer; background:#2e5d8a; border:0; }
  table { border-collapse:collapse; width:100%; margin-top:16px; }
  td,th { text-align:left; padding:8px; border-bottom:1px solid #22252c; }
  .off { opacity:.5; }
  .cle { font-family:monospace; font-size:12px; color:#8b93a3; }
</style>
<h1>Amis</h1>
<div id="connexion">
  <input id="mdp" type="password" placeholder="mot de passe admin">
  <button onclick="entrer()">entrer</button>
</div>
<div id="panneau" hidden>
  <input id="nom" placeholder="nom du nouvel ami">
  <button onclick="creer()">nouvel ami</button>
  <table id="liste"></table>
</div>
<script>
  let mdp = '';
  async function api(action, corps) {
    const r = await fetch('/api/admin?action=' + action, {
      method: 'POST',
      headers: { 'x-admin': mdp, 'content-type': 'application/json' },
      body: JSON.stringify(corps || {}),
    });
    if (r.status === 404) { alert('mot de passe refusé'); throw new Error('404'); }
    return r.json();
  }
  async function entrer() {
    mdp = document.getElementById('mdp').value;
    try { await rafraichir(); document.getElementById('connexion').hidden = true; document.getElementById('panneau').hidden = false; }
    catch (e) {}
  }
  async function rafraichir() {
    const amis = await api('lister');
    const t = document.getElementById('liste');
    t.innerHTML = '<tr><th>nom</th><th>clé</th><th>dernière vue</th><th></th></tr>';
    for (const a of amis) {
      const tr = document.createElement('tr');
      if (!a.actif) tr.className = 'off';
      tr.innerHTML = `<td>${a.nom}</td><td class="cle">${a.cle}</td><td>${a.derniere_vue || '—'}</td>`;
      const td = document.createElement('td');
      const b = document.createElement('button');
      b.textContent = a.actif ? 'désactiver' : 'activer';
      b.onclick = async () => { await api('basculer', { cle: a.cle, actif: !a.actif }); rafraichir(); };
      td.append(b); tr.append(td); t.append(tr);
    }
  }
  async function creer() {
    const nom = document.getElementById('nom').value.trim();
    if (!nom) return;
    const r = await api('creer', { nom });
    prompt('clé de ' + nom + ' — à lui transmettre :', r.cle);
    document.getElementById('nom').value = '';
    rafraichir();
  }
</script>
```

- [x] **Étape 5 : lancer les tests, commiter**

```bash
npm test
git add serveur-maj/api/admin.js serveur-maj/web/admin.html serveur-maj/test/api-admin.test.js
git commit -m "feat(maj): panneau admin et fonction /api/admin protegee par mot de passe"
```

---

### Tâche 7 : le script de publication

**Fichiers :**
- Créer : `serveur-maj/publier.js`
- Créer : `serveur-maj/test/publier.test.js`

**Interfaces :**
- Consomme : `ecrireManifeste` (T3).
- Produit : `preparerPublication({ version, contenuArchive, ecrireFichier, sha })` → `{ chemin, sha256 }`, la partie testable ; le script complet orchestre compilation, archive, écriture, mise à jour base, déploiement.

**Ce script tourne chez l'utilisateur, pas sur Vercel.** Il a besoin de
`DATABASE_URL` dans son environnement pour mettre à jour le manifeste. La
compilation en bytecode et l'assemblage de l'archive viennent du sous-projet B
(le client) : **ce plan-ci ne les invente pas.** Tant que B n'existe pas,
`publier.js` prend une archive déjà fabriquée en argument. La partie testable
est le calcul du SHA et l'écriture au bon endroit.

- [x] **Étape 1 : écrire le test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { preparerPublication } = require('../publier');

test('preparerPublication ecrit l archive et rend son sha256', () => {
  const contenu = Buffer.from('paquet-test');
  const attendu = crypto.createHash('sha256').update(contenu).digest('hex');
  let ecrit = null;
  const r = preparerPublication({
    version: '0.3.0',
    contenuArchive: contenu,
    ecrireFichier: (chemin, data) => { ecrit = { chemin, data }; },
  });
  assert.strictEqual(r.sha256, attendu);
  assert.match(r.chemin, /0\.3\.0\.tar\.gz$/);
  assert.strictEqual(ecrit.data, contenu);
});
```

- [x] **Étape 2 : lancer, vérifier l'échec**

```bash
npm test
```

- [x] **Étape 3 : implémenter**

```js
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { creerClient } = require('./lib/db');
const { ecrireManifeste } = require('./lib/manifeste');

function preparerPublication({ version, contenuArchive, ecrireFichier }) {
  const sha256 = crypto.createHash('sha256').update(contenuArchive).digest('hex');
  const chemin = path.join(__dirname, 'paquets', `${version}.tar.gz`);
  ecrireFichier(chemin, contenuArchive);
  return { chemin, sha256 };
}

// Orchestration reelle: appelee quand on lance `npm run publier <archive>`.
// L'archive est fabriquee par le sous-projet B; ici on la prend telle quelle.
async function main() {
  const archive = process.argv[2];
  const version = process.argv[3];
  if (!archive || !version) {
    console.error('usage: node publier.js <archive.tar.gz> <version>');
    process.exit(1);
  }
  const contenu = fs.readFileSync(archive);
  fs.mkdirSync(path.join(__dirname, 'paquets'), { recursive: true });
  const { chemin, sha256 } = preparerPublication({
    version, contenuArchive: contenu,
    ecrireFichier: (c, d) => fs.writeFileSync(c, d),
  });
  console.log(`archive ecrite: ${chemin}`);
  console.log(`sha256: ${sha256}`);
  // L'archive doit etre DEPLOYEE avant que le manifeste la designe: on
  // deploie a la main (npx vercel --prod) APRES ce script, puis on relance
  // avec --activer pour basculer le manifeste. Deux temps, pour qu'aucun
  // client ne recoive un manifeste pointant une archive pas encore en ligne.
  if (process.argv.includes('--activer')) {
    const sql = creerClient();
    await ecrireManifeste(sql, { version, sha256 });
    console.log('manifeste bascule sur la version', version);
  } else {
    console.log('archive prete. Deploie (npx vercel --prod), puis relance avec --activer.');
  }
}

if (require.main === module) main();
module.exports = { preparerPublication };
```

- [x] **Étape 4 : lancer, vérifier le passage, commiter**

```bash
npm test
git add serveur-maj/publier.js serveur-maj/test/publier.test.js
git commit -m "feat(maj): script de publication, sha256 et bascule du manifeste"
```

---

### Tâche 8 : déploiement et essai de bout en bout

**Aucun code.** Cette tâche crée les ressources externes et vérifie le service
en vrai. Elle est faite **par l'utilisateur**, guidée pas à pas — un agent ne
crée pas de compte ni de base.

- [x] **Étape 1 : la base Neon** — `paquets-maj-db`, Neon ID `withered-dawn-11076602`, Francfort (fra1), palier gratuit, Neon Auth désactivé. Connectée au projet en Production et Preview ; elle injecte `DATABASE_URL`. Le schéma s'est appliqué tout seul au premier appel de fonction.

L'utilisateur crée une base Neon (ou réutilise une instance) et fournit son
`DATABASE_URL`. Le schéma s'applique tout seul au premier appel de fonction.

- [x] **Étape 2 : le projet Vercel** — fait le 2026-08-24 : projet `exode1/paquets-maj`, production sur **https://paquets-maj.vercel.app**. `ADMIN_MDP` reste à définir.

Depuis `serveur-maj/`, l'utilisateur lance `npx vercel` et règle **Root
Directory = serveur-maj** si le dépôt entier est lié. Variables
d'environnement à définir dans le tableau de bord Vercel :
- `DATABASE_URL` (la base Neon)
- `ADMIN_MDP` (le mot de passe admin, choisi par l'utilisateur)

- [x] **Étape 3 : désactiver la protection de déploiement** — rien à faire : l'alias de production répond 200 sans page de connexion (seules les URL de déploiement `-<hash>-exode1` rendent 302, comportement normal).

Tableau de bord Vercel → Settings → Deployment Protection → désactiver. Sinon
chaque requête reçoit une page de connexion de ~480 Ko au lieu de la réponse.

- [x] **Étape 4 : essais au curl** — faits, plus une passe depuis la page pour ne pas sortir la clé du navigateur.

```bash
# sans cle: 404
curl -s -o /dev/null -w "%{http_code}" https://<projet>.vercel.app/api/manifeste
# => 404

# panneau admin: la page
curl -s https://<projet>.vercel.app/api/admin | head -1
# => <!doctype html>...

# creer un ami de test via le panneau dans le navigateur, recuperer sa cle,
# puis:
curl -s -H "x-cle: <cle-test>" https://<projet>.vercel.app/api/manifeste
# => { "version": null, ... } tant que rien n'est publie, mais 200
```

- [x] **Étape 5 : consigner l'URL et les critères**

Vérifier, un par un, les critères de réussite 4, 8, 9 du spec (révocation
individuelle, coupe-circuit, 404 sans clé). Noter l'URL du projet et le nom de
la base dans le handoff.

**Mesuré en production le 2026-08-24** (projet `exode1/paquets-maj`, base
`paquets-maj-db`) :

| critère | mesure |
|---|---|
| 404 sans clé | `/api/manifeste` et `/api/paquet` : 404, corps vide |
| 404 sur clé inconnue | 404 ; **un seul caractère modifié suffit** à faire tomber une clé valide |
| 200 sur clé valide | `{version:null, sha256:null, actif:true, message:null}` — rien n'est encore publié |
| `derniere_vue` | passe à l'horodatage de l'appel : la trace de vie fonctionne |
| révocation individuelle | « désactiver » dans le panneau → 404 à l'appel suivant ; « activer » → 200 de nouveau |
| coupe-circuit global | `service {actif:false}` → le manifeste rend `actif:false` et le message ; remis à `true` |
| mot de passe admin faux | 404 sur `/api/admin`, jamais 401/403 |
| panneau | servi à `/api/admin` (3831 o) — `includeFiles: web/**` vérifié en vrai |

**Deux défauts trouvés à l'essai, corrigés :**
1. Le bloc de messages du panneau vivait **dans** le panneau caché : un mot de
   passe refusé n'affichait rien. Et `api()` ne traitait que le 404 — le 503 du
   démarrage à froid de la fonction levait une exception avalée par un `catch`
   vide. Deux silences superposés.
2. Le champ *Value* du tableau de bord Vercel est une **zone de texte
   multiligne** : la valeur y arrive facilement avec un retour à la ligne, et la
   comparaison à temps constant échouait alors sans rien dire. Les blancs de
   bordure sont maintenant coupés des deux côtés, avec deux tests.

---

## Revue du plan

**Couverture du spec.** Table `amis` → T1/T2. Manifeste et coupe-circuit → T3.
404 sans clé sur les deux points d'entrée → T4/T5. Panneau et pilotage → T6.
Publication + SHA-256 → T7. Base, projet Vercel, protection désactivée, essais →
T8. La saisie de clé au premier lancement, l'amorceur, le stockage versionné et
le durcissement du paquet relèvent du **sous-projet B (client)**, hors de ce
plan — c'est la décomposition annoncée.

**Placeholders.** Aucun `TBD`/`TODO`. La seule dépendance non résolue est
volontaire et nommée : `publier.js` prend une archive déjà fabriquée, parce que
sa fabrication (compilation bytecode) appartient au sous-projet B. C'est une
frontière de sous-projet, pas un trou.

**Cohérence des types.** `sql` (client Neon tag) traversé partout ;
`verifierCle → {ok,nom}`, `lireManifeste → {version,sha256,actif,message}`,
`traiter* → {statut,corps}` cohérents entre tâches. En-têtes : `x-cle` pour les
amis, `x-admin` pour l'admin, stables de T4 à T6.

**Sécurité, vérifiée dans le plan :** requêtes SQL toujours paramétrées (jamais
de concaténation), mot de passe admin comparé à temps constant, 404 systématique
plutôt que 401/403 pour ne pas révéler l'existence des ressources, secrets en
variables d'environnement jamais commitées.
