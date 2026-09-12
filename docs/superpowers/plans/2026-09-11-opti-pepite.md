# Le coût de la pépite — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à OMNI le coût en kamas d'une pépite pour chaque objet recyclable, et tenir toutes les 12 heures le classement des 50 meilleurs.

**Architecture:** Une table de taux figée dans le dépôt (`taux.json`, 4 049 entrées), un classeur pur qui la croise avec les prix moyens déjà reçus par la trame `ivi`, un historique sur disque plafonné à 30 passes, et un panneau dans la fenêtre principale sur le patron du tableau des archimonstres. **Aucune trame n'est émise** : c'est ce qui rend la minuterie inoffensive.

**Tech Stack:** Node ≥ 18 sans dépendance nouvelle, `node --test` + `node:assert`, Electron pour le câblage IHM.

**Conception :** `docs/superpowers/specs/2026-09-11-opti-pepite-design.md`. À lire avant la tâche 1.

## Global Constraints

- **Aucune dépendance npm nouvelle.** Le dépôt tient sur `frida` et `protobufjs`, rien d'autre en production.
- **`'use strict';` en tête de chaque fichier `.js`**, sans exception dans ce dépôt.
- **Les commentaires de code s'écrivent sans accents** (`objets.js`, `vente.js`, `tableau.js` : tous). Les fichiers `.md` et les chaînes affichées à l'utilisateur, eux, portent leurs accents.
- **Les commentaires disent POURQUOI, pas QUOI.** Le dépôt écrit ses raisons en majuscules en tête de bloc quand elles ont coûté une soirée. Suivre ce ton.
- **Tests :** `node --test`, fichiers dans `test/`, nommés `pepites-*.test.js`. Jamais de framework ajouté.
- **Signature d'écoute :** `onTrame({ pid, dir, frame })`, avec le garde `dir !== 'in'` en première ligne, comme `src/hdv/vente.js:481`.
- **La trame `ivi` porte le type `itn`** une fois décodée. `lirePrixMoyens(frame)` de `src/hdv/trames.js` rend une `Map` gid → prix moyen unitaire.
- **Version du jeu de référence :** `3.6.11.15` (`StreamingAssets/version`, build 2026-09-10). C'est elle que `taux.json` enregistre.
- **Le seuil de prix suspect vaut 10 kamas**, et c'est un marqueur, jamais un filtre.
- **Le plafond d'historique vaut 30 passes.**
- **La limite du classement vaut 50 lignes.**

---

### Task 1: La table des taux et sa lecture

**Files:**
- Create: `outils/faire-pepites.js`
- Create: `src/pepites/taux.json` (produit par le tool, pas écrit à la main)
- Create: `src/pepites/taux.js`
- Test: `test/pepites-taux.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: `tauxDe(gid) -> number | null` et `{ TAUX, JEU }`. `TAUX` est l'objet nu `{ "303": 0.003 }`, `JEU` la chaîne de version du jeu. Toutes les tâches suivantes lisent `tauxDe`.

- [ ] **Step 1: Écrire le tool de fabrication**

Créer `outils/faire-pepites.js` :

```js
'use strict';
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Fabrique src/pepites/taux.json depuis DofusDB: le taux de recyclage en
// pepites, a l'unite, de chaque objet recyclable.
//
//   node outils/faire-pepites.js
//
// IL NE TOURNE JAMAIS EN PRODUCTION, comme faire-objets.js dont il copie
// l'API, la pagination et les raisons.
//
// POURQUOI DOFUSDB ET PAS LE JEU. Le client porte la meme donnee, et elle a
// ete verifiee contre lui le 11/09: 21 776 objets, valeurs identiques au
// 1e-9, zero ecart. Mais la lire demande d'ouvrir un bundle UnityFS, de
// decompresser un bloc LZMA de 16 Mo et de resoudre un registre de references
// managees. C'est un geste de developpement, pas une etape d'outil.
//
// LA TABLE EST RESTREINTE AUX TAUX > 0, contrairement a objets.json qui garde
// tout. Ici la restriction ne cache rien: un objet sans taux n'est pas
// recyclable, il n'a aucune ligne a occuper, et la table tombe de 21 776 a
// 4 049 entrees.
const RACINE = 'https://api.dofusdb.fr';

// L'API plafonne a 50 par appel, meme si on demande plus. Mesure du 05/09,
// recopiee de faire-objets.js.
const PAGE = 50;

// D'ou vient la version du jeu qu'on enregistre. Absente, la table le dit
// plutot que de mentir.
const VERSION = path.join(
  os.homedir(), 'AppData', 'Local', 'Ankama', 'Dofus-dofus3',
  'Dofus_Data', 'StreamingAssets', 'version',
);

function lireJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`${res.statusCode} sur ${url}`));
        return;
      }
      let corps = '';
      res.setEncoding('utf8');
      res.on('data', (m) => { corps += m; });
      res.on('end', () => {
        try { resolve(JSON.parse(corps)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// LE JEU N'EST PAS INTERROGE, SEULEMENT LU. Si l'installation n'est pas la,
// on ecrit null: une table qui pretendrait avoir ete verifiee contre une
// version qu'on n'a pas vue serait pire qu'une table qui l'avoue.
function versionDuJeu() {
  try {
    const m = /Version=([0-9.]+)/.exec(fs.readFileSync(VERSION, 'utf8'));
    return m === null ? null : m[1];
  } catch (e) {
    return null;
  }
}

async function tout() {
  const out = [];
  let total = null;
  while (total === null || out.length < total) {
    const j = await lireJson(
      `${RACINE}/items?$select[]=id&$select[]=recyclingNuggets`
      + `&$limit=${PAGE}&$skip=${out.length}`,
    );
    if (total === null) total = j.total;
    if (!j.data.length) break;
    for (const it of j.data) out.push(it);
  }
  return out;
}

async function principal() {
  const items = await tout();
  const objets = {};
  for (const it of items) {
    const t = it.recyclingNuggets;
    if (typeof t === 'number' && t > 0) objets[String(it.id)] = t;
  }
  const jeu = versionDuJeu();
  const cible = path.join(__dirname, '..', 'src', 'pepites', 'taux.json');
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  fs.writeFileSync(cible, JSON.stringify({ jeu, objets }), 'utf8');
  console.log(`${items.length} objets parcourus, ${Object.keys(objets).length} recyclables`);
  console.log(jeu === null
    ? 'version du jeu introuvable: taux.json porte jeu=null'
    : `verifie contre le jeu ${jeu}`);
}

principal().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Lancer le tool et vérifier ce qu'il produit**

```bash
node outils/faire-pepites.js
```

Attendu : `21776 objets parcourus, 4049 recyclables` puis `verifie contre le jeu 3.6.11.15`.

```bash
node -e "const t=require('./src/pepites/taux.json');console.log(t.jeu, Object.keys(t.objets).length, t.objets['303'])"
```

Attendu : `3.6.11.15 4049 0.003000000026077032`

Si le nombre d'objets recyclables diffère de 4 049, **ne pas forcer** : Ankama a bougé la donnée depuis le 11/09. Reporter le nouveau nombre dans le test de l'étape 3 et le noter en commentaire de commit.

- [ ] **Step 3: Écrire le test qui échoue**

Créer `test/pepites-taux.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { tauxDe, TAUX, JEU } = require('../src/pepites/taux');

// 4 049, ET LE CHIFFRE EST FIGE ICI, comme les 21 748 objets et les 286
// archimonstres. Les taux BOUGENT d'une version du jeu a l'autre -- mesure le
// 11/09: 22 divergences entre le client live et la beta installee. Le jour ou
// Ankama y touche, c'est ce test qui tombe le premier et rappelle que
// outils/faire-pepites.js existe.
test('la table porte les 4 049 objets recyclables', () => {
  assert.strictEqual(Object.keys(TAUX).length, 4049);
});

test('la table dit contre quelle version du jeu elle a ete verifiee', () => {
  assert.match(JEU, /^\d+\.\d+\.\d+\.\d+$/);
});

test('un gid connu rend son taux', () => {
  assert.strictEqual(tauxDe(303), 0.003000000026077032);
  assert.strictEqual(tauxDe(13731), 0.07114285714285715);
});

// LES TRAMES DONNENT DES NOMBRES, LE JSON PORTE DES CHAINES.
test('le gid marche en nombre comme en chaine', () => {
  assert.strictEqual(tauxDe('303'), 0.003000000026077032);
});

// UN OBJET NON RECYCLABLE N'EST PAS DANS LA TABLE. Il rend null, et surtout
// pas 0: une division par zero rendrait l'infini, qui trierait en tete du
// classement -- exactement le pire objet presente comme le meilleur.
test('un objet non recyclable rend null', () => {
  assert.strictEqual(tauxDe(44), null);
  assert.strictEqual(tauxDe(999999), null);
});

test('une cle heritee d Object ne passe pas pour un taux', () => {
  assert.strictEqual(tauxDe('toString'), null);
  assert.strictEqual(tauxDe('constructor'), null);
});

test('ni null ni undefined ne cassent la table', () => {
  assert.strictEqual(tauxDe(null), null);
  assert.strictEqual(tauxDe(undefined), null);
});
```

- [ ] **Step 4: Lancer le test pour le voir échouer**

```bash
node --test test/pepites-taux.test.js
```

Attendu : ÉCHEC, `Cannot find module '../src/pepites/taux'`.

- [ ] **Step 5: Écrire la lecture**

Créer `src/pepites/taux.js` :

```js
'use strict';
const TABLE = require('./taux.json');

// Le taux de recyclage en pepites, a l'unite, de chaque objet du jeu.
//
// Fabrication: outils/faire-pepites.js, qui ne tourne jamais ici.
// Fonction pure: ni Electron, ni Frida, ni reseau, ni disque.
// Conception: docs/superpowers/specs/2026-09-11-opti-pepite-design.md.
//
// LA TABLE NE PORTE QUE LES OBJETS RECYCLABLES -- 4 049 sur 21 776. C'est la
// difference avec objets.json, qui garde tout: la un gid absent voudrait dire
// « nom inconnu », ici il veut dire « pas recyclable », et c'est une reponse,
// pas un trou.
//
// ELLE PORTE AUSSI LA VERSION DU JEU contre laquelle elle a ete verifiee.
// Mesure du 11/09: entre le client live et la beta installee sur la machine de
// developpement, 22 taux divergent. Une table figee peut donc se demoder, et
// une table qui ne dit pas son age ne le laisse pas voir.
const TAUX = TABLE.objets;
const JEU = TABLE.jeu;

// NULL, ET JAMAIS 0. Le zero est le piege de ce fichier: le classement divise
// le prix par le taux, et une division par zero rend l'infini -- qui ne casse
// rien, ne leve rien, et va se ranger a une extremite du tri. Le pire objet du
// jeu presente comme le meilleur, sans une ligne de journal.
//
// hasOwnProperty PAR APPEL, comme objets.js: la table vient d'un JSON.parse,
// donc elle herite d'Object.prototype, et un gid nomme `toString` en sortirait
// une fonction.
function tauxDe(gid) {
  if (gid === null || gid === undefined) return null;
  const cle = String(gid);
  if (!Object.prototype.hasOwnProperty.call(TAUX, cle)) return null;
  const t = TAUX[cle];
  return typeof t === 'number' && t > 0 ? t : null;
}

module.exports = { tauxDe, TAUX, JEU };
```

- [ ] **Step 6: Lancer le test pour le voir passer**

```bash
node --test test/pepites-taux.test.js
```

Attendu : 7 tests, tous PASS.

- [ ] **Step 7: Commit**

```bash
git add outils/faire-pepites.js src/pepites/taux.json src/pepites/taux.js test/pepites-taux.test.js
git commit -m "feat(pepites): la table des 4 049 taux de recyclage, et sa lecture"
```

---

### Task 2: Le classement

**Files:**
- Create: `src/pepites/classement.js`
- Test: `test/pepites-classement.test.js`

**Interfaces:**
- Consumes: `tauxDe(gid)` de la tâche 1.
- Produces:
  - `classer({ prixMoyens, limite = 50 }) -> ligne[]`
  - `ligne = { gid, taux, prixMoyen, coutParPepite, suspect }`
  - `PRIX_SUSPECT = 10`, `LIMITE = 50`
  - `prixMoyens` est la `Map` que `lirePrixMoyens()` de `src/hdv/trames.js` rend déjà, passée telle quelle.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `test/pepites-classement.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classer, PRIX_SUSPECT, LIMITE } = require('../src/pepites/classement');

// Trois gids reels, avec leurs vrais taux -- la table est figee dans le depot,
// autant s'en servir plutot que de doubler ce qu'on peut lire.
//
//   303   Bois de Frene      0.003000000026077032
//   13731 Pierre Medicinale  0.07114285714285715
//   44    Epee de Boisaille  pas recyclable
const FRENE = 0.003000000026077032;
const MEDICINALE = 0.07114285714285715;

test('le cout par pepite est le prix divise par le taux', () => {
  const l = classer({ prixMoyens: new Map([[303, 12]]) });
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].gid, 303);
  assert.strictEqual(l[0].taux, FRENE);
  assert.strictEqual(l[0].prixMoyen, 12);
  assert.strictEqual(l[0].coutParPepite, 12 / FRENE);
});

test('le moins cher par pepite passe devant', () => {
  // Medicinale a 19 kamas: 19 / 0.0711 = 267 kamas la pepite.
  // Frene a 12 kamas:      12 / 0.003  = 4 000 kamas la pepite.
  const l = classer({ prixMoyens: new Map([[303, 12], [13731, 19]]) });
  assert.deepStrictEqual(l.map((x) => x.gid), [13731, 303]);
});

// A COUT EGAL, LE TAUX LE PLUS ELEVE D'ABORD: meme depense, moins d'unites a
// trimballer jusqu'au prisme.
test('a cout egal le taux le plus eleve passe devant', () => {
  // On construit deux prix qui donnent exactement le meme cout par pepite.
  const prix = new Map([[303, FRENE * 1000], [13731, MEDICINALE * 1000]]);
  const l = classer({ prixMoyens: prix });
  assert.strictEqual(l[0].coutParPepite, l[1].coutParPepite);
  assert.deepStrictEqual(l.map((x) => x.gid), [13731, 303]);
});

// LE TRI DOIT ETRE TOTAL, sinon deux passes identiques peuvent rendre deux
// ordres differents et la colonne de variation invente des mouvements.
test('a taux egal le gid croissant departage', () => {
  // 7950 et 30365 ne partagent pas de taux; on prend deux gids d'un meme taux
  // en cherchant dans la table.
  const { TAUX } = require('../src/pepites/taux');
  const parTaux = new Map();
  for (const [cle, t] of Object.entries(TAUX)) {
    if (!parTaux.has(t)) parTaux.set(t, []);
    parTaux.get(t).push(Number(cle));
  }
  const paire = [...parTaux.values()].find((g) => g.length >= 2);
  assert.ok(paire, 'la table doit porter deux objets de meme taux');
  const [a, b] = paire.slice(0, 2).sort((x, y) => x - y);
  const t = require('../src/pepites/taux').tauxDe(a);
  const l = classer({ prixMoyens: new Map([[b, t * 100], [a, t * 100]]) });
  assert.deepStrictEqual(l.map((x) => x.gid), [a, b]);
});

test('un objet non recyclable n entre pas au classement', () => {
  const l = classer({ prixMoyens: new Map([[44, 700]]) });
  assert.deepStrictEqual(l, []);
});

test('un prix absent, nul ou negatif n entre pas au classement', () => {
  assert.deepStrictEqual(classer({ prixMoyens: new Map([[303, 0]]) }), []);
  assert.deepStrictEqual(classer({ prixMoyens: new Map([[303, -5]]) }), []);
  assert.deepStrictEqual(classer({ prixMoyens: new Map([[303, null]]) }), []);
});

// LE DOUTE EST UN MARQUEUR, JAMAIS UN FILTRE. La ligne reste a sa place.
test('un prix de 10 kamas ou moins est marque suspect sans etre ecarte', () => {
  assert.strictEqual(PRIX_SUSPECT, 10);
  const l = classer({ prixMoyens: new Map([[303, PRIX_SUSPECT]]) });
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].suspect, true);
});

test('un prix de 11 kamas n est pas suspect', () => {
  const l = classer({ prixMoyens: new Map([[303, PRIX_SUSPECT + 1]]) });
  assert.strictEqual(l[0].suspect, false);
});

test('le classement coupe a 50 lignes', () => {
  assert.strictEqual(LIMITE, 50);
  const { TAUX } = require('../src/pepites/taux');
  const prix = new Map();
  let n = 0;
  for (const cle of Object.keys(TAUX)) {
    if (n >= 60) break;
    prix.set(Number(cle), 1000 + n);
    n += 1;
  }
  assert.strictEqual(classer({ prixMoyens: prix }).length, 50);
});

test('la limite se regle, pour la recherche comme pour les tests', () => {
  const { TAUX } = require('../src/pepites/taux');
  const prix = new Map();
  let n = 0;
  for (const cle of Object.keys(TAUX)) {
    if (n >= 10) break;
    prix.set(Number(cle), 1000 + n);
    n += 1;
  }
  assert.strictEqual(classer({ prixMoyens: prix, limite: 3 }).length, 3);
});

// UNE TABLE ABSENTE N'EST PAS UNE TABLE VIDE, mais les deux rendent le meme
// classement vide: c'est l'appelant qui sait dire « pas encore de prix », pas
// le classeur.
test('une table de prix absente rend un classement vide', () => {
  assert.deepStrictEqual(classer({ prixMoyens: null }), []);
  assert.deepStrictEqual(classer({ prixMoyens: new Map() }), []);
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
node --test test/pepites-classement.test.js
```

Attendu : ÉCHEC, `Cannot find module '../src/pepites/classement'`.

- [ ] **Step 3: Écrire le classeur**

Créer `src/pepites/classement.js` :

```js
'use strict';
const { tauxDe } = require('./taux');

// Du croisement « quel objet donne la pepite la moins chere » au tableau
// affichable. Fonction pure: ni trame, ni reseau, ni disque, ni Electron.
//
// Conception: docs/superpowers/specs/2026-09-11-opti-pepite-design.md.
//
// LE TRI EST ICI ET PAS DANS LE PANNEAU, pour la meme raison que stock.js et
// tableau.js existent: c'est la seule decision du lot qui peut couter des
// kamas. Un comparateur ecrit a l'envers ferait acheter le pire objet en le
// presentant comme le meilleur, et il n'y aurait rien a voir -- ni exception,
// ni ligne de journal, juste un tableau plausible et faux.

// 50 lignes, le chiffre de la spec.
const LIMITE = 50;

// LE SEUIL DE DOUTE, ET IL EST ARBITRAIRE -- la spec le dit franchement.
//
// `ivi` est une moyenne glissante du serveur: sur un objet que plus personne
// ne vend, elle reste figee sur une vieille transaction, et un objet a 1 kama
// de moyenne sortirait premier tout en etant introuvable.
//
// CE QUI REND L'ARBITRAIRE ACCEPTABLE, C'EST QU'IL N'ECARTE RIEN. La ligne
// reste a sa place, marquee. Un garde-fou par comparaison a ete cherche: le
// champ `price` de DofusDB vaut 0 pour le Bois de Frene et 1 pour la Pierre
// Medicinale, qui se negocie a 19 kamas l'unite. Il ne mesure rien.
const PRIX_SUSPECT = 10;

// `prixMoyens` est la Map rendue par lirePrixMoyens() de src/hdv/trames.js,
// passee telle quelle: le classeur ne connait pas les trames, et c'est ce qui
// le rend testable sans double.
function classer({ prixMoyens, limite = LIMITE }) {
  const lignes = [];
  if (prixMoyens === null || prixMoyens === undefined) return lignes;
  for (const [gid, prixMoyen] of prixMoyens) {
    const taux = tauxDe(gid);
    // tauxDe rend null pour « pas recyclable », qui est la majorite du
    // catalogue: 4 049 objets sur 21 776. Ce n'est pas une anomalie, on ne la
    // journalise pas.
    if (taux === null) continue;
    if (typeof prixMoyen !== 'number' || !(prixMoyen > 0)) continue;
    lignes.push({
      gid,
      taux,
      prixMoyen,
      coutParPepite: prixMoyen / taux,
      suspect: prixMoyen <= PRIX_SUSPECT,
    });
  }
  // LES TROIS CRANS DU TRI, ET AUCUN N'EST DECORATIF.
  //
  // 1. le cout par pepite, croissant: c'est la question posee.
  // 2. a cout egal, le taux le plus eleve: meme depense, moins d'unites a
  //    trimballer jusqu'au prisme.
  // 3. a taux egal, le gid: le tri doit etre TOTAL. Sans ce dernier cran,
  //    deux passes sur les memes chiffres peuvent rendre deux ordres
  //    differents, et la colonne de variation inventerait des mouvements que
  //    le marche n'a pas faits.
  lignes.sort((a, b) => (a.coutParPepite - b.coutParPepite)
    || (b.taux - a.taux)
    || (a.gid - b.gid));
  return lignes.slice(0, limite);
}

module.exports = { classer, LIMITE, PRIX_SUSPECT };
```

- [ ] **Step 4: Lancer le test pour le voir passer**

```bash
node --test test/pepites-classement.test.js
```

Attendu : 11 tests, tous PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pepites/classement.js test/pepites-classement.test.js
git commit -m "feat(pepites): le classement par cout de la pepite, et son tri total"
```

---

### Task 3: La comparaison de deux passes, et la recherche

**Files:**
- Modify: `src/pepites/classement.js` (ajout de deux fonctions et de leurs exports)
- Modify: `test/pepites-classement.test.js` (ajout de deux blocs de tests)

**Interfaces:**
- Consumes: `classer()`, `tauxDe()`, plus `nomDe(gid)` de `src/hdv/objets.js`.
- Produces:
  - `comparer(precedent, courant) -> { lignes, sorties }` où chaque élément porte `etat` dans `'entree' | 'montee' | 'stable' | 'descente' | 'sortie'`, plus `deltaRang` et `deltaCout` (`null` pour `entree` et `sortie`).
  - `chercher({ texte, prixMoyens, limite = 20 }) -> ligne[]` où `ligne` ajoute `nom` et accepte `prixMoyen: null` / `coutParPepite: null` pour « prix inconnu ».

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `test/pepites-classement.test.js` :

```js
const { comparer, chercher } = require('../src/pepites/classement');

// --- comparer() -------------------------------------------------------

function ligne(gid, cout) {
  return { gid, taux: 1, prixMoyen: cout, coutParPepite: cout, suspect: false };
}

test('un gid absent de la passe precedente est une entree', () => {
  const r = comparer([], [ligne(303, 100)]);
  assert.strictEqual(r.lignes[0].etat, 'entree');
  assert.strictEqual(r.lignes[0].deltaRang, null);
  assert.strictEqual(r.lignes[0].deltaCout, null);
});

test('un gid qui gagne des rangs est une montee', () => {
  const avant = [ligne(1, 10), ligne(303, 100)];
  const apres = [ligne(303, 90), ligne(1, 10)];
  const r = comparer(avant, apres);
  const l = r.lignes.find((x) => x.gid === 303);
  assert.strictEqual(l.etat, 'montee');
  assert.strictEqual(l.deltaRang, 1);
  assert.strictEqual(l.deltaCout, -10);
});

test('un gid qui perd des rangs est une descente', () => {
  const avant = [ligne(303, 90), ligne(1, 100)];
  const apres = [ligne(1, 100), ligne(303, 110)];
  const l = comparer(avant, apres).lignes.find((x) => x.gid === 303);
  assert.strictEqual(l.etat, 'descente');
  assert.strictEqual(l.deltaRang, -1);
  assert.strictEqual(l.deltaCout, 20);
});

test('un gid au meme rang est stable, meme si son prix a bouge', () => {
  const l = comparer([ligne(303, 100)], [ligne(303, 105)]).lignes[0];
  assert.strictEqual(l.etat, 'stable');
  assert.strictEqual(l.deltaRang, 0);
  assert.strictEqual(l.deltaCout, 5);
});

// LE CAS QU'ON OUBLIE: il porte sur une ligne ABSENTE du classement courant,
// donc aucune boucle sur `courant` ne peut le produire.
test('un gid disparu du classement est une sortie, rendue a part', () => {
  const r = comparer([ligne(303, 100), ligne(1, 10)], [ligne(1, 10)]);
  assert.deepStrictEqual(r.lignes.map((x) => x.gid), [1]);
  assert.strictEqual(r.sorties.length, 1);
  assert.strictEqual(r.sorties[0].gid, 303);
  assert.strictEqual(r.sorties[0].etat, 'sortie');
});

test('une premiere passe sans precedent ne rend que des entrees', () => {
  const r = comparer(null, [ligne(303, 100), ligne(1, 10)]);
  assert.deepStrictEqual(r.lignes.map((x) => x.etat), ['entree', 'entree']);
  assert.deepStrictEqual(r.sorties, []);
});

// --- chercher() -------------------------------------------------------

test('la recherche trouve un objet recyclable par son nom', () => {
  const r = chercher({ texte: 'Bois de Frene', prixMoyens: new Map([[303, 12]]) });
  const l = r.find((x) => x.gid === 303);
  assert.ok(l, 'le Bois de Frene doit sortir');
  assert.strictEqual(l.nom, 'Bois de Frêne');
  assert.strictEqual(l.coutParPepite, 12 / 0.003000000026077032);
});

// LES NOMS DU JEU PORTENT DES ACCENTS, PAS LES CLAVIERS PRESSES. Chercher
// Chercher `frene` doit trouver le Bois de Frene, dont le nom du jeu porte
// un accent circonflexe. Sans cela la barre ne sert qu'a ceux qui savent
// deja ecrire ce qu'ils cherchent.
test('la recherche ignore les accents et la casse', () => {
  const r = chercher({ texte: 'FRENE', prixMoyens: new Map() });
  assert.ok(r.some((x) => x.gid === 303));
});

// UN OBJET RECYCLABLE SANS PRIX SE DIT, il ne se cache pas: la recherche
// repond « prix inconnu » la ou le classement, lui, ne peut pas le ranger.
test('un objet recyclable sans prix sort avec un cout null', () => {
  const l = chercher({ texte: 'Bois de Frene', prixMoyens: new Map() })
    .find((x) => x.gid === 303);
  assert.strictEqual(l.prixMoyen, null);
  assert.strictEqual(l.coutParPepite, null);
});

test('les objets sans prix passent apres ceux qui en ont un', () => {
  const r = chercher({ texte: 'bois', prixMoyens: new Map([[303, 12]]) });
  const avecPrix = r.findIndex((x) => x.coutParPepite !== null);
  const sansPrix = r.findIndex((x) => x.coutParPepite === null);
  if (sansPrix !== -1) assert.ok(avecPrix < sansPrix);
});

test('un objet non recyclable ne sort jamais de la recherche', () => {
  // 44 est l'Epee de Boisaille, taux 0.
  const r = chercher({ texte: 'Epee de Boisaille', prixMoyens: new Map([[44, 700]]) });
  assert.deepStrictEqual(r.filter((x) => x.gid === 44), []);
});

// UNE LETTRE RENDRAIT DES CENTAINES DE LIGNES a chaque frappe.
test('une recherche de moins de deux caracteres ne rend rien', () => {
  assert.deepStrictEqual(chercher({ texte: 'b', prixMoyens: new Map() }), []);
  assert.deepStrictEqual(chercher({ texte: '', prixMoyens: new Map() }), []);
  assert.deepStrictEqual(chercher({ texte: null, prixMoyens: new Map() }), []);
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

```bash
node --test test/pepites-classement.test.js
```

Attendu : ÉCHEC, `comparer is not a function`.

- [ ] **Step 3: Écrire les deux fonctions**

Ajouter dans `src/pepites/classement.js`, avant `module.exports` (et compléter le `require` du haut avec `const { nomDe } = require('../hdv/objets');`) :

```js
// Combien de lignes la barre de recherche rend au plus. Au-dela, la liste
// cesse d'etre une reponse et redevient un catalogue.
const LIMITE_RECHERCHE = 20;

// De deux passes au mouvement de chacune de leurs lignes.
//
// LES SORTIES SONT RENDUES A PART, ET C'EST TOUT L'INTERET DE CETTE FONCTION.
// Une ligne sortie du classement n'existe PAS dans `courant`: aucune boucle
// sur la passe courante ne peut la produire. C'est le cas qu'on oublie, et
// c'est aussi le seul qui interesse -- « qu'est-ce qui n'est plus rentable »
// est la question qu'on se pose en revenant apres deux jours.
//
// LA COMPARAISON PORTE SUR LA PASSE PRECEDENTE, pas sur une moyenne: on veut
// voir ce qui vient de bouger, pas une tendance lissee qui noierait le
// mouvement du jour.
function comparer(precedent, courant) {
  const avant = new Map();
  (precedent || []).forEach((l, rang) => {
    avant.set(l.gid, { rang, cout: l.coutParPepite });
  });
  const vus = new Set();
  const lignes = (courant || []).map((l, rang) => {
    vus.add(l.gid);
    const a = avant.get(l.gid);
    // NULL ET PAS 0 pour une entree: un ecart de zero voudrait dire « rien
    // n'a bouge », et c'est faux -- il n'y avait rien a quoi se comparer.
    if (a === undefined) return { ...l, etat: 'entree', deltaRang: null, deltaCout: null };
    let etat = 'stable';
    if (rang < a.rang) etat = 'montee';
    else if (rang > a.rang) etat = 'descente';
    return { ...l, etat, deltaRang: a.rang - rang, deltaCout: l.coutParPepite - a.cout };
  });
  const sorties = (precedent || [])
    .filter((l) => !vus.has(l.gid))
    .map((l) => ({ ...l, etat: 'sortie', deltaRang: null, deltaCout: null }));
  return { lignes, sorties };
}

// Les noms du jeu portent des accents, les recherches n'en portent pas.
function sansAccent(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// La recherche libre: le taux et le cout par pepite de N'IMPORTE QUEL objet
// recyclable, y compris ceux que le classement ne montrera jamais.
//
// ELLE PARCOURT LA TABLE DES TAUX, PAS CELLE DES PRIX, et c'est ce qui la
// distingue de classer(). Un objet recyclable dont personne ne connait le prix
// doit pouvoir se chercher: la reponse « prix inconnu » est une reponse, alors
// que l'absence de ligne laisserait croire qu'il n'est pas recyclable.
function chercher({ texte, prixMoyens, limite = LIMITE_RECHERCHE }) {
  const q = sansAccent(texte === null || texte === undefined ? '' : texte).trim();
  if (q.length < 2) return [];
  const out = [];
  for (const cle of Object.keys(TAUX)) {
    const nom = nomDe(cle);
    if (nom === null || !sansAccent(nom).includes(q)) continue;
    const gid = Number(cle);
    const taux = tauxDe(gid);
    if (taux === null) continue;
    const brut = prixMoyens === null || prixMoyens === undefined
      ? undefined
      : prixMoyens.get(gid);
    const prixMoyen = typeof brut === 'number' && brut > 0 ? brut : null;
    out.push({
      gid,
      nom,
      taux,
      prixMoyen,
      coutParPepite: prixMoyen === null ? null : prixMoyen / taux,
      suspect: prixMoyen !== null && prixMoyen <= PRIX_SUSPECT,
    });
  }
  // LES SANS-PRIX EN DERNIER, et pas melanges: ils n'ont pas de cout, donc
  // aucune place legitime dans un tri par cout. Les mettre en tete ferait
  // passer « on ne sait pas » pour « c'est le meilleur ».
  out.sort((a, b) => {
    if (a.coutParPepite === null && b.coutParPepite === null) return a.gid - b.gid;
    if (a.coutParPepite === null) return 1;
    if (b.coutParPepite === null) return -1;
    return (a.coutParPepite - b.coutParPepite) || (b.taux - a.taux) || (a.gid - b.gid);
  });
  return out.slice(0, limite);
}
```

Et remplacer la ligne d'export par :

```js
module.exports = { classer, comparer, chercher, LIMITE, LIMITE_RECHERCHE, PRIX_SUSPECT };
```

Ajouter aussi en tête du fichier, sous le `require` existant :

```js
const { tauxDe, TAUX } = require('./taux');
const { nomDe } = require('../hdv/objets');
```

(la ligne `const { tauxDe } = require('./taux');` de la tâche 2 est remplacée par celle-ci.)

- [ ] **Step 4: Lancer les tests pour les voir passer**

```bash
node --test test/pepites-classement.test.js
```

Attendu : 23 tests, tous PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pepites/classement.js test/pepites-classement.test.js
git commit -m "feat(pepites): la variation entre deux passes, et la recherche libre"
```

---

### Task 4: L'historique sur disque

**Files:**
- Create: `src/pepites/historique.js`
- Test: `test/pepites-historique.test.js`

**Interfaces:**
- Consumes: rien des tâches précédentes.
- Produces: `creerHistorique({ chemin, onErreur }) -> { lire(), dernier(), ajouter(passe) }`. Une `passe` est `{ quand, prixQuand, pid, lignes }`. `PASSES_GARDEES = 30`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `test/pepites-historique.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { creerHistorique, PASSES_GARDEES } = require('../src/pepites/historique');

function dossier() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pepites-'));
}

function passe(quand) {
  return { quand, prixQuand: quand - 1000, pid: 42, lignes: [] };
}

test('un fichier absent rend un historique vide, sans erreur', () => {
  const erreurs = [];
  const h = creerHistorique({
    chemin: path.join(dossier(), 'pepites.json'),
    onErreur: (e) => erreurs.push(e),
  });
  assert.deepStrictEqual(h.lire(), []);
  assert.strictEqual(h.dernier(), null);
  // UN FICHIER ABSENT N'EST PAS UNE ERREUR: c'est le premier lancement.
  assert.deepStrictEqual(erreurs, []);
});

test('une passe ajoutee se relit', () => {
  const c = path.join(dossier(), 'pepites.json');
  const h = creerHistorique({ chemin: c, onErreur: () => {} });
  h.ajouter(passe(1000));
  assert.strictEqual(h.lire().length, 1);
  assert.strictEqual(h.dernier().quand, 1000);
  // Une instance neuve sur le meme fichier doit voir la meme chose.
  const h2 = creerHistorique({ chemin: c, onErreur: () => {} });
  assert.strictEqual(h2.dernier().quand, 1000);
});

test('l historique garde les 30 dernieres passes et jette les plus vieilles', () => {
  assert.strictEqual(PASSES_GARDEES, 30);
  const h = creerHistorique({ chemin: path.join(dossier(), 'pepites.json'), onErreur: () => {} });
  for (let i = 0; i < PASSES_GARDEES + 5; i += 1) h.ajouter(passe(i));
  const tout = h.lire();
  assert.strictEqual(tout.length, PASSES_GARDEES);
  assert.strictEqual(tout[0].quand, 5);
  assert.strictEqual(h.dernier().quand, PASSES_GARDEES + 4);
});

// UN HISTORIQUE PERDU NE VAUT PAS UN BLOCAGE, mais il ne se perd pas en
// silence non plus: la spec demande les deux.
test('un fichier corrompu repart a vide et se journalise', () => {
  const c = path.join(dossier(), 'pepites.json');
  fs.writeFileSync(c, 'ceci n est pas du json', 'utf8');
  const erreurs = [];
  const h = creerHistorique({ chemin: c, onErreur: (e) => erreurs.push(e) });
  assert.deepStrictEqual(h.lire(), []);
  assert.strictEqual(erreurs.length, 1);
});

// Le fichier est relu a la main quand on debugue. Une entree dont la forme ne
// tient pas ne doit pas faire tomber le panneau.
test('une passe de forme inconnue est ecartee sans faire tomber le reste', () => {
  const c = path.join(dossier(), 'pepites.json');
  fs.writeFileSync(c, JSON.stringify({
    passes: [{ quand: 1, prixQuand: 0, pid: 1, lignes: [] }, { pas: 'une passe' }, null, 7],
  }), 'utf8');
  const h = creerHistorique({ chemin: c, onErreur: () => {} });
  assert.strictEqual(h.lire().length, 1);
});

test('un fichier sans tableau de passes repart a vide', () => {
  const c = path.join(dossier(), 'pepites.json');
  fs.writeFileSync(c, JSON.stringify({ autre: 1 }), 'utf8');
  const h = creerHistorique({ chemin: c, onErreur: () => {} });
  assert.deepStrictEqual(h.lire(), []);
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
node --test test/pepites-historique.test.js
```

Attendu : ÉCHEC, `Cannot find module '../src/pepites/historique'`.

- [ ] **Step 3: Écrire l'historique**

Créer `src/pepites/historique.js` :

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Les passes de classement deja faites, sur disque, a cote de favoris.json.
//
// Conception: docs/superpowers/specs/2026-09-11-opti-pepite-design.md.
//
// POURQUOI UN FICHIER. La colonne de variation compare la passe courante a la
// precedente. Sans disque, la premiere passe apres chaque lancement d'OMNI
// n'aurait rien a quoi se comparer, et la colonne serait vide precisement au
// moment ou on revient voir ce qui a bouge.

// QUINZE JOURS A DEUX PASSES PAR JOUR. Sans plafond le fichier grossirait sans
// fin pour une donnee que personne ne relira: seule la derniere passe sert a
// la comparaison, le reste est du confort.
const PASSES_GARDEES = 30;

// La forme d'une passe. Une entree qui ne la respecte pas est ecartee sans
// bruit -- le fichier se relit a la main quand on debugue, et une ligne mal
// recopiee ne doit pas faire tomber le panneau.
function estUnePasse(p) {
  return p !== null && typeof p === 'object' && !Array.isArray(p)
    && typeof p.quand === 'number' && Array.isArray(p.lignes);
}

// `onErreur` est appele pour ce qui merite le journal, et pour cela seulement:
// un fichier ABSENT n'en fait pas partie. C'est le premier lancement, pas un
// incident, et le journaliser apprendrait aux amis a ignorer ce canal.
function creerHistorique({ chemin, onErreur = () => {} }) {
  let passes = null;

  function lire() {
    if (passes !== null) return passes;
    try {
      const json = JSON.parse(fs.readFileSync(chemin, 'utf8'));
      passes = Array.isArray(json.passes) ? json.passes.filter(estUnePasse) : [];
    } catch (e) {
      // ENOENT est le premier lancement. Tout le reste est un fichier qu'on
      // n'a pas su lire, et celui-la se dit.
      if (e.code !== 'ENOENT') onErreur(e);
      passes = [];
    }
    return passes;
  }

  function dernier() {
    const tout = lire();
    return tout.length === 0 ? null : tout[tout.length - 1];
  }

  function ajouter(passe) {
    const tout = [...lire(), passe].slice(-PASSES_GARDEES);
    passes = tout;
    try {
      fs.mkdirSync(path.dirname(chemin), { recursive: true });
      fs.writeFileSync(chemin, JSON.stringify({ passes: tout }), 'utf8');
    } catch (e) {
      // L'ECRITURE QUI ECHOUE NE PERD QUE L'HISTORIQUE, pas la passe: elle
      // reste en memoire et s'affiche. Un disque plein ne doit pas priver du
      // classement qu'on vient de calculer.
      onErreur(e);
    }
    return tout;
  }

  return { lire, dernier, ajouter };
}

module.exports = { creerHistorique, PASSES_GARDEES };
```

- [ ] **Step 4: Lancer le test pour le voir passer**

```bash
node --test test/pepites-historique.test.js
```

Attendu : 6 tests, tous PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pepites/historique.js test/pepites-historique.test.js
git commit -m "feat(pepites): l historique des passes, plafonne a 30"
```

---

### Task 5: L'écoute d'`ivi` et la minuterie

**Files:**
- Create: `src/pepites/pepites.js`
- Test: `test/pepites.test.js`

**Interfaces:**
- Consumes: `classer`, `comparer` (tâche 3), `creerHistorique` (tâche 4), `lirePrixMoyens` de `src/hdv/trames.js`.
- Produces: `creerPepites({ historique, onPasse, periodeMs, maintenant, poserMinuteur, oterMinuteur }) -> { onTrame, passer, demarrer, arreter, etat }`.
  - `etat()` rend `null` ou `{ quand, pid, taille }`.
  - `passer()` rend `null` (aucun prix connu) ou `{ passe, variation }`.
  - `PERIODE_MS = 12 * 60 * 60 * 1000`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `test/pepites.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerPepites, PERIODE_MS } = require('../src/pepites/pepites');

// Un double d'historique: tout en memoire, aucun disque. L'historique reel a
// ses propres tests, ici on ne verifie que le sequencement.
function fauxHistorique() {
  const passes = [];
  return {
    passes,
    lire: () => passes,
    dernier: () => (passes.length === 0 ? null : passes[passes.length - 1]),
    ajouter: (p) => { passes.push(p); return passes; },
  };
}

// La trame ivi telle que le decodeur la rend: type `itn`, une liste d'elements
// dont chacun porte le gid en 3 et le prix moyen en 5. Forme reprise de
// test/hdv-trames.test.js.
function trameIvi(paires) {
  return {
    type: 'itn',
    payload: paires.map(([gid, prix]) => ({
      no: 1,
      kind: 'message',
      value: [
        { no: 3, kind: 'varint', value: gid },
        { no: 5, kind: 'varint', value: prix },
      ],
    })),
  };
}

function creer(extra = {}) {
  const minuteurs = [];
  const historique = fauxHistorique();
  const passes = [];
  const p = creerPepites({
    historique,
    onPasse: (r) => passes.push(r),
    maintenant: () => 1000,
    poserMinuteur: (fn, ms) => { minuteurs.push({ fn, ms }); return minuteurs.length; },
    oterMinuteur: () => {},
    ...extra,
  });
  return { p, historique, passes, minuteurs };
}

test('la periode vaut douze heures', () => {
  assert.strictEqual(PERIODE_MS, 12 * 60 * 60 * 1000);
});

test('une ivi neuve declenche un classement', () => {
  const { p, passes } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 12]]) });
  assert.strictEqual(passes.length, 1);
  assert.strictEqual(passes[0].passe.lignes[0].gid, 303);
  assert.strictEqual(passes[0].passe.pid, 7);
});

// LE GARDE DE SENS, EN PREMIERE LIGNE, comme dans vente.js: une trame qu'on
// EMET ne dit rien des prix du serveur.
test('une trame sortante est ignoree', () => {
  const { p, passes } = creer();
  p.onTrame({ pid: 7, dir: 'out', frame: trameIvi([[303, 12]]) });
  assert.deepStrictEqual(passes, []);
});

test('une trame d un autre type est ignoree', () => {
  const { p, passes } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: { type: 'kby', payload: [] } });
  assert.deepStrictEqual(passes, []);
});

// UNE ivi VIDE N'EFFACE PAS CE QU'ON SAIT: le panneau deviendrait muet sans
// raison visible. Meme regle que vente.js pour les piles.
test('une ivi vide ne remplace pas la table connue', () => {
  const { p, passes } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 12]]) });
  p.onTrame({ pid: 8, dir: 'in', frame: trameIvi([]) });
  assert.strictEqual(passes.length, 1);
  assert.strictEqual(p.etat().pid, 7);
});

test('la table la plus fraiche gagne, quel que soit le pid', () => {
  const { p } = creer({ maintenant: (() => { let t = 0; return () => { t += 1; return t; }; })() });
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 12]]) });
  p.onTrame({ pid: 9, dir: 'in', frame: trameIvi([[303, 20]]) });
  assert.strictEqual(p.etat().pid, 9);
});

// SANS PRIX, RIEN DU TOUT -- et surtout pas un classement vide, qui se lirait
// comme « aucun objet ne vaut le coup ».
test('une passe sans ivi ne produit rien', () => {
  const { p, passes, historique } = creer();
  assert.strictEqual(p.passer(), null);
  assert.deepStrictEqual(passes, []);
  assert.deepStrictEqual(historique.passes, []);
});

test('la minuterie declenche une passe toutes les douze heures', () => {
  const { p, passes, minuteurs } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 12]]) });
  p.demarrer();
  assert.strictEqual(minuteurs.length, 1);
  assert.strictEqual(minuteurs[0].ms, PERIODE_MS);
  minuteurs[0].fn();
  assert.strictEqual(passes.length, 2);
});

// LES DEUX DECLENCHEURS SONT INDEPENDANTS. Si une ivi rearmait la minuterie,
// une session de jeu reguliere repousserait le battement indefiniment.
test('une ivi ne rearme pas la minuterie', () => {
  const { p, minuteurs } = creer();
  p.demarrer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 12]]) });
  assert.strictEqual(minuteurs.length, 1);
});

test('la variation compare a la passe precedente', () => {
  const { p, passes } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 12]]) });
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 6]]) });
  assert.strictEqual(passes[0].variation.lignes[0].etat, 'entree');
  assert.strictEqual(passes[1].variation.lignes[0].etat, 'stable');
  assert.ok(passes[1].variation.lignes[0].deltaCout < 0);
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
node --test test/pepites.test.js
```

Attendu : ÉCHEC, `Cannot find module '../src/pepites/pepites'`.

- [ ] **Step 3: Écrire le module**

Créer `src/pepites/pepites.js` :

```js
'use strict';
const { lirePrixMoyens } = require('../hdv/trames');
const { classer, comparer } = require('./classement');

// Le classement des pepites: une ecoute permanente, et une minuterie.
//
// Conception: docs/superpowers/specs/2026-09-11-opti-pepite-design.md.
//
// IL RESSEMBLE A reprix.js ET vente.js PAR SA FORME -- une ecoute permanente
// plus un declencheur -- ET IL LEUR MANQUE TOUT LE RESTE. Ce module N'EMET
// AUCUNE TRAME. Pas de sequenceur, pas de rythme, pas de delai de reponse,
// pas de garde d'identite de client: rien de ce qui protege ces deux-la n'a
// d'objet ici, puisque rien ne part vers le jeu.
//
// C'EST AUSSI CE QUI REND LA PERIODICITE INOFFENSIVE. La spec du reprix
// (2026-09-01-maj-prix-hdv-design.md) ecartait explicitement « toute
// periodicite ». Ce qui etait refuse la-bas, c'est une passe de fond QUI EMET.
// Une minuterie qui ne fait que diviser des nombres deja recus ne se voit de
// nulle part.
//
// L'ECOUTE EST PERMANENTE PARCE QUE ivi N'ARRIVE QU'AU LOGIN. Elle ne se
// redemande pas. Un module qui ne se reveillerait qu'a l'ouverture du panneau
// aurait deja rate la seule trame qui dit les prix.
const PERIODE_MS = 12 * 60 * 60 * 1000;

// `poserMinuteur` et `oterMinuteur` entrent par argument pour que la minuterie
// se teste sans piloter d'horloge -- meme raison que le hasard passe en
// argument dans rythme() de reprix.js.
function creerPepites({
  historique,
  onPasse = () => {},
  periodeMs = PERIODE_MS,
  maintenant = () => Date.now(),
  poserMinuteur = (fn, ms) => setInterval(fn, ms),
  oterMinuteur = (id) => clearInterval(id),
}) {
  // La derniere table de prix connue, d'ou qu'elle vienne.
  //
  // ivi EST PROPRE A UN SERVEUR. Deux comptes sur deux serveurs differents
  // donneraient le classement du dernier connecte, et c'est la limite assumee
  // par la spec: les prix moyens de deux serveurs ne se moyennent pas, et
  // pretendre le contraire serait pire que la limite.
  let table = null;
  let minuteur = null;

  function onTrame({ pid, dir, frame }) {
    if (frame === null || frame === undefined || dir !== 'in') return;
    if (frame.type !== 'itn') return;
    const prixMoyens = lirePrixMoyens(frame);
    // UNE TABLE VIDE N'EFFACE PAS CE QU'ON SAIT, meme regle que les piles dans
    // vente.js: le panneau deviendrait muet sans raison visible.
    if (prixMoyens.size === 0) return;
    table = { prixMoyens, quand: maintenant(), pid };
    passer();
  }

  function passer() {
    // RIEN, ET SURTOUT PAS UN CLASSEMENT VIDE. Un tableau vide se lit comme
    // « aucun objet ne vaut le coup », alors que la verite est « je n'ai pas
    // encore vu les prix ». C'est au panneau de le dire.
    if (table === null) return null;
    const lignes = classer({ prixMoyens: table.prixMoyens });
    const precedent = historique.dernier();
    const passe = {
      quand: maintenant(),
      prixQuand: table.quand,
      pid: table.pid,
      lignes,
    };
    historique.ajouter(passe);
    const variation = comparer(precedent === null ? null : precedent.lignes, lignes);
    const resultat = { passe, variation };
    onPasse(resultat);
    return resultat;
  }

  // LA MINUTERIE NE SE REARME PAS SUR UNE ivi, et les deux declencheurs sont
  // independants: sans cela, une session de jeu reguliere -- donc une ivi par
  // connexion -- repousserait le battement des douze heures indefiniment, et
  // la periodicite n'existerait que pour ceux qui ne jouent pas.
  function demarrer() {
    if (minuteur !== null) return;
    minuteur = poserMinuteur(passer, periodeMs);
  }

  function arreter() {
    if (minuteur === null) return;
    oterMinuteur(minuteur);
    minuteur = null;
  }

  // Ce que le panneau a besoin de savoir sans qu'on lui livre la table entiere.
  function etat() {
    if (table === null) return null;
    return { quand: table.quand, pid: table.pid, taille: table.prixMoyens.size };
  }

  // La table de prix elle-meme, pour la recherche libre: elle en a besoin pour
  // dire un cout, et la recopier a chaque frappe serait absurde.
  function prixMoyens() {
    return table === null ? null : table.prixMoyens;
  }

  return { onTrame, passer, demarrer, arreter, etat, prixMoyens };
}

module.exports = { creerPepites, PERIODE_MS };
```

- [ ] **Step 4: Lancer le test pour le voir passer**

```bash
node --test test/pepites.test.js
```

Attendu : 10 tests, tous PASS.

- [ ] **Step 5: Lancer la suite complète**

```bash
npm test
```

Attendu : aucun échec. Le total a monté de 44 tests par rapport aux 416 du README.

- [ ] **Step 6: Commit**

```bash
git add src/pepites/pepites.js test/pepites.test.js
git commit -m "feat(pepites): l ecoute d ivi et la minuterie de douze heures"
```

---

### Task 6: Le câblage Electron

**Files:**
- Modify: `desktop/main.js` (imports vers la ligne 48, création vers la ligne 1225, composition ligne 1543, handlers IPC vers la ligne 1838)
- Modify: `desktop/preload.js` (vers la ligne 39, à côté de `tableauArchi`)

**Interfaces:**
- Consumes: `creerPepites` (tâche 5), `creerHistorique` (tâche 4), `chercher` (tâche 3), `JEU` (tâche 1).
- Produces: deux canaux IPC.
  - `window.app.tableauPepites()` → `{ lignes, sorties, quand, prixQuand, perso, jeu, raison }`. `raison` vaut `null` quand tout va bien, sinon la phrase à afficher.
  - `window.app.chercherPepite(texte)` → `ligne[]` (celles de `chercher()`).

- [ ] **Step 1: Ajouter les imports**

Dans `desktop/main.js`, après la ligne `const { construire: construireTableauArchi } = require('../src/pda-archi/tableau');` (ligne 48) :

```js
const { creerPepites } = require('../src/pepites/pepites');
const { creerHistorique } = require('../src/pepites/historique');
const { chercher: chercherPepite } = require('../src/pepites/classement');
const { JEU: JEU_DES_TAUX } = require('../src/pepites/taux');
```

- [ ] **Step 2: Déclarer la variable de module**

À côté de `let pdaArchi = null;` (ligne 114) :

```js
let pepites = null;
```

- [ ] **Step 3: Créer le module au démarrage**

Juste avant `pdaArchi = creerPdaArchi({` (ligne 1225) :

```js
  // LE FICHIER VA DANS userData, a cote de favoris.json -- pas dans le depot:
  // c'est de l'etat d'utilisateur, il survit aux mises a jour de code.
  pepites = creerPepites({
    historique: creerHistorique({
      chemin: path.join(app.getPath('userData'), 'pepites.json'),
      // UN HISTORIQUE PERDU NE VAUT PAS UN BLOCAGE, mais il ne se perd pas en
      // silence: sans cette ligne, un fichier corrompu ferait disparaitre la
      // colonne de variation sans que rien ne le dise.
      onErreur: (e) => journal(0, `pepites : historique illisible — ${e.message}`),
    }),
    onPasse: ({ passe }) => {
      // `journal(0, ...)` ET PAS `journal(null, ...)`: zero est le pid de
      // convention pour ce qui ne vient d'aucun client, pose par la mise a
      // jour git (desktop/main.js:2252). `null` s'imprimerait tel quel entre
      // crochets.
      journal(0, `pepites : ${passe.lignes.length} lignes classees`
        // LE CHIFFRE QUI MANQUE A LA SPEC. Combien des 4 049 objets
        // recyclables ont un prix dans ivi n'a jamais pu etre mesure: le depot
        // n'a aucune capture d'ivi reelle. Cette ligne est la mesure.
        + `, sur ${pepites.etat().taille} prix connus`);
    },
  });
  pepites.demarrer();
```

- [ ] **Step 4: Brancher l'écoute sur les trames**

Dans le bloc `superviseur.onTrame = composer(` (ligne 1412), après `collectionArchi.onTrame,` (ligne 1546) :

```js
    // Sans porte, comme collectionArchi: elle ne fait que lire les prix
    // moyens que le serveur envoie de lui-meme au login. Rien n'est emis, donc
    // il n'y a rien a verrouiller par cle.
    pepites.onTrame,
```

- [ ] **Step 5: Ajouter les deux handlers IPC**

Dans `desktop/main.js`, après le handler `tableauArchi` (qui se termine ligne 1851) :

```js
// LE TABLEAU DES PEPITES. Meme forme que tableauArchi: le panneau demande, le
// principal croise, et rien n'est emis vers le jeu.
//
// LA PROVENANCE PART AVEC LES LIGNES, et ce n'est pas decoratif. Si aucun
// compte ne s'est reconnecte, la passe des douze heures rend le meme
// classement qu'avant -- un tableau sans date laisserait croire qu'il est
// frais.
ipcMain.handle('tableauPepites', () => {
  const etat = pepites === null ? null : pepites.etat();
  if (etat === null) {
    return {
      lignes: [], sorties: [], quand: null, prixQuand: null, perso: null,
      jeu: JEU_DES_TAUX,
      raison: 'connecte un personnage une fois pour que je voie les prix',
    };
  }
  const r = pepites.passer();
  const ligne = (dernieresLignes || []).find((l) => l.pid === etat.pid);
  return {
    lignes: r.variation.lignes,
    sorties: r.variation.sorties,
    quand: r.passe.quand,
    prixQuand: r.passe.prixQuand,
    // Le nom se resout ICI et pas dans le module: la correspondance pid -> nom
    // vit dans dernieresLignes, que src/pepites/ n'a pas a connaitre.
    perso: ligne ? (ligne.personnage || ligne.nickname) : null,
    jeu: JEU_DES_TAUX,
    raison: null,
  };
});

// LA RECHERCHE LIBRE. Elle passe par le principal plutot que de livrer les
// 4 049 taux au rendu: la table vit deja ici, et la recopier a chaque frappe
// serait absurde.
ipcMain.handle('chercherPepite', (_e, texte) => chercherPepite({
  texte: typeof texte === 'string' ? texte : '',
  prixMoyens: pepites === null ? null : pepites.prixMoyens(),
}));
```

- [ ] **Step 6: Ouvrir les deux canaux au rendu**

Dans `desktop/preload.js`, à côté de `tableauArchi` (ligne 39) :

```js
  tableauPepites: () => ipcRenderer.invoke('tableauPepites'),
  chercherPepite: (texte) => ipcRenderer.invoke('chercherPepite', texte),
```

- [ ] **Step 7: Vérifier que rien n'est cassé**

```bash
npm test
```

Attendu : aucun échec (le câblage Electron n'a pas de test unitaire dans ce dépôt, les tests existants doivent rester verts).

```bash
node -e "require('./src/pepites/pepites');require('./src/pepites/historique');require('./src/pepites/classement');console.log('les trois modules se chargent')"
```

Attendu : `les trois modules se chargent`.

- [ ] **Step 8: Commit**

```bash
git add desktop/main.js desktop/preload.js
git commit -m "feat(pepites): le cablage Electron, deux canaux et aucune emission"
```

---

### Task 7: Le panneau, et la recette sur le banc

**Files:**
- Modify: `desktop/index.html` (markup après `vueArchi` ligne 952, styles, et le script)
- Modify: `desktop/main.js` (nommage des lignes dans le handler de la tâche 6)
- Test: `test/pepites-panneau.test.js`

**Interfaces:**
- Consumes: `window.app.tableauPepites()` et `window.app.chercherPepite(texte)` de la tâche 6. `echapper` existe déjà dans le script (`desktop/index.html:1338`, `const echapper = (t) => ...`).
- Produces: rien pour les tâches suivantes — c'est la dernière.

> **Correction à appliquer d'abord :** le handler `tableauPepites` de la tâche 6 rend des lignes sans nom d'objet — le classement ne porte que des gids, et `nomDe` n'existe pas côté rendu. Importer `const { nomDe } = require('../src/hdv/objets');` en tête de `desktop/main.js` s'il n'y est pas déjà, et mapper les lignes : `lignes: r.variation.lignes.map((l) => ({ ...l, nom: nomDe(l.gid) }))`, idem pour `sorties`. Un gid sans nom rend `null`, et le panneau affiche le gid nu — comme le tableau des écartés.

> **LA REGLE DE NOMMAGE DES CLASSES, ET ELLE N'EST PAS NEGOCIABLE.** Le 2026-09-04, le tableau des archimonstres a nommé ses cellules `case`. `.case` existait déjà — le losange d'une ligne de compte, en `display: grid` — et les `<td>` en héritaient : les quatre coches d'un archimonstre s'empilaient verticalement dans la première colonne. Le balisage était juste, le code aussi, **et rien dans le projet ne pouvait le dire** : ni les tests, ni le navigateur. Seule une photo du panneau l'a montré.
>
> D'où `test/pda-archi-panneau.test.js`, et d'où la contrainte ici : **le panneau Pépites déclare ses classes dans une table unique `PEP`, toutes préfixées `pep-`, et il a son propre test qui le vérifie.** Ne réutiliser aucune classe `arc-` : elles appartiennent à l'autre panneau, et son test interdit qu'une règle étrangère en définisse.

- [ ] **Step 1: Écrire le test du panneau, qui échoue**

Créer `test/pepites-panneau.test.js` — le frère de `pda-archi-panneau.test.js`, et pour la même raison payée le 04/09 :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// LES CLASSES DU PANNEAU DES PEPITES NE DOIVENT ENTRER EN COLLISION AVEC
// AUCUNE AUTRE. Ce test est le frere de pda-archi-panneau.test.js, et il
// existe pour la meme raison: le 2026-09-04, une classe nommee `case` a
// heriter d'un `display: grid` pose ailleurs, et les coches d'un archimonstre
// se sont empilees verticalement. Le balisage etait juste, le code aussi, et
// rien dans le projet ne pouvait le dire -- ni les tests, ni le navigateur.
//
// Assertion sur le SOURCE: le chemin concerne demanderait un vrai navigateur.

const html = fs.readFileSync(
  path.join(__dirname, '..', 'desktop', 'index.html'), 'utf8',
);

const bloc = html.match(/const PEP = \{([\s\S]*?)\};/);
const classes = bloc === null
  ? []
  : [...bloc[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('le panneau declare ses classes en un seul endroit', () => {
  assert.notStrictEqual(bloc, null, 'la table PEP est introuvable dans index.html');
  assert.ok(classes.length >= 5, `seulement ${classes.length} classes trouvees`);
});

// LE PREFIXE EST LA GARDE.
test('toutes les classes du panneau sont prefixees pep-', () => {
  assert.deepStrictEqual(classes.filter((c) => !c.startsWith('pep-')), []);
});

// Un prefixe ne sert a rien si le reste de la feuille de style s'en sert
// aussi: la seconde moitie de la garde.
test('aucune regle hors du panneau ne definit une classe pep-', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const regles = [...style.matchAll(/\.(pep-[a-z0-9-]+)/g)].map((m) => m[1]);
  const inconnues = regles.filter(
    (c) => !classes.includes(c)
      && !['pep-corps', 'pep-pied', 'pep-cherche', 'pep-table'].includes(c),
  );
  assert.deepStrictEqual(inconnues, []);
});

// LE PANNEAU N'EMPRUNTE PAS LES CLASSES DE L'AUTRE. Elles appartiennent au
// tableau des archimonstres, dont le test interdit qu'une regle etrangere en
// definisse -- et une reprise silencieuse ferait dependre notre mise en page
// de la sienne.
test('le panneau des pepites n emprunte aucune classe arc-', () => {
  const debut = html.indexOf('<div class="pep-vue"');
  assert.notStrictEqual(debut, -1, 'le panneau des pepites est introuvable');
  const fin = html.indexOf('</div>', html.indexOf('id="pepPied"'));
  const markup = html.slice(debut, fin);
  assert.deepStrictEqual([...markup.matchAll(/class="(arc-[a-z0-9- ]+)"/g)].map((m) => m[1]), []);
});

// Les identifiants que le script va chercher par getElementById. Une faute de
// frappe ici rend un panneau muet, et c'est exactement le genre de panne que
// rien ne signale.
test('les identifiants attendus par le script existent dans le balisage', () => {
  for (const id of ['vuePepites', 'pepCorps', 'pepPied', 'pepChercheTexte', 'pepFermer']) {
    assert.ok(html.includes(`id="${id}"`), `id="${id}" manque`);
  }
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
node --test test/pepites-panneau.test.js
```

Attendu : ÉCHEC, `la table PEP est introuvable dans index.html`.

- [ ] **Step 3: Ajouter le markup du panneau**

Dans `desktop/index.html`, après la fermeture de `vueArchi` (ligne 952) :

```html
<!-- LE TABLEAU DES PEPITES. Meme forme que le tableau des archimonstres: un
     panneau dans la fenetre, ferme par Echap ou par la croix.
     MEME FORME, CLASSES DISTINCTES: voir test/pepites-panneau.test.js. -->
<div class="pep-vue" id="vuePepites" hidden>
  <div class="qdn-tete">
    <b>Pépites</b>
    <button id="pepFermer" title="Fermer (Échap)">✕</button>
  </div>
  <label class="pep-cherche">
    <input id="pepChercheTexte" type="search" placeholder="Chercher un objet…"
           autocomplete="off" spellcheck="false">
  </label>
  <div class="pep-corps" id="pepCorps"></div>
  <div class="pep-pied" id="pepPied"></div>
</div>
```

- [ ] **Step 4: Ajouter le script du panneau**

Dans le `<script>` de `desktop/index.html`, à côté de `ouvrirArchi` (ligne 1422) :

```js
  // LA TABLE DES CLASSES, DECLAREE EN UN SEUL ENDROIT -- c'est ce qui rend
  // test/pepites-panneau.test.js possible, et c'est la lecon du 04/09.
  const PEP = {
    vide: 'pep-vide',
    suspect: 'pep-suspect',
    entree: 'pep-entree',
    montee: 'pep-montee',
    stable: 'pep-stable',
    descente: 'pep-descente',
    sortie: 'pep-sortie',
    doute: 'pep-doute',
  };

  let pepTable = null;

  function fermerPepites() {
    document.getElementById('vuePepites').hidden = true;
  }

  // Un prix en kamas, groupe par milliers. Les couts par pepite montent vite:
  // 4 000 kamas l'unite sur du Bois de Frene, et six chiffres n'ont rien
  // d'exceptionnel.
  function kamas(n) {
    if (n === null || n === undefined) return '—';
    return Math.round(n).toLocaleString('fr-FR');
  }

  // Le taux s'ecrit a l'unite, mais il descend a 0,0025: trois decimales le
  // rendraient a zero. On montre plutot combien d'unites font une pepite,
  // qui est le chiffre qu'on emporte au prisme.
  function parPepite(taux) {
    if (!taux) return '—';
    if (taux >= 1) return taux.toLocaleString('fr-FR') + ' /u';
    return Math.ceil(1 / taux).toLocaleString('fr-FR') + ' u';
  }

  const PEP_ETATS = {
    entree: '<span class="' + PEP.entree + '" title="Entré dans le classement">▲ nouveau</span>',
    montee: '<span class="' + PEP.montee + '">▲</span>',
    stable: '<span class="' + PEP.stable + '">=</span>',
    descente: '<span class="' + PEP.descente + '">▼</span>',
    sortie: '<span class="' + PEP.sortie + '">sorti</span>',
  };

  function dessinerPepites() {
    const corps = document.getElementById('pepCorps');
    const pied = document.getElementById('pepPied');
    if (pepTable === null) { corps.innerHTML = ''; pied.textContent = ''; return; }
    if (pepTable.raison !== null) {
      corps.innerHTML = '<div class="' + PEP.vide + '">' + echapper(pepTable.raison) + '</div>';
      pied.textContent = '';
      return;
    }
    const lignes = pepTable.lignes.map((l, i) => '<tr'
      + (l.suspect ? ' class="' + PEP.suspect + '"' : '') + '>'
      + '<td>' + (i + 1) + '</td>'
      + '<td>' + echapper(l.nom === null ? String(l.gid) : l.nom) + '</td>'
      + '<td>' + parPepite(l.taux) + '</td>'
      + '<td>' + kamas(l.prixMoyen) + '</td>'
      + '<td><b>' + kamas(l.coutParPepite) + '</b></td>'
      + '<td>' + (PEP_ETATS[l.etat] || '') + '</td>'
      // LE DOUTE SE DIT SUR LA LIGNE, pas dans une legende: une legende ne se
      // lit qu'une fois, et le marqueur doit parler au moment ou on regarde.
      + '<td>' + (l.suspect ? '<span title="Prix moyen très bas : l’objet est'
        + ' peut-être introuvable en hôtel de vente" class="' + PEP.doute + '">prix douteux</span>' : '') + '</td>'
      + '</tr>').join('');
    corps.innerHTML = '<table class="pep-table"><thead><tr>'
      + '<th>#</th><th>Objet</th><th>Pour 1 pépite</th><th>Prix moyen</th>'
      + '<th>Coût / pépite</th><th></th><th></th>'
      + '</tr></thead><tbody>' + lignes + '</tbody></table>';
    const quand = new Date(pepTable.prixQuand);
    pied.textContent = 'Prix du ' + quand.toLocaleDateString('fr-FR')
      + ' à ' + quand.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      + (pepTable.perso ? ', vus par ' + pepTable.perso : '')
      + ' — taux du jeu ' + pepTable.jeu
      + (pepTable.sorties.length ? ' — ' + pepTable.sorties.length + ' objet(s) sorti(s)' : '');
  }

  async function ouvrirPepites() {
    // LE PANNEAU S'OUVRE MEME EN ECHEC, ET DIT POURQUOI -- meme filet que
    // ouvrirArchi, et pour la meme raison payee le 04/09: sans lui, une
    // exception laisse simplement le panneau ferme, et l'utilisateur voit un
    // bouton qui « ne fait rien ».
    try {
      pepTable = await window.app.tableauPepites();
      dessinerPepites();
    } catch (e) {
      pepTable = null;
      document.getElementById('pepCorps').innerHTML = '<div class="' + PEP.vide + '">'
        + 'Le tableau n’a pas pu être construit : '
        + echapper(e && e.message ? e.message : String(e)) + '</div>';
      document.getElementById('pepPied').textContent = '';
    }
    document.getElementById('vuePepites').hidden = false;
  }

  document.getElementById('pepFermer').addEventListener('click', fermerPepites);

  // La recherche remplace le classement tant qu'elle porte du texte, et le
  // rend des qu'on efface: deux listes cote a cote se disputeraient l'ecran.
  let pepFrappe = null;
  document.getElementById('pepChercheTexte').addEventListener('input', (ev) => {
    const texte = ev.target.value;
    if (pepFrappe !== null) clearTimeout(pepFrappe);
    // UN APPEL PAR FRAPPE PARCOURRAIT 4 049 NOMS A CHAQUE LETTRE. Le delai est
    // court: il ne fait qu'attendre la fin du mot.
    pepFrappe = setTimeout(async () => {
      if (texte.trim().length < 2) { dessinerPepites(); return; }
      const r = await window.app.chercherPepite(texte);
      const corps = document.getElementById('pepCorps');
      if (r.length === 0) {
        corps.innerHTML = '<div class="' + PEP.vide + '">Aucun objet recyclable de ce nom.</div>';
        return;
      }
      corps.innerHTML = '<table class="pep-table"><thead><tr>'
        + '<th>Objet</th><th>Pour 1 pépite</th><th>Prix moyen</th><th>Coût / pépite</th>'
        + '</tr></thead><tbody>'
        + r.map((l) => '<tr' + (l.suspect ? ' class="' + PEP.suspect + '"' : '') + '>'
          + '<td>' + echapper(l.nom) + '</td>'
          + '<td>' + parPepite(l.taux) + '</td>'
          // PRIX INCONNU N'EST PAS PRIX ZERO. C'est la reponse que la spec
          // demande: un objet recyclable dont personne ne connait le prix se
          // dit, il ne se cache pas.
          + '<td>' + (l.prixMoyen === null ? 'prix inconnu' : kamas(l.prixMoyen)) + '</td>'
          + '<td><b>' + kamas(l.coutParPepite) + '</b></td>'
          + '</tr>').join('')
        + '</tbody></table>';
    }, 150);
  });
```

- [ ] **Step 5: Brancher la fermeture par Échap et le bouton d'ouverture**

Chercher le gestionnaire de `Escape` qui appelle `fermerArchi()` et y ajouter `fermerPepites();`.

Ajouter le bouton d'ouverture dans la barre du bas, à côté de celui qui ouvre les archimonstres — repérer l'élément qui appelle `ouvrirArchi(` (ligne 2399) et poser le bouton Pépites sur le même modèle, appelant `ouvrirPepites()`.

- [ ] **Step 6: Ajouter les styles**

Dans la feuille de style de `desktop/index.html`, à côté des règles `.arc-` :

Les règles ne sont pas partagées avec le panneau voisin, elles sont recopiées : c'est le prix du préfixe, et il est assumé — une règle partagée ferait dépendre la mise en page de ce panneau des retouches faites à l'autre.

**Geometrie du panneau — a lire dans la feuille de style, pas dans ce plan.** Ouvrir le `<style>` de `desktop/index.html`, y lire les quatre regles `.vue-archi`, `.arc-corps`, `.arc-pied` et `.arc-cherche`, et ecrire quatre regles nouvelles `.pep-vue`, `.pep-corps`, `.pep-pied` et `.pep-cherche` portant les memes declarations. Les valeurs ne figurent pas ici volontairement : les recopier dans le plan les figerait a ce qu'elles valaient le 11/09, alors que la feuille de style est la seule source qui reste juste.

Puis ajouter, telles quelles, les regles propres au tableau :

```css
.pep-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.pep-table th { text-align: left; opacity: .6; font-weight: 500; padding: 4px 8px; }
.pep-table td { padding: 3px 8px; border-top: 1px solid rgba(255,255,255,.06); }
.pep-vide { padding: 12px; opacity: .7; }
/* LE DOUTE SE VOIT SANS SE CRIER: la ligne reste a sa place et reste lisible.
   La griser franchement reviendrait a l'ecarter a moitie, ce que la spec
   refuse -- un marqueur, jamais un filtre. */
.pep-suspect { opacity: .72; }
.pep-doute { color: #d9a441; }
.pep-entree { color: #6fcf82; }
.pep-montee { color: #6fcf82; }
.pep-descente { color: #e0796f; }
.pep-stable { opacity: .35; }
.pep-sortie { opacity: .5; }
```

- [ ] **Step 7: Vérifier que la suite passe toujours**

```bash
npm test
```

Attendu : aucun échec.

- [ ] **Step 8: La recette sur le banc d'essai**

C'est la condition de fin posée par la spec, et elle ne se remplace par rien.

```powershell
$env:OMNI_DEV = 'C:\Users\Utilisateur\mm'
.\desktop\dist\OMNI-win32-x64\OMNI.exe
```

Puis lancer le banc d'essai localhost (`docs/superpowers/plans/2026-09-10-interface-locale.md`), ouvrir l'onglet, cliquer le bouton **Pépites**, et vérifier de ses yeux :

1. sans aucun client connecté, le panneau s'ouvre et affiche *« connecte un personnage une fois pour que je voie les prix »* — il ne reste pas fermé et ne montre pas un tableau vide ;
2. avec le faux état du banc, le tableau porte ses lignes, le pied affiche la date des prix et la version des taux ;
3. la barre de recherche répond sur « frene » sans accent ;
4. Échap ferme le panneau.

**Montrer l'écran.** Pas un diff, pas un compte rendu.

- [ ] **Step 9: Commit**

```bash
git add desktop/index.html desktop/main.js test/pepites-panneau.test.js
git commit -m "feat(pepites): le panneau, sa recherche et sa colonne de variation"
```

---

## Auto-relecture du plan

**Couverture de la spec.** Chaque section de `2026-09-11-opti-pepite-design.md` a sa tâche : la table et sa provenance → tâche 1 ; la règle et ses trois crans de tri, le seuil de doute, le gid sans prix → tâche 2 ; la variation et la recherche libre → tâche 3 ; l'historique plafonné à 30 → tâche 4 ; l'écoute d'`ivi`, la minuterie indépendante, l'absence d'émission → tâche 5 ; le câblage et la résolution du nom du personnage → tâche 6 ; le panneau, la provenance affichée, la recette sur le banc → tâche 7.

**Trois manques trouvés et corrigés à la relecture :**

1. Le handler `tableauPepites` de la tâche 6 rendait des lignes **sans nom d'objet** — le classement ne porte que des gids, et `nomDe` n'existe pas côté rendu. La correction est posée en tête de la tâche 7.
2. `chercher()` avait besoin de `TAUX` et de `nomDe`, alors que la tâche 2 n'importait que `tauxDe`. La ligne de `require` est explicitement remplacée à l'étape 3 de la tâche 3.
3. **La première version du panneau réutilisait les classes `arc-`** du tableau des archimonstres. C'était l'erreur exacte que `test/pda-archi-panneau.test.js` existe pour empêcher, née de la collision `.case` du 04/09. La tâche 7 déclare désormais une table `PEP` préfixée et commence par son propre test de panneau.

**Une vérification faite, et qui a évité une fausse piste :** le plan appelle `echapper()` dans le rendu. La fonction existe bien (`desktop/index.html:1338`), mais déclarée en `const echapper = (t) =>` — une recherche de `function echapper` ne la trouve pas et aurait fait conclure qu'il fallait l'écrire.

**Le chiffre que la spec laissait ouvert** — combien des 4 049 objets recyclables ont un prix dans `ivi` — est mesuré par la ligne de journal de la tâche 6, étape 3.
