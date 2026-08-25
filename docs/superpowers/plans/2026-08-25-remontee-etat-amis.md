# Remontee d'etat des amis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que le service sache qui tourne sur quelle version, et qu'un refus de version chez un ami remonte au lieu de mourir dans son journal.

**Architecture :** Une requete de plus par lancement, POST `/api/etat`, portant la version reellement chargee et les refus en attente. Cote ami, une file dans `courante.json` garantit qu'un service injoignable ne fait pas perdre un refus. Cote serveur, une colonne (`amis.version_vue`) et deux tables (`refus`, `lancements`) ; le panneau affiche, un webhook Discord previent.

**Tech Stack :** Node 18+, `@neondatabase/serverless` (interpolation tag), `node:test` + `node:assert`, fonctions Vercel, HTML/JS sans dependance, Electron cote amorceur.

**Spec :** `docs/superpowers/specs/2026-08-25-remontee-etat-amis-design.md`

## Global Constraints

- **Rien ne doit jamais empecher un ami de demarrer.** Tout appel reseau ajoute a l'amorceur a un delai de **2000 ms**, ses echecs sont avales, il n'est jamais reessaye dans la foulee.
- **Garde 404 partout.** Sans cle valide, ou cle revoquee : statut **404, corps vide**. Jamais 401, jamais 403. Chaque route ajoutee se teste sur ce point.
- **`verifierCle` avant toute ecriture.** Une cle revoquee ne doit laisser aucune trace en base — ni lancement, ni refus. C'est un test d'ordre, pas seulement de statut.
- **Toute requete SQL passe par l'interpolation tag de Neon** (`` sql`... ${valeur} ...` ``). Jamais de concatenation.
- **Le panneau n'utilise jamais `innerHTML`** (les valeurs viennent de la base) ni de dialogue natif (`alert`/`confirm`/`prompt`). Tous les messages passent par `#avis`.
- **La forme de `/api/manifeste` ne change pas** : `{ version, sha256, actif, message }`. Un ami dont le paquet n'a pas ete refait doit continuer de fonctionner.
- **Plafonds cote serveur, sans confiance dans ce qui arrive** : version conforme a `^[0-9][0-9.]{0,19}$`, journal tronque a **4000** caracteres, **10** refus maximum par appel.
- Tests serveur : depuis `serveur-maj/`, `npm test`. Tests amorceur et racine : depuis la racine, `npm test` (qui descend aussi dans `serveur-maj/test/`).
- Travailler sur une branche `feat/remontee-etat` ; ne rien pousser sans demande.

## File Structure

| Fichier | Responsabilite |
|---|---|
| `serveur-maj/lib/db.js` *(modifier)* | Ajout de `amis.version_vue`, des tables `refus` et `lancements` au schema idempotent |
| `serveur-maj/lib/etat.js` *(creer)* | Toute la logique de la remontee : validation, ecriture, dedoublonnage, comptages, purge. Aucun HTTP |
| `serveur-maj/test/etat.test.js` *(creer)* | Tests de la logique ci-dessus, `sql` factice |
| `serveur-maj/lib/discord.js` *(creer)* | Un seul envoi de webhook, qui ne leve jamais |
| `serveur-maj/test/discord.test.js` *(creer)* | Sans URL aucun appel ; un `fetch` qui explose ne fait pas echouer |
| `serveur-maj/api/etat.js` *(creer)* | Route POST : garde 404, appel de la logique, ping des nouveaux refus |
| `serveur-maj/test/api-etat.test.js` *(creer)* | Garde 404, ordre `verifierCle` d'abord, ping seulement sur `nouveaux` |
| `serveur-maj/api/admin.js` *(modifier)* | Deux actions : `refus`, `lancements` |
| `serveur-maj/test/api-admin.test.js` *(modifier)* | Les deux actions, garde 404 comprise |
| `serveur-maj/web/admin.html` *(modifier)* | Colonnes version et 30 j, compteur d'adoption, bloc Refus, detail par ami |
| `amorceur/depot.js` *(modifier)* | La file `aSignaler` dans `courante.json` |
| `test/amorceur/depot.test.js` *(modifier)* | File conservee, videe, tolerance a un etat ancien |
| `amorceur/canal.js` *(modifier)* | `signaler(cle, corps)`, qui ne leve jamais |
| `test/amorceur/canal.test.js` *(modifier)* | Les trois etats de `signaler` |
| `amorceur/signalement.js` *(creer)* | Orchestration de l'envoi, sans Electron ni `fs` : testable |
| `test/amorceur/signalement.test.js` *(creer)* | File videe sur 200 seulement, journal joint uniquement s'il y a un refus |
| `amorceur/demarrage.js` *(modifier)* | Un refus detecte est range dans la file |
| `test/amorceur/demarrage.test.js` *(modifier)* | Le refus atterrit dans la file |
| `amorceur/principal.js` *(modifier)* | Lecture des dernieres lignes du journal, cablage de l'envoi |
| `README.md` *(modifier)* | Note de livraison : ce changement impose de refabriquer le paquet |

---

### Task 1: Le schema et `lib/etat.js`

**Files:**
- Modify: `serveur-maj/lib/db.js` (fonction `appliquerSchema`)
- Create: `serveur-maj/lib/etat.js`
- Create: `serveur-maj/test/etat.test.js`

**Interfaces:**
- Consumes: rien.
- Produces :
  - `enregistrerEtat(sql, { cle, version, refus }) → Promise<{ ok: true, nouveaux: string[] }>`
  - `compterLancements(sql, { jours }) → Promise<Array<{cle, n}>>`
  - `lancementsDe(sql, cle, limite) → Promise<Array<{version, au}>>`
  - `listerRefus(sql) → Promise<Array<{cle, nom, version, journal, signale_le}>>`
  - `purgerLancements(sql, jours) → Promise<number>`
  - `MAX_JOURNAL` (4000), `MAX_REFUS` (10)

`nouveaux` ne contient que les versions dont l'insertion a **reellement** eu lieu. C'est le contrat dont depend le ping Discord : sans lui, la file du client re-signalerait le meme refus a chaque lancement et Discord sonnerait a chaque fois.

- [ ] **Step 1: Ecrire les tests qui echouent**

Creer `serveur-maj/test/etat.test.js`. Le `fauxSql` reprend le motif exact des tests existants : il rend les reponses **dans l'ordre des appels**, sans regarder la requete.

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  enregistrerEtat, compterLancements, lancementsDe, listerRefus, purgerLancements,
  MAX_JOURNAL, MAX_REFUS,
} = require('../lib/etat');

// Rend les reponses dans l'ordre des appels: le faux sql ne lit pas la requete.
function fauxSql(reponses = []) {
  const appels = [];
  const sql = (c, ...v) => { appels.push(v); return Promise.resolve(reponses.length ? reponses.shift() : []); };
  sql.appels = appels;
  return sql;
}

test('un lancement sans refus: version_vue ecrite, une ligne de lancement', async () => {
  const sql = fauxSql([[], []]);
  const r = await enregistrerEtat(sql, { cle: 'CLE', version: '0.2.4', refus: [] });
  assert.deepStrictEqual(r, { ok: true, nouveaux: [] });
  assert.strictEqual(sql.appels.length, 2);
  assert.deepStrictEqual(sql.appels[0], ['0.2.4', 'CLE']);   // UPDATE amis
  assert.deepStrictEqual(sql.appels[1], ['CLE', '0.2.4']);   // INSERT lancements
});

test('version invalide: n ecrase pas version_vue, le lancement est quand meme compte', async () => {
  const sql = fauxSql([[], []]);
  const r = await enregistrerEtat(sql, { cle: 'CLE', version: 'dev; DROP TABLE amis', refus: [] });
  assert.deepStrictEqual(r, { ok: true, nouveaux: [] });
  assert.deepStrictEqual(sql.appels[0], [null, 'CLE']);
  assert.deepStrictEqual(sql.appels[1], ['CLE', null]);
});

test('un refus insere pour la premiere fois figure dans nouveaux', async () => {
  // 3e appel = INSERT refus ... RETURNING version, qui rend une ligne.
  const sql = fauxSql([[], [], [{ version: '0.2.3' }]]);
  const r = await enregistrerEtat(sql, {
    cle: 'CLE', version: '0.2.4', refus: [{ version: '0.2.3', journal: 'boum' }],
  });
  assert.deepStrictEqual(r.nouveaux, ['0.2.3']);
  assert.deepStrictEqual(sql.appels[2], ['CLE', '0.2.3', 'boum']);
});

test('le meme refus renvoye: aucune insertion, nouveaux vide', async () => {
  const sql = fauxSql([[], [], []]);   // ON CONFLICT DO NOTHING: aucune ligne rendue
  const r = await enregistrerEtat(sql, {
    cle: 'CLE', version: '0.2.4', refus: [{ version: '0.2.3', journal: 'boum' }],
  });
  assert.deepStrictEqual(r.nouveaux, []);
});

test('journal tronque au plafond', async () => {
  const sql = fauxSql([[], [], [{ version: '0.2.3' }]]);
  await enregistrerEtat(sql, {
    cle: 'CLE', version: '0.2.4', refus: [{ version: '0.2.3', journal: 'x'.repeat(MAX_JOURNAL + 500) }],
  });
  assert.strictEqual(sql.appels[2][2].length, MAX_JOURNAL);
});

test('journal absent: null, pas undefined', async () => {
  const sql = fauxSql([[], [], [{ version: '0.2.3' }]]);
  await enregistrerEtat(sql, { cle: 'CLE', version: '0.2.4', refus: [{ version: '0.2.3' }] });
  assert.strictEqual(sql.appels[2][2], null);
});

test('au-dela du plafond de refus, le surplus est ignore', async () => {
  const refus = [];
  for (let i = 0; i < MAX_REFUS + 5; i += 1) refus.push({ version: `0.1.${i}` });
  const sql = fauxSql([[], []]);
  await enregistrerEtat(sql, { cle: 'CLE', version: '0.2.4', refus });
  // 2 appels d'entete + MAX_REFUS insertions, pas une de plus.
  assert.strictEqual(sql.appels.length, 2 + MAX_REFUS);
});

test('un refus a version invalide est saute sans faire echouer les autres', async () => {
  const sql = fauxSql([[], [], [{ version: '0.2.3' }]]);
  const r = await enregistrerEtat(sql, {
    cle: 'CLE', version: '0.2.4',
    refus: [{ version: 'boum' }, { version: '0.2.3' }],
  });
  assert.deepStrictEqual(r.nouveaux, ['0.2.3']);
  assert.strictEqual(sql.appels.length, 3);
});

test('refus absent ou non tableau: traite comme vide', async () => {
  const sql = fauxSql([[], []]);
  const r = await enregistrerEtat(sql, { cle: 'CLE', version: '0.2.4', refus: 'boum' });
  assert.deepStrictEqual(r.nouveaux, []);
  assert.strictEqual(sql.appels.length, 2);
});

test('compterLancements passe le nombre de jours en parametre', async () => {
  const sql = fauxSql([[{ cle: 'CLE', n: 3 }]]);
  const r = await compterLancements(sql, { jours: 30 });
  assert.deepStrictEqual(r, [{ cle: 'CLE', n: 3 }]);
  assert.deepStrictEqual(sql.appels[0], [30]);
});

test('lancementsDe borne la limite', async () => {
  const sql = fauxSql([[]]);
  await lancementsDe(sql, 'CLE', 10000);
  assert.deepStrictEqual(sql.appels[0], ['CLE', 100]);
});

test('lancementsDe: limite absente vaut 20', async () => {
  const sql = fauxSql([[]]);
  await lancementsDe(sql, 'CLE');
  assert.deepStrictEqual(sql.appels[0], ['CLE', 20]);
});

test('listerRefus rend les lignes telles quelles', async () => {
  const ligne = { cle: 'CLE', nom: 'Jibb', version: '0.2.3', journal: null, signale_le: 'hier' };
  const sql = fauxSql([[ligne]]);
  assert.deepStrictEqual(await listerRefus(sql), [ligne]);
});

test('purgerLancements rend le nombre de lignes effacees', async () => {
  const sql = fauxSql([[{ id: 1 }, { id: 2 }]]);
  assert.strictEqual(await purgerLancements(sql, 90), 2);
  assert.deepStrictEqual(sql.appels[0], [90]);
});
```

- [ ] **Step 2: Lancer les tests pour verifier qu'ils echouent**

Depuis `serveur-maj/` : `node --test test/etat.test.js`
Attendu : ECHEC, `Cannot find module '../lib/etat'`.

- [ ] **Step 3: Ecrire `lib/etat.js`**

```js
'use strict';

// Sans confiance dans ce qui arrive: ces trois bornes s'appliquent avant
// toute requete. Un client bavard ou forge ne doit pas pouvoir remplir la
// base ni faire echouer l'appel — il est tronque, en silence, avec un 200.
const MAX_JOURNAL = 4000;
const MAX_REFUS = 10;
const FORMAT_VERSION = /^[0-9][0-9.]{0,19}$/;

function versionValide(v) {
  return typeof v === 'string' && FORMAT_VERSION.test(v);
}

async function enregistrerEtat(sql, { cle, version, refus }) {
  const v = versionValide(version) ? version : null;
  // COALESCE: une version illisible ne doit pas EFFACER la derniere version
  // connue. Ne rien savoir vaut mieux que remplacer un fait par un blanc.
  await sql`UPDATE amis SET version_vue = COALESCE(${v}, version_vue) WHERE cle = ${cle}`;
  await sql`INSERT INTO lancements (cle, version) VALUES (${cle}, ${v})`;

  const nouveaux = [];
  const liste = Array.isArray(refus) ? refus.slice(0, MAX_REFUS) : [];
  for (const r of liste) {
    if (!r || !versionValide(r.version)) continue;
    const journal = typeof r.journal === 'string' ? r.journal.slice(0, MAX_JOURNAL) : null;
    // ON CONFLICT DO NOTHING ... RETURNING: postgres arbitre le doublon en une
    // seule requete, et nous dit s'il a insere. C'est ce booleen, et lui seul,
    // qui declenchera le ping Discord — la file du client renvoie le meme
    // refus tant qu'elle n'a pas eu son 200.
    const inserees = await sql`INSERT INTO refus (cle, version, journal)
              VALUES (${cle}, ${r.version}, ${journal})
              ON CONFLICT (cle, version) DO NOTHING
              RETURNING version`;
    if (inserees.length) nouveaux.push(r.version);
  }
  return { ok: true, nouveaux };
}

async function compterLancements(sql, { jours = 30 } = {}) {
  // make_interval prend un parametre; '30 days' concatene n'en prendrait pas.
  return sql`SELECT cle, COUNT(*)::int AS n FROM lancements
             WHERE au > now() - make_interval(days => ${jours})
             GROUP BY cle`;
}

async function lancementsDe(sql, cle, limite = 20) {
  const n = Math.min(Math.max(parseInt(limite, 10) || 20, 1), 100);
  return sql`SELECT version, au FROM lancements
             WHERE cle = ${cle} ORDER BY au DESC LIMIT ${n}`;
}

async function listerRefus(sql) {
  return sql`SELECT r.cle, a.nom, r.version, r.journal, r.signale_le
             FROM refus r LEFT JOIN amis a ON a.cle = r.cle
             ORDER BY r.signale_le DESC LIMIT 50`;
}

async function purgerLancements(sql, jours = 90) {
  const lignes = await sql`DELETE FROM lancements
                           WHERE au < now() - make_interval(days => ${jours})
                           RETURNING id`;
  return lignes.length;
}

module.exports = {
  enregistrerEtat, compterLancements, lancementsDe, listerRefus, purgerLancements,
  MAX_JOURNAL, MAX_REFUS,
};
```

- [ ] **Step 4: Ajouter le schema dans `lib/db.js`**

Dans `appliquerSchema`, apres le bloc `CREATE TABLE IF NOT EXISTS versions (...)` et **avant** le `INSERT INTO config` final :

```js
  // La derniere version vue par chaque ami. Denormalisation volontaire: le
  // tableau du panneau doit rester une seule requete, sans DISTINCT ON.
  await sql`ALTER TABLE amis ADD COLUMN IF NOT EXISTS version_vue TEXT`;
  // Un refus = une version qu'un ami a ecartee parce qu'elle n'a pas demarre
  // chez lui. La cle primaire (cle, version) fait le dedoublonnage: la file
  // du client renvoie le meme refus tant qu'elle n'a pas eu son 200.
  await sql`CREATE TABLE IF NOT EXISTS refus (
    cle        TEXT NOT NULL,
    version    TEXT,
    journal    TEXT,
    signale_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (cle, version)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS lancements (
    id      BIGSERIAL PRIMARY KEY,
    cle     TEXT NOT NULL,
    version TEXT,
    au      TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS lancements_cle_au ON lancements (cle, au DESC)`;
```

Note : `refus.version` est declaree `TEXT` sans `NOT NULL` parce qu'elle est deja dans la cle primaire, qui l'impose — le declarer deux fois n'apporte rien et postgres refuserait un `NULL` de toute facon.

- [ ] **Step 5: Lancer les tests pour verifier qu'ils passent**

Depuis `serveur-maj/` : `node --test test/etat.test.js`
Attendu : PASS, 14 tests.

- [ ] **Step 6: Commit**

```bash
git add serveur-maj/lib/etat.js serveur-maj/lib/db.js serveur-maj/test/etat.test.js
git commit -m "feat(serveur-maj): logique de la remontee d etat des amis"
```

---

### Task 2: `lib/discord.js`

**Files:**
- Create: `serveur-maj/lib/discord.js`
- Create: `serveur-maj/test/discord.test.js`

**Interfaces:**
- Consumes: rien.
- Produces : `prevenir(texte, { url, chercher }) → Promise<{envoye: boolean, raison?: string}>`. `url` vaut `process.env.DISCORD_WEBHOOK` par defaut, `chercher` vaut `globalThis.fetch`.

- [ ] **Step 1: Ecrire les tests qui echouent**

Creer `serveur-maj/test/discord.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { prevenir } = require('../lib/discord');

function fauxFetch(reponses) {
  const appels = [];
  const f = async (url, options) => {
    appels.push({ url, corps: JSON.parse(options.body) });
    const r = reponses.shift();
    if (r instanceof Error) throw r;
    return { ok: r.statut >= 200 && r.statut < 300, status: r.statut };
  };
  f.appels = appels;
  return f;
}

test('sans URL de webhook, aucun appel et aucune erreur', async () => {
  const chercher = fauxFetch([]);
  const r = await prevenir('coucou', { url: '', chercher });
  assert.strictEqual(r.envoye, false);
  assert.strictEqual(chercher.appels.length, 0);
});

test('avec URL, le texte part dans content', async () => {
  const chercher = fauxFetch([{ statut: 204 }]);
  const r = await prevenir('coucou', { url: 'https://discord.invalid/x', chercher });
  assert.strictEqual(r.envoye, true);
  assert.strictEqual(chercher.appels[0].url, 'https://discord.invalid/x');
  assert.strictEqual(chercher.appels[0].corps.content, 'coucou');
});

test('un webhook qui rend 500 ne leve pas', async () => {
  const chercher = fauxFetch([{ statut: 500 }]);
  const r = await prevenir('coucou', { url: 'https://discord.invalid/x', chercher });
  assert.strictEqual(r.envoye, false);
  assert.match(r.raison, /500/);
});

test('un fetch qui explose ne leve pas', async () => {
  const chercher = fauxFetch([new Error('reseau mort')]);
  const r = await prevenir('coucou', { url: 'https://discord.invalid/x', chercher });
  assert.strictEqual(r.envoye, false);
  assert.strictEqual(r.raison, 'injoignable');
});
```

- [ ] **Step 2: Lancer les tests pour verifier qu'ils echouent**

Depuis `serveur-maj/` : `node --test test/discord.test.js`
Attendu : ECHEC, `Cannot find module '../lib/discord'`.

- [ ] **Step 3: Ecrire `lib/discord.js`**

```js
'use strict';

const DELAI_MS = 2000;

// Ne leve JAMAIS. Ce webhook est un confort pour l'administrateur; le
// lancement d'un ami ne doit pas dependre de la sante de Discord.
async function prevenir(texte, { url = process.env.DISCORD_WEBHOOK, chercher = globalThis.fetch } = {}) {
  if (!url) return { envoye: false, raison: 'sans webhook' };
  try {
    const r = await chercher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: texte }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!r.ok) {
      console.error('[discord] statut', r.status);
      return { envoye: false, raison: 'statut ' + r.status };
    }
    return { envoye: true };
  } catch (e) {
    console.error('[discord]', e && e.message ? e.message : e);
    return { envoye: false, raison: 'injoignable' };
  }
}

module.exports = { prevenir, DELAI_MS };
```

- [ ] **Step 4: Lancer les tests pour verifier qu'ils passent**

Depuis `serveur-maj/` : `node --test test/discord.test.js`
Attendu : PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add serveur-maj/lib/discord.js serveur-maj/test/discord.test.js
git commit -m "feat(serveur-maj): webhook Discord, qui ne leve jamais"
```

---

### Task 3: La route `/api/etat`

**Files:**
- Create: `serveur-maj/api/etat.js`
- Create: `serveur-maj/test/api-etat.test.js`

**Interfaces:**
- Consumes: `enregistrerEtat` (Task 1), `prevenir` (Task 2), `verifierCle(sql, cle) → Promise<{ok, nom?}>` (existant, `lib/amis.js`).
- Produces : `module.exports.traiterEtat({ cle, corps, sql, prevenirFn }) → Promise<{statut, corps}>`.

`prevenirFn` est injectable pour les tests ; par defaut c'est `prevenir`.

- [ ] **Step 1: Ecrire les tests qui echouent**

Creer `serveur-maj/test/api-etat.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { traiterEtat } = require('../api/etat');

function fauxSql(reponses = []) {
  const appels = [];
  const sql = (c, ...v) => { appels.push(v); return Promise.resolve(reponses.length ? reponses.shift() : []); };
  sql.appels = appels;
  return sql;
}

function fauxPrevenir() {
  const envoyes = [];
  const f = async (texte) => { envoyes.push(texte); return { envoye: true }; };
  f.envoyes = envoyes;
  return f;
}

test('sans cle: 404 corps vide', async () => {
  const sql = fauxSql();
  const r = await traiterEtat({ cle: undefined, corps: {}, sql, prevenirFn: fauxPrevenir() });
  assert.strictEqual(r.statut, 404);
  assert.strictEqual(r.corps, null);
  assert.strictEqual(sql.appels.length, 0);
});

test('cle inconnue: 404 et AUCUNE ecriture', async () => {
  // 1er appel = SELECT de verifierCle, qui ne rend aucune ligne.
  const sql = fauxSql([[]]);
  const r = await traiterEtat({ cle: 'INCONNUE', corps: { version: '0.2.4' }, sql, prevenirFn: fauxPrevenir() });
  assert.strictEqual(r.statut, 404);
  // Une seule requete au total: la verification. Ni lancement, ni refus.
  assert.strictEqual(sql.appels.length, 1);
});

test('cle valide: 200, lancement enregistre', async () => {
  // SELECT verifierCle, UPDATE derniere_vue, UPDATE version_vue, INSERT lancements
  const sql = fauxSql([[{ nom: 'Jibb' }], [], [], []]);
  const r = await traiterEtat({ cle: 'CLE', corps: { version: '0.2.4' }, sql, prevenirFn: fauxPrevenir() });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, { ok: true });
});

test('un refus neuf declenche un ping nomme', async () => {
  const prevenirFn = fauxPrevenir();
  const sql = fauxSql([[{ nom: 'Jibb' }], [], [], [], [{ version: '0.2.3' }]]);
  await traiterEtat({
    cle: 'CLE',
    corps: { version: '0.2.4', refus: [{ version: '0.2.3', journal: 'boum' }] },
    sql, prevenirFn,
  });
  assert.strictEqual(prevenirFn.envoyes.length, 1);
  assert.match(prevenirFn.envoyes[0], /Jibb/);
  assert.match(prevenirFn.envoyes[0], /0\.2\.3/);
});

test('un refus deja connu ne re-ping pas', async () => {
  const prevenirFn = fauxPrevenir();
  // Le dernier [] = ON CONFLICT DO NOTHING n'a rien insere.
  const sql = fauxSql([[{ nom: 'Jibb' }], [], [], [], []]);
  await traiterEtat({
    cle: 'CLE',
    corps: { version: '0.2.4', refus: [{ version: '0.2.3' }] },
    sql, prevenirFn,
  });
  assert.strictEqual(prevenirFn.envoyes.length, 0);
});

test('un ping qui echoue ne fait pas echouer la requete de l ami', async () => {
  const prevenirFn = async () => { throw new Error('discord mort'); };
  const sql = fauxSql([[{ nom: 'Jibb' }], [], [], [], [{ version: '0.2.3' }]]);
  const r = await traiterEtat({
    cle: 'CLE', corps: { version: '0.2.4', refus: [{ version: '0.2.3' }] }, sql, prevenirFn,
  });
  assert.strictEqual(r.statut, 200);
});
```

- [ ] **Step 2: Lancer les tests pour verifier qu'ils echouent**

Depuis `serveur-maj/` : `node --test test/api-etat.test.js`
Attendu : ECHEC, `Cannot find module '../api/etat'`.

- [ ] **Step 3: Ecrire `api/etat.js`**

Calquer la forme sur `api/manifeste.js` : une fonction pure testee, un module HTTP mince.

```js
'use strict';
const { creerClient, appliquerSchema } = require('../lib/db');
const { verifierCle } = require('../lib/amis');
const { enregistrerEtat } = require('../lib/etat');
const { prevenir } = require('../lib/discord');

// Logique pure, sans HTTP: c'est elle qu'on teste.
async function traiterEtat({ cle, corps = {}, sql, prevenirFn = prevenir }) {
  if (!cle) return { statut: 404, corps: null };
  // verifierCle AVANT toute ecriture: une cle revoquee ne doit laisser
  // aucune trace, ni lancement, ni refus.
  const v = await verifierCle(sql, cle);
  if (!v.ok) return { statut: 404, corps: null };
  const r = await enregistrerEtat(sql, { cle, version: corps.version, refus: corps.refus });
  for (const version of r.nouveaux) {
    // prevenir n'est pas cense lever; on s'en assure ici quand meme, parce
    // qu'un ping rate ne doit jamais devenir un 500 chez l'ami.
    try {
      await prevenirFn(`⚠ ${v.nom} a refuse ${version} — elle n'a pas demarre chez lui`);
    } catch (e) {
      console.error('[etat] ping impossible:', e && e.message ? e.message : e);
    }
  }
  return { statut: 200, corps: { ok: true } };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.statusCode = 404; return res.end(''); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let corps = {};
    try {
      corps = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    } catch (e) {
      // Un corps illisible n'est pas une raison d'empecher un ami de demarrer.
      corps = {};
    }
    const sql = creerClient();
    await appliquerSchema(sql);
    const { statut, corps: sortie } = await traiterEtat({ cle: req.headers['x-cle'], corps, sql });
    res.statusCode = statut;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(sortie === null ? '' : JSON.stringify(sortie));
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end('');
  }
};
module.exports.traiterEtat = traiterEtat;
```

- [ ] **Step 4: Lancer les tests pour verifier qu'ils passent**

Depuis `serveur-maj/` : `node --test test/api-etat.test.js`
Attendu : PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add serveur-maj/api/etat.js serveur-maj/test/api-etat.test.js
git commit -m "feat(serveur-maj): route /api/etat, garde 404 avant toute ecriture"
```

---

### Task 4: Les deux actions admin

**Files:**
- Modify: `serveur-maj/api/admin.js` (le `switch (action)` de `traiterAdmin`)
- Modify: `serveur-maj/test/api-admin.test.js`

**Interfaces:**
- Consumes: `listerRefus`, `compterLancements`, `lancementsDe`, `purgerLancements` (Task 1).
- Produces : deux actions admin, `refus` et `lancements`.

- [ ] **Step 1: Ecrire les tests qui echouent**

Ajouter a la fin de `serveur-maj/test/api-admin.test.js`. Reprendre le nom des helpers deja definis en haut de ce fichier (`fauxSql`, et la constante de mot de passe utilisee par les tests existants) — lire le debut du fichier avant d'ecrire, et **ne pas redefinir** un helper qui existe deja.

```js
test('action refus: la liste, derriere le mot de passe', async () => {
  const ligne = { cle: 'CLE', nom: 'Jibb', version: '0.2.3', journal: 'boum', signale_le: 'hier' };
  const sql = fauxSql([[ligne]]);
  const r = await traiterAdmin({
    motDePasse: 'secret', motDePasseAttendu: 'secret', action: 'refus', corps: {}, sql,
  });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, [ligne]);
});

test('action refus: 404 sur mauvais mot de passe', async () => {
  const sql = fauxSql();
  const r = await traiterAdmin({
    motDePasse: 'faux', motDePasseAttendu: 'secret', action: 'refus', corps: {}, sql,
  });
  assert.strictEqual(r.statut, 404);
  assert.strictEqual(sql.appels.length, 0);
});

test('action lancements sans cle: purge puis compteurs', async () => {
  // 1er appel = DELETE ... RETURNING, 2e = SELECT COUNT GROUP BY
  const sql = fauxSql([[{ id: 1 }], [{ cle: 'CLE', n: 4 }]]);
  const r = await traiterAdmin({
    motDePasse: 'secret', motDePasseAttendu: 'secret', action: 'lancements', corps: {}, sql,
  });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, [{ cle: 'CLE', n: 4 }]);
  assert.strictEqual(sql.appels.length, 2);
});

test('action lancements avec cle: le detail, sans purge', async () => {
  const sql = fauxSql([[{ version: '0.2.4', au: 'hier' }]]);
  const r = await traiterAdmin({
    motDePasse: 'secret', motDePasseAttendu: 'secret', action: 'lancements', corps: { cle: 'CLE' }, sql,
  });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.corps, [{ version: '0.2.4', au: 'hier' }]);
  assert.strictEqual(sql.appels.length, 1);
  assert.deepStrictEqual(sql.appels[0], ['CLE', 20]);
});

test('action lancements: 404 sur mauvais mot de passe', async () => {
  const sql = fauxSql();
  const r = await traiterAdmin({
    motDePasse: 'faux', motDePasseAttendu: 'secret', action: 'lancements', corps: {}, sql,
  });
  assert.strictEqual(r.statut, 404);
  assert.strictEqual(sql.appels.length, 0);
});
```

- [ ] **Step 2: Lancer les tests pour verifier qu'ils echouent**

Depuis `serveur-maj/` : `node --test test/api-admin.test.js`
Attendu : ECHEC — les quatre premiers rendent `{erreur: 'action inconnue'}` avec un statut 400 au lieu de 200.

- [ ] **Step 3: Ajouter les deux actions**

Dans `serveur-maj/api/admin.js`, completer l'import en tete de fichier :

```js
const { listerRefus, compterLancements, lancementsDe, purgerLancements } = require('../lib/etat');
```

Puis, dans le `switch (action)`, juste avant `case 'lister-manifeste':` :

```js
    case 'refus':
      return { statut: 200, corps: await listerRefus(sql) };
    case 'lancements': {
      if (corps.cle) return { statut: 200, corps: await lancementsDe(sql, String(corps.cle)) };
      // La purge est portee par la consultation admin, jamais par le
      // lancement d'un ami: personne ne doit attendre un DELETE pour demarrer.
      await purgerLancements(sql);
      return { statut: 200, corps: await compterLancements(sql, {}) };
    }
```

- [ ] **Step 4: Lancer les tests pour verifier qu'ils passent**

Depuis `serveur-maj/` : `npm test`
Attendu : PASS, toute la suite serveur.

- [ ] **Step 5: Commit**

```bash
git add serveur-maj/api/admin.js serveur-maj/test/api-admin.test.js
git commit -m "feat(serveur-maj): actions admin refus et lancements"
```

---

### Task 5: Le panneau

**Files:**
- Modify: `serveur-maj/web/admin.html`

**Interfaces:**
- Consumes: les actions `refus` et `lancements` (Task 4), `lister` et `lister-manifeste` (existantes).
- Produces : rien pour les autres taches.

Pas de test automatise ici : le projet n'a pas de banc de test navigateur, et le panneau est verifie a la main comme les blocs precedents. La verification est decrite a l'etape 5.

- [ ] **Step 1: Ajouter le bloc Refus dans le HTML**

Dans `#panneau`, juste avant `<table id="liste"></table>` :

```html
  <div class="bloc">
    <h2>Refus</h2>
    <p class="aide">Une version qu'un ami a ecartee parce qu'elle n'a pas demarre chez lui.
      En rouge quand elle porte sur la version actuellement active.</p>
    <table id="refus"></table>
  </div>
```

Reprendre les classes `bloc`, `h2` et `aide` telles qu'elles sont utilisees par les blocs existants (`Coupe-circuit`, `Publier une version`) — lire le HTML autour avant d'ecrire, pour coller aux noms reels.

Ajouter aussi, dans le `<style>` existant, deux regles :

```css
  .retard { color: #e0a030; }
  .rouge  { color: #e05555; }
```

- [ ] **Step 2: Afficher version et lancements dans le tableau des amis**

Dans `rafraichir()`, la boucle sur les amis. Recuperer d'abord les compteurs et le manifeste, puis elargir l'entete et les lignes :

```js
    // Les compteurs et le manifeste ne sont pas essentiels a l'affichage des
    // amis: leur echec ne doit pas vider le tableau.
    let compteurs = {};
    try {
      for (const c of await api('lancements', {})) compteurs[c.cle] = c.n;
    } catch (e) { /* tableau affiche sans la colonne 30 j */ }
    let versionActive = null;
    try {
      const m = await api('lister-manifeste', {});
      versionActive = m && m.version ? m.version : null;
    } catch (e) { /* pas de mise en evidence du retard */ }
```

L'entete passe de `['nom', 'cle', 'derniere vue', '']` a :

```js
    for (const titre of ['nom', 'cle', 'version', '30 j', 'derniere vue', '']) {
```

Et la ligne, a la place de `tr.append(cellule(a.nom), cellule(a.cle, 'cle'), cellule(a.derniere_vue || '—'));` :

```js
      const nom = cellule(a.nom);
      nom.style.cursor = 'pointer';
      nom.onclick = () => montrerLancements(a);
      const enRetard = a.version_vue && versionActive && a.version_vue !== versionActive;
      tr.append(
        nom,
        cellule(a.cle, 'cle'),
        cellule(a.version_vue || '—', enRetard ? 'retard' : null),
        cellule(compteurs[a.cle] === undefined ? '—' : String(compteurs[a.cle])),
        cellule(a.derniere_vue || '—'),
      );
```

- [ ] **Step 3: Ajouter le detail par ami et le tableau des refus**

Deux fonctions, a placer a cote de `rafraichir()` :

```js
  async function montrerLancements(a) {
    const lignes = await api('lancements', { cle: a.cle });
    const t = document.getElementById('refus');
    t.textContent = '';
    const titre = document.createElement('tr');
    const th = document.createElement('th');
    th.colSpan = 2;
    th.textContent = 'derniers lancements de ' + a.nom;
    titre.append(th); t.append(titre);
    for (const l of lignes) {
      const tr = document.createElement('tr');
      tr.append(cellule(l.au), cellule(l.version || '—'));
      t.append(tr);
    }
    if (!lignes.length) {
      const tr = document.createElement('tr');
      tr.append(cellule('aucun lancement enregistre'));
      t.append(tr);
    }
    avis('clique « Refus » pour revenir a la liste des refus');
  }

  async function rafraichirRefus() {
    const lignes = await api('refus', {});
    let versionActive = null;
    try {
      const m = await api('lister-manifeste', {});
      versionActive = m && m.version ? m.version : null;
    } catch (e) { /* pas de mise en evidence */ }
    const t = document.getElementById('refus');
    t.textContent = '';
    const entete = document.createElement('tr');
    for (const titre of ['ami', 'version', 'signale le', '']) {
      const th = document.createElement('th');
      th.textContent = titre;
      entete.append(th);
    }
    t.append(entete);
    for (const l of lignes) {
      const tr = document.createElement('tr');
      // Rouge seulement si le refus porte sur la version SERVIE aujourd'hui:
      // l'alerte s'eteint d'elle-meme des qu'un correctif est active.
      const classe = l.version === versionActive ? 'rouge' : null;
      tr.append(cellule(l.nom || l.cle, classe), cellule(l.version, classe), cellule(l.signale_le));
      const td = document.createElement('td');
      if (l.journal) {
        const b = document.createElement('button');
        b.textContent = 'journal';
        b.onclick = () => {
          const pre = document.createElement('pre');
          pre.textContent = l.journal;      // jamais innerHTML
          td.textContent = '';
          td.append(pre);
        };
        td.append(b);
      }
      tr.append(td); t.append(tr);
    }
    if (!lignes.length) {
      const tr = document.createElement('tr');
      tr.append(cellule('aucun refus — c est la bonne nouvelle'));
      t.append(tr);
    }
  }
```

Appeler `rafraichirRefus()` a la fin de `rafraichir()`, dans un `try/catch` qui n'empeche pas le reste de s'afficher :

```js
    try { await rafraichirRefus(); } catch (e) { /* le reste du panneau reste utilisable */ }
```

- [ ] **Step 4: Afficher l'adoption dans le tableau des versions**

La fonction concernee est `rafraichirVersions()` (elle construit `#versions` et pose le `● courante`). Elle ne prend aujourd'hui aucun parametre : lui passer `amis` depuis `rafraichir()`, qui les a deja charges, plutot que de refaire l'appel `lister`. Sur la ligne courante, a la place de `td.textContent = '● courante';` :

```js
        const aJour = amis.filter((a) => a.version_vue === v.version).length;
        td.textContent = '● courante — ' + aJour + '/' + amis.length + ' amis';
```

- [ ] **Step 5: Verifier a la main**

Ouvrir `https://paquets-maj.vercel.app/api/admin` apres deploiement (ou en local si un `DATABASE_URL` de developpement est disponible), saisir le mot de passe, et verifier :

1. le tableau des amis a bien six colonnes, et affiche `—` pour version et 30 j tant qu'aucun ami n'a remonte quoi que ce soit ;
2. le bloc **Refus** affiche « aucun refus » ;
3. un clic sur un nom d'ami affiche « aucun lancement enregistre » ;
4. la console du navigateur ne montre aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add serveur-maj/web/admin.html
git commit -m "feat(panneau): version par ami, historique de lancements, bloc refus"
```

---

### Task 6: La file `aSignaler` dans le depot

**Files:**
- Modify: `amorceur/depot.js`
- Modify: `test/amorceur/depot.test.js`

**Interfaces:**
- Consumes: rien.
- Produces : sur l'objet rendu par `creerDepot(racine)`, trois methodes de plus — `filerSignalement(version)`, `signalementsEnAttente() → string[]`, `viderSignalements()`. `lire()` rend desormais aussi `aSignaler: string[]`.

- [ ] **Step 1: Ecrire les tests qui echouent**

Ajouter a `test/amorceur/depot.test.js`. Le fichier importe deja `fs`, `os`, `path` et definit `racineTemporaire()` (un `fs.mkdtempSync`) : s'en servir, ne pas ecrire un second helper ni redeclarer les imports.

```js
test('un signalement file survit a une relecture', async () => {
  const d = creerDepot(racineTemporaire());
  d.filerSignalement('0.2.4');
  assert.deepStrictEqual(d.signalementsEnAttente(), ['0.2.4']);
  assert.deepStrictEqual(d.lire().aSignaler, ['0.2.4']);
});

test('le meme signalement n est pas file deux fois', async () => {
  const d = creerDepot(racineTemporaire());
  d.filerSignalement('0.2.4');
  d.filerSignalement('0.2.4');
  assert.deepStrictEqual(d.signalementsEnAttente(), ['0.2.4']);
});

test('vider la file la vide, et ne touche a rien d autre', async () => {
  const d = creerDepot(racineTemporaire());
  d.filerSignalement('0.2.4');
  d.refuser('0.2.4');
  d.viderSignalements();
  assert.deepStrictEqual(d.signalementsEnAttente(), []);
  assert.deepStrictEqual(d.lire().refusees, ['0.2.4']);
});

test('un courante.json ancien, sans aSignaler, se lit comme une file vide', async () => {
  const racine = racineTemporaire();
  const dossier = path.join(racine, 'versions');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'courante.json'),
    JSON.stringify({ version: '0.2.3', essai: null, refusees: [] }));
  const d = creerDepot(racine);
  assert.deepStrictEqual(d.signalementsEnAttente(), []);
});

test('choisirVersion preserve la file', async () => {
  const racine = racineTemporaire();
  const d = creerDepot(racine);
  fs.mkdirSync(path.join(racine, 'versions', '0.2.3'), { recursive: true });
  d.filerSignalement('0.2.4');
  d.choisirVersion();
  assert.deepStrictEqual(d.signalementsEnAttente(), ['0.2.4']);
});
```

- [ ] **Step 2: Lancer les tests pour verifier qu'ils echouent**

Depuis la racine : `node --test test/amorceur/depot.test.js`
Attendu : ECHEC, `d.filerSignalement is not a function`.

- [ ] **Step 3: Ajouter la file dans `amorceur/depot.js`**

Dans `lire()`, ajouter un champ au retour, en tolerant son absence :

```js
        refusees: Array.isArray(brut.refusees) ? brut.refusees.filter((x) => typeof x === 'string') : [],
        // Ajoutee apres coup: un courante.json ecrit par une version
        // anterieure n'a pas ce champ, et ne doit pas faire lever ici.
        aSignaler: Array.isArray(brut.aSignaler) ? brut.aSignaler.filter((x) => typeof x === 'string') : [],
```

Et le repli du `catch` devient :

```js
      return { version: null, essai: null, refusees: [], aSignaler: [] };
```

Puis, a cote de `refuser()` :

```js
  // Un refus n'existe qu'une fois: au lancement qui suit le plantage. Si le
  // service est injoignable a cet instant precis, l'information disparait
  // pour toujours. Elle attend donc ici jusqu'a ce qu'un 200 la libere.
  function filerSignalement(version) {
    const etat = lire();
    if (!etat.aSignaler.includes(version)) etat.aSignaler.push(version);
    ecrire(etat);
  }

  function signalementsEnAttente() {
    return lire().aSignaler;
  }

  function viderSignalements() {
    ecrire({ ...lire(), aSignaler: [] });
  }
```

Et les exposer dans le retour de `creerDepot` :

```js
  return {
    lire, ecrire, dossierDe, versionsInstallees, choisirVersion,
    poserTemoin, effacerTemoin, refuser,
    filerSignalement, signalementsEnAttente, viderSignalements,
  };
```

- [ ] **Step 4: Lancer les tests pour verifier qu'ils passent**

Depuis la racine : `node --test test/amorceur/depot.test.js`
Attendu : PASS.

- [ ] **Step 5: Commit**

```bash
git add amorceur/depot.js test/amorceur/depot.test.js
git commit -m "feat(amorceur): file des refus a signaler dans courante.json"
```

---

### Task 7: `canal.signaler`

**Files:**
- Modify: `amorceur/canal.js`
- Modify: `test/amorceur/canal.test.js`

**Interfaces:**
- Consumes: rien.
- Produces : sur l'objet rendu par `creerCanal({ base, chercher })`, une methode de plus — `signaler(cle, corps) → Promise<{etat: 'ok'|'refuse'|'injoignable', raison?: string}>`.

- [ ] **Step 1: Ecrire les tests qui echouent**

Ajouter a `test/amorceur/canal.test.js`. Le helper `fauxFetch` existe deja en haut du fichier ; il rend `{ok, status, json, arrayBuffer}`, ce qui suffit ici.

```js
test('signaler poste sur /api/etat avec la cle et le corps', async () => {
  const chercher = fauxFetch([{ statut: 200, corps: { ok: true } }]);
  const c = creerCanal({ base: BASE, chercher });
  const r = await c.signaler('CLE', { version: '0.2.4', refus: [] });
  assert.strictEqual(r.etat, 'ok');
  assert.strictEqual(chercher.appels[0].url, BASE + '/api/etat');
  assert.strictEqual(chercher.appels[0].entetes['x-cle'], 'CLE');
});

test('signaler: 404 vaut refuse, pas injoignable', async () => {
  const chercher = fauxFetch([{ statut: 404 }]);
  const c = creerCanal({ base: BASE, chercher });
  assert.strictEqual((await c.signaler('CLE', {})).etat, 'refuse');
});

test('signaler: 500 vaut injoignable', async () => {
  const chercher = fauxFetch([{ statut: 500 }]);
  const c = creerCanal({ base: BASE, chercher });
  assert.strictEqual((await c.signaler('CLE', {})).etat, 'injoignable');
});

test('signaler ne leve jamais, meme si fetch explose', async () => {
  const chercher = fauxFetch([new Error('reseau mort')]);
  const c = creerCanal({ base: BASE, chercher });
  const r = await c.signaler('CLE', {});
  assert.strictEqual(r.etat, 'injoignable');
  assert.match(r.raison, /reseau mort/);
});
```

Le helper `fauxFetch` du fichier n'enregistre aujourd'hui que `url` et `headers`. Ajouter `corps: options && options.body ? JSON.parse(options.body) : null` a l'objet pousse dans `appels` — les tests existants ne lisent pas ce champ, ils ne bougent pas.

- [ ] **Step 2: Lancer les tests pour verifier qu'ils echouent**

Depuis la racine : `node --test test/amorceur/canal.test.js`
Attendu : ECHEC, `c.signaler is not a function`.

- [ ] **Step 3: Ajouter `signaler` dans `amorceur/canal.js`**

A cote de `manifeste` et `paquet` :

```js
  // Remontee d'etat. Les memes trois etats que le reste du canal, pour la
  // meme raison. Elle ne leve jamais: l'appelant la lance juste avant de
  // charger la fenetre, et rien ici ne doit empecher ce chargement.
  async function signaler(cle, corps) {
    let r;
    try {
      r = await chercher(base + '/api/etat', {
        method: 'POST',
        headers: { 'x-cle': cle, 'content-type': 'application/json' },
        body: JSON.stringify(corps || {}),
        signal: AbortSignal.timeout(DELAI_MS),
      });
    } catch (e) {
      return { etat: 'injoignable', raison: String(e && e.message ? e.message : e) };
    }
    if (r.status === 404) return { etat: 'refuse' };
    if (!r.ok) return { etat: 'injoignable', raison: 'statut ' + r.status };
    return { etat: 'ok' };
  }
```

Et l'exposer : `return { manifeste, paquet, signaler };`

- [ ] **Step 4: Lancer les tests pour verifier qu'ils passent**

Depuis la racine : `node --test test/amorceur/canal.test.js`
Attendu : PASS.

- [ ] **Step 5: Commit**

```bash
git add amorceur/canal.js test/amorceur/canal.test.js
git commit -m "feat(amorceur): canal.signaler, qui ne leve jamais"
```

---

### Task 8: L'orchestration et le cablage

**Files:**
- Create: `amorceur/signalement.js`
- Create: `test/amorceur/signalement.test.js`
- Modify: `amorceur/demarrage.js` (etape 1 de `demarrer`)
- Modify: `test/amorceur/demarrage.test.js`
- Modify: `amorceur/principal.js`

**Interfaces:**
- Consumes: `depot.signalementsEnAttente()`, `depot.viderSignalements()`, `depot.filerSignalement(version)` (Task 6) ; `canal.signaler(cle, corps)` (Task 7).
- Produces : `creerSignalement({ depot, canal, lireJournal, lignes }) → { envoyer(cle, version) → Promise<{etat}> }`.

`lireJournal(n)` est injecte : c'est `principal.js` qui sait ou vit `amorceur.log`. Ce decoupage est ce qui rend l'orchestration testable sans `fs` ni Electron.

- [ ] **Step 1: Ecrire les tests qui echouent**

Creer `test/amorceur/signalement.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerSignalement } = require('../../amorceur/signalement');

function fauxDepot(attente = []) {
  let file = attente.slice();
  return {
    signalementsEnAttente: () => file.slice(),
    viderSignalements: () => { file = []; },
    restant: () => file,
  };
}

function fauxCanal(etat) {
  const envois = [];
  return {
    envois,
    signaler: async (cle, corps) => { envois.push({ cle, corps }); return { etat }; },
  };
}

test('sans cle, rien n est envoye', async () => {
  const canal = fauxCanal('ok');
  const s = creerSignalement({ depot: fauxDepot(), canal, lireJournal: () => 'J' });
  const r = await s.envoyer(null, '0.2.4');
  assert.strictEqual(r.etat, 'sans-cle');
  assert.strictEqual(canal.envois.length, 0);
});

test('sans refus en attente, la version part quand meme et le journal n est pas lu', async () => {
  const canal = fauxCanal('ok');
  let lu = 0;
  const s = creerSignalement({ depot: fauxDepot(), canal, lireJournal: () => { lu += 1; return 'J'; } });
  await s.envoyer('CLE', '0.2.4');
  assert.strictEqual(canal.envois.length, 1);
  assert.deepStrictEqual(canal.envois[0].corps, { version: '0.2.4', refus: [] });
  assert.strictEqual(lu, 0);
});

test('avec un refus, le journal est joint', async () => {
  const canal = fauxCanal('ok');
  const s = creerSignalement({ depot: fauxDepot(['0.2.3']), canal, lireJournal: () => 'J' });
  await s.envoyer('CLE', '0.2.4');
  assert.deepStrictEqual(canal.envois[0].corps.refus, [{ version: '0.2.3', journal: 'J' }]);
});

test('un 200 vide la file', async () => {
  const depot = fauxDepot(['0.2.3']);
  const s = creerSignalement({ depot, canal: fauxCanal('ok'), lireJournal: () => 'J' });
  await s.envoyer('CLE', '0.2.4');
  assert.deepStrictEqual(depot.restant(), []);
});

test('un echec CONSERVE la file: c est tout l interet du mecanisme', async () => {
  const depot = fauxDepot(['0.2.3']);
  const s = creerSignalement({ depot, canal: fauxCanal('injoignable'), lireJournal: () => 'J' });
  await s.envoyer('CLE', '0.2.4');
  assert.deepStrictEqual(depot.restant(), ['0.2.3']);
});

test('un refus par le serveur conserve aussi la file', async () => {
  const depot = fauxDepot(['0.2.3']);
  const s = creerSignalement({ depot, canal: fauxCanal('refuse'), lireJournal: () => 'J' });
  await s.envoyer('CLE', '0.2.4');
  assert.deepStrictEqual(depot.restant(), ['0.2.3']);
});

test('un lireJournal qui explose n empeche pas l envoi', async () => {
  const canal = fauxCanal('ok');
  const s = creerSignalement({
    depot: fauxDepot(['0.2.3']), canal,
    lireJournal: () => { throw new Error('fichier illisible'); },
  });
  await s.envoyer('CLE', '0.2.4');
  assert.deepStrictEqual(canal.envois[0].corps.refus, [{ version: '0.2.3', journal: null }]);
});

test('version absente: on envoie null, pas undefined', async () => {
  const canal = fauxCanal('ok');
  const s = creerSignalement({ depot: fauxDepot(), canal, lireJournal: () => 'J' });
  await s.envoyer('CLE', null);
  assert.strictEqual(canal.envois[0].corps.version, null);
});
```

Ajouter aussi, dans `test/amorceur/demarrage.test.js`, un test qui verifie que le refus est file. Ce fichier n'a **pas** de faux depot : il utilise le vrai `creerDepot(r)` sur une racine temporaire, via les helpers `racine()`, `installer(r, version)`, `fauxEcrans()`, `fauxCanal({manifestes, paquets})` et `contexte(r, options)`. L'assertion porte donc sur le vrai fichier `courante.json`.

```js
test('une version abandonnee par le temoin est rangee dans la file de signalement', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  installer(r, '0.2.0');
  installer(r, '0.3.0');
  // Le temoin est reste sur 0.3.0: elle n'a pas atteint son etat pret au
  // lancement precedent. choisirVersion() va l'ecarter — et desormais la filer.
  creerDepot(r).ecrire({ version: '0.3.0', essai: '0.3.0', refusees: [] });
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans(),
    canal: fauxCanal({ manifestes: [{ etat: 'injoignable', raison: 'essai' }] }),
  }));
  assert.strictEqual(res.version, '0.2.0');
  assert.deepStrictEqual(creerDepot(r).signalementsEnAttente(), ['0.3.0']);
});
```

- [ ] **Step 2: Lancer les tests pour verifier qu'ils echouent**

Depuis la racine : `node --test test/amorceur/signalement.test.js test/amorceur/demarrage.test.js`
Attendu : ECHEC, `Cannot find module '../../amorceur/signalement'` et le test de file qui trouve `files` vide.

- [ ] **Step 3: Ecrire `amorceur/signalement.js`**

```js
'use strict';

// Orchestration de la remontee d'etat. Aucun fs, aucun Electron, aucun reseau
// en direct: tout arrive par injection, donc tout se teste.
function creerSignalement({ depot, canal, lireJournal, lignes = 30 }) {
  async function envoyer(cle, version) {
    if (!cle) return { etat: 'sans-cle' };
    const attente = depot.signalementsEnAttente();
    let journal = null;
    if (attente.length) {
      // Le journal n'est lu QUE s'il y a un refus a expliquer: le cas courant
      // est un lancement sans incident, et il ne doit rien couter.
      try {
        journal = lireJournal(lignes);
      } catch (e) {
        journal = null;   // un journal illisible ne doit pas perdre le refus
      }
    }
    const r = await canal.signaler(cle, {
      version: version || null,
      refus: attente.map((v) => ({ version: v, journal })),
    });
    // La file n'est videe que sur un vrai 200. Sur 'refuse' comme sur
    // 'injoignable', elle repart au lancement suivant.
    if (r.etat === 'ok') depot.viderSignalements();
    return r;
  }
  return { envoyer };
}

module.exports = { creerSignalement };
```

- [ ] **Step 4: Filer le refus dans `amorceur/demarrage.js`**

Etape 1 de `demarrer`, remplacer :

```js
  if (choix.refusee) journal(`version ${choix.refusee} abandonnee: elle n'a pas demarre`);
```

par :

```js
  if (choix.refusee) {
    journal(`version ${choix.refusee} abandonnee: elle n'a pas demarre`);
    // Range ici et pas ailleurs: c'est le seul instant ou l'information
    // existe. L'envoi, lui, appartient a principal.js.
    depot.filerSignalement(choix.refusee);
  }
```

- [ ] **Step 5: Cabler `amorceur/principal.js`**

Trois modifications, dans `principal()` :

D'abord, sortir `canal` et `cle` de l'appel a `demarrer` pour pouvoir les reutiliser :

```js
  const depot = creerDepot(RACINE);
  const canal = creerCanal({ base: BASE });
  const cle = creerCle(RACINE);
  const ecrans = creerEcrans();
  const resultat = await demarrer({
    depot, canal, cle, ecrans,
    installerInitiale: () => installerInitiale(depot),
    versionPaquet: VERSION_PAQUET,
    journal,
  });
```

Ensuite, ajouter la lecture des dernieres lignes du journal, a cote de la fonction `journal` en haut du fichier :

```js
// Les dernieres lignes du journal, jointes a un refus. Prises a l'envoi, elles
// couvrent le lancement qui a plante et celui qui le signale — c'est ce qu'on
// veut lire. Le fichier est court par construction: une ligne par decision.
function dernieresLignes(n) {
  const lignes = fs.readFileSync(path.join(RACINE, 'amorceur.log'), 'utf8').split('\n');
  return lignes.slice(-n).join('\n');
}
```

Enfin, envoyer juste apres le retour de `demarrer`, **avant** le branchement sur `arreter` — un arret pour coupe-circuit ne doit pas faire perdre un refus :

```js
  const signalement = creerSignalement({ depot, canal, lireJournal: dernieresLignes });
  try {
    const envoi = await signalement.envoyer(cle.lire(), resultat.version || null);
    if (envoi.etat !== 'ok' && envoi.etat !== 'sans-cle') {
      journal(`remontee d etat non aboutie: ${envoi.etat}`);
    }
  } catch (e) {
    // Ceinture et bretelles: signalement.envoyer n'est pas cense lever.
    journal(`remontee d etat impossible: ${e && e.message ? e.message : e}`);
  }
```

Et l'import en tete : `const { creerSignalement } = require('./signalement');`

- [ ] **Step 6: Lancer les tests pour verifier qu'ils passent**

Depuis la racine : `node --test test/amorceur/`
Attendu : PASS.

- [ ] **Step 7: Commit**

```bash
git add amorceur/signalement.js amorceur/demarrage.js amorceur/principal.js test/amorceur/
git commit -m "feat(amorceur): remontee d etat au lancement, file preservee sur echec"
```

---

### Task 9: Verification d'ensemble et note de livraison

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: tout ce qui precede.
- Produces : rien.

- [ ] **Step 1: Lancer la suite complete**

Depuis la racine : `npm test`
Attendu : le total s'imprime (`ℹ tests N`, `ℹ fail 0`). **Verifier que le total s'imprime** : une suite qui defile sans conclure signale une socket laissee ouverte, pas un succes.

- [ ] **Step 2: Verifier qu'un ami sans le nouveau paquet n'est pas casse**

Le contrat a tenir : `/api/manifeste` rend toujours exactement `{version, sha256, actif, message}`. Le verifier a la lecture de `api/manifeste.js` et de `lib/manifeste.js` — aucune des taches precedentes ne doit y avoir touche :

```bash
git diff master --stat -- serveur-maj/api/manifeste.js serveur-maj/lib/manifeste.js
```

Attendu : **aucune ligne**. Si ce diff n'est pas vide, la compatibilite des amis non mis a jour est en cause : lire le changement avant d'aller plus loin.

- [ ] **Step 3: Documenter la consequence de livraison dans le README**

Dans la section « Refabriquer le paquet a donner (480 Mo) », ajouter en tete :

```markdown
Necessaire aussi apres tout changement de l'amorceur — par exemple la remontee
d'etat ajoutee le 2026-08-25 : tant qu'un ami n'a pas le nouveau paquet, il
fonctionne normalement mais ne remonte rien, et sa ligne du panneau reste a
`—`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: la remontee d etat impose de refabriquer le paquet"
```

- [ ] **Step 5: Deployer et verifier en vrai**

Le service se deploie par un push sur `master` (Vercel est branche sur le depot). Apres deploiement, avec une cle d'essai valide :

```bash
curl -s -w "\n[%{http_code}]\n" -X POST -H "x-cle: <CLE_TEST>" \
  -H "content-type: application/json" \
  -d '{"version":"0.2.3","refus":[{"version":"0.2.9","journal":"essai"}]}' \
  https://paquets-maj.vercel.app/api/etat
```

Attendu : `{"ok":true}` en 200. Puis, dans le panneau : la ligne de l'ami d'essai porte `0.2.3` et `1` dans la colonne 30 j, et le bloc **Refus** montre `0.2.9`, journal depliable. Relancer la meme commande : le refus ne doit **pas** apparaitre deux fois, et Discord ne doit sonner qu'une seule fois au total.

Enfin, garde 404 :

```bash
curl -s -o /dev/null -w "[%{http_code}]\n" -X POST -H "x-cle: inexistante" \
  -H "content-type: application/json" -d '{"version":"0.2.3"}' \
  https://paquets-maj.vercel.app/api/etat
```

Attendu : `[404]`.

- [ ] **Step 6: Nettoyer la ligne d'essai**

Le refus `0.2.9` de l'essai reste en base. Le laisser fausserait le premier vrai signal. Il n'y a pas d'action de suppression dans le panneau (choix du spec) : le retirer par la console SQL Neon, ou publier un refus reel par-dessus. **Demander a l'utilisateur** comment il veut proceder plutot que d'executer un DELETE de son cote.

---

## Notes pour l'implementeur

- **`ADMIN_MDP` et `DATABASE_URL` sont des variables *Sensitive* de Vercel**, non recuperables en local. Tout ce qui touche la vraie base passe par le panneau ou par une commande que l'utilisateur lance lui-meme.
- **`DISCORD_WEBHOOK` est a creer** dans les variables d'environnement Vercel par l'utilisateur, apres la Task 2. Sans elle, tout fonctionne, il n'y a simplement pas de ping — c'est le comportement teste.
- **Ne pas lancer l'application pour essayer** : sur cette machine, `npm run app` est refuse par Smart App Control. L'essai passe par `desktop\dist\OMNI-win32-x64\OMNI.exe`, et une instance Electron ne contient que le JS lu a son demarrage — verifier l'heure du processus avant de conclure quoi que ce soit.
