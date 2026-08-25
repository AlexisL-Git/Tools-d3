# Publication depuis le panneau — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publier une version d'OMNI depuis le panneau admin, sans redéploiement Vercel et sans jamais saisir de sha256.

**Architecture :** Une table `versions` en base porte les octets de chaque archive de code (82 Ko mesurés). Le panneau téléverse l'archive en base64 ; le serveur calcule lui-même l'empreinte et la range. Activer une version recopie `version` et `sha256` **depuis la ligne stockée** vers `config`, qui reste le pointeur lu par `/api/manifeste`. `/api/paquet` sert les octets depuis la base, avec un repli disque temporaire le temps de la migration.

**Tech Stack :** Node 18+, `@neondatabase/serverless` (interpolation tag, jamais de concaténation), `node:test` + `node:assert`, fonctions Vercel, HTML/JS sans dépendance.

**Spec :** `docs/superpowers/specs/2026-08-25-publication-panneau-design.md`

## Global Constraints

- **Aucune modification du client.** `/api/manifeste` doit rendre exactement la même forme qu'aujourd'hui : `{ version, sha256, actif, message }`. L'amorceur installé chez les amis ne change pas.
- **Toute requête SQL passe par l'interpolation tag de Neon** (` sql`...${valeur}...` `). Jamais de concaténation — c'est ce qui empêche l'injection.
- **Toute action admin est gardée par le mot de passe** et rend **404** (pas 401, pas 403) quand il est absent ou faux. Chaque action ajoutée se teste sur ce point.
- **Le panneau n'utilise jamais `innerHTML`** (les valeurs viennent de la base) ni de dialogue natif (`alert`/`confirm`/`prompt` bloquent la page et toute automatisation). Tous les messages passent par `#avis`.
- **L'empreinte n'est jamais saisie ni transportée depuis le client.** Elle est calculée par le serveur sur les octets reçus. C'est l'invariant du chantier.
- **Plafond d'archive : 4 Mo**, refusé explicitement au-delà (Vercel coupe à ~4,5 Mo sans message).
- Tests lancés depuis `serveur-maj/` avec `npm test` (`node --test`).
- Travailler sur la branche `docs/publication-panneau` ou une branche fille ; ne rien pousser sans demande.

## File Structure

| Fichier | Responsabilité |
|---|---|
| `serveur-maj/lib/versions.js` *(créer)* | Toute la logique des versions : validation, empreinte, insertion, liste, lecture, activation. Aucun HTTP. |
| `serveur-maj/test/versions.test.js` *(créer)* | Tests de la logique ci-dessus, `sql` factice. |
| `serveur-maj/lib/db.js` *(modifier)* | Ajout de la table `versions` au schéma idempotent. |
| `serveur-maj/api/admin.js` *(modifier)* | Trois actions : `versions`, `televerser`, `activer`. Traduction `{erreur}` → 400. |
| `serveur-maj/test/api-admin.test.js` *(modifier)* | Les trois actions, garde 404 comprise. |
| `serveur-maj/api/paquet.js` *(modifier)* | Sert les octets depuis la base ; repli disque temporaire. |
| `serveur-maj/test/api-paquet.test.js` *(modifier)* | Adapté à `lireArchive` asynchrone. |
| `serveur-maj/web/admin.html` *(modifier)* | Bloc « Publier une version » : fichier + tableau des versions. |
| `serveur-maj/vercel.json` *(modifier, tâche 6)* | Retrait de `includeFiles: "paquets/**"`. |

---

### Task 1: `lib/versions.js` — la logique, et rien d'autre

**Files:**
- Create: `serveur-maj/lib/versions.js`
- Create: `serveur-maj/test/versions.test.js`
- Modify: `serveur-maj/lib/db.js` (fonction `appliquerSchema`)

**Interfaces:**
- Consumes: `ecrireManifeste(sql, { version, sha256 })` de `lib/manifeste.js` (existant).
- Produces :
  - `enregistrerVersion(sql, { version, archive }) → Promise<{version, sha256, taille, deja} | {erreur}>` — `archive` est un `Buffer`.
  - `listerVersions(sql) → Promise<Array<{version, sha256, taille, publiee_le}>>`
  - `lireArchive(sql, version) → Promise<Buffer|null>`
  - `activerVersion(sql, version) → Promise<{ok, version, sha256} | {erreur}>`
  - `PLAFOND` (nombre d'octets, 4 194 304).

Le contrat de retour est uniforme : **un objet portant `erreur` est un refus**, tout autre objet est un succès. `api/admin.js` n'a plus qu'à traduire en 400.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `serveur-maj/test/versions.test.js`. Le `fauxSql` reprend le motif exact des tests existants : il rend les réponses **dans l'ordre des appels**, sans regarder la requête.

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  enregistrerVersion, listerVersions, lireArchive, activerVersion, PLAFOND,
} = require('../lib/versions');

// Rend les reponses dans l'ordre des appels: le faux sql ne lit pas la requete.
function fauxSql(reponses = []) {
  const appels = [];
  const sql = (c, ...v) => { appels.push(v); return Promise.resolve(reponses.length ? reponses.shift() : []); };
  sql.appels = appels;
  return sql;
}

// Un gzip minimal valide commence par 1f 8b. Le reste n'a pas besoin d'etre
// decompressable: on ne verifie que la plausibilite, jamais le contenu.
function gz(charge = 'x') {
  return Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from(charge)]);
}

test('version mal formee, refus', async () => {
  const r = await enregistrerVersion(fauxSql(), { version: 'zero-deux', archive: gz() });
  assert.strictEqual(r.erreur, 'version attendue au format x.y.z');
});

test('version absente, refus', async () => {
  const r = await enregistrerVersion(fauxSql(), { version: undefined, archive: gz() });
  assert.strictEqual(r.erreur, 'version attendue au format x.y.z');
});

test('archive vide, refus', async () => {
  const r = await enregistrerVersion(fauxSql(), { version: '0.2.3', archive: Buffer.alloc(0) });
  assert.strictEqual(r.erreur, 'archive vide');
});

test('archive absente, refus', async () => {
  const r = await enregistrerVersion(fauxSql(), { version: '0.2.3', archive: null });
  assert.strictEqual(r.erreur, 'archive vide');
});

test('au-dela du plafond, refus qui dit la taille', async () => {
  const trop = Buffer.alloc(PLAFOND + 1);
  trop[0] = 0x1f; trop[1] = 0x8b;
  const r = await enregistrerVersion(fauxSql(), { version: '0.2.3', archive: trop });
  assert.match(r.erreur, /^archive trop grosse \(4\.0 Mo, plafond 4\)$/);
});

test('ce n est pas un gzip, refus', async () => {
  const r = await enregistrerVersion(fauxSql(), { version: '0.2.3', archive: Buffer.from('PKzip') });
  assert.strictEqual(r.erreur, "ce fichier n'est pas un .tar.gz");
});

test('archive valide: le sha256 est calcule par nous, jamais recu', async () => {
  const archive = gz('contenu');
  const attendu = crypto.createHash('sha256').update(archive).digest('hex');
  const sql = fauxSql([[]]);            // aucune ligne existante
  const r = await enregistrerVersion(sql, { version: '0.2.3', archive });
  assert.strictEqual(r.sha256, attendu);
  assert.strictEqual(r.version, '0.2.3');
  assert.strictEqual(r.taille, archive.length);
  assert.strictEqual(r.deja, false);
});

test('meme version, memes octets: accepte sans reinserer', async () => {
  const archive = gz('contenu');
  const sha = crypto.createHash('sha256').update(archive).digest('hex');
  const sql = fauxSql([[{ sha256: sha }]]);
  const r = await enregistrerVersion(sql, { version: '0.2.3', archive });
  assert.strictEqual(r.deja, true);
  assert.strictEqual(r.sha256, sha);
  assert.strictEqual(sql.appels.length, 1, 'aucune insertion ne doit suivre le SELECT');
});

// Republier un contenu different sous un numero deja distribue est ce qui
// casse un parc en silence: les clients qui l'ont deja ne retelechargent pas.
test('meme version, octets differents: refus', async () => {
  const sql = fauxSql([[{ sha256: 'a'.repeat(64) }]]);
  const r = await enregistrerVersion(sql, { version: '0.2.3', archive: gz('autre') });
  assert.strictEqual(r.erreur, '0.2.3 existe deja avec une autre empreinte');
});

test('listerVersions rend les lignes de la base', async () => {
  const lignes = [{ version: '0.2.3', sha256: 'a', taille: 82, publiee_le: 'hier' }];
  assert.deepStrictEqual(await listerVersions(fauxSql([lignes])), lignes);
});

test('lireArchive rend les octets, ou null', async () => {
  const octets = gz('z');
  assert.deepStrictEqual(await lireArchive(fauxSql([[{ archive: octets }]]), '0.2.3'), octets);
  assert.strictEqual(await lireArchive(fauxSql([[]]), '9.9.9'), null);
});

test('activer une version inconnue, refus', async () => {
  const r = await activerVersion(fauxSql([[]]), '9.9.9');
  assert.strictEqual(r.erreur, 'version inconnue — televerse-la d abord');
});

// L'INVARIANT du chantier: l'empreinte ecrite dans config est celle de la
// ligne stockee, jamais une valeur fournie de l'exterieur.
test('activer recopie l empreinte depuis la ligne stockee', async () => {
  const archive = gz('contenu');
  const sha = crypto.createHash('sha256').update(archive).digest('hex');
  const sql = fauxSql([[{ version: '0.2.3', sha256: sha }], []]);
  const r = await activerVersion(sql, '0.2.3');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sha256, sha);
  // Le 2e appel est l'UPDATE de config. Ordre des valeurs impose par
  // ecrireManifeste: `SET version = ${version}, sha256 = ${sha256}`.
  assert.deepStrictEqual(sql.appels[1], ['0.2.3', sha]);
});
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `cd serveur-maj && node --test test/versions.test.js`
Expected: FAIL — `Cannot find module '../lib/versions'`

- [ ] **Step 3: Écrire `lib/versions.js`**

```js
'use strict';
const crypto = require('node:crypto');
const { ecrireManifeste } = require('./manifeste');

// Vercel coupe un corps de requete a ~4,5 Mo sans un mot. On refuse avant,
// avec un message, pour que la panne soit lisible le jour ou l'archive grossit.
const PLAFOND = 4 * 1024 * 1024;

function empreinte(octets) {
  return crypto.createHash('sha256').update(octets).digest('hex');
}

async function enregistrerVersion(sql, { version, archive }) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ''))) {
    return { erreur: 'version attendue au format x.y.z' };
  }
  if (!archive || archive.length === 0) return { erreur: 'archive vide' };
  if (archive.length > PLAFOND) {
    const mo = (archive.length / (1024 * 1024)).toFixed(1);
    return { erreur: `archive trop grosse (${mo} Mo, plafond 4)` };
  }
  // Deux octets: ca ne prouve pas que l'archive est bonne, seulement qu'elle
  // est plausible. La vraie preuve reste le sha256 verifie chez l'ami. Mais
  // ca attrape l'erreur la plus probable: avoir depose le mauvais fichier.
  if (archive[0] !== 0x1f || archive[1] !== 0x8b) {
    return { erreur: "ce fichier n'est pas un .tar.gz" };
  }
  const sha256 = empreinte(archive);
  const existantes = await sql`SELECT sha256 FROM versions WHERE version = ${version}`;
  if (existantes.length) {
    if (existantes[0].sha256 !== sha256) {
      return { erreur: `${version} existe deja avec une autre empreinte` };
    }
    return { version, sha256, taille: archive.length, deja: true };
  }
  await sql`INSERT INTO versions (version, sha256, archive, taille)
            VALUES (${version}, ${sha256}, ${archive}, ${archive.length})`;
  return { version, sha256, taille: archive.length, deja: false };
}

async function listerVersions(sql) {
  return sql`SELECT version, sha256, taille, publiee_le FROM versions ORDER BY publiee_le DESC`;
}

async function lireArchive(sql, version) {
  const lignes = await sql`SELECT archive FROM versions WHERE version = ${version}`;
  return lignes.length ? lignes[0].archive : null;
}

async function activerVersion(sql, version) {
  const lignes = await sql`SELECT version, sha256 FROM versions WHERE version = ${version}`;
  if (!lignes.length) return { erreur: 'version inconnue — televerse-la d abord' };
  // L'empreinte vient de la ligne stockee. Aucune valeur exterieure n'entre ici.
  await ecrireManifeste(sql, { version: lignes[0].version, sha256: lignes[0].sha256 });
  return { ok: true, version: lignes[0].version, sha256: lignes[0].sha256 };
}

module.exports = { enregistrerVersion, listerVersions, lireArchive, activerVersion, PLAFOND };
```

- [ ] **Step 4: Ajouter la table au schéma**

Dans `serveur-maj/lib/db.js`, à la fin de `appliquerSchema`, avant le `INSERT INTO config` :

```js
  // Les octets de chaque archive de code (82 Ko mesures). C'est ce qui permet
  // de publier sans redeployer: /api/paquet lit ici, plus sur le disque.
  await sql`CREATE TABLE IF NOT EXISTS versions (
    version    TEXT PRIMARY KEY,
    sha256     TEXT NOT NULL,
    archive    BYTEA NOT NULL,
    taille     INTEGER NOT NULL,
    publiee_le TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
```

- [ ] **Step 5: Lancer les tests, vérifier qu'ils passent**

Run: `cd serveur-maj && npm test`
Expected: PASS — les nouveaux tests verts, et **aucun test existant cassé**.

- [ ] **Step 6: Commit**

```bash
git add serveur-maj/lib/versions.js serveur-maj/test/versions.test.js serveur-maj/lib/db.js
git commit -m "feat(serveur-maj): table versions et logique de publication

L'empreinte est calculee sur les octets recus, jamais fournie.
Refus explicites: format, taille, magie gzip, republication d'un
contenu different sous un numero deja distribue."
```

---

### Task 2: Les trois actions du panneau côté serveur

**Files:**
- Modify: `serveur-maj/api/admin.js` (fonction `traiterAdmin`, le `switch`)
- Modify: `serveur-maj/test/api-admin.test.js`

**Interfaces:**
- Consumes: `enregistrerVersion`, `listerVersions`, `activerVersion` de la tâche 1.
- Produces : trois actions HTTP consommées par la tâche 4 —
  - `versions` → `200` + `[{version, sha256, taille, publiee_le}]`
  - `televerser` `{version, archive}` (archive en **base64**) → `200` + `{version, sha256, taille, deja}` ou `400` + `{erreur}`
  - `activer` `{version}` → `200` + `{ok, version, sha256}` ou `400` + `{erreur}`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `serveur-maj/test/api-admin.test.js` (le fichier a déjà `fauxSql` et `SECRET` en haut ; ajouter l'import de `crypto` en tête s'il manque) :

```js
const crypto = require('node:crypto');

function gzB64(charge = 'x') {
  return Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from(charge)]).toString('base64');
}

// La garde: chaque action ajoutee doit rendre 404 sans mot de passe, sinon on
// a ouvert une porte derriere celle qu'on croyait fermer.
test('les actions de version sont refusees sans mot de passe', async () => {
  for (const action of ['versions', 'televerser', 'activer']) {
    const r = await traiterAdmin({
      motDePasse: undefined, action, corps: { version: '0.2.3', archive: gzB64() },
      sql: fauxSql([]), motDePasseAttendu: SECRET,
    });
    assert.strictEqual(r.statut, 404, action + ' doit rendre 404');
  }
});

test('versions rend la liste', async () => {
  const lignes = [{ version: '0.2.3', sha256: 'a', taille: 82, publiee_le: 'hier' }];
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'versions', sql: fauxSql([lignes]), motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, lignes);
});

test('televerser decode le base64 et rend l empreinte calculee', async () => {
  const archive = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from('contenu')]);
  const attendu = crypto.createHash('sha256').update(archive).digest('hex');
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'televerser',
    corps: { version: '0.2.3', archive: archive.toString('base64') },
    sql: fauxSql([[]]), motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 200);
  assert.strictEqual(r.corps.sha256, attendu);
});

test('televerser sans archive, 400 avec le message', async () => {
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'televerser', corps: { version: '0.2.3' },
    sql: fauxSql([]), motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 400);
  assert.strictEqual(r.corps.erreur, 'archive vide');
});

test('activer une version connue bascule le manifeste', async () => {
  const sql = fauxSql([[{ version: '0.2.3', sha256: 'b'.repeat(64) }], []]);
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'activer', corps: { version: '0.2.3' },
    sql, motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 200);
  assert.strictEqual(r.corps.sha256, 'b'.repeat(64));
});

test('activer une version inconnue, 400', async () => {
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'activer', corps: { version: '9.9.9' },
    sql: fauxSql([[]]), motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 400);
});
```

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `cd serveur-maj && node --test test/api-admin.test.js`
Expected: FAIL — `action inconnue`, donc 400 là où 200 est attendu (et 400 au lieu de 404 sur le test de garde).

- [ ] **Step 3: Ajouter les trois `case` dans `api/admin.js`**

En tête du fichier, à côté des autres `require` :

```js
const { enregistrerVersion, listerVersions, activerVersion } = require('../lib/versions');
```

Dans le `switch` de `traiterAdmin`, avant le `default` :

```js
    case 'versions':
      return { statut: 200, corps: await listerVersions(sql) };
    case 'televerser': {
      // Les octets arrivent en base64 dans le JSON: un seul chemin de requete
      // dans le panneau, et 82 Ko qui en font 110 — negligeable.
      const archive = corps.archive ? Buffer.from(String(corps.archive), 'base64') : null;
      const r = await enregistrerVersion(sql, { version: corps.version, archive });
      return r.erreur ? { statut: 400, corps: { erreur: r.erreur } } : { statut: 200, corps: r };
    }
    case 'activer': {
      const r = await activerVersion(sql, String(corps.version || ''));
      return r.erreur ? { statut: 400, corps: { erreur: r.erreur } } : { statut: 200, corps: r };
    }
```

- [ ] **Step 4: Lancer toute la suite**

Run: `cd serveur-maj && npm test`
Expected: PASS — tout vert, y compris l'ancienne action `publier` qu'on ne touche pas encore.

- [ ] **Step 5: Commit**

```bash
git add serveur-maj/api/admin.js serveur-maj/test/api-admin.test.js
git commit -m "feat(serveur-maj): actions versions, televerser et activer

Chacune gardee par le mot de passe et testee sur le 404."
```

---

### Task 3: `/api/paquet` sert depuis la base, avec repli disque

**Files:**
- Modify: `serveur-maj/api/paquet.js`
- Modify: `serveur-maj/test/api-paquet.test.js`

**Interfaces:**
- Consumes: `lireArchive(sql, version)` de la tâche 1.
- Produces : `traiterPaquet({ cle, sql, lireArchive })` — le paramètre injecté s'appelle désormais `lireArchive` (au lieu de `lireFichier`) et **peut être asynchrone**. Contrat HTTP inchangé : `200` + `application/gzip`, ou `404`.

- [ ] **Step 1: Adapter les tests existants et en ajouter un**

Remplacer intégralement `serveur-maj/test/api-paquet.test.js` par :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { traiterPaquet } = require('../api/paquet');

function fauxSql(reponses) {
  const sql = (c, ...v) => Promise.resolve(reponses.length ? reponses.shift() : []);
  return sql;
}

test('sans cle valide, 404 et l archive n est jamais lue', async () => {
  let lu = false;
  const r = await traiterPaquet({ cle: 'zzz', sql: fauxSql([[]]), lireArchive: async () => { lu = true; } });
  assert.strictEqual(r.statut, 404);
  assert.strictEqual(lu, false);
});

test('cle valide, l archive de la version courante est servie', async () => {
  const sql = fauxSql([[{ nom: 'K' }], [], [{ version: '0.2.0', sha256: 'abc', actif: true, message: null }]]);
  const r = await traiterPaquet({ cle: 'ok', sql, lireArchive: async (v) => Buffer.from(`archive-${v}`) });
  assert.strictEqual(r.statut, 200);
  assert.strictEqual(r.corps.toString(), 'archive-0.2.0');
  assert.strictEqual(r.type, 'application/gzip');
});

// Version annoncee mais archive introuvable: 404, pas 500. Ne pas exposer une
// erreur serveur pour une incoherence de publication.
test('archive absente (exception), 404', async () => {
  const sql = fauxSql([[{ nom: 'K' }], [], [{ version: '9.9.9', sha256: 'x', actif: true, message: null }]]);
  const r = await traiterPaquet({ cle: 'ok', sql, lireArchive: async () => { throw new Error('ENOENT'); } });
  assert.strictEqual(r.statut, 404);
});

// La base rend null quand la ligne n'existe pas: ce n'est pas une exception,
// et ca doit quand meme faire 404 plutot que servir un corps vide.
test('archive absente (null), 404', async () => {
  const sql = fauxSql([[{ nom: 'K' }], [], [{ version: '9.9.9', sha256: 'x', actif: true, message: null }]]);
  const r = await traiterPaquet({ cle: 'ok', sql, lireArchive: async () => null });
  assert.strictEqual(r.statut, 404);
});

test('aucune version publiee, 404', async () => {
  const sql = fauxSql([[{ nom: 'K' }], [], [{ version: null, sha256: null, actif: true, message: null }]]);
  const r = await traiterPaquet({ cle: 'ok', sql, lireArchive: async () => Buffer.from('x') });
  assert.strictEqual(r.statut, 404);
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd serveur-maj && node --test test/api-paquet.test.js`
Expected: FAIL — `traiterPaquet` appelle encore `lireFichier`, qui est maintenant `undefined` : les tests « servie » et « null » échouent.

- [ ] **Step 3: Réécrire `api/paquet.js`**

```js
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { creerClient, appliquerSchema } = require('../lib/db');
const { verifierCle } = require('../lib/amis');
const { lireManifeste } = require('../lib/manifeste');
const { lireArchive: lireArchiveEnBase } = require('../lib/versions');

async function traiterPaquet({ cle, sql, lireArchive }) {
  if (!cle) return { statut: 404, corps: null };
  const v = await verifierCle(sql, cle);
  if (!v.ok) return { statut: 404, corps: null };
  const manifeste = await lireManifeste(sql);
  if (!manifeste.version) return { statut: 404, corps: null };
  try {
    const corps = await lireArchive(manifeste.version);
    if (!corps) return { statut: 404, corps: null };
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
    const lireArchive = async (version) => {
      const octets = await lireArchiveEnBase(sql, version);
      if (octets) return octets;
      // REPLI TEMPORAIRE — le temps que 0.2.2 et 0.2.3 soient televersees.
      // Retire par la tache 6 du plan, avec includeFiles et le dossier paquets/.
      return fs.readFileSync(path.join(__dirname, '..', 'paquets', `${version}.tar.gz`));
    };
    const { statut, corps, type } = await traiterPaquet({ cle, sql, lireArchive });
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

- [ ] **Step 4: Lancer toute la suite**

Run: `cd serveur-maj && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add serveur-maj/api/paquet.js serveur-maj/test/api-paquet.test.js
git commit -m "feat(serveur-maj): /api/paquet lit les octets en base

Repli disque temporaire pour couvrir la fenetre entre le deploiement
et le televersement des versions existantes (retire en tache 6)."
```

---

### Task 4: Le bloc « Publier » du panneau

**Files:**
- Modify: `serveur-maj/web/admin.html`

**Interfaces:**
- Consumes: les actions `versions`, `televerser`, `activer` de la tâche 2, via le helper `api(action, corps)` déjà présent dans le fichier.
- Produces: rien pour les tâches suivantes (feuille de l'arbre).

Ce fichier n'a pas de tests automatisés aujourd'hui ; il se vérifie à l'œil, à l'étape 5. Les trois contraintes du fichier restent : pas d'`innerHTML`, pas de dialogue natif, messages dans `#avis`.

- [ ] **Step 1: Remplacer le balisage du bloc**

Remplacer le bloc existant :

```html
  <div class="bloc">
    <h2>Publier une version</h2>
    <input id="pubversion" placeholder="version (ex: 0.2.0)">
    <input id="pubsha" placeholder="sha256 de l'archive" size="70">
    <button id="b-publier">publier</button>
    <div id="manifeste"></div>
  </div>
```

par :

```html
  <div class="bloc">
    <h2>Publier une version</h2>
    <p class="aide">Depose l'archive de code produite par la fabrication (code-x.y.z.tar.gz). L'empreinte est calculee par le serveur — tu n'as rien a recopier. Televerser ne change rien pour les amis : c'est <em>activer</em> qui bascule le manifeste.</p>
    <input id="pubfichier" type="file" accept=".gz,.tgz,application/gzip">
    <input id="pubversion" placeholder="version (ex: 0.2.3)" size="12">
    <button id="b-televerser">televerser</button>
    <table id="versions"></table>
  </div>
```

- [ ] **Step 2: Remplacer la fonction `publier()` par la nouvelle logique**

Supprimer la fonction `publier()` et la ligne `document.getElementById('b-publier').onclick = publier;`, puis ajouter :

```js
  // Le nom de fichier porte deja le numero: on le pre-remplit, sans l'imposer.
  function versionDepuisNom(nom) {
    const m = /(\d+\.\d+\.\d+)/.exec(nom || '');
    return m ? m[1] : '';
  }

  function lireEnBase64(fichier) {
    return new Promise((resolve, reject) => {
      const l = new FileReader();
      // readAsDataURL rend "data:<type>;base64,XXXX": on ne garde que la charge.
      l.onload = () => resolve(String(l.result).split(',')[1] || '');
      l.onerror = () => reject(new Error('lecture du fichier impossible'));
      l.readAsDataURL(fichier);
    });
  }

  function taille(octets) {
    return octets >= 1024 * 1024
      ? (octets / (1024 * 1024)).toFixed(1) + ' Mo'
      : Math.round(octets / 1024) + ' Ko';
  }

  async function televerser() {
    const f = document.getElementById('pubfichier').files[0];
    const version = document.getElementById('pubversion').value.trim();
    if (!f) { avis('choisis une archive'); return; }
    if (!version) { avis('mets un numero de version'); return; }
    let archive;
    try { archive = await lireEnBase64(f); }
    catch (e) { avis(e.message); return; }
    const r = await api('televerser', { version, archive });
    avis(r.deja
      ? (version + ' etait deja en base, octets identiques')
      : (version + ' televersee — empreinte ' + r.sha256.slice(0, 8) + '…, ' + taille(r.taille)));
    rafraichirVersions();
  }

  async function activer(version) {
    const r = await api('activer', { version });
    avis('manifeste bascule sur ' + r.version);
    rafraichirVersions();
  }

  async function rafraichirVersions() {
    const [liste, manifeste] = [await api('versions'), await api('lister-manifeste')];
    const t = document.getElementById('versions');
    t.textContent = '';
    const entete = document.createElement('tr');
    for (const titre of ['version', 'taille', 'publiee le', 'empreinte', '']) {
      const th = document.createElement('th');
      th.textContent = titre;
      entete.append(th);
    }
    t.append(entete);
    for (const v of liste) {
      const tr = document.createElement('tr');
      tr.append(
        cellule(v.version),
        cellule(taille(v.taille)),
        cellule(String(v.publiee_le).replace('T', ' ').slice(0, 16)),
        cellule(v.sha256.slice(0, 8) + '…', 'cle'),
      );
      const td = document.createElement('td');
      if (v.version === manifeste.version) {
        td.textContent = '● courante';
      } else {
        const b = document.createElement('button');
        b.textContent = 'activer';
        b.onclick = () => activer(v.version);
        td.append(b);
      }
      tr.append(td);
      t.append(tr);
    }
  }

  document.getElementById('b-televerser').onclick = televerser;
  document.getElementById('pubfichier').addEventListener('change', (e) => {
    const champ = document.getElementById('pubversion');
    if (!champ.value) champ.value = versionDepuisNom(e.target.files[0] && e.target.files[0].name);
  });
```

- [ ] **Step 3: Ajouter l'action `lister-manifeste` côté serveur**

`rafraichirVersions` a besoin de savoir quelle version est courante. Dans le `switch` de `api/admin.js`, avant le `default` :

```js
    case 'lister-manifeste':
      return { statut: 200, corps: await lireManifeste(sql) };
```

et compléter l'import existant en tête de `api/admin.js` :

```js
const { basculerService, ecrireManifeste, ecrireUrlPaquet, lireUrlPaquet, lireManifeste } = require('../lib/manifeste');
```

Ajouter son test dans `serveur-maj/test/api-admin.test.js` :

```js
test('lister-manifeste rend le manifeste courant, et 404 sans mot de passe', async () => {
  const m = { version: '0.2.3', sha256: 'c'.repeat(64), actif: true, message: null };
  const ok = await traiterAdmin({ motDePasse: SECRET, action: 'lister-manifeste', sql: fauxSql([[m]]), motDePasseAttendu: SECRET });
  assert.strictEqual(ok.statut, 200);
  assert.deepStrictEqual(ok.corps, m);
  const ko = await traiterAdmin({ motDePasse: undefined, action: 'lister-manifeste', sql: fauxSql([]), motDePasseAttendu: SECRET });
  assert.strictEqual(ko.statut, 404);
});
```

- [ ] **Step 4: Appeler `rafraichirVersions` à la connexion**

Dans la fonction `rafraichir()`, après le remplissage du tableau des amis, ajouter en dernière ligne :

```js
    await rafraichirVersions();
```

- [ ] **Step 5: Vérifier à la main, en local**

Run: `cd serveur-maj && npm test` → PASS.

Puis ouvrir le panneau servi en local (jamais `file://` — l'extension et `fetch` ne fonctionnent pas ainsi) et vérifier de visu :
1. le champ version se pré-remplit en choisissant `paquets/0.2.3.tar.gz` ;
2. téléverser rend un message avec les 8 premiers caractères de l'empreinte ;
3. re-téléverser le même fichier affiche « octets identiques » ;
4. le tableau montre une ligne « ● courante » et des boutons « activer » sur les autres ;
5. téléverser un fichier qui n'est pas un `.tar.gz` affiche « ce fichier n'est pas un .tar.gz ».

- [ ] **Step 6: Commit**

```bash
git add serveur-maj/web/admin.html serveur-maj/api/admin.js serveur-maj/test/api-admin.test.js
git commit -m "feat(panneau): televersement de l'archive et tableau des versions

L'empreinte est affichee, jamais saisie. Le champ version se
pre-remplit depuis le nom du fichier."
```

---

### Task 5: Déployer et téléverser les versions existantes

**Files:** aucun. Tâche d'exécution et de vérification en production.

**Interfaces:**
- Consumes: tout ce qui précède, déployé.
- Produces: une base qui contient 0.2.2 et 0.2.3, condition **nécessaire** à la tâche 6.

C'est la seule tâche qui touche la production. Elle demande une confirmation de l'utilisateur avant d'être lancée.

- [ ] **Step 1: Déployer**

Run: `cd serveur-maj && npx vercel --prod`
Expected: déploiement réussi. `appliquerSchema` crée la table `versions` au premier appel.

- [ ] **Step 2: Vérifier que rien n'est cassé pour les amis**

Ouvrir le panneau, se connecter. Le tableau des versions doit être **vide** et le tableau des amis inchangé.

Vérifier que `/api/paquet` répond encore par le repli, avec une clé valide :

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" \
  -H "x-cle: <une-cle-valide>" https://paquets-maj.vercel.app/api/paquet
```

Expected: `200` et une taille non nulle — c'est le repli disque qui répond, la base étant vide.

- [ ] **Step 3: Téléverser les archives existantes**

Dans le panneau : téléverser `serveur-maj/paquets/0.2.3.tar.gz`. Si l'archive de 0.2.2 est encore disponible, la téléverser aussi ; sinon, noter qu'un retour arrière vers 0.2.2 ne sera plus possible et le dire à l'utilisateur.

Vérifier que l'empreinte affichée pour 0.2.3 commence par `82394f3f` — c'est celle notée à la fabrication.

- [ ] **Step 4: Vérifier que la base sert bien, repli non atteint**

Relancer le `curl` de l'étape 2 : même `200`, même taille. Puis activer 0.2.3 dans le panneau, et vérifier que `/api/manifeste` l'annonce :

```bash
curl -s -H "x-cle: <une-cle-valide>" https://paquets-maj.vercel.app/api/manifeste
```

Expected: `{"version":"0.2.3","sha256":"82394f3f...","actif":true,...}`

- [ ] **Step 5: Pas de commit** — aucune modification de fichier.

---

### Task 6: Retirer le pont

**Files:**
- Modify: `serveur-maj/api/paquet.js` (retrait du repli)
- Modify: `serveur-maj/vercel.json`
- Delete: `serveur-maj/publier.js`, `serveur-maj/test/publier.test.js`, `serveur-maj/paquets/`
- Modify: `serveur-maj/package.json` (script `publier`)
- Modify: `serveur-maj/api/admin.js` + `serveur-maj/test/api-admin.test.js` (retrait de l'action `publier`)

**Interfaces:**
- Consumes: la tâche 5 **doit être terminée et vérifiée**. Retirer le repli avant que les archives soient en base coupe le téléchargement pour tout le monde.
- Produces: l'état final.

Un pont qu'on laisse devient un chemin de code que plus rien n'exécute, donc que plus rien ne teste.

- [ ] **Step 1: Retirer le repli de `api/paquet.js`**

Supprimer les `require` de `node:path` et `node:fs`, et remplacer le corps de `lireArchive` dans `module.exports` par :

```js
    const lireArchive = (version) => lireArchiveEnBase(sql, version);
```

- [ ] **Step 2: Retirer `includeFiles` du `vercel.json`**

```json
    "api/paquet.js": { "maxDuration": 10 },
```

- [ ] **Step 3: Retirer l'action `publier` devenue un piège**

Elle accepte encore un sha256 saisi à la main — exactement ce que le chantier supprime. La laisser, c'est garder la porte par laquelle la panne entrait.

Dans `api/admin.js`, supprimer le `case 'publier': { ... }` entier, et `ecrireManifeste` de la ligne d'import s'il n'est plus utilisé ailleurs dans le fichier.

Dans `test/api-admin.test.js`, supprimer les tests de l'action `publier` (`publier ecrit version et sha256...`, et tout test de validation du sha256), et ajouter :

```js
test('publier n existe plus: action inconnue', async () => {
  const r = await traiterAdmin({
    motDePasse: SECRET, action: 'publier', corps: { version: '0.2.4', sha256: 'a'.repeat(64) },
    sql: fauxSql([]), motDePasseAttendu: SECRET,
  });
  assert.strictEqual(r.statut, 400);
  assert.strictEqual(r.corps.erreur, 'action inconnue');
});
```

- [ ] **Step 4: Supprimer les fichiers sans objet**

```bash
git rm -r serveur-maj/paquets serveur-maj/publier.js serveur-maj/test/publier.test.js
```

Puis retirer la ligne `"publier": "node publier.js"` du `scripts` de `serveur-maj/package.json`.

- [ ] **Step 5: Lancer toute la suite**

Run: `cd serveur-maj && npm test`
Expected: PASS. Vérifier que la suite **imprime son total** — un test qui laisse une ressource ouverte fait que `node --test` ne se termine jamais, et on croit à tort qu'il tourne encore.

- [ ] **Step 6: Commit et redéployer**

```bash
git add -A serveur-maj
git commit -m "refactor(serveur-maj): retrait du pont de migration

Le repli disque, includeFiles, paquets/, publier.js et l'action
'publier' a sha256 saisi n'ont plus d'objet: la base est la source."
```

Run: `cd serveur-maj && npx vercel --prod`

- [ ] **Step 7: Vérifier une dernière fois en production**

Rejouer le `curl` sur `/api/paquet` avec une clé valide : `200` et taille non nulle, servi **uniquement** par la base cette fois.

---

## Ce que ce plan ne fait pas

Les trois autres chantiers du panneau identifiés au cadrage, chacun mérite son spec :

- **Télémétrie** — quelle version est réellement installée chez chaque ami, plantages, retours arrière. Demande de toucher au client.
- **Gestion fine des amis** — renommer, supprimer, régénérer une clé, notes, expiration.
- **Session et journal d'accès** — le mot de passe est retapé à chaque rafraîchissement, les clés s'affichent en clair, aucune trace des actions admin.
