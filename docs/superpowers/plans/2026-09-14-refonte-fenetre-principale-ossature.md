# Refonte de la fenêtre principale — étape 0 : l'ossature

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE : utiliser
> superpowers:subagent-driven-development (recommandé) ou
> superpowers:executing-plans pour exécuter ce plan tâche par tâche. Les
> étapes utilisent la syntaxe à cases (`- [ ]`) pour le suivi.

**But :** poser le nouveau skin sur la coquille d'OMNI — polices embarquées,
jetons des deux thèmes, rail de cinq icônes, barre du haut, bandeaux
d'erreur — sans brancher un seul écran, et sans que l'application cesse de
marcher à un seul commit.

**Architecture :** `desktop/index.html` devient une ossature. Les jetons et
les briques partent dans `desktop/skin/*.css`, la navigation et le thème dans
`desktop/vues/rail.js`, chargé en module ES. L'ancienne feuille de style et
l'ancien script restent en place pendant toute l'étape : ils habillent encore
les panneaux, qui seront rehoussés un par un aux étapes suivantes. Les deux
palettes cohabitent, la vieille sous un préfixe temporaire.

**Pile :** Electron 43, aucune dépendance de rendu. Tests : `node --test`
(intégré). Banc d'essai : `npm run banc`.

**Spec :** `docs/superpowers/specs/2026-09-14-refonte-fenetre-principale-design.md`

## Contraintes globales

- **Commentaires et identifiants du code source en français SANS accents.**
  Les accents sont admis dans les chaînes affichées, le CSS, le HTML et la
  documentation. Convention du dépôt.
- **Messages de commit en français, sujet sans accents.**
- **OMNI doit démarrer sans réseau.** Aucune police, aucune feuille de style
  appelée en ligne. Les polices sont embarquées dans `desktop/polices/`.
- **Les pictos du jeu viennent de `https://api.beta.dofusdb.fr/img/`**, jamais
  embarqués (c'est l'art d'Ankama), avec repli `.sans-pic` sur le dessin OMNI.
  Un picto absent est un défaut d'agrément, pas une panne.
- **Ne pas toucher à `src/`.**
- **`devTools: false` en production** (`desktop/main.js:928`). Toute mise au
  point se fait sur `npm run banc`, jamais dans la fenêtre packagée.
- **La fenêtre fait 1097 × 720 et n'est pas redimensionnable.**
- **PowerShell :** ne pas chaîner avec `&&`. Utiliser `;` ou `if ($?) { }`.
- **Vérifier l'absence de données personnelles avant chaque commit** — le
  dépôt est partagé avec les amis.
- **Les numéros de ligne de ce plan sont indicatifs.** Ils ont été relevés
  avant la tâche 1, et chaque tâche décale ceux des suivantes. Retrouver
  toujours un repère par **son contenu** — la chaîne citée à côté du
  numéro — et jamais en allant droit à la ligne.

---

### Tâche 1 : Dégager la collision des deux palettes

L'ancienne palette et la nouvelle déclarent toutes deux `--fond` et `--ui`,
avec des valeurs opposées : `--fond` vaut `#0F1418` (sombre) dans l'ancienne
et `#E7EBE4` (clair papier) dans la nouvelle. Posées sur `:root` toutes les
deux, la seconde écraserait la première et l'application deviendrait
illisible au premier commit.

Les douze jetons de l'ancienne palette prennent un préfixe `--v0-`. Ils
disparaîtront écran par écran ; le préfixe rend leur reste visible d'un coup
d'œil, et un test dira quand il n'en reste plus.

**Fichiers :**
- Modifier : le bloc `:root` de l ancienne palette et tout le bloc
  `<style>` (les usages)
- Créer : `test/skin-palettes.test.js`

**Interfaces :**
- Produit : les jetons `--v0-fond`, `--v0-releve`, `--v0-filet`, `--v0-bord`,
  `--v0-texte`, `--v0-attenue`, `--v0-arme`, `--v0-arme-encre`,
  `--v0-commande`, `--v0-commande-encre`, `--v0-alerte`, `--v0-ui`.
  Aucune tâche ultérieure ne doit en ajouter.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `test/skin-palettes.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// LES DEUX PALETTES COHABITENT PENDANT LA REFONTE, ET C EST LE PIEGE.
// L ancienne declare --fond a #0F1418 (sombre), la nouvelle a #E7EBE4 (clair
// papier). Toutes deux posees sur :root, la seconde ecrase la premiere et
// l application devient illisible -- sans une erreur, sans un avertissement,
// le CSS ne se plaint jamais d une redeclaration.
//
// L ancienne palette porte donc un prefixe --v0- le temps du chantier. Ce
// test garde les deux bouts: aucun jeton nu ne subsiste dans l ancien bloc,
// et le compte des --v0- ne remonte jamais.

const INDEX = path.join(__dirname, '..', 'desktop', 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');

// Les douze noms de l ancienne palette, sans prefixe.
const ANCIENS = [
  'fond', 'releve', 'filet', 'bord', 'texte', 'attenue',
  'arme', 'arme-encre', 'commande', 'commande-encre', 'alerte', 'ui',
];

test('aucun jeton de l ancienne palette ne subsiste sans prefixe', () => {
  const nus = ANCIENS.filter(
    (n) => new RegExp(`var\\(--${n}\\)`).test(html),
  );
  assert.deepStrictEqual(
    nus, [],
    `--${nus.join(', --')} entre en collision avec la nouvelle palette : `
    + 'renomme-les en --v0-...',
  );
});

test('les douze jetons prefixes sont declares', () => {
  for (const n of ANCIENS) {
    assert.ok(
      html.includes(`--v0-${n}:`),
      `--v0-${n} n est pas declare dans desktop/index.html`,
    );
  }
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```
npm test -- --test-name-pattern="ancienne palette"
```

Attendu : ÉCHEC, la liste des douze noms nus.

- [ ] **Étape 3 : renommer les douze jetons**

Dans le seul bloc `<style>` de `desktop/index.html` (lignes 4 à 882),
remplacer `--fond` par `--v0-fond`, et ainsi pour les onze autres, à la
déclaration comme à l'usage. Ajouter au-dessus de la déclaration :

```css
  /* PREFIXE TEMPORAIRE, LE TEMPS DE LA REFONTE. La nouvelle palette
     (skin/jetons.css) declare --fond et --ui elle aussi, avec des valeurs
     opposees: --fond y vaut le papier clair, ici le presque-noir. Les deux
     posees sur :root, la seconde gagne en silence et la page devient
     illisible. Ces douze jetons s effacent ecran par ecran; quand il n en
     reste plus un seul, le prefixe part avec eux.
     Garde: test/skin-palettes.test.js */
```

Attention : ne pas toucher à `--commande` dans la règle `:focus-visible`
(la règle `:focus-visible`) sans la renommer aussi — c'est le même jeton.

- [ ] **Étape 4 : lancer les tests et vérifier qu'ils passent**

```
npm test
```

Attendu : tout vert, y compris `skin-palettes`.

- [ ] **Étape 5 : recette à l'œil**

```
npm run banc
```

L'application doit être **exactement** telle qu'avant : même palette sombre,
mêmes panneaux. Un renommage incomplet se voit comme une zone qui perd sa
couleur.

- [ ] **Étape 6 : commit**

```
git add desktop/index.html test/skin-palettes.test.js
git commit -m "refonte(skin): l ancienne palette prend un prefixe, les deux peuvent cohabiter"
```

---

### Tâche 2 : Embarquer Outfit et Plus Jakarta Sans

La maquette appelle ses deux polices depuis Google Fonts. En production
c'est interdit : OMNI doit démarrer sans réseau.

Ce n'est pas une précaution théorique. Le commentaire de
`test/paquet-fichiers.test.js` raconte l'épisode : `index.html` est parti
chez les amis **sans ses polices**, et l'interface est retombée sur la police
système après une mise à jour — tous les tests verts, le code juste.

**Fichiers :**
- Créer : `desktop/polices/outfit.woff2`,
  `desktop/polices/plus-jakarta-sans.woff2`
- Modifier : `desktop/polices/LISEZMOI.md` (les licences)
- Créer : `test/skin-polices.test.js`

**Interfaces :**
- Produit : deux fichiers `.woff2` à graisse variable, chargés par
  `desktop/skin/jetons.css` (tâche 3) sous les familles `Outfit` et
  `Plus Jakarta Sans`.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `test/skin-polices.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// OMNI DOIT DEMARRER SANS RESEAU. Les maquettes de labo-omni/ appellent
// Outfit et Plus Jakarta Sans depuis Google Fonts; la production ne le peut
// pas. Ce test est le frere de paquet-fichiers.test.js, et il existe pour la
// meme raison: le jour ou index.html est parti chez les amis sans ses
// polices, l interface est retombee sur la police systeme apres une mise a
// jour, tous les tests verts et le code juste.

const DESKTOP = path.join(__dirname, '..', 'desktop');
const POLICES = path.join(DESKTOP, 'polices');

const ATTENDUES = ['outfit.woff2', 'plus-jakarta-sans.woff2'];

test('les deux polices du nouveau skin sont embarquees', () => {
  for (const f of ATTENDUES) {
    const chemin = path.join(POLICES, f);
    assert.ok(fs.existsSync(chemin), `desktop/polices/${f} manque`);
    assert.ok(
      fs.statSync(chemin).size > 4096,
      `desktop/polices/${f} fait moins de 4 Ko : fichier tronque ou page d erreur`,
    );
  }
});

// LA SECONDE MOITIE DE LA GARDE. Embarquer les fichiers ne sert a rien si
// une feuille continue d appeler l hote en ligne: la page se chargerait
// quand meme au bureau, et seulement chez l ami hors ligne elle tomberait.
test('aucune feuille de desktop n appelle une police en ligne', () => {
  const fautifs = [];
  const parcourir = (dossier) => {
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
      const p = path.join(dossier, e.name);
      if (e.isDirectory()) { parcourir(p); continue; }
      if (!/\.(html|css)$/.test(e.name)) continue;
      const texte = fs.readFileSync(p, 'utf8');
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(texte)) {
        fautifs.push(path.relative(DESKTOP, p));
      }
    }
  };
  parcourir(DESKTOP);
  assert.deepStrictEqual(
    fautifs, [],
    `${fautifs.join(', ')} appelle Google Fonts : embarque la police`,
  );
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```
npm test -- --test-name-pattern="polices du nouveau skin"
```

Attendu : ÉCHEC, `desktop/polices/outfit.woff2 manque`.

- [ ] **Étape 3 : récupérer les deux fichiers**

Les deux polices sont sous licence **SIL Open Font License 1.1**, qui
autorise l'embarquement. Vérifier la licence sur la fiche Google Fonts de
chacune **avant** de copier, et non après.

Google Fonts sert du `.woff2` quand l'agent utilisateur en annonce le
support, et il **découpe chaque police en sous-ensembles** : une réponse
`css2` contient plusieurs `@font-face`, un par plage de caractères.

**Prendre le premier est un piège.** Le premier est `latin-ext`, dont la
plage `U+0100-02BA` **exclut U+0000-00FF** — c'est-à-dire tout l'ASCII et
tous les accents français. Embarqué seul, il donnerait une police sans une
lettre. Le bon est celui qui déclare `U+0000-00FF` : le sous-ensemble
`latin`, qui couvre é è à ç ô û î ë ü, les guillemets « », l'apostrophe
typographique et le tiret cadratin. On sélectionne donc par la plage, pas
par le rang :

```sh
AG='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

for F in 'Outfit:wght@500..800' 'Plus+Jakarta+Sans:wght@400..700'; do
  curl -s -A "$AG" "https://fonts.googleapis.com/css2?family=$F" \
    | grep -B4 'U+0000-00FF' | grep -o 'https://[^)]*\.woff2'
done
```

Vérifié le 14/09, la commande rend exactement une URL par police. Puis :

```sh
curl -sL '<url-outfit>' -o desktop/polices/outfit.woff2
curl -sL '<url-jakarta>' -o desktop/polices/plus-jakarta-sans.woff2
```

Un seul sous-ensemble suffit : les deux familles déclarent une pile de
repli (`"Segoe UI", system-ui, sans-serif`), et un glyphe absent retombe
dessus au lieu de manquer.

Si le poste n'a pas accès au réseau, les deux fichiers sont aussi dans
`labo-omni/polices/` pour Karla — **mais pas ceux-là** : il faudra les
apporter à la main depuis un poste connecté. Ne pas inventer un substitut :
la maquette est dessinée sur ces deux polices précises.

- [ ] **Étape 4 : noter les licences**

Ajouter à `desktop/polices/LISEZMOI.md`, dans la forme déjà employée pour
Cal Sans et Karla, une entrée par police : nom, fonderie, licence OFL 1.1,
et la date de récupération.

- [ ] **Étape 5 : lancer les tests et vérifier qu'ils passent**

```
npm test
```

Attendu : tout vert. `paquet-fichiers` reste vert de lui-même —
`desktop/polices/` est déjà dans `DOSSIERS_DESKTOP`.

- [ ] **Étape 6 : commit**

```
git add desktop/polices/ test/skin-polices.test.js
git commit -m "refonte(skin): Outfit et Plus Jakarta Sans embarquees, OMNI demarre sans reseau"
```

---

### Tâche 3 : Les jetons et les deux thèmes

**Fichiers :**
- Créer : `desktop/skin/jetons.css`
- Modifier : `outils/faire-etape.js:31` (`DOSSIERS_DESKTOP`)
- Modifier : `desktop/index.html` (le `<link>`)
- Créer : `test/skin-jetons.test.js`

**Interfaces :**
- Produit : tous les jetons du §2 de `labo-omni/README.md`, plus `--olive`
  et `--rail-icone`. **Pas les `--dehors*`** : ce sont les couleurs de la
  page qui entoure la maquette dans le labo, et l'application n'a pas de
  page autour d'elle. Les familles `var(--ui)` (Plus Jakarta Sans)
  et `var(--titre)` (Outfit). Toute tâche ultérieure lit ces noms et n'en
  déclare aucun.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `test/skin-jetons.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// UN JETON EMPLOYE MAIS JAMAIS DECLARE NE FAIT PAS D ERREUR: var(--truc)
// sans repli rend la propriete invalide, et l element retombe sur sa valeur
// heritee. Un fond disparait, un texte passe en noir sur noir, et rien --
// ni le navigateur, ni les tests -- ne dit pourquoi.
//
// Ce test relie les deux bouts: tout var(--x) ecrit dans desktop/skin/ doit
// trouver son --x: declare dans jetons.css.

const SKIN = path.join(__dirname, '..', 'desktop', 'skin');
const JETONS = path.join(SKIN, 'jetons.css');

const declares = () => {
  const src = fs.readFileSync(JETONS, 'utf8');
  return new Set([...src.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
};

test('jetons.css declare les deux themes', () => {
  const src = fs.readFileSync(JETONS, 'utf8');
  assert.ok(src.includes('[data-theme="sombre"]'), 'le theme sombre manque');
  assert.ok(
    src.includes('prefers-color-scheme'),
    'le suivi du theme de Windows manque : sans lui, le defaut ne suit rien',
  );
});

test('tout jeton employe dans skin/ est declare dans jetons.css', () => {
  const connus = declares();
  const inconnus = new Set();
  for (const f of fs.readdirSync(SKIN)) {
    if (!f.endsWith('.css')) continue;
    const src = fs.readFileSync(path.join(SKIN, f), 'utf8');
    for (const m of src.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
      if (!connus.has(m[1])) inconnus.add(`${f} : ${m[1]}`);
    }
  }
  assert.deepStrictEqual([...inconnus], []);
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```
npm test -- --test-name-pattern="jetons"
```

Attendu : ÉCHEC, `ENOENT` sur `desktop/skin/jetons.css`.

- [ ] **Étape 3 : écrire `desktop/skin/jetons.css`**

Les valeurs sont celles de `labo-omni/app.html:26-49`, recopiées sans en
changer une. Le troisième bloc est l'ajout de la production : le README range
« le thème par défaut (suivre Windows) » dans ce qui n'est pas dessiné.

```css
/* ============================================================
   LES JETONS DU NOUVEAU SKIN.
   Valeurs recopiees de labo-omni/app.html, qui fait foi (§7 du
   README du labo: en cas de doute, la maquette a raison).

   `--encre` ne veut pas dire « noir »: il veut dire LE CONTRAIRE
   DU FOND. En clair il est noir, en sombre il est creme. C est ce
   seul basculement qui retourne toute l app, et c est pour ca que
   la regle survit au changement de theme:

     la carte qui TRANCHE avec le fond, c est celle qui te reclame.

   Le jaune, lui, ne bouge pas: c est la marque.

   `--encre` et `--alarme` ont la MEME valeur et PAS le meme metier:
   l un ecrit, l autre inverse une surface. Ne pas les fusionner --
   c est ce qui permet de compter les blocs inverses a l ecran, et
   leur nombre est le nombre de choses a faire.
   ============================================================ */

/* Polices EMBARQUEES, jamais appelees en ligne: OMNI doit demarrer
   sans reseau. Voir desktop/polices/LISEZMOI.md pour les licences.
   Garde: test/skin-polices.test.js */
@font-face {
  font-family: 'Outfit';
  src: url('../polices/outfit.woff2') format('woff2');
  font-weight: 500 800; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Plus Jakarta Sans';
  src: url('../polices/plus-jakarta-sans.woff2') format('woff2');
  font-weight: 400 700; font-style: normal; font-display: swap;
}

/* ---- LE THEME CLAIR, et le socle des deux ---- */
:root {
  --fond: #E7EBE4; --carte: #F6F7F3; --carte-creuse: #EDEFE9;
  --encre: #16181A; --encre-douce: #5C6360;
  --alarme: #16181A; --sur-alarme: #F6F7F3;
  --olive: #5C6644; --rail-icone: #7C837A;
  --trait: #D8DCD3; --trait-fort: #B9BFB4;
  --contre-doux: #A9AFA7; --contre-creux: #25282B; --contre-trait: #333739;
  --acide: #E2F27C; --acide-sur-contre: #E2F27C;
  --sur-acide: #16181A; --sur-acide-contre: #16181A;
  --inter-off: #CDD3C7; --inter-bouton: #F6F7F3;
  --rail: #16181A;
  --ui: "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif;
  --titre: "Outfit", "Plus Jakarta Sans", system-ui, sans-serif;
}

/* ---- LE THEME SOMBRE, ecrit une fois, pose deux fois ----
   Les memes declarations valent dans les deux blocs qui suivent. Les
   ecrire en double est voulu: une variable CSS ne se factorise pas
   entre un @media et un selecteur d attribut sans une troisieme
   indirection qui coute plus cher a relire que la repetition. */

/* 1. SUIVRE WINDOWS, tant que l ami n a rien choisi. Electron sert
      prefers-color-scheme depuis le theme du systeme: pas un canal
      IPC a ecrire, pas un reglage a ranger. Le `:not` laisse gagner
      le choix explicite. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="clair"]) {
    --fond: #14171A; --carte: #1D2124; --carte-creuse: #262B2F;
    --encre: #EFF2EC; --encre-douce: #9AA298;
    --alarme: #EFF2EC; --sur-alarme: #1D2124;
    --trait: #2E3438; --trait-fort: #3B4348;
    --contre-doux: #5E6660; --contre-creux: #DDE2D8; --contre-trait: #C6CDC0;
    --acide: #E2F27C; --acide-sur-contre: #16181A;
    --sur-acide: #16181A; --sur-acide-contre: #EFF2EC;
    --inter-off: #3B4348; --inter-bouton: #8E958C;
    --rail: #0B0D0F;
  }
}

/* 2. LE CHOIX EXPLICITE, qui gagne dans les DEUX sens: sombre sur un
      Windows clair autant que clair sur un Windows sombre. */
:root[data-theme="sombre"] {
  --fond: #14171A; --carte: #1D2124; --carte-creuse: #262B2F;
  --encre: #EFF2EC; --encre-douce: #9AA298;
  --alarme: #EFF2EC; --sur-alarme: #1D2124;
  --trait: #2E3438; --trait-fort: #3B4348;
  --contre-doux: #5E6660; --contre-creux: #DDE2D8; --contre-trait: #C6CDC0;
  --acide: #E2F27C; --acide-sur-contre: #16181A;
  --sur-acide: #16181A; --sur-acide-contre: #EFF2EC;
  --inter-off: #3B4348; --inter-bouton: #8E958C;
  --rail: #0B0D0F;
}
```

- [ ] **Étape 4 : lier la feuille et l'emporter dans le paquet**

Dans `desktop/index.html`, juste avant le `<style>` existant :

```html
<link rel="stylesheet" href="skin/jetons.css">
```

Dans `outils/faire-etape.js`, la constante `DOSSIERS_DESKTOP` :

```js
const DOSSIERS_DESKTOP = ['polices', 'sons', 'skin'];
```

Sans cette ligne, `desktop/skin/` **ne part pas chez les amis**, sans erreur
et sans avertissement. `test/paquet-fichiers.test.js` est justement là pour
le dire : le laisser échouer d'abord, puis corriger, est la bonne façon de
vérifier qu'il veille.

- [ ] **Étape 5 : rendre le banc sensible aux nouveaux fichiers**

`creerServeur()` dans `outils/interface-locale.js` ne surveille que `desktop/index.html` et
`outils/faux-etat.js`, sous le commentaire « les deux fichiers qui changent
pendant une séance de mise en page ». Cette phrase devient fausse à la
seconde où le CSS part dans `skin/` : on modifierait `jetons.css` sans que
la page se recharge — et le banc perd précisément son intérêt pour le
chantier qui en a le plus besoin.

Remplacer le watch d'`index.html` par un watch récursif du dossier servi :

```js
  // Tout ce qui change pendant une seance de mise en page, et non plus le
  // seul index.html: la refonte repartit la page entre skin/*.css et
  // vues/*.js, et surveiller un seul fichier laisserait le banc muet sur
  // les deux tiers du travail. Un watch recursif couvre aussi les dossiers
  // qui n existent pas encore.
  for (const cible of [RACINE, path.join(__dirname, 'faux-etat.js')]) {
    try {
      const veilleur = cible === RACINE
        ? fs.watch(cible, { recursive: true }, () => diffuseur.signaler())
        : fs.watch(cible, () => diffuseur.signaler());
      veilleur.unref();
    } catch (e) {
      console.warn(`[banc] surveillance impossible : ${cible}`);
    }
  }
```

- [ ] **Étape 6 : lancer les tests et vérifier qu'ils passent**

```
npm test
```

Attendu : tout vert, `skin-jetons` et `paquet-fichiers` compris. Les trois
tests `interface-locale-*` doivent rester verts : le serveur change de
surveillance, pas de contrat.

- [ ] **Étape 7 : recette à l'œil**

```
npm run banc
```

L'application ne doit **pas** avoir changé d'aspect : les nouveaux jetons
sont déclarés mais personne ne les emploie encore. Si quelque chose bouge,
c'est qu'un jeton `--v0-` a été oublié à la tâche 1.

- [ ] **Étape 8 : commit**

```
git add desktop/skin/jetons.css desktop/index.html outils/faire-etape.js outils/interface-locale.js test/skin-jetons.test.js
git commit -m "refonte(skin): les jetons des deux themes, et le defaut suit Windows"
```

---

### Tâche 4 : Les briques de la maquette

**Fichiers :**
- Créer : `desktop/skin/briques.css`
- Modifier : `desktop/index.html` (le `<link>`)

**Interfaces :**
- Consomme : les jetons de `skin/jetons.css` (tâche 3).
- Produit : les classes `.fenetre`, `.rail`, `.corps`, `.haut`, `.fant`,
  `.fenetre-bt`, `.vue`, `.vue.actif`, `.titre`, `.marqueur`, `.tuile`,
  `.pastille-etat`, `.jeton`, `.capsule`, `.bt-jaune`, `.bt-noir`,
  `.bt-vide`, `.a-picto`, `.sans-pic`. Les écrans des étapes suivantes
  s'appuient dessus et n'en redéfinissent aucune.
- **Ne produit pas** `.inter`, `.cabochon`, `.bt-mini`, `.perso`, `.pips` :
  la maquette les range dans ses sections d'écran, hors des plages
  reprises ici. Chacune arrivera avec la tâche qui la porte — `.inter`
  à la tâche 8, les autres à l'étape Raccourcis.

- [ ] **Étape 1 : recopier les briques depuis la maquette**

La maquette sectionne déjà sa propre feuille, et les bornes sont nettes.
Créer `desktop/skin/briques.css` en reprenant **exactement ces quatre
morceaux** de `labo-omni/app.html`, dans cet ordre :

| Lignes | Section | Ce que c'est |
|---|---|---|
| 51 | — | `*{box-sizing:border-box}`, le seul reset à garder |
| 62-101 | `coquille` | `.fenetre`, `.rail`, `.corps`, `.haut`, `.fant`, `.fenetre-bt`, `.vue`, `.titre` |
| 102-183 | `briques` | `.tuiles`, `.tuile`, `.inter`, `.pastille-etat`, `.cabochon`, `.jeton`, `.bt-*`, `.capsule`, `.marqueur` |
| 329-364 | pictos | la règle `.a-picto` / `.sans-pic`, **commentaire compris** |

Et **ne pas reprendre** les lignes 184-328 : ce sont les sections `1. la
flotte`, `4. archimonstres`, `5. raccourcis` et `6. reglages`, propres à un
écran chacune. Elles entreront dans `ecrans.css` à l'étape de leur écran ;
les amener maintenant chargerait la feuille de règles que rien ne porte
encore, et on ne saurait plus, à chaque étape, ce qui reste à faire.

Dans ce qu'on reprend, trois retraits, et leur raison :

1. `body`, `a.retour`, `.aide` (lignes 52-60) et tout usage de `--dehors*` :
   ce sont les **habits de la page de labo**, pas de l'application. La
   fenêtre d'OMNI n'a pas de page autour d'elle. `jetons.css` ne déclare
   d'ailleurs aucun `--dehors` — si l'un traîne, le test de la tâche 3 le
   dira.
2. La règle `.armer` (dans la section `coquille`) : le README le dit au §3,
   le bouton « OMNI est armé » n'existe plus ; ses règles traînent dans la
   maquette, à ignorer.
3. `.fenetre { box-shadow }` et `border-radius: 22px` : la maquette dessine
   une fenêtre posée sur une page. En production, la fenêtre **est** la
   fenêtre.

Et une correction, qui n'est pas un retrait : **`.fenetre` ne garde pas ses
1097 × 720 en dur.** La maquette les fixe parce qu'elle simule la fenêtre au
milieu d'une page. En production, `body` est déjà une colonne flex de
`100vh` (la règle `body {` du bloc `<style>`) et la `.barre-nav` vient **sous** `.fenetre` :
une hauteur figée de 720 px plus la barre déborderait d'une fenêtre qui fait
exactement 720 px, et le bas serait coupé.

```css
/* La maquette fige 1097x720 parce qu elle pose la fenetre au milieu d une
   page. Ici la fenetre EST la fenetre: elle prend ce que le body lui
   laisse, et la barre du bas prend le reste de la colonne. `min-height: 0`
   n est pas decoratif -- sans lui, un enfant flex refuse de retrecir sous
   sa taille de contenu et c est le defilement interne qui disparait. */
.fenetre {
  flex: 1; min-height: 0; width: 100%;
  background: var(--fond); overflow: hidden;
  display: flex; gap: 14px; padding: 14px;
}
```

Reprendre en revanche telle quelle la règle des pictos
(`labo-omni/app.html:331-351`), commentaire compris : c'est elle qui fait
qu'un picto DofusDB absent rend la main au dessin OMNI.

- [ ] **Étape 2 : lier la feuille**

Dans `desktop/index.html`, après le lien des jetons :

```html
<link rel="stylesheet" href="skin/briques.css">
```

- [ ] **Étape 3 : lancer les tests et vérifier qu'ils passent**

```
npm test
```

Attendu : tout vert. En particulier `skin-jetons`, qui échouerait si une
brique employait un jeton non déclaré — typiquement un `--dehors` oublié au
retrait n° 1.

- [ ] **Étape 4 : recette à l'œil**

```
npm run banc
```

L'aspect ne doit toujours pas changer : aucune de ces classes n'est encore
posée sur un élément. Le seul risque est qu'un sélecteur d'élément nu
(`button`, `*`) ait été recopié par mégarde et morde sur l'existant.

- [ ] **Étape 5 : commit**

```
git add desktop/skin/briques.css desktop/index.html
git commit -m "refonte(skin): les briques communes, sans les habits de la page de labo"
```

---

### Tâche 5 : L'ossature — le rail, la barre du haut, les cinq vues

C'est la tâche qui change l'aspect. La `.barre-titre` d'aujourd'hui laisse
la place au rail et à la barre du haut ; la liste actuelle (`.defile`) est
**déplacée telle quelle** dans `#v-raccourcis`, encore habillée par
l'ancienne feuille. Les panneaux modaux restent modaux jusqu'à leur étape.

**Fichiers :**
- Modifier : le balisage du `<body>`
- Créer : `test/skin-ossature.test.js`

**Interfaces :**
- Produit : `.rail button[data-vue]` pour les cinq valeurs `raccourcis`,
  `courses`, `hotel`, `archi`, `reglages` ; les conteneurs `#v-raccourcis`,
  `#v-courses`, `#v-hotel`, `#v-archi`, `#v-reglages` ; le bouton de thème
  `#btTheme`. `desktop/vues/rail.js` (tâche 6) s'y raccroche.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `test/skin-ossature.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// UN BOUTON DE RAIL SANS SA VUE NE FAIT RIEN. Le rail commute en posant
// `actif` sur `#v-<data-vue>`; si l element n existe pas, le clic retire
// l ecran courant et n en montre aucun -- la fenetre devient vide, et la
// seule trace est un TypeError dans une console que la production n ouvre
// pas (devTools: false, main.js:928).

const INDEX = path.join(__dirname, '..', 'desktop', 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');

const VUES = ['raccourcis', 'courses', 'hotel', 'archi', 'reglages'];

// LA PAGE PORTE DES data-vue QUI NE SONT PAS CEUX DU RAIL: le selecteur
// segmente de l ecran Archimonstres en a deux, `liste` et `zones`
// (la paire `data-vue="liste"` / `data-vue="zones"`). Balayer la page entiere les ramasserait et ferait
// echouer ce test sur du balisage juste. On se borne donc au bloc du rail.
const blocRail = () => {
  const d = html.indexOf('<div class="rail"');
  assert.notStrictEqual(d, -1, 'le rail est introuvable');
  const f = html.indexOf('<div class="corps"', d);
  assert.notStrictEqual(f, -1, 'le corps ne suit plus le rail');
  return html.slice(d, f);
};

test('les cinq boutons du rail sont la, dans l ordre de la maquette', () => {
  const trouves = [...blocRail().matchAll(/data-vue="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(trouves, VUES);
});

test('chaque bouton du rail a sa vue', () => {
  const sans = VUES.filter((v) => !html.includes(`id="v-${v}"`));
  assert.deepStrictEqual(sans, [], `vue absente pour : ${sans.join(', ')}`);
});

// LE `no-drag` N EST PAS DECORATIF. `.haut` est `-webkit-app-region: drag`
// comme l etait `.barre-titre`: sans no-drag sur ce qui s y clique, Windows
// avale le clic comme un deplacement de fenetre et le bouton ne fait RIEN,
// sans le moindre message. Le piege est ecrit en toutes lettres a
// tete de la regle .version-lien du bloc <style> depuis qu il a coute une soiree.
test('tout ce qui se clique dans la barre du haut est no-drag', () => {
  const debut = html.indexOf('<div class="haut"');
  assert.notStrictEqual(debut, -1, 'la barre du haut est introuvable');
  // La barre s arrete au premier `<div class="avis"`, qui la suit
  // immediatement dans l ossature. Borne par un REPERE du balisage et non
  // par un comptage de balises: un `</div>` se compte mal a la regex, et un
  // test qui se trompe de fin garderait la mauvaise zone.
  const fin = html.indexOf('<div class="avis"', debut);
  assert.notStrictEqual(fin, -1, 'les bandeaux ne suivent plus la barre du haut');
  const bloc = html.slice(debut, fin);

  // LA REGLE EST: CHAQUE BOUTON PORTE no-drag DANS SA PROPRE BALISE.
  // On pourrait le poser sur un parent et laisser hériter -- Windows
  // l accepte -- mais alors ce test devrait deviner l imbrication a la
  // regex, et un test qui devine garde mal. La regle stricte coute un
  // attribut repete et se verifie en trois lignes.
  const balises = bloc.match(/<button[^>]*>/g) || [];
  assert.ok(
    balises.length >= 4,
    'la barre du haut doit porter version, theme, reduire et fermer',
  );
  const nus = balises.filter((b) => !b.includes('no-drag'));
  assert.deepStrictEqual(
    nus, [],
    'bouton sans no-drag dans la barre du haut : sous Windows, la zone de '
    + 'deplacement avale le clic et le bouton ne fait RIEN, sans un message',
  );
});

// Le banc injecte `<script src="/faux-app.js"></script>` AVANT le premier
// <script> de la page, retrouve par recherche et non par numero de ligne.
// Sans point d accroche, l injection tombe et le banc sert une page morte.
test('la page garde un point d accroche pour l injection du banc', () => {
  assert.ok(html.includes('<script'), 'plus un seul <script> dans la page');
});

// UN SIGNAL QUI S ETEINT SANS BRUIT. le script bascule `retard` sur
// #versionBouton quand le depot a avance, et la SEULE regle qui le dessine
// est `.version-lien.retard`. Changer la classe du bouton pour `fant` seule
// n aurait casse ni le clic, ni l affichage, ni un test: le bouton aurait
// simplement cesse, pour toujours, de dire qu il y a du retard.
test('le bouton de version garde la classe qui porte son etat', () => {
  const balise = html.match(/<button[^>]*id="versionBouton"[^>]*>/);
  assert.notStrictEqual(balise, null, '#versionBouton a disparu de la page');
  assert.ok(
    balise[0].includes('version-lien'),
    'le bouton de version doit garder la classe version-lien tant que la regle '
    + '.version-lien.retard vit dans l ancienne feuille',
  );
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```
npm test -- --test-name-pattern="rail"
```

Attendu : ÉCHEC, `data-vue` introuvable.

- [ ] **Étape 3 : poser l'ossature**

**Ce n'est pas un remplacement, c'est une restructuration du `<body>`
entier.** Aujourd'hui il aligne sept blocs frères ; demain il en aligne
deux. Le tableau dit où va chacun — repérer chaque bloc par sa chaîne
d'ouverture, jamais par un numéro de ligne :

| Bloc actuel (repère) | Devient |
|---|---|
| `<div class="barre-titre">` | **supprimé** — le rail et `.haut` le remplacent |
| `<div class="avis" id="erreur">` et `id="sansmaitre"` | déplacés dans `.corps`, entre `.haut` et la première `.vue` |
| `<div class="defile">` | déplacé **tel quel** dans `#v-raccourcis` |
| `<div class="quoi-de-neuf" id="quoiDeNeuf">` | déplacé dans `.corps`, après les cinq `.vue` |
| les quatre `<div class="vue-archi" id="…">` | idem, après les cinq `.vue` |
| `<div class="barre-nav">` | **ne bouge pas**, reste dernier enfant du `body` |
| `<script>` | ne bouge pas |

Aucun de ces blocs n'est réécrit : ils sont **déplacés**, avec leurs
attributs, leurs `id` et leurs commentaires. Le JavaScript les retrouve par
`getElementById`, que le déplacement ne gêne pas.

Le balisage neuf — le rail et la barre du haut — vient de
`labo-omni/app.html:371-419` (ce fichier-là ne bouge pas, ses numéros
tiennent), avec quatre changements de production :

```html
<div class="fenetre">

  <div class="rail">
    <span class="logo">
      <svg width="32" height="32" viewBox="0 0 48 48" aria-label="OMNI">
        <g transform="translate(4.66,0) skewX(-11)" stroke-width="8.4"
           stroke-linecap="round" class="marque">
          <line x1="6.5" y1="18.5" x2="6.5" y2="29.5"/>
          <line x1="18.2" y1="10.5" x2="18.2" y2="37.5"/>
          <line x1="29.8" y1="10.5" x2="29.8" y2="37.5" class="pupille"/>
          <line x1="41.5" y1="18.5" x2="41.5" y2="29.5"/>
        </g>
      </svg>
    </span>
    <!-- Les pictos du rail restent des dessins OMNI: le README du labo le
         dit au §2, le dessin maison ne reste que la ou aucun picto du jeu
         ne dit la chose -- Raccourcis, Reglages, l icone de l app. -->
    <button class="actif" data-vue="raccourcis" title="Raccourcis">…</button>
    <!-- COURSES N A PAS DE FONCTION DERRIERE. La maquette le dit elle-meme:
         son ecran Reglages marque le droit « courses » a non, avec la phrase
         « Les courses en hotel de vente arriveront dans une prochaine
         version ». Le bouton est la, desarme, pour que la place existe. -->
    <button data-vue="courses" title="Courses — prochaine version" disabled>…</button>
    <button data-vue="hotel" title="Hôtel de vente">…</button>
    <button data-vue="archi" title="Archimonstres">…</button>
    <button class="pousse" data-vue="reglages" title="Réglages">…</button>
  </div>

  <div class="corps">

    <!-- `.haut` REMPLACE `.barre-titre` COMME ZONE DE DEPLACEMENT: la
         fenetre est sans cadre systeme, il faut bien une bande a saisir.
         Chaque chose qui s y clique porte no-drag, sinon Windows avale le
         clic. Garde: test/skin-ossature.test.js -->
    <div class="haut" style="-webkit-app-region: drag">
      <!-- `version-lien` EST GARDEE A COTE DE `fant`, ET CE N EST PAS UN
           RESTE. le script bascule la classe `retard` sur ce bouton
           quand le depot a avance, et la seule regle qui la dessine est
           `.version-lien.retard` (l. 126). Retirer `version-lien` ferait
           disparaitre le signal: le bouton continuerait de s afficher, de
           s ouvrir, et ne dirait simplement plus jamais qu il y a du
           retard. Elle part a l etape Reglages, avec sa regle.
           Garde: test/skin-ossature.test.js -->
      <button class="fant version-lien" id="versionBouton"
              style="-webkit-app-region: no-drag"
              title="Voir ce qui a changé"></button>
      <span class="fant" id="titreEtat"></span>
      <button class="fant theme" id="btTheme" style="-webkit-app-region: no-drag"
              title="Changer de thème">…</button>
      <span class="fenetre-bt">
        <button id="reduire" style="-webkit-app-region: no-drag" title="Réduire">…</button>
        <button id="fermer" class="fermer" style="-webkit-app-region: no-drag"
                title="Fermer">…</button>
      </span>
    </div>

    <!-- LES BANDEAUX POUSSENT, ILS NE RECOUVRENT PAS. Regle du §6 du README
         du labo, qui ne les dessine pas: une surface inversee posee entre la
         barre du haut et l ecran, qui repousse l ecran vers le bas et ne
         cache jamais une donnee. -->
    <div class="avis" id="erreur"></div>
    <div class="avis" id="sansmaitre"></div>

    <div class="vue actif" id="v-raccourcis">
      <!-- La liste d aujourd hui, deplacee telle quelle. Elle garde
           l ancienne feuille jusqu a l etape 1 du chantier. -->
      <div class="defile">…</div>
    </div>

    <div class="vue" id="v-courses"></div>
    <div class="vue" id="v-hotel"></div>
    <div class="vue" id="v-archi"></div>
    <div class="vue" id="v-reglages"></div>

  </div>
</div>
```

Les `…` sont les SVG et le contenu existants, recopiés sans changement :
prendre les pictos du rail et du thème dans `labo-omni/app.html:383-418`, les
deux boutons de fenêtre sur les lignes `id="reduire"` et `id="fermer"` de la `.barre-titre` que tu remplaces.

**Les cinq panneaux modaux doivent être recalés, et c'est le piège de cette
tâche.** `#quoiDeNeuf` et les quatre `.vue-archi` sont
`position: absolute; inset: 38px 0 0 0` (les règles `.quoi-de-neuf {` et `.vue-archi {` du bloc `<style>`) — et ces 38 px
sont **exactement la hauteur de la `.barre-titre`** que cette tâche
supprime. Aucun ancêtre n'étant positionné, ils se calent aujourd'hui sur le
bloc conteneur initial ; laissés tels quels, ils recouvriraient le rail et
une partie de la barre du haut.

Les déplacer **dans `.corps`**, après les cinq `.vue`, et corriger les deux
règles :

```css
  /* Les panneaux se calaient sous la `.barre-titre` par un inset de 38px --
     sa hauteur exacte. La barre n existe plus, mais `.haut` est le PREMIER
     enfant de `.corps` (36px, plus le gap de 13px entre enfants de .corps:
     desktop/skin/briques.css): un `inset: 0` couvrirait donc `.haut` lui
     meme, pas seulement le rail. Les panneaux se calent desormais a 49px du
     haut de `.corps` -- juste sous la barre -- et couvrent l aire des
     ecrans sans mordre sur le rail ni sur la barre du haut. Ils finiront
     chacun en `.vue`; ce recalage les met deja a leur place. */
  .corps { position: relative; }
  .quoi-de-neuf, .vue-archi { position: absolute; inset: 49px 0 0 0; z-index: 20; }
```

La `.barre-nav` **ne bouge pas** : elle reste après `.fenetre`, en dernier
enfant du `body` en colonne, jusqu'à la tâche 8 qui la rhabille.

Un effet de bord, assumé et à ne pas prendre pour un bug à la recette :
aujourd'hui les panneaux descendent jusqu'en bas de la fenêtre et **couvrent
la barre du bas** ; bornés à `.corps`, ils la laisseront visible. C'est
cohérent avec ce que dit le commentaire de `#pepAvance` dans la `.barre-nav` — l'avancement de la passe de
marché est posé dans cette barre, et non dans le panneau, précisément pour
rester lisible.

- [ ] **Étape 4 : lancer les tests et vérifier qu'ils passent**

```
npm test
```

Attendu : tout vert. `pont-ipc` doit rester vert — il relève les appels
`window.app.<nom>` et aucun n'a été retiré. S'il rougit, c'est qu'un bouton a
perdu son `id` au passage.

- [ ] **Étape 5 : recette à l'œil**

```
npm run banc
```

Le rail doit apparaître à gauche, la liste des personnages dans le premier
écran. Les quatre autres écrans sont vides — c'est voulu. Vérifier que la
liste répond encore : cocher une case doit rester coché.

- [ ] **Étape 6 : commit**

```
git add desktop/index.html test/skin-ossature.test.js
git commit -m "refonte(skin): le rail, la barre du haut et les cinq ecrans remplacent la barre de titre"
```

---

### Tâche 6 : Le rail vivant — navigation et thème

Le premier module ES du dépôt. La sonde du 14/09 a vérifié qu'un
`<script type="module">` avec un `import` relatif s'exécute bien dans un
renderer `sandbox: true` chargé par `loadFile` — c'est le cas exact de la
production.

**Fichiers :**
- Créer : `desktop/vues/rail.js`
- Modifier : `outils/faire-etape.js:31` (`DOSSIERS_DESKTOP`)
- Modifier : `desktop/index.html` (la balise de chargement)
- Créer : `test/skin-rail.test.js`

**Interfaces :**
- Consomme : `.rail button[data-vue]`, `#v-*`, `#btTheme` (tâche 5).
- Produit : `export function monterRail()`, appelée au chargement. Aucun
  autre module ne l'importe ; les écrans des étapes suivantes exportent
  chacun leur `monter<Ecran>()` sur le même modèle.

- [ ] **Étape 1 : écrire le test qui échoue**

Créer `test/skin-rail.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Assertion sur le SOURCE, comme pepites-panneau et pda-archi-panneau: le
// chemin concerne demanderait un vrai navigateur.

const RACINE = path.join(__dirname, '..');
const rail = fs.readFileSync(path.join(RACINE, 'desktop', 'vues', 'rail.js'), 'utf8');
const html = fs.readFileSync(path.join(RACINE, 'desktop', 'index.html'), 'utf8');
const etape = fs.readFileSync(path.join(RACINE, 'outils', 'faire-etape.js'), 'utf8');

// DEUX FAITS VERIFIES SEPAREMENT, et non par une seule regex. Le module est
// charge par un <script type="module"> EN LIGNE qui fait l import: le chemin
// n est donc pas dans la balise ouvrante, et une regex qui l y chercherait
// echouerait sur du code juste.
test('le rail est charge comme module', () => {
  assert.ok(
    html.includes('<script type="module">'),
    'rail.js doit etre charge en type="module" : en script classique, ses '
    + 'declarations de premier niveau entreraient en collision avec celles '
    + 'de faux-app.js sur le banc -- le piege raconte en tete de ce fichier-la',
  );
  assert.ok(
    html.includes('vues/rail.js'),
    'la page ne charge jamais vues/rail.js : le rail ne commutera pas',
  );
});

test('vues/ part chez les amis', () => {
  assert.ok(
    /DOSSIERS_DESKTOP\s*=\s*\[[^\]]*'vues'/.test(etape),
    "desktop/vues/ n est pas dans DOSSIERS_DESKTOP : le rail ne partira pas, "
    + 'et la fenetre arrivera sans navigation',
  );
});

// LE CHOIX DE L AMI SURVIT A LA FERMETURE, ET L ABSENCE DE CHOIX SUIT
// WINDOWS. Les deux moities comptent: retenir sans defaut donne un clair
// force au premier lancement, suivre sans retenir fait oublier le choix a
// chaque demarrage.
test('le theme est retenu, et le defaut ne force rien', () => {
  assert.ok(rail.includes('localStorage'), 'le choix de theme n est pas retenu');
  assert.ok(
    rail.includes('removeAttribute'),
    'sans retrait de l attribut, on ne peut jamais revenir a « suivre Windows » : '
    + 'tant qu un data-theme est pose, prefers-color-scheme ne dit plus rien',
  );
});

// LIRE localStorage PEUT LEVER. Fenetre privee, donnees de site effacees,
// stockage bloque: l accesseur jette au lieu de rendre null. Sans garde, le
// module meurt a la premiere ligne de son montage et le rail ne commute
// plus -- la fenetre garde son premier ecran, pour toujours, en silence.
test('la lecture du theme est gardee', () => {
  const i = rail.indexOf('localStorage.getItem');
  assert.notStrictEqual(i, -1, 'le theme ne se relit jamais');
  const autour = rail.slice(Math.max(0, i - 400), i);
  assert.ok(
    autour.includes('try {'),
    'localStorage.getItem doit etre dans un try : il leve en fenetre privee',
  );
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```
npm test -- --test-name-pattern="rail est charge"
```

Attendu : ÉCHEC, `ENOENT` sur `desktop/vues/rail.js`.

- [ ] **Étape 3 : écrire `desktop/vues/rail.js`**

```js
// LA NAVIGATION ET LE THEME. Premier module ES du depot: verifie le 14/09
// par une sonde Electron 43 qu un <script type="module"> avec import relatif
// s execute bien dans un renderer sandboxe charge par loadFile -- le cas
// exact de la production (desktop/main.js:954).
//
// Etre un module n est pas cosmetique: chaque module a SA portee. Le
// commentaire en tete de outils/faux-app.js raconte ce que coutait la portee
// partagee -- une seconde declaration de COLONNES au premier niveau, et tout
// le script de la page ne s executait JAMAIS: l ossature s affichait, sans
// une ligne, sans un mot ailleurs que dans une console que la production
// n ouvre pas.

const CLE_THEME = 'omni.theme';

// Les trois etats du theme, et pourquoi il en faut trois:
//   null     -> suivre Windows (aucun attribut, prefers-color-scheme decide)
//   'sombre' -> sombre impose, meme sur un Windows clair
//   'clair'  -> clair impose, meme sur un Windows sombre
// Deux etats ne suffiraient pas: on ne pourrait plus revenir a « suivre ».
const CYCLE = [null, 'sombre', 'clair'];

const MOT = { null: 'Système', sombre: 'Sombre', clair: 'Clair' };

function lireTheme() {
  // localStorage peut lever ou revenir vide -- fenetre privee, donnees de
  // site effacees. Un theme oubliable ne vaut pas une page blanche.
  try {
    const v = localStorage.getItem(CLE_THEME);
    return CYCLE.includes(v) ? v : null;
  } catch (e) {
    return null;
  }
}

function poserTheme(valeur) {
  const racine = document.documentElement;
  // Le RETRAIT est ce qui rend « suivre Windows » possible: tant qu un
  // attribut est pose, la requete de media ne peut plus rien dire.
  if (valeur === null) racine.removeAttribute('data-theme');
  else racine.setAttribute('data-theme', valeur);

  const mot = document.getElementById('motTheme');
  if (mot !== null) mot.textContent = MOT[String(valeur)];

  try {
    if (valeur === null) localStorage.removeItem(CLE_THEME);
    else localStorage.setItem(CLE_THEME, valeur);
  } catch (e) {
    // Le theme est pose a l ecran; ne pas pouvoir le retenir n est pas
    // une raison d interrompre le montage de la page.
  }
}

function montrer(nom) {
  for (const b of document.querySelectorAll('.rail button[data-vue]')) {
    b.classList.toggle('actif', b.dataset.vue === nom);
  }
  for (const v of document.querySelectorAll('.vue')) {
    v.classList.toggle('actif', v.id === `v-${nom}`);
  }
}

export function monterRail() {
  poserTheme(lireTheme());

  for (const b of document.querySelectorAll('.rail button[data-vue]')) {
    // `disabled` suffit a Windows, mais pas a un clic simule: la garde
    // explicite evite d ouvrir un ecran vide sur Courses.
    b.addEventListener('click', () => {
      if (b.disabled) return;
      montrer(b.dataset.vue);
    });
  }

  const bt = document.getElementById('btTheme');
  if (bt !== null) {
    bt.addEventListener('click', () => {
      const i = CYCLE.indexOf(lireTheme());
      poserTheme(CYCLE[(i + 1) % CYCLE.length]);
    });
  }
}
```

- [ ] **Étape 4 : charger le module et l'emporter dans le paquet**

Dans `desktop/index.html`, **après** le `<script>` classique existant (pour
que le point d'accroche du banc reste le premier) :

```html
<script type="module">
  import { monterRail } from './vues/rail.js';
  monterRail();
</script>
```

Le libellé du bouton de thème s'appelle **`motTheme`**, et il n'y en a
qu'un. La maquette nomme le sien `libTheme` (`labo-omni/app.html:414`) :
si la tâche 5 l'a recopié tel quel, le **renommer**, et surtout ne pas
ajouter un second libellé à côté — le bouton en afficherait deux.

Dans `#btTheme`, après les deux SVG :

```html
<span id="motTheme">Système</span>
```

Trois états, et non deux : « Système », « Sombre », « Clair ».

Dans `outils/faire-etape.js`, la constante `DOSSIERS_DESKTOP` :

```js
const DOSSIERS_DESKTOP = ['polices', 'sons', 'skin', 'vues'];
```

- [ ] **Étape 5 : lancer les tests et vérifier qu'ils passent**

```
npm test
```

Attendu : tout vert.

- [ ] **Étape 6 : recette à l'œil, les deux thèmes**

```
npm run banc
```

Cliquer les cinq icônes du rail : Courses doit rester inerte, les quatre
autres doivent commuter. Cliquer le bouton de thème trois fois : Système →
Sombre → Clair → Système. Recharger la page : le thème choisi doit tenir.

Puis, dans les réglages de Windows, basculer le thème du système pendant
qu'OMNI est sur « Système » : la fenêtre doit suivre **sans rechargement**.

- [ ] **Étape 7 : recette en vraie fenêtre**

```
npm run app
```

Le banc ne peut pas dire si les boutons de la barre du haut répondent :
`-webkit-app-region` n'existe que dans Electron. Cliquer Réduire, Fermer, le
bouton de thème et le numéro de version. Un bouton qui ne fait rien est un
`no-drag` manquant, pas un `addEventListener` manquant.

- [ ] **Étape 8 : commit**

```
git add desktop/vues/rail.js desktop/index.html outils/faire-etape.js test/skin-rail.test.js
git commit -m "refonte(skin): le rail commute les ecrans, le theme se retient et suit Windows"
```

---

### Tâche 7 : Les bandeaux d'erreur en surface inversée

La refonte ne dessine aucun bandeau. Le §6 du README arrête la règle :
surface inversée, entre la barre du haut et l'écran, qui **pousse** et ne
recouvre jamais une donnée. Les deux bandeaux existent déjà (`#erreur`,
`#sansmaitre`) et sont remplis par le script actuel ; seule leur peau change.

**Fichiers :**
- Créer : `desktop/skin/ecrans.css`
- Modifier : `desktop/index.html` (le `<link>`, et le retrait des anciennes
  règles `.avis` aux lignes 245-248)

**Interfaces :**
- Consomme : les jetons de `skin/jetons.css`.
- Produit : les règles `.avis`. Le fichier `ecrans.css` accueillera ensuite
  ce qui est propre à chaque écran, étape par étape.

- [ ] **Étape 1 : écrire `desktop/skin/ecrans.css`**

```css
/* ============================================================
   CE QUI EST PROPRE A CHAQUE ECRAN. Le fichier se remplit etape
   par etape; il ne porte pour l instant que les bandeaux.
   ============================================================ */

/* LES BANDEAUX POUSSENT, ILS NE RECOUVRENT PAS.
   Regle arretee au §6 du labo, qui ne les dessine pas. Un bandeau
   pose en surcouche cacherait une ligne de personnage -- et la
   ligne cachee serait justement celle dont il parle.

   UN BLOC INVERSE = UNE CHOSE A FAIRE, et les deux bandeaux en
   sont. `:empty` les retire de la grille: au repos ils ne prennent
   pas un pixel, et l ecran ne bouge pas. */
.avis {
  flex: none;
  background: var(--alarme);
  color: var(--sur-alarme);
  border-radius: 14px;
  padding: 10px 16px;
  font: 500 13px/1.45 var(--ui);
}
.avis:empty { display: none; }

/* LES DEUX BANDEAUX NE SE DISTINGUENT PAS PAR LA COULEUR.
   Regle 1 du labo: un etat se lit par une FORME avant de se lire
   par une teinte -- OMNI est regarde du coin de l oeil, sur un
   second ecran, et la vision peripherique ne voit pas la teinte.
   L erreur porte un lisere jaune a gauche; l absence de meneur,
   rien. Deux blocs inverses au meme moment restent lisibles. */
#erreur { box-shadow: inset 4px 0 0 var(--acide-sur-contre); }
```

- [ ] **Étape 2 : lier la feuille et retirer les anciennes règles**

Dans `desktop/index.html`, après le lien des briques :

```html
<link rel="stylesheet" href="skin/ecrans.css">
```

Supprimer les quatre lignes les quatre règles `.avis`, `.avis:empty`, `#erreur`, `#sansmaitre` (`.avis`,
`.avis:empty`, `#erreur`, `#sansmaitre`) de l'ancien bloc `<style>`. Retirer
aussi `.avis` de la liste `flex: none` de la règle `.barre-titre, .bandeau, .avis { flex: none; }`.

- [ ] **Étape 3 : lancer les tests et vérifier qu'ils passent**

```
npm test
```

Attendu : tout vert.

- [ ] **Étape 4 : recette à l'œil, bandeau rempli**

```
npm run banc
```

Les bandeaux sont vides au repos et ne doivent rien occuper. Pour en voir
un, poser depuis la console du banc :

```js
document.getElementById('erreur').textContent = 'Essai de bandeau';
```

Il doit apparaître **entre** la barre du haut et la liste, pousser la liste
vers le bas, et ne recouvrir aucune ligne. Vérifier dans les deux thèmes.

- [ ] **Étape 5 : commit**

```
git add desktop/skin/ecrans.css desktop/index.html
git commit -m "refonte(skin): les bandeaux poussent l ecran au lieu de le recouvrir"
```

---

### Tâche 8 : La barre du bas aux nouveaux jetons

La `.barre-nav` reste : elle porte des bascules **globales** — Overlay,
Équiper PdA, Monter en calibre, Fermer les clients, le délai — et non un
écran. La maquette ne lui donne pas de place ; c'est un manque de la
maquette, pas une invitation à la supprimer.

**Fichiers :**
- Modifier : `desktop/skin/ecrans.css`
- Modifier : `desktop/index.html` (les anciennes règles `.barre-nav`)

**Interfaces :**
- Consomme : les jetons de `skin/jetons.css` et `.fant` de `skin/briques.css`.
- Produit : `.inter` dans `skin/briques.css` (voir l'étape 1).

- [ ] **Étape 1 : apporter `.inter`, qui manque encore**

La `.barre-nav` porte des interrupteurs, et `.inter` est une brique — le §2
du README du labo la range dans sa table des briques. Mais la maquette, elle,
la définit dans sa section « 5. raccourcis » (`labo-omni/app.html:300-303`),
hors des plages que la tâche 4 a reprises : elle n'est donc pas dans
`briques.css`. C'est un défaut de classement de la maquette, pas un désaccord
de dessin.

L'ajouter à `desktop/skin/briques.css`, recopiée telle quelle :

```css
/* CETTE BRIQUE VIENT DE LA SECTION « raccourcis » DE LA MAQUETTE, qui l y a
   rangee parce que c est la qu elle s en sert d abord. Le §2 du README du
   labo la compte pourtant parmi les briques, et la barre du bas l emploie
   sans rien devoir a l ecran Raccourcis. Elle est donc ici. */
.inter{width:34px;height:20px;border-radius:999px;background:var(--inter-off);position:relative;border:0;cursor:pointer;flex:none}
.inter::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--inter-bouton);transition:left .12s}
.inter.on{background:var(--encre)}
.inter.on::after{left:16px;background:var(--acide-sur-contre)}
```

- [ ] **Étape 2 : rhabiller la barre**

Ajouter à `desktop/skin/ecrans.css` les règles de `.barre-nav`,
`.maitre-inter`, `.pose`, `.coupe` et `.champ-delai`, en traduisant les
anciennes couleurs vers les jetons : `--v0-releve` devient `--carte`,
`--v0-filet` devient `--trait`, `--v0-texte` devient `--encre`,
`--v0-attenue` devient `--encre-douce`, `--v0-arme` devient `--acide`.

`.coupe` (« Fermer les clients ») est la seule action destructrice de la
barre : elle prend la **surface inversée**, `--alarme` / `--sur-alarme`, et
elle est le seul bloc inversé de la barre au repos.

Garder `-webkit-app-region: no-drag` sur `.maitre-inter` : le commentaire de
le commentaire « LE `no-drag` N'EST PAS DECORATIF » du bloc `<style>` dit pourquoi, et la barre du bas n'est pas une zone
de déplacement — mais la règle y a été posée par précaution et rien ne gagne
à la retirer.

- [ ] **Étape 3 : retirer les anciennes règles**

Supprimer du bloc `<style>` d'`index.html` les règles de `.barre-nav` (à
partir de la ligne 267) et de ses enfants, une fois leur équivalent écrit
dans `ecrans.css`. Laisser `.avis-nav` : il sert aussi dans les panneaux
modaux, qui gardent l'ancienne feuille jusqu'à leur étape.

- [ ] **Étape 4 : lancer les tests et vérifier qu'ils passent**

```
npm test
```

Attendu : tout vert. `pont-ipc` en particulier : les boutons de cette barre
appellent `window.app.pdaArchiArmer`, `pdaArchiRepli` et la fermeture des
clients.

- [ ] **Étape 5 : recette en vraie fenêtre**

```
npm run app
```

Cliquer les quatre bascules de la barre du bas. Un interrupteur qui coche à
l'écran sans rien déclencher est un canal perdu ; un interrupteur qui ne
coche pas est un `no-drag` manquant.

- [ ] **Étape 6 : commit**

```
git add desktop/skin/ecrans.css desktop/skin/briques.css desktop/index.html
git commit -m "refonte(skin): la barre du bas aux nouveaux jetons, fermer les clients tranche seul"
```

---

### Tâche 9 : La recette de l'étape

Rien de neuf ici : on vérifie que l'étape 0 est entière avant d'ouvrir
l'étape 1.

- [ ] **Étape 1 : la suite complète**

```
npm test
```

Attendu : **tout vert**, sans exception. Relever le nombre de tests passés
et le noter dans le message de commit de l'étape suivante.

Rappel : `serveur-maj/` a son propre `npm install`. Si ses tests échouent,
lancer `npm install` dans ce sous-dossier avant de chercher plus loin.

- [ ] **Étape 2 : les deux thèmes, écran par écran**

```
npm run banc
```

Pour chacun des deux thèmes : le rail, la barre du haut, la liste des
personnages, la barre du bas, les deux bandeaux. Chercher un texte illisible
— c'est la trace d'un jeton `--v0-` oublié, ou d'un jeton posé sur la
mauvaise surface.

- [ ] **Étape 3 : la vraie fenêtre**

```
npm run app
```

Déplacer la fenêtre en la saisissant par la barre du haut. Réduire, rouvrir,
fermer. Ouvrir les cinq panneaux modaux, qui doivent **toujours** répondre :
ils portent encore l'ancienne peau, c'est normal et c'est le contrat de
l'étape.

- [ ] **Étape 4 : le paquet**

Vérifier que `skin/` et `vues/` sont bien dans `DOSSIERS_DESKTOP`
(la constante `DOSSIERS_DESKTOP` d `outils/faire-etape.js`) et que `desktop/polices/` contient les quatre
polices — Cal Sans et Karla, qui servent encore, plus Outfit et Plus Jakarta
Sans.

Ne pas fabriquer le paquet ici : cette machine n'a pas de binaire packagé,
et `npm run etape` demande `OMNI.exe`. La vérification se fait sur les
listes.

- [ ] **Étape 5 : contrôle des données personnelles**

```
git diff master --stat
git diff master | grep -n -i "AppData\|jibef\|@gmail\|C:\\\\Users"
```

Le dépôt est partagé avec les amis. Aucun chemin de poste, aucune adresse,
aucun nom de compte ne doit passer.

---

## Ce que l'étape 0 ne fait pas

- Les quatre écrans restent vides ; les panneaux modaux gardent l'ancienne
  peau et l'ancien comportement.
- Le JavaScript des écrans n'est pas découpé : `index.html` porte toujours
  son `<script>` de 1 914 lignes.
- Les huit gardes qui lisent `index.html` n'ont pas bougé — elles sont
  encore vertes parce que le script n'a pas été déplacé. Elles seront
  réécrites à mesure que chaque écran part dans son module.
- Le préfixe `--v0-` reste : il ne tombera qu'au dernier écran.
- Des règles deviennent mortes sans être retirées : `.barre-titre`,
  `.titre-nom`, `.fenetre-boutons`, et le `@font-face` de Cal Sans, dont plus
  aucun élément ne porte la classe. On les laisse le temps du chantier — les
  retirer maintenant mêlerait du nettoyage à une refonte, et c'est en mêlant
  les deux qu'on ne sait plus lequel a cassé quoi. Elles partent à l'étape
  des gardes, avec le préfixe.

## La suite

Un plan par écran, écrit à son tour, dans l'ordre du §« L'ordre » de la spec :

1. `2026-XX-XX-refonte-raccourcis.md`
2. `2026-XX-XX-refonte-archimonstres.md`
3. `2026-XX-XX-refonte-hotel-de-vente.md` (et ses trois onglets)
4. `2026-XX-XX-refonte-reglages.md`
5. `2026-XX-XX-refonte-gardes.md` (les huit tests, et le retrait de `--v0-`)
