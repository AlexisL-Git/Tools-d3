# La file de dialogue par mule — plan d'implementation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qu'une mule refasse les actions de dialogue du maitre dans l'ordre, a
son rythme, et qu'elle ne reste JAMAIS avec une fenetre de dialogue ouverte.

**Architecture:** Un module `src/file-dialogue.js` tient une file d'attente par
mule. Le duplicateur, au lieu d'appeler `superviseur.rejouer()` pour `imp`,
`inh` et `kiy`, empile dans cette file. La file emet une etape a la fois et
attend le `imw` de la mule avant la suivante; refus, silence ou fin de file
menent tous a un `kiy`.

**Tech Stack:** Node.js, `node:test`, `node:assert`. Aucune dependance nouvelle.
Aucun sommeil dans les tests: horloge et planificateur sont injectes, comme dans
`src/echange.js` et `src/songe-en-cours.js`.

## Global Constraints

- Le spec est `docs/superpowers/specs/2026-09-09-file-dialogue-design.md`. Le lire en entier avant la tache 1.
- Branche: `feat/file-dialogue`. Ne jamais commiter sur `master`.
- `npm test` (= `node --test`) doit rester a 0 echec a chaque commit.
- Le module ne depend ni d'Electron, ni de Frida, ni du reseau.
- Francais sans accents dans le code et les commentaires, comme tout le depot.
- La garde des songes (`estDialogue(type) && dansUnSonge(pid)` dans `src/duplicateur.js`) reste AVANT la file. L'intervertir rendrait le boost aux mules en silence.
- `superviseur.emettre(pid, octets)` remet lui-meme le prefixe de longueur: ne jamais l'ajouter a la main.
- Octets de `kiy` releves en jeu le 09/09 (`journal-bug-0909.log`, 918394 ms): `0a220a150a13747970652e616e6b616d612e636f6d2f6b697910ffffffffffffffffff01`.

---

### Task 1: Le module et l'ordre — une etape a la fois, apres le `imw` de la mule

**Files:**
- Create: `src/file-dialogue.js`
- Test: `test/file-dialogue.test.js`

**Interfaces:**
- Consumes: `superviseur.comptes.esclaves(pidMaitre)` (rend les etats non exclus), `superviseur.comptes.get(pid)`, `superviseur.emettre(pid, octets)`, `superviseur.arme`.
- Produces:
  - `creerFileDialogue({ superviseur, onCompteRendu, delai, alea, planifier, annuler, maintenant })` -> `{ onTrame({ pid, dir, frame }), pousser({ pidMaitre, type, brute }) }`
  - `DELAI_ETAPE = { minMs: 150, maxMs: 600 }`, `DELAI_ATTENTE_MS = 3000`, `TRAME_FERMETURE` (Buffer)
  - `TYPE_OUVERTURE = 'imp'`, `TYPE_REPONSE = 'inh'`, `TYPE_FERMETURE = 'kiy'`
  - `TYPE_QUESTION = 'imw'`, `TYPE_REFUS_OUVERTURE = 'imq'`, `TYPE_FERME = 'kja'`, `CHAMP_QUESTION = 1`

- [ ] **Step 1: Ecrire le test qui echoue**

`test/file-dialogue.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  creerFileDialogue, TRAME_FERMETURE, TYPE_QUESTION, CHAMP_QUESTION,
} = require('../src/file-dialogue');

// Un superviseur double: il note ce qu'on lui demande d'emettre, sans reseau.
function faux(pids = [2, 3]) {
  const emis = [];
  const etats = new Map(pids.map((pid) => [pid, { pid, exclu: false }]));
  return {
    emis, etats, arme: true,
    comptes: {
      get: (pid) => etats.get(pid) || null,
      esclaves: () => [...etats.values()].filter((e) => !e.exclu),
    },
    emettre: (pid, octets) => { emis.push({ pid, octets }); return { ok: true, octets: octets.length }; },
  };
}

// Un planificateur a la main: rien ne part tant qu'on n'a pas fait avancer le
// temps. Aucun sommeil, donc aucun test qui depend de la charge de la machine.
function horloge() {
  let t = 0;
  const taches = [];
  return {
    maintenant: () => t,
    planifier: (f, ms) => { const tache = { a: t + ms, f, annule: false, faite: false }; taches.push(tache); return tache; },
    annuler: (tache) => { if (tache) tache.annule = true; },
    avancer(ms) {
      t += ms;
      for (const tache of [...taches].sort((a, b) => a.a - b.a)) {
        if (tache.annule || tache.faite || tache.a > t) continue;
        tache.faite = true;
        tache.f();
      }
    },
  };
}

const question = (no) => ({
  kind: 'event', type: TYPE_QUESTION, payload: [{ no: CHAMP_QUESTION, value: BigInt(no) }],
});
const etape = (type, octet) => ({ type, brute: Buffer.from([octet]) });
const creer = (sup, h, onCompteRendu = () => {}) => creerFileDialogue({
  superviseur: sup, alea: () => 0, planifier: h.planifier,
  annuler: h.annuler, maintenant: h.maintenant, onCompteRendu,
});
const fermetures = (sup) => sup.emis.filter(
  (e) => e.octets.toString('hex') === TRAME_FERMETURE.toString('hex'),
);

// Octets releves en jeu le 09/09 (journal-bug-0909.log, 918394 ms): le maitre
// ferme sa fenetre a la main. Meme forme que TRAME_ACCEPTATION de l'echange.
test('la trame de fermeture est celle mesuree', () => {
  assert.strictEqual(
    TRAME_FERMETURE.toString('hex'),
    '0a220a150a13747970652e616e6b616d612e636f6d2f6b697910ffffffffffffffffff01',
  );
});

test('les etapes partent dans l ordre, chacune apres le imw de la mule', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });

  assert.strictEqual(sup.emis.length, 0, 'rien avant le delai humain');
  h.avancer(150);
  assert.deepStrictEqual(sup.emis.map((e) => e.octets[0]), [0x11]);

  h.avancer(140);
  assert.strictEqual(sup.emis.length, 1, 'la suite attend la question de la mule');

  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  h.avancer(150);
  assert.deepStrictEqual(sup.emis.map((e) => e.octets[0]), [0x11, 0x22]);
});

test('deux mules avancent independamment', () => {
  const sup = faux([2, 3]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(150);
  assert.strictEqual(sup.emis.length, 2);

  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  h.avancer(150);
  assert.deepStrictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x22).map((e) => e.pid), [2],
  );
});
```

- [ ] **Step 2: Lancer le test, verifier qu'il echoue**

Run: `node --test test/file-dialogue.test.js`
Expected: FAIL — `Cannot find module '../src/file-dialogue'`

- [ ] **Step 3: Ecrire le module**

`src/file-dialogue.js`. En tete, la mesure du 09/09 qui justifie le module
(extraits cites dans le spec), puis:

```js
'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

// Les trois requetes du maitre qui composent un dialogue.
const TYPE_OUVERTURE = 'imp';
const TYPE_REPONSE = 'inh';
const TYPE_FERMETURE = 'kiy';

// Ce que la MULE recoit, et qui fait avancer sa file. Ces trois-la ne sont pas
// dans src/protocol/omni.js: cette table decrit ce qui se REJOUE, et aucun de
// ceux-ci ne se rejoue.
const TYPE_QUESTION = 'imw';
const TYPE_REFUS_OUVERTURE = 'imq';
const TYPE_FERME = 'kja';
const CHAMP_QUESTION = 1;

const DELAI_ETAPE = { minMs: 150, maxMs: 600 };
const DELAI_ATTENTE_MS = 3000;

const URL_FERMETURE = 'type.ankama.com/kiy';
const TRAME_FERMETURE = encodeRaw([
  { no: 1, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'string', value: URL_FERMETURE },
    ] },
    { no: 2, wire: WIRE.VARINT, value: -1n },
  ] },
]);

const champ = (frame, no) => (frame.payload || []).find((f) => f.no === no) || null;

function creerFileDialogue({
  superviseur, onCompteRendu = () => {}, delai = DELAI_ETAPE,
  alea = Math.random, planifier = setTimeout, annuler = clearTimeout,
  maintenant = () => Date.now(),
}) {
  // pid -> etat de file. ABSENT VEUT DIRE RIEN EN COURS.
  const files = new Map();

  const etatDe = (pid) => {
    let e = files.get(pid);
    if (e === undefined) {
      e = { etapes: [], enVol: false, attend: null, minuteur: null, question: null, ouvert: false };
      files.set(pid, e);
    }
    return e;
  };

  const retard = () => delai.minMs + Math.floor(alea() * (delai.maxMs - delai.minMs + 1));

  function avancer(pid) {
    const e = files.get(pid);
    if (e === undefined || e.enVol || e.attend !== null) return;
    const etape = e.etapes.shift();
    if (etape === undefined) return;   // la fermeture de fin de file vient a la tache 2
    e.enVol = true;
    planifier(() => emettre(pid, etape), retard());
  }

  function emettre(pid, etape) {
    const e = files.get(pid);
    if (e === undefined) return;
    e.enVol = false;
    const etat = superviseur.comptes.get(pid);
    // Relu A L'ECHEANCE: entre l'empilage et l'emission, la case du compte a pu
    // se decocher et Windows reattribuer le pid. Meme garde que src/passeur.js.
    if (!superviseur.arme || etat === null || etat === undefined || etat.exclu) return;
    superviseur.emettre(pid, etape.brute);
    // On retient la question d'AVANT: la tache 2 s'en sert pour reconnaitre une
    // reponse refusee.
    e.attend = { type: etape.type, question: e.question };
    avancer(pid);
  }

  function pousser({ pidMaitre, type, brute }) {
    for (const etat of superviseur.comptes.esclaves(pidMaitre)) {
      etatDe(etat.pid).etapes.push({ type, brute });
      avancer(etat.pid);
    }
  }

  function onTrame({ pid, dir, frame }) {
    if (dir !== 'in' || frame === null || frame === undefined) return;
    const e = files.get(pid);
    if (e === undefined) return;
    if (frame.type !== TYPE_QUESTION) return;
    const q = champ(frame, CHAMP_QUESTION);
    e.question = q === null ? null : q.value;
    e.ouvert = true;
    e.attend = null;
    avancer(pid);
  }

  return { onTrame, pousser };
}

module.exports = {
  creerFileDialogue, DELAI_ETAPE, DELAI_ATTENTE_MS, TRAME_FERMETURE,
  TYPE_OUVERTURE, TYPE_REPONSE, TYPE_FERMETURE,
  TYPE_QUESTION, TYPE_REFUS_OUVERTURE, TYPE_FERME, CHAMP_QUESTION,
};
```

- [ ] **Step 4: Lancer le test, verifier qu'il passe**

Run: `node --test test/file-dialogue.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/file-dialogue.js test/file-dialogue.test.js
git commit -m "feat(dialogue): la file par mule avance au rythme de la mule"
```

---

### Task 2: Les trois sorties — refus, silence, fin de file

**Files:**
- Modify: `src/file-dialogue.js`
- Test: `test/file-dialogue.test.js`

**Interfaces:**
- Consumes: tout ce que la tache 1 produit.
- Produces: `onCompteRendu({ pid, ok, raison, type })` a chaque sortie. Raisons exactes, a ne pas reformuler: `'la mule n a pas cette reponse'`, `'aucune reponse du serveur en 3 s'`, `'la mule n a pas pu ouvrir le dialogue'`.

- [ ] **Step 1: Ecrire les tests qui echouent**

```js
test('la meme question deux fois: la mule ferme et on le dit', () => {
  const sup = faux([2]);
  const h = horloge();
  const rendus = [];
  const file = creer(sup, h, (r) => rendus.push(r));

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(150);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  h.avancer(150);                                                // le inh part
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });     // LA MEME

  assert.strictEqual(fermetures(sup).length, 1);
  assert.deepStrictEqual(
    rendus.map((r) => [r.ok, r.raison]),
    [[false, 'la mule n a pas cette reponse']],
  );
});

test('aucune reponse en 3 s: la mule ferme, et la file ne repart jamais', () => {
  const sup = faux([2]);
  const h = horloge();
  const rendus = [];
  const file = creer(sup, h, (r) => rendus.push(r));

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(150);
  assert.strictEqual(sup.emis.length, 1);
  h.avancer(3000);

  assert.deepStrictEqual(rendus.map((r) => r.raison), ['aucune reponse du serveur en 3 s']);
  assert.strictEqual(fermetures(sup).length, 1);
  h.avancer(10000);
  assert.strictEqual(sup.emis.filter((e) => e.octets[0] === 0x22).length, 0);
});

test('imq: la mule n a pas pu ouvrir, on vide la file', () => {
  const sup = faux([2]);
  const h = horloge();
  const rendus = [];
  const file = creer(sup, h, (r) => rendus.push(r));

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(150);
  file.onTrame({ pid: 2, dir: 'in', frame: { kind: 'event', type: 'imq', payload: [] } });
  h.avancer(10000);

  assert.deepStrictEqual(rendus.map((r) => r.raison), ['la mule n a pas pu ouvrir le dialogue']);
  assert.strictEqual(sup.emis.filter((e) => e.octets[0] === 0x22).length, 0);
});

test('le maitre a fini avant la mule: les etapes restantes partent quand meme', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x33) });
  h.avancer(150);
  file.onTrame({ pid: 2, dir: 'in', frame: question(43122) });
  h.avancer(150);
  file.onTrame({ pid: 2, dir: 'in', frame: question(43123) });
  h.avancer(150);

  assert.deepStrictEqual(sup.emis.map((e) => e.octets[0]), [0x11, 0x22, 0x33]);
});

test('la file videe ferme la fenetre une seule fois', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(150);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  h.avancer(10000);

  assert.strictEqual(fermetures(sup).length, 1);
});

test('un kja recu ferme l etat: aucune fermeture de plus n est emise', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(150);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  file.onTrame({ pid: 2, dir: 'in', frame: { kind: 'event', type: 'kja', payload: [{ no: 1, value: 1n }] } });
  h.avancer(10000);

  assert.strictEqual(fermetures(sup).length, 0);
});
```

- [ ] **Step 2: Lancer, verifier qu'ils echouent**

Run: `node --test test/file-dialogue.test.js`
Expected: FAIL — aucune fermeture emise, `rendus` vide.

- [ ] **Step 3: Ecrire l'implementation**

1. `emettre()` pose le minuteur d'abandon et traite la fermeture a part:

```js
    superviseur.emettre(pid, etape.brute);
    if (etape.type === TYPE_FERMETURE) {
      e.ouvert = false; e.question = null;
      return avancer(pid);
    }
    // Mesure du 09/09: une reponse refusee fait renvoyer au serveur la MEME
    // question (imw { 1=2681 }), avec un log { 1=418 } que seules les mules
    // recoivent. C'est le seul signal de refus qui existe.
    e.attend = { type: etape.type, question: e.question };
    e.minuteur = planifier(() => echec(pid, 'aucune reponse du serveur en 3 s'), DELAI_ATTENTE_MS);
```

2. `onTrame()` traite les trois entrants:

```js
    if (frame.type === TYPE_QUESTION) {
      const q = champ(frame, CHAMP_QUESTION);
      const valeur = q === null ? null : q.value;
      const attente = e.attend;
      e.ouvert = true;
      if (attente !== null && attente.type === TYPE_REPONSE
          && attente.question !== null && valeur === attente.question) {
        return echec(pid, 'la mule n a pas cette reponse');
      }
      e.question = valeur;
      leverAttente(e);
      return avancer(pid);
    }
    if (frame.type === TYPE_REFUS_OUVERTURE) return echec(pid, 'la mule n a pas pu ouvrir le dialogue');
    if (frame.type === TYPE_FERME) {
      e.ouvert = false; e.question = null;
      leverAttente(e);
      return avancer(pid);
    }
```

3. Les sorties, et la seule fonction qui ferme:

```js
  function leverAttente(e) {
    if (e.minuteur !== null) { annuler(e.minuteur); e.minuteur = null; }
    e.attend = null;
  }

  // Vider la file et fermer: TOUTES les sorties passent par ici, c'est ce qui
  // garantit qu'aucune mule ne reste avec une fenetre ouverte.
  function echec(pid, raison) {
    const e = files.get(pid);
    if (e === undefined) return;
    const type = e.attend === null ? null : e.attend.type;
    e.etapes.length = 0;
    leverAttente(e);
    fermer(pid, e);
    onCompteRendu({ pid, ok: false, raison, type });
  }

  function fermer(pid, e) {
    if (!e.ouvert) return;
    e.ouvert = false;
    e.question = null;
    const etat = superviseur.comptes.get(pid);
    if (!superviseur.arme || etat === null || etat === undefined || etat.exclu) return;
    superviseur.emettre(pid, TRAME_FERMETURE);
  }
```

4. `avancer()`: quand `e.etapes` est vide, qu'aucune etape n'est en vol et
   qu'aucune attente ne court, appeler `fermer(pid, e)`. C'est la fermeture de
   securite de fin de file.

- [ ] **Step 4: Lancer, verifier que tout passe**

Run: `node --test test/file-dialogue.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/file-dialogue.js test/file-dialogue.test.js
git commit -m "feat(dialogue): refus, silence et fin de file ferment toujours la fenetre"
```

---

### Task 3: Brancher la file dans le duplicateur, sans toucher aux songes

**Files:**
- Modify: `src/duplicateur.js`
- Test: `test/duplicateur.test.js`

**Interfaces:**
- Consumes: `creerFileDialogue(...)` de la tache 2.
- Produces: `creerDuplicateur({ superviseur, onCompteRendu, estApprise, dansUnSonge, fileDialogue })`. `fileDialogue` vaut `null` par defaut — sans lui, le comportement est celui d'avant, et les tests existants restent valables.

- [ ] **Step 1: Ecrire les tests qui echouent**

Ajouter a `test/duplicateur.test.js` (le double `faux()` du fichier doit porter
`comptes: { esclaves: () => [{ pid: 2 }] }`; l'ajouter s'il manque, sans toucher
aux autres tests):

```js
test('un dialogue va dans la file, pas dans rejouer()', () => {
  const sup = faux();
  const pousses = [];
  const dup = creerDuplicateur({
    superviseur: sup,
    fileDialogue: { pousser: (a) => pousses.push(a) },
  });

  dup(trame({ frame: { kind: 'request', type: 'imp', payload: [] } }));

  assert.strictEqual(sup.appels.length, 0, 'rejouer() ne doit plus voir le dialogue');
  assert.deepStrictEqual(pousses.map((p) => p.type), ['imp']);
});

// LE VERROU DES SONGES. Si la file passait avant la garde, les mules
// rejoueraient le dialogue du PNJ a boost — en silence, et seule une session en
// jeu le verrait. Voir src/songe-en-cours.js.
test('dans un songe, le dialogue n entre meme pas dans la file', () => {
  const sup = faux();
  const pousses = [];
  const rendus = [];
  const dup = creerDuplicateur({
    superviseur: sup,
    dansUnSonge: () => true,
    fileDialogue: { pousser: (a) => pousses.push(a) },
    onCompteRendu: (r) => rendus.push(r),
  });

  dup(trame({ frame: { kind: 'request', type: 'imp', payload: [] } }));

  assert.strictEqual(pousses.length, 0);
  assert.strictEqual(sup.appels.length, 0);
  assert.match(rendus[0].rendu[0].raison, /songe/);
});

test('sans file, le dialogue se rejoue comme avant', () => {
  const sup = faux();
  const dup = creerDuplicateur({ superviseur: sup });
  dup(trame({ frame: { kind: 'request', type: 'imp', payload: [] } }));
  assert.deepStrictEqual(sup.appels.map((a) => a.type), ['imp']);
});
```

- [ ] **Step 2: Lancer, verifier qu'ils echouent**

Run: `node --test test/duplicateur.test.js`
Expected: FAIL — le dialogue part encore dans `rejouer()`.

- [ ] **Step 3: Ecrire l'implementation**

Dans `src/duplicateur.js`, ajouter `fileDialogue = null` aux options, et juste
APRES la garde des songes (qui ne bouge pas d'une ligne), avant le garde-combat:

```js
    // LE DIALOGUE PASSE PAR SA FILE, pas par rejouer(). Une mule ne peut pas
    // repondre a une question qu'elle n'a pas encore recue: mesure du 09/09,
    // une reponse de quete rejouee chez une mule qui ne l'a pas laissait sa
    // fenetre ouverte POUR TOUJOURS, et tous les PNJ suivants etaient refuses
    // par un `imq {}`. Voir docs/superpowers/specs/2026-09-09-file-dialogue-design.md.
    //
    // APRES la garde des songes, jamais avant: dans un songe le dialogue ne
    // doit pas partir du tout.
    if (fileDialogue !== null && estDialogue(frame.type)) {
      fileDialogue.pousser({ pidMaitre: pid, type: frame.type, brute });
      return;
    }
```

- [ ] **Step 4: Lancer toute la suite**

Run: `npm test`
Expected: PASS, 0 echec.

- [ ] **Step 5: Commit**

```bash
git add src/duplicateur.js test/duplicateur.test.js
git commit -m "feat(dialogue): le duplicateur empile le dialogue au lieu de le tirer"
```

---

### Task 4: Brancher l'application et le CLI

**Files:**
- Modify: `desktop/main.js` (autour de `creerSuiviSonge` et `creerDuplicateur`, ~1380-1402)
- Modify: `src/cli/mm.js` (la ou `creerDuplicateur` est construit)

**Interfaces:**
- Consumes: `creerFileDialogue` (tache 2), `creerDuplicateur({ fileDialogue })` (tache 3).
- Produces: rien pour d'autres taches.

- [ ] **Step 1: Brancher dans `desktop/main.js`**

Importer en tete: `const { creerFileDialogue } = require('../src/file-dialogue');`

A cote de `suiviSonge` — meme raison, c'est de la plomberie, donc PAS derriere
`protege()`:

```js
  // La file de dialogue est de la PLOMBERIE, comme le suivi de songe: elle ne
  // fait rien par elle-meme, elle cadence ce que le duplicateur lui donne. La
  // mettre derriere un droit laisserait des mules avec une fenetre ouverte.
  const fileDialogue = creerFileDialogue({
    superviseur,
    onCompteRendu: ({ pid, raison }) => {
      journal(pid, `dialogue : ${raison}`);
      messages.set(pid, `dialogue : ${raison}`);
    },
  });
```

Puis dans `composer(...)`: `fileDialogue.onTrame` APRES `suiviSonge.onTrame` et
AVANT le duplicateur, et `fileDialogue` passe a `creerDuplicateur`.

- [ ] **Step 2: Verifier que le fichier se charge**

Run: `node --check desktop/main.js`
Expected: aucune sortie (syntaxe valide).

- [ ] **Step 3: Brancher dans `src/cli/mm.js`**

Meme chose: import, construction avec
`onCompteRendu: ({ pid, raison }) => console.log(\`[${pid}] dialogue : ${raison}\`)`,
`fileDialogue.onTrame` dans le `composer(...)` apres `creerSuiviSonge`, et
`fileDialogue` passe a `creerDuplicateur`.

Run: `node --check src/cli/mm.js`

- [ ] **Step 4: Lancer toute la suite**

Run: `npm test`
Expected: PASS, 0 echec.

- [ ] **Step 5: Commit**

```bash
git add desktop/main.js src/cli/mm.js
git commit -m "feat(dialogue): l application et le CLI cadencent le dialogue par la file"
```

---

### Task 5: Verifier EN JEU, puis seulement conclure

**Files:** aucun. Cette tache est une mesure, et c'est la seule qui prouve quoi
que ce soit sur le comportement reel.

- [ ] **Step 1:** Lancer `C:\Users\Utilisateur\Desktop\OMNI-mesure.bat` (mode dev, journal complet).
- [ ] **Step 2:** Faire parler le maitre a un PNJ ORDINAIRE avec le groupe. Attendu: dans `journal-bug-0909.log`, les `imw` de chaque mule s'intercalent entre ses etapes, et aucune ligne `dialogue :`.
- [ ] **Step 3:** Refaire le PNJ de quete du 09/09 (`-20008`, reponse `56180`). Attendu: `dialogue : la mule n a pas cette reponse` pour chaque mule, une trame `kiy` derriere, et **le PNJ suivant s'ouvre normalement** (`inn` + `imw`, plus de `imq {}`).
- [ ] **Step 4:** Faire un songe. Attendu: `dialogue dans un songe : le boost est au maitre`, et AUCUNE ligne de file.
- [ ] **Step 5:** Ne declarer le defaut corrige qu'apres avoir relu ces trois traces.
