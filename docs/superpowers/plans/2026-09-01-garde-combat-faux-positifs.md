# Le garde combat apprend sur le degat — plan d'implementation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le garde ne retient plus une action que si une mule s'est ouvert SON
propre combat, et les entrees retenues s'oublient d'elles-memes.

**Architecture:** Deux modules purs, independants l'un de l'autre.
`src/comptes/favoris.js` date les entrees, jette l'ancienne liste et expire a
30 jours. `src/garde-combat.js` deplace l'apprentissage du `ieb` du maitre vers
la `kmk` d'un esclave qui ne contient pas le maitre. L'annulation des rejeux a
250 ms n'est pas touchee.

**Tech Stack:** Node.js, `node:test`, aucune dependance nouvelle. Ni Electron
ni Frida: les deux modules se testent avec des doubles.

**Spec:** `docs/superpowers/specs/2026-09-01-garde-combat-faux-positifs-design.md`

## Global Constraints

- **Aucun bouton, aucune interface nouvelle.** Contrainte explicite de
  l'utilisateur. `desktop/index.html` et `desktop/main.js` ne sont pas modifies.
- **`combats()` continue de rendre un tableau de chaines.** `desktop/main.js:885`
  fait `favoris.combats().includes(cle)`; changer ce type casserait le garde en
  silence.
- **`favoris.oublierCombats()` reste en place, sans appelant.** Ce n'est pas du
  code mort: vider le tableau `combats` de favoris.json revient a l'appeler.
- **Delai d'oubli: 30 jours.**
- **Aucun accent dans le code ni les commentaires**, comme le reste du depot.
- `npm test` doit rester vert (761 tests sur `master` avant ce plan).

---

### Task 1: Les entrees retenues sont datees, expirent, et l'ancienne liste est jetee

**Files:**
- Modify: `src/comptes/favoris.js` (constante en tete, `charger()` ~ligne 110,
  bloc de reprise du `catch` ~ligne 139, `combats()`/`apprendreCombat()`
  ~ligne 274, `_ecrire()` ~ligne 341, `module.exports` en fin de fichier)
- Test: `test/comptes-favoris.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: `MS_OUBLI` (nombre, exporte). `combats(): string[]` inchange.
  `apprendreCombat(cle: string): void` inchange vu de l'exterieur.

- [ ] **Step 1: Write the failing tests**

Ajouter a la fin de `test/comptes-favoris.test.js`, et completer la ligne
`require` du haut pour importer `MS_OUBLI` a cote de `Favoris`:

```js
// en tete du fichier
const { Favoris, MS_OUBLI } = require('../src/comptes/favoris');
```

```js
// LA MIGRATION EST LE REMEDE. Les entrees d'avant le 2026-09-01 sont des
// chaines, apprises par une regle qu'on sait fausse: les convertir
// reviendrait a conserver les blocages qu'on veut supprimer.
test('une ancienne liste de chaines est jetee au chargement', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ combats: ['ioy:25088', 'iov:1:2'] }), 'utf8');
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), []);
});

test('une entree jetee est effacee du fichier, pas seulement de la memoire', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ combats: ['ioy:25088'] }), 'utf8');
  new Favoris(chemin).charger();
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(chemin, 'utf8')).combats, []);
});

test('une entree datee de moins de 30 jours est conservee', (t) => {
  const chemin = fichierTemporaire(t);
  const le = Date.now() - (MS_OUBLI - 60000);
  fs.writeFileSync(chemin, JSON.stringify({ combats: [{ cle: 'ioy:25088', le }] }), 'utf8');
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), ['ioy:25088']);
});

test('une entree datee de plus de 30 jours est ecartee', (t) => {
  const chemin = fichierTemporaire(t);
  const le = Date.now() - (MS_OUBLI + 60000);
  fs.writeFileSync(chemin, JSON.stringify({ combats: [{ cle: 'ioy:25088', le }] }), 'utf8');
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), []);
});

test('une entree sans date ou mal formee est ecartee', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ combats: [
    { cle: 'ioy:1' }, { le: Date.now() }, { cle: '', le: Date.now() },
    { cle: 'ioy:2', le: 'hier' }, null, 42,
  ] }), 'utf8');
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), []);
});

test('une entree apprise survit a un rechargement et reste datee', (t) => {
  const chemin = fichierTemporaire(t);
  new Favoris(chemin).charger().apprendreCombat('ioy:25088');
  const ecrit = JSON.parse(fs.readFileSync(chemin, 'utf8')).combats;
  assert.strictEqual(ecrit.length, 1);
  assert.strictEqual(ecrit[0].cle, 'ioy:25088');
  assert.ok(Number.isFinite(ecrit[0].le), 'l entree porte une date');
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), ['ioy:25088']);
});

test('apprendre deux fois la meme cle ne fait qu une entree', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  f.apprendreCombat('ioy:25088');
  f.apprendreCombat('ioy:25088');
  assert.deepStrictEqual(f.combats(), ['ioy:25088']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/comptes-favoris.test.js`
Expected: FAIL — `MS_OUBLI` vaut `undefined`, et les chaines sont encore reprises.

- [ ] **Step 3: Implement**

Dans `src/comptes/favoris.js`, ajouter la constante juste avant `class Favoris`:

```js
// Au-dela, une entree retenue ne protege plus de rien.
//
// Les actions dangereuses sont pour l'essentiel des combats de quete, faits
// une fois: passe un mois, l'entree ne fait plus que bloquer. Si l'action est
// encore dangereuse, le degat se reproduit UNE fois et elle est retenue de
// nouveau. C'est le prix, il est assume — il n'y a plus de bouton pour
// oublier, et une entree fausse eternelle est le defaut qu'on corrige.
const MS_OUBLI = 30 * 24 * 60 * 60 * 1000;
```

Remplacer `this._combats = new Set();` par `this._combats = new Map();` aux
DEUX endroits (constructeur ~ligne 56, bloc de reprise du `catch` ~ligne 139).

Declarer `let reecrire = false;` AVANT le `try` de `charger()` — il doit rester
visible apres le `catch`.

Remplacer le bloc de lecture des combats dans `charger()`:

```js
      // LES ANCIENNES ENTREES SONT DES CHAINES, ET ON LES JETTE. Elles ont
      // ete apprises par une regle qu'on sait fausse — le maitre entrant en
      // combat, c'est-a-dire jouer normalement. Les convertir reviendrait a
      // conserver exactement les blocages qu'on veut supprimer. La forme
      // suffit a reconnaitre la migration, aucun drapeau de version n'est
      // necessaire.
      if (Array.isArray(json.combats)) {
        const limite = Date.now() - MS_OUBLI;
        for (const c of json.combats) {
          if (c === null || typeof c !== 'object') continue;
          if (typeof c.cle !== 'string' || c.cle.length === 0) continue;
          if (!Number.isFinite(c.le) || c.le < limite) continue;
          this._combats.set(c.cle, c.le);
        }
        // Reecrire tout de suite ce qui a ete ecarte: sans cela une liste
        // jetee reviendrait a chaque lecture jusqu'au prochain reglage touche.
        if (this._combats.size !== json.combats.length) reecrire = true;
      }
```

Juste avant le `return this;` final (apres le `catch`), ajouter:

```js
    if (reecrire) this._ecrire();
```

Remplacer les deux methodes:

```js
  combats() {
    return [...this._combats.keys()];
  }

  apprendreCombat(cle) {
    if (typeof cle !== 'string' || cle.length === 0) return;
    this._combats.set(cle, Date.now());
    this._ecrire();
  }
```

`oublierCombats()` ne change pas: `this._combats.clear()` marche sur une Map.

Dans `_ecrire()`, remplacer `combats: this.combats(),` par:

```js
        combats: [...this._combats].map(([cle, le]) => ({ cle, le })),
```

Enfin: `module.exports = { Favoris, MS_OUBLI };`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/comptes-favoris.test.js`
Expected: PASS, y compris les tests existants
(`oublier vide la liste et l enregistre`, `une liste d un mauvais type dans le
fichier est ignoree`, celui qui appelle `apprendreCombat(null)`).

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/comptes/favoris.js test/comptes-favoris.test.js
git commit -m "fix(favoris): dater les combats retenus, jeter l ancienne liste"
```

---

### Task 2: Le garde apprend sur la kmk d'un esclave, plus sur le ieb du maitre

**Files:**
- Modify: `src/garde-combat.js` (en-tete, garde d'entree de `onTrame`, branche
  `dir === 'out'`, branche `ieb`)
- Test: `test/garde-combat.test.js`

**Interfaces:**
- Consumes: `combattantsDe(frame)` et `TYPE_COMBATTANTS` de
  `src/abandon-combat.js`, deja exportes. `combattantsDe` rend un `Set` de
  chaines, ou `null` si la liste ne decrit pas un combat.
- Produces: aucun changement de signature. `creerGardeCombat` garde ses
  rappels `estApprise`, `onApprendre`, `onAnnulation`, `onJournal`,
  `maintenant`. `desktop/main.js` n'est pas modifie.

**Ce que le double du superviseur doit gagner:** `comptes.get(pid)`, qui rend
`{ pid, characterId }`. Le double actuel (`test/garde-combat.test.js:83`)
n'expose que `comptes.esclaves()`.

- [ ] **Step 1: Write the failing tests**

Dans `test/garde-combat.test.js`, remplacer `fauxSuperviseur` par:

```js
// Les characterId mesures le 2026-09-01, repris de test/abandon-combat.test.js
// pour que les deux modules se testent sur le meme trafic.
const ID_MAITRE = 676438999334n;
const ID_MULE = 677048221990n;

function fauxSuperviseur(esclaves = [2, 3]) {
  const emis = [];
  let annulations = 0;
  return {
    emis,
    get annulations() { return annulations; },
    arme: true,
    annulerRejeux: () => { annulations += 1; return 2; },
    emettre: (pid, octets) => { emis.push({ pid, octets }); return { ok: true }; },
    comptes: {
      esclaves: () => esclaves.map((pid) => ({ pid })),
      get: (pid) => (pid === MAITRE
        ? { pid, characterId: ID_MAITRE }
        : { pid, characterId: ID_MULE }),
    },
  };
}

// Une kmk telle qu'elle arrive: un combattant par champ 2, cellule au champ 1,
// ORIENTATION au champ 2, identifiant au champ 3. Un identifiant NEGATIF est
// un monstre, et c'est lui seul qui distingue un combat d'une liste de carte.
const combattant = (id) => ({
  no: 2, kind: 'message',
  value: [{ no: 1, value: 400n }, { no: 2, value: 3n }, { no: 3, value: id }],
});
const listeCombat = (...ids) => ({
  kind: 'event', type: 'kmk',
  payload: [combattant(-1n), ...ids.map(combattant)],
});
const listeCarte = (...ids) => ({
  kind: 'event', type: 'kmk', payload: ids.map(combattant),
});
```

Puis ajouter les tests:

```js
// LE COEUR DU CHANGEMENT. Ce qui compte n'est pas que le maitre se batte —
// c'est jouer normalement — mais qu'une mule se soit ouvert SON combat.
test('une mule en combat SANS le maitre fait retenir l action', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, ['ioy:25088']);
});

test('une mule en combat AVEC le maitre ne fait rien retenir', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MAITRE, ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
});

// Une kmk sert aussi a lister les acteurs d'une CARTE, ou personne ne combat.
test('une liste d acteurs de carte ne fait rien retenir', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: 2, dir: 'in', frame: listeCarte(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
});

test('hors de la fenetre d apprentissage, rien n est retenu', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  let t = 1000;
  const garde = creerGardeCombat({
    superviseur: sup, onApprendre: (c) => apprises.push(c), maintenant: () => t,
  });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  t += FENETRE_APPRENTISSAGE_MS + 1;
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
});

test('sans action sensible recente, une mule en combat ne fait rien retenir', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
});

// LE DEFAUT CORRIGE, ecrit en toutes lettres: le maitre qui entre en combat
// est un evenement de jeu ordinaire. Il annule les rejeux en attente, et c'est
// tout ce qu'il fait.
test('le ieb du maitre annule les rejeux mais ne retient RIEN', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: MAITRE, dir: 'in', frame: trame('ieb', { 1: 1642, 2: 9828 }), estMaitre: true });
  assert.strictEqual(sup.annulations, 1, 'les rejeux en attente sont annules');
  assert.deepStrictEqual(apprises, [], 'mais rien n est retenu');
});

test('deux mules dans deux combats distincts ne font qu une entree', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  garde({ pid: 3, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, ['ioy:25088']);
});

test('sans duplication armee, rien n est retenu', () => {
  const sup = fauxSuperviseur();
  sup.arme = false;
  const apprises = [];
  const garde = creerGardeCombat({ superviseur: sup, onApprendre: (c) => apprises.push(c) });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
});
```

**Supprimer les cinq tests qui affirment l'ancienne regle.** Ils font suivre une
action sensible d'un `ieb` du MAITRE et attendent une cle retenue: ils
decrivent le defaut, pas le comportement voulu. Les nouveaux tests ci-dessus
couvrent chacun leur intention.

| Ligne | Test a supprimer | Remplace par |
|---|---|---|
| 157 | `l action qui precede le combat est retenue` | `une mule en combat SANS le maitre fait retenir l action` |
| 167 | `une action trop ancienne n est pas retenue` | `hors de la fenetre d apprentissage, rien n est retenu` |
| 176 | `une action juste dans la fenetre est retenue` | `une mule en combat SANS le maitre fait retenir l action` |
| 193 | `deux combats de suite ne retiennent pas la meme action deux fois` | `deux mules dans deux combats distincts ne font qu une entree` |
| 334 | `une action a exactement deux secondes n est pas retenue` | `hors de la fenetre d apprentissage, rien n est retenu` |

**Deux tests demandent une decision, pas une suppression:**

- Ligne 185, `une action deja connue n est pas retenue deux fois`. L'intention
  reste bonne — `estApprise` doit court-circuiter — mais le declencheur change.
  Le REECRIRE en envoyant une `kmk` d'esclave au lieu du `ieb` du maitre:

```js
test('une action deja connue n est pas retenue deux fois', () => {
  const sup = fauxSuperviseur();
  const apprises = [];
  const garde = creerGardeCombat({
    superviseur: sup, estApprise: () => true, onApprendre: (c) => apprises.push(c),
  });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  assert.deepStrictEqual(apprises, []);
});
```

- Ligne 320, `une exception dans onApprendre n empeche pas la fermeture des
  dialogues`. **Ce test perd son objet:** apprendre et fermer les dialogues ne
  sont plus dans la meme branche, donc une exception dans l'un ne peut
  structurellement plus atteindre l'autre. La garantie qu'il protegeait reste
  neanmoins utile sous une autre forme — une exception ne doit pas remonter
  jusqu'au superviseur. Le REMPLACER par:

```js
test('une exception dans onApprendre est journalisee, pas propagee', () => {
  const sup = fauxSuperviseur();
  const lignes = [];
  const garde = creerGardeCombat({
    superviseur: sup,
    onApprendre: () => { throw new Error('disque plein'); },
    onJournal: (pid, texte) => lignes.push(texte),
  });
  garde({ pid: MAITRE, dir: 'out', frame: trame('ioy', { 1: 25088 }), estMaitre: true });
  assert.doesNotThrow(() => {
    garde({ pid: 2, dir: 'in', frame: listeCombat(ID_MULE), estMaitre: false });
  });
  assert.ok(lignes.some((l) => l.includes('disque plein')), 'la panne est dite');
});
```

**Les tests suivants restent INTACTS et doivent rester verts** — ce sont eux qui
prouvent qu'on n'a pas casse la partie saine du garde: `l entree en combat
annule les rejeux en attente` (125), les deux `onAnnulation` (136, 147), les
cinq tests de fermeture de dialogue (209, 218, 230, 294, 307, 343), `rien ne se
passe si la duplication n est pas armee` (250), `l entree en combat d un esclave
ne declenche rien` (263), `une trame entrante d un autre type ne declenche
rien` (272), `un refus de fermeture se journalise sans lever` (282) et `un
combat sans action prealable ne retient rien et ne ferme rien` (239).

Le test 263 merite une attention particuliere: il affirme que le `ieb` d'un
ESCLAVE ne declenche rien. Il reste vrai — le nouveau critere lit `kmk`, pas
`ieb` — et il garde tout son sens.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/garde-combat.test.js`
Expected: FAIL — `une mule en combat SANS le maitre fait retenir l action`
echoue (le garde sort sur `!estMaitre`), et
`le ieb du maitre annule les rejeux mais ne retient RIEN` echoue aussi
(l'ancienne regle retient encore).

- [ ] **Step 3: Implement**

Dans `src/garde-combat.js`, ajouter aux `require` du haut:

```js
const { combattantsDe, TYPE_COMBATTANTS } = require('./abandon-combat');
```

Completer l'en-tete du module, juste apres le paragraphe `LE SIGNAL`:

```js
// LE SIGNAL A CHANGE LE 2026-09-01, et c'est tout l'objet de ce module.
//
// Il etait: le maitre entre en combat moins de 2 s apres une action sensible.
// Mais entrer en combat apres avoir parle a un PNJ, C'EST JOUER NORMALEMENT.
// Le garde confondait « le maitre se bat » avec « les mules ont chacune ouvert
// SON combat ». Rapporte par un ami le 01/09: trois actions retenues, aucun
// combat duplique. Sans bouton pour oublier, chaque entree fausse etait
// definitive.
//
// Il est desormais: une mule recoit une liste de combattants qui NE CONTIENT
// PAS le maitre. C'est le degat lui-meme, pas un indice. Meme critere que
// src/abandon-combat.js, verifie en jeu deux fois le 01/09.
//
// L'ANNULATION, ELLE, NE CHANGE PAS. Le `ieb` du maitre continue d'annuler les
// rejeux en attente au plancher de 250 ms: elle agit AVANT le degat, n'ecrit
// rien sur le disque, et n'a jamais faute.
```

Remplacer la declaration de `derniereAction`:

```js
  // La derniere action du maitre susceptible d'ouvrir un combat, datee, avec
  // le pid de qui l'a emise. Le pid sert a retrouver SON characterId quand la
  // kmk d'un esclave arrive: c'est lui qu'on cherche dans la liste.
  let derniereAction = { cle: null, instant: 0, pidMaitre: null };
```

Remplacer la garde d'entree de `onTrame` et y ajouter la branche des esclaves:

```js
  return function onTrame({ pid, dir, frame, estMaitre }) {
    // OMNI NE REPARE QUE CE QU'IL A CAUSE: sans duplication armee, aucun
    // esclave n'a rejoue quoi que ce soit.
    if (frame === null || !superviseur.arme) return;

    // LE TRAFIC DES ESCLAVES, que ce module ignorait entierement. C'est la
    // seule facon de voir le degat: le maitre, lui, ne sait pas dans quel
    // combat sont ses mules.
    if (!estMaitre) {
      if (dir !== 'in' || frame.type !== TYPE_COMBATTANTS) return;
      if (derniereAction.cle === null) return;
      if (maintenant() - derniereAction.instant >= FENETRE_APPRENTISSAGE_MS) return;
      const siens = combattantsDe(frame);
      // null: une liste de carte, personne ne combat.
      if (siens === null) return;
      const etatMaitre = superviseur.comptes.get(derniereAction.pidMaitre);
      const idMaitre = etatMaitre === null || etatMaitre === undefined
        ? null : etatMaitre.characterId;
      if (idMaitre === null || idMaitre === undefined) return;
      // Le maitre est dans la liste: la mule l'a rejoint, tout va bien.
      if (siens.has(String(idMaitre))) return;

      const cle = derniereAction.cle;
      // Consommee AVANT d'apprendre: deux mules entrant chacune dans son
      // combat ne doivent produire qu'une entree, et onApprendre peut lever.
      derniereAction = { cle: null, instant: 0, pidMaitre: null };
      if (estApprise(cle)) return;
      try {
        onApprendre(cle);
        onJournal(pid, `garde combat : ${cle} retenue — cette mule combat sans le maitre`);
      } catch (e) {
        onJournal(pid, `garde combat : apprentissage de ${cle} en erreur : ${e.message}`);
      }
      return;
    }
```

Dans la branche `dir === 'out'`, remplacer l'affectation de `derniereAction`:

```js
      if (cle !== null) derniereAction = { cle, instant: maintenant(), pidMaitre: pid };
```

Dans la branche `ieb`, SUPPRIMER entierement l'etape 2 (du commentaire
`// 2. Retenir, mais seulement si l'action est fraiche.` jusqu'a la ligne
`derniereAction = { cle: null, instant: 0 };` et la fermeture de son bloc).
Renumeroter le commentaire de l'etape 3 en etape 2.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/garde-combat.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS. `test/abandon-combat.test.js` doit rester vert: on importe sa
fonction, on ne la modifie pas.

- [ ] **Step 6: Commit**

```bash
git add src/garde-combat.js test/garde-combat.test.js
git commit -m "fix(garde-combat): retenir sur le degat constate, pas sur un indice"
```

---

## Ce qui reste a faire a la main, apres le plan

- **Verification en jeu.** Aucun test ne remplace une mesure: le defaut du
  28/08 sur `kmk` avait passe 16 tests unitaires et deux revues de code. A
  verifier: une mule qui rejoint le combat du maitre ne fait rien retenir, et
  un dialogue de quete solo en fait retenir un.
- **Publication.** Rien ne parvient aux amis tant que la version n'est pas
  publiee au panneau. La migration ne soigne personne avant cela.
