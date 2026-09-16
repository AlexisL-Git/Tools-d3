# Raccourcis au skin de la maquette — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire ressembler et se comporter l'écran Raccourcis de `desktop/index.html` à celui de `labo-omni/app.html` (jetons, briques, grille), sans rien perdre des fonctions réelles qui n'existent pas dans la maquette (menu HDV, bouton Archi, fermeture d'un client, motif des lots écartés, bascule groupée par colonne).

**Architecture:** Reskin en place. Le DOM de `#v-raccourcis` est reconstruit dans `desktop/index.html` avec le vocabulaire de briques de la maquette (`.panneau`, `.entete`, `.liste`, `.ligne`, `.perso-mini`, `.jeton`, `.cabochon`, `.inter`, `.pastille-etat`, `.d`) ; `creerRang()`/`majRang()` restent des fonctions du même script inline, seule la forme du DOM qu'elles construisent change. Les anciennes règles CSS `--v0-*` propres à Raccourcis sont supprimées ; celles des autres écrans (Archimonstres, Hôtel, Réglages, Pépites) ne sont pas touchées, ils ne sont pas encore portés.

**Tech Stack:** HTML/CSS/JS vanilla, Electron renderer sandboxé (pas de modules ES pour cette étape — voir Hors périmètre), `node --test`.

**Spec:** `labo-omni/README.md` (règle : en cas de doute, la maquette fait foi), `labo-omni/app.html` (section `#v-raccourcis`, lignes ~643-706, et son `<style>` lignes ~96-355), `docs/superpowers/plans/2026-09-14-refonte-fenetre-principale-ossature.md` (écarts assumés du §"Trois écarts assumés").

## Global Constraints

- **La maquette fait foi en cas de doute** (labo-omni/README.md §7).
- **Deux écarts assumés, gardés tels quels** (ossature spec, §"Trois écarts assumés") : les colonnes **HDV** et **Archi** de Raccourcis restent, la maquette les a laissées tomber — elles commandent des fonctions réelles, les perdre serait une régression.
- **Le jaune (`--acide`) ne se pose que sur une surface plus foncée que lui** (labo-omni/README.md §2, règle 2) : jamais de fond jaune sur `--fond`/`--carte` directement.
- **Le meneur se signale par une forme (liseré 4px), pas par un aplat** (labo-omni/README.md §2, règle 2 : "Le meneur porte un lisere jaune de 4 px (`.perso.mene`), pas un aplat").
- **Un bloc inversé = une chose à faire** (labo-omni/README.md §2, règle 3).
- **`--encre` et `--alarme` ont la même valeur mais pas le même métier** : ne jamais les fusionner (jetons.css commentaire, README §2).
- **Aucun jeton `--v0-*` n'est supprimé** : les écrans Archimonstres, Hôtel, Réglages, Pépites en dépendent encore et ne sont pas dans le périmètre de cette tâche.
- **`window.app.*` ne change pas** : mêmes noms d'appel IPC, mêmes arguments — seul le DOM qui les déclenche change de forme. `test/pont-ipc.test.js` doit rester vert sans modification.

---

## File Structure

- Modify: `desktop/index.html`
  - `<style>` (tête du fichier) : suppression des règles `--v0-*` propres à Raccourcis (`.cabochon`, `.cellule-touche`, `.oter`, `.fermer-un`, `.hdv`, `.menu-hdv`, `.archi` bouton-ligne, section "la liste" entière, `.motif.cliquable`/`.oter:hover`/`.oter svg`), et correction de l'attribut `style` inline de `#avertTouches`.
  - Corps : nouveau balisage statique de `#v-raccourcis` (`.titre` + `.panneau > .entete + .liste`).
  - `<script>` : `dansLaPlaque()` renommée `dansLeJeton()`, `creerRang()` et `majRang()` réécrites pour construire/peupler le nouveau DOM. Aucune autre fonction du script ne bouge.
- Modify: `desktop/skin/briques.css` — ajout de règles génériques réutilisables par d'autres écrans plus tard : `.panneau .entete .c` (centrage), `.ligne .inter` (centrage), `.panneau .ligne { position: relative }`, `.ligne.hors-ligne`, `.cabochon.sans-touche/.ecoute/.risque`, `.pastille-etat.attente`, `.bt-vide.pleine`.
- Modify: `desktop/skin/ecrans.css` — ajout d'une section `RACCOURCIS` : grille à 11 colonnes, `.cellule-touche`, `.oter`, `.tete-colonne`/`.jauge`, `.ligne.commande`, `.hdv`/`.menu-hdv`/`.archi`/`.fermer-un`/`.motif`, `.jeton img`, `.perso-mini.clic`, `.liste-vide`, `#avertTouches`.
- Create: `test/skin-raccourcis.test.js` — garde qui verrouille le nouveau vocabulaire et l'absence de l'ancien.

---

## Task 1: Le test qui verrouille la migration (rouge d'abord)

**Files:**
- Create: `test/skin-raccourcis.test.js`

**Interfaces:**
- Lit `desktop/index.html`, `desktop/skin/briques.css`, `desktop/skin/ecrans.css` en texte brut (même méthode que `test/pont-ipc.test.js` et `test/souris-copie.test.js` : lecture de fichier + assertions sur le source, pas de DOM).

- [ ] **Step 1: Écrire le test complet**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dossier = path.join(__dirname, '..', 'desktop');
const html = fs.readFileSync(path.join(dossier, 'index.html'), 'utf8');
const briques = fs.readFileSync(path.join(dossier, 'skin', 'briques.css'), 'utf8');
const ecrans = fs.readFileSync(path.join(dossier, 'skin', 'ecrans.css'), 'utf8');

// Le bloc #v-raccourcis seul, pour ne pas faire lever ce test sur les
// autres écrans (Archimonstres, Hôtel, Réglages) qui portent encore l'ancien
// prefixe v0- et ne sont pas dans le périmètre de cette tâche.
function blocRaccourcis() {
  const i = html.indexOf('<div class="vue actif" id="v-raccourcis">');
  const j = html.indexOf('<div class="vue" id="v-courses">');
  assert.notStrictEqual(i, -1, 'ouverture de #v-raccourcis introuvable');
  assert.notStrictEqual(j, -1, 'ouverture de #v-courses introuvable : bornes du bloc perdues');
  return html.slice(i, j);
}

test('le balisage de #v-raccourcis porte le vocabulaire de la maquette', () => {
  const bloc = blocRaccourcis();
  for (const classe of ['panneau', 'entete', 'liste', 'titre']) {
    assert.ok(
      bloc.includes('class="' + classe + '"') || bloc.includes(' ' + classe + '"') || bloc.includes(' ' + classe + ' '),
      `classe "${classe}" absente du balisage de #v-raccourcis`,
    );
  }
  assert.ok(!bloc.includes('class="defile"'), '.defile aurait du disparaitre avec l etape Raccourcis');
  assert.ok(!bloc.includes('id="entete"') || bloc.includes('class="entete"'), 'l entete doit porter la classe de la maquette');
});

test('creerRang() et majRang() ne construisent plus les anciennes classes', () => {
  const i = html.indexOf('function creerRang()');
  const j = html.indexOf('window.app.surEtat(');
  assert.notStrictEqual(i, -1, 'creerRang introuvable');
  assert.notStrictEqual(j, -1, 'window.app.surEtat introuvable');
  const script = html.slice(i, j);
  for (const ancienne of ["'rang'", "'plaque'", "'case'", "'verdict'", "'bouton-commande'", "'zone-clic'"]) {
    assert.ok(!script.includes(ancienne), `l ancienne classe ${ancienne} est encore construite par le JS`);
  }
  for (const nouvelle of ["'ligne'", "'perso-mini'", "'inter'", "'pastille-etat'", "'cabochon'"]) {
    assert.ok(script.includes(nouvelle), `la nouvelle classe ${nouvelle} n est jamais construite`);
  }
});

test('les anciennes regles CSS -v0- de Raccourcis ont disparu de index.html', () => {
  for (const selecteur of ['.rang {', '.rang.', '.plaque {', '.case {', '.verdict {', '.bouton-commande {', '.zone-clic ', '.cellule-touche {']) {
    assert.ok(!html.includes(selecteur), `la regle "${selecteur}" existe encore dans index.html`);
  }
});

test('le nouveau vocabulaire de Raccourcis vit dans skin/, pas dans index.html', () => {
  for (const selecteur of ['.ligne.commande', '.hdv', '.menu-hdv', '.archi', '.fermer-un', '.motif']) {
    assert.ok(ecrans.includes(selecteur), `"${selecteur}" attendu dans skin/ecrans.css`);
  }
  for (const selecteur of ['.ligne.hors-ligne', '.cabochon.risque', '.pastille-etat.attente', '.bt-vide.pleine']) {
    assert.ok(briques.includes(selecteur), `"${selecteur}" attendu dans skin/briques.css`);
  }
});

test('#avertTouches ne pointe plus sur un jeton -v0-', () => {
  assert.ok(!html.includes("id=\"avertTouches\" style=\"margin-left:auto;text-transform:none;letter-spacing:0;font-weight:400;color:var(--v0-alerte)\""),
    'avertTouches porte encore --v0-alerte en style inline');
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `npm test -- --test-name-pattern=skin-raccourcis`
Attendu : plusieurs assertions rouges (le balisage et le CSS actuels sont encore l'ancienne version).

- [ ] **Step 3: Commit**

```bash
git add test/skin-raccourcis.test.js
git commit -m "test(refonte): Raccourcis doit parler le vocabulaire de la maquette

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Le CSS — nouvelles briques et nouvel écran, ancien -v0- retiré

**Files:**
- Modify: `desktop/skin/briques.css`
- Modify: `desktop/skin/ecrans.css`
- Modify: `desktop/index.html` (uniquement le `<style>` de tête, lignes ~207-283 et ~677-843, plus l'attribut `style` de `#avertTouches` ligne 1191)

**Interfaces:**
- Consomme : les jetons de `desktop/skin/jetons.css` (`--fond`, `--carte`, `--carte-creuse`, `--encre`, `--encre-douce`, `--alarme`, `--sur-alarme`, `--trait`, `--trait-fort`, `--acide`, `--sur-acide`, `--inter-off`, `--inter-bouton`, `--acide-sur-contre`).
- Produit : les sélecteurs que Task 3/4/5 vont utiliser dans le balisage et le JS — `.panneau`, `.entete`, `.liste`, `.ligne`, `.ligne.commande`, `.ligne.hors-ligne`, `.perso-mini`, `.perso-mini.clic`, `.jeton`, `.jeton img`, `.cellule-touche`, `.cabochon` (+ `.sans-touche`/`.ecoute`/`.risque`), `.oter`, `.inter`, `.d`, `.bt-vide` (+ `.pleine`), `.pastille-etat` (+ `.creux`/`.attente`), `.hdv`/`.hdv.tourne`, `.menu-hdv`, `.archi`/`.archi.pleine`, `.fermer-un`/`.fermer-un.confirme`, `.motif`/`.motif.cliquable`, `.tete-colonne`/`.jauge`, `.liste-vide`, `#avertTouches`.

- [ ] **Step 1: Ajouter à `desktop/skin/briques.css`** (à la fin du fichier)

```css

/* ============================================================
   AJOUTS DE L ETAPE RACCOURCIS. Generiques : reutilisables par
   Courses/Hotel plus tard, donc ici et pas dans ecrans.css.
   ============================================================ */

/* Centrage des en-tetes de colonne et des interrupteurs, copie de
   labo-omni/app.html (lignes 307-308) : la maquette les traite comme des
   briques bien qu elles vivent dans la section Raccourcis du fichier. */
.panneau .entete .c { text-align: center; }
.panneau .ligne .inter { justify-self: center; }
/* position: relative -- necessaire au menu HDV de la ligne (ecrans.css),
   positionne en absolute par rapport a sa .ligne. */
.panneau .ligne { position: relative; }

/* Un compte deconnecte s efface, il ne disparait pas: on garde la trace de
   la place qu il occupe dans la flotte. */
.ligne.hors-ligne { opacity: .45; }

/* Les trois etats du cabochon de touche, sous la regle "forme avant
   couleur": pointille = rien d assigne, plein jaune = en cours de saisie
   (etat actif, ephemere), surface inversee = signale un risque (touche deja
   prise ailleurs, ou confisquee a Dofus). */
.cabochon.sans-touche { background: transparent; border: 1px dashed var(--trait-fort); color: var(--encre-douce); }
.cabochon.ecoute { background: var(--acide); color: var(--sur-acide); }
.cabochon.risque { background: var(--alarme); color: var(--sur-alarme); }

/* La troisieme etiquette d etat, entre "pleine" (jaune, ca tourne) et
   "creux" (surface inversee, ca reclame): un contour pointille pour ce qui
   attend sans rien reclamer encore. */
.pastille-etat.attente { background: transparent; color: var(--encre-douce); box-shadow: inset 0 0 0 1.5px var(--trait-fort); }

/* Le bouton "Designer"/"Commande" de Raccourcis est le meme element dans
   les deux etats (il reste cliquable meme quand il commande, pour rendre la
   main) -- seul son habillage bascule vers la pastille pleine de la
   maquette. */
.bt-vide.pleine { background: var(--acide); border-color: var(--acide); color: var(--sur-acide); }
```

- [ ] **Step 2: Ajouter à `desktop/skin/ecrans.css`** (à la fin du fichier)

```css

/* ============================================================
   RACCOURCIS. Le panneau/entete/liste/ligne generiques sont dans
   briques.css (recopies de la maquette) ; ici, tout ce qui est propre a
   CET ecran : sa grille a onze colonnes, et les briques qui n existaient
   pas dans la maquette parce qu elle ne dessine pas le menu HDV, le
   bouton Archi ni la fermeture d un client (deux ecarts assumes du plan
   d ossature du 14/09 : HDV et Archi restent, la maquette les laisse
   tomber). */

#v-raccourcis .entete,
#v-raccourcis .ligne {
  grid-template-columns: 1.7fr 84px repeat(5, 56px) 116px 50px 54px 34px;
}

/* La cellule Touche: le cabochon prend la place, la corbeille se glisse a
   cote et ne parait que si une touche est assignee. */
.cellule-touche { display: flex; align-items: center; gap: 4px; min-width: 0; }
.cellule-touche .cabochon { flex: 1; min-width: 0; }
.oter {
  flex: none; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px;
  display: grid; place-items: center; background: transparent; color: var(--encre-douce); cursor: pointer;
}
.oter:hover { color: var(--encre); background: var(--carte-creuse); }
.oter svg { width: 12px; height: 12px; }

/* Le titre de colonne est une ACTION GROUPEE: il coche ou decoche la
   fonction pour tout le monde. Le losange dit ou en est la colonne --
   plein, creux, ou a moitie quand seuls certains comptes l ont. */
.tete-colonne {
  display: inline-flex; align-items: center; gap: 5px; justify-content: center;
  width: 100%; padding: 7px 2px; border: 0; background: transparent;
  color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit;
  border-radius: 6px; cursor: pointer;
}
.tete-colonne:hover { background: var(--carte-creuse); color: var(--encre); }
.tete-colonne:disabled { opacity: .3; cursor: not-allowed; }
.jauge {
  width: 8px; height: 8px; flex: none; transform: rotate(45deg); border-radius: 4px;
  border: 1.5px solid var(--trait-fort); background: transparent;
}
.jauge.tous { background: var(--acide); border-color: var(--acide); }
.jauge.partiel {
  border-color: var(--acide);
  background: linear-gradient(to right, var(--acide) 50%, transparent 50%);
}

/* Le meneur se signale par une forme, pas par un aplat (README du labo,
   §2, regle 2): un lisere de 3px, et le jeton de classe qui passe en
   jaune -- exactement la regle deja tenue par .perso.mene dans
   briques.css, transposee a .ligne. */
.ligne.commande::before {
  content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px;
  border-radius: 0 3px 3px 0; background: var(--acide);
}
.ligne.commande .jeton { background: var(--acide); color: var(--sur-acide); }

/* Le jeton de classe affiche soit l embleme du jeu (une <img>, deja
   resolue par le processus principal via src/comptes/emblemes.js), soit
   l abreviation textuelle que dansLeJeton() pose directement -- pas la
   mecanique .pic/.sans-pic de la maquette, qui suppose un chargement
   depuis le navigateur : ici l embleme arrive deja pret par IPC. */
.jeton img { width: 22px; height: 22px; object-fit: contain; border-radius: inherit; }
.ligne.hors-ligne .jeton img { filter: grayscale(1); }

.perso-mini.clic { cursor: pointer; }
.perso-mini.clic:hover .n { text-decoration: underline; }

/* Le menu HDV de la ligne. Il s'ouvre AU CLIC, pas au survol: un menu qui
   surgit en passant la souris se declenche pendant qu'on vise autre chose. */
.hdv, .archi { color: var(--encre-douce); }
.hdv:hover:not(:disabled), .archi:hover:not(:disabled) { color: var(--encre); border-color: var(--encre-douce); }
.hdv:disabled, .archi:disabled { opacity: .3; cursor: not-allowed; }
/* Le jaune pour ce qui tourne (README §2, regle 2): une mise a jour ou une
   mise en vente en cours. */
.hdv.tourne { background: var(--acide); border-color: var(--acide); color: var(--sur-acide); }
.archi.pleine { color: var(--encre); border-color: var(--trait-fort); }

.menu-hdv {
  position: absolute; right: 20px; top: 100%; margin-top: 6px; z-index: 2;
  min-width: 220px; background: var(--carte); border: 1px solid var(--trait);
  border-radius: 12px; padding: 6px; box-shadow: 0 10px 28px rgba(0,0,0,.22);
  display: flex; flex-direction: column; gap: 2px;
}
.menu-hdv button {
  text-align: left; padding: 9px 10px; background: transparent; border: 0;
  border-radius: 7px; color: var(--encre); font: 500 12.5px/1.3 var(--ui); cursor: pointer;
}
.menu-hdv button:hover { background: var(--carte-creuse); }
/* Une entree inerte reste VISIBLE. La cacher ferait croire qu'elle n'est
   pas prevue; grisee, elle dit qu'elle existe et pourquoi elle n'agit pas. */
.menu-hdv button.inerte { color: var(--encre-douce); cursor: default; }

/* Fermer CE client. Deux clics, comme le bouton qui les ferme tous (barre
   du bas) -- meme grammaire que .coupe/.coupe.confirme : arme puis jaune
   au lieu d agir tout de suite. */
.fermer-un {
  width: 30px; height: 30px; flex: none; padding: 0; border: 0; border-radius: 8px;
  display: grid; place-items: center; background: transparent; color: var(--encre-douce); cursor: pointer;
}
.fermer-un svg { width: 13px; height: 13px; }
.fermer-un:hover { color: var(--encre); background: var(--carte-creuse); }
.fermer-un:disabled { opacity: .25; cursor: not-allowed; }
.fermer-un.confirme { background: var(--acide); color: var(--sur-acide); }

/* Le compte rendu des lots ecartes, sous le nom -- indente sous le jeton
   pour rester lisible sans repeter la ligne. */
.motif {
  grid-column: 1 / -1; padding: 0 0 10px 42px; font-size: 12px; color: var(--encre-douce);
}
.motif.cliquable { cursor: pointer; text-decoration: underline dotted; }
.motif.cliquable:hover { color: var(--encre); }

.liste-vide { padding: 44px 20px; text-align: center; color: var(--encre-douce); font-size: 13.5px; }
.liste-vide b { display: block; color: var(--encre); font-size: 15px; margin-bottom: 6px; font-weight: 700; }

/* L avertissement de touches en double vit dans la barre du bas, deja aux
   nouveaux jetons -- lui seul avait garde son ancienne couleur en style
   inline (voir desktop/index.html, #avertTouches). */
#avertTouches { color: var(--alarme); }
```

- [ ] **Step 3: Retirer les anciennes règles `-v0-` de Raccourcis dans `desktop/index.html`**

Deux blocs à supprimer du `<style>` de tête (ne pas toucher au reste : les règles `.vue-archi`/`.arc-*`, `.ry-*`, `.gf-*`, `.pep-*`, `.qdn-*`, `.avis-nav` restent, elles servent des écrans pas encore portés).

Bloc A — de `.cabochon {` à `.cabochon.risque { border-color: var(--v0-alerte); color: var(--v0-alerte); }` inclus, en passant par `.cellule-touche`, `.oter`, `.fermer-un`, `.hdv`, `.menu-hdv`, jusqu'à `.archi.pleine { color: var(--v0-texte); }` inclus — tout le texte actuellement aux lignes 207-283 de `desktop/index.html` (vérifier avec `Read` avant de couper : le commentaire `/* ---------------- les archimonstres ---------------- */` et tout ce qui suit `.vue-archi {` restent, ils appartiennent à l'écran Archimonstres, pas à la Task).

Bloc B — de `.motif.cliquable { cursor: pointer; text-decoration: underline dotted; }` et `.motif.cliquable:hover { color: var(--v0-texte); }`, puis `.oter:hover { ... }` et `.oter svg { ... }` (lignes ~677-681), à supprimer aussi.

Bloc C — de `/* ---------------- la liste ---------------- */` jusqu'à `.liste-vide b { ... }` inclus, juste avant `</style>` (lignes ~692-843) : le commentaire du prefixe v0-, `#v-raccourcis .defile`, `.defile`, `.entete, .rang`, `.entete`, `.entete .c`, `.tete-colonne`, `.jauge`, `.rang` (+ `.hors-ligne`/`.commande`), `.plaque`, `.identite`, `.zone-clic`, `.nom`, `.sous-nom`, `.case`, `.bouton-commande`, `.verdict`, `.motif`, `.liste-vide` — tout part, tout a un équivalent neuf posé à l'Étape 2 dans `briques.css`/`ecrans.css`.

Garder intacts, entre les blocs A et C : `/* ---------------- les archimonstres ---------------- */` et toute la section `.vue-archi`/`.arc-*` jusqu'à `.arc-pied b { ... }`, la section Pépites (`.pep-*`), la section Rythme HDV (`.ry-*`), Garde-fous (`.gf-*`), `.eca-*`, `.paire`, `.avis-nav`.

- [ ] **Step 4: Corriger l'attribut `style` de `#avertTouches`**

Fichier `desktop/index.html`, ligne ~1191.

Avant :
```html
  <span class="paire" id="avertTouches" style="margin-left:auto;text-transform:none;letter-spacing:0;font-weight:400;color:var(--v0-alerte)"></span>
```

Après :
```html
  <span class="paire" id="avertTouches" style="margin-left:auto;text-transform:none;letter-spacing:0;font-weight:400"></span>
```

(La couleur vient désormais de la règle `#avertTouches { color: var(--alarme); }` posée à l'Étape 2.)

- [ ] **Step 5: Lancer le test de l'Étape 1 — il doit rester rouge sur la partie balisage/JS**

Run: `npm test -- --test-name-pattern=skin-raccourcis`
Attendu : les deux derniers tests (« le nouveau vocabulaire de Raccourcis... » et « #avertTouches ne pointe plus... ») passent désormais ; les deux premiers (balisage, JS) restent rouges — c'est le Task 3/4/5 qui les fait passer.

- [ ] **Step 6: Lancer toute la suite pour vérifier l'absence de régression sur les autres écrans**

Run: `npm test`
Attendu : aucun nouvel échec en dehors de `skin-raccourcis` (qui reste partiellement rouge, attendu à ce stade).

- [ ] **Step 7: Commit**

```bash
git add desktop/skin/briques.css desktop/skin/ecrans.css desktop/index.html
git commit -m "refonte(skin): Raccourcis — le CSS suit la maquette, l ancien -v0- s en va

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Le balisage statique de `#v-raccourcis`

**Files:**
- Modify: `desktop/index.html` (corps, lignes ~925-949)

**Interfaces:**
- Consomme : `.titre`, `.panneau`, `.tete-colonne`, `.jauge`, `.c`, `.d` (posés Task 2 / déjà dans briques.css).
- Produit : `#entete` (id conservé — Task 4/Étape 5.4/§2618 s'y accroche par `document.querySelectorAll('[data-colonne]')`, aucun changement requis là), `#liste` (id conservé — c'est lui que `creerRang`/le rendu final visent), `#listeVide` (id conservé).

- [ ] **Step 1: Remplacer le bloc `#v-raccourcis`**

Fichier `desktop/index.html`, remplacer (lignes ~925-949) :

```html
    <div class="vue actif" id="v-raccourcis">
      <!-- La liste d aujourd hui, deplacee telle quelle. Elle garde
           l ancienne feuille jusqu a l etape 1 du chantier. -->
      <div class="defile">
  <div class="entete" id="entete">
    <div></div>
    <div>Personnage / compte</div>
    <div class="c">Touche</div>
    <div class="c"><button class="tete-colonne" data-colonne="repl"><span class="jauge"></span>Répl.</button></div>
    <div class="c"><button class="tete-colonne" data-colonne="tour"><span class="jauge"></span>Tour</button></div>
    <div class="c"><button class="tete-colonne" data-colonne="groupe"><span class="jauge"></span>Groupe</button></div>
    <div class="c"><button class="tete-colonne" data-colonne="anim"><span class="jauge"></span>Anim</button></div>
    <div class="c"><button class="tete-colonne" data-colonne="echange"><span class="jauge"></span>Éch.</button></div>
    <div class="c">Commande</div>
    <div class="c">HDV</div>
    <div class="c">Archi</div>
    <div></div>
  </div>
  <div id="liste"></div>
  <div class="liste-vide" id="listeVide" hidden>
    <b>Aucun client Dofus détecté</b>
    Lance tes clients maintenant : OMNI doit tourner AVANT eux pour pouvoir les suivre.
  </div>
</div>
    </div>
```

par :

```html
    <div class="vue actif" id="v-raccourcis">
      <div class="titre">
        <h1>Tes huit touches, <span class="marqueur sourd">et ce que chacun suit</span></h1>
        <p>Une touche par personnage pour passer sur sa fenêtre. Les cinq interrupteurs disent ce que chacun recopie du meneur — clique sur un titre de colonne pour l’armer partout d’un coup.</p>
      </div>
      <div class="panneau">
        <div class="entete" id="entete">
          <span>Personnage</span>
          <span>Touche</span>
          <span class="c"><button class="tete-colonne" data-colonne="repl"><span class="jauge"></span>Répl.</button></span>
          <span class="c"><button class="tete-colonne" data-colonne="tour"><span class="jauge"></span>Tour</button></span>
          <span class="c"><button class="tete-colonne" data-colonne="groupe"><span class="jauge"></span>Groupe</button></span>
          <span class="c"><button class="tete-colonne" data-colonne="anim"><span class="jauge"></span>Anim</button></span>
          <span class="c"><button class="tete-colonne" data-colonne="echange"><span class="jauge"></span>Éch.</button></span>
          <span class="d">Commande</span>
          <span class="c">HDV</span>
          <span class="c">Archi</span>
          <span></span>
        </div>
        <div class="liste" id="liste"></div>
        <div class="liste-vide" id="listeVide" hidden>
          <b>Aucun client Dofus détecté</b>
          Lance tes clients maintenant : OMNI doit tourner AVANT eux pour pouvoir les suivre.
        </div>
      </div>
    </div>
```

Notes pour qui exécute ce Step :
- `id="entete"` et `id="liste"` sont conservés à l'identique : `document.querySelectorAll('[data-colonne]')` (script, ~ligne 2618) et `document.getElementById('liste')` (script, ~ligne 3106) continuent de les trouver sans changement.
- Le `<h1>`/`<p>` de `.titre` sont repris texte pour texte de `labo-omni/app.html` (statique, comme le README le dit : « Ce qui bouge pour de vrai dans la maquette : le rail, le bouton de theme, les onglets de Courses. Le reste est statique. »).
- Le sous-titre `.marqueur.sourd` est décoratif (labo-omni/README.md §2 le liste parmi les briques) : aucune donnée dynamique à y poser.

- [ ] **Step 2: Charger la page dans un navigateur pour une première vérification visuelle**

Run: `npm run banc` puis ouvrir `http://localhost:<port>/` (le script annonce le port), écran Raccourcis.
Attendu : l'entête et le panneau prennent la forme de la maquette (fond clair/sombre selon le thème, panneau à coins arrondis) ; la liste elle-même est vide ou incohérente pour l'instant — normal, `creerRang`/`majRang` n'ont pas encore changé (Task 4/5).

- [ ] **Step 3: `npm test` complet**

Run: `npm test`
Attendu : toujours vert en dehors de `skin-raccourcis` (dont les deux tests sur le JS restent rouges, attendu).

- [ ] **Step 4: Commit**

```bash
git add desktop/index.html
git commit -m "refonte(skin): Raccourcis — l ossature statique prend le panneau de la maquette

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `creerRang()` construit le nouveau DOM

**Files:**
- Modify: `desktop/index.html` (script, fonction `creerRang()`, actuellement lignes ~2693-2866 ; et `dansLaPlaque()`, actuellement lignes ~2500-2507)

**Interfaces:**
- Consomme : `CASES` (déjà déclaré, inchangé), `armerSaisie` (fonction existante, inchangée), `ouvrirArchi(pid)` (existante, inchangée), `ouvrirEcartes(ligne)` (existante, inchangée), `droitsCourants` (variable de module existante, inchangée), `window.app.{basculerVersCompte,reglerTouche,definirMaitre,majPrixHdv,mettreEnVenteHdv,fermerUnClient}` (inchangés).
- Produit : un objet `r` dont Task 5 (`majRang`) lit/écrit ces champs : `r.el` (`.ligne`), `r.persoMini`, `r.jeton`, `r.n`, `r.doux`, `r.cabochon`, `r.oter`, `r.cases` (tableau de 5 boutons `.inter`), `r.boutonCommande`, `r.verdict`, `r.hdv`, `r.menuHdv`, `r.majPrix`, `r.vente`, `r.archi`, `r.fermerUn`, `r.motif`, `r.ligne` (état courant, `null` à la création).

- [ ] **Step 1: Renommer `dansLaPlaque` en `dansLeJeton`**

Remplacer (script, ~ligne 2500) :

```js
  function dansLaPlaque(ligne) {
    if (ligne.embleme) {
      return '<img src="' + ligne.embleme + '" alt="' + (ligne.classe || '') + '">';
    }
    if (!ligne.classe) return '<span></span>';
    const court = ligne.classe.length <= 4 ? ligne.classe : ligne.classe.slice(0, 3);
    return '<span>' + court + '</span>';
  }
```

par :

```js
  function dansLeJeton(ligne) {
    if (ligne.embleme) {
      return '<img src="' + ligne.embleme + '" alt="' + (ligne.classe || '') + '">';
    }
    if (!ligne.classe) return '<span></span>';
    const court = ligne.classe.length <= 4 ? ligne.classe : ligne.classe.slice(0, 3);
    return '<span>' + court + '</span>';
  }
```

(Seul le nom change — le corps est identique, il vise désormais `.jeton` au lieu de `.plaque`.)

- [ ] **Step 2: Réécrire `creerRang()`**

Remplacer toute la fonction (script, ~lignes 2693-2866, de `function creerRang() {` à son `}` fermant juste avant `function majRang(r, l) {`) par :

```js
  function creerRang() {
    const r = { ligne: null };

    r.el = document.createElement('div');
    r.el.className = 'ligne';

    // L'identite bascule sur la fenetre du personnage au clic : c'est le
    // geste le plus frequent en multicompte, il merite la plus grande
    // cible de la ligne -- desormais la carte perso entiere, pas juste le
    // portrait ou juste le nom separement.
    r.persoMini = document.createElement('span');
    r.persoMini.className = 'perso-mini';
    r.jeton = document.createElement('span');
    r.jeton.className = 'jeton';
    const identite = document.createElement('span');
    r.n = document.createElement('span');
    r.n.className = 'n';
    r.doux = document.createElement('span');
    r.doux.className = 'doux';
    identite.append(r.n, document.createElement('br'), r.doux);
    r.persoMini.append(r.jeton, identite);
    r.persoMini.addEventListener('click', () => {
      const l = r.ligne;
      if (l && l.id !== null && l.pilotable) window.app.basculerVersCompte(l.id);
    });
    r.el.append(r.persoMini);

    const celluleTouche = document.createElement('span');
    celluleTouche.className = 'cellule-touche';
    r.cabochon = document.createElement('button');
    r.cabochon.className = 'cabochon';
    r.cabochon.addEventListener('click', () => {
      const l = r.ligne;
      if (!l || l.id === null) return;
      armerSaisie(r.cabochon, (a) => window.app.reglerTouche(l.id, a));
    });
    // La corbeille retire le raccourci. Elle ne parait que s il y en a un:
    // un bouton qui n aurait rien a supprimer serait une promesse vide.
    r.oter = document.createElement('button');
    r.oter.className = 'oter';
    r.oter.title = 'retirer ce raccourci';
    r.oter.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" '
      + 'stroke-width="1.5" stroke-linecap="round"><path d="M2.5 3.5h9"/>'
      + '<path d="M5.5 3.5V2.2h3v1.3"/><path d="M3.6 3.5l.6 8.3h5.6l.6-8.3"/>'
      + '<path d="M5.9 5.8v3.7M8.1 5.8v3.7"/></svg>';
    r.oter.addEventListener('click', () => {
      const l = r.ligne;
      if (!l || l.id === null) return;
      window.app.reglerTouche(l.id, null);
    });
    celluleTouche.append(r.cabochon, r.oter);
    r.el.append(celluleTouche);

    r.cases = CASES.map((c) => {
      const b = document.createElement('button');
      b.className = 'inter';
      b.addEventListener('click', () => {
        const l = r.ligne;
        if (!l || l.id === null) return;
        c.envoyer(l, !valeurCase(l, c));
      });
      r.el.append(b);
      return b;
    });

    // Une seule cellule a droite, dont le CONTENU change: bouton ou verdict.
    // Les montrer a tour de role en detruisant celui qui ne sert pas
    // ramenerait exactement le probleme qu'on vient de supprimer.
    const d = document.createElement('span');
    d.className = 'd';
    r.boutonCommande = document.createElement('button');
    r.boutonCommande.className = 'bt-vide';
    r.boutonCommande.addEventListener('click', () => {
      const l = r.ligne;
      if (!l || !l.eligibleMaitre) return;
      window.app.definirMaitre(l.estMaitre ? null : l.id);
    });
    r.verdict = document.createElement('span');
    r.verdict.className = 'pastille-etat';
    d.append(r.boutonCommande, r.verdict);
    r.el.append(d);

    // LE MENU HDV DE CETTE LIGNE.
    //
    // Deux entrees: la mise a jour des prix et la mise en vente, chacune
    // inerte tant que son stock n'est pas connu. Cacher une entree inerte
    // ferait croire qu'elle n'est pas prevue.
    r.hdv = document.createElement('button');
    r.hdv.className = 'hdv bt-vide';
    r.hdv.textContent = 'HDV';
    r.menuHdv = document.createElement('div');
    r.menuHdv.className = 'menu-hdv';
    r.menuHdv.hidden = true;
    r.majPrix = document.createElement('button');
    r.vente = document.createElement('button');
    r.menuHdv.append(r.majPrix, r.vente);

    // Un seul menu ouvert a la fois: deux menus superposes se recouvrent, et on
    // ne sait plus lequel repond au clic.
    r.hdv.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const etaitOuvert = !r.menuHdv.hidden;
      for (const m of document.querySelectorAll('.menu-hdv')) m.hidden = true;
      r.menuHdv.hidden = etaitOuvert;
    });
    r.majPrix.addEventListener('click', () => {
      const l = r.ligne;
      r.menuHdv.hidden = true;
      if (!l || l.pid === null || l.pid === undefined) return;
      if (!droitsCourants.includes('hdv')) return;
      if (!l.hdvEnCours && !l.hdvLots) return;
      window.app.majPrixHdv(l.pid);
    });
    r.vente.addEventListener('click', () => {
      const l = r.ligne;
      r.menuHdv.hidden = true;
      if (!l || l.pid === null || l.pid === undefined) return;
      if (!droitsCourants.includes('vente')) return;
      if (!l.hdvVenteEnCours && !l.hdvPiles) return;
      window.app.mettreEnVenteHdv(l.pid);
    });
    r.el.append(r.hdv, r.menuHdv);

    // LE BOUTON ARCHI DE CETTE LIGNE. Il porte le compte de ce personnage et
    // ouvre le tableau sur sa colonne. Il n'envoie AUCUN ordre au jeu: OMNI a
    // deja tout ce qu'il faut, l'inventaire etant arrive seul a la connexion.
    r.archi = document.createElement('button');
    r.archi.className = 'archi bt-vide';
    r.archi.addEventListener('click', () => {
      const l = r.ligne;
      if (!l || l.pid === null || l.pid === undefined) return;
      ouvrirArchi(l.pid);
    });
    r.el.append(r.archi);

    // Le pouvoir de coupure de CE client. Premier clic arme, second ferme, et
    // l armement retombe seul: meme regle que le bouton qui les ferme tous.
    r.fermerUn = document.createElement('button');
    r.fermerUn.className = 'fermer-un';
    r.fermerUn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" '
      + 'stroke-width="1.6" stroke-linecap="round"><path d="M7 2.4v4.4"/>'
      + '<path d="M10.5 3.9a4.6 4.6 0 1 1-7 0"/></svg>';
    let armeFermeture = null;
    const desarmer = () => {
      if (armeFermeture !== null) clearTimeout(armeFermeture);
      armeFermeture = null;
      r.fermerUn.classList.remove('confirme');
      r.fermerUn.title = 'fermer ce client';
    };
    r.fermerUn.addEventListener('click', () => {
      const l = r.ligne;
      if (!l || l.id === null) return;
      if (armeFermeture !== null) {
        desarmer();
        window.app.fermerUnClient(l.id);
        return;
      }
      r.fermerUn.classList.add('confirme');
      r.fermerUn.title = 'cliquer à nouveau pour fermer';
      armeFermeture = setTimeout(desarmer, 3000);
    });
    r.el.append(r.fermerUn);

    r.motif = document.createElement('div');
    r.motif.className = 'motif';
    // LE COMPTE RENDU OUVRE SON PROPRE DETAIL. C'est le seul endroit ou le
    // nombre de lots ecartes est affiche, donc le seul endroit ou on pense a
    // demander lesquels: un bouton ailleurs dans le menu serait cherche apres
    // coup, ou jamais.
    r.motif.addEventListener('click', () => ouvrirEcartes(r.ligne));
    r.el.append(r.motif);

    return r;
  }
```

Différences avec l'ancienne version, à garder en tête pour la relecture : `r.portrait`/`r.nom` fusionnent en `r.persoMini` (un seul écouteur de clic au lieu de deux identiques) ; `r.droite` disparaît (c'était juste le conteneur `d`, gardé en variable locale) ; `.case`/`.los` deviennent `.inter` (pas de `<span>` interne, `.inter` se dessine par `::after`) ; `.bouton-commande` devient `.bt-vide` ; `.verdict` garde son nom de variable mais porte `pastille-etat`. Aucun appel `window.app.*` ni aucune condition métier ne change.

- [ ] **Step 3: `npm test` complet**

Run: `npm test`
Attendu : `test/skin-raccourcis.test.js` → le test sur les classes JS passe désormais (`creerRang`/`majRang ne construisent plus les anciennes classes` — même si `majRang` n'a pas encore changé, `creerRang` seul suffit à faire disparaître `'rang'`/`'plaque'`/`'case'`/`'zone-clic'` du texte source scanné ; `'verdict'`/`'bouton-commande'` disparaissent aussi car ce sont les noms de *variable*, pas de classe, dans le nouveau code). Le reste de la suite reste vert.

- [ ] **Step 4: Commit**

```bash
git add desktop/index.html
git commit -m "refonte(skin): creerRang construit le DOM de la maquette

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `majRang()` peuple le nouveau DOM

**Files:**
- Modify: `desktop/index.html` (script, fonction `majRang()`, actuellement lignes ~2868-3001)

**Interfaces:**
- Consomme : les champs de `r` produits par Task 4 ; `FORME`, `LIBELLE`, `risqueDe`, `libelleTouche`, `dansLeJeton`, `valeurCase`, `CASES`, `droitsCourants` (tous existants, `dansLeJeton` renommé en Task 4).
- Produit : rien de nouveau — c'est la dernière fonction du duo, appelée depuis `window.app.surEtat(...)` (inchangé, ~ligne 3119-3120).

- [ ] **Step 1: Réécrire `majRang()`**

Remplacer toute la fonction (script, ~lignes 2868-3001) par :

```js
  function majRang(r, l) {
    r.ligne = l;

    const alerte = l.etat === 'non-intercepte' || l.etat === 'erreur';
    r.el.className = 'ligne'
      + (l.etat === 'hors-ligne' ? ' hors-ligne' : '')
      + (alerte ? ' alerte' : '')
      + (l.estMaitre ? ' commande' : '');

    const pilotable = l.id !== null && l.pilotable;
    r.persoMini.classList.toggle('clic', pilotable);
    r.jeton.innerHTML = dansLeJeton(l);
    r.jeton.title = l.classe || 'classe inconnue, personnage pas encore en jeu';

    const principal = l.personnage || l.nickname;
    const second = l.personnage ? l.nickname : 'pas encore en jeu';
    r.n.textContent = principal;
    r.doux.textContent = second;
    r.doux.classList.toggle('absent', !l.personnage);
    r.persoMini.title = (l.personnage ? l.personnage + ' · ' + l.nickname : l.nickname)
      + (pilotable ? ' (cliquer pour passer sur cette fenêtre)' : '');

    // Le cabochon ne se reecrit pas pendant une saisie de touche, sinon le
    // « frappe… » disparaitrait sous les doigts de l'utilisateur.
    if (!r.cabochon.classList.contains('ecoute')) {
      const raison = risqueDe(l.touche);
      r.cabochon.className = 'cabochon'
        + (l.touche ? '' : ' sans-touche')
        + (raison ? ' risque' : '');
      r.cabochon.textContent = l.touche ? libelleTouche(l.touche) : 'aucune';
      r.cabochon.disabled = l.id === null;
      r.cabochon.title = raison || 'Cliquer puis frapper une touche ou un bouton de souris. Échap annule.';
    }
    r.oter.hidden = !l.touche;

    r.cases.forEach((b, i) => {
      const actif = valeurCase(l, CASES[i]);
      // Une case dont le droit n est pas accorde reste cliquable sans ca: la
      // porte bloquerait bien la trame plus loin, mais en silence -- ni le
      // clic ni favoris.json ne diraient pourquoi rien ne se passe.
      const bloque = CASES[i].droit && !droitsCourants.includes(CASES[i].droit);
      b.classList.toggle('on', actif);
      b.disabled = !pilotable || bloque;
      b.setAttribute('aria-pressed', String(actif));
      b.title = bloque ? 'pas activé sur ta clé' : '';
    });

    // A DROITE: le bouton OU le verdict, jamais les deux. Un compte non
    // eligible ne peut pas commander, et lui proposer le geste serait la
    // promesse d'un role qu'il ne peut pas tenir.
    if (l.eligibleMaitre) {
      r.boutonCommande.hidden = false;
      r.verdict.hidden = true;
      r.boutonCommande.classList.toggle('pleine', l.estMaitre);
      r.boutonCommande.textContent = l.estMaitre ? 'Commande' : 'Désigner';
      r.boutonCommande.title = l.estMaitre
        ? 'ce compte commande — cliquer pour ne plus avoir de meneur'
        : 'faire commander ce compte';
    } else {
      r.boutonCommande.hidden = true;
      r.verdict.hidden = false;
      // Deux etiquettes seulement, sous la regle "forme avant couleur":
      // "attente" (ca patiente, rien a faire) reste neutre ; tout le reste
      // (hors-ligne, non-intercepte, erreur) est un bloc inverse -- c'est
      // exactement ce que montre la maquette pour "Pas entré"/"Pas lancé".
      const forme = FORME[l.etat] || 'calme';
      r.verdict.className = 'pastille-etat' + (forme === 'attente' ? ' attente' : ' creux');
      r.verdict.textContent = LIBELLE[l.etat] || l.etat;
    }

    // Un compte hors ligne n a pas de fenetre a fermer: le bouton serait la
    // promesse d un geste sans effet.
    const aUneFenetre = l.id !== null && l.pid !== null && l.pid !== undefined && l.etat !== 'hors-ligne';
    r.fermerUn.disabled = !aUneFenetre;
    if (!aUneFenetre) r.fermerUn.classList.remove('confirme');
    if (!r.fermerUn.title) r.fermerUn.title = 'fermer ce client';

    // LE COMPTE D'ARCHIMONSTRES. `null` veut dire « inventaire pas encore lu »,
    // et il s'affiche `—`: un zero le ferait passer pour un personnage sans une
    // seule ame, alors qu'on n'en sait rien. C'est la lecon du 03/09, un
    // silence qui ressemble a une reponse.
    const archiLu = l.archi !== null && l.archi !== undefined;
    r.archi.textContent = archiLu ? String(l.archi) : '—';
    r.archi.disabled = !archiLu;
    r.archi.classList.toggle('pleine', archiLu && l.archi > 0);
    r.archi.title = archiLu
      ? l.archi + ' archimonstre(s) en inventaire — ouvrir le tableau'
      : 'inventaire pas encore lu : ce client a-t-il été lancé après OMNI ?';

    // Le menu n'a de sens que sur un client en jeu, et seulement si la cle a
    // AU MOINS UN des deux droits: ses deux entrees se verrouillent
    // separement. `hdvLots` a zero veut dire que kby n'est jamais passee.
    const droitHdv = droitsCourants.includes('hdv');
    const droitVente = droitsCourants.includes('vente');
    const enJeu = l.pid !== null && l.pid !== undefined && l.etat !== 'hors-ligne';
    const hdvPossible = (droitHdv || droitVente) && enJeu;
    r.hdv.disabled = !hdvPossible;
    if (!hdvPossible) r.menuHdv.hidden = true;
    r.hdv.classList.toggle('tourne', Boolean(l.hdvEnCours || l.hdvVenteEnCours));
    r.hdv.title = !droitHdv && !droitVente
      ? 'pas activé sur ta clé'
      : l.hdvEnCours ? 'une mise à jour des prix est en cours'
      : l.hdvVenteEnCours ? 'une mise en vente est en cours' : 'hôtel de vente';
    // Chaque entree sous son propre droit, inerte plutot que cachee -- meme
    // raison qu'au stock inconnu: une entree absente ferait croire qu'elle
    // n'est pas prevue, alors qu'elle est seulement pas accordee.
    if (!droitHdv) {
      r.majPrix.textContent = 'Mettre à jour — pas activé sur ta clé';
      r.majPrix.classList.add('inerte');
    } else if (l.hdvEnCours) {
      r.majPrix.textContent = 'Arrêter la mise à jour';
      r.majPrix.classList.remove('inerte');
    } else if (l.hdvLots) {
      r.majPrix.textContent = 'Mettre à jour les prix (' + l.hdvLots + ' lots)';
      r.majPrix.classList.remove('inerte');
    } else {
      r.majPrix.textContent = 'Mettre à jour — ouvre l’HDV une fois';
      r.majPrix.classList.add('inerte');
    }
    if (!droitVente) {
      r.vente.textContent = 'Mettre en vente — pas activé sur ta clé';
      r.vente.classList.add('inerte');
    } else if (l.hdvVenteEnCours) {
      r.vente.textContent = 'Arrêter la mise en vente';
      r.vente.classList.remove('inerte');
    } else if (l.hdvPiles) {
      r.vente.textContent = 'Mettre en vente (' + l.hdvPiles + ' piles)';
      r.vente.classList.remove('inerte');
    } else {
      r.vente.textContent = 'Mettre en vente — ouvre l’HDV une fois';
      r.vente.classList.add('inerte');
    }

    r.motif.hidden = !l.message;
    r.motif.textContent = l.message || '';
    r.motif.classList.toggle('cliquable', Boolean(l.hdvEcartes));
    r.motif.title = l.hdvEcartes ? 'voir les lots écartés et pourquoi' : '';
  }
```

Seuls trois points changent par rapport à l'ancienne version : `r.boutonCommande.classList.toggle('on', ...)` devient `.toggle('pleine', ...)`, le `r.verdict.className`/`textContent` passe de `'verdict ' + forme` (trois valeurs) à `'pastille-etat' + (attente ? ' attente' : ' creux')` (deux valeurs — voir le commentaire ajouté dans le code), et `r.portrait.innerHTML`/`r.nom.innerHTML` (deux blocs séparés) deviennent `r.jeton.innerHTML`/`r.n.textContent`/`r.doux.textContent` (trois champs distincts posés directement, plus besoin de composer une chaîne HTML).

- [ ] **Step 2: `npm test` complet**

Run: `npm test`
Attendu : `test/skin-raccourcis.test.js` entièrement vert. Toute la suite verte (mêmes échecs préexistants que ceux déjà connus du dépôt — dépendance `serveur-maj`, sockets bloquées en bac à sable — aucun nouveau).

- [ ] **Step 3: Recette visuelle au banc**

Run: `npm run banc`, ouvrir l'écran Raccourcis, comparer à `node labo-omni/serveur.js` → `http://localhost:8731/app.html` écran Raccourcis.
Vérifier au minimum :
- le panneau, les 60px de hauteur de ligne, le jeton de classe, le cabochon de touche ;
- les cinq interrupteurs `.inter` s'allument/s'éteignent au clic et suivent l'état réel (pas de client réel disponible en dehors d'Electron : simuler avec les outils de dev si besoin, ou passer directement à l'étape suivante) ;
- en thème clair ET sombre (bouton de thème dans `.haut`) : le cabochon, les pastilles, le liseré du meneur restent lisibles dans les deux.

- [ ] **Step 4: Recette en vrai Electron**

Run: `npm run app`
Vérifier : basculer vers la fenêtre d'un personnage (clic sur `.perso-mini`), armer/désarmer un interrupteur, désigner un meneur, ouvrir le menu HDV d'une ligne (clic hors du menu le referme), ouvrir Archimonstres depuis le bouton Archi d'une ligne, fermer un client (double clic avec le délai de confirmation de 3s).

- [ ] **Step 5: Commit**

```bash
git add desktop/index.html
git commit -m "refonte(skin): majRang peuple le DOM de la maquette

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Hors périmètre

- **L'extraction en module `desktop/vues/raccourcis.js`** prévue par `docs/superpowers/plans/2026-09-14-refonte-fenetre-principale-ossature.md` (§"Le découpage des fichiers") : `window.app.surEtat(...)` sert dans ce même callback plusieurs écrans pas encore portés (rythme HDV, garde-fous, overlay, bandeaux) ; extraire proprement seulement la part Raccourcis sans casser les autres est un chantier à part, à faire une fois que Hôtel/Réglages seront eux aussi portés. `ipcRenderer.on` acceptant plusieurs abonnements (vérifié dans `desktop/preload.js:17`), l'extraction future pourra poser son propre `window.app.surEtat(...)` dans `raccourcis.js` sans toucher à celui d'`index.html`.
- **Les corrections de contraste de `tasks/rapport-audit-skin.md`** (le jaune invisible en thème clair, `--acide-sur-contre` en thème sombre, etc.) : elles concernent les jetons globaux (`jetons.css`), pas seulement Raccourcis, et touchent d'autres écrans pas encore portés. À traiter dans une tâche dédiée.
- **La fusion Raccourcis / « Ma flotte »** proposée par l'audit (§2.2) : la maquette actuelle ne la fait pas, ni le plan d'ossature accepté. Pas dans ce plan.
- **`desktop/vues/commun/touches.js`** (copie de `src/comptes/raccourcis.js`) et la réécriture de `test/souris-copie.test.js` qui va avec : liée à l'extraction en module ci-dessus, pas à cette tâche.

---

## Self-Review

- **Couverture du spec** : les deux écarts assumés de l'ossature (HDV, Archi gardés) sont dans la grille et les briques de Task 2/4. Les quatre règles du labo (forme avant couleur, jaune = mène/tourne, bloc inversé = à faire, `--encre` ≠ `--alarme`) sont citées en Global Constraints et appliquées concrètement : `.ligne.commande` (liseré, pas aplat), `.hdv.tourne` (jaune), `.pastille-etat.creux`/`.attente` (inversé vs neutre, jamais confondus avec le texte).
- **Aucun placeholder** : chaque étape de code porte le texte exact à écrire ou à retirer, avec les bornes précises (commentaires de repère, contenu littéral des blocs à supprimer).
- **Cohérence des types/noms** : `dansLeJeton` (Task 4, Step 1) est le seul nouveau nom de fonction, utilisé une seule fois (Task 5, Step 1, `r.jeton.innerHTML = dansLeJeton(l)`) — pas de désaccord avec un ancien nom ailleurs dans le plan. `r.verdict`/`r.boutonCommande` gardent leurs noms de variable de Task 4 à Task 5.
