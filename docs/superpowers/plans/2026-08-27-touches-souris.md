# Boutons de souris comme raccourcis — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assigner M4, M5 ou le clic molette là où on assigne aujourd'hui une touche — colonne « touche » de chaque compte, et raccourcis « précédent » / « suivant » en pied de fenêtre.

**Architecture:** `globalShortcut` ne connaît que le clavier. On ouvre un second chemin, parallèle : l'agent Frida déjà injecté dans chaque client Dofus observe l'état des boutons et remonte un front d'appui ; `desktop/main.js` trie les accélérateurs et exécute l'action depuis une table à part. La traduction bouton → accélérateur vit dans `src/comptes/raccourcis.js`, module pur, qui sert aux deux extrémités.

**Tech Stack:** Node 22 + `node:test`, Electron 43, Frida 17. Aucune dépendance nouvelle.

**Spec :** `docs/superpowers/specs/2026-08-27-touches-souris-design.md`

## Global Constraints

- **Aucune dépendance npm nouvelle.** L'agent Frida fournit tout.
- **Noms d'accélérateur exacts :** `Souris4` (M4), `Souris5` (M5), `SourisMilieu` (clic molette). Jamais d'autre orthographe.
- **Ordre des modificateurs figé :** `CommandOrControl`, puis `Alt`, puis `Shift`, puis le bouton. Identique à `depuisFrappe`. Une divergence d'un caractère rend le raccourci muet sans aucune erreur.
- **Numéros de bouton du DOM :** 1 = molette, 3 = M4, 4 = M5. Les boutons 0 (gauche) et 2 (droit) ne sont **jamais** assignables.
- **Codes Windows :** `VK_MBUTTON` 0x04, `VK_XBUTTON1` 0x05, `VK_XBUTTON2` 0x06, `VK_SHIFT` 0x10, `VK_CONTROL` 0x11, `VK_MENU` 0x12 (Alt).
- **Le renderer est en bac à sable** (`sandbox: true`, `desktop/main.js:611`) : il ne peut pas `require`. La duplication de la traduction dans `desktop/index.html` est imposée, pas un oubli.
- **Commentaires en français sans accents** dans les fichiers `.js`, comme tout le dépôt. Les accents sont admis dans les chaînes affichées à l'utilisateur.
- **Tests :** `npm test` doit rester vert à chaque commit. 615 tests au départ.

---

### Task 1: La traduction bouton vers accelerateur

**Files:**
- Modify: `src/comptes/raccourcis.js`
- Test: `test/raccourcis.test.js`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `depuisBouton(clic)` → `string | null`. `clic` porte `button` (entier), `ctrlKey`, `altKey`, `shiftKey` (booléens) — les noms d'un `MouseEvent`.
  - `estSouris(accelerateur)` → `boolean`.
  - `estUtilisable(accelerateur)` → `{ risque: boolean, raison: string | null }` — signature inchangée, comportement étendu.
  - `libelle(accelerateur)` — inchangé, rend `M4` / `M5` / `Molette` pour les nouveaux noms.

- [ ] **Step 1: Write the failing tests**

Ajouter à la fin de `test/raccourcis.test.js` :

```js
// --- les boutons de souris ------------------------------------------------

const { depuisBouton, estSouris } = require('../src/comptes/raccourcis');

const clic = (extra) => ({ button: 3, ctrlKey: false, altKey: false, shiftKey: false, ...extra });

test('les trois boutons assignables ont leur nom', () => {
  assert.strictEqual(depuisBouton(clic({ button: 3 })), 'Souris4');
  assert.strictEqual(depuisBouton(clic({ button: 4 })), 'Souris5');
  assert.strictEqual(depuisBouton(clic({ button: 1 })), 'SourisMilieu');
});

// Il faut pouvoir cliquer sur la case pour armer la saisie: le clic gauche ne
// peut pas etre un raccourci. Le clic droit ouvre les menus du jeu.
test('les clics gauche et droit ne sont pas assignables', () => {
  assert.strictEqual(depuisBouton(clic({ button: 0 })), null);
  assert.strictEqual(depuisBouton(clic({ button: 2 })), null);
});

test('un bouton inconnu ou un objet invalide rend null', () => {
  assert.strictEqual(depuisBouton(clic({ button: 9 })), null);
  assert.strictEqual(depuisBouton(clic({ button: undefined })), null);
  assert.strictEqual(depuisBouton(null), null);
  assert.strictEqual(depuisBouton('Souris4'), null);
});

// L'ordre doit etre celui du clavier: la chaine fabriquee a la capture et
// celle fabriquee a la reception doivent coincider caractere pour caractere.
test('les modificateurs suivent l ordre du clavier', () => {
  assert.strictEqual(depuisBouton(clic({ button: 3, ctrlKey: true })), 'CommandOrControl+Souris4');
  assert.strictEqual(depuisBouton(clic({ button: 4, altKey: true })), 'Alt+Souris5');
  assert.strictEqual(depuisBouton(clic({ button: 1, shiftKey: true })), 'Shift+SourisMilieu');
  assert.strictEqual(
    depuisBouton(clic({ button: 3, ctrlKey: true, altKey: true, shiftKey: true })),
    'CommandOrControl+Alt+Shift+Souris4',
  );
});

test('estSouris distingue un bouton d une touche', () => {
  assert.strictEqual(estSouris('Souris4'), true);
  assert.strictEqual(estSouris('CommandOrControl+Souris5'), true);
  assert.strictEqual(estSouris('SourisMilieu'), true);
  assert.strictEqual(estSouris('CommandOrControl+A'), false);
  assert.strictEqual(estSouris('F1'), false);
  assert.strictEqual(estSouris(''), false);
  assert.strictEqual(estSouris(null), false);
});

// Un bouton de souris n'est pas confisque a Dofus: on lit un etat, on
// n'intercepte rien. M4 et M5 sont libres dans le jeu, la molette non.
test('M4 et M5 ne sont pas signales, la molette si', () => {
  assert.strictEqual(estUtilisable('Souris4').risque, false);
  assert.strictEqual(estUtilisable('Souris5').risque, false);
  assert.strictEqual(estUtilisable('CommandOrControl+Souris4').risque, false);
  const molette = estUtilisable('SourisMilieu');
  assert.strictEqual(molette.risque, true);
  assert.match(molette.raison, /aussi/);
});

// La molette est PARTAGEE avec Dofus, une touche nue lui est VOLEE: deux
// situations opposees, deux textes.
test('le texte de la molette differe de celui d une touche nue', () => {
  assert.notStrictEqual(estUtilisable('SourisMilieu').raison, estUtilisable('A').raison);
});

test('les boutons ont un libelle court', () => {
  assert.strictEqual(libelle('Souris4'), 'M4');
  assert.strictEqual(libelle('Souris5'), 'M5');
  assert.strictEqual(libelle('SourisMilieu'), 'Molette');
  assert.strictEqual(libelle('CommandOrControl+Souris4'), 'Ctrl+M4');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/raccourcis.test.js`
Expected: FAIL — `depuisBouton is not a function`.

- [ ] **Step 3: Implement**

Dans `src/comptes/raccourcis.js`, après la constante `REFUSEES` :

```js
// MouseEvent.button -> nom d'accelerateur. Gauche (0) et droit (2) sont
// absents VOLONTAIREMENT: il faut pouvoir cliquer sur la case pour armer la
// saisie, et le clic droit ouvre les menus du jeu.
const BOUTONS = {
  1: 'SourisMilieu',
  3: 'Souris4',
  4: 'Souris5',
};

const SOURIS = new Set(Object.values(BOUTONS));
```

Puis, après `depuisFrappe` :

```js
// clic — un MouseEvent, ou tout objet portant button/ctrlKey/altKey/shiftKey.
// Rend l'accelerateur, ou null si ce bouton ne s'assigne pas.
//
// Jumeau exact de depuisFrappe, et ce n'est pas de la coquetterie: la meme
// fonction sert a la capture dans l'interface et a la reception depuis
// l'agent. Deux implementations divergeraient d'un caractere un jour, et le
// raccourci deviendrait muet sans la moindre erreur.
function depuisBouton(clic) {
  if (clic === null || typeof clic !== 'object') return null;
  const nom = BOUTONS[clic.button];
  if (nom === undefined) return null;

  const parties = [];
  if (clic.ctrlKey) parties.push('CommandOrControl');
  if (clic.altKey) parties.push('Alt');
  if (clic.shiftKey) parties.push('Shift');
  parties.push(nom);
  return parties.join('+');
}

// Ce qui permet a poserRaccourcis() de trier: un accelerateur souris ne peut
// pas partir chez globalShortcut, qui ne connait que le clavier.
function estSouris(accelerateur) {
  if (typeof accelerateur !== 'string' || accelerateur.length === 0) return false;
  const parties = accelerateur.split('+');
  return SOURIS.has(parties[parties.length - 1]);
}
```

Remplacer le corps de `estUtilisable` par :

```js
function estUtilisable(accelerateur) {
  if (typeof accelerateur !== 'string' || accelerateur.length === 0) {
    return { risque: false, raison: null };
  }
  const parties = accelerateur.split('+');
  const nom = parties[parties.length - 1];

  // UN BOUTON DE SOURIS N'EST PAS CONFISQUE. On lit son etat, on ne
  // l'intercepte pas: le jeu le recoit aussi. Sans consequence pour M4 et M5,
  // que Dofus n'utilise pas; a signaler pour la molette, qu'il utilise.
  if (SOURIS.has(nom)) {
    if (nom !== 'SourisMilieu') return { risque: false, raison: null };
    return { risque: true, raison: 'Dofus recevra aussi ce clic' };
  }

  const nue = parties.length === 1;
  const fonction = /^F([1-9]|1[0-9]|2[0-4])$/.test(nom);
  if (nue && !fonction) {
    return { risque: true, raison: 'Dofus ne recevra plus cette touche tant qu OMNI tourne' };
  }
  return { risque: false, raison: null };
}
```

Ajouter dans `AFFICHAGE` :

```js
  Souris4: 'M4',
  Souris5: 'M5',
  SourisMilieu: 'Molette',
```

Et l'export :

```js
module.exports = { depuisFrappe, depuisBouton, estSouris, libelle, estUtilisable, NOMS };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/raccourcis.test.js`
Expected: PASS, aucun échec.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/comptes/raccourcis.js test/raccourcis.test.js
git commit -m "feat(raccourcis): traduire un bouton de souris en accelerateur

globalShortcut ne connait que le clavier: les boutons ont besoin de leur
propre nom d'accelerateur, et du meme ordre de modificateurs que les
touches. depuisBouton est le jumeau de depuisFrappe et sert aux deux
extremites — la capture dans l'interface et la reception depuis l'agent.

estUtilisable classait tout accelerateur d'une seule partie comme risque
sauf les touches de fonction: Souris4 aurait ete signale a tort. Un
bouton n'est pas confisque a Dofus, il est PARTAGE avec lui, ce qui est
sans consequence pour M4 et M5 et a signaler pour la molette."
```

---

### Task 2: Le superviseur transporte les appuis

**Files:**
- Modify: `src/superviseur.js`
- Test: `test/superviseur.test.js`

**Interfaces:**
- Consumes: rien de la tâche 1.
- Produces:
  - option de constructeur `onSouris = () => {}`, appelée avec `{ pid, clic }` où `clic` est l'objet brut remonté par l'agent (`{ button, ctrlKey, altKey, shiftKey }`).
  - `superviseur.reglerSouris(actif)` — poste la commande à tous les clients attachés, et retient l'état pour ceux qui s'attacheront ensuite.
  - `superviseur.sourisActive` — booléen, faux au départ.

- [ ] **Step 1: Write the failing tests**

Ajouter à `test/superviseur.test.js` :

```js
// --- les boutons de souris ------------------------------------------------

function clientFactice(pid) {
  const postes = [];
  return {
    pid,
    postes,
    script: { post: (m) => postes.push(m) },
  };
}

test('un appui remonte par onSouris avec le pid', () => {
  const vus = [];
  const s = new Superviseur({ onSouris: (e) => vus.push(e) });
  s._recevoirMessageAgent(7, { souris: { button: 3, ctrlKey: true, altKey: false, shiftKey: false } }, 8300);
  assert.strictEqual(vus.length, 1);
  assert.strictEqual(vus[0].pid, 7);
  assert.deepStrictEqual(vus[0].clic, { button: 3, ctrlKey: true, altKey: false, shiftKey: false });
});

test('reglerSouris poste a tous les clients attaches', () => {
  const s = new Superviseur();
  const a = clientFactice(1);
  const b = clientFactice(2);
  s.clients.set(1, a);
  s.clients.set(2, b);
  s.reglerSouris(true);
  assert.deepStrictEqual(a.postes, [{ type: 'souris', actif: true }]);
  assert.deepStrictEqual(b.postes, [{ type: 'souris', actif: true }]);
  s.reglerSouris(false);
  assert.deepStrictEqual(a.postes[1], { type: 'souris', actif: false });
});

// La boucle ne doit tourner que si un bouton est assigne, et l'etat est
// decide AVANT qu'un client s'attache aussi bien qu'apres.
test('l etat de la souris est retenu pour les clients suivants', () => {
  const s = new Superviseur();
  assert.strictEqual(s.sourisActive, false);
  s.reglerSouris(true);
  assert.strictEqual(s.sourisActive, true);
});

// Un client sans agent charge ne doit pas faire lever reglerSouris: il y en a
// toujours un en cours d'attache quand l'utilisateur change un raccourci.
test('un client sans script ne fait pas lever reglerSouris', () => {
  const s = new Superviseur();
  s.clients.set(1, { pid: 1, script: null });
  assert.doesNotThrow(() => s.reglerSouris(true));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/superviseur.test.js`
Expected: FAIL — `s.reglerSouris is not a function`.

- [ ] **Step 3: Implement**

Dans le constructeur de `Superviseur`, ajouter l'option et le champ :

```js
  constructor({
    onTrame = () => {}, onJournal = () => {}, arme = false, transformerEntrant = null,
    etalementRejeu = null, alea = Math.random, planifier = setTimeout, onSouris = () => {},
  } = {}) {
```

Après `this.onJournal = onJournal;` :

```js
    // Les appuis de bouton remontes par les agents. Le superviseur ne juge
    // rien: il transporte, et desktop/main.js decide s'ils correspondent a un
    // raccourci.
    this.onSouris = onSouris;
    // La boucle de sondage ne tourne dans les clients que si au moins un
    // bouton est assigne. L'etat est retenu ici pour etre pose sur les clients
    // qui s'attachent APRES le reglage.
    this.sourisActive = false;
```

Dans `_recevoirMessageAgent`, avant le test sur `p.ready` :

```js
    if (p.souris !== undefined) {
      this.onSouris({ pid, clic: p.souris });
      return;
    }
```

Dans `ajouter()`, après `await client.script.load();` (`src/superviseur.js:169`) et **avant** `return etat;`, poser l'état courant :

```js
    // Un client attache apres le reglage doit sonder lui aussi.
    if (this.sourisActive) {
      try { client.script.post({ type: 'souris', actif: true }); } catch (e) {}
    }
```

Nouvelle méthode, à côté de `basculerVers` :

```js
  // Allume ou eteint le sondage des boutons dans TOUS les clients.
  //
  // Ne leve JAMAIS: elle est appelee depuis poserRaccourcis(), qui tourne sous
  // un gestionnaire IPC, et un client peut etre en cours d'attache — son
  // script n'existe pas encore.
  reglerSouris(actif) {
    this.sourisActive = Boolean(actif);
    for (const client of this.clients.values()) {
      if (!client.script) continue;
      try { client.script.post({ type: 'souris', actif: this.sourisActive }); }
      catch (e) { this.journal(client.pid, `souris: ${e.message}`); }
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/superviseur.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/superviseur.js test/superviseur.test.js
git commit -m "feat(superviseur): transporter les appuis de bouton des agents

onSouris est le jumeau d'onTrame: le superviseur ne juge rien, il
transporte, et desktop/main.js decide si l'appui correspond a un
raccourci.

reglerSouris allume le sondage dans tous les clients et RETIENT son
etat, pour qu'un client attache apres le reglage sonde lui aussi. Elle
ne leve jamais: un client en cours d'attache n'a pas encore de script."
```

---

### Task 3: L agent observe les boutons

**Files:**
- Modify: `src/il2cpp/connectAgent.js`
- Test: `test/connectAgent.test.js`

**Interfaces:**
- Consumes: le canal `recv`/`send` de Frida, déjà utilisé par le bloc « commande de fenetre ».
- Produces: l'agent envoie `send({ souris: { button, ctrlKey, altKey, shiftKey } })` et écoute `{ type: 'souris', actif }`. Le rapport d'attache gagne la mention `boutons de souris`.

**Note :** le bloc est **toujours** présent, sans option de construction. Il est inerte tant que l'hôte n'a pas posté `actif: true`. Une option de construction figerait la décision à l'instant de l'attache, et assigner un bouton plus tard ne réveillerait pas les clients déjà en place.

- [ ] **Step 1: Write the failing tests**

Ajouter à `test/connectAgent.test.js` :

```js
test('l agent porte le bloc des boutons de souris', () => {
  const src = connectAgentSource({ proxyPort: 8105 });
  assert.match(src, /GetAsyncKeyState/, 'il faut lire l etat des boutons');
  assert.match(src, /recv\('souris'/, 'le bloc s allume sur commande');
  assert.match(src, /boutons de souris/, 'le rapport d attache le mentionne');
});

// Les trois codes Windows des boutons assignables. Se tromper d'un code
// donnerait un bouton qui ne repond jamais, sans erreur nulle part.
test('les trois codes de bouton sont ceux de Windows', () => {
  const src = connectAgentSource({ proxyPort: 8105 });
  assert.match(src, /0x04/, 'VK_MBUTTON');
  assert.match(src, /0x05/, 'VK_XBUTTON1');
  assert.match(src, /0x06/, 'VK_XBUTTON2');
});

// Sans cette garde, les cinq clients verraient le meme appui.
test('l agent ne signale un appui que s il est au premier plan', () => {
  const src = connectAgentSource({ proxyPort: 8105 });
  const bloc = src.slice(src.indexOf('GetAsyncKeyState'));
  assert.match(bloc, /GetForegroundWindow/);
});

test('le source reste du JavaScript valide avec le bloc souris', () => {
  const src = connectAgentSource({ proxyPort: 8105, fakeDeviceId: 'abc', neutralizeCache: true });
  assert.doesNotThrow(() => new Function(src));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/connectAgent.test.js`
Expected: FAIL sur `GetAsyncKeyState`.

- [ ] **Step 3: Implement**

Dans `src/il2cpp/connectAgent.js`, insérer ce bloc dans le gabarit **juste avant** `send({ ready: report });`. Attention : le gabarit est un littéral de gabarit — n'y introduire ni backtick ni `${`.

```js
    // LES BOUTONS DE SOURIS, allumes sur commande de l'hote.
    //
    // POURQUOI ICI. globalShortcut d'Electron ne connait que le clavier:
    // aucun bouton de souris n'est representable dans un accelerateur, et
    // register() rendrait faux sans lever. On observe donc l'etat des boutons
    // depuis l'interieur du process du jeu, ou l'agent est deja.
    //
    // LE BOUTON N'EST PAS CONFISQUE A DOFUS. GetAsyncKeyState lit un etat, il
    // n'intercepte rien: le jeu recoit le clic lui aussi. C'est sans
    // consequence pour M4 et M5, que le jeu n'utilise pas.
    //
    // La boucle ne tourne QUE si un bouton est assigne. Une boucle de 250 ms
    // a deja ete retiree d'ici parce qu'elle repondait a une question qu'on ne
    // posait plus; celle-ci est plus rapide, donc elle doit se justifier a
    // chaque instant ou elle tourne.
    {
      const u32s = Process.getModuleByName('user32.dll');
      const exs = (n) => u32s.findExportByName ? u32s.findExportByName(n) : u32s.getExportByName(n);
      const getEtatTouche = new NativeFunction(exs('GetAsyncKeyState'), 'int16', ['int']);
      const devantS = new NativeFunction(exs('GetForegroundWindow'), 'pointer', []);
      const pidDeS = new NativeFunction(exs('GetWindowThreadProcessId'), 'uint32', ['pointer', 'pointer']);
      const casier = Memory.alloc(4);

      // VK_MBUTTON, VK_XBUTTON1, VK_XBUTTON2 -> numero de bouton du DOM.
      const BOUTONS_VK = [[0x04, 1], [0x05, 3], [0x06, 4]];
      const VK_SHIFT = 0x10;
      const VK_CONTROL = 0x11;
      const VK_MENU = 0x12;
      const enfonce = function (vk) { return (getEtatTouche(vk) & 0x8000) !== 0; };

      const avant = {};
      for (let i = 0; i < BOUTONS_VK.length; i++) avant[BOUTONS_VK[i][0]] = false;
      let sonde = null;

      function auPremierPlanSouris() {
        const hwnd = devantS();
        if (hwnd.isNull()) return false;
        casier.writeU32(0);
        pidDeS(hwnd, casier);
        return casier.readU32() === Process.id;
      }

      function sonderBoutons() {
        try {
          // Sans cette garde, les cinq clients verraient le meme appui et la
          // bascule partirait cinq fois.
          const actif = auPremierPlanSouris();
          for (let i = 0; i < BOUTONS_VK.length; i++) {
            const vk = BOUTONS_VK[i][0];
            const bouton = BOUTONS_VK[i][1];
            const etat = enfonce(vk);
            const front = etat && !avant[vk];
            // L'etat est tenu a jour MEME hors premier plan: un bouton
            // relache ailleurs paraitrait sinon encore enfonce au retour, et
            // l'appui suivant serait manque.
            avant[vk] = etat;
            if (!front || !actif) continue;
            send({ souris: {
              button: bouton,
              ctrlKey: enfonce(VK_CONTROL),
              altKey: enfonce(VK_MENU),
              shiftKey: enfonce(VK_SHIFT),
            } });
          }
        } catch (e) {}
      }

      // recv n'ecoute qu'UNE fois: on se replace apres chaque message, sinon
      // le premier allumage serait aussi le dernier.
      function ecouterSouris() {
        recv('souris', function (m) {
          try {
            // 30 ms: un clic dure 80 a 150 ms, on ne peut pas en rater.
            if (m && m.actif && sonde === null) sonde = setInterval(sonderBoutons, 30);
            else if ((!m || !m.actif) && sonde !== null) { clearInterval(sonde); sonde = null; }
          } catch (e) {}
          ecouterSouris();
        });
      }
      ecouterSouris();
      report.push('boutons de souris');
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/connectAgent.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/il2cpp/connectAgent.js test/connectAgent.test.js
git commit -m "feat(agent): observer les boutons de souris, sur commande

L'agent est deja dans le process du jeu et appelle deja user32: lire
l'etat des boutons n'ajoute aucune surface. Il ne signale que le front
montant, et seulement si SON client est au premier plan — sans cette
garde les cinq clients verraient le meme appui.

Le bloc est toujours present mais inerte: c'est un message de l'hote qui
allume la boucle. Une option de construction figerait la decision a
l'attache, et assigner un bouton plus tard ne reveillerait pas les
clients deja en place."
```

---

### Task 4: main.js trie et execute

**Files:**
- Modify: `desktop/main.js`
- Test: aucun test automatisé — `desktop/main.js` n'est pas testable hors Electron. La vérification est celle de la tâche 6.

**Interfaces:**
- Consumes: `estSouris`, `depuisBouton` (tâche 1) ; `onSouris`, `reglerSouris` (tâche 2).
- Produces: le canal IPC `boutonSouris`, qui reçoit `{ button, ctrlKey, altKey, shiftKey }` depuis l'interface.

- [ ] **Step 1: Importer les deux fonctions**

Dans `desktop/main.js`, la ligne d'import de `raccourcis` n'existe pas encore. L'ajouter près des autres imports du haut :

```js
const { estSouris, depuisBouton } = require('../src/comptes/raccourcis');
```

- [ ] **Step 2: Ajouter la table des actions souris**

Juste au-dessus de `function poserRaccourcis()` :

```js
// LES RACCOURCIS SOURIS, qui ne peuvent pas passer par globalShortcut.
//
// Electron ne sait enregistrer que des touches. Un bouton passe donc par un
// second chemin, de l'agent jusqu'ici, et cette table est son aboutissement.
// Elle est refaite en entier a chaque changement, comme les raccourcis
// clavier: un differentiel faux laisserait un bouton fantome actif jusqu'a la
// fermeture.
const actionsSouris = new Map();   // accelerateur -> action
```

- [ ] **Step 3: Trier dans poserRaccourcis**

Dans `poserRaccourcis()`, ajouter `actionsSouris.clear();` juste après `globalShortcut.unregisterAll();`, puis modifier `poser` :

```js
  const poser = (accelerateur, action) => {
    if (!accelerateur) return;
    // Un bouton n'est pas representable dans un accelerateur Electron: le
    // passer a register() echouerait sans lever, donc en silence.
    if (estSouris(accelerateur)) { actionsSouris.set(accelerateur, action); return; }
    try {
      // register rend faux quand la touche est deja prise par une AUTRE
      // application: on le dit plutot que de laisser croire que ca marche.
      if (!globalShortcut.register(accelerateur, action)) {
        journal('raccourcis', `${accelerateur} refuse (deja pris par une autre application ?)`);
      }
    } catch (e) {
      journal('raccourcis', `${accelerateur} invalide : ${e.message}`);
    }
  };
```

Et à la toute fin de `poserRaccourcis()`, après les deux `poser(nav...)` :

```js
  // La boucle de sondage ne tourne dans les clients que s'il y a quelque chose
  // a sonder.
  if (superviseur !== null) superviseur.reglerSouris(actionsSouris.size > 0);
```

- [ ] **Step 4: Exécuter un appui**

Juste après `poserRaccourcis()` :

```js
// Un appui de bouton, d'ou qu'il vienne: de l'agent quand Dofus est devant, de
// l'interface quand c'est OMNI. Meme table, meme action.
//
// Un bouton non assigne ne fait rien et ne se journalise pas: l'utilisateur a
// deux boutons sous le pouce et s'en sert pour autre chose.
function jouerSouris(clic) {
  const accelerateur = depuisBouton(clic);
  if (accelerateur === null) return;
  const action = actionsSouris.get(accelerateur);
  if (action === undefined) return;
  action();
}
```

- [ ] **Step 5: Brancher le superviseur**

À la construction du `Superviseur` dans `desktop/main.js`, ajouter l'option :

```js
    onSouris: ({ clic }) => jouerSouris(clic),
```

- [ ] **Step 6: Ajouter le canal IPC**

Près de `ipcMain.handle('reglerToucheNav', ...)` :

```js
// L'interface signale un appui quand c'est la fenetre d'OMNI qui a le focus:
// l'agent, lui, ne voit que les appuis faits sur son client Dofus.
ipcMain.handle('boutonSouris', (_e, clic) => {
  if (clic === null || typeof clic !== 'object') return;
  jouerSouris({
    button: clic.button,
    ctrlKey: Boolean(clic.ctrlKey),
    altKey: Boolean(clic.altKey),
    shiftKey: Boolean(clic.shiftKey),
  });
});
```

- [ ] **Step 7: Empêcher la navigation de la fenêtre**

Dans la création de la fenêtre, après `fenetre.on('close', ...)` :

```js
  // M4 et M5 sont « precedent » et « suivant » pour Chromium. La fenetre n'a
  // aucun historique, donc rien ne se passerait — mais on coupe court plutot
  // que de dependre de ce fait.
  fenetre.on('app-command', (e) => e.preventDefault());
```

- [ ] **Step 8: Vérifier que rien n'est cassé**

Run: `node --check desktop/main.js && npm test`
Expected: `syntaxe OK` puis `fail 0`.

- [ ] **Step 9: Commit**

```bash
git add desktop/main.js
git commit -m "feat(raccourcis): executer un bouton de souris

poserRaccourcis trie desormais: les touches vont chez globalShortcut
comme avant, les boutons dans une table a part. Passer un accelerateur
souris a register() echouerait sans lever, donc en silence.

Un appui arrive de deux endroits — l'agent quand Dofus est devant,
l'interface quand c'est OMNI — et aboutit a la meme table. La boucle de
sondage n'est allumee dans les clients que si la table n'est pas vide."
```

---

### Task 5: Capturer et afficher un bouton dans l interface

**Files:**
- Modify: `desktop/preload.js`
- Modify: `desktop/index.html`
- Test: aucun test automatisé — vérification manuelle en tâche 6.

**Interfaces:**
- Consumes: le canal `boutonSouris` (tâche 4).
- Produces: rien pour les tâches suivantes.

**Rappel :** le renderer est en bac à sable et ne peut pas `require`. La traduction de la tâche 1 doit être **recopiée** ici, à l'identique. C'est la frontière de confiance, pas un oubli.

- [ ] **Step 1: Ouvrir le canal dans le preload**

Dans `desktop/preload.js`, après `reglerToucheNav` :

```js
  // Un appui de bouton fait DANS la fenetre d'OMNI. Les appuis faits sur un
  // client Dofus remontent par son agent, sans passer par ici.
  boutonSouris: (clic) => ipcRenderer.invoke('boutonSouris', clic),
```

- [ ] **Step 2: Recopier la traduction dans index.html**

À côté de la constante `MODIF`, ajouter :

```js
  // RECOPIE DE src/comptes/raccourcis.js, et il faut que ca le reste.
  // Le renderer tourne en bac a sable: il n'a pas de require, et un preload
  // en bac a sable ne peut charger que les modules d'Electron. Toute
  // modification ici doit etre reportee la-bas, et reciproquement.
  const BOUTONS = { 1: 'SourisMilieu', 3: 'Souris4', 4: 'Souris5' };
  const SOURIS = new Set(Object.values(BOUTONS));

  function accelerateurSourisDe(e) {
    const nom = BOUTONS[e.button];
    if (nom === undefined) return null;
    const parties = [];
    if (e.ctrlKey) parties.push('CommandOrControl');
    if (e.altKey) parties.push('Alt');
    if (e.shiftKey) parties.push('Shift');
    parties.push(nom);
    return parties.join('+');
  }
```

Ajouter dans la table `AFFICHAGE` du fichier :

```js
    Souris4: 'M4', Souris5: 'M5', SourisMilieu: 'Molette',
```

- [ ] **Step 3: Remplacer estRisquee par risqueDe**

`estRisquee` classerait `Souris4` comme risqué à tort, et la molette a besoin de son propre texte. Remplacer la fonction :

```js
  // Une touche NUE est CONFISQUEE a Dofus. Un bouton de souris, non: on lit
  // son etat, le jeu le recoit aussi. Deux situations opposees, deux textes.
  // Rend la raison, ou null s'il n'y a rien a signaler.
  function risqueDe(a) {
    if (!a) return null;
    const parties = a.split('+');
    const nom = parties[parties.length - 1];
    if (SOURIS.has(nom)) {
      return nom === 'SourisMilieu' ? 'Dofus recevra aussi ce clic' : null;
    }
    if (parties.length === 1 && !/^F([1-9]|1[0-9]|2[0-4])$/.test(nom)) {
      return 'Dofus ne recevra plus cette touche tant qu OMNI tourne';
    }
    return null;
  }
```

Puis remplacer les deux usages dans la mise à jour d'un rang :

```js
      const raison = risqueDe(l.touche);
      r.cabochon.className = 'cabochon'
        + (l.touche ? '' : ' sans-touche')
        + (raison ? ' risque' : '');
      r.cabochon.textContent = l.touche ? libelleTouche(l.touche) : 'aucune';
      r.cabochon.title = raison || 'Cliquer puis frapper une touche ou un bouton de souris. Échap annule.';
```

- [ ] **Step 4: Capturer un appui**

Juste après l'écouteur `keydown` existant :

```js
  // La saisie accepte un bouton de souris comme une touche. Le clic gauche
  // est exclu par BOUTONS: c'est lui qui arme la saisie.
  window.addEventListener('mousedown', (e) => {
    const a = accelerateurSourisDe(e);
    if (a === null) return;
    // M4 et M5 sont « precedent » et « suivant » pour Chromium.
    e.preventDefault();
    if (ecoute !== null) {
      const cible = ecoute;
      ecoute = null;
      cible.poser(a);
      return;
    }
    // Hors saisie, l'appui vaut raccourci: c'est le cas ou la fenetre d'OMNI
    // a le focus, que l'agent ne voit pas.
    window.app.boutonSouris({
      button: e.button, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey,
    });
  });
```

- [ ] **Step 5: Mettre à jour le libellé d'invite**

Le bouton de saisie affiche `frappe…`. Remplacer par `frappe ou clique…` dans `armerSaisie` :

```js
    bouton.textContent = 'frappe ou clique…';
```

- [ ] **Step 6: Vérifier la syntaxe**

Run: `node --check desktop/preload.js && npm test`
Expected: `fail 0`.

Il n'existe pas de vérificateur pour le JavaScript de `index.html` : la relecture et la tâche 6 en tiennent lieu.

- [ ] **Step 7: Commit**

```bash
git add desktop/preload.js desktop/index.html
git commit -m "feat(interface): assigner un bouton de souris comme une touche

La saisie accepte desormais M4, M5 et le clic molette, dans la colonne
touche comme sur precedent/suivant. Hors saisie, l'appui vaut raccourci:
c'est le cas ou la fenetre d'OMNI a le focus, que l'agent ne voit pas.

estRisquee classait tout accelerateur d'une seule partie comme risque:
Souris4 aurait porte l'avertissement du clavier, qui est faux — un
bouton n'est pas confisque au jeu, il est partage avec lui.

La traduction est RECOPIEE de src/comptes/raccourcis.js: le renderer est
en bac a sable et n'a pas de require."
```

---

### Task 6: Verification en conditions reelles

**Files:** aucun, sauf correctif éventuel.

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: la certitude, ou un défaut nommé.

**Le point d'incertitude à lever en premier :** sous Windows, Chromium transforme parfois M4 et M5 en commandes de navigation *avant* que la page ne les voie. Si `mousedown` ne se déclenche pas pour les boutons 3 et 4 dans la fenêtre d'OMNI, **la capture est impossible** et il faut le repli de l'étape 4.

- [ ] **Step 1: Lancer avec le journal**

```bash
cscript //nologo /f/omni_project/outils/lancer-diag.vbs
```

Fermer OMNI avant, pour que le code du dépôt soit rechargé.

- [ ] **Step 2: Vérifier la capture (le point d'incertitude)**

Cliquer sur la case « touche » d'un compte, puis appuyer sur **M4**.

Attendu : la case affiche `M4`.
Si elle reste sur `frappe ou clique…`, Chromium n'a pas délivré l'événement — passer à l'étape 4.

Répéter avec **M5**, avec la **molette** (qui doit afficher `Molette` et porter l'infobulle « Dofus recevra aussi ce clic »), et avec **Ctrl+M4** (qui doit afficher `Ctrl+M4`).

- [ ] **Step 3: Vérifier l'action, deux clients ouverts**

Assigner M4 à « précédent » et M5 à « suivant » en pied de fenêtre. Mettre un client Dofus au premier plan, appuyer sur M5.

Attendu : la fenêtre bascule vers le client suivant, **une seule fois**. Deux bascules d'affilée signifieraient que la garde du premier plan ne fonctionne pas.

Vérifier ensuite dans `F:\omni_project\journal-dev.log` que le rapport d'attache de chaque client mentionne `boutons de souris`.

- [ ] **Step 4: Repli, SEULEMENT si l'étape 2 a échoué**

Si `mousedown` ne délivre pas les boutons 3 et 4, la capture doit passer par le process principal. Dans `desktop/main.js`, remplacer le garde-fou `app-command` par un relais :

```js
  // Chromium avale M4 et M5 avant la page: on les recupere ici et on les
  // renvoie a l'interface, qui les traite comme un mousedown.
  fenetre.on('app-command', (e, commande) => {
    e.preventDefault();
    const button = commande === 'browser-backward' ? 3
      : commande === 'browser-forward' ? 4 : null;
    if (button === null) return;
    // app-command ne porte pas l'etat des modificateurs: un raccourci
    // combine ne se capture donc pas depuis la fenetre d'OMNI. Il reste
    // capturable en le composant a la souris sur un client Dofus.
    fenetre.webContents.send('boutonFenetre', { button, ctrlKey: false, altKey: false, shiftKey: false });
  });
```

Exposer la réception dans `desktop/preload.js` :

```js
  surBoutonFenetre: (rappel) => ipcRenderer.on('boutonFenetre', (_e, clic) => rappel(clic)),
```

Et dans `desktop/index.html`, à côté de l'écouteur `mousedown`, extraire le corps dans une fonction `traiterClic(clic)` appelée par les deux chemins.

Committer ce repli séparément, avec un message qui dit ce qui a été mesuré.

- [ ] **Step 5: Commit du résultat**

Si tout marche sans repli, il n'y a rien à committer — dire simplement à l'utilisateur ce qui a été vérifié, avec les gestes exacts essayés.

---

## Ce que ce plan ne fait pas

- La molette haut/bas comme raccourci.
- Le clic gauche et le clic droit.
- Le fonctionnement depuis une fenêtre tierce (navigateur, explorateur) : c'est la limite acceptée dans la spec, qui demanderait un module natif.
- La publication d'une version pour les amis.
