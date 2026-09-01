# Mise en vente en hôtel de vente — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un bouton par ligne de compte qui parcourt le stock du personnage et pose des lots en hôtel de vente, du lot le plus cher au moins cher, jusqu'à ce que le serveur refuse.

**Architecture :** deux modules purs neufs (`stock.js`, plus `deciderPose` dans `prix.js`), quatre lecteurs de trames ajoutés à `trames.js`, et un séquenceur `vente.js` composé dans `composer()` comme `reprix.js`. Le séquenceur écoute en permanence pour mémoriser `ivx` — la liste des piles, que le client émet de lui-même à l'ouverture du panneau de vente — puis déroule une passe au clic.

**Tech Stack :** Node.js, `node:test` + `node:assert`, Electron pour le câblage IHM. Aucune dépendance nouvelle.

**Spec :** `docs/superpowers/specs/2026-09-01-mise-en-vente-design.md`
**Mesure :** `docs/superpowers/specs/2026-09-01-trames-mise-en-vente.md`

## Global Constraints

- **Français sans accents dans le code et les messages de commit** ; accents autorisés dans les chaînes affichées à l'utilisateur et dans les docs.
- **Aucune dépendance npm nouvelle.**
- **`decider()` dans `prix.js` ne change pas de comportement.** Ses tests existants doivent passer à l'identique après le partage d'helpers.
- **`reprix.js` n'est pas modifié.**
- **Modules purs** (`prix.js`, `stock.js`, `trames.js`) : ni Electron, ni Frida, ni réseau, ni disque.
- **Tests** : `npm test` à la racine. La ligne de base saine est **772 tests, 766 passent, 6 échecs tous dans `serveur-maj/`** (absence de `node_modules`, sans rapport avec le code applicatif). Le contrôle qui compte est `npm test 2>&1 | grep -E "^not ok" | grep -v serveur-maj | wc -l` → doit valoir **0**.
- **Avant chaque commit** : vérifier que rien de personnel n'entre dans l'index — identifiants de personnage ou de compte, noms de guilde, pseudos d'autres joueurs, et tout chemin absolu contenant le nom d'utilisateur Windows.
- **Tailles de lot** : `[1, 10, 100, 1000]`, exportées par `trames.js` sous `TAILLES`.

---

### Task 1 : `deciderPose`, la règle de prix pour un lot neuf

**Files:**
- Modify: `src/hdv/prix.js`
- Test: `test/hdv-prix.test.js`

**Interfaces:**
- Consumes: `TAILLES` (déjà dans `prix.js`)
- Produces: `deciderPose({ marche, nos, taille, moyenUnitaire }) -> number | null`, exporté par `src/hdv/prix.js`. `marche` est un tableau de 4 entiers dans l'ordre `[1, 10, 100, 1000]`, `nos` un tableau de `{ taille, prix }`, `taille` un entier de `TAILLES`, `moyenUnitaire` le prix moyen à l'unité (0 si inconnu).

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter à la fin de `test/hdv-prix.test.js` :

```js
// --- deciderPose : poser un lot NEUF ------------------------------------
//
// La regle de la mise en vente. Elle partage l'extrapolation avec decider()
// et differe sur deux points, mesures et tranches en conception:
// docs/superpowers/specs/2026-09-01-mise-en-vente-design.md.
const { deciderPose } = require('../src/hdv/prix');

test('deciderPose sous-cote un concurrent d un kama, comme decider', () => {
  assert.strictEqual(
    deciderPose({ marche: [19, 190, 1222, 18000], nos: [], taille: 100, moyenUnitaire: 12 }),
    1221,
  );
});

// LA DIFFERENCE QUI FAIT EXISTER LA FONCTION. decider() rend null ici pour ne
// pas se sous-coter soi-meme. deciderPose s'ALIGNE: sans cela, des qu'on a
// pose le premier lot d'un paquet le minimum est le notre, et tous les lots
// suivants seraient sautes en silence.
test('deciderPose s aligne quand le minimum est deja le notre', () => {
  const marche = [19, 190, 1222, 18000];
  const nos = [{ taille: 100, prix: 1222 }];
  assert.strictEqual(decider({ marche, nos, taille: 100, moyenUnitaire: 12 }), null);
  assert.strictEqual(deciderPose({ marche, nos, taille: 100, moyenUnitaire: 12 }), 1222);
});

// L'ORDRE DES CAS. Chez decider les deux tests rendent null, leur ordre est
// indifferent. Ici le test « est-ce le notre » rend un PRIX: le placer avant
// le garde-fou du minimum a 1 ferait poser a 1 kama.
test('deciderPose refuse un minimum a 1 meme quand ce lot est le notre', () => {
  assert.strictEqual(
    deciderPose({ marche: [1, 0, 0, 0], nos: [{ taille: 1, prix: 1 }], taille: 1, moyenUnitaire: 12 }),
    null,
  );
});

test('deciderPose extrapole du creneau voisin quand le sien est vide', () => {
  assert.strictEqual(
    deciderPose({ marche: [12, 122, 0, 0], nos: [], taille: 100, moyenUnitaire: 12 }),
    1220,
  );
});

test('deciderPose refuse une extrapolation hors du garde-fou', () => {
  assert.strictEqual(
    deciderPose({ marche: [100, 0, 0, 0], nos: [], taille: 10, moyenUnitaire: 1 }),
    null,
  );
});

// AUCUN CRENEAU SERVI: il n'y a rien a extrapoler, et decider() renonce. Poser
// au prix moyen vaut mieux que ne rien poser — c'est le seul endroit ou une
// pile sans marche du tout peut quand meme partir.
test('deciderPose pose au prix moyen quand aucun creneau n est servi', () => {
  const marche = [0, 0, 0, 0];
  assert.strictEqual(decider({ marche, nos: [], taille: 10, moyenUnitaire: 32 }), null);
  assert.strictEqual(deciderPose({ marche, nos: [], taille: 10, moyenUnitaire: 32 }), 320);
});

test('deciderPose renonce si le prix moyen est inconnu et le marche vide', () => {
  assert.strictEqual(
    deciderPose({ marche: [0, 0, 0, 0], nos: [], taille: 10, moyenUnitaire: 0 }),
    null,
  );
});

test('deciderPose refuse une taille qui n est pas un creneau', () => {
  assert.strictEqual(
    deciderPose({ marche: [19, 190, 1222, 18000], nos: [], taille: 50, moyenUnitaire: 12 }),
    null,
  );
});
```

- [ ] **Step 2 : lancer les tests et vérifier qu'ils échouent**

Run: `node --test test/hdv-prix.test.js`
Expected: FAIL — `deciderPose is not a function`.

- [ ] **Step 3 : extraire les helpers partagés dans `src/hdv/prix.js`**

Insérer juste après la déclaration de `const TAILLES = [1, 10, 100, 1000];` :

```js
// LE CRENEAU NON VIDE LE PLUS PROCHE, en CRANS de TAILLES et non en ecart de
// quantite: les voisins immediats se ressemblent (19, 19, 27 et 18 kamas
// l'unite sur la Pierre medicinale) bien plus que les extremes. A distance
// egale on prend le plus petit, parce qu'un creneau de petite taille se vend
// plus souvent et que son prix unitaire est donc mieux etabli.
//
// Rend -1 quand aucun creneau n'est servi. Les deux regles s'en servent, mais
// elles en tirent des conclusions differentes: decider() renonce, deciderPose
// retombe sur le prix moyen.
function voisinServi(marche, i) {
  for (let d = 1; d < TAILLES.length; d += 1) {
    if (i - d >= 0 && Number(marche[i - d]) > 0) return i - d;
    if (i + d < TAILLES.length && Number(marche[i + d]) > 0) return i + d;
  }
  return -1;
}

// LE GARDE-FOU, DANS LES DEUX SENS. Une extrapolation reste une supposition:
// au-dessus du double du prix moyen le lot ne part pas, en dessous de la
// moitie on brule la marchandise. Sans prix moyen il n'y a pas de filet, donc
// on refuse plutot que de deduire a l'aveugle.
function extrapoler({ marche, voisin, taille, moyenUnitaire }) {
  const unitaire = Number(marche[voisin]) / TAILLES[voisin];
  const deduit = Math.max(1, Math.floor(unitaire * taille));
  const moyen = (Number(moyenUnitaire) || 0) * taille;
  if (moyen <= 0) return null;
  if (deduit < moyen / 2 || deduit > moyen * 2) return null;
  return deduit;
}
```

- [ ] **Step 4 : faire passer `decider` par les helpers, sans changer son comportement**

Dans `src/hdv/prix.js`, remplacer tout le bloc qui va de `  // CRENEAU VIDE. On deduit du creneau non vide le plus proche…` jusqu'au `  return deduit;` final de `decider` par :

```js
  // CRENEAU VIDE. Rien a sous-coter: on deduit du voisin, ou on renonce. Le
  // detail des deux regles est remonte dans voisinServi() et extrapoler(),
  // partages avec deciderPose().
  const voisin = voisinServi(marche, i);
  if (voisin === -1) return null;
  return extrapoler({ marche, voisin, taille, moyenUnitaire });
```

- [ ] **Step 5 : vérifier que `decider` n'a pas bougé**

Run: `node --test test/hdv-prix.test.js`
Expected: les tests existants de `decider` PASSENT tous ; ceux de `deciderPose` échouent encore.

- [ ] **Step 6 : écrire `deciderPose`**

Ajouter dans `src/hdv/prix.js`, juste avant `module.exports` :

```js
// POSER UN LOT NEUF, la regle de « mettre en vente ».
//
// Memes entrees que decider(), et elle partage son extrapolation. Deux
// differences, et chacune vient d'un raisonnement mesure:
//
// 1. QUAND LE MINIMUM EST DEJA LE NOTRE, ON S'ALIGNE au lieu de renoncer. Des
//    qu'on a pose le premier lot d'un paquet, le minimum du creneau est le
//    notre: renoncer ferait sauter tous les lots suivants, et la fonction
//    poserait un seul lot par objet et par taille, sans rien dire. S'aligner
//    n'erode rien — sous-coter d'un kama a chaque lot serait exactement
//    l'auto-sous-cotation que decider() interdit, bornee par la pile plutot
//    qu'infinie, ce qui n'est pas la meme chose que gratuite.
//
// 2. SANS AUCUN CRENEAU SERVI, ON POSE AU PRIX MOYEN. Il n'y a rien a
//    extrapoler, et decider() renonce parce qu'un lot deja en vente peut
//    attendre. Un lot qu'on n'a pas encore pose, lui, ne rapporte rien.
//
// L'ORDRE DES CAS COMPTE ICI, alors qu'il est indifferent chez decider(): le
// garde-fou « minimum a 1 » passe AVANT le test « est-ce le notre », sans quoi
// notre propre lot a 1 kama nous ferait poser a 1 kama.
function deciderPose({ marche, nos, taille, moyenUnitaire }) {
  if (!Array.isArray(marche) || marche.length !== TAILLES.length) return null;
  const i = TAILLES.indexOf(taille);
  if (i === -1) return null;

  const minimum = Number(marche[i]) || 0;

  if (minimum > 0) {
    // Un minimum a 1 ne se sous-cote pas: 0 est aussi la valeur qui signifie
    // « creneau vide » dans kgp, donc un lot pose a 0 disparaitrait du tableau.
    if (minimum <= 1) return null;
    const nous = (nos || []).some((l) => l.taille === taille && Number(l.prix) === minimum);
    if (nous) return minimum;
    return minimum - 1;
  }

  const voisin = voisinServi(marche, i);
  if (voisin !== -1) return extrapoler({ marche, voisin, taille, moyenUnitaire });

  const moyen = Math.floor((Number(moyenUnitaire) || 0) * taille);
  return moyen > 0 ? moyen : null;
}
```

Et remplacer la dernière ligne du fichier par :

```js
module.exports = { decider, deciderPose, TAILLES };
```

- [ ] **Step 7 : lancer les tests**

Run: `node --test test/hdv-prix.test.js`
Expected: PASS, tous.

- [ ] **Step 8 : commit**

```bash
git add src/hdv/prix.js test/hdv-prix.test.js
git commit -m "feat(hdv): deciderPose, la regle de prix d un lot neuf"
```

---

### Task 2 : `stock.js`, du stock aux lots candidats

**Files:**
- Create: `src/hdv/stock.js`
- Test: `test/hdv-stock.test.js`

**Interfaces:**
- Consumes: `TAILLES` de `src/hdv/trames.js`.
- Produces, exportés par `src/hdv/stock.js` :
  - `decouper(quantite) -> number[]` — les tailles de lot, de la plus grande à la plus petite.
  - `candidats({ piles, prixMoyens }) -> [{ uidPile, gid, taille, valeur }]` — trié par `valeur` décroissante. `piles` est un tableau de `{ uid, gid, qte, avecEffets }` (ce que rend `lireStock`, Task 3), `prixMoyens` une `Map(gid -> prix moyen unitaire)`.
  - `paquets(lots) -> [{ gid, taille, lots }]` — les lots consécutifs de même GID **et** même taille.

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `test/hdv-stock.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFrameRaw } = require('../src/codec/rawProto');
const { lireStock } = require('../src/hdv/trames');
const { decouper, candidats, paquets } = require('../src/hdv/stock');

const fixture = (nom) => decodeFrameRaw(
  Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures', nom), 'utf8').trim(), 'hex'),
);

// --- Le decoupage --------------------------------------------------------
//
// Du plus gros lot au plus petit. Les chiffres viennent du stock mesure le
// 01/09: la pile de Pierre medicinale en portait 286, la plus grosse 1660.

test('decouper prend les plus gros lots d abord', () => {
  assert.deepStrictEqual(
    decouper(286),
    [100, 100, 10, 10, 10, 10, 10, 10, 10, 10, 1, 1, 1, 1, 1, 1],
  );
});

test('decouper sur la plus grosse pile mesuree', () => {
  assert.deepStrictEqual(
    decouper(1660),
    [1000, 100, 100, 100, 100, 100, 100, 10, 10, 10, 10, 10, 10],
  );
});

test('decouper rend des lots de 1 sous le premier palier', () => {
  assert.deepStrictEqual(decouper(9), [1, 1, 1, 1, 1, 1, 1, 1, 1]);
});

test('decouper ne rend rien sur une pile vide', () => {
  assert.deepStrictEqual(decouper(0), []);
});

// --- Les candidats -------------------------------------------------------

test('candidats ecarte les piles a lignes de caracteristiques', () => {
  const piles = [
    { uid: 1, gid: 13731, qte: 100, avecEffets: false },
    { uid: 2, gid: 14162, qte: 1, avecEffets: true },
  ];
  const lots = candidats({ piles, prixMoyens: new Map([[13731, 32], [14162, 5000]]) });
  assert.strictEqual(lots.length, 1);
  assert.strictEqual(lots[0].gid, 13731);
});

test('candidats trie par valeur de lot decroissante', () => {
  const piles = [
    { uid: 1, gid: 100, qte: 10, avecEffets: false },
    { uid: 2, gid: 200, qte: 10, avecEffets: false },
  ];
  const lots = candidats({ piles, prixMoyens: new Map([[100, 5], [200, 900]]) });
  assert.deepStrictEqual(lots.map((l) => l.gid), [200, 100]);
  assert.deepStrictEqual(lots.map((l) => l.valeur), [9000, 50]);
});

test('candidats porte l uid de la pile d origine sur chaque lot', () => {
  const piles = [{ uid: 84496683, gid: 8437, qte: 200, avecEffets: false }];
  const lots = candidats({ piles, prixMoyens: new Map([[8437, 39]]) });
  assert.strictEqual(lots.length, 2);
  for (const l of lots) {
    assert.strictEqual(l.uidPile, 84496683);
    assert.strictEqual(l.taille, 100);
  }
});

test('candidats accepte un gid absent de la table des prix moyens', () => {
  const lots = candidats({ piles: [{ uid: 1, gid: 999, qte: 5, avecEffets: false }], prixMoyens: new Map() });
  assert.strictEqual(lots.length, 5);
  assert.strictEqual(lots[0].valeur, 0);
});

// --- Sur les trames reellement mesurees ----------------------------------
//
// L'inventaire du compte de mesure: 219 piles, dont 204 portent des lignes
// d'effets — 179 d'entre elles a quantite 1, donc majoritairement de
// l'equipement.
test('candidats ne retient que les 15 piles fongibles de l inventaire mesure', () => {
  const piles = lireStock(fixture('hdv-ivx-inventaire.hex'));
  assert.strictEqual(piles.length, 219);
  assert.strictEqual(piles.filter((p) => !p.avecEffets).length, 15);
  const lots = candidats({ piles, prixMoyens: new Map() });
  assert.strictEqual(new Set(lots.map((l) => l.uidPile)).size, 15);
});

// La banque mesuree, elle, porte 57 piles a effets sur 814 — et 52 d'entre
// elles ont une quantite superieure a 1. Ce ne sont donc pas des equipements.
test('candidats retient les 757 piles fongibles de la banque mesuree', () => {
  const piles = lireStock(fixture('hdv-iwb.hex'));
  assert.strictEqual(piles.length, 814);
  // 57 piles de banque portent des effets — des consommables ou des runes,
  // empilables (jusqu'a 1349 exemplaires), PAS des equipements.
  assert.strictEqual(piles.filter((p) => p.avecEffets).length, 57);
  const lots = candidats({ piles, prixMoyens: new Map() });
  assert.strictEqual(new Set(lots.map((l) => l.uidPile)).size, 757);
});

// --- Les paquets ---------------------------------------------------------

test('paquets regroupe les lots consecutifs de meme gid et meme taille', () => {
  const lots = [
    { gid: 1, taille: 100, valeur: 900 },
    { gid: 1, taille: 100, valeur: 900 },
    { gid: 2, taille: 100, valeur: 500 },
    { gid: 1, taille: 10, valeur: 90 },
  ];
  const p = paquets(lots);
  assert.deepStrictEqual(p.map((x) => [x.gid, x.taille, x.lots.length]), [
    [1, 100, 2], [2, 100, 1], [1, 10, 1],
  ]);
});

test('paquets ne fusionne pas deux tailles du meme objet', () => {
  const p = paquets([{ gid: 1, taille: 100 }, { gid: 1, taille: 10 }]);
  assert.strictEqual(p.length, 2);
});

// --- Le tri est DETERMINISTE, et paquets en depend -----------------------
//
// Les departages apres la valeur ne sont pas cosmetiques: c'est eux qui
// garantissent que deux lots de meme gid ET meme taille se retrouvent cote a
// cote, sans quoi paquets() — qui ne regarde que le voisin precedent —
// fragmenterait un groupe en plusieurs visites d'objet.
//
// Sans ces deux tests, retirer un departage laisserait toute la suite verte.

test('a valeur egale, le tri departage par taille decroissante puis gid croissant', () => {
  const piles = [
    { uid: 1, gid: 100, qte: 100, avecEffets: false },
    { uid: 2, gid: 200, qte: 10, avecEffets: false },
    { uid: 3, gid: 50, qte: 10, avecEffets: false },
  ];
  // Trois lots de valeur 1000: 10x100, 100x10 et 100x10.
  const lots = candidats({ piles, prixMoyens: new Map([[100, 10], [200, 100], [50, 100]]) });
  assert.deepStrictEqual(lots.map((l) => l.valeur), [1000, 1000, 1000]);
  assert.deepStrictEqual(lots.map((l) => [l.gid, l.taille]), [[100, 100], [50, 10], [200, 10]]);
});

test('deux piles du meme objet a valeur egale tombent dans UN SEUL paquet', () => {
  const piles = [
    { uid: 1, gid: 100, qte: 100, avecEffets: false },
    { uid: 2, gid: 200, qte: 100, avecEffets: false },
    { uid: 3, gid: 100, qte: 100, avecEffets: false },
  ];
  const lots = candidats({ piles, prixMoyens: new Map([[100, 10], [200, 10]]) });
  const p = paquets(lots);
  assert.deepStrictEqual(p.map((x) => [x.gid, x.taille, x.lots.length]), [
    [100, 100, 2], [200, 100, 1],
  ]);
  // Les deux lots du gid 100 viennent de piles differentes: le paquet les
  // groupe quand meme, et chacun garde son uid d'origine.
  assert.deepStrictEqual(p[0].lots.map((l) => l.uidPile).sort(), [1, 3]);
});
```

- [ ] **Step 2 : lancer les tests et vérifier qu'ils échouent**

Run: `node --test test/hdv-stock.test.js`
Expected: FAIL — `Cannot find module '../src/hdv/stock'`.

- [ ] **Step 3 : écrire `src/hdv/stock.js`**

```js
'use strict';
const { TAILLES } = require('./trames');

// Du stock aux lots candidats: ce qu'on va poser, et dans quel ordre.
//
// Conception: docs/superpowers/specs/2026-09-01-mise-en-vente-design.md.
// Fonction pure: ni trame, ni reseau, ni disque.

// Du plus gros au plus petit. TAILLES est croissant chez trames.js parce que
// c'est l'ordre des quatre prix de kgp; ici c'est l'ordre de decoupage.
const DECROISSANT = [...TAILLES].sort((a, b) => b - a);

// 286 -> 100, 100, puis 10 huit fois, puis 1 six fois.
function decouper(quantite) {
  const lots = [];
  let reste = Number(quantite) || 0;
  if (!Number.isFinite(reste) || reste <= 0) return lots;
  for (const taille of DECROISSANT) {
    const n = Math.floor(reste / taille);
    for (let i = 0; i < n; i += 1) lots.push(taille);
    reste -= n * taille;
  }
  return lots;
}

// LES LIGNES D'EFFETS SEPARENT LA RESSOURCE DE TOUT LE RESTE, et c'est ce qui
// evite d'avoir a demander une categorie par GID. La categorie
// n'arrive que dans kbt.1, un objet a la fois: interroger un millier d'objets
// pour savoir lesquels sont vendables serait exactement le flot que le rythme
// cherche a eviter.
//
// LE CHAMP 2 DIT « CET OBJET PORTE DES EFFETS », PAS « C'EST UN EQUIPEMENT ».
// Mesure du 01/09: 204 des 219 piles d'inventaire en portent, dont 179 a
// quantite 1 — de l'equipement. Mais 57 des 814 piles de banque en portent
// aussi, dont 52 a quantite superieure a 1, jusqu'a 1349: des consommables ou
// des runes. Une RESSOURCE, elle, n'a pas d'effets — c'est ce qui rend le champ
// utilisable pour trier ce que l'hotel de vente ressources accepte.
//
// LE TRI EST LE COEUR DE LA FONCTION. La passe n'ira jamais au bout — le
// plafond de l'hotel de vente l'arretera apres quelques centaines de lots —
// donc l'ordre ne decide pas de la sequence, il decide de CE QUI SERA VENDU.
// A nombre d'emplacements egal, l'ordre par valeur pose 2,2 a 2,8 fois plus de
// valeur que le groupage par objet.
//
// Les departages apres la valeur ne servent qu'a rendre le tri deterministe,
// donc testable.
function candidats({ piles, prixMoyens }) {
  const table = prixMoyens instanceof Map ? prixMoyens : new Map();
  const lots = [];
  for (const pile of piles || []) {
    if (pile === null || pile === undefined || pile.avecEffets) continue;
    const moyen = Number(table.get(pile.gid)) || 0;
    for (const taille of decouper(pile.qte)) {
      lots.push({ uidPile: pile.uid, gid: pile.gid, taille, valeur: moyen * taille });
    }
  }
  lots.sort((a, b) => (b.valeur - a.valeur) || (b.taille - a.taille) || (a.gid - b.gid));
  return lots;
}

// UN PAQUET EST UNE VISITE D'OBJET. Deux lots de meme GID et de meme taille
// ont la meme valeur, donc le tri les place cote a cote: le paquet tombe tout
// seul. Sur le stock de mesure, 6495 lots forment 1530 paquets, de taille
// mediane 4 — exactement le geste « Entree, Entree, Entree, Entree ».
function paquets(lots) {
  const out = [];
  for (const lot of lots || []) {
    const dernier = out[out.length - 1];
    if (dernier !== undefined && dernier.gid === lot.gid && dernier.taille === lot.taille) {
      dernier.lots.push(lot);
    } else {
      out.push({ gid: lot.gid, taille: lot.taille, lots: [lot] });
    }
  }
  return out;
}

module.exports = { decouper, candidats, paquets };
```

- [ ] **Step 4 : lancer les tests**

Run: `node --test test/hdv-stock.test.js`
Expected: les tests de `decouper`, `candidats` (piles inventées) et `paquets` PASSENT ; les deux tests sur fixtures ÉCHOUENT (`lireStock is not a function`) — ils sont satisfaits par la Task 3.

- [ ] **Step 5 : commit**

```bash
git add src/hdv/stock.js test/hdv-stock.test.js
git commit -m "feat(hdv): stock.js, du stock aux lots candidats tries par valeur"
```

---

### Task 3 : les trames de la mise en vente

**Files:**
- Modify: `src/hdv/trames.js`
- Test: `test/hdv-trames.test.js`

**Interfaces:**
- Consumes: `requete`, `v`, `champ`, `entier` (déjà internes à `trames.js`).
- Produces, ajoutés aux exports de `src/hdv/trames.js` :
  - `trameMettreEnVente({ prix, uidPile, taille }) -> Buffer`
  - `lireStock(frame) -> [{ uid, gid, qte, avecEffets }]` — accepte `ivx` et `iwb`, rend `[]` pour tout autre type.
  - `lirePileMaj(frame) -> { uid, qte } | null` — lit `ivj`.
  - `lirePileDisparue(frame) -> number | null` — lit `ium`.

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter à `test/hdv-trames.test.js`. Les imports en tête du fichier deviennent :

```js
const {
  trameMajPrix, trameAbonner, trameDesabonner, trameStats,
  lirePrixMarche, lireStatsPrix, lireNosLots, lireLotPose, lireLotRetire, lirePrixMoyens,
  trameMettreEnVente, lireStock, lirePileMaj, lirePileDisparue,
} = require('../src/hdv/trames');
```

Puis, à la fin du fichier :

```js
// --- La mise en vente ----------------------------------------------------
//
// Les deux kge du journal du 01/09: une pile d'INVENTAIRE et une pile de
// BANQUE. Les deux ont abouti, ce qui prouve que kge accepte les deux
// origines sans retrait prealable.

test('kge reproduit les octets de la vente depuis l inventaire', () => {
  assert.strictEqual(
    trameMettreEnVente({ prix: 2699, uidPile: 84571671, taille: 100 }).toString('hex'),
    '122e0a210a13747970652e616e6b616d612e636f6d2f6b6765120a088b151097eca928186410ffffffffffffffffff01',
  );
});

test('kge reproduit les octets de la vente depuis la banque', () => {
  assert.strictEqual(
    trameMettreEnVente({ prix: 29, uidPile: 84496683, taille: 1 }).toString('hex'),
    '122d0a200a13747970652e616e6b616d612e636f6d2f6b67651209081d10aba2a528180110ffffffffffffffffff01',
  );
});

test('kge se relit comme une requete de type kge, uid -1', () => {
  const f = frame(trameMettreEnVente({ prix: 29, uidPile: 84496683, taille: 1 }).toString('hex'));
  assert.strictEqual(f.kind, 'request');
  assert.strictEqual(f.type, 'kge');
  assert.strictEqual(f.uid, -1n);
});

// --- Les confirmations ---------------------------------------------------
//
// CE N'EST PAS kes QUI CONFIRME. Le journal porte 2 kge et 102 kes: les cent
// autres sont des reposts de concurrents, recus parce qu'on est abonne a leur
// GID. ivj et ium, eux, ne concernent que nos propres piles.

test('ivj rend l uid de la pile et sa quantite restante', () => {
  assert.deepStrictEqual(
    lirePileMaj(frame('0a2a0a280a13747970652e616e6b616d612e636f6d2f69766a1211120508ba0110011a081097eca92818ba01')),
    { uid: 84571671, qte: 186 },
  );
});

test('ium rend l uid de la pile videe', () => {
  assert.strictEqual(
    lirePileDisparue(frame('0a1e0a1c0a13747970652e616e6b616d612e636f6d2f69756d120508aba2a528')),
    84496683,
  );
});

test('lirePileMaj et lirePileDisparue ignorent les autres types', () => {
  const kes = frame('0a2b0a290a13747970652e616e6b616d612e636f6d2f6b657312120a0908bd937318f5412001101d2080d49301');
  assert.strictEqual(lirePileMaj(kes), null);
  assert.strictEqual(lirePileDisparue(kes), null);
});

// --- lireStock, sur les deux trames mesurees -----------------------------

test('lireStock rend les 219 piles de l inventaire mesure', () => {
  const hex = fs.readFileSync(path.join(__dirname, 'fixtures', 'hdv-ivx-inventaire.hex'), 'utf8').trim();
  const piles = lireStock(frame(hex));
  assert.strictEqual(piles.length, 219);
  for (const p of piles) {
    assert.ok(Number.isInteger(p.uid) && p.uid > 0, 'chaque pile a un uid');
    assert.ok(Number.isInteger(p.gid) && p.gid > 0, 'chaque pile a un gid');
    assert.ok(Number.isInteger(p.qte) && p.qte > 0, 'chaque pile a une quantite');
  }
});

// LA PREUVE QUE ivx EST L'INVENTAIRE: son uid le plus haut est exactement la
// pile que le joueur a ensuite posee au sol, avec le meme GID et la meme
// quantite. Voir 2026-09-01-trames-mise-en-vente.md.
test('lireStock : la pile posee au sol figure dans l inventaire mesure', () => {
  const hex = fs.readFileSync(path.join(__dirname, 'fixtures', 'hdv-ivx-inventaire.hex'), 'utf8').trim();
  const pile = lireStock(frame(hex)).find((p) => p.uid === 84495873);
  assert.deepStrictEqual(pile, { uid: 84495873, gid: 13731, qte: 286, avecEffets: false });
});

test('lireStock rend les 814 piles de la banque mesuree', () => {
  const hex = fs.readFileSync(path.join(__dirname, 'fixtures', 'hdv-iwb.hex'), 'utf8').trim();
  const piles = lireStock(frame(hex));
  assert.strictEqual(piles.length, 814);
  assert.strictEqual(new Set(piles.map((p) => p.gid)).size, 814);
});

// Le champ 2 du detail dit que l'objet PORTE DES EFFETS — et non qu'il est un
// equipement. 204 des 219 piles d'inventaire en ont, et 57 des 814 de la
// banque: ces dernieres montent a 1349 exemplaires, donc ce sont des
// consommables ou des runes, pas des pieces uniques.
test('lireStock marque les piles qui portent des effets', () => {
  const inv = fs.readFileSync(path.join(__dirname, 'fixtures', 'hdv-ivx-inventaire.hex'), 'utf8').trim();
  const banque = fs.readFileSync(path.join(__dirname, 'fixtures', 'hdv-iwb.hex'), 'utf8').trim();
  assert.strictEqual(lireStock(frame(inv)).filter((p) => p.avecEffets).length, 204);
  assert.strictEqual(lireStock(frame(banque)).filter((p) => p.avecEffets).length, 57);
});

test('lireStock rend un tableau vide sur un type inconnu', () => {
  assert.deepStrictEqual(lireStock(frame('0a170a150a13747970652e616e6b616d612e636f6d2f6b7261')), []);
});
```

- [ ] **Step 2 : lancer les tests et vérifier qu'ils échouent**

Run: `node --test test/hdv-trames.test.js`
Expected: FAIL — `trameMettreEnVente is not a function`.

- [ ] **Step 3 : ajouter les constructeurs et lecteurs à `src/hdv/trames.js`**

Après `trameStats`, ajouter :

```js
// kge { 1: prix DU LOT, 2: uid de la PILE, 3: taille du lot }
//
// LE CHAMP 2 EST L'UID D'UNE PILE, pas celui d'un lot en vente: c'est ce qui
// distingue kge de kch. Prouve par deux poses consecutives sur la meme pile,
// meme valeur au champ 2 et deux quantites differentes.
//
// LES DEUX ORIGINES MARCHENT. Une pile d'inventaire et une pile de banque ont
// ete posees le 01/09, toutes deux acceptees: il n'y a donc rien a retirer de
// la banque avant de vendre.
function trameMettreEnVente({ prix, uidPile, taille }) {
  return requete('kge', [v(1, prix), v(2, uidPile), v(3, taille)]);
}
```

Après `lireNosLots`, ajouter :

```js
// UNE PILE, telle qu'elle apparait dans ivx comme dans iwb: la meme forme, au
// numero de champ de l'element pres.
//
//   { 1: <position>, 5: { 1: gid, 2: <effets>…, 3: quantite, 4: uid } }
//
// LE CHAMP 2 DU DETAIL DIT QUE L'OBJET PORTE DES EFFETS. Il ne dit PAS que
// c'est un equipement, et les confondre coute cher: 57 des 814 piles de banque
// mesurees le portent, dont 52 a quantite superieure a 1 et jusqu'a 1349
// exemplaires — des consommables ou des runes, empilables. Seul l'inventaire
// est majoritairement de l'equipement, 179 de ses 204 piles a effets etant a
// quantite 1.
//
// Ce qu'on en tire est donc « cet objet a des effets », et rien de plus. Une
// RESSOURCE n'en a pas: c'est ce qui rend le champ utilisable pour garder
// exactement ce que l'hotel de vente ressources accepte, en ecartant du meme
// coup les equipements ET les consommables, qui relevent d'autres hotels. Sans
// ce tri il faudrait demander la categorie de chaque GID, un aller-retour par
// objet.
function lirePile(el) {
  if (el.kind !== 'message') return null;
  const detail = champ(el.value, 5);
  if (detail === null || detail.kind !== 'message') return null;
  const gid = entier(detail.value, 1);
  const qte = entier(detail.value, 3);
  const uid = entier(detail.value, 4);
  if (gid === null || qte === null || uid === null) return null;
  const avecEffets = (detail.value || []).some((f) => f.no === 2);
  return { uid, gid, qte, avecEffets };
}

// ivx { 3: [ pile ] } — l'inventaire, et l'inventaire + la banque quand le
// client a demande les deux rangements. iwb { 1: [ pile ] } — la banque seule,
// a l'ouverture chez le banquier.
//
// LE CLIENT EMET LA DEMANDE LUI-MEME (itr) en ouvrant le panneau de vente:
// OMNI n'a rien a demander, il lui suffit d'ecouter.
function lireStock(frame) {
  if (!frame) return [];
  let no = null;
  if (frame.type === 'ivx') no = 3;
  else if (frame.type === 'iwb') no = 1;
  if (no === null) return [];
  const piles = [];
  for (const el of frame.payload || []) {
    if (el.no !== no) continue;
    const pile = lirePile(el);
    if (pile !== null) piles.push(pile);
  }
  return piles;
}

// ivj { 3: { 2: uid de la pile, 3: quantite restante } } — la pile a ete
// entamee. C'est L'UNE DES DEUX SEULES CONFIRMATIONS d'un kge qui nous
// appartienne: kes arrive aussi pour les lots des autres joueurs.
function lirePileMaj(frame) {
  if (!frame || frame.type !== 'ivj') return null;
  const detail = champ(frame.payload, 3);
  if (detail === null || detail.kind !== 'message') return null;
  const uid = entier(detail.value, 2);
  const qte = entier(detail.value, 3);
  if (uid === null || qte === null) return null;
  return { uid, qte };
}

// ium { 1: uid } — la pile a disparu. Elle sert deux fois: une pile posee au
// sol, et une pile videe par une vente. C'est la disparition d'une pile,
// quelle qu'en soit la cause.
function lirePileDisparue(frame) {
  if (!frame || frame.type !== 'ium') return null;
  return entier(frame.payload, 1);
}
```

Et remplacer le bloc `module.exports` par :

```js
module.exports = {
  TAILLES,
  trameMajPrix, trameAbonner, trameDesabonner, trameStats, trameMettreEnVente,
  lirePrixMarche, lireStatsPrix, lireNosLots, lireLotPose, lireLotRetire, lirePrixMoyens,
  lireStock, lirePileMaj, lirePileDisparue,
  varintsPackes,
};
```

- [ ] **Step 4 : lancer les tests des trames et du stock**

Run: `node --test test/hdv-trames.test.js test/hdv-stock.test.js`
Expected: PASS, tous — y compris les deux tests sur fixtures de la Task 2.

- [ ] **Step 5 : commit**

```bash
git add src/hdv/trames.js test/hdv-trames.test.js
git commit -m "feat(hdv): kge a construire, ivx iwb ivj ium a lire"
```

---

### Task 4 : `vente.js`, l'écoute permanente

**Files:**
- Create: `src/hdv/vente.js`
- Test: `test/hdv-vente.test.js`

**Interfaces:**
- Consumes: `lireStock`, `lirePrixMoyens` (Task 3) ; `candidats` (Task 2).
- Produces: `creerVente({ superviseur, reglages, onCompteRendu }) -> { onTrame, lancer, arreter, pilesConnues, enCours }`.
  - `onTrame({ pid, dir, frame })` — appelé par `composer()`.
  - `pilesConnues(pid) -> number` — le nombre de piles fongibles mémorisées, pour l'IHM.
  - `enCours(pid) -> boolean`.

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `test/hdv-vente.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFrameRaw, encodeRaw, WIRE } = require('../src/codec/rawProto');
const { creerVente } = require('../src/hdv/vente');

const fixture = (nom) => decodeFrameRaw(
  Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures', nom), 'utf8').trim(), 'hex'),
);

// Un double du superviseur, comme dans passeur.test.js: il retient ce qu'on lui
// demande d'emettre au lieu d'ouvrir une socket.
function doubleSuperviseur(pid = 42, etat = { nom: 'compte' }) {
  return {
    comptes: new Map([[pid, etat]]),
    envois: [],
    emettre(p, octets) { this.envois.push({ pid: p, octets }); return { ok: true }; },
  };
}

// Une trame ivi fabriquee: la vraie fait 90 Ko et 9861 paires, on n'en a pas
// besoin pour verifier que la table est retenue.
function trameIvi(paires) {
  return decodeFrameRaw(encodeRaw([
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: 'type.ankama.com/ivi' },
        { no: 2, wire: WIRE.LEN, kind: 'message', value: paires.map(([gid, prix]) => ({
          no: 2, wire: WIRE.LEN, kind: 'message', value: [
            { no: 1, wire: WIRE.VARINT, value: BigInt(gid) },
            { no: 2, wire: WIRE.VARINT, value: BigInt(prix) },
          ],
        })) },
      ] },
    ] },
  ]));
}

test('l ecoute retient les piles fongibles d une ivx', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-ivx-inventaire.hex') });
  // 219 piles mesurees, dont 204 a effets ecartees.
  assert.strictEqual(vente.pilesConnues(42), 15);
});

test('l ecoute retient aussi la banque, et remplace la liste precedente', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-ivx-inventaire.hex') });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-iwb.hex') });
  // 814 piles en banque, dont 57 a effets: 757 fongibles.
  assert.strictEqual(vente.pilesConnues(42), 757);
});

// UNE TRAME QUI NE REND AUCUNE PILE N'EFFACE PAS CE QU'ON SAIT. ivx n'a ete
// observee que comme une liste de stock, mais un decodage a vide ecraserait la
// liste utile — et le bouton deviendrait inerte sans raison visible.
test('une ivx sans pile lisible n efface pas la liste memorisee', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-iwb.hex') });
  const vide = decodeFrameRaw(encodeRaw([
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: 'type.ankama.com/ivx' },
        { no: 2, wire: WIRE.LEN, kind: 'message', value: [{ no: 1, wire: WIRE.VARINT, value: 7n }] },
      ] },
    ] },
  ]));
  vente.onTrame({ pid: 42, dir: 'in', frame: vide });
  assert.strictEqual(vente.pilesConnues(42), 757);
});

test('l ecoute ignore le sens sortant', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur });
  vente.onTrame({ pid: 42, dir: 'out', frame: fixture('hdv-iwb.hex') });
  assert.strictEqual(vente.pilesConnues(42), 0);
});

test('lancer refuse tant qu aucun stock n est memorise', () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({ superviseur, onCompteRendu: (r) => rendus.push(r) });
  vente.lancer(42);
  assert.strictEqual(rendus.length, 1);
  assert.strictEqual(rendus[0].ok, false);
  assert.match(rendus[0].raison, /ouvre l hotel de vente/);
  assert.strictEqual(superviseur.envois.length, 0);
});

test('lancer refuse sur un compte qui n est pas pilote', () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({ superviseur, onCompteRendu: (r) => rendus.push(r) });
  vente.onTrame({ pid: 99, dir: 'in', frame: fixture('hdv-iwb.hex') });
  vente.lancer(99);
  assert.strictEqual(rendus[0].ok, false);
  assert.match(rendus[0].raison, /pilote/);
});

test('l ecoute retient les prix moyens d ivi', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur, reglages: { delaiObjetMs: 0, delaiRafaleMs: 0, delaiReponseMs: 0 } });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32], [8437, 39]]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-iwb.hex') });
  vente.lancer(42);
  // La passe a demarre: le premier envoi est un abonnement.
  assert.ok(superviseur.envois.length > 0);
  // ET C'EST BIEN LA TABLE D'IVI QUI A DECIDE DE L'ORDRE. Sans elle tous les
  // lots vaudraient zero et le tri retomberait sur le gid 1731; avec elle, le
  // lot le plus cher est le gid 8437. Une assertion sur le seul nombre
  // d'envois ne prouverait rien: la passe demarre dans les deux cas.
  const abonnement = decodeFrameRaw(superviseur.envois[0].octets);
  assert.strictEqual(abonnement.type, 'keh');
  // Un champ absent doit ECHOUER comme une assertion, pas lever un TypeError:
  // « undefined n'est pas 8437 » nomme l'attendu, « cannot read .value » non.
  const valeur = (no) => {
    const f = (abonnement.payload || []).find((x) => x.no === no);
    return f === undefined ? null : Number(f.value);
  };
  assert.strictEqual(valeur(1), 8437);
  // Le champ 2 distingue l'abonnement du DESABONNEMENT, qui est le meme
  // message sans lui. Sans cette assertion, confondre les deux passerait.
  assert.strictEqual(valeur(2), 1);
  vente.arreter(42);
});
```

- [ ] **Step 2 : lancer les tests et vérifier qu'ils échouent**

Run: `node --test test/hdv-vente.test.js`
Expected: FAIL — `Cannot find module '../src/hdv/vente'`.

- [ ] **Step 3 : écrire le squelette de `src/hdv/vente.js`**

```js
'use strict';
const {
  trameMettreEnVente, trameAbonner, trameDesabonner, trameStats,
  lirePrixMarche, lireStatsPrix, lireStock, lirePileMaj, lirePileDisparue, lirePrixMoyens,
} = require('./trames');
const { deciderPose } = require('./prix');
const { candidats, paquets } = require('./stock');

// Poser des lots en hotel de vente, un compte a la fois.
//
// Mesure: docs/superpowers/specs/2026-09-01-trames-mise-en-vente.md.
// Conception: docs/superpowers/specs/2026-09-01-mise-en-vente-design.md.
//
// CE MODULE A DEUX ROLES, comme reprix.js, et pour la meme raison.
//
// 1. UNE ECOUTE PERMANENTE. Elle memorise ivx — les piles du joueur — et ivi,
//    les prix moyens du catalogue. ivx arrive QUAND LE JOUEUR OUVRE SON
//    PANNEAU DE VENTE: c'est le client qui la demande, de lui-meme, par un
//    itr. Un module qui ne se reveillerait qu'au clic aurait deja rate la
//    seule trame qui dit ce qu'on possede.
//
// 2. UNE PASSE, declenchee par le bouton. D'ou lancer(pid), un point d'entree
//    de plus: un bouton n'est pas une trame.
//
// ON N'EMET PAS NOTRE PROPRE itr. Les quatre itr mesures l'ont tous ete par le
// client, au moment ou le joueur ouvrait ou filtrait son panneau. Rien ne dit
// que le serveur accepte un itr isole, et on n'acheterait que la fraicheur
// d'un stock deja frais.

// LE RYTHME, A DEUX ECHELLES.
//
// Poser quatre lots identiques, c'est taper Entree quatre fois: le prix est
// deja saisi, la quantite deja choisie. D'ou une rafale courte a l'interieur
// d'un paquet. Signale en jeu le 01/09: « en moins de 0,5 seconde j'ai mis 4
// lots de 100 en HDV ».
const DELAI_RAFALE_MIN = 90;
const DELAI_RAFALE_MAX = 260;

// ENTRE DEUX OBJETS, LE DELAI LONG — et c'est lui qui rachete le realisme que
// la rafale depense. Ces deux bornes sont celles de reprix.js, corrigees APRES
// essai en jeu: la premiere version tenait 150 a 600 ms et s'etait fait
// signaler d'un « ca met en vente un peu trop vite ».
//
// Avec la rafale et ces bornes, 300 lots prennent 5 min 43 s, soit 0,88 lot
// par seconde en moyenne. Descendre le delai d'objet a 400-1400 ms ramenerait
// la moyenne a 1,5-2,6/s, c'est-a-dire exactement la cadence qui avait paru
// trop vive.
const DELAI_OBJET_MIN = 900;
const DELAI_OBJET_MAX = 2600;

// LA PAUSE FRANCHE, comptee EN VISITES D'OBJET et non en lots: la rafale est
// le geste atomique, on ne la coupe pas en son milieu.
const PAUSE_MIN = 2000;
const PAUSE_MAX = 7000;
const AVANT_PAUSE_MIN = 20;
const AVANT_PAUSE_MAX = 30;

// Au-dela, on considere que la reponse ne viendra pas. Le serveur repond en
// 30 ms sur les mesures.
const DELAI_REPONSE = 4000;

const auHasard = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// Le temps entre deux lots d'un meme paquet. Pure: le hasard entre par
// argument, donc les bornes se testent sans piloter d'horloge.
function rythmeRafale(hasard = Math.random) {
  return DELAI_RAFALE_MIN + Math.floor(hasard() * (DELAI_RAFALE_MAX - DELAI_RAFALE_MIN + 1));
}

// Le temps d'une visite d'objet a la suivante, avec la pause quand le compteur
// tombe. Rend le delai ET le compteur pour la visite suivante: LE COMPTEUR EST
// REARME en meme temps que la pause est servie, sans quoi il resterait a zero
// et toutes les visites suivantes pauseraient aussi.
//
// ELLE NE S'APPELLE PAS rythmeObjet, ET C'EST VOLONTAIRE. reprix.js exporte
// deja un rythmeObjet(hasard) qui rend un NOMBRE et ne pause pas; celle-ci
// prend un compteur et rend { ms, compteur }. Deux modules freres, deux
// signatures, un seul nom: la confusion serait garantie au premier qui lit les
// deux.
function rythmeVisite(compteur, hasard = Math.random) {
  const entre = (min, max) => min + Math.floor(hasard() * (max - min + 1));
  let ms = entre(DELAI_OBJET_MIN, DELAI_OBJET_MAX);
  let suivant = compteur - 1;
  if (suivant <= 0) {
    ms += entre(PAUSE_MIN, PAUSE_MAX);
    suivant = entre(AVANT_PAUSE_MIN, AVANT_PAUSE_MAX);
  }
  return { ms, compteur: suivant };
}

function creerVente({ superviseur, reglages = {}, onCompteRendu = () => {} }) {
  // Ce que l'ecoute permanente retient, par client.
  const stocks = new Map();     // pid -> [{ uid, gid, qte, avecEffets }]
  const prixMoyens = new Map(); // pid -> Map(gid -> prix moyen unitaire)
  const passes = new Map();     // pid -> la passe en cours

  const pilesConnues = (pid) => (stocks.get(pid) || []).filter((p) => !p.avecEffets).length;
  const enCours = (pid) => passes.has(pid);

  function onTrame({ pid, dir, frame }) {
    if (frame === null || frame === undefined || dir !== 'in') return;

    if (frame.type === 'ivx' || frame.type === 'iwb') {
      const piles = lireStock(frame);
      // Une trame qui ne rend aucune pile n'efface pas ce qu'on sait: le
      // bouton deviendrait inerte sans raison visible.
      if (piles.length > 0) stocks.set(pid, piles);
      return;
    }
    if (frame.type === 'ivi') {
      const table = lirePrixMoyens(frame);
      if (table.size > 0) prixMoyens.set(pid, table);
      return;
    }
  }

  function lancer(pid) {
    if (passes.has(pid)) {
      onCompteRendu({ pid, ok: false, raison: 'une passe tourne deja sur ce compte' });
      return;
    }
    const etat = superviseur.comptes.get(pid);
    if (etat === null || etat === undefined) {
      onCompteRendu({ pid, ok: false, raison: 'ce compte n est pas pilote' });
      return;
    }
    const piles = stocks.get(pid) || [];
    if (piles.length === 0) {
      onCompteRendu({ pid, ok: false, raison: 'ouvre l hotel de vente une fois pour que je voie ton stock' });
      return;
    }
    const lots = candidats({ piles, prixMoyens: prixMoyens.get(pid) || new Map() });
    if (lots.length === 0) {
      onCompteRendu({ pid, ok: false, raison: 'aucune ressource vendable dans ton stock' });
      return;
    }
    demarrer(pid, etat, piles, lots);
  }

  function arreter(pid) {
    const passe = passes.get(pid);
    if (passe === undefined) return;
    terminer(pid, passe, 'arret demande', true);
  }

  return { onTrame, lancer, arreter, pilesConnues, enCours };
}

module.exports = {
  creerVente, rythmeRafale, rythmeVisite,
  DELAI_RAFALE_MIN, DELAI_RAFALE_MAX, DELAI_OBJET_MIN, DELAI_OBJET_MAX,
  PAUSE_MIN, PAUSE_MAX, DELAI_REPONSE,
};
```

`demarrer` et `terminer` sont écrits en Task 5. Pour que la Task 4 soit vérifiable seule, ajouter provisoirement, juste avant `return { onTrame, … }` :

```js
  // Remplace en Task 5 par l'automate complet.
  function demarrer(pid, etat, piles, lots) {
    passes.set(pid, { etatArme: etat, piles, lots, minuteurs: new Set() });
    superviseur.emettre(pid, trameAbonner(lots[0].gid));
  }
  function terminer(pid, passe) {
    passes.delete(pid);
    onCompteRendu({ pid, fini: true, bilan: { poses: 0, sautes: 0, echecs: 0, objetsAbandonnes: 0 }, raison: null });
  }
```

- [ ] **Step 4 : lancer les tests**

Run: `node --test test/hdv-vente.test.js`
Expected: PASS, les sept tests.

- [ ] **Step 5 : commit**

```bash
git add src/hdv/vente.js test/hdv-vente.test.js
git commit -m "feat(hdv): vente.js, l ecoute permanente du stock"
```

---

### Task 5 : `vente.js`, la passe

**Files:**
- Modify: `src/hdv/vente.js`
- Test: `test/hdv-vente.test.js`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: le compte rendu passé à `onCompteRendu`. Trois formes :
  - refus au lancement : `{ pid, ok: false, raison }`
  - avancement : `{ pid, poses, objetsFaits, objets }`
  - fin : `{ pid, fini: true, bilan: { poses, sautes, echecs, objetsAbandonnes }, raison }` (`raison` vaut `null` sur une fin normale).

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter à `test/hdv-vente.test.js`. D'abord des fabriques de trames en tête du fichier, après `trameIvi` :

```js
// Les trames que le serveur renvoie. Fabriquees, parce qu'on a besoin de faire
// varier les prix; leur FORME est celle des trames mesurees, et les lecteurs
// sont figes sur les vraies dans hdv-trames.test.js.
function evenement(type, champs) {
  return decodeFrameRaw(encodeRaw([
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: `type.ankama.com/${type}` },
        ...(champs.length ? [{ no: 2, wire: WIRE.LEN, kind: 'message', value: champs }] : []),
      ] },
    ] },
  ]));
}
const vint = (no, val) => ({ no, wire: WIRE.VARINT, value: BigInt(val) });
const packes = (prix) => {
  const octets = [];
  for (const p of prix) {
    let v = BigInt(p);
    do { const o = Number(v & 0x7fn); v >>= 7n; octets.push(v > 0n ? o | 0x80 : o); } while (v > 0n);
  }
  return Buffer.from(octets);
};

// kbt AVEC champ 3: la reponse a kbz. Sans champ 3 ce serait l'accuse du
// desabonnement precedent, et lireStatsPrix rend null dessus.
const trameKbt = (gid, prix) => evenement('kbt', [
  vint(1, 51), vint(2, gid),
  { no: 3, wire: WIRE.LEN, kind: 'message', value: [
    { no: 6, wire: WIRE.LEN, kind: 'bytes', value: packes(prix), raw: packes(prix) },
  ] },
]);
const trameKgp = (gid, prix) => evenement('kgp', [
  { no: 2, wire: WIRE.LEN, kind: 'bytes', value: packes(prix), raw: packes(prix) },
  vint(5, gid), vint(6, 51),
]);
const trameIvj = (uid, qte) => evenement('ivj', [
  { no: 3, wire: WIRE.LEN, kind: 'message', value: [vint(2, uid), vint(3, qte)] },
]);
const trameIum = (uid) => evenement('ium', [vint(1, uid)]);

// Une pile unique, pour piloter une passe courte et lisible.
function venteAvecPile({ gid = 13731, qte = 200, moyen = 32 } = {}) {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 0, delaiRafaleMs: 0, delaiReponseMs: 0 },
    onCompteRendu: (r) => rendus.push(r),
  });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[gid, moyen]]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: evenement('iwb', [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      vint(1, 63),
      { no: 5, wire: WIRE.LEN, kind: 'message', value: [vint(1, gid), vint(3, qte), vint(4, 84496683)] },
    ] },
  ]) });
  return { superviseur, vente, rendus };
}
const typesEmis = (superviseur) => superviseur.envois.map(
  (e) => decodeFrameRaw(e.octets).type,
);
```

Puis les tests :

```js
// --- La passe ------------------------------------------------------------

test('la passe s abonne, lit le marche, puis pose', () => {
  const { superviseur, vente } = venteAvecPile({ qte: 100 });
  vente.lancer(42);
  assert.deepStrictEqual(typesEmis(superviseur), ['keh', 'kbz']);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  assert.deepStrictEqual(typesEmis(superviseur), ['keh', 'kbz', 'kge']);
  const kge = decodeFrameRaw(superviseur.envois[2].octets);
  assert.strictEqual(kge.type, 'kge');
});

// LA RAFALE NE RELIT PAS LE MARCHE. deciderPose s'aligne au lieu de
// sous-coter, donc tous les lots d'un paquet partent au meme prix: il n'y a
// rien a proteger entre deux. Relire ferait perdre le geste sans rien gagner.
test('un paquet de quatre lots part sans relire kgp entre chaque', () => {
  const { superviseur, vente } = venteAvecPile({ qte: 400 });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  // Quatre lots de 100, confirmes un a un par ivj, sans aucun kgp.
  for (const reste of [300, 200, 100, 0]) {
    vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, reste) });
  }
  const kge = superviseur.envois.filter((e) => decodeFrameRaw(e.octets).type === 'kge');
  assert.strictEqual(kge.length, 4);
});

test('tous les lots d un paquet partent au meme prix', () => {
  const { superviseur, vente } = venteAvecPile({ qte: 300 });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  for (const reste of [200, 100, 0]) {
    vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, reste) });
  }
  const prix = superviseur.envois
    .map((e) => decodeFrameRaw(e.octets))
    .filter((f) => f.type === 'kge')
    .map((f) => f.payload.find((c) => c.no === 1).value);
  assert.deepStrictEqual(prix.map(Number), [4999, 4999, 4999]);
});

// L'ARRET SUR REFUS. On ne sait distinguer ni le plafond de lots, ni le manque
// de kamas, ni un hoquet — et on n'a pas a le faire: les trois demandent la
// meme chose. On s'arrete au PREMIER kge non confirme.
test('un kge sans ivj ni ium arrete la passe', async () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 0, delaiRafaleMs: 0, delaiReponseMs: 5 },
    onCompteRendu: (r) => rendus.push(r),
  });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32]]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: evenement('iwb', [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      vint(1, 63),
      { no: 5, wire: WIRE.LEN, kind: 'message', value: [vint(1, 13731), vint(3, 300), vint(4, 84496683)] },
    ] },
  ]) });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  await new Promise((r) => setTimeout(r, 30));
  const fin = rendus.find((r) => r.fini);
  assert.ok(fin, 'la passe se termine');
  assert.match(fin.raison, /refus/);
  assert.strictEqual(fin.bilan.poses, 0);
  assert.strictEqual(fin.bilan.echecs, 1);
});

test('ium confirme aussi bien qu ivj', () => {
  const { superviseur, vente, rendus } = venteAvecPile({ qte: 100 });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIum(84496683) });
  const fin = rendus.find((r) => r.fini);
  assert.ok(fin, 'la passe se termine');
  assert.strictEqual(fin.bilan.poses, 1);
});

// ivj FAIT AUTORITE SUR NOTRE SOUSTRACTION. Si le joueur a bouge un objet
// entre-temps, notre decoupage est perime: emettre un kge sur une quantite
// qu'on n'a plus est exactement ce qu'il faut eviter.
test('un ivj plus bas que prevu abandonne les lots devenus impossibles', () => {
  const { superviseur, vente, rendus } = venteAvecPile({ qte: 300 });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  // On attendait 200 apres le premier lot de 100; le serveur dit 50.
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, 50) });
  const kge = superviseur.envois.filter((e) => decodeFrameRaw(e.octets).type === 'kge');
  assert.strictEqual(kge.length, 1, 'les deux lots de 100 restants sont abandonnes');
  const fin = rendus.find((r) => r.fini);
  assert.strictEqual(fin.bilan.poses, 1);
  assert.strictEqual(fin.bilan.sautes, 2);
});

test('un kbt qui n arrive jamais n abandonne que son objet', async () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 0, delaiRafaleMs: 0, delaiReponseMs: 5 },
    onCompteRendu: (r) => rendus.push(r),
  });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32], [8437, 39]]) });
  const pile = (gid, qte, uid) => ({
    no: 1, wire: WIRE.LEN, kind: 'message', value: [
      vint(1, 63),
      { no: 5, wire: WIRE.LEN, kind: 'message', value: [vint(1, gid), vint(3, qte), vint(4, uid)] },
    ] });
  vente.onTrame({ pid: 42, dir: 'in', frame: evenement('iwb', [pile(13731, 100, 1), pile(8437, 100, 2)]) });
  vente.lancer(42);
  await new Promise((r) => setTimeout(r, 30));
  const fin = rendus.find((r) => r.fini);
  assert.ok(fin, 'la passe se termine');
  assert.strictEqual(fin.bilan.objetsAbandonnes, 2);
  assert.strictEqual(fin.raison, null, 'ce n est pas un arret, c est une fin normale');
});

test('un client qui disparait arrete la passe', () => {
  const { superviseur, vente, rendus } = venteAvecPile({ qte: 100 });
  vente.lancer(42);
  superviseur.comptes.set(42, { nom: 'un autre client sous le meme pid' });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  const fin = rendus.find((r) => r.fini);
  assert.ok(fin, 'la passe se termine');
  assert.match(fin.raison, /disparu/);
});

test('la passe se desabonne en partant', () => {
  const { superviseur, vente } = venteAvecPile({ qte: 100 });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, 0) });
  assert.strictEqual(typesEmis(superviseur).filter((t) => t === 'keh').length, 2);
});

// --- Les fonctions de rythme ---------------------------------------------

test('rythmeRafale reste dans ses bornes', () => {
  const { rythmeRafale, DELAI_RAFALE_MIN, DELAI_RAFALE_MAX } = require('../src/hdv/vente');
  assert.strictEqual(rythmeRafale(() => 0), DELAI_RAFALE_MIN);
  assert.strictEqual(rythmeRafale(() => 0.999999), DELAI_RAFALE_MAX);
});

test('rythmeVisite ajoute la pause et rearme le compteur', () => {
  const { rythmeVisite, DELAI_OBJET_MIN, PAUSE_MIN, DELAI_OBJET_MAX, PAUSE_MAX } = require('../src/hdv/vente');
  const sansPause = rythmeVisite(5, () => 0);
  assert.strictEqual(sansPause.ms, DELAI_OBJET_MIN);
  assert.strictEqual(sansPause.compteur, 4);
  const avecPause = rythmeVisite(1, () => 0);
  assert.strictEqual(avecPause.ms, DELAI_OBJET_MIN + PAUSE_MIN);
  assert.ok(avecPause.compteur >= 20, 'le compteur est rearme, sinon toutes les visites suivantes pauseraient');
  const haut = rythmeVisite(1, () => 0.999999);
  assert.strictEqual(haut.ms, DELAI_OBJET_MAX + PAUSE_MAX);
});
```

- [ ] **Step 2 : lancer les tests et vérifier qu'ils échouent**

Run: `node --test test/hdv-vente.test.js`
Expected: FAIL sur tous les tests de la passe (le `demarrer` provisoire n'émet qu'un `keh`).

- [ ] **Step 3 : remplacer le squelette provisoire par l'automate**

Dans `src/hdv/vente.js`, supprimer les `demarrer` et `terminer` provisoires et insérer, juste après les trois `Map` :

```js
  const delaiObjetMs = (passe) => {
    const r = reglages.delaiObjetMs;
    if (Number.isFinite(r)) return r;
    const { ms, compteur } = rythmeVisite(passe.avantPause);
    passe.avantPause = compteur;
    return ms;
  };
  const delaiRafaleMs = () => {
    const r = reglages.delaiRafaleMs;
    return Number.isFinite(r) ? r : rythmeRafale();
  };
  const delaiReponseMs = () => {
    const r = reglages.delaiReponseMs;
    return Number.isFinite(r) ? r : DELAI_REPONSE;
  };

  // Un delai nul s'execute TOUT DE SUITE plutot qu'au tour de boucle suivant:
  // les tests avancent alors de facon synchrone, et chaque assertion porte sur
  // un etat stable plutot que sur une course.
  function plusTard(passe, fn, ms) {
    if (ms <= 0) { fn(); return null; }
    const t = setTimeout(() => { passe.minuteurs.delete(t); fn(); }, ms);
    passe.minuteurs.add(t);
    return t;
  }

  // LES DEUX DELAIS NE SE LISENT PAS PAREIL A ZERO. Un delai d'envoi nul veut
  // dire « tout de suite »; un delai d'expiration nul voudrait dire « la
  // reponse est deja en retard ». Zero desarme donc le minuteur.
  function expirer(passe, fn, ms) {
    if (ms <= 0) return null;
    return plusTard(passe, fn, ms);
  }

  function annulerMinuteurs(passe) {
    for (const t of passe.minuteurs) clearTimeout(t);
    passe.minuteurs.clear();
  }

  // LA GARDE D'IDENTITE, reprise de passeur.js. On compare l'OBJET d'etat, pas
  // le pid: Windows recycle les numeros, et un client relance pendant la passe
  // rendrait un autre etat sous le meme pid. Herite de la passe du precedent,
  // il recevrait des kge portant les uid de piles de quelqu'un d'autre.
  function vivant(pid, passe) {
    return superviseur.comptes.get(pid) === passe.etatArme;
  }

  function envoyer(pid, passe, octets) {
    const res = superviseur.emettre(pid, octets);
    if (res && res.ok === false) {
      terminer(pid, passe, res.raison || 'envoi refuse', false);
      return false;
    }
    return true;
  }

  function terminer(pid, passe, raison, seDesabonner = true) {
    annulerMinuteurs(passe);
    passes.delete(pid);
    if (seDesabonner && passe.gid !== null) superviseur.emettre(pid, trameDesabonner(passe.gid));
    onCompteRendu({ pid, fini: true, bilan: passe.bilan, raison: raison || null });
  }

  // Passe au paquet suivant, en se desabonnant du precedent. Tant qu'on reste
  // abonne, le serveur continue de pousser des kgp pour rien.
  //
  // ON SE DESABONNE MEME QUAND LE GID NE CHANGE PAS. Un paquet est une visite,
  // et deux paquets du meme objet portent des tailles differentes: relire le
  // marche entre les deux est precisement ce que la regle « un lot par kgp »
  // conserve de sens.
  function paquetSuivant(pid, passe) {
    annulerMinuteurs(passe);
    if (passe.gid !== null && !envoyer(pid, passe, trameDesabonner(passe.gid))) return;
    passe.gid = null;
    passe.paquet = null;
    passe.prix = null;
    passe.attentePile = null;

    if (passe.paquets.length === 0) { terminer(pid, passe, null, false); return; }

    const paquet = passe.paquets.shift();

    // L'ouverture de l'objet suivant EST DIFFEREE. Entre les deux, passe.gid
    // vaut null: les kbt et kgp qui trainent encore sont donc ignores, ce qui
    // est exactement ce qu'on veut — ils portent sur l'objet qu'on quitte.
    plusTard(passe, () => {
      if (!passes.has(pid)) return;
      if (!vivant(pid, passe)) { terminer(pid, passe, 'le client a disparu pendant la passe', false); return; }
      passe.gid = paquet.gid;
      passe.paquet = paquet;
      passe.file = paquet.lots.slice();
      passe.objetsFaits += 1;
      if (!envoyer(pid, passe, trameAbonner(paquet.gid))) return;
      if (!envoyer(pid, passe, trameStats(paquet.gid))) return;

      // Si kbt n'arrive jamais, on abandonne CE paquet et on continue. Une
      // passe pendue ressemblerait trait pour trait a une passe qui travaille.
      expirer(passe, () => {
        if (!passes.has(pid)) return;
        // LA GARDE D'IDENTITE VAUT AUSSI POUR LES MINUTEURS, et c'est le cas
        // qu'on oublie: une expiration arrive jusqu'a quatre secondes apres
        // l'envoi, largement de quoi laisser un autre client reprendre le pid.
        // paquetSuivant emet un trameDesabonner des sa premiere ligne, donc
        // sans cette garde on parle dans la session de quelqu'un d'autre.
        if (!vivant(pid, passe)) { terminer(pid, passe, 'le client a disparu pendant la passe', false); return; }
        passe.bilan.objetsAbandonnes += 1;
        passe.file = [];
        paquetSuivant(pid, passe);
      }, delaiReponseMs());
    }, delaiObjetMs(passe));
  }

  // Les lots DEJA POSES pendant cette passe pour ce gid et cette taille. C'est
  // ce que deciderPose compare au minimum du marche pour savoir si le minimum
  // est deja le notre — et donc s'aligner au lieu de sous-coter.
  function nosDuPaquet(passe) {
    return passe.poses.filter((l) => l.gid === passe.gid);
  }

  // Le prix du paquet est decide UNE FOIS, a l'arrivee de kbt. Ensuite on pose
  // en rafale: tous les lots partent au meme prix, donc il n'y a rien a
  // relire. Si un concurrent passe dessous pendant la rafale, nos derniers
  // lots sont un cran trop haut — et c'est exactement ce que « mettre a jour
  // les prix » rattrape.
  function poserSuivant(pid, passe) {
    if (!passes.has(pid)) return;

    while (passe.file.length > 0) {
      const lot = passe.file[0];
      const reste = passe.quantites.get(lot.uidPile);
      // ivj FAIT AUTORITE. Notre decoupage date du lancement; si la pile a
      // fondu entre-temps, emettre dessus poserait un lot qu'on n'a plus.
      if (reste === undefined || reste < lot.taille) {
        passe.file.shift();
        passe.bilan.sautes += 1;
        continue;
      }
      passe.file.shift();
      passe.attentePile = lot.uidPile;
      const envoi = trameMettreEnVente({ prix: passe.prix, uidPile: lot.uidPile, taille: lot.taille });
      plusTard(passe, () => {
        if (!passes.has(pid)) return;
        if (!vivant(pid, passe)) { terminer(pid, passe, 'le client a disparu pendant la passe', false); return; }
        if (!envoyer(pid, passe, envoi)) return;
        passe.enVol = lot;
        // LE SERVEUR N'A JAMAIS ETE OBSERVE EN TRAIN DE REFUSER UN kge.
        // L'absence de confirmation est donc le seul signal disponible — et
        // c'est aussi ce qui implemente « jusqu'a ce qu'il n'y ait plus de
        // place ou plus de kamas » sans connaitre ni le plafond ni la taxe.
        expirer(passe, () => {
          if (!passes.has(pid) || passe.attentePile !== lot.uidPile) return;
          // Meme garde, meme raison: terminer() se desabonne, et un
          // desabonnement envoye au client qui a repris le pid part dans sa
          // session a lui.
          if (!vivant(pid, passe)) { terminer(pid, passe, 'le client a disparu pendant la passe', false); return; }
          passe.bilan.echecs += 1;
          terminer(pid, passe, 'refus du serveur — plus de place ou plus de kamas', true);
        }, delaiReponseMs());
      // LE PREMIER LOT D'UN PAQUET NE PAIE PAS LA RAFALE: le delai d'objet
      // vient deja d'etre servi par paquetSuivant, et kbt d'arriver. Ajouter
      // la rafale par-dessus compterait deux fois le meme geste, 1530 fois sur
      // le stock de mesure.
      }, passe.premier ? 0 : delaiRafaleMs());
      passe.premier = false;
      return;
    }

    paquetSuivant(pid, passe);
  }

  // Un kge confirme: la pile a fondu de la taille du lot, ou elle a disparu.
  function confirmer(pid, passe, uid, reste) {
    if (passe.attentePile !== uid) return;
    annulerMinuteurs(passe);
    passe.attentePile = null;
    if (reste === null) passe.quantites.delete(uid);
    else passe.quantites.set(uid, reste);
    passe.bilan.poses += 1;
    passe.poses.push({ gid: passe.gid, taille: passe.enVol.taille, prix: passe.prix });
    onCompteRendu({
      pid, poses: passe.bilan.poses, objetsFaits: passe.objetsFaits, objets: passe.bilan.objets,
    });
    poserSuivant(pid, passe);
  }

  function demarrer(pid, etat, piles, lots) {
    const groupes = paquets(lots);
    const quantites = new Map();
    for (const p of piles) if (!p.avecEffets) quantites.set(p.uid, p.qte);
    const passe = {
      etatArme: etat,
      paquets: groupes,
      paquet: null,
      file: [],
      gid: null,
      prix: null,
      premier: true,
      attentePile: null,
      enVol: null,
      quantites,
      poses: [],
      objetsFaits: 0,
      minuteurs: new Set(),
      // Tire au depart pour que deux passes ne pausent pas au meme rang.
      avantPause: auHasard(AVANT_PAUSE_MIN, AVANT_PAUSE_MAX),
      bilan: { objets: groupes.length, poses: 0, sautes: 0, echecs: 0, objetsAbandonnes: 0 },
    };
    passes.set(pid, passe);
    paquetSuivant(pid, passe);
  }
```

- [ ] **Step 4 : brancher les trames de la passe dans `onTrame`**

Dans `src/hdv/vente.js`, remplacer la fin de `onTrame` (après le bloc `ivi`) par :

```js
    const passe = passes.get(pid);
    if (passe === undefined) return;

    if (!vivant(pid, passe)) {
      terminer(pid, passe, 'le client a disparu pendant la passe', false);
      return;
    }

    if (frame.type === 'kbt') {
      const stats = lireStatsPrix(frame);
      // Le kbt SANS champ 3 est l'accuse du desabonnement precedent, et il
      // arrive juste avant la vraie reponse: lireStatsPrix rend null dessus.
      if (stats === null || stats.gid !== passe.gid || passe.prix !== null) return;
      annulerMinuteurs(passe);
      decidePaquet(pid, passe, stats.prix);
      return;
    }

    if (frame.type === 'kgp') {
      // On lit kgp pour tenir le marche a jour, mais on NE REDECIDE PAS: le
      // prix du paquet est arrete une fois pour toutes.
      const marche = lirePrixMarche(frame);
      if (marche === null || marche.gid !== passe.gid || passe.prix !== null) return;
      annulerMinuteurs(passe);
      decidePaquet(pid, passe, marche.prix);
      return;
    }

    if (frame.type === 'ivj') {
      const maj = lirePileMaj(frame);
      if (maj !== null) confirmer(pid, passe, maj.uid, maj.qte);
      return;
    }

    if (frame.type === 'ium') {
      const uid = lirePileDisparue(frame);
      if (uid !== null) confirmer(pid, passe, uid, null);
    }
```

Et ajouter `decidePaquet`, juste avant `poserSuivant` :

```js
  // LE PRIX DU PAQUET, DECIDE UNE FOIS. Un paquet sans prix decidable — le
  // marche est a 1 kama, ou l'extrapolation sort du garde-fou — n'emet rien du
  // tout: ses lots sont comptes sautes et on passe a l'objet suivant.
  function decidePaquet(pid, passe, marche) {
    const moyens = prixMoyens.get(pid);
    const prix = deciderPose({
      marche,
      nos: nosDuPaquet(passe),
      taille: passe.paquet.taille,
      moyenUnitaire: (moyens && moyens.get(passe.gid)) || 0,
    });
    if (prix === null) {
      passe.bilan.sautes += passe.file.length;
      passe.file = [];
      paquetSuivant(pid, passe);
      return;
    }
    passe.prix = prix;
    passe.premier = true;
    poserSuivant(pid, passe);
  }
```

- [ ] **Step 5 : lancer les tests de la vente**

Run: `node --test test/hdv-vente.test.js`
Expected: PASS, tous.

- [ ] **Step 6 : lancer la suite complète**

Run: `npm test 2>&1 | grep -E "^not ok" | grep -v serveur-maj | wc -l`
Expected: `0`.

- [ ] **Step 7 : commit**

```bash
git add src/hdv/vente.js test/hdv-vente.test.js
git commit -m "feat(hdv): la passe de mise en vente, rafale et arret sur refus"
```

---

### Task 6 : le câblage, du séquenceur au menu de ligne

**Files:**
- Modify: `desktop/main.js` (import ~ligne 15, variable ~ligne 60, état ~ligne 621, création ~ligne 938, `composer` ~ligne 1075, handler ~ligne 1311)
- Modify: `desktop/preload.js:52`
- Modify: `desktop/index.html` (menu ~ligne 939, clic ~ligne 959, rendu ~ligne 1075)

**Interfaces:**
- Consumes: `creerVente` (Task 4-5).
- Produces: le canal IPC `mettreEnVenteHdv(pid)`, et deux champs d'état de ligne : `l.hdvPiles` (entier) et `l.hdvVenteEnCours` (booléen).

- [ ] **Step 1 : importer et déclarer**

Dans `desktop/main.js`, après `const { creerReprix } = require('../src/hdv/reprix');` :

```js
const { creerVente } = require('../src/hdv/vente');
```

Et après `let reprix = null;` :

```js
let vente = null;
```

- [ ] **Step 2 : créer le séquenceur**

Dans `desktop/main.js`, juste après le bloc `reprix = creerReprix({ … });` :

```js
  // LA MISE EN VENTE.
  //
  // Elle ecoute EN PERMANENCE, comme la mise a jour des prix et pour la meme
  // raison: ivx — la liste des piles — arrive quand le joueur ouvre son
  // panneau de vente, pas quand il clique sur le bouton. La difference est que
  // c'est le CLIENT qui la demande, de lui-meme: OMNI n'emet aucun itr.
  vente = creerVente({
    superviseur,
    onCompteRendu: (r) => {
      if (r.ok === false) {
        messages.set(r.pid, `HDV : ${r.raison}`);
        journal(r.pid, `vente refus : ${r.raison}`);
        envoyerEtat();
        return;
      }
      if (r.fini) {
        const b = r.bilan;
        messages.set(r.pid, r.raison
          ? `HDV : arrêt — ${r.raison} (${b.poses} lots posés)`
          : `HDV : ${b.poses} lots posés, ${b.sautes} sautés, ${b.echecs} échoués`);
        journal(r.pid, `vente fin : ${b.poses} poses, ${b.sautes} sautes, ${b.echecs} echecs, `
          + `${b.objetsAbandonnes} objets abandonnes` + (r.raison ? ` — ${r.raison}` : ''));
        envoyerEtat();
        return;
      }
      // L'AVANCEMENT NE DECLENCHE PAS D'ENVOI D'ETAT: envoyerEtat() lance
      // powershell.exe par clientsRecents(). Le tick de 2 s l'affiche.
      //
      // PAS DE DENOMINATEUR EN LOTS. Le stock de mesure porte 6495 lots
      // candidats et la passe s'arretera bien avant: afficher « 47 / 6495 »
      // serait un chiffre faux.
      if (r.objets) messages.set(r.pid, `HDV : ${r.poses} lots posés — objet ${r.objetsFaits} sur ${r.objets}`);
    },
  });
```

- [ ] **Step 3 : publier l'état vers l'IHM**

Dans `desktop/main.js`, après les deux lignes `l.hdvLots = …` / `l.hdvEnCours = …` :

```js
    l.hdvPiles = aUnPid && vente !== null ? vente.pilesConnues(l.pid) : 0;
    l.hdvVenteEnCours = aUnPid && vente !== null ? vente.enCours(l.pid) : false;
```

- [ ] **Step 4 : composer l'écoute**

Dans `desktop/main.js`, dans l'appel à `composer(…)`, après la ligne `reprix.onTrame,` :

```js
    vente.onTrame,
```

- [ ] **Step 5 : remplacer le handler d'avis par le vrai**

Dans `desktop/main.js`, remplacer tout le bloc qui va du commentaire `// LA MISE EN VENTE N'EXISTE PAS ENCORE, ET ELLE LE DIT.` jusqu'à la fin de `ipcMain.handle('avisVenteHdv', …);` par :

```js
// LA MISE EN VENTE. Une seule voie pour lancer ET arreter, comme la mise a
// jour des prix: le menu affiche « Arrêter » pendant la passe, donc le geste
// est sans ambiguite et un second clic ne peut pas lancer une passe par-dessus
// une autre.
ipcMain.handle('mettreEnVenteHdv', async (_e, pid) => {
  if (vente === null || !Number.isInteger(pid)) return;
  if (vente.enCours(pid)) vente.arreter(pid);
  else vente.lancer(pid);
  await envoyerEtat();
});
```

- [ ] **Step 6 : le pont preload**

Dans `desktop/preload.js`, remplacer la ligne `avisVenteHdv: () => ipcRenderer.invoke('avisVenteHdv'),` par :

```js
  mettreEnVenteHdv: (pid) => ipcRenderer.invoke('mettreEnVenteHdv', pid),
```

- [ ] **Step 7 : le menu**

Dans `desktop/index.html`, remplacer les trois lignes de création de `r.vente` par :

```js
    r.vente = document.createElement('button');
```

(la classe `inerte` et le libellé sont désormais posés au rendu, comme pour `r.majPrix`.)

Puis remplacer le gestionnaire de clic de `r.vente` par :

```js
    r.vente.addEventListener('click', () => {
      const l = r.ligne;
      r.menuHdv.hidden = true;
      if (!l || l.pid === null || l.pid === undefined) return;
      // Sans stock connu il n'y a rien a vendre: l'entree est inerte, et le
      // clic ne doit pas partir quand meme.
      if (!l.hdvVenteEnCours && !l.hdvPiles) return;
      window.app.mettreEnVenteHdv(l.pid);
    });
```

- [ ] **Step 8 : le rendu de l'entrée**

Dans `desktop/index.html`, juste après le bloc `if (l.hdvEnCours) { … } else { … }` qui règle `r.majPrix` :

```js
    if (l.hdvVenteEnCours) {
      r.vente.textContent = 'Arrêter la mise en vente';
      r.vente.classList.remove('inerte');
    } else if (l.hdvPiles) {
      r.vente.textContent = 'Mettre en vente (' + l.hdvPiles + ' piles)';
      r.vente.classList.remove('inerte');
    } else {
      r.vente.textContent = 'Mettre en vente — ouvre le HDV une fois';
      r.vente.classList.add('inerte');
    }
```

Et remplacer la ligne du titre du bouton HDV pour qu'elle couvre les deux passes :

```js
    r.hdv.classList.toggle('tourne', Boolean(l.hdvEnCours || l.hdvVenteEnCours));
    r.hdv.title = l.hdvEnCours ? 'une mise à jour des prix est en cours'
      : l.hdvVenteEnCours ? 'une mise en vente est en cours' : 'hôtel de vente';
```

- [ ] **Step 9 : vérifier qu'aucune référence à l'ancien canal ne subsiste**

Run: `grep -rn "avisVenteHdv" desktop/ src/`
Expected: aucun résultat.

- [ ] **Step 10 : lancer la suite complète**

Run: `npm test 2>&1 | grep -E "^not ok" | grep -v serveur-maj | wc -l`
Expected: `0`.

- [ ] **Step 11 : essai en jeu**

Lancer `outils\lancer-dev.vbs`, ouvrir l'hôtel de vente sur un compte, vérifier que l'entrée du menu affiche le nombre de piles, puis lancer une passe et l'arrêter au bout de quelques lots avec la même entrée de menu. Vérifier dans le jeu que les lots posés portent le prix attendu.

- [ ] **Step 12 : commit**

```bash
git add desktop/main.js desktop/preload.js desktop/index.html
git commit -m "feat(hdv): le bouton mettre en vente, sur la ligne de compte"
```
