# Application OMNI — plan d'implémentation de la phase 1

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE — utiliser
> `superpowers:subagent-driven-development` (recommandé) ou
> `superpowers:executing-plans` pour dérouler ce plan tâche par tâche. Les
> étapes utilisent des cases à cocher (`- [ ]`).

**But :** une application Electron qui liste les comptes du launcher Ankama,
indique lesquels sont en jeu, permet d'en marquer en favoris, et porte un
interrupteur OMNI général plus une case par compte.

**Architecture :** quatre modules de données purs sous `src/comptes/`, sans
dépendance à Electron ni à Frida, plus une coquille Electron sous `desktop/`
qui possède le `Superviseur` existant. Le renderer ne voit que trois fonctions
d'IPC et un flux d'état.

**Pile :** Node 24, `node:test` pour les tests, Electron pour la coquille,
`@electron/packager` pour l'empaquetage.

## Contraintes globales

- Le `keydata` de Zaap **n'est jamais lu**. Seul `%APPDATA%\zaap\Settings` l'est.
- Aucun identifiant de connexion n'est écrit sur disque ni journalisé.
- Les modules de `src/comptes/` ne dépendent ni d'Electron ni de Frida.
- Les 110 tests existants restent verts après chaque tâche.
- Commentaires et messages de commit en français, sans accent dans les messages
  de commit (convention du dépôt).
- `electron-builder` est **interdit** sur cette machine (échoue sur des liens
  symboliques macOS) — utiliser `@electron/packager`.

---

### Tâche 1 : lecture des comptes de Zaap

**Fichiers :**
- Créer : `src/comptes/zaap.js`
- Créer : `test/comptes-zaap.test.js`
- Créer : `test/fixtures/zaap-settings.json`

**Interfaces :**
- Consomme : rien
- Produit : `lireComptes(chemin?) -> { comptes: Compte[], erreur: string|null }`
  où `Compte = { id: number, login: string, nickname: string, tag: string,
  nicknameWithTag: string, avatar: string, isMain: boolean }`.
  `cheminParDefaut() -> string`.

- [ ] **Étape 1 : écrire l'échantillon**

Créer `test/fixtures/zaap-settings.json` :

```json
{
  "LANGUAGE": "fr",
  "USER_ACCOUNTS": [
    { "id": 10612457, "login": "compte-un@example.test", "nickname": "BrokenLegs",
      "tag": "#1234", "nicknameWithTag": "BrokenLegs#1234",
      "avatar": "https://example.test/a.png", "isMain": true, "isGuest": false },
    { "id": 83542107, "login": "compte-deux@example.test", "nickname": "squeezie",
      "tag": "#5678", "nicknameWithTag": "squeezie#5678",
      "avatar": "https://example.test/b.png", "isMain": false, "isGuest": false }
  ]
}
```

- [ ] **Étape 2 : écrire les tests qui échouent**

Créer `test/comptes-zaap.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { lireComptes, cheminParDefaut } = require('../src/comptes/zaap');

const ECHANTILLON = path.join(__dirname, 'fixtures', 'zaap-settings.json');

test('lit les comptes du Settings de Zaap', () => {
  const { comptes, erreur } = lireComptes(ECHANTILLON);
  assert.strictEqual(erreur, null);
  assert.strictEqual(comptes.length, 2);
  assert.strictEqual(comptes[0].id, 10612457);
  assert.strictEqual(comptes[0].nickname, 'BrokenLegs');
  assert.strictEqual(comptes[0].isMain, true);
});

// Le dossier keydata contient les identifiants chiffres: rien dans ce module
// ne doit y toucher, meme indirectement.
test('ne lit jamais le keydata', () => {
  const src = require('node:fs').readFileSync(
    path.join(__dirname, '..', 'src', 'comptes', 'zaap.js'), 'utf8');
  assert.doesNotMatch(src, /keydata/i);
});

test('un fichier absent donne une erreur, pas une exception', () => {
  const { comptes, erreur } = lireComptes(path.join(__dirname, 'inexistant.json'));
  assert.deepStrictEqual(comptes, []);
  assert.match(erreur, /introuvable/);
});

test('un fichier corrompu donne une erreur, pas une exception', (t) => {
  const tmp = path.join(require('node:os').tmpdir(), `zaap-corrompu-${process.pid}.json`);
  require('node:fs').writeFileSync(tmp, '{ceci n est pas du json');
  t.after(() => require('node:fs').unlinkSync(tmp));
  const { comptes, erreur } = lireComptes(tmp);
  assert.deepStrictEqual(comptes, []);
  assert.match(erreur, /illisible/);
});

test('un Settings sans USER_ACCOUNTS donne une liste vide et une erreur', (t) => {
  const tmp = path.join(require('node:os').tmpdir(), `zaap-test-${process.pid}.json`);
  require('node:fs').writeFileSync(tmp, JSON.stringify({ LANGUAGE: 'fr' }));
  t.after(() => require('node:fs').unlinkSync(tmp));
  const { comptes, erreur } = lireComptes(tmp);
  assert.deepStrictEqual(comptes, []);
  assert.match(erreur, /aucun compte/);
});

test('le chemin par défaut pointe vers le Settings de Zaap', () => {
  assert.match(cheminParDefaut(), /zaap[\\/]Settings$/);
});
```

- [ ] **Étape 3 : lancer les tests pour vérifier qu'ils échouent**

Lancer : `node --test test/comptes-zaap.test.js`
Attendu : ÉCHEC, « Cannot find module '../src/comptes/zaap' ».

- [ ] **Étape 4 : écrire l'implémentation**

Créer `src/comptes/zaap.js` :

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Lecture de la liste des comptes du launcher Ankama.
//
// %APPDATA%\zaap\Settings est un JSON contenant USER_ACCOUNTS: identifiant,
// pseudo, avatar, en clair. Aucun mot de passe, aucun jeton.
//
// Le dossier voisin keydata contient les identifiants CHIFFRES. Ce module n'y
// touche pas, et un test verifie que son source n'y fait meme pas reference.

function cheminParDefaut() {
  const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(base, 'zaap', 'Settings');
}

const CHAMPS = ['id', 'login', 'nickname', 'tag', 'nicknameWithTag', 'avatar', 'isMain'];

// Rend toujours { comptes, erreur }: une liste vide avec une raison plutot
// qu'une exception, pour que l'interface affiche le probleme au lieu de
// planter.
function lireComptes(chemin = cheminParDefaut()) {
  let brut;
  try {
    brut = fs.readFileSync(chemin, 'utf8');
  } catch (e) {
    return { comptes: [], erreur: `Settings de Zaap introuvable ou illisible : ${e.code || e.message}` };
  }

  let json;
  try {
    json = JSON.parse(brut);
  } catch (e) {
    return { comptes: [], erreur: `Settings de Zaap illisible : ${e.message}` };
  }

  const liste = json.USER_ACCOUNTS;
  if (!Array.isArray(liste) || liste.length === 0) {
    return { comptes: [], erreur: 'aucun compte dans le Settings de Zaap' };
  }

  const comptes = liste
    .filter((c) => c && typeof c.id === 'number')
    .map((c) => {
      const sortie = {};
      for (const champ of CHAMPS) sortie[champ] = c[champ] ?? null;
      return sortie;
    });

  return { comptes, erreur: null };
}

module.exports = { lireComptes, cheminParDefaut };
```

- [ ] **Étape 5 : lancer les tests pour vérifier qu'ils passent**

Lancer : `node --test test/comptes-zaap.test.js`
Attendu : 6 tests, 6 réussis.

- [ ] **Étape 6 : lancer la suite complète**

Lancer : `node --test --test-timeout=15000`
Attendu : 116 tests, 0 échec.

- [ ] **Étape 7 : commiter**

```bash
git add src/comptes/zaap.js test/comptes-zaap.test.js test/fixtures/zaap-settings.json
git commit -m "feat(comptes): lecture des comptes du Settings de Zaap, jamais du keydata"
```

---

### Tâche 2 : identification des clients en cours

**Fichiers :**
- Créer : `src/comptes/clients.js`
- Créer : `test/comptes-clients.test.js`

**Interfaces :**
- Consomme : rien
- Produit : `extraireIdCompte(ligneDeCommande) -> number|null`,
  `extrairePersonnage(titre) -> { personnage: string|null, classe: string|null }`,
  `analyserSortie(json) -> Client[]` où
  `Client = { pid: number, idCompte: number|null, personnage: string|null, classe: string|null }`,
  et `listerClients() -> Promise<Client[]>`.

La ligne de commande réelle d'un client, relevée le 19/08 :

```
Dofus.exe  -logFile "C:\Users\X\AppData\Roaming\zaap\gamesLogs\dofus-dofus3\dofus.10612457.log"
  --port 26116 --gameName dofus --gameRelease dofus3 --instanceId 8
  --hash fdc7ab5e-0940-4ac1-b275-7402c73b5cd4 --canLogin true --langCode fr
  --autoConnectType 0 --connectionPort 5555 ""
```

Le titre de fenêtre réel : `Spoony - Pandawa - 3.6.10.10 - Release`.

- [ ] **Étape 1 : écrire les tests qui échouent**

Créer `test/comptes-clients.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { extraireIdCompte, extrairePersonnage, analyserSortie } = require('../src/comptes/clients');

// Ligne de commande reelle relevee le 19/08.
const LIGNE = 'Dofus.exe  -logFile "C:\\Users\\X\\AppData\\Roaming\\zaap\\gamesLogs\\dofus-dofus3\\dofus.10612457.log" --port 26116 --gameName dofus --gameRelease dofus3 --instanceId 8 --hash fdc7ab5e-0940-4ac1-b275-7402c73b5cd4 --canLogin true --langCode fr --autoConnectType 0 --connectionPort 5555 ""';

test('extrait l identifiant de compte du chemin de journal', () => {
  assert.strictEqual(extraireIdCompte(LIGNE), 10612457);
});

test('rend null si la ligne ne porte pas de journal', () => {
  assert.strictEqual(extraireIdCompte('Dofus.exe --port 26116'), null);
  assert.strictEqual(extraireIdCompte(''), null);
  assert.strictEqual(extraireIdCompte(null), null);
});

test('extrait le personnage et la classe du titre', () => {
  assert.deepStrictEqual(
    extrairePersonnage('Spoony - Pandawa - 3.6.10.10 - Release'),
    { personnage: 'Spoony', classe: 'Pandawa' },
  );
});

// Avant l'entree en jeu, le titre ne porte que la version.
test('un titre sans personnage ne fabrique pas de nom', () => {
  assert.deepStrictEqual(
    extrairePersonnage('Dofus 3.6.10.10 - Release'),
    { personnage: null, classe: null },
  );
  assert.deepStrictEqual(extrairePersonnage(''), { personnage: null, classe: null });
});

// Le titre reecrit par un launcher tiers ne doit pas passer pour un personnage.
test('un titre de launcher tiers est ignoré', () => {
  assert.deepStrictEqual(
    extrairePersonnage('Spoony OMNI:ON Follow:OFF'),
    { personnage: null, classe: null },
  );
});

test('analyse la sortie PowerShell en liste de clients', () => {
  const json = JSON.stringify([
    { ProcessId: 4336, CommandLine: LIGNE, MainWindowTitle: 'Spoony - Pandawa - 3.6.10.10 - Release' },
    { ProcessId: 9564, CommandLine: 'Dofus.exe --port 26116', MainWindowTitle: '' },
  ]);
  assert.deepStrictEqual(analyserSortie(json), [
    { pid: 4336, idCompte: 10612457, personnage: 'Spoony', classe: 'Pandawa' },
    { pid: 9564, idCompte: null, personnage: null, classe: null },
  ]);
});

// PowerShell rend un objet seul, pas un tableau, quand il n'y a qu'un process.
test('analyse aussi un process unique rendu hors tableau', () => {
  const json = JSON.stringify({ ProcessId: 42, CommandLine: LIGNE, MainWindowTitle: '' });
  assert.strictEqual(analyserSortie(json).length, 1);
  assert.strictEqual(analyserSortie(json)[0].pid, 42);
});

test('une sortie vide ou illisible donne une liste vide', () => {
  assert.deepStrictEqual(analyserSortie(''), []);
  assert.deepStrictEqual(analyserSortie('pas du json'), []);
});
```

- [ ] **Étape 2 : lancer les tests pour vérifier qu'ils échouent**

Lancer : `node --test test/comptes-clients.test.js`
Attendu : ÉCHEC, module introuvable.

- [ ] **Étape 3 : écrire l'implémentation**

Créer `src/comptes/clients.js` :

```js
'use strict';
const { execFile } = require('node:child_process');

// Identification des clients Dofus en cours, et du compte de chacun.
//
// La ligne de commande d'un client porte
//   -logFile "...\gamesLogs\dofus-dofus3\dofus.<idCompte>.log"
// ou <idCompte> est exactement le champ id d'une entree de USER_ACCOUNTS.
// Relier une fenetre a un compte ne demande donc ni heuristique ni saisie.

const ID_JOURNAL = /dofus\.(\d+)\.log/i;
// Titre en jeu: "Personnage - Classe - 3.6.10.10 - Release". Avant l'entree en
// partie, il n'y a que la version, et un launcher tiers peut le reecrire.
const TITRE_EN_JEU = /^([^-]+?)\s+-\s+([^-]+?)\s+-\s+\d+\.\d+\.\d+\.\d+\s+-\s+/;

function extraireIdCompte(ligne) {
  if (typeof ligne !== 'string') return null;
  const m = ID_JOURNAL.exec(ligne);
  return m === null ? null : Number(m[1]);
}

function extrairePersonnage(titre) {
  if (typeof titre !== 'string') return { personnage: null, classe: null };
  const m = TITRE_EN_JEU.exec(titre);
  if (m === null) return { personnage: null, classe: null };
  return { personnage: m[1].trim(), classe: m[2].trim() };
}

function analyserSortie(json) {
  let brut;
  try { brut = JSON.parse(json); } catch (e) { return []; }
  if (brut === null || brut === undefined) return [];
  // PowerShell rend un objet seul quand il n'y a qu'un process.
  const liste = Array.isArray(brut) ? brut : [brut];
  return liste.map((p) => ({
    pid: p.ProcessId,
    idCompte: extraireIdCompte(p.CommandLine),
    ...extrairePersonnage(p.MainWindowTitle),
  }));
}

// Un seul appel PowerShell rend a la fois la ligne de commande (via CIM) et le
// titre de fenetre (via Get-Process), que Node ne sait pas obtenir seul.
const SCRIPT = [
  '$t = @{};',
  'Get-Process -Name Dofus -ErrorAction SilentlyContinue | ForEach-Object { $t[$_.Id] = $_.MainWindowTitle };',
  "Get-CimInstance Win32_Process -Filter \"Name='Dofus.exe'\" |",
  'ForEach-Object { [pscustomobject]@{ ProcessId = $_.ProcessId; CommandLine = $_.CommandLine; MainWindowTitle = $t[[int]$_.ProcessId] } } |',
  'ConvertTo-Json -Compress',
].join(' ');

function listerClients() {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
      { timeout: 10000, windowsHide: true },
      (err, stdout) => resolve(err ? [] : analyserSortie(stdout)));
  });
}

module.exports = { extraireIdCompte, extrairePersonnage, analyserSortie, listerClients };
```

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

Lancer : `node --test test/comptes-clients.test.js`
Attendu : 8 tests, 8 réussis.

- [ ] **Étape 5 : vérifier sur un vrai client**

Lancer, avec au moins un client Dofus ouvert :
`node -e "require('./src/comptes/clients').listerClients().then(c => console.log(c))"`
Attendu : un tableau avec `pid` et `idCompte` renseignés.
Si aucun client ne tourne, un tableau vide — ce n'est pas un échec.

- [ ] **Étape 6 : commiter**

```bash
git add src/comptes/clients.js test/comptes-clients.test.js
git commit -m "feat(comptes): identifier le compte de chaque client par son -logFile"
```

---

### Tâche 3 : favoris persistants

**Fichiers :**
- Créer : `src/comptes/favoris.js`
- Créer : `test/comptes-favoris.test.js`

**Interfaces :**
- Consomme : rien
- Produit : `class Favoris { constructor(chemin); charger(); estFavori(id); marquer(id, favori); tous(); }`

- [ ] **Étape 1 : écrire les tests qui échouent**

Créer `test/comptes-favoris.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Favoris } = require('../src/comptes/favoris');

function fichierTemporaire(t) {
  const p = path.join(os.tmpdir(), `favoris-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  t.after(() => { try { fs.unlinkSync(p); } catch (e) {} });
  return p;
}

test('sans fichier, aucun compte n est favori', (t) => {
  const f = new Favoris(fichierTemporaire(t));
  f.charger();
  assert.strictEqual(f.estFavori(10612457), false);
  assert.deepStrictEqual(f.tous(), []);
});

test('un favori marqué survit à un rechargement', (t) => {
  const p = fichierTemporaire(t);
  const a = new Favoris(p);
  a.charger();
  a.marquer(10612457, true);

  const b = new Favoris(p);
  b.charger();
  assert.strictEqual(b.estFavori(10612457), true);
  assert.deepStrictEqual(b.tous(), [10612457]);
});

test('démarquer retire le favori', (t) => {
  const p = fichierTemporaire(t);
  const f = new Favoris(p);
  f.charger();
  f.marquer(1, true);
  f.marquer(2, true);
  f.marquer(1, false);
  assert.deepStrictEqual(f.tous(), [2]);
});

// Le fichier ne doit contenir que des identifiants de compte: aucun login,
// aucun jeton, rien qui puisse fuiter s'il est partage.
test('le fichier enregistré ne contient que des identifiants', (t) => {
  const p = fichierTemporaire(t);
  const f = new Favoris(p);
  f.charger();
  f.marquer(10612457, true);
  const contenu = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.deepStrictEqual(Object.keys(contenu), ['favoris']);
  assert.deepStrictEqual(contenu.favoris, [10612457]);
});

test('un fichier corrompu est ignoré sans exception', (t) => {
  const p = fichierTemporaire(t);
  fs.writeFileSync(p, 'pas du json');
  const f = new Favoris(p);
  f.charger();
  assert.deepStrictEqual(f.tous(), []);
});
```

- [ ] **Étape 2 : lancer les tests pour vérifier qu'ils échouent**

Lancer : `node --test test/comptes-favoris.test.js`
Attendu : ÉCHEC, module introuvable.

- [ ] **Étape 3 : écrire l'implémentation**

Créer `src/comptes/favoris.js` :

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Comptes marques par l'utilisateur comme etant a lancer.
//
// Sans effet en phase 1, ou le lancement reste manuel: la selection est
// enregistree des maintenant parce que c'est elle que la phase 4 utilisera.
//
// Le fichier ne contient QUE des identifiants numeriques de compte. Ni login,
// ni jeton, rien qui pose probleme s'il est partage ou sauvegarde.
class Favoris {
  constructor(chemin) {
    this.chemin = chemin;
    this._ids = new Set();
  }

  charger() {
    try {
      const json = JSON.parse(fs.readFileSync(this.chemin, 'utf8'));
      if (Array.isArray(json.favoris)) {
        this._ids = new Set(json.favoris.filter((n) => Number.isInteger(n)));
      }
    } catch (e) {
      // Fichier absent ou corrompu: on repart d'une liste vide plutot que de
      // faire echouer le demarrage de l'application.
      this._ids = new Set();
    }
    return this;
  }

  estFavori(id) {
    return this._ids.has(id);
  }

  marquer(id, favori) {
    if (favori) this._ids.add(id);
    else this._ids.delete(id);
    this._ecrire();
  }

  tous() {
    return [...this._ids];
  }

  _ecrire() {
    try {
      fs.mkdirSync(path.dirname(this.chemin), { recursive: true });
      fs.writeFileSync(this.chemin, JSON.stringify({ favoris: this.tous() }), 'utf8');
    } catch (e) {
      // Perdre les favoris est benin; empecher l'application de fonctionner
      // ne l'est pas.
    }
  }
}

module.exports = { Favoris };
```

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

Lancer : `node --test test/comptes-favoris.test.js`
Attendu : 5 tests, 5 réussis.

- [ ] **Étape 5 : commiter**

```bash
git add src/comptes/favoris.js test/comptes-favoris.test.js
git commit -m "feat(comptes): favoris persistants, identifiants uniquement"
```

---

### Tâche 4 : exclusion d'un compte du OMNI

**Fichiers :**
- Modifier : `src/protocol/compte.js` (classe `EtatCompte`, classe `Comptes`)
- Modifier : `test/compte.test.js`

**Interfaces :**
- Consomme : `EtatCompte`, `Comptes` existants
- Produit : `etat.exclu` (booléen, faux par défaut), et `Comptes.esclaves(pid)`
  qui ne rend plus les comptes exclus.

- [ ] **Étape 1 : écrire les tests qui échouent**

Ajouter à `test/compte.test.js`, avant le dernier test du fichier :

```js
// Un compte exclu reste en jeu et continue d'etre observe, mais ne recoit plus
// les actions du maitre.
test('un compte exclu ne figure plus parmi les esclaves', () => {
  const c = new Comptes();
  for (const pid of [1, 2, 3]) c.ajouter({ pid, port: 8300 + pid });

  assert.strictEqual(c.esclaves(1).length, 2);

  c.get(2).exclu = true;
  const restants = c.esclaves(1);
  assert.strictEqual(restants.length, 1);
  assert.strictEqual(restants[0].pid, 3);
});

test('un compte n est pas exclu par défaut', () => {
  const c = new Comptes();
  assert.strictEqual(c.ajouter({ pid: 1, port: 1 }).exclu, false);
});

// Exclure le maitre n'a pas de sens: il n'est jamais dans sa propre liste.
test('exclure le maître ne change rien', () => {
  const c = new Comptes();
  for (const pid of [1, 2]) c.ajouter({ pid, port: pid });
  c.get(1).exclu = true;
  assert.strictEqual(c.esclaves(1).length, 1);
});
```

- [ ] **Étape 2 : lancer les tests pour vérifier qu'ils échouent**

Lancer : `node --test test/compte.test.js`
Attendu : ÉCHEC — `exclu` vaut `undefined`, et `esclaves` rend encore 2 comptes.

- [ ] **Étape 3 : écrire l'implémentation**

Dans `src/comptes/../protocol/compte.js`, ajouter dans le constructeur de
`EtatCompte`, juste après `this.characterId = null;` :

```js
    // Un compte exclu reste observe — on continue d'apprendre son
    // characterId et ses elements de carte — mais ne recoit plus les actions
    // du maitre. Reactiver l'exclusion ne demande donc aucun rattrapage.
    this.exclu = false;
```

Et remplacer la méthode `esclaves` de la classe `Comptes` :

```js
  esclaves(pidMaitre) {
    return this.tous.filter((e) => e.pid !== pidMaitre && !e.exclu);
  }
```

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

Lancer : `node --test test/compte.test.js`
Attendu : tous réussis, dont les trois nouveaux.

- [ ] **Étape 5 : lancer la suite complète**

Lancer : `node --test --test-timeout=15000`
Attendu : 0 échec. Le superviseur n'est pas modifié : `rejouer()` passe par
`esclaves()`, donc l'exclusion s'applique sans autre changement.

- [ ] **Étape 6 : commiter**

```bash
git add src/protocol/compte.js test/compte.test.js
git commit -m "feat(comptes): exclure un compte du OMNI sans cesser de l observer"
```

---

### Tâche 5 : état affichable, croisement comptes × clients

**Fichiers :**
- Créer : `src/comptes/vue.js`
- Créer : `test/comptes-vue.test.js`

**Interfaces :**
- Consomme : `Compte` (tâche 1), `Client` (tâche 2), `Favoris` (tâche 3)
- Produit : `construireVue({ comptes, clients, intercepte, maitre, exclus, favoris })
  -> Ligne[]` où `Ligne = { id, nickname, personnage, classe, pid, favori,
  exclu, etat, estMaitre }` et
  `etat ∈ { 'hors-ligne', 'intercepte', 'non-intercepte', 'inconnu' }`.

`intercepte` est un `Set` de pid pris en charge par le superviseur. `exclus` et
`favoris` sont des `Set` d'identifiants de compte.

- [ ] **Étape 1 : écrire les tests qui échouent**

Créer `test/comptes-vue.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { construireVue } = require('../src/comptes/vue');

const COMPTES = [
  { id: 1, nickname: 'BrokenLegs', isMain: true },
  { id: 2, nickname: 'squeezie', isMain: false },
  { id: 3, nickname: 'yoplait', isMain: false },
];

function vue(extra = {}) {
  return construireVue({
    comptes: COMPTES,
    clients: [],
    intercepte: new Set(),
    maitre: null,
    exclus: new Set(),
    favoris: new Set(),
    ...extra,
  });
}

test('un compte sans client est hors ligne', () => {
  const lignes = vue();
  assert.strictEqual(lignes.length, 3);
  for (const l of lignes) {
    assert.strictEqual(l.etat, 'hors-ligne');
    assert.strictEqual(l.pid, null);
    assert.strictEqual(l.personnage, null);
  }
});

test('un client pris en charge est intercepté', () => {
  const lignes = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set([100]),
  });
  const l = lignes.find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'intercepte');
  assert.strictEqual(l.pid, 100);
  assert.strictEqual(l.personnage, 'Swaggman');
  assert.strictEqual(l.classe, 'Cra');
});

// Un client lance avant l'application s'est connecte hors du proxy: sa session
// est irrattrapable. L'interface doit le dire, pas le presenter comme normal.
test('un client lancé avant l application est signalé non intercepté', () => {
  const l = vue({
    clients: [{ pid: 100, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' }],
    intercepte: new Set(),
  }).find((x) => x.id === 2);
  assert.strictEqual(l.etat, 'non-intercepte');
});

test('le maître est marqué', () => {
  const lignes = vue({
    clients: [
      { pid: 100, idCompte: 1, personnage: 'Spoony', classe: 'Pandawa' },
      { pid: 200, idCompte: 2, personnage: 'Swaggman', classe: 'Cra' },
    ],
    intercepte: new Set([100, 200]),
    maitre: 200,
  });
  assert.strictEqual(lignes.find((x) => x.id === 1).estMaitre, false);
  assert.strictEqual(lignes.find((x) => x.id === 2).estMaitre, true);
});

test('favoris et exclusions sont reportés', () => {
  const lignes = vue({ favoris: new Set([1, 3]), exclus: new Set([3]) });
  assert.strictEqual(lignes.find((x) => x.id === 1).favori, true);
  assert.strictEqual(lignes.find((x) => x.id === 1).exclu, false);
  assert.strictEqual(lignes.find((x) => x.id === 3).favori, true);
  assert.strictEqual(lignes.find((x) => x.id === 3).exclu, true);
});

// Un client dont le compte n'est pas dans Zaap ne doit pas disparaitre en
// silence: on le montre a part.
test('un client sans compte connu apparaît quand même', () => {
  const lignes = vue({
    clients: [{ pid: 999, idCompte: null, personnage: 'Inconnu', classe: 'Iop' }],
    intercepte: new Set([999]),
  });
  assert.strictEqual(lignes.length, 4);
  const l = lignes[lignes.length - 1];
  assert.strictEqual(l.etat, 'inconnu');
  assert.strictEqual(l.pid, 999);
  assert.strictEqual(l.personnage, 'Inconnu');
});

test('huit comptes en jeu sont tous rendus', () => {
  const comptes = [];
  const clients = [];
  const intercepte = new Set();
  for (let i = 1; i <= 8; i++) {
    comptes.push({ id: i, nickname: `c${i}`, isMain: i === 1 });
    clients.push({ pid: 100 + i, idCompte: i, personnage: `p${i}`, classe: 'Iop' });
    intercepte.add(100 + i);
  }
  const lignes = construireVue({
    comptes, clients, intercepte, maitre: 103,
    exclus: new Set(), favoris: new Set(),
  });
  assert.strictEqual(lignes.length, 8);
  assert.strictEqual(lignes.filter((l) => l.etat === 'intercepte').length, 8);
  assert.strictEqual(lignes.filter((l) => l.estMaitre).length, 1);
});
```

- [ ] **Étape 2 : lancer les tests pour vérifier qu'ils échouent**

Lancer : `node --test test/comptes-vue.test.js`
Attendu : ÉCHEC, module introuvable.

- [ ] **Étape 3 : écrire l'implémentation**

Créer `src/comptes/vue.js` :

```js
'use strict';

// Croise les comptes du launcher et les clients en cours pour produire l'etat
// affichable. Fonction pure: ni fichier, ni process, ni reseau.
//
// Quatre etats possibles, dont le troisieme est le plus important:
//   hors-ligne       le compte existe, aucun client ne tourne
//   intercepte       un client tourne et passe par notre proxy
//   non-intercepte   un client tourne mais s'est connecte avant l'application
//   inconnu          un client tourne sans compte identifiable
//
// Un client lance avant l'application a etabli sa session hors du proxy et ne
// peut pas etre rattrape. Le dire explicitement evite a l'utilisateur de
// chercher pourquoi ce compte ne suit pas.

function ligneBase(compte, favoris, exclus) {
  return {
    id: compte.id,
    nickname: compte.nickname,
    personnage: null,
    classe: null,
    pid: null,
    favori: favoris.has(compte.id),
    exclu: exclus.has(compte.id),
    etat: 'hors-ligne',
    estMaitre: false,
  };
}

function construireVue({ comptes, clients, intercepte, maitre, exclus, favoris }) {
  const parCompte = new Map();
  for (const c of clients) {
    if (c.idCompte !== null && !parCompte.has(c.idCompte)) parCompte.set(c.idCompte, c);
  }

  const lignes = comptes.map((compte) => {
    const ligne = ligneBase(compte, favoris, exclus);
    const client = parCompte.get(compte.id);
    if (!client) return ligne;

    ligne.pid = client.pid;
    ligne.personnage = client.personnage;
    ligne.classe = client.classe;
    ligne.etat = intercepte.has(client.pid) ? 'intercepte' : 'non-intercepte';
    ligne.estMaitre = client.pid === maitre;
    return ligne;
  });

  // Les clients sans compte connu sont ajoutes a la fin plutot qu'ignores.
  for (const c of clients) {
    if (c.idCompte !== null) continue;
    lignes.push({
      id: null,
      nickname: `client ${c.pid}`,
      personnage: c.personnage,
      classe: c.classe,
      pid: c.pid,
      favori: false,
      exclu: false,
      etat: 'inconnu',
      estMaitre: c.pid === maitre,
    });
  }

  return lignes;
}

module.exports = { construireVue };
```

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

Lancer : `node --test test/comptes-vue.test.js`
Attendu : 7 tests, 7 réussis.

- [ ] **Étape 5 : lancer la suite complète**

Lancer : `node --test --test-timeout=15000`
Attendu : 0 échec.

- [ ] **Étape 6 : commiter**

```bash
git add src/comptes/vue.js test/comptes-vue.test.js
git commit -m "feat(comptes): etat affichable, quatre etats dont non-intercepte"
```

---

### Tâche 6 : coquille Electron

**Fichiers :**
- Créer : `desktop/main.js`
- Créer : `desktop/preload.js`
- Créer : `desktop/index.html`
- Modifier : `package.json` (script `app`, devDependency `electron`)

**Interfaces :**
- Consomme : `lireComptes` (T1), `listerClients` (T2), `Favoris` (T3),
  `EtatCompte.exclu` (T4), `construireVue` (T5), `Superviseur` (existant)
- Produit : l'application lançable par `npm run app`

- [ ] **Étape 1 : installer Electron**

```bash
npm install --save-dev electron
node node_modules/electron/install.js
```

Le second appel est nécessaire : la politique `allow-scripts` de cette machine
n'exécute pas les postinstall, et le binaire Electron manquerait.

Vérifier : `npx electron --version` doit afficher un numéro de version.

- [ ] **Étape 2 : écrire le preload**

Créer `desktop/preload.js` :

```js
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Le renderer n'a acces ni au reseau, ni aux process, ni au disque. Il recoit
// un etat et emet trois ordres, rien d'autre.
contextBridge.exposeInMainWorld('app', {
  surEtat: (rappel) => ipcRenderer.on('etat', (_e, etat) => rappel(etat)),
  basculerDuplication: (actif) => ipcRenderer.invoke('basculerDuplication', actif),
  exclureCompte: (idCompte, exclu) => ipcRenderer.invoke('exclureCompte', idCompte, exclu),
  marquerFavori: (idCompte, favori) => ipcRenderer.invoke('marquerFavori', idCompte, favori),
});
```

- [ ] **Étape 3 : écrire le processus principal**

Créer `desktop/main.js` :

```js
'use strict';
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const { Superviseur } = require('../src/superviseur');
const { lireComptes } = require('../src/comptes/zaap');
const { listerClients } = require('../src/comptes/clients');
const { construireVue } = require('../src/comptes/vue');
const { Favoris } = require('../src/comptes/favoris');
const { findDofusProcesses } = require('../src/injector');

const PERIODE_PROCESS = 500;    // prise en charge des nouveaux clients
const PERIODE_VUE = 2000;       // rafraichissement de la liste affichee

let fenetre = null;
let superviseur = null;
let favoris = null;
let comptes = [];
let erreurComptes = null;
const prisEnCharge = new Set();

function journal(pid, texte) {
  console.log(`[${pid}] ${texte}`);
}

// Prend en charge tout nouveau client. La connexion au serveur de jeu s'ouvre
// des l'ecran de connexion: un client deja lance ne peut plus etre rattrape,
// d'ou l'etat « non intercepte » plutot qu'une tentative vouee a l'echec.
async function balayerProcess() {
  let procs = [];
  try { procs = await findDofusProcesses(); } catch (e) { return; }

  const vivants = new Set(procs.map((p) => p.pid));
  for (const pid of [...prisEnCharge]) {
    if (vivants.has(pid)) continue;
    prisEnCharge.delete(pid);
    await superviseur.retirer(pid);
  }

  for (const p of procs) {
    if (prisEnCharge.has(p.pid) || prisEnCharge.size >= 8) continue;
    prisEnCharge.add(p.pid);
    try {
      await superviseur.ajouter({ pid: p.pid, nom: p.name });
    } catch (e) {
      journal(p.pid, `attache impossible : ${e.message}`);
    }
  }
}

async function envoyerEtat() {
  if (fenetre === null || fenetre.isDestroyed()) return;
  const clients = await listerClients();
  const exclus = new Set(
    superviseur.comptes.tous.filter((e) => e.exclu).map((e) => pidVersCompte(e.pid, clients)),
  );
  fenetre.webContents.send('etat', {
    duplication: superviseur.arme,
    erreurComptes,
    lignes: construireVue({
      comptes,
      clients,
      intercepte: prisEnCharge,
      maitre: superviseur.maitre,
      exclus,
      favoris: new Set(favoris.tous()),
    }),
  });
}

function pidVersCompte(pid, clients) {
  const c = clients.find((x) => x.pid === pid);
  return c ? c.idCompte : null;
}

function compteVersPid(idCompte, clients) {
  const c = clients.find((x) => x.idCompte === idCompte);
  return c ? c.pid : null;
}

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 720,
    height: 560,
    title: 'OMNI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  fenetre.removeMenu();
  fenetre.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  const lecture = lireComptes();
  comptes = lecture.comptes;
  erreurComptes = lecture.erreur;

  favoris = new Favoris(path.join(app.getPath('userData'), 'favoris.json')).charger();
  superviseur = new Superviseur({ arme: false, onJournal: journal });

  creerFenetre();
  setInterval(balayerProcess, PERIODE_PROCESS);
  setInterval(envoyerEtat, PERIODE_VUE);
  await balayerProcess();
  await envoyerEtat();
});

ipcMain.handle('basculerDuplication', async (_e, actif) => {
  superviseur.arme = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('exclureCompte', async (_e, idCompte, exclu) => {
  const clients = await listerClients();
  const pid = compteVersPid(idCompte, clients);
  const etat = pid === null ? null : superviseur.comptes.get(pid);
  if (etat) etat.exclu = Boolean(exclu);
  await envoyerEtat();
});

ipcMain.handle('marquerFavori', async (_e, idCompte, favori) => {
  favoris.marquer(idCompte, Boolean(favori));
  await envoyerEtat();
});

app.on('window-all-closed', async () => {
  if (superviseur) await superviseur.arreter();
  app.quit();
});
```

- [ ] **Étape 4 : écrire l'interface**

Créer `desktop/index.html` :

```html
<!doctype html>
<meta charset="utf-8">
<title>OMNI</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px system-ui, sans-serif; background: #16181d; color: #e6e8ec; }
  header { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid #2a2e37; }
  h1 { font-size: 15px; margin: 0; font-weight: 600; }
  #bascule { margin-left: auto; padding: 7px 16px; border: 0; border-radius: 6px;
             background: #3a3f4b; color: #e6e8ec; cursor: pointer; font: inherit; }
  #bascule.actif { background: #2e7d4f; }
  #resume { color: #8b93a3; font-size: 13px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-bottom: 1px solid #22252c; }
  li.hors-ligne { opacity: .45; }
  .etoile { cursor: pointer; font-size: 16px; color: #6b7280; user-select: none; }
  .etoile.on { color: #e0b040; }
  .nom { width: 130px; font-weight: 600; }
  .perso { flex: 1; color: #b9c0cc; }
  .badge { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: #2a2e37; color: #9aa3b2; }
  .badge.maitre { background: #2e5d8a; color: #dbeafe; }
  .badge.alerte { background: #7a3b2e; color: #ffdcd2; }
  #erreur { padding: 10px 18px; background: #7a3b2e; color: #ffdcd2; }
  #erreur:empty { display: none; }
</style>
<header>
  <h1>OMNI</h1>
  <span id="resume"></span>
  <button id="bascule">INACTIF</button>
</header>
<div id="erreur"></div>
<ul id="liste"></ul>
<script>
  const LIBELLES = {
    'hors-ligne': 'hors ligne',
    'intercepte': 'suit',
    'non-intercepte': 'non intercepté — relance ce client',
    'inconnu': 'compte inconnu',
  };
  let actif = false;

  document.getElementById('bascule').addEventListener('click', () => {
    actif = !actif;
    window.app.basculerDuplication(actif);
  });

  window.app.surEtat((etat) => {
    actif = etat.duplication;
    const b = document.getElementById('bascule');
    b.textContent = actif ? 'ACTIF' : 'INACTIF';
    b.classList.toggle('actif', actif);

    document.getElementById('erreur').textContent = etat.erreurComptes || '';

    const enJeu = etat.lignes.filter((l) => l.etat === 'intercepte').length;
    document.getElementById('resume').textContent =
      `${enJeu} compte${enJeu > 1 ? 's' : ''} en jeu`;

    const liste = document.getElementById('liste');
    liste.textContent = '';
    for (const l of etat.lignes) {
      const li = document.createElement('li');
      li.className = l.etat;

      const etoile = document.createElement('span');
      etoile.className = 'etoile' + (l.favori ? ' on' : '');
      etoile.textContent = l.favori ? '★' : '☆';
      etoile.title = 'à lancer';
      if (l.id !== null) {
        etoile.addEventListener('click', () => window.app.marquerFavori(l.id, !l.favori));
      }

      const suit = document.createElement('input');
      suit.type = 'checkbox';
      suit.checked = !l.exclu;
      suit.title = 'participe au OMNI';
      suit.disabled = l.id === null || l.etat !== 'intercepte';
      suit.addEventListener('change', () => window.app.exclureCompte(l.id, !suit.checked));

      const nom = document.createElement('span');
      nom.className = 'nom';
      nom.textContent = l.nickname;

      const perso = document.createElement('span');
      perso.className = 'perso';
      perso.textContent = l.personnage ? `${l.personnage} — ${l.classe}` : '—';

      const badge = document.createElement('span');
      badge.className = 'badge'
        + (l.estMaitre ? ' maitre' : '')
        + (l.etat === 'non-intercepte' ? ' alerte' : '');
      badge.textContent = l.estMaitre ? 'maître' : LIBELLES[l.etat];

      li.append(etoile, suit, nom, perso, badge);
      liste.append(li);
    }
  });
</script>
```

- [ ] **Étape 5 : ajouter le script de lancement**

Dans `package.json`, ajouter à `scripts` :

```json
    "app": "electron desktop/main.js"
```

- [ ] **Étape 6 : lancer la suite complète**

Lancer : `node --test --test-timeout=15000`
Attendu : 0 échec. La coquille Electron n'ajoute pas de test : comme les agents
Frida du dépôt, elle se vérifie en la lançant.

- [ ] **Étape 7 : vérifier l'application**

Lancer : `npm run app`

Attendu, sans aucun client Dofus ouvert : une fenêtre listant les dix comptes,
tous en « hors ligne », l'interrupteur sur INACTIF.

Puis lancer un client Dofus depuis le launcher Ankama et attendre trois
secondes : sa ligne doit passer à « suit », avec le nom du personnage une fois
en jeu. Cliquer l'étoile, fermer l'application, la relancer : l'étoile est
conservée.

- [ ] **Étape 8 : commiter**

```bash
git add desktop package.json package-lock.json
git commit -m "feat(desktop): application Electron, liste des comptes et interrupteurs"
```

---

### Tâche 7 : empaquetage en exécutable

**Fichiers :**
- Modifier : `package.json` (script `pack`, devDependency `@electron/packager`)
- Créer : `.gitignore` (entrée `desktop/dist`) si absent

**Interfaces :**
- Consomme : l'application de la tâche 6
- Produit : `desktop/dist/OMNI-win32-x64/OMNI.exe`

- [ ] **Étape 1 : installer l'empaqueteur**

```bash
npm install --save-dev @electron/packager
```

`electron-builder` est **interdit** ici : son archive winCodeSign contient des
liens symboliques macOS que Windows refuse sans le mode développeur, et il la
ré-extrait à chaque essai — pré-extraire ne sert à rien.

- [ ] **Étape 2 : ajouter le script**

Dans `package.json`, ajouter à `scripts` :

```json
    "pack": "electron-packager . OMNI --platform=win32 --arch=x64 --out=desktop/dist --overwrite --ignore=\"^/(docs|test)\""
```

- [ ] **Étape 3 : ignorer la sortie de build**

Ajouter à `.gitignore` (le créer s'il n'existe pas) :

```
node_modules
desktop/dist
```

- [ ] **Étape 4 : empaqueter**

Lancer : `npm run pack`
Attendu : `desktop/dist/OMNI-win32-x64/OMNI.exe` existe.

- [ ] **Étape 5 : vérifier l'exécutable**

Lancer `desktop/dist/OMNI-win32-x64/OMNI.exe` directement.
Attendu : la même fenêtre qu'en développement, listant les comptes.

- [ ] **Étape 6 : commiter**

```bash
git add package.json package-lock.json .gitignore
git commit -m "build: empaquetage en executable avec @electron/packager"
```

---

## Ce que la phase 1 ne fait pas

Le lancement des comptes depuis l'application est l'objet des phases 2 à 4.
Les favoris sont enregistrés mais sans effet : la case étoile prépare la
phase 4 sans rien promettre à l'utilisateur d'ici là.
