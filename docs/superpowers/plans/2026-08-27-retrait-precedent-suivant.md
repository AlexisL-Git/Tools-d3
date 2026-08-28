# Retrait de « précédent » et « suivant » — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirer les deux raccourcis de navigation cyclique, devenus inutiles depuis que chaque compte porte sa propre touche ou son propre bouton de souris — et rendre `Ctrl+←` / `Ctrl+→` à Dofus.

**Architecture:** Un retrait, pas une réécriture. Quatre couches à défaire dans l'ordre : l'interface et son canal IPC, la mécanique de cycle, le stockage du réglage, puis un renommage qui enlève un piège. Chaque tâche laisse la suite verte.

**Tech Stack:** Node 22 + `node:test`, Electron 43. Aucune dépendance touchée.

**Spec :** `docs/superpowers/specs/2026-08-27-retrait-precedent-suivant-design.md`

## Global Constraints

- **`npm test` doit être vert à chaque commit.** 635 tests au départ ; le total baisse au fur et à mesure des suppressions, c'est attendu.
- **Commentaires en français sans accents** dans les `.js` et dans le JavaScript de `index.html`. Accents admis dans les chaînes affichées à l'utilisateur, dans le CSS et dans le HTML.
- **Ne rien retirer qui serve encore ailleurs.** Quatre pièges nommés, vérifiés : `ordonner()` vit dans le module du cycle mais trie les lignes affichées, donc le fichier ne s'efface pas ; `ordreNavigation` alimente « Fermer les clients » ; `noterAvis` / `avisNav` servent aux raccourcis par compte ; `libelleTouche` et `risqueDe` servent aux lignes de compte. Aucun des trois ne disparaît.
- **`test/pont-ipc.test.js` est le filet.** Il vérifie sur le source que `index.html`, `preload.js` et `main.js` s'accordent sur les canaux IPC, dans les deux sens. Un retrait fait à moitié le rend rouge. Ne jamais le modifier pour faire passer une tâche.
- **Ne pas toucher aux marqueurs de copie** de `desktop/index.html` (`// >>> COPIE DE …`, `// >>> TABLE D'AFFICHAGE …`) : `test/souris-copie.test.js` exécute ce qu'ils encadrent et le compare au module.

---

### Task 1: Retirer l interface, le canal et le raccourci

**Files:**
- Modify: `desktop/index.html`
- Modify: `desktop/preload.js:43`
- Modify: `desktop/main.js`

**Interfaces:**
- Consumes: rien.
- Produces: après cette tâche, `naviguer()` et `favoris.touchesNav()` n'ont plus aucun appelant. Les tâches 2 et 3 les suppriment.

**Pourquoi ces trois fichiers ensemble :** `test/pont-ipc.test.js` exige qu'un canal IPC existe dans les trois ou dans aucun. Les séparer rendrait la suite rouge entre deux commits.

- [ ] **Step 1: Retirer les deux boutons du pied**

Dans `desktop/index.html`, supprimer les deux lignes :

```html
  <span class="paire">Précédent <button class="cabochon" id="navPrec" data-nav="precedent">—</button></span>
  <span class="paire">Suivant <button class="cabochon" id="navSuiv" data-nav="suivant">—</button></span>
```

Le reste de `<div class="barre-nav">` — la zone d'avis, le séparateur, le délai, l'avertissement de doublon, le bouton de fermeture — ne bouge pas.

- [ ] **Step 2: Retirer la règle CSS devenue morte**

Toujours dans `desktop/index.html`, supprimer :

```css
  .barre-nav .cabochon { width: auto; min-width: 62px; display: inline-block; text-transform: none; letter-spacing: .04em; }
```

C'était la seule règle visant les cabochons du pied, et il n'y en a plus.

**Ne pas toucher à `.paire`** (`desktop/index.html:261`) : l'avertissement de doublon la porte encore.

- [ ] **Step 3: Retirer les deux boucles `[data-nav]`**

Supprimer la boucle d'armement de saisie :

```js
  // --- les deux touches de navigation, en pied ----------------------------
  for (const b of document.querySelectorAll('[data-nav]')) {
    b.addEventListener('click', () => {
      armerSaisie(b, (a) => window.app.reglerToucheNav(b.dataset.nav, a));
    });
  }
```

Et la boucle de rafraîchissement, commentaire compris :

```js
    // Les deux touches de navigation viennent du fichier de reglages, comme
    // tout le reste: le clic ne fait que demander, l'etat fait foi.
    for (const b of document.querySelectorAll('[data-nav]')) {
      if (b.classList.contains('ecoute')) continue;
      const a = (etat.nav || {})[b.dataset.nav];
      b.textContent = libelleTouche(a) || 'aucune';
      b.classList.toggle('sans-touche', !a);
      b.classList.toggle('risque', risqueDe(a));
    }
```

**Attention :** `libelleTouche` et `risqueDe` restent utilisés par les lignes de compte. Ne pas les supprimer.

- [ ] **Step 4: Fermer le canal dans le preload**

Dans `desktop/preload.js`, supprimer la ligne :

```js
  reglerToucheNav: (nom, accelerateur) => ipcRenderer.invoke('reglerToucheNav', nom, accelerateur),
```

Le commentaire qui la précède parle des raccourcis en général et couvre encore `reglerTouche` : l'ajuster s'il mentionne la navigation, sans le supprimer.

- [ ] **Step 5: Retirer le gestionnaire côté principal**

Dans `desktop/main.js`, supprimer le bloc :

```js
ipcMain.handle('reglerToucheNav', async (_e, nom, accelerateur) => {
  if (typeof nom !== 'string' || typeof accelerateur !== 'string') return;
  favoris.reglerToucheNav(nom, accelerateur);
  poserRaccourcis();
  await envoyerEtat();
});
```

- [ ] **Step 6: Retirer l enregistrement des deux raccourcis**

Dans `desktop/main.js`, à la fin de `poserRaccourcis()`, supprimer :

```js
  const nav = favoris.touchesNav();
  poser(nav.suivant, () => naviguer(1));
  poser(nav.precedent, () => naviguer(-1));
```

La boucle `for (const [idTexte, accelerateur] of Object.entries(favoris.touches()))` juste au-dessus reste, ainsi que l'appel `superviseur.reglerSouris(...)` juste en dessous.

- [ ] **Step 7: Retirer le champ `nav` de l état envoyé**

Dans `desktop/main.js`, dans `envoyerEtat`, supprimer la ligne :

```js
    nav: favoris.touchesNav(),
```

- [ ] **Step 8: Vérifier**

Run: `node --check desktop/main.js && node --check desktop/preload.js && npm test`
Expected: `syntaxe OK` deux fois, puis `fail 0`. `test/pont-ipc.test.js` doit passer : c'est lui qui prouve que le canal est parti des trois fichiers.

Si `pont-ipc` est rouge, un des trois endroits a été oublié — le message du test nomme lequel. **Ne pas modifier le test.**

- [ ] **Step 9: Commit**

```bash
git add desktop/index.html desktop/preload.js desktop/main.js
git commit -m "feat: retirer precedent et suivant de l'interface

Le cycle n'a plus d'usage depuis que chaque compte porte sa propre
touche ou son propre bouton de souris: on va directement au compte
voulu au lieu de compter les crans.

Les deux boutons du pied, leur canal IPC et l'enregistrement des deux
raccourcis partent ensemble — pont-ipc.test.js exige qu'un canal existe
dans les trois fichiers ou dans aucun.

Ctrl+fleches sont rendues a Dofus: ces deux accelerateurs etaient
enregistres en global des l'installation, donc confisques au jeu tant
qu'OMNI tournait."
```

---

### Task 2: Retirer la mecanique de cycle

**Files:**
- Modify: `desktop/main.js`
- Rename + modify: `src/comptes/navigation.js` → `src/comptes/ordre.js`
- Rename + modify: `test/comptes-navigation.test.js` → `test/comptes-ordre.test.js`

**Interfaces:**
- Consumes: la tâche 1 a retiré les deux seuls appelants de `naviguer()`.
- Produces: `src/comptes/ordre.js` n'exporte plus que `ordonner(lignes, ordre)`, importé par `desktop/main.js`.

**LE PIÈGE DE CETTE TÂCHE, et il a déjà failli coûter cher.** La première rédaction de la conception affirmait que `src/comptes/navigation.js` n'existait que pour précédent/suivant et pouvait être effacé. **C'est faux.** Le module exporte trois choses, et `ordonner(lignes, ordre)` est appelé par `desktop/main.js:544` pour trier les lignes affichées — rien à voir avec le cycle. Supprimer le fichier casserait l'affichage de la liste des comptes.

Ce qui part est l'**intérieur** du module, pas le module.

- [ ] **Step 1: Retirer `naviguer()`**

Dans `desktop/main.js`, supprimer la fonction entière, commentaires compris :

```js
function naviguer(pas) {
  // Meme raison que ci-dessus: l'ordre affiche est deja connu, et une touche de
  // navigation doit repondre a l'instant.
  //
  // Seuls les clients qu'OMNI pilote: basculer vers un client sans agent
  // echouerait sans rien dire d'utile.
  const navigables = ordreNavigation.filter((p) => superviseur.clients.has(p));
  if (navigables.length === 0) {
    noterAvis(ordreNavigation.length === 0
      ? 'aucun client Dofus détecté'
      : 'aucun client piloté par OMNI — lance-les APRÈS OMNI');
    envoyerEtat();
    return;
  }

  // Le curseur peut designer un client ferme entre-temps: suivant() et
  // precedent() entrent alors par le bout correspondant au sens demande.
  const cible = pas > 0 ? suivant(navigables, curseurNav) : precedent(navigables, curseurNav);
  if (cible === null) return;
  poserCurseur(cible);
  const r = superviseur.basculerVers(cible);
  if (!r.ok) {
    journal(cible, `navigation refusee : ${r.raison}`);
    noterAvis(`navigation impossible : ${r.raison}`);
    envoyerEtat();
  }
}
```

- [ ] **Step 2: Retirer le curseur**

Toujours dans `desktop/main.js`, supprimer `poserCurseur` et son commentaire :

```js
// Le clic sur une identite deplace le curseur, sinon le raccourci suivant
// repartirait d'ou on etait avant le clic.
function poserCurseur(pid) {
  curseurNav = pid;
}
```

Supprimer la déclaration `let curseurNav = null;` et le long commentaire qui l'introduit — le bloc commençant par `// LE CURSEUR DU CYCLE, et rien d'autre.` Il décrit une mécanique qui n'existe plus.

Supprimer enfin l'appel `poserCurseur(pid);` dans `basculerVersCompte` : il ne nourrissait que le cycle.

- [ ] **Step 3: Réduire l import**

Remplacer :

```js
const { ordonner, suivant, precedent } = require('../src/comptes/navigation');
```

par :

```js
const { ordonner } = require('../src/comptes/ordre');
```

- [ ] **Step 4: Renommer le module et le vider de son cycle**

```bash
git mv src/comptes/navigation.js src/comptes/ordre.js
```

Dans le fichier renommé, supprimer `deplacer()` avec son commentaire, ainsi que les deux fléchettes qui l'habillent :

```js
const suivant = (pids, courant) => deplacer(pids, courant, 1);
const precedent = (pids, courant) => deplacer(pids, courant, -1);
```

Réduire l'export à :

```js
module.exports = { ordonner };
```

**Réécris l'en-tête du fichier.** Il dit aujourd'hui « L'ordre de l'equipe, et le deplacement dans cet ordre », et justifie l'ordre par la mémoire musculaire d'une touche « personnage suivant » qui n'existe plus. L'ordre reste structurant, mais pour d'autres raisons : c'est celui qu'affiche le panneau, et c'est la liste que « fermer les clients » parcourt. Dis cela, sans inventer : ne garde de l'ancien commentaire que ce qui est encore vrai.

- [ ] **Step 5: Renommer le test et retirer les cas du cycle**

```bash
git mv test/comptes-navigation.test.js test/comptes-ordre.test.js
```

Dans le fichier renommé, corriger l'import en tête pour ne plus prendre que `ordonner` depuis `../src/comptes/ordre`.

Supprimer les **sept** tests portant sur le déplacement, dont les titres sont :

```
suivant avance dans la liste
suivant reboucle sur le premier
précédent recule et reboucle sur le dernier
sans point de départ connu, suivant prend le premier
sans point de départ connu, précédent prend le dernier
une liste vide ne donne aucune cible
un seul client se rend lui-même, sans osciller
```

Garder les **six** tests de `ordonner`, qui commencent à `sans ordre enregistré, la liste ne bouge pas` et finissent à `ordonner ne modifie pas la liste reçue`. Ne toucher ni à leur code ni à leurs commentaires.

- [ ] **Step 6: Vérifier**

Run: `grep -rn "comptes/navigation\|precedent(\|suivant(" --include="*.js" --include="*.html" src/ desktop/ test/ outils/ | grep -v etape-paquet`
Expected: aucune sortie. Toute ligne restante signale un appelant oublié.

Run: `node --check desktop/main.js && npm test`
Expected: `fail 0`. Le total baisse de sept — note le nouveau total dans ton rapport.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: retirer le cycle, garder le tri des lignes

naviguer(), le curseur et deplacer() n'ont plus d'appelant depuis que
les deux raccourcis sont partis.

Le MODULE, lui, reste: ordonner() y vit aussi, et desktop/main.js s'en
sert pour trier les lignes affichees. La conception affirmait d'abord
que le fichier n'existait que pour le cycle — verification faite, c'est
faux, et l'effacer aurait casse l'affichage de la liste.

Il est renomme src/comptes/ordre.js: un fichier nomme « navigation » qui
ne contient plus que du tri est le meme piege qu'on retire par ailleurs
en renommant ordreNavigation."
```

---

### Task 3: Retirer le stockage du reglage

**Files:**
- Modify: `src/comptes/favoris.js`
- Test: `test/comptes-favoris.test.js`

**Interfaces:**
- Consumes: la tâche 1 a retiré le dernier appelant de `touchesNav()` et `reglerToucheNav()`.
- Produces: le fichier de réglages n'a plus de clé `nav`.

**Pas de migration.** Un `favoris.json` existant contient encore `nav` : le lecteur cesse de la lire — il ignore déjà toute clé inconnue — et le prochain enregistrement écrit l'objet sans elle.

- [ ] **Step 1: Mettre les tests à jour d abord**

Dans `test/comptes-favoris.test.js` :

Supprimer les trois tests portant sur la navigation, dont les titres sont `la navigation a des touches par défaut`, `les touches de navigation se règlent et survivent`, et `un nom de navigation inconnu est ignoré`.

Retirer `'nav'` des **deux** listes de clés attendues du fichier :

```js
  assert.deepStrictEqual(Object.keys(contenu).sort(), ['actif', 'delai', 'echange', 'favoris', 'invitation', 'maitre', 'noAnim', 'ordre', 'passeTour', 'touches']);
```

Dans le test `un fichier sans les nouvelles clés se lit sans erreur`, supprimer la seule ligne qui parle de navigation :

```js
  assert.strictEqual(f.touchesNav().suivant, 'CommandOrControl+Right');
```

Les autres assertions de ce test restent.

Ajuster enfin le commentaire de section qui annonce « Un raccourci par compte, plus les deux touches de navigation » : il ne reste que le raccourci par compte.

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `node --test test/comptes-favoris.test.js`
Expected: FAIL sur les deux listes de clés — le fichier écrit contient encore `nav`, que le test n'attend plus.

C'est l'ordre voulu : le test dit ce que le fichier doit contenir avant que le code ne change.

- [ ] **Step 3: Retirer le stockage**

Dans `src/comptes/favoris.js`, supprimer :

```js
// Les deux deplacements dans l'equipe. Ctrl et les fleches par defaut: un
// raccourci GLOBAL confisque la touche a Dofus tant qu'OMNI tourne, et cette
// combinaison ne sert pas en combat.
const NAV_DEFAUT = {
  precedent: 'CommandOrControl+Left',
  suivant: 'CommandOrControl+Right',
};
```

Puis, dans la classe : l'initialisation `this._nav = { ...NAV_DEFAUT };` du constructeur, la remise à zéro `this._nav = { ...NAV_DEFAUT };` du chemin d'erreur de lecture, le bloc de lecture de `json.nav`, les méthodes `touchesNav()` et `reglerToucheNav()`, et la ligne `nav: this._nav,` de l'objet écrit.

Retirer enfin `NAV_DEFAUT` de l'export :

```js
module.exports = { Favoris };
```

**Vérifie que `NAV_DEFAUT` n'est importé nulle part ailleurs** avant de changer l'export :

```bash
grep -rn "NAV_DEFAUT" --include="*.js" --include="*.html" src/ desktop/ test/ outils/ | grep -v etape-paquet
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `node --test test/comptes-favoris.test.js`
Expected: PASS.

- [ ] **Step 5: Vérifier la suite complète**

Run: `npm test`
Expected: `fail 0`. Note le nouveau total dans ton rapport.

- [ ] **Step 6: Commit**

```bash
git add src/comptes/favoris.js test/comptes-favoris.test.js
git commit -m "feat: retirer la cle nav du fichier de reglages

Plus personne ne lit ni n'ecrit les touches de navigation depuis que les
deux raccourcis sont partis.

Aucune migration: un favoris.json existant porte encore la cle, le
lecteur cesse simplement de la lire — il ignore deja toute cle qu'il ne
connait pas — et le prochain enregistrement l'ecrit sans elle."
```

---

### Task 4: Renommer ordreNavigation

**Files:**
- Modify: `desktop/main.js`

**Interfaces:**
- Consumes: rien.
- Produces: rien.

**Pourquoi.** `ordreNavigation` ne sert plus du tout à la navigation — il ne l'a jamais fait exclusivement. Il porte la liste des pids affichés, et c'est elle que le bouton « Fermer les clients » passe à `fermerClients()`. Laisser un nom qui désigne une mécanique supprimée est un piège pour le prochain lecteur : il cherchera un cycle qui n'existe plus, ou pire, croira la variable morte et la supprimera.

- [ ] **Step 1: Relever toutes les occurrences**

Run: `grep -n "ordreNavigation" desktop/main.js`

Attendu après les tâches 1 à 3 : la déclaration, la remise à zéro et le remplissage dans `envoyerEtat`, et l'usage dans le chemin de fermeture des clients. Note-les dans ton rapport.

- [ ] **Step 2: Renommer**

Remplacer chaque occurrence de `ordreNavigation` par `ordreAffiche`, y compris dans le commentaire qui accompagne la déclaration. Adapter ce commentaire pour qu'il dise ce que la variable est vraiment : les pids dans l'ordre où l'interface les affiche, dont se sert la fermeture des clients.

**Ne renomme rien d'autre.** `ordreNavigation` ne doit plus apparaître nulle part ; aucun autre identifiant ne change.

- [ ] **Step 3: Vérifier**

Run: `grep -rn "ordreNavigation" --include="*.js" --include="*.html" src/ desktop/ test/ outils/ | grep -v etape-paquet`
Expected: aucune sortie.

Run: `node --check desktop/main.js && npm test`
Expected: `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add desktop/main.js
git commit -m "refactor: ordreNavigation devient ordreAffiche

Le nom designait une mecanique qui n'existe plus, et la variable n'a
jamais servi qu'a ca: elle porte les pids dans l'ordre affiche, et c'est
cette liste que « fermer les clients » passe a fermerClients().

Un nom qui ment coute une heure au prochain lecteur — soit il cherche un
cycle disparu, soit il croit la variable morte et la supprime."
```

---

### Task 5: Verification en conditions reelles

**Files:** aucun, sauf correctif éventuel.

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: la certitude, ou un défaut nommé.

- [ ] **Step 1: Lancer**

Fermer OMNI, puis :

```bash
cscript //nologo /f/omni_project/outils/lancer-diag.vbs
```

- [ ] **Step 2: Vérifier ce qui a disparu**

Le pied de fenêtre ne doit plus montrer « Précédent » ni « Suivant ». Le délai, l'avertissement de doublon et « Fermer les clients » sont toujours là.

Dans Dofus, `Ctrl+←` et `Ctrl+→` doivent redevenir des touches ordinaires du jeu.

- [ ] **Step 3: Vérifier ce qui devait survivre**

Ce sont les trois pièges nommés dans la spec. Chacun se vérifie en un geste :

1. **L'ordre des lignes** — la liste des comptes s'affiche dans l'ordre attendu, et non dans un ordre arbitraire. C'est `ordonner()`, la fonction que le module renommé a gardée : si elle avait sauté avec le cycle, cet écran serait le premier à le montrer.
2. **« Fermer les clients »** — le bouton du pied ferme bien tous les clients Dofus. C'est lui qui se sert de la liste renommée en tâche 4.
3. **La zone d'avis** — assigner une touche à un compte **dont aucun client n'est lancé**, puis presser cette touche. Le pied doit afficher « aucun client lancé pour ce compte ».
4. **Les raccourcis par compte et par souris** — assigner M4 à un compte, presser M4 depuis un autre client : la bascule doit marcher comme avant.

- [ ] **Step 4: Rendre compte**

Il n'y a rien à committer si tout va bien. Dire à l'utilisateur ce qui a été vérifié, geste par geste.

---

## Ce que ce plan ne fait pas

- Aucune touche par défaut de remplacement.
- Aucune migration du fichier de réglages : la clé `nav` s'efface d'elle-même au premier enregistrement.
- Aucune publication pour les amis.
