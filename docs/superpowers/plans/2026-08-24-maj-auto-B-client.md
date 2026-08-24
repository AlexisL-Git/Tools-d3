# Mise à jour auto — Sous-projet B : le client (amorceur, clé, versions)

> **Pour les agents :** SOUS-SKILL REQUISE — `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans`, tâche par tâche. Cases à cocher pour le suivi.

**Objectif :** que l'application OMNI démarre sur un amorceur qui demande une clé au premier lancement, va chercher la dernière version publiée, la vérifie, l'installe hors du paquet, et sait revenir en arrière toute seule si elle plante.

**Architecture :** `resources/app.asar` ne contient plus que l'amorceur. Le code applicatif (`src/`, `desktop/`) vit dans `%APPDATA%\OMNI\versions\<version>\` et se remplace à distance. L'amorceur est la **seule pièce non actualisable** : toute erreur dedans se corrige en redistribuant 482 Mo. Il ne dépend que de Node et d'Electron — **aucune dépendance npm**, y compris pour lire une archive tar.

**Pile :** Node ≥18 (modules natifs seuls : `node:zlib`, `node:crypto`, `node:fs`, `fetch`), Electron 43, `node:test`.

**Sous-projet A (le serveur) est livré et vérifié en production :** service sur `https://paquets-maj.vercel.app`, base Neon `paquets-maj-db`. Les trois routes existent, mesurées : `/api/manifeste` (en-tête `x-cle`) rend `{version, sha256, actif, message}` ou 404 ; `/api/paquet` (en-tête `x-cle`) rend l'archive `application/gzip` ou 404 ; `/api/admin` sert le panneau. **Le manifeste ne porte PAS de champ `url`** — le spec l'annonçait, l'implémentation sert l'archive sur une route fixe. Le client demande donc `/api/paquet`, sans URL à suivre.

## Contraintes globales

Elles s'appliquent à **toutes** les tâches.

- **`npm test` à la racine du dépôt est le seul point d'entrée.** Vérifier que la suite **imprime son total** (`ℹ tests N`). Elle est à **351 tests** avant ce plan. Mesure faite : `node --test` à la racine descend AUSSI dans `serveur-maj/test/` (326 + 25). Les tests du serveur y passent donc deux fois, une par suite — sans dommage, mais si `serveur-maj/node_modules` manque, c'est la suite de la racine qui casse.
- **L'amorceur n'a le droit à aucune dépendance npm.** `frida` et `protobufjs` restent au paquet et servent au code versionné, pas à lui. Un `require` d'un paquet npm dans `amorceur/` est un défaut à refuser en revue.
- **Aucun échec ne laisse l'application morte.** Vercel injoignable, manifeste illisible, SHA-256 faux, extraction ratée : on démarre sur la version en place, sans bruit. Le seul cas qui refuse le démarrage est volontaire : clé invalide, ou coupe-circuit `actif:false`.
- **La clé est stockée en clair** dans `%APPDATA%\OMNI\cle.txt`. La chiffrer serait du théâtre : l'application doit pouvoir la lire, donc l'ami aussi. Le levier de contrôle est la révocation côté serveur.
- **Le paquet ne contient aucune clé** et aucun mot de passe admin.
- **Aucune extraction hors du dossier de destination.** Un chemin absolu ou contenant `..` dans l'archive est un rejet, pas un avertissement.
- **Windows / PowerShell** : ne pas chaîner git avec `if ($?)`. Commits en français, à l'impératif, sans accent dans le sujet.
- **`electron-builder` est interdit sur cette machine.** Le paquet se fabrique avec `@electron/packager` (`npm run pack`, déjà en place). `npm install` n'exécute pas les postinstall : `node node_modules/electron/install.js` reste obligatoire.

## Structure des fichiers

| fichier | responsabilité | tâche |
|---|---|---|
| `amorceur/depot.js` | le stockage versionné : `courante.json`, témoin d'essai, refusées | 1 |
| `amorceur/archive.js` | tar+gzip : lire, écrire, empreinte SHA-256 | 2 |
| `amorceur/canal.js` | parler au service : manifeste, téléchargement, vérification | 3 |
| `amorceur/cle.js` | lire et écrire `cle.txt` | 4 |
| `amorceur/demarrage.js` | la séquence, en logique pure et injectable | 5 |
| `amorceur/ecran.js` + `amorceur/ecran.html` | la fenêtre de saisie de clé et les messages d'arrêt | 6 |
| `amorceur/electron.js` | le point d'entrée réel du paquet : câble tout à Electron | 7 |
| `outils/faire-paquet-code.js` | fabriquer l'archive d'une version à publier | 8 |
| `test/amorceur/*.test.js` | les tests de chaque module | 1-5, 8 |

**Ce que l'amorceur NE fait pas :** il ne connaît ni Frida, ni le proxy, ni les comptes. Il charge un dossier et s'efface.

---

### Tâche 1 : le stockage versionné

**Fichiers :**
- Créer : `amorceur/depot.js`
- Créer : `test/amorceur/depot.test.js`

**Interfaces :**
- Produit :
  - `creerDepot(racine)` → `{ lire, ecrire, dossierDe, versionsInstallees, choisirVersion, poserTemoin, effacerTemoin, refuser }`.
  - `lire()` → `{ version, essai, refusees }` ; sur fichier absent ou illisible, rend `{ version: null, essai: null, refusees: [] }` — **jamais d'exception**.
  - `ecrire(etat)` → écrit `courante.json` (fichier temporaire puis `renameSync`).
  - `dossierDe(version)` → `<racine>/versions/<version>`.
  - `versionsInstallees()` → versions présentes sur le disque, triées par ordre croissant **de version**.
  - `choisirVersion()` → `{ version, refusee }` : applique la règle du témoin.
  - `poserTemoin(version)` / `effacerTemoin()` / `refuser(version)`.
  - `comparerVersions(a, b)` → nombre, exporté aussi.

**La règle du témoin, en clair :** `poserTemoin` est appelé AVANT de charger une version ; `effacerTemoin` quand l'application atteint son état prêt. Un témoin encore présent au lancement suivant prouve que la version n'a pas atteint cet état.

**Comparaison de versions :** `comparerVersions('0.10.0', '0.9.0') > 0`. Un tri lexicographique placerait `0.10.0` avant `0.9.0` et servirait une vieille version pour toujours — défaut à refuser en revue.

- [ ] **Étape 1 : écrire les tests**

`test/amorceur/depot.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { creerDepot, comparerVersions } = require('../../amorceur/depot');

function racineTemporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'depot-'));
}

function installer(racine, version) {
  const d = path.join(racine, 'versions', version);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'marqueur.txt'), version);
  return d;
}

test('un depot vierge ne plante pas et ne propose aucune version', () => {
  const d = creerDepot(racineTemporaire());
  assert.deepStrictEqual(d.lire(), { version: null, essai: null, refusees: [] });
  assert.strictEqual(d.choisirVersion().version, null);
});

test('un courante.json illisible est traite comme vierge', () => {
  const racine = racineTemporaire();
  fs.mkdirSync(path.join(racine, 'versions'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'versions', 'courante.json'), '{ ceci n est pas du json');
  const d = creerDepot(racine);
  assert.strictEqual(d.lire().version, null);
});

test('choisirVersion rend la version courante quand aucun temoin ne traine', () => {
  const racine = racineTemporaire();
  installer(racine, '0.2.0');
  const d = creerDepot(racine);
  d.ecrire({ version: '0.2.0', essai: null, refusees: [] });
  assert.deepStrictEqual(d.choisirVersion(), { version: '0.2.0', refusee: null });
});

test('un temoin reste fait refuser la version et revenir a la precedente', () => {
  const racine = racineTemporaire();
  installer(racine, '0.2.0');
  installer(racine, '0.3.0');
  const d = creerDepot(racine);
  d.ecrire({ version: '0.3.0', essai: '0.3.0', refusees: [] });
  const choix = d.choisirVersion();
  assert.deepStrictEqual(choix, { version: '0.2.0', refusee: '0.3.0' });
  // La decision est persistee: un relancement ne la reprend pas a zero.
  assert.deepStrictEqual(d.lire().refusees, ['0.3.0']);
  assert.strictEqual(d.lire().essai, null);
  assert.strictEqual(d.lire().version, '0.2.0');
});

test('une version refusee n est plus jamais choisie', () => {
  const racine = racineTemporaire();
  installer(racine, '0.2.0');
  installer(racine, '0.3.0');
  const d = creerDepot(racine);
  d.ecrire({ version: '0.2.0', essai: null, refusees: ['0.3.0'] });
  assert.strictEqual(d.choisirVersion().version, '0.2.0');
});

test('si toutes les versions installees sont refusees, on rend null plutot que de mentir', () => {
  const racine = racineTemporaire();
  installer(racine, '0.2.0');
  const d = creerDepot(racine);
  d.ecrire({ version: '0.2.0', essai: '0.2.0', refusees: [] });
  assert.strictEqual(d.choisirVersion().version, null);
});

test('versionsInstallees trie par version, pas par chaine', () => {
  const racine = racineTemporaire();
  installer(racine, '0.9.0');
  installer(racine, '0.10.0');
  const d = creerDepot(racine);
  assert.deepStrictEqual(d.versionsInstallees(), ['0.9.0', '0.10.0']);
});

test('comparerVersions traite les nombres comme des nombres', () => {
  assert.ok(comparerVersions('0.10.0', '0.9.0') > 0);
  assert.ok(comparerVersions('1.0.0', '0.99.99') > 0);
  assert.strictEqual(comparerVersions('0.3.0', '0.3.0'), 0);
});

test('le temoin se pose et s efface', () => {
  const racine = racineTemporaire();
  const d = creerDepot(racine);
  d.poserTemoin('0.4.0');
  assert.strictEqual(d.lire().essai, '0.4.0');
  d.effacerTemoin();
  assert.strictEqual(d.lire().essai, null);
});

test('refuser n ajoute pas deux fois la meme version', () => {
  const d = creerDepot(racineTemporaire());
  d.refuser('0.5.0');
  d.refuser('0.5.0');
  assert.deepStrictEqual(d.lire().refusees, ['0.5.0']);
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

Run: `npm test`
Attendu : `Cannot find module '../../amorceur/depot'`.

- [ ] **Étape 3 : implémenter**

`amorceur/depot.js` :

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Compare deux numeros de version champ par champ, en nombres. Un tri de
// chaines placerait '0.10.0' AVANT '0.9.0' et servirait une vieille version
// pour toujours.
function comparerVersions(a, b) {
  const ca = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const cb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(ca.length, cb.length); i += 1) {
    const d = (ca[i] || 0) - (cb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function creerDepot(racine) {
  const dossierVersions = path.join(racine, 'versions');
  const fichierEtat = path.join(dossierVersions, 'courante.json');

  // Toute lecture rate en douceur: un etat illisible vaut un etat vierge. Un
  // amorceur qui leve ici laisse l'application morte, ce que rien ne rattrape.
  function lire() {
    try {
      const brut = JSON.parse(fs.readFileSync(fichierEtat, 'utf8'));
      return {
        version: typeof brut.version === 'string' ? brut.version : null,
        essai: typeof brut.essai === 'string' ? brut.essai : null,
        refusees: Array.isArray(brut.refusees) ? brut.refusees.filter((x) => typeof x === 'string') : [],
      };
    } catch (e) {
      return { version: null, essai: null, refusees: [] };
    }
  }

  // Ecriture atomique: fichier temporaire puis renommage. Une coupure au
  // mauvais moment laisserait sinon un JSON tronque, donc un depot vierge,
  // donc une version reinstallee pour rien.
  function ecrire(etat) {
    fs.mkdirSync(dossierVersions, { recursive: true });
    const tmp = fichierEtat + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(etat, null, 2));
    fs.renameSync(tmp, fichierEtat);
  }

  function dossierDe(version) {
    return path.join(dossierVersions, version);
  }

  function versionsInstallees() {
    try {
      return fs.readdirSync(dossierVersions, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort(comparerVersions);
    } catch (e) {
      return [];
    }
  }

  function poserTemoin(version) {
    ecrire({ ...lire(), essai: version });
  }

  function effacerTemoin() {
    ecrire({ ...lire(), essai: null });
  }

  function refuser(version) {
    const etat = lire();
    if (!etat.refusees.includes(version)) etat.refusees.push(version);
    ecrire(etat);
  }

  // Applique la regle du temoin et rend la version a charger.
  function choisirVersion() {
    const etat = lire();
    let refusee = null;
    if (etat.essai) {
      // Le temoin est reste: la version n'a pas atteint son etat pret au
      // lancement precedent. Elle est declaree mauvaise, definitivement.
      refusee = etat.essai;
      if (!etat.refusees.includes(refusee)) etat.refusees.push(refusee);
      etat.essai = null;
    }
    const candidates = versionsInstallees().filter((v) => !etat.refusees.includes(v));
    const version = candidates.length ? candidates[candidates.length - 1] : null;
    etat.version = version;
    ecrire(etat);
    return { version, refusee };
  }

  return { lire, ecrire, dossierDe, versionsInstallees, choisirVersion, poserTemoin, effacerTemoin, refuser };
}

module.exports = { creerDepot, comparerVersions };
```

- [ ] **Étape 4 : lancer, vérifier le passage, commiter**

```bash
npm test
git add amorceur/depot.js test/amorceur/depot.test.js
git commit -m "feat(maj): stockage versionne, temoin d'essai et versions refusees"
```

---

### Tâche 2 : l'archive, sans aucune dépendance

**Fichiers :**
- Créer : `amorceur/archive.js`
- Créer : `test/amorceur/archive.test.js`

**Interfaces :**
- Produit :
  - `ecrireArchive(fichiers)` → `Buffer` gzip. `fichiers` = `[{ chemin: 'desktop/main.js', contenu: Buffer }]`, chemins **relatifs, en barres obliques**.
  - `lireArchive(buffer)` → `[{ chemin, contenu }]`. Lève sur archive invalide.
  - `extraire(buffer, destination)` → écrit les fichiers sous `destination`, crée les dossiers, **refuse** tout chemin absolu ou contenant `..`.
  - `empreinte(buffer)` → SHA-256 en hexadécimal minuscule.

**Pourquoi écrire un lecteur tar au lieu d'installer `tar` :** l'amorceur ne peut pas se mettre à jour lui-même et ne doit dépendre que de Node. Le format tar tient en 512 octets d'en-tête par fichier. `node:zlib` fournit le gzip. Écrire les deux moitiés garantit qu'elles se comprennent — un `tar.exe` système émet des en-têtes pax que notre lecteur ignorerait.

**Format, pour l'implémenteur :** en-tête de 512 octets — `nom[100]`, `mode[8]`, `uid[8]`, `gid[8]`, `taille[12]` en octal, `mtime[12]` en octal, `somme[8]`, `type[1]` (`'0'` = fichier), `lien[100]`, `magic[6]` = `ustar\0`, `version[2]` = `00`. La somme de contrôle est la somme de tous les octets de l'en-tête, le champ `somme` étant compté comme huit espaces, écrite en octal sur 6 chiffres suivis de `\0` et d'un espace. Le contenu suit, complété à un multiple de 512. L'archive finit par 1024 octets nuls.

**Le piège que ces tests verrouillent :** une archive qui contient `..\..\Windows\system32\x.dll` écrirait hors du dossier de destination. C'est la faille dite *zip slip*, et elle se referme par une vérification de préfixe **après** résolution du chemin, pas par une recherche de `..` dans la chaîne brute.

- [ ] **Étape 1 : écrire les tests**

`test/amorceur/archive.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ecrireArchive, lireArchive, extraire, empreinte } = require('../../amorceur/archive');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'archive-'));
}

test('aller-retour: ce qui sort est exactement ce qui est entre', () => {
  const fichiers = [
    { chemin: 'desktop/main.js', contenu: Buffer.from("console.log('salut');\n") },
    { chemin: 'src/vide.js', contenu: Buffer.alloc(0) },
    // Un contenu plus grand qu'un bloc, pour verifier le remplissage a 512.
    { chemin: 'src/gros.bin', contenu: crypto.randomBytes(1500) },
  ];
  const lu = lireArchive(ecrireArchive(fichiers));
  assert.strictEqual(lu.length, 3);
  for (const attendu of fichiers) {
    const trouve = lu.find((f) => f.chemin === attendu.chemin);
    assert.ok(trouve, 'fichier absent: ' + attendu.chemin);
    assert.ok(trouve.contenu.equals(attendu.contenu), 'contenu different: ' + attendu.chemin);
  }
});

test('les caracteres non ASCII du contenu survivent', () => {
  const contenu = Buffer.from('délai réglé à 0,5 s — échange accepté\n', 'utf8');
  const lu = lireArchive(ecrireArchive([{ chemin: 'a.txt', contenu }]));
  assert.ok(lu[0].contenu.equals(contenu));
});

test('extraire ecrit les fichiers et cree les dossiers', () => {
  const dest = tmp();
  const buf = ecrireArchive([{ chemin: 'src/comptes/vue.js', contenu: Buffer.from('x') }]);
  extraire(buf, dest);
  assert.strictEqual(fs.readFileSync(path.join(dest, 'src', 'comptes', 'vue.js'), 'utf8'), 'x');
});

test('un chemin qui remonte hors de la destination est refuse', () => {
  const dest = tmp();
  const buf = ecrireArchive([{ chemin: '../evade.txt', contenu: Buffer.from('non') }]);
  assert.throws(() => extraire(buf, dest), /hors du dossier/i);
  assert.strictEqual(fs.existsSync(path.join(path.dirname(dest), 'evade.txt')), false);
});

test('un chemin absolu est refuse', () => {
  const dest = tmp();
  const buf = ecrireArchive([{ chemin: '/etc/passwd', contenu: Buffer.from('non') }]);
  assert.throws(() => extraire(buf, dest), /hors du dossier|absolu/i);
});

test('une archive tronquee leve au lieu de rendre des fichiers a moitie lus', () => {
  const buf = ecrireArchive([{ chemin: 'a.txt', contenu: Buffer.alloc(2000, 65) }]);
  const zlib = require('node:zlib');
  const brut = zlib.gunzipSync(buf);
  const tronque = zlib.gzipSync(brut.subarray(0, brut.length - 1024));
  assert.throws(() => lireArchive(tronque));
});

test('un buffer qui n est pas du gzip leve', () => {
  assert.throws(() => lireArchive(Buffer.from('ceci n est pas une archive')));
});

test('empreinte rend le sha256 hexadecimal du buffer', () => {
  const b = Buffer.from('paquet-test');
  const attendu = crypto.createHash('sha256').update(b).digest('hex');
  assert.strictEqual(empreinte(b), attendu);
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

Run: `npm test`
Attendu : `Cannot find module '../../amorceur/archive'`.

- [ ] **Étape 3 : implémenter**

`amorceur/archive.js` :

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const BLOC = 512;

function octal(n, largeur) {
  // Le champ se termine par un NUL: on ecrit largeur-1 chiffres.
  return n.toString(8).padStart(largeur - 1, '0') + '\0';
}

function enTete(chemin, taille) {
  const h = Buffer.alloc(BLOC, 0);
  const nom = Buffer.from(chemin, 'utf8');
  if (nom.length > 100) throw new Error('chemin trop long pour un en-tete tar: ' + chemin);
  nom.copy(h, 0);
  h.write(octal(0o644, 8), 100);          // mode
  h.write(octal(0, 8), 108);              // uid
  h.write(octal(0, 8), 116);              // gid
  h.write(octal(taille, 12), 124);        // taille
  h.write(octal(0, 12), 136);             // mtime: fixe, pour que deux archives
                                          // du meme code aient le meme sha256
  h.write('        ', 148);               // somme: huit espaces pendant le calcul
  h.write('0', 156);                      // type: fichier ordinaire
  h.write('ustar\0', 257);
  h.write('00', 263);
  let somme = 0;
  for (const o of h) somme += o;
  h.write(somme.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

function ecrireArchive(fichiers) {
  const morceaux = [];
  for (const f of fichiers) {
    const contenu = Buffer.isBuffer(f.contenu) ? f.contenu : Buffer.from(f.contenu);
    morceaux.push(enTete(f.chemin, contenu.length));
    morceaux.push(contenu);
    const reste = contenu.length % BLOC;
    if (reste !== 0) morceaux.push(Buffer.alloc(BLOC - reste, 0));
  }
  morceaux.push(Buffer.alloc(BLOC * 2, 0));   // fin d'archive
  return zlib.gzipSync(Buffer.concat(morceaux));
}

function chaine(buf, debut, longueur) {
  const zone = buf.subarray(debut, debut + longueur);
  const fin = zone.indexOf(0);
  return zone.subarray(0, fin === -1 ? zone.length : fin).toString('utf8');
}

function lireArchive(gz) {
  const brut = zlib.gunzipSync(gz);   // leve si ce n'est pas du gzip
  const fichiers = [];
  let i = 0;
  while (i + BLOC <= brut.length) {
    const h = brut.subarray(i, i + BLOC);
    if (h.every((o) => o === 0)) break;        // bloc nul: fin d'archive
    const chemin = chaine(h, 0, 100);
    const taille = parseInt(chaine(h, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156]);
    i += BLOC;
    if (i + taille > brut.length) throw new Error('archive tronquee: ' + chemin);
    if (type === '0' || type === '\0') {
      fichiers.push({ chemin, contenu: Buffer.from(brut.subarray(i, i + taille)) });
    }
    i += Math.ceil(taille / BLOC) * BLOC;
  }
  return fichiers;
}

// Refuse tout ce qui sortirait de `destination`. La verification porte sur le
// chemin RESOLU, pas sur la chaine brute: '..' peut se cacher derriere un
// separateur inhabituel, un chemin resolu ne ment pas.
function cheminSur(destination, chemin) {
  const cible = path.resolve(destination, chemin);
  const racine = path.resolve(destination) + path.sep;
  if (!cible.startsWith(racine)) throw new Error('chemin hors du dossier de destination: ' + chemin);
  return cible;
}

function extraire(gz, destination) {
  const fichiers = lireArchive(gz);
  // On verifie TOUS les chemins avant d'ecrire quoi que ce soit: une archive
  // moitie extraite est pire qu'une archive refusee.
  const cibles = fichiers.map((f) => ({ cible: cheminSur(destination, f.chemin), contenu: f.contenu }));
  for (const c of cibles) {
    fs.mkdirSync(path.dirname(c.cible), { recursive: true });
    fs.writeFileSync(c.cible, c.contenu);
  }
  return cibles.length;
}

function empreinte(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = { ecrireArchive, lireArchive, extraire, empreinte };
```

- [ ] **Étape 4 : lancer, vérifier le passage, commiter**

```bash
npm test
git add amorceur/archive.js test/amorceur/archive.test.js
git commit -m "feat(maj): lecteur et ecrivain tar+gzip sans dependance"
```

---

### Tâche 3 : le canal, côté client

**Fichiers :**
- Créer : `amorceur/canal.js`
- Créer : `test/amorceur/canal.test.js`

**Interfaces :**
- Consomme : `empreinte` (T2).
- Produit :
  - `creerCanal({ base, chercher })` → `{ manifeste, paquet }`. `base` = `https://paquets-maj.vercel.app`. `chercher` est injecté (`globalThis.fetch` par défaut) pour que les tests n'ouvrent aucune socket.
  - `manifeste(cle)` → `{ etat: 'ok', manifeste }` | `{ etat: 'refuse' }` (404 : clé inconnue ou révoquée) | `{ etat: 'injoignable', raison }`.
  - `paquet(cle, sha256Attendu)` → `{ etat: 'ok', archive }` | `{ etat: 'refuse' }` | `{ etat: 'injoignable', raison }` | `{ etat: 'corrompu', obtenu }`.

**Les trois états ne se confondent pas.** « Refusé » vient du serveur et arrête l'application ; « injoignable » est un incident réseau et la laisse démarrer sur place. Confondre les deux ferait qu'une coupure de connexion révoquerait tout le monde.

**Délai d'attente : 5 s**, sur les deux appels, via `AbortSignal.timeout`.

- [ ] **Étape 1 : écrire les tests**

`test/amorceur/canal.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { creerCanal } = require('../../amorceur/canal');
const { ecrireArchive, empreinte } = require('../../amorceur/archive');

const BASE = 'https://exemple.invalid';

// Faux fetch: rend la reponse programmee et enregistre l'appel.
function fauxFetch(reponses) {
  const appels = [];
  const f = async (url, options) => {
    appels.push({ url, entetes: (options && options.headers) || {} });
    const r = reponses.shift();
    if (r instanceof Error) throw r;
    return {
      ok: r.statut >= 200 && r.statut < 300,
      status: r.statut,
      json: async () => r.corps,
      arrayBuffer: async () => r.octets.buffer.slice(r.octets.byteOffset, r.octets.byteOffset + r.octets.byteLength),
    };
  };
  f.appels = appels;
  return f;
}

test('le manifeste part avec la cle dans x-cle', async () => {
  const chercher = fauxFetch([{ statut: 200, corps: { version: '0.3.0', sha256: 'abc', actif: true, message: null } }]);
  const c = creerCanal({ base: BASE, chercher });
  const r = await c.manifeste('CLE');
  assert.strictEqual(r.etat, 'ok');
  assert.strictEqual(r.manifeste.version, '0.3.0');
  assert.strictEqual(chercher.appels[0].url, BASE + '/api/manifeste');
  assert.strictEqual(chercher.appels[0].entetes['x-cle'], 'CLE');
});

test('un 404 est un refus, pas une panne', async () => {
  const c = creerCanal({ base: BASE, chercher: fauxFetch([{ statut: 404, corps: null }]) });
  assert.strictEqual((await c.manifeste('CLE')).etat, 'refuse');
});

test('une erreur reseau est injoignable, jamais un refus', async () => {
  const c = creerCanal({ base: BASE, chercher: fauxFetch([new Error('getaddrinfo ENOTFOUND')]) });
  const r = await c.manifeste('CLE');
  assert.strictEqual(r.etat, 'injoignable');
  assert.match(r.raison, /ENOTFOUND/);
});

test('un 500 est injoignable, pas un refus', async () => {
  const c = creerCanal({ base: BASE, chercher: fauxFetch([{ statut: 500, corps: null }]) });
  assert.strictEqual((await c.manifeste('CLE')).etat, 'injoignable');
});

test('une reponse illisible est injoignable', async () => {
  const chercher = async () => ({ ok: true, status: 200, json: async () => { throw new Error('pas du json'); } });
  const c = creerCanal({ base: BASE, chercher });
  assert.strictEqual((await c.manifeste('CLE')).etat, 'injoignable');
});

test('le paquet est rendu quand son sha256 correspond', async () => {
  const archive = ecrireArchive([{ chemin: 'a.txt', contenu: Buffer.from('x') }]);
  const c = creerCanal({ base: BASE, chercher: fauxFetch([{ statut: 200, octets: archive }]) });
  const r = await c.paquet('CLE', empreinte(archive));
  assert.strictEqual(r.etat, 'ok');
  assert.ok(r.archive.equals(archive));
});

test('un sha256 qui ne correspond pas rend corrompu, et l archive n est pas rendue', async () => {
  const archive = ecrireArchive([{ chemin: 'a.txt', contenu: Buffer.from('x') }]);
  const c = creerCanal({ base: BASE, chercher: fauxFetch([{ statut: 200, octets: archive }]) });
  const r = await c.paquet('CLE', '0'.repeat(64));
  assert.strictEqual(r.etat, 'corrompu');
  assert.strictEqual(r.archive, undefined);
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

Run: `npm test`
Attendu : `Cannot find module '../../amorceur/canal'`.

- [ ] **Étape 3 : implémenter**

`amorceur/canal.js` :

```js
'use strict';
const { empreinte } = require('./archive');

const DELAI_MS = 5000;

function creerCanal({ base, chercher = globalThis.fetch }) {
  async function appeler(chemin, cle) {
    return chercher(base + chemin, {
      headers: { 'x-cle': cle },
      signal: AbortSignal.timeout(DELAI_MS),
    });
  }

  async function manifeste(cle) {
    let r;
    try {
      r = await appeler('/api/manifeste', cle);
    } catch (e) {
      return { etat: 'injoignable', raison: String(e && e.message ? e.message : e) };
    }
    // 404 est la SEULE reponse qui arrete l'application: le serveur a dit non.
    // Tout le reste est un incident, et un incident ne revoque personne.
    if (r.status === 404) return { etat: 'refuse' };
    if (!r.ok) return { etat: 'injoignable', raison: 'statut ' + r.status };
    try {
      return { etat: 'ok', manifeste: await r.json() };
    } catch (e) {
      return { etat: 'injoignable', raison: 'reponse illisible' };
    }
  }

  async function paquet(cle, sha256Attendu) {
    let r;
    try {
      r = await appeler('/api/paquet', cle);
    } catch (e) {
      return { etat: 'injoignable', raison: String(e && e.message ? e.message : e) };
    }
    if (r.status === 404) return { etat: 'refuse' };
    if (!r.ok) return { etat: 'injoignable', raison: 'statut ' + r.status };
    let archive;
    try {
      archive = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      return { etat: 'injoignable', raison: 'telechargement interrompu' };
    }
    const obtenu = empreinte(archive);
    // L'archive n'est jamais rendue quand l'empreinte differe: le seul moyen
    // sur de garantir qu'un octet altere ne s'installe pas.
    if (obtenu !== sha256Attendu) return { etat: 'corrompu', obtenu };
    return { etat: 'ok', archive };
  }

  return { manifeste, paquet };
}

module.exports = { creerCanal, DELAI_MS };
```

- [ ] **Étape 4 : lancer, vérifier le passage, commiter**

```bash
npm test
git add amorceur/canal.js test/amorceur/canal.test.js
git commit -m "feat(maj): client du service, refus et panne ne se confondent pas"
```

---

### Tâche 4 : la clé et la séquence de démarrage

**Fichiers :**
- Créer : `amorceur/cle.js`
- Créer : `amorceur/demarrage.js`
- Créer : `test/amorceur/demarrage.test.js`

**Interfaces :**
- Consomme : `creerDepot` (T1), `extraire` (T2), `creerCanal` (T3).
- Produit :
  - `creerCle(racine)` → `{ lire, ecrire, oublier }`. `lire()` rend la chaîne de `<racine>/cle.txt`, **coupée de ses blancs**, ou `null`. `ecrire(cle)` la pose. Aucune exception ne sort de ce module.
  - `demarrer({ depot, canal, cle, ecrans, installerInitiale, versionPaquet, journal })` → `{ action: 'charger', version, dossier }` ou `{ action: 'arreter', raison, message }`.

**`ecrans` est injecté**, avec deux méthodes : `demanderCle({ message })` → `Promise<string|null>` (`null` = l'ami a fermé la fenêtre) et `afficherArret({ titre, message })` → `Promise<void>`. Les tests passent de faux écrans ; la vraie fenêtre Electron arrive à la tâche 5. **Aucun `require('electron')` dans ce fichier** — c'est ce qui le rend testable sous `node --test`.

**Les raisons d'arrêt**, chaînes exactes, reprises telles quelles par la tâche 5 : `'cle-refusee'`, `'sans-cle'`, `'coupe-circuit'`, `'aucune-version'`.

**L'ordre compte.** La clé est enregistrée **seulement après** une réponse `ok` : enregistrer avant ferait garder une clé morte, et l'écran ne réapparaîtrait plus.

**L'installation est atomique** : on extrait dans `<dossier>.partiel`, puis on renomme. Une extraction interrompue ne laisse jamais un dossier de version à moitié rempli, que `versionsInstallees()` prendrait pour une version valide.

- [ ] **Étape 1 : écrire les tests**

`test/amorceur/demarrage.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { creerDepot } = require('../../amorceur/depot');
const { creerCle } = require('../../amorceur/cle');
const { ecrireArchive, empreinte } = require('../../amorceur/archive');
const { demarrer } = require('../../amorceur/demarrage');

function racine() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'amorceur-'));
}

function installer(r, version) {
  const d = path.join(r, 'versions', version);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'marqueur.txt'), version);
}

const ARCHIVE = ecrireArchive([{ chemin: 'desktop/main.js', contenu: Buffer.from('// version neuve\n') }]);
const SHA = empreinte(ARCHIVE);

// Faux ecrans: rendent des reponses programmees et comptent les appels.
function fauxEcrans(reponses = []) {
  const e = {
    demandes: [],
    arrets: [],
    async demanderCle(opts) { e.demandes.push(opts || {}); return reponses.shift(); },
    async afficherArret(opts) { e.arrets.push(opts); },
  };
  return e;
}

function fauxCanal({ manifestes = [], paquets = [] }) {
  return {
    async manifeste() { return manifestes.shift(); },
    async paquet() { return paquets.shift(); },
  };
}

function contexte(r, options) {
  return {
    depot: creerDepot(r),
    cle: creerCle(r),
    journal: () => {},
    versionPaquet: '0.2.0',
    installerInitiale: () => { installer(r, '0.2.0'); },
    ...options,
  };
}

test('premier lancement: la cle est demandee, validee, puis enregistree', async () => {
  const r = racine();
  const ecrans = fauxEcrans(['MA-CLE']);
  const res = await demarrer(contexte(r, {
    ecrans,
    canal: fauxCanal({ manifestes: [{ etat: 'ok', manifeste: { version: '0.2.0', sha256: SHA, actif: true, message: null } }] }),
  }));
  assert.strictEqual(res.action, 'charger');
  assert.strictEqual(res.version, '0.2.0');
  assert.strictEqual(creerCle(r).lire(), 'MA-CLE');
  assert.strictEqual(ecrans.demandes.length, 1);
});

test('lancements suivants: la cle du disque sert, aucun ecran ne s ouvre', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  installer(r, '0.2.0');
  const ecrans = fauxEcrans();
  const res = await demarrer(contexte(r, {
    ecrans,
    canal: fauxCanal({ manifestes: [{ etat: 'ok', manifeste: { version: '0.2.0', sha256: SHA, actif: true, message: null } }] }),
  }));
  assert.strictEqual(res.action, 'charger');
  assert.strictEqual(ecrans.demandes.length, 0);
});

test('une cle refusee redemande une cle, et la bonne demarre', async () => {
  const r = racine();
  creerCle(r).ecrire('CLE-MORTE');
  installer(r, '0.2.0');
  const ecrans = fauxEcrans(['CLE-NEUVE']);
  const res = await demarrer(contexte(r, {
    ecrans,
    canal: fauxCanal({ manifestes: [
      { etat: 'refuse' },
      { etat: 'ok', manifeste: { version: '0.2.0', sha256: SHA, actif: true, message: null } },
    ] }),
  }));
  assert.strictEqual(res.action, 'charger');
  assert.strictEqual(creerCle(r).lire(), 'CLE-NEUVE');
  assert.strictEqual(ecrans.demandes.length, 1);
});

test('fermer la fenetre de saisie arrete l application', async () => {
  const r = racine();
  installer(r, '0.2.0');
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans([null]),
    canal: fauxCanal({}),
  }));
  assert.strictEqual(res.action, 'arreter');
  assert.strictEqual(res.raison, 'sans-cle');
});

test('une cle refusee que l ami ne remplace pas arrete l application', async () => {
  const r = racine();
  creerCle(r).ecrire('CLE-MORTE');
  installer(r, '0.2.0');
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans([null]),
    canal: fauxCanal({ manifestes: [{ etat: 'refuse' }] }),
  }));
  assert.strictEqual(res.action, 'arreter');
  assert.strictEqual(res.raison, 'cle-refusee');
});

test('service injoignable: on demarre sur la version en place, sans bruit', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  installer(r, '0.2.0');
  const ecrans = fauxEcrans();
  const res = await demarrer(contexte(r, {
    ecrans,
    canal: fauxCanal({ manifestes: [{ etat: 'injoignable', raison: 'ENOTFOUND' }] }),
  }));
  assert.strictEqual(res.action, 'charger');
  assert.strictEqual(res.version, '0.2.0');
  assert.strictEqual(ecrans.arrets.length, 0);
});

test('coupe-circuit: actif false arrete tout le monde avec le message', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  installer(r, '0.2.0');
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans(),
    canal: fauxCanal({ manifestes: [{ etat: 'ok', manifeste: { version: '0.2.0', sha256: SHA, actif: false, message: 'maj de Dofus, on attend' } }] }),
  }));
  assert.strictEqual(res.action, 'arreter');
  assert.strictEqual(res.raison, 'coupe-circuit');
  assert.strictEqual(res.message, 'maj de Dofus, on attend');
});

test('une version plus recente est telechargee, installee, et chargee', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  installer(r, '0.2.0');
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans(),
    canal: fauxCanal({
      manifestes: [{ etat: 'ok', manifeste: { version: '0.3.0', sha256: SHA, actif: true, message: null } }],
      paquets: [{ etat: 'ok', archive: ARCHIVE }],
    }),
  }));
  assert.strictEqual(res.version, '0.3.0');
  assert.strictEqual(fs.readFileSync(path.join(r, 'versions', '0.3.0', 'desktop', 'main.js'), 'utf8'), '// version neuve\n');
  // Le temoin est pose AVANT le chargement: c'est lui qui rattrapera un plantage.
  assert.strictEqual(creerDepot(r).lire().essai, '0.3.0');
});

test('archive corrompue: rien n est installe, on garde la version en place', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  installer(r, '0.2.0');
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans(),
    canal: fauxCanal({
      manifestes: [{ etat: 'ok', manifeste: { version: '0.3.0', sha256: SHA, actif: true, message: null } }],
      paquets: [{ etat: 'corrompu', obtenu: '00' }],
    }),
  }));
  assert.strictEqual(res.action, 'charger');
  assert.strictEqual(res.version, '0.2.0');
  assert.strictEqual(fs.existsSync(path.join(r, 'versions', '0.3.0')), false);
});

test('une version refusee annoncee par le manifeste n est pas retelechargee', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  installer(r, '0.2.0');
  installer(r, '0.3.0');
  const d = creerDepot(r);
  d.ecrire({ version: '0.2.0', essai: null, refusees: ['0.3.0'] });
  let paquetsDemandes = 0;
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans(),
    canal: {
      async manifeste() { return { etat: 'ok', manifeste: { version: '0.3.0', sha256: SHA, actif: true, message: null } }; },
      async paquet() { paquetsDemandes += 1; return { etat: 'ok', archive: ARCHIVE }; },
    },
  }));
  assert.strictEqual(res.version, '0.2.0');
  assert.strictEqual(paquetsDemandes, 0);
});

test('depot vierge: la version du paquet est installee avant tout', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans(),
    canal: fauxCanal({ manifestes: [{ etat: 'injoignable', raison: 'hors ligne' }] }),
  }));
  assert.strictEqual(res.action, 'charger');
  assert.strictEqual(res.version, '0.2.0');
});

test('aucune version et service injoignable: on arrete en le disant', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans(),
    canal: fauxCanal({ manifestes: [{ etat: 'injoignable', raison: 'hors ligne' }] }),
    installerInitiale: () => {},   // le paquet n'a rien pu poser
  }));
  assert.strictEqual(res.action, 'arreter');
  assert.strictEqual(res.raison, 'aucune-version');
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

Run: `npm test`
Attendu : `Cannot find module '../../amorceur/cle'`.

- [ ] **Étape 3 : implémenter la clé**

`amorceur/cle.js` :

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// La cle est en clair, et c'est assume: elle sert a etre renvoyee au serveur,
// donc l'application doit pouvoir la lire, donc son proprietaire aussi. Le
// levier de controle est la revocation cote serveur, pas ce fichier.
function creerCle(racine) {
  const fichier = path.join(racine, 'cle.txt');
  return {
    lire() {
      try {
        const v = fs.readFileSync(fichier, 'utf8').trim();
        return v.length ? v : null;
      } catch (e) {
        return null;
      }
    },
    ecrire(cle) {
      try {
        fs.mkdirSync(racine, { recursive: true });
        fs.writeFileSync(fichier, String(cle).trim());
      } catch (e) {
        // Une cle non enregistree fait reapparaitre l'ecran au prochain
        // lancement. Desagreable, jamais bloquant: on ne leve pas.
      }
    },
    oublier() {
      try { fs.unlinkSync(fichier); } catch (e) { /* rien a oublier */ }
    },
  };
}

module.exports = { creerCle };
```

- [ ] **Étape 4 : implémenter la séquence**

`amorceur/demarrage.js` :

```js
'use strict';
const fs = require('node:fs');
const { extraire } = require('./archive');
const { comparerVersions } = require('./depot');

// Installe une archive dans versions/<version>, atomiquement: on extrait a
// cote puis on renomme. Une extraction interrompue ne doit jamais laisser un
// dossier a moitie rempli, que versionsInstallees() compterait comme valide.
function installerArchive(depot, version, archive) {
  const cible = depot.dossierDe(version);
  const partiel = cible + '.partiel';
  fs.rmSync(partiel, { recursive: true, force: true });
  try {
    extraire(archive, partiel);
    fs.rmSync(cible, { recursive: true, force: true });
    fs.renameSync(partiel, cible);
    return true;
  } catch (e) {
    fs.rmSync(partiel, { recursive: true, force: true });
    return false;
  }
}

async function demarrer({ depot, canal, cle, ecrans, installerInitiale, versionPaquet, journal = () => {} }) {
  // 1. La regle du temoin s'applique AVANT tout le reste: si la version
  //    chargee au lancement precedent n'a jamais atteint son etat pret, elle
  //    est ecartee ici, definitivement.
  let choix = depot.choisirVersion();
  if (choix.refusee) journal(`version ${choix.refusee} abandonnee: elle n'a pas demarre`);

  // 2. Depot vierge: le paquet pose sa propre version. Un ami sans reseau
  //    demarre quand meme.
  if (!choix.version) {
    installerInitiale();
    choix = depot.choisirVersion();
    journal(choix.version
      ? `version ${versionPaquet} posee depuis le paquet`
      : `le paquet n'a pas pu poser sa version ${versionPaquet}`);
  }

  // 3. La cle. Elle n'est enregistree qu'une fois validee par le serveur.
  let secret = cle.lire();
  let message = null;
  let manifeste = null;

  for (;;) {
    if (!secret) {
      secret = await ecrans.demanderCle({ message });
      if (!secret) return { action: 'arreter', raison: message ? 'cle-refusee' : 'sans-cle' };
    }
    const r = await canal.manifeste(secret);
    if (r.etat === 'refuse') {
      journal('cle refusee par le service');
      message = "Cette cle n'est pas (ou plus) valide. Demande-en une nouvelle.";
      secret = null;
      continue;
    }
    if (r.etat === 'injoignable') {
      // Un incident reseau ne revoque personne et n'arrete personne.
      journal(`service injoignable: ${r.raison}`);
      break;
    }
    cle.ecrire(secret);
    manifeste = r.manifeste;
    break;
  }

  // 4. Le coupe-circuit global, seul moyen d'arreter tout le monde en une
  //    minute le jour ou l'outil devient dangereux pour les comptes.
  if (manifeste && manifeste.actif === false) {
    return { action: 'arreter', raison: 'coupe-circuit', message: manifeste.message || null };
  }

  // 5. Une version plus recente, jamais refusee, est recuperee.
  if (manifeste && manifeste.version) {
    const etat = depot.lire();
    const dejaInstallee = depot.versionsInstallees().includes(manifeste.version);
    const refusee = etat.refusees.includes(manifeste.version);
    const plusRecente = !choix.version || comparerVersions(manifeste.version, choix.version) > 0;
    if (!dejaInstallee && !refusee && plusRecente) {
      const p = await canal.paquet(secret, manifeste.sha256);
      if (p.etat === 'ok') {
        if (installerArchive(depot, manifeste.version, p.archive)) {
          journal(`version ${manifeste.version} installee`);
        } else {
          journal(`extraction de ${manifeste.version} en echec: on garde ${choix.version}`);
        }
      } else {
        journal(`telechargement de ${manifeste.version} refuse: ${p.etat}`);
      }
      choix = depot.choisirVersion();
    }
  }

  if (!choix.version) return { action: 'arreter', raison: 'aucune-version', message: null };

  // 6. Le temoin se pose AVANT le chargement. C'est lui, et lui seul, qui
  //    rattrape une version qui plante au demarrage.
  depot.poserTemoin(choix.version);
  return { action: 'charger', version: choix.version, dossier: depot.dossierDe(choix.version) };
}

module.exports = { demarrer, installerArchive };
```

- [ ] **Étape 5 : lancer, vérifier le passage, commiter**

```bash
npm test
git add amorceur/cle.js amorceur/demarrage.js test/amorceur/demarrage.test.js
git commit -m "feat(maj): sequence de demarrage, cle, coupe-circuit et retour arriere"
```

---

### Tâche 5 : les écrans

**Fichiers :**
- Créer : `amorceur/ecran.js`
- Créer : `amorceur/ecran.html`
- Créer : `amorceur/ecran-preload.js`

**Interfaces :**
- Produit : `creerEcrans()` → `{ demanderCle({ message }), afficherArret({ titre, message }) }`, les deux méthodes attendues par `demarrer` (T4).

**Aucun test automatique ici** — c'est de la fenêtre. C'est précisément pour ça que toute la logique vit dans `demarrage.js`, qui est testé. Ce fichier ne décide de rien : il affiche et rend ce qui a été saisi.

**Contraintes de la fenêtre :** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, menu retiré — comme la fenêtre principale existante (`desktop/main.js:236`). Le rendu n'a le droit qu'à `envoyer(cle)`.

**Fermer la fenêtre rend `null`**, ce que `demarrer` traduit en arrêt. Ne pas rendre une chaîne vide : `demarrer` la confondrait avec une saisie.

- [ ] **Étape 1 : le préchargement**

`amorceur/ecran-preload.js` :

```js
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// La frontiere de confiance de l'ecran de saisie: un seul verbe.
contextBridge.exposeInMainWorld('ecran', {
  envoyer: (cle) => ipcRenderer.send('cle-saisie', cle),
});
```

- [ ] **Étape 2 : la page**

`amorceur/ecran.html` :

```html
<!doctype html><meta charset="utf-8"><title>OMNI</title>
<style>
  body { font: 14px system-ui; background:#16181d; color:#e6e8ec; margin:0;
         padding:28px; display:flex; flex-direction:column; gap:14px; }
  h1 { font-size:18px; margin:0; }
  p { margin:0; color:#8b93a3; line-height:1.5; }
  #message { color:#e8a598; }
  input, button { font:inherit; padding:8px 12px; border-radius:6px;
                  border:1px solid #3a3f4b; background:#22252c; color:#e6e8ec; }
  button { cursor:pointer; background:#2e5d8a; border:0; }
  .rangee { display:flex; gap:8px; }
  .rangee input { flex:1; }
</style>
<h1>OMNI</h1>
<p id="invite">Colle la cle qui t'a ete transmise.</p>
<p id="message"></p>
<div class="rangee">
  <input id="cle" placeholder="cle" autofocus>
  <button id="ok">valider</button>
</div>
<script>
  // Aucun dialogue natif: alert() et prompt() gelent la fenetre.
  const params = new URLSearchParams(location.search);
  if (params.get('message')) document.getElementById('message').textContent = params.get('message');
  function envoyer() {
    const v = document.getElementById('cle').value.trim();
    if (v) window.ecran.envoyer(v);
  }
  document.getElementById('ok').onclick = envoyer;
  document.getElementById('cle').addEventListener('keydown', (e) => { if (e.key === 'Enter') envoyer(); });
</script>
```

- [ ] **Étape 3 : la fenêtre**

`amorceur/ecran.js` :

```js
'use strict';
const path = require('node:path');
const { BrowserWindow, ipcMain, dialog } = require('electron');

function creerEcrans() {
  // Rend la cle saisie, ou null si l'ami ferme la fenetre. Le null est
  // significatif: demarrer() le traduit en arret, une chaine vide non.
  function demanderCle({ message } = {}) {
    return new Promise((resoudre) => {
      const f = new BrowserWindow({
        width: 460, height: 260, title: 'OMNI', resizable: false,
        webPreferences: {
          preload: path.join(__dirname, 'ecran-preload.js'),
          contextIsolation: true, sandbox: true, nodeIntegration: false,
        },
      });
      f.removeMenu();
      let rendu = false;
      const finir = (valeur) => {
        if (rendu) return;
        rendu = true;
        ipcMain.removeListener('cle-saisie', surSaisie);
        if (!f.isDestroyed()) f.destroy();
        resoudre(valeur);
      };
      const surSaisie = (_e, cle) => finir(String(cle));
      ipcMain.on('cle-saisie', surSaisie);
      f.on('closed', () => finir(null));
      const url = path.join(__dirname, 'ecran.html');
      f.loadFile(url, message ? { search: '?message=' + encodeURIComponent(message) } : undefined);
    });
  }

  // Un ami n'a pas de terminal: un arret doit se voir. Le dialogue natif
  // suffit ici — il n'y a plus rien a piloter derriere.
  async function afficherArret({ titre, message }) {
    await dialog.showMessageBox({ type: 'warning', title: 'OMNI', message: titre, detail: message || '' });
  }

  return { demanderCle, afficherArret };
}

module.exports = { creerEcrans };
```

- [ ] **Étape 4 : commiter**

`npm test` doit toujours imprimer son total (ce fichier n'ajoute aucun test, il ne doit en casser aucun).

```bash
npm test
git add amorceur/ecran.js amorceur/ecran.html amorceur/ecran-preload.js
git commit -m "feat(maj): ecran de saisie de la cle et message d'arret"
```

---

### Tâche 6 : le câblage à Electron

**Fichiers :**
- Créer : `amorceur/electron.js`
- Modifier : `package.json` (champs `main`, scripts `app` et `pack`)
- Modifier : `desktop/main.js:68-71` (le journal reçoit la version) et le contenu envoyé par `envoyerEtat()` (`desktop/main.js:197`)
- Modifier : `desktop/index.html:50` et le rendu de l'en-tête (`desktop/index.html:195`)

**Interfaces :**
- Consomme : tout ce qui précède.
- Produit : le point d'entrée réel de l'application. Après cette tâche, `npm run app` passe par l'amorceur.

**Quatre pièges à ne pas payer :**

1. **`app.getPath('userData')` ne vaut PAS `%APPDATA%\OMNI` en développement.** Il vaut `%APPDATA%\<nom du produit>`, donc `Electron` quand on lance `npm run app`. Le spec fixe `%APPDATA%\OMNI` : construire le chemin avec `path.join(app.getPath('appData'), 'OMNI')`, identique en développement et dans le paquet.
2. **Le code versionné vit hors du paquet et doit quand même trouver `frida` et `protobufjs`.** Ses `require` remonteront depuis `%APPDATA%\...\versions\0.3.0\` et ne trouveront rien. On étend donc la résolution de modules vers le `node_modules` du paquet. **Un `.node` natif ne se charge pas depuis une archive asar** : c'est `app.asar.unpacked` qui les porte, et c'est ce chemin-là qu'il faut ajouter.
3. **La version initiale est une archive embarquée**, pas une copie de dossier : `fs.cpSync` ne traverse pas l'asar de façon fiable, alors qu'un `readFileSync` d'un seul fichier oui. `amorceur/version-initiale.tgz` est fabriquée par la tâche 7.
4. **Le témoin s'efface quand la fenêtre a fini de charger**, pas à la fin du `require`. Un `require` qui rend la main ne prouve rien : `desktop/main.js` fait son travail dans `app.whenReady().then(...)`, bien après.

- [ ] **Étape 1 : écrire l'amorceur**

`amorceur/electron.js` :

```js
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const { app } = require('electron');

const { creerDepot } = require('./depot');
const { creerCle } = require('./cle');
const { creerCanal } = require('./canal');
const { creerEcrans } = require('./ecran');
const { demarrer } = require('./demarrage');
const { extraire } = require('./archive');

const BASE = 'https://paquets-maj.vercel.app';
// Fixe, en developpement comme dans le paquet: app.getPath('userData') vaut
// %APPDATA%\Electron quand on lance npm run app, et le depot changerait de
// place entre les deux.
const RACINE = path.join(app.getPath('appData'), 'OMNI');
const VERSION_PAQUET = require('../package.json').version;

// Le code versionne resout ses dependances vers le node_modules du PAQUET:
// frida et protobufjs ne se mettent pas a jour, et un .node natif ne se
// charge pas depuis une archive asar — d'ou app.asar.unpacked.
function etendreResolution() {
  const racineApp = app.getAppPath();                       // ...\resources\app.asar
  const supplements = [
    path.join(racineApp, 'node_modules'),
    path.join(racineApp + '.unpacked', 'node_modules'),
  ].filter((p) => fs.existsSync(p));
  const origine = Module._nodeModulePaths;
  Module._nodeModulePaths = function (depuis) {
    return origine.call(this, depuis).concat(supplements);
  };
}

function installerInitiale(depot) {
  const archive = path.join(__dirname, 'version-initiale.tgz');
  try {
    const cible = depot.dossierDe(VERSION_PAQUET);
    extraire(fs.readFileSync(archive), cible);
  } catch (e) {
    console.error('version initiale non installable:', e.message);
  }
}

async function principal() {
  const depot = creerDepot(RACINE);
  const ecrans = creerEcrans();
  const resultat = await demarrer({
    depot,
    canal: creerCanal({ base: BASE }),
    cle: creerCle(RACINE),
    ecrans,
    installerInitiale: () => installerInitiale(depot),
    versionPaquet: VERSION_PAQUET,
    journal: (m) => console.log('[amorceur]', m),
  });

  if (resultat.action === 'arreter') {
    const titres = {
      'cle-refusee': "Cette cle n'est plus valide",
      'sans-cle': 'Aucune cle saisie',
      'coupe-circuit': 'OMNI est momentanement arrete',
      'aucune-version': 'Aucune version installee',
    };
    await ecrans.afficherArret({
      titre: titres[resultat.raison] || 'OMNI ne peut pas demarrer',
      message: resultat.message || '',
    });
    app.quit();
    return;
  }

  // Le temoin ne s'efface que quand la fenetre a fini de charger. Un require
  // qui rend la main ne prouve rien: desktop/main.js travaille dans
  // app.whenReady().then(...), bien apres.
  app.on('browser-window-created', (_e, fenetre) => {
    fenetre.webContents.once('did-finish-load', () => depot.effacerTemoin());
  });

  etendreResolution();
  process.env.OMNI_VERSION = resultat.version;
  require(path.join(resultat.dossier, 'desktop', 'main.js'));
}

// L'ecran de saisie est une fenetre: il faut qu'Electron soit pret avant.
app.whenReady().then(principal);
```

- [ ] **Étape 2 : rediriger le paquet vers l'amorceur**

Dans `package.json` :

```json
  "main": "amorceur/electron.js",
  "scripts": {
    "app": "electron amorceur/electron.js",
    "pack": "electron-packager . OMNI --platform=win32 --arch=x64 --out=desktop/dist --overwrite --ignore=\"^/(docs|test|serveur-maj)\""
  },
```

- [ ] **Étape 3 : afficher la version**

`desktop/main.js`, dans le contenu envoyé par `envoyerEtat()` (`desktop/main.js:197`), ajouter le champ au premier niveau de l'objet :

```js
  fenetre.webContents.send('etat', {
    version: process.env.OMNI_VERSION || 'dev',
    duplication: superviseur.arme,
```

`desktop/index.html:50`, à côté du titre :

```html
  <h1>OMNI</h1><span id="version"></span>
```

et dans la feuille de style, avec les autres règles de l'en-tête :

```css
  #version { color: #8b93a3; font-size: 12px; margin-left: -6px; }
```

et dans le rendu de l'état, juste avant la ligne qui écrit `#resume` (`desktop/index.html:195`) :

```js
    document.getElementById('version').textContent = etat.version || '';
```

- [ ] **Étape 4 : vérifier que la chaîne complète démarre**

Run: `npm test`
Attendu : la suite passe et **imprime son total**.

Puis, en vrai : `npm run app`.
Attendu, au premier lancement : la fenêtre de saisie de clé s'ouvre. Coller la clé de l'ami `test` (panneau : `https://paquets-maj.vercel.app/api/admin`). La fenêtre principale s'ouvre ensuite, l'en-tête affiche un numéro de version, et `%APPDATA%\OMNI\` contient `cle.txt` et `versions\<version>\`.

Si la fenêtre principale ne s'ouvre pas, lire la sortie de la console : les lignes `[amorceur]` disent laquelle des étapes a refusé.

- [ ] **Étape 5 : commiter**

```bash
git add amorceur/electron.js package.json desktop/main.js desktop/index.html
git commit -m "feat(maj): l'application demarre par l'amorceur et affiche sa version"
```

---

### Tâche 7 : fabriquer et publier une version

**Fichiers :**
- Créer : `outils/faire-paquet-code.js`
- Créer : `test/amorceur/faire-paquet-code.test.js`
- Modifier : `package.json` (script `paquet-code`)

**Interfaces :**
- Consomme : `ecrireArchive`, `empreinte` (T2).
- Produit :
  - `listerFichiersVersion(racine)` → `[{ chemin, contenu }]` : `src/**`, `desktop/**` (sauf `desktop/dist`), et `package.json`. **Ni `node_modules`, ni `docs`, ni `test`, ni `serveur-maj`, ni `amorceur`.**
  - `fabriquer(racine)` → `{ archive, sha256, version, nombreFichiers }`.
  - En ligne de commande : `node outils/faire-paquet-code.js <sortie.tar.gz>`.

**L'amorceur n'est PAS dans l'archive.** Il vit dans le paquet et ne se met pas à jour ; l'y mettre ferait charger un amorceur par un amorceur.

**Enchaînement de publication complet** (documenté dans le plan, exécuté à la tâche 9) :

```bash
# 1. incrementer la version
npm version patch --no-git-tag-version

# 2. fabriquer l'archive du code
npm run paquet-code -- ..\code-0.3.0.tar.gz

# 3. la poser dans le service et calculer son empreinte
cd serveur-maj
node publier.js ..\..\code-0.3.0.tar.gz 0.3.0

# 4. deployer l'archive AVANT que le manifeste la designe
npx vercel deploy --prod --yes

# 5. basculer le manifeste
node publier.js ..\..\code-0.3.0.tar.gz 0.3.0 --activer
```

L'ordre des étapes 4 et 5 n'est pas négociable : basculer le manifeste avant le déploiement ferait pointer les amis sur une archive absente, donc un 404, donc aucune mise à jour — sans dégât, mais sans effet.

- [ ] **Étape 1 : écrire le test**

`test/amorceur/faire-paquet-code.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listerFichiersVersion, fabriquer } = require('../../outils/faire-paquet-code');
const { lireArchive, empreinte } = require('../../amorceur/archive');

function faussRacine() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'paquet-'));
  const ecrire = (rel, contenu) => {
    const c = path.join(r, rel);
    fs.mkdirSync(path.dirname(c), { recursive: true });
    fs.writeFileSync(c, contenu);
  };
  ecrire('package.json', JSON.stringify({ name: 'mm', version: '0.7.0' }));
  ecrire('src/superviseur.js', '// superviseur');
  ecrire('src/comptes/vue.js', '// vue');
  ecrire('desktop/main.js', '// main');
  ecrire('desktop/dist/OMNI-win32-x64/OMNI.exe', 'binaire');
  ecrire('amorceur/electron.js', '// amorceur');
  ecrire('test/x.test.js', '// test');
  ecrire('docs/note.md', '# note');
  ecrire('serveur-maj/api/admin.js', '// serveur');
  ecrire('node_modules/frida/index.js', '// dependance');
  return r;
}

test('l archive contient le code applicatif et rien d autre', () => {
  const chemins = listerFichiersVersion(faussRacine()).map((f) => f.chemin).sort();
  assert.deepStrictEqual(chemins, ['desktop/main.js', 'package.json', 'src/comptes/vue.js', 'src/superviseur.js']);
});

test('les chemins sont relatifs et en barres obliques', () => {
  for (const f of listerFichiersVersion(faussRacine())) {
    assert.ok(!path.isAbsolute(f.chemin), f.chemin);
    assert.ok(!f.chemin.includes('\\'), f.chemin);
  }
});

test('fabriquer rend une archive relisible, sa version et son empreinte', () => {
  const r = fabriquer(faussRacine());
  assert.strictEqual(r.version, '0.7.0');
  assert.strictEqual(r.sha256, empreinte(r.archive));
  const dedans = lireArchive(r.archive).map((f) => f.chemin);
  assert.ok(dedans.includes('desktop/main.js'));
  assert.strictEqual(dedans.length, r.nombreFichiers);
});

test('deux fabrications du meme code donnent la meme empreinte', () => {
  // Sans cette propriete, impossible de verifier qu'une archive publiee
  // correspond bien a un etat du depot.
  const r = faussRacine();
  assert.strictEqual(fabriquer(r).sha256, fabriquer(r).sha256);
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

Run: `npm test`
Attendu : `Cannot find module '../../outils/faire-paquet-code'`.

- [ ] **Étape 3 : implémenter**

`outils/faire-paquet-code.js` :

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ecrireArchive, empreinte } = require('../amorceur/archive');

// Ce qui part chez les amis: le code applicatif, rien d'autre. L'amorceur en
// est exclu — il vit dans le paquet et ne se met pas a jour.
const DOSSIERS = ['src', 'desktop'];
const FICHIERS = ['package.json'];
const EXCLUS = new Set(['dist', 'node_modules']);

function parcourir(racine, relatif, sortie) {
  const absolu = path.join(racine, relatif);
  for (const e of fs.readdirSync(absolu, { withFileTypes: true })) {
    if (EXCLUS.has(e.name)) continue;
    const rel = relatif + '/' + e.name;
    if (e.isDirectory()) parcourir(racine, rel, sortie);
    else if (e.isFile()) sortie.push({ chemin: rel, contenu: fs.readFileSync(path.join(racine, rel)) });
  }
}

function listerFichiersVersion(racine) {
  const sortie = [];
  for (const d of DOSSIERS) {
    if (fs.existsSync(path.join(racine, d))) parcourir(racine, d, sortie);
  }
  for (const f of FICHIERS) {
    if (fs.existsSync(path.join(racine, f))) {
      sortie.push({ chemin: f, contenu: fs.readFileSync(path.join(racine, f)) });
    }
  }
  // Ordre stable: deux fabrications du meme code doivent donner la meme
  // empreinte, sinon on ne peut plus verifier ce qui a ete publie.
  return sortie.sort((a, b) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0));
}

function fabriquer(racine) {
  const fichiers = listerFichiersVersion(racine);
  const archive = ecrireArchive(fichiers);
  const version = JSON.parse(fs.readFileSync(path.join(racine, 'package.json'), 'utf8')).version;
  return { archive, sha256: empreinte(archive), version, nombreFichiers: fichiers.length };
}

function main() {
  const sortie = process.argv[2];
  if (!sortie) {
    console.error('usage: node outils/faire-paquet-code.js <sortie.tar.gz>');
    process.exit(1);
  }
  const racine = path.join(__dirname, '..');
  const r = fabriquer(racine);
  fs.writeFileSync(sortie, r.archive);
  console.log(`version ${r.version}, ${r.nombreFichiers} fichiers, ${r.archive.length} octets`);
  console.log(`sha256: ${r.sha256}`);
  console.log(`ecrit: ${sortie}`);
}

if (require.main === module) main();
module.exports = { listerFichiersVersion, fabriquer };
```

Dans `package.json`, ajouter le script :

```json
    "paquet-code": "node outils/faire-paquet-code.js",
```

- [ ] **Étape 4 : produire la version initiale embarquée**

L'amorceur (T6) attend `amorceur/version-initiale.tgz`. Elle se fabrique avec le même outil, et se refait à chaque publication :

```bash
node outils/faire-paquet-code.js amorceur/version-initiale.tgz
```

Ce fichier **est commité** : c'est ce qui permet à un ami sans réseau de démarrer. Vérifier qu'il n'est pas ignoré par `.gitignore`.

- [ ] **Étape 5 : lancer, vérifier le passage, commiter**

```bash
npm test
git add outils/faire-paquet-code.js test/amorceur/faire-paquet-code.test.js package.json amorceur/version-initiale.tgz
git commit -m "feat(maj): fabrication de l'archive de code et version initiale embarquee"
```

---

### Tâche 8 : durcissement du paquet distribué

**Fichiers :**
- Créer : `outils/compiler-bytecode.js`
- Créer : `amorceur/jsc.js`
- Modifier : `desktop/main.js:68-71` (journal), `desktop/main.js:236-248` et `amorceur/ecran.js` (outils de développement)

**Cette tâche commence par une mesure, et peut s'arrêter là.** Le bytecode V8 n'est pas portable : des données mises en cache par un V8 ne se rechargent que dans le **même** V8. Il faut donc compiler **avec l'Electron du paquet**, pas avec `node`. Si le va-et-vient échoue, on ne bricole pas : on s'arrête, on le dit, et on livre le reste du durcissement.

- [ ] **Étape 1 : mesurer le va-et-vient du bytecode**

Écrire `outils/essai-bytecode.js` :

```js
'use strict';
const vm = require('node:vm');
const v8 = require('node:v8');

v8.setFlagsFromString('--no-lazy');
const source = 'module.exports = 40 + 2;';
const script = new vm.Script(source, { produceCachedData: true });
const cache = script.cachedData;

const relu = new vm.Script(source, { cachedData: cache });
console.log('rejete par V8 :', relu.cachedDataRejected);
console.log('valeur        :', relu.runInThisContext());
console.log('version V8    :', process.versions.v8);
```

Ajouter, dans le même fichier, la vérification de l'enveloppe de module —
`Module.wrap` est **déprécié** et la compilation de la tâche s'en sert :

```js
const Module = require('node:module');
console.log('Module.wrap    :', typeof Module.wrap);
```

Run: `npx electron outils/essai-bytecode.js`
Attendu : `rejete par V8 : false`, `valeur : 42`, `Module.wrap : function`.

Si `Module.wrap` n'existe plus, la remplacer par la même enveloppe écrite à la
main — c'est une chaîne fixe, pas une reconstitution approximative :

```js
const enveloppe = '(function (exports, require, module, __filename, __dirname) { '
  + source + '\n});';
```

**Si `cachedDataRejected` vaut `true`**, s'arrêter ici : consigner la sortie dans le plan, livrer les étapes 3 et 4 (outils de développement, journal), et rapporter que le bytecode intégral demande une décision. Ne pas inventer de contournement.

- [ ] **Étape 2 : compiler et charger du bytecode**

`outils/compiler-bytecode.js` — à lancer **avec Electron** (`npx electron outils/compiler-bytecode.js <dossier>`) : il remplace chaque `.js` du dossier par un `.jsc` porteur des données mises en cache, précédé de la longueur de la source d'origine sur 4 octets.

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const v8 = require('node:v8');

v8.setFlagsFromString('--no-lazy');

function compilerFichier(chemin) {
  const source = fs.readFileSync(chemin, 'utf8');
  // Meme enveloppe que celle de Node autour d'un module CommonJS: le cache
  // doit correspondre au code reellement execute au chargement.
  const enveloppe = require('node:module').wrap(source);
  const script = new vm.Script(enveloppe, { produceCachedData: true });
  if (!script.cachedData) throw new Error('V8 n a produit aucun cache pour ' + chemin);
  const entete = Buffer.alloc(4);
  entete.writeUInt32LE(Buffer.byteLength(enveloppe), 0);
  fs.writeFileSync(chemin.replace(/\.js$/, '.jsc'), Buffer.concat([entete, script.cachedData]));
  fs.rmSync(chemin);
}

function parcourir(dossier) {
  let n = 0;
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const c = path.join(dossier, e.name);
    if (e.isDirectory()) n += parcourir(c);
    else if (e.name.endsWith('.js')) { compilerFichier(c); n += 1; }
  }
  return n;
}

const cible = process.argv[2];
if (!cible) { console.error('usage: electron outils/compiler-bytecode.js <dossier>'); process.exit(1); }
console.log(`${parcourir(cible)} fichiers compiles`);
```

`amorceur/jsc.js` — le chargeur, à requérir avant tout `require` de code compilé :

```js
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const Module = require('node:module');

// V8 verifie la LONGUEUR de la source avant d'accepter un cache. On lui rend
// une source de meme longueur, faite d'espaces: le code execute vient du
// cache, jamais de ce remplissage.
Module._extensions['.jsc'] = function (module, chemin) {
  const brut = fs.readFileSync(chemin);
  const longueur = brut.readUInt32LE(0);
  const cachedData = brut.subarray(4);
  const script = new vm.Script(' '.repeat(longueur), { cachedData, filename: chemin });
  if (script.cachedDataRejected) throw new Error('bytecode refuse par V8: ' + chemin);
  const fabrique = script.runInThisContext();
  fabrique.call(module.exports, module.exports, module.require.bind(module), module, chemin, require('node:path').dirname(chemin));
};
```

`amorceur/electron.js` charge le point d'entrée en essayant les deux extensions :

```js
  require('./jsc');
  const entree = ['desktop/main.jsc', 'desktop/main.js']
    .map((r) => path.join(resultat.dossier, r))
    .find((p) => fs.existsSync(p));
  if (!entree) throw new Error('aucun point d entree dans ' + resultat.dossier);
  require(entree);
```

- [ ] **Étape 3 : couper les outils de développement**

Dans `desktop/main.js:236-248` et dans `amorceur/ecran.js`, ajouter à chaque `webPreferences` :

```js
      devTools: false,
```

- [ ] **Étape 4 : réduire le journal**

`desktop/main.js:68-71` :

```js
// Un ami ne doit pas pouvoir lire ce qui circule. Le journal detaille ne
// s'allume que sur demande explicite, par variable d'environnement.
const VERBEUX = process.env.OMNI_JOURNAL === 'complet';

function journal(pid, texte) {
  if (!VERBEUX) return;
  const t = String(Date.now() - DEPART).padStart(7);
  console.log(`${t}ms [${pid}] ${texte}`);
}
```

- [ ] **Étape 5 : vérifier, puis commiter**

Run: `npm test` — la suite doit passer et imprimer son total.
Run: `npm run app` — l'application démarre toujours, et `Ctrl+Shift+I` n'ouvre plus rien.

```bash
git add outils/compiler-bytecode.js outils/essai-bytecode.js amorceur/jsc.js amorceur/electron.js desktop/main.js
git commit -m "feat(maj): durcissement, bytecode V8 et journal reduit"
```

---

### Tâche 9 : l'essai de bout en bout

**Aucun code.** Cette tâche vérifie les onze critères du spec sur la vraie chaîne, avec le vrai service. Elle se fait **avec l'utilisateur**.

- [ ] **Étape 1 : publier une version**

Suivre l'enchaînement de la tâche 7 (incrémenter, fabriquer, publier, déployer, activer). Vérifier au passage que `node publier.js` affiche la même empreinte que `npm run paquet-code`.

- [ ] **Étape 2 : les onze critères, un par un**

| critère | comment le vérifier |
|---|---|
| 1. clé demandée, validée, enregistrée | supprimer `%APPDATA%\OMNI\cle.txt`, lancer, saisir la clé de `test` |
| 1 bis. clé invalide refusée | saisir n'importe quoi : message, et l'écran redemande |
| 2. clé réutilisée | relancer : aucun écran de saisie |
| 3. mise à jour automatique | publier une version, relancer, lire le numéro dans l'en-tête |
| 4. révocation individuelle | désactiver `test` dans le panneau, relancer : refus ; réactiver |
| 5. service injoignable | couper le réseau, relancer : l'application démarre quand même |
| 6. archive corrompue | modifier `sha256` dans la base via le panneau ou `publier.js`, relancer : rien ne s'installe |
| 7. version qui plante | publier volontairement une version dont `desktop/main.js` lève à la première ligne, relancer deux fois : le second lancement repart sur la précédente |
| 8. coupe-circuit | `service {actif:false, message}` depuis le panneau, relancer : refus avec le message |
| 9. 404 sans clé | déjà mesuré à la tâche 8 du plan A, à re-vérifier une fois |
| 10. aucun `.js` lisible | `dir /s desktop\dist\OMNI-win32-x64\resources` après `npm run pack` |
| 11. `npm test` | la suite passe et imprime son total |

- [ ] **Étape 3 : consigner**

Écrire les mesures dans ce plan, comme la tâche 8 du plan A. Noter en particulier ce que le critère 7 a réellement produit : c'est le mécanisme le plus difficile à vérifier et le plus coûteux s'il est faux.

---

## Revue du plan

**Couverture du spec.** Séquence de démarrage → T4. Stockage versionné et témoin → T1. Archive et SHA-256 → T2. Canal → T3. Saisie de clé au premier lancement → T4 (logique) et T5 (fenêtre). Dépendances résolues vers le paquet, version initiale embarquée, version affichée → T6. Publication → T7. Durcissement (bytecode, outils de développement, journal) → T8. Les onze critères → T9. Les trois fonctions Vercel, la base et le panneau sont livrés par le plan A.

**Placeholders.** Aucun `TBD`. La seule inconnue est nommée et bornée : le va-et-vient du bytecode V8 sous Electron, mesuré à la première étape de la tâche 8, avec une conduite à tenir écrite si la mesure est négative.

**Cohérence des types.** `depot` (T1) traverse T4 et T6 ; `{ chemin, contenu }` est le même objet en T2 et T7 ; `{ etat: 'ok' | 'refuse' | 'injoignable' | 'corrompu' }` sort de T3 et n'est lu que par T4 ; `demanderCle`/`afficherArret` sont définis en T4 (faux) et implémentés en T5 (vrais) avec la même signature ; `demarrer` rend `{ action: 'charger' | 'arreter' }`, seul contrat lu par T6.

**Écart assumé par rapport au spec.** Le spec annonçait un manifeste portant une `url`. Le service livré n'en a pas : l'archive se prend sur `/api/paquet`, route fixe. Le client ne suit donc aucune URL fournie par le serveur — c'est plus sûr, et c'est ce qui est implémenté des deux côtés.
