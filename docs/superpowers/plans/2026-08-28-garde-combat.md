# Garde contre les combats dupliqués — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empêcher les esclaves de lancer leur propre combat quand le maître accepte un combat de quête.

**Architecture:** Deux mécanismes complémentaires. Un **délai** de 250 ms sur les trois types de messages qui peuvent déclencher un combat, avec **annulation** de tout rejeu en attente dès que le maître entre en combat — cela attrape la première occurrence. Et une **liste apprise** d'actions connues pour déclencher un combat, qui les refuse d'emblée les fois suivantes. Un module pur porte la décision, le superviseur gagne l'annulation, le duplicateur applique la politique.

**Tech Stack:** Node 22 + `node:test`, Electron 43. Aucune dépendance nouvelle.

**Spec :** `docs/superpowers/specs/2026-08-28-garde-combat-design.md`

## Global Constraints

- **Aucune dépendance npm nouvelle.**
- **Types sensibles, exactement ces trois :** `iov` (parler au PNJ), `ioy` (réponse de dialogue), `iwo` (élément interactif). Les cinq autres types rejoués ne changent pas de comportement.
- **Signal d'entrée en combat :** `ieb`, sur le flux **entrant** du **maître**.
- **Valeurs exactes :** plancher de rejeu `250` ms, fenêtre d'apprentissage `2000` ms, fenêtre de fermeture de dialogue `30000` ms.
- **Forme des clés :** `ioy:<champ 1>`, `iov:<champ 2>:<champ 3>`, `iwo:<champ 2>`. Jamais d'autre forme, jamais de clé partielle.
- **Commentaires en français sans accents** dans les `.js`. Accents admis dans les chaînes affichées à l'utilisateur.
- **`npm test` vert à chaque commit.** 626 tests au départ.
- **Le garde n'agit que si `superviseur.arme` vaut vrai.** OMNI ne répare que ce qu'il a causé : sans duplication armée, aucun esclave n'a rejoué quoi que ce soit.

---

### Task 1: Le module de decision

**Files:**
- Create: `src/garde-combat.js`
- Test: `test/garde-combat.test.js`

**Interfaces:**
- Consumes: `encodeRaw`, `WIRE` de `src/codec/rawProto.js` — le même couple qu'utilise `src/passeur.js`.
- Produces:
  - `estSensible(type)` → `boolean`
  - `cleDe(type, frame)` → `string | null`
  - `TRAME_FERMER_DIALOGUE` → `Buffer`
  - `TYPES_SENSIBLES`, `TYPE_ENTREE_COMBAT`, `DELAI_PLANCHER_MS`, `FENETRE_APPRENTISSAGE_MS`, `FENETRE_DIALOGUE_MS`

- [ ] **Step 1: Write the failing tests**

Créer `test/garde-combat.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  estSensible, cleDe, TRAME_FERMER_DIALOGUE,
  DELAI_PLANCHER_MS, FENETRE_APPRENTISSAGE_MS, FENETRE_DIALOGUE_MS,
} = require('../src/garde-combat');
const { decodeFrameRaw } = require('../src/codec/rawProto');

const trame = (type, champs) => ({
  kind: 'request', type,
  payload: Object.entries(champs).map(([no, value]) => ({ no: Number(no), value })),
});

// Les trois types qui peuvent lancer un combat, et eux seuls. Les cinq autres
// types rejoues — teleportation, changement de carte, information de carte,
// havre-sac, sortie de donjon — ne declenchent aucun combat.
test('seuls les trois types de dialogue et d interaction sont sensibles', () => {
  for (const t of ['iov', 'ioy', 'iwo']) assert.strictEqual(estSensible(t), true, t);
  for (const t of ['hjc', 'jqk', 'jrh', 'kla', 'kjw', 'jbn', 'ieb']) {
    assert.strictEqual(estSensible(t), false, t);
  }
});

// Les valeurs viennent de la capture du 28/08: le maitre a repondu ioy 25088,
// et le combat a demarre 30 ms plus tard.
test('la cle d une reponse de dialogue porte son numero', () => {
  assert.strictEqual(cleDe('ioy', trame('ioy', { 1: 25088 })), 'ioy:25088');
});

test('la cle d un PNJ porte sa carte et son instance', () => {
  assert.strictEqual(cleDe('iov', trame('iov', { 1: 3, 2: 153356294, 3: -20000 })), 'iov:153356294:-20000');
});

test('la cle d un element interactif porte son identifiant', () => {
  assert.strictEqual(cleDe('iwo', trame('iwo', { 1: 1920, 2: 489565 })), 'iwo:489565');
});

test('un type non sensible n a pas de cle', () => {
  assert.strictEqual(cleDe('hjc', trame('hjc', { 1: 1, 2: 2 })), null);
  assert.strictEqual(cleDe('ieb', trame('ieb', { 1: 1642, 2: 9828 })), null);
});

// UNE CLE PARTIELLE EST PIRE QUE PAS DE CLE: elle bloquerait une autre action
// que celle qu'on a vue lancer un combat.
test('un champ manquant ne donne pas de cle partielle', () => {
  assert.strictEqual(cleDe('iov', trame('iov', { 2: 153356294 })), null);
  assert.strictEqual(cleDe('ioy', trame('ioy', {})), null);
  assert.strictEqual(cleDe('iwo', trame('iwo', { 1: 1920 })), null);
});

test('une trame absente ou malformee ne donne pas de cle', () => {
  assert.strictEqual(cleDe('ioy', null), null);
  assert.strictEqual(cleDe('ioy', 'x'), null);
  assert.strictEqual(cleDe('ioy', { kind: 'request', type: 'ioy', payload: null }), null);
});

// Les valeurs BigInt du decodeur doivent rendre la meme cle que les nombres,
// sans quoi la liste apprise ne reconnaitrait jamais l'action rejouee.
test('un champ BigInt rend la meme cle qu un nombre', () => {
  assert.strictEqual(cleDe('ioy', trame('ioy', { 1: 25088n })), 'ioy:25088');
});

test('la trame de fermeture de dialogue est un kla sans charge utile', () => {
  const f = decodeFrameRaw(TRAME_FERMER_DIALOGUE);
  assert.notStrictEqual(f, null);
  assert.strictEqual(f.kind, 'request');
  assert.strictEqual(f.type, 'kla');
  assert.ok(f.payload === null || f.payload.length === 0, 'kla ne porte aucun champ');
});

test('les valeurs de reglage sont celles de la conception', () => {
  assert.strictEqual(DELAI_PLANCHER_MS, 250);
  assert.strictEqual(FENETRE_APPRENTISSAGE_MS, 2000);
  assert.strictEqual(FENETRE_DIALOGUE_MS, 30000);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/garde-combat.test.js`
Expected: FAIL — `Cannot find module '../src/garde-combat'`.

- [ ] **Step 3: Implement**

Créer `src/garde-combat.js` :

```js
'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

// Le garde contre les combats dupliques, et lui seul.
//
// LE PROBLEME. La duplication rejoue fidelement les actions du maitre, et
// c'est sa fidelite qui coute le combat: quand une quete propose un combat
// solo, la reponse de dialogue du maitre est rejouee chez chaque esclave, et
// chacun lance LE SIEN. Mesure le 28/08: identifiants de combat distincts,
// -20147 chez le maitre, -20148 chez l'esclave. Ils n'entrent pas dans le
// combat du maitre, ils en ouvrent un chacun.
//
// Au moment de l'envoi, RIEN ne distingue une reponse qui declenche un combat
// d'une reponse ordinaire: c'est un numero dans un arbre de dialogue.
//
// LA FENETRE. Le rejeu part 16 a 80 ms apres l'action du maitre, et le serveur
// annonce le combat au maitre en 30 ms. Un rejeu retarde peut donc etre annule
// avant d'etre ecrit. C'est tout le mecanisme.
//
// LE SIGNAL. `ieb` sur le flux entrant. Sur 58 changements de carte du journal
// du 28/08, six seulement en portent un — et ce sont exactement les entrees en
// combat. Tous les autres messages de la rafale d'entree (iom, kld, kml, kmp,
// kub, lqn) apparaissent aussi sur des changements de carte ordinaires.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme.

const TYPE_ENTREE_COMBAT = 'ieb';

// Les seuls types rejoues qui peuvent ouvrir un combat. Les cinq autres —
// teleportation, changement de carte, information de carte, havre-sac, sortie
// de donjon — n'en ouvrent aucun, et les retarder ne protegerait de rien.
//
// La valeur est la liste des champs qui IDENTIFIENT l'action, dans l'ordre ou
// ils composent la cle.
const CHAMPS_CLE = {
  iov: [2, 3],   // la carte, puis l'instance de PNJ
  ioy: [1],      // le numero de reponse dans l'arbre de dialogue
  iwo: [2],      // l'element interactif (le champ 1 est propre au compte)
};

const TYPES_SENSIBLES = Object.keys(CHAMPS_CLE);

// Plancher avant l'ecriture du premier esclave, contre 16 ms d'etalement seul.
// Le signal a ete mesure a 30 ms; le facteur 8 couvre la gigue reseau sans
// etre perceptible sur une interaction de quete.
const DELAI_PLANCHER_MS = 250;

// Au-dela, on ne retient plus: un monstre agressif qui saute sur le maitre
// trois secondes apres un dialogue anodin n'a pas a empoisonner la liste.
const FENETRE_APPRENTISSAGE_MS = 2000;

// Au-dela, on ne ferme plus le dialogue des esclaves: il n'y en a plus.
const FENETRE_DIALOGUE_MS = 30000;

const URL_FERMER_DIALOGUE = 'type.ankama.com/kla';

// DialogLeaveRequest, constante et vide. Meme enveloppe que TRAME_PASSE dans
// src/passeur.js: request { Any{ type_url }, uid: -1 }. kla ne porte aucun
// champ (voir src/protocol/omni.js), donc rien n'y depend du destinataire.
//
// L'uid de -1 est repris de la trame jxy mesuree le 20/08, faute d'avoir
// mesure celui d'un kla reel. A confirmer en conditions reelles.
const TRAME_FERMER_DIALOGUE = encodeRaw([
  { no: 2, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'string', value: URL_FERMER_DIALOGUE },
    ] },
    { no: 2, wire: WIRE.VARINT, value: -1n },
  ] },
]);

function estSensible(type) {
  return Object.prototype.hasOwnProperty.call(CHAMPS_CLE, type);
}

// La cle qui identifie une action, ou null si elle ne s'identifie pas.
//
// UNE CLE PARTIELLE EST PIRE QUE PAS DE CLE: elle bloquerait une autre action
// que celle qu'on a vue lancer un combat. Un champ manquant rend donc null,
// jamais une cle amputee.
function cleDe(type, frame) {
  if (!estSensible(type)) return null;
  if (frame === null || typeof frame !== 'object') return null;
  const champs = frame.payload;
  if (!Array.isArray(champs)) return null;

  const parties = [type];
  for (const no of CHAMPS_CLE[type]) {
    const f = champs.find((x) => x && x.no === no);
    if (f === undefined || f.value === undefined || f.value === null) return null;
    // Le decodeur rend des BigInt: String() les met dans la meme forme que les
    // nombres, sans quoi la liste apprise ne reconnaitrait jamais l'action.
    parties.push(String(f.value));
  }
  return parties.join(':');
}

module.exports = {
  estSensible, cleDe, TRAME_FERMER_DIALOGUE,
  TYPES_SENSIBLES, TYPE_ENTREE_COMBAT,
  DELAI_PLANCHER_MS, FENETRE_APPRENTISSAGE_MS, FENETRE_DIALOGUE_MS,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/garde-combat.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/garde-combat.js test/garde-combat.test.js
git commit -m "feat(garde): identifier les actions qui peuvent lancer un combat

Trois types rejoues peuvent ouvrir un combat: parler a un PNJ, repondre
dans un dialogue, utiliser un element interactif. Au moment de l'envoi,
rien ne distingue une reponse qui declenche un combat d'une reponse
ordinaire — c'est un numero dans un arbre de dialogue.

cleDe() donne a chaque action une identite stable, pour qu'une action
vue lancer un combat puisse etre refusee la fois suivante. Un champ
manquant rend null et jamais une cle amputee: une cle partielle
bloquerait une AUTRE action que celle qu'on a vue.

TRAME_FERMER_DIALOGUE est le pendant de TRAME_PASSE: une requete
constante et vide, construite une fois."
```

---

### Task 2: L annulation des rejeux en attente

**Files:**
- Modify: `src/superviseur.js`
- Test: `test/superviseur.test.js`

**Interfaces:**
- Consumes: rien de la tâche 1.
- Produces:
  - `superviseur.annulerRejeux()` → `number`, le nombre de rejeux annulés
  - `rejouer({ type, brute, pidMaitre, retardPlancher })` — le paramètre `retardPlancher` est nouveau, il vaut `0` par défaut et le comportement sans lui est inchangé

**Le manque à combler.** `_emettreApres` planifie une écriture différée et **ne mémorise pas son minuteur** : rien n'est annulable aujourd'hui. C'est exactement le manque qu'avait le passe-tour avant le 27/08, et il se règle de la même façon — un `Set` de minuteurs par pid, que l'échéance vide d'elle-même.

- [ ] **Step 1: Write the failing tests**

Ajouter à `test/superviseur.test.js` :

```js
// --- annulation des rejeux differes ---------------------------------------

// Un rejeu differe qui n'a pas encore ete ecrit peut etre repris. C'est tout
// le mecanisme du garde contre les combats dupliques: le serveur annonce le
// combat au maitre 30 ms apres son action, bien avant l'echeance du rejeu.
function superviseurAvecEsclaveEcrivant(pidMaitre, pidEsclave) {
  const ecrits = [];
  const s = new Superviseur({ arme: true, etalementRejeu: { minMs: 60, maxMs: 60 } });
  s.comptes.ajouter({ pid: pidMaitre, port: 8301 });
  s.comptes.ajouter({ pid: pidEsclave, port: 8302 });
  s.clients.set(pidEsclave, { pid: pidEsclave, amont: { write: (p) => ecrits.push(p) } });
  return { s, ecrits };
}

test('un rejeu differe s annule avant son echeance', async () => {
  const { s, ecrits } = superviseurAvecEsclaveEcrivant(1, 2);
  const rendu = s.rejouer({ type: 'hjc', brute: Buffer.from([0x08, 0x01]), pidMaitre: 1 });
  assert.strictEqual(rendu[0].emis, true);
  assert.strictEqual(s.annulerRejeux(), 1);
  await new Promise((r) => setTimeout(r, 160));
  assert.deepStrictEqual(ecrits, [], 'rien ne doit avoir ete ecrit');
});

test('annulerRejeux rend zero quand rien n attend', () => {
  const { s } = superviseurAvecEsclaveEcrivant(1, 2);
  assert.strictEqual(s.annulerRejeux(), 0);
});

// Un minuteur echu ne doit pas rester en memoire: sans cela, la liste grossit
// a chaque rejeu de la session.
test('un rejeu arrive a echeance ne reste pas annulable', async () => {
  const { s, ecrits } = superviseurAvecEsclaveEcrivant(1, 2);
  s.rejouer({ type: 'hjc', brute: Buffer.from([0x08, 0x01]), pidMaitre: 1 });
  await new Promise((r) => setTimeout(r, 160));
  assert.strictEqual(ecrits.length, 1, 'le rejeu a bien eu lieu');
  assert.strictEqual(s.annulerRejeux(), 0);
});

// Sans etalement, l'ecriture est immediate: il n'y a rien a annuler, et c'est
// le comportement voulu — un rejeu deja ecrit ne se rattrape pas.
test('un rejeu immediat n est pas annulable', () => {
  const ecrits = [];
  const s = new Superviseur({ arme: true });
  s.comptes.ajouter({ pid: 1, port: 8301 });
  s.comptes.ajouter({ pid: 2, port: 8302 });
  s.clients.set(2, { pid: 2, amont: { write: (p) => ecrits.push(p) } });
  s.rejouer({ type: 'hjc', brute: Buffer.from([0x08, 0x01]), pidMaitre: 1 });
  assert.strictEqual(ecrits.length, 1);
  assert.strictEqual(s.annulerRejeux(), 0);
});

// --- plancher de retard ----------------------------------------------------

// Le plancher s'ajoute a l'etalement, il ne le remplace pas: les esclaves
// restent decales les uns des autres.
test('le plancher de retard recule le premier esclave', () => {
  const s = new Superviseur({ arme: false, etalementRejeu: { minMs: 20, maxMs: 20 } });
  s.comptes.ajouter({ pid: 1, port: 8301 });
  s.comptes.ajouter({ pid: 2, port: 8302 });
  s.comptes.ajouter({ pid: 3, port: 8303 });
  const sans = s.rejouer({ type: 'hjc', brute: Buffer.from([0x08, 0x01]), pidMaitre: 1 });
  assert.deepStrictEqual(sans.map((r) => r.retardMs), [20, 40]);
  const avec = s.rejouer({ type: 'hjc', brute: Buffer.from([0x08, 0x01]), pidMaitre: 1, retardPlancher: 250 });
  assert.deepStrictEqual(avec.map((r) => r.retardMs), [270, 290]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/superviseur.test.js`
Expected: FAIL — `s.annulerRejeux is not a function`.

- [ ] **Step 3: Implement**

Dans le constructeur de `Superviseur`, après `this.etalementRejeu = etalementRejeu;` :

```js
    // Les rejeux differes encore en attente, par pid. Sans eux, rien n'est
    // annulable — et c'est toute la protection contre le combat duplique: le
    // serveur annonce le combat au maitre 30 ms apres son action, bien avant
    // l'echeance d'un rejeu retarde.
    this._rejeuxEnAttente = new Map();   // pid -> Set de minuteurs
```

Remplacer `_emettreApres` :

```js
  _emettreApres(retardMs, pid, amont, paquet) {
    let lot = this._rejeuxEnAttente.get(pid);
    if (lot === undefined) { lot = new Set(); this._rejeuxEnAttente.set(pid, lot); }
    const t = this.planifier(() => {
      // Un minuteur echu se retire de lui-meme: sans cela la liste grossit a
      // chaque rejeu de la session.
      lot.delete(t);
      try { amont.write(paquet); }
      catch (e) { this.journal(pid, `rejeu differe (${retardMs} ms) : ${e.message}`); }
    }, retardMs);
    lot.add(t);
  }

  // Annule tout rejeu encore en attente, chez tous les esclaves. Rend le
  // nombre annule.
  //
  // Un rejeu DEJA ECRIT ne se rattrape pas — c'est precisement pourquoi les
  // actions qui peuvent ouvrir un combat partent avec un plancher de retard.
  annulerRejeux() {
    let n = 0;
    for (const lot of this._rejeuxEnAttente.values()) {
      for (const t of lot) { clearTimeout(t); n += 1; }
      lot.clear();
    }
    this._rejeuxEnAttente.clear();
    return n;
  }
```

Dans `rejouer`, ajouter le paramètre et l'utiliser comme valeur de départ :

```js
  rejouer({ type, brute, pidMaitre, retardPlancher = 0 }) {
    const rendu = [];
    // Le plancher recule TOUS les esclaves sans supprimer leur etalement: le
    // premier part a retardPlancher + son ecart, pas a retardPlancher.
    let retard = retardPlancher;
```

Le reste de la méthode ne change pas.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/superviseur.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: `fail 0`. Les tests existants du rejeu ne doivent pas bouger : `retardPlancher` vaut `0` par défaut.

- [ ] **Step 6: Commit**

```bash
git add src/superviseur.js test/superviseur.test.js
git commit -m "feat(superviseur): annuler les rejeux encore en attente

_emettreApres planifiait une ecriture differee sans memoriser son
minuteur: rien n'etait annulable. C'est le meme manque qu'avait le
passe-tour avant le 27/08.

annulerRejeux() reprend tout ce qui n'est pas encore ecrit. Un rejeu
deja ecrit ne se rattrape pas — d'ou le plancher de retard, qui donne au
maitre le temps d'apprendre qu'il entre en combat avant que les esclaves
n'aient rien envoye.

Le plancher s'AJOUTE a l'etalement au lieu de le remplacer: les esclaves
restent decales les uns des autres."
```

---

### Task 3: La politique dans le duplicateur

**Files:**
- Modify: `src/duplicateur.js`
- Test: `test/duplicateur.test.js`

**Interfaces:**
- Consumes: `estSensible`, `cleDe`, `DELAI_PLANCHER_MS` de `src/garde-combat.js` ; `rejouer({..., retardPlancher})` de la tâche 2.
- Produces: `creerDuplicateur({ superviseur, onCompteRendu, estApprise })` — `estApprise(cle)` → `boolean`, vaut `() => false` par défaut, donc le comportement sans elle est inchangé.

- [ ] **Step 1: Write the failing tests**

Ajouter à `test/duplicateur.test.js` :

```js
// --- garde contre les combats dupliques ------------------------------------

const { DELAI_PLANCHER_MS } = require('../src/garde-combat');

function superviseurQuiNoteLesRejeux(esclaves = [2]) {
  const appels = [];
  return {
    appels,
    arme: true,
    comptes: { esclaves: () => esclaves.map((pid) => ({ pid })) },
    rejouer: (args) => {
      appels.push(args);
      return esclaves.map((pid) => ({ pid, ok: true, emis: true, retardMs: args.retardPlancher || 0 }));
    },
  };
}

const sortante = (type, champs) => ({
  pid: 1, dir: 'out', estMaitre: true, brute: Buffer.from([0x08, 0x01]),
  frame: {
    kind: 'request', type,
    payload: Object.entries(champs).map(([no, value]) => ({ no: Number(no), value })),
  },
});

// Les trois types qui peuvent ouvrir un combat partent avec le plancher: le
// serveur annonce le combat au maitre 30 ms apres son action, et il faut que
// rien ne soit encore ecrit a cet instant.
test('une action sensible part avec le plancher de retard', () => {
  const sup = superviseurQuiNoteLesRejeux();
  const d = creerDuplicateur({ superviseur: sup });
  d(sortante('ioy', { 1: 25088 }));
  assert.strictEqual(sup.appels[0].retardPlancher, DELAI_PLANCHER_MS);
});

test('une action ordinaire garde son etalement seul', () => {
  const sup = superviseurQuiNoteLesRejeux();
  const d = creerDuplicateur({ superviseur: sup });
  d(sortante('hjc', { 1: 1, 2: 2 }));
  assert.strictEqual(sup.appels[0].retardPlancher || 0, 0);
});

// Une action deja vue lancer un combat n'est ni retardee ni tentee.
test('une action apprise n est pas rejouee du tout', () => {
  const sup = superviseurQuiNoteLesRejeux();
  const d = creerDuplicateur({ superviseur: sup, estApprise: (c) => c === 'ioy:25088' });
  d(sortante('ioy', { 1: 25088 }));
  assert.strictEqual(sup.appels.length, 0, 'rejouer ne doit pas etre appele');
});

// Un compte qui ne rejoue pas ressemble a un compte inactif: le refus doit se
// voir sur sa ligne, comme tout autre refus de rejeu.
test('le refus est signale pour chaque esclave', () => {
  const sup = superviseurQuiNoteLesRejeux([2, 3]);
  const rendus = [];
  const d = creerDuplicateur({
    superviseur: sup,
    estApprise: () => true,
    onCompteRendu: (r) => rendus.push(r),
  });
  d(sortante('ioy', { 1: 25088 }));
  assert.strictEqual(rendus.length, 1);
  assert.deepStrictEqual(rendus[0].rendu.map((r) => r.pid), [2, 3]);
  for (const r of rendus[0].rendu) {
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.emis, false);
    assert.match(r.raison, /combat/);
  }
});

// Sans estApprise, le duplicateur se comporte comme avant.
test('sans liste apprise, tout se rejoue comme avant', () => {
  const sup = superviseurQuiNoteLesRejeux();
  const d = creerDuplicateur({ superviseur: sup });
  d(sortante('ioy', { 1: 25088 }));
  assert.strictEqual(sup.appels.length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/duplicateur.test.js`
Expected: FAIL — `retardPlancher` vaut `undefined`.

- [ ] **Step 3: Implement**

Dans `src/duplicateur.js`, ajouter l'import :

```js
const { estSensible, cleDe, DELAI_PLANCHER_MS } = require('./garde-combat');
```

Puis remplacer la fabrique :

```js
// superviseur — l'objet qui porte rejouer() et le drapeau arme.
// onCompteRendu — recoit ce qui a ete rejoue, ou refuse et pourquoi.
// estApprise — dit si une action a deja ete vue lancer un combat chez le
//   maitre. Faux par defaut: sans elle, la politique est celle d'avant.
function creerDuplicateur({ superviseur, onCompteRendu = () => {}, estApprise = () => false }) {
  return function onTrame({ pid, dir, frame, brute, estMaitre }) {
    // Seules les requetes SORTANTES du maitre se rejouent: ce que le serveur
    // renvoie est propre a chaque client et n'a rien a faire ailleurs.
    if (dir !== 'out' || frame.kind !== 'request') return;
    const connu = lookup(frame.type);
    if (connu === null) return;
    if (!estMaitre) return;

    // UNE ACTION DEJA VUE LANCER UN COMBAT n'est ni retardee ni tentee. Le
    // refus se rend esclave par esclave: un compte qui ne rejoue pas ressemble
    // sinon a un compte inactif.
    const cle = cleDe(frame.type, frame);
    if (cle !== null && estApprise(cle)) {
      const refuses = [...superviseur.comptes.esclaves(pid)].map((etat) => ({
        pid: etat.pid, ok: false, emis: false,
        raison: 'action connue pour lancer un combat',
      }));
      if (refuses.length === 0) return;
      onCompteRendu({ pidMaitre: pid, type: frame.type, nom: connu.name, arme: superviseur.arme, rendu: refuses });
      return;
    }

    // Le plancher ne s'applique qu'aux trois types qui peuvent ouvrir un
    // combat: retarder une teleportation ne protegerait de rien.
    const retardPlancher = estSensible(frame.type) ? DELAI_PLANCHER_MS : 0;
    const rendu = superviseur.rejouer({ type: frame.type, brute, pidMaitre: pid, retardPlancher });
    // Le maitre seul en jeu: aucun esclave, rien a signaler.
    if (rendu.length === 0) return;

    onCompteRendu({
      pidMaitre: pid,
      type: frame.type,
      nom: connu.name,
      arme: superviseur.arme,
      rendu,
    });
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/duplicateur.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: `fail 0`. Les tests existants du duplicateur passent `estApprise` par défaut et ne doivent pas bouger.

- [ ] **Step 6: Commit**

```bash
git add src/duplicateur.js test/duplicateur.test.js
git commit -m "feat(duplicateur): refuser les actions connues, retarder les autres

Deux regles s'ajoutent a la politique de rejeu. Une action deja vue
lancer un combat chez le maitre n'est ni retardee ni tentee, et le refus
se rend esclave par esclave — un compte qui ne rejoue pas ressemble
sinon a un compte inactif.

Les trois types qui peuvent ouvrir un combat partent avec un plancher de
250 ms, pour que rien ne soit encore ecrit quand le serveur annonce le
combat au maitre, 30 ms apres son action. Les cinq autres types gardent
leur etalement seul."
```

---

### Task 4: La liste apprise dans les reglages

**Files:**
- Modify: `src/comptes/favoris.js`
- Test: `test/comptes-favoris.test.js`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `favoris.combats()` → `string[]`
  - `favoris.apprendreCombat(cle)` — ajoute et enregistre ; ignore une valeur qui n'est pas une chaîne non vide
  - `favoris.oublierCombats()` — vide et enregistre
  - le fichier de réglages porte une clé `combats`, un tableau de chaînes

- [ ] **Step 1: Write the failing tests**

Ajouter à `test/comptes-favoris.test.js` :

```js
// --- les actions connues pour lancer un combat -----------------------------

test('sans fichier, aucune action n est connue', (t) => {
  const f = new Favoris(fichierTemporaire(t)).charger();
  assert.deepStrictEqual(f.combats(), []);
});

test('une action apprise survit au rechargement', (t) => {
  const chemin = fichierTemporaire(t);
  new Favoris(chemin).charger().apprendreCombat('ioy:25088');
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), ['ioy:25088']);
});

test('la meme action deux fois ne compte qu une', (t) => {
  const f = new Favoris(fichierTemporaire(t)).charger();
  f.apprendreCombat('ioy:25088');
  f.apprendreCombat('ioy:25088');
  assert.deepStrictEqual(f.combats(), ['ioy:25088']);
});

test('une cle vide ou d un mauvais type est ignoree', (t) => {
  const f = new Favoris(fichierTemporaire(t)).charger();
  f.apprendreCombat('');
  f.apprendreCombat(null);
  f.apprendreCombat(42);
  assert.deepStrictEqual(f.combats(), []);
});

// LE SEUL RECOURS quand OMNI a retenu a tort: la liste est faite de numeros,
// personne ne peut deviner laquelle est fautive.
test('oublier vide la liste et l enregistre', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  f.apprendreCombat('ioy:25088');
  f.oublierCombats();
  assert.deepStrictEqual(f.combats(), []);
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), []);
});

test('une liste d un mauvais type dans le fichier est ignoree', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ combats: 'ioy:1', delai: 3 }), 'utf8');
  const f = new Favoris(chemin).charger();
  assert.deepStrictEqual(f.combats(), []);
  assert.strictEqual(f.delai(), 3);
});

test('les entrees qui ne sont pas des chaines sont ecartees', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ combats: ['ioy:1', 42, null, 'iwo:2'] }), 'utf8');
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), ['ioy:1', 'iwo:2']);
});
```

Et mettre à jour les **deux** listes de clés attendues du fichier, qui doivent maintenant porter `combats` :

```js
  assert.deepStrictEqual(Object.keys(contenu).sort(), ['actif', 'combats', 'delai', 'echange', 'favoris', 'invitation', 'maitre', 'noAnim', 'ordre', 'passeTour', 'touches']);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/comptes-favoris.test.js`
Expected: FAIL — `f.combats is not a function`, et les deux listes de clés.

- [ ] **Step 3: Implement**

Dans `src/comptes/favoris.js`, au constructeur, à côté des autres champs :

```js
    // Les actions vues lancer un combat chez le maitre. Rejouer l'une d'elles
    // ferait ouvrir a chaque esclave SON PROPRE combat — mesure le 28/08.
    this._combats = new Set();
```

Dans `charger()`, à côté des autres lectures de clé :

```js
      if (Array.isArray(json.combats)) {
        for (const c of json.combats) {
          if (typeof c === 'string' && c.length) this._combats.add(c);
        }
      }
```

Dans le chemin d'erreur de lecture, à côté des autres remises à zéro :

```js
      this._combats = new Set();
```

Les trois méthodes, à côté de celles des touches :

```js
  combats() {
    return [...this._combats];
  }

  apprendreCombat(cle) {
    if (typeof cle !== 'string' || cle.length === 0) return;
    this._combats.add(cle);
    this._ecrire();
  }

  // LE SEUL RECOURS quand OMNI a retenu a tort. La liste est faite de numeros:
  // personne ne peut deviner quelle entree est fautive, donc on vide tout.
  oublierCombats() {
    this._combats.clear();
    this._ecrire();
  }
```

Dans `_ecrire()`, à côté des autres clés :

```js
        combats: this.combats(),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/comptes-favoris.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/comptes/favoris.js test/comptes-favoris.test.js
git commit -m "feat(favoris): retenir les actions connues pour lancer un combat

Une action vue lancer un combat chez le maitre ne doit plus jamais etre
rejouee: chaque esclave ouvrirait le sien. La liste survit aux sessions,
sans quoi la premiere occurrence de chaque session reposerait
entierement sur le delai.

oublierCombats() vide tout d'un coup, et c'est volontaire: les entrees
sont des numeros, personne ne peut deviner laquelle est fautive."
```

---

### Task 5: Brancher le garde dans l application

**Files:**
- Modify: `desktop/main.js`
- Test: aucun test automatisé — `desktop/main.js` ne tourne pas hors d'Electron. La vérification est celle de la tâche 7.

**Interfaces:**
- Consumes: `cleDe`, `estSensible`, `TRAME_FERMER_DIALOGUE`, `TYPE_ENTREE_COMBAT`, `FENETRE_APPRENTISSAGE_MS`, `FENETRE_DIALOGUE_MS` (tâche 1) ; `superviseur.annulerRejeux()` (tâche 2) ; `estApprise` du duplicateur (tâche 3) ; `favoris.combats()` / `apprendreCombat()` (tâche 4).
- Produces: rien pour les tâches suivantes.

- [ ] **Step 1: Importer le module**

Dans `desktop/main.js`, près des autres imports :

```js
const {
  cleDe, estSensible, TRAME_FERMER_DIALOGUE, TYPE_ENTREE_COMBAT,
  FENETRE_APPRENTISSAGE_MS, FENETRE_DIALOGUE_MS,
} = require('../src/garde-combat');
```

- [ ] **Step 2: Poser l état du garde**

Au-dessus de la construction du superviseur, avec les autres états de module :

```js
// LE GARDE CONTRE LES COMBATS DUPLIQUES.
//
// Quand une quete propose un combat solo, l'action du maitre est rejouee et
// chaque esclave ouvre LE SIEN — mesure le 28/08, identifiants de combat
// distincts. On retient donc la derniere action du maitre susceptible d'en
// ouvrir un, pour pouvoir la retenir comme dangereuse si le combat arrive.
//
// `dialogue` est date a part: elle sert a savoir s'il faut fermer le dialogue
// des esclaves, pas a apprendre.
let derniereActionSensible = { cle: null, instant: 0 };
let dernierDialogue = 0;
```

- [ ] **Step 3: Écrire la politique du garde**

Juste après `jouerSouris` :

```js
// Ce que le garde fait de chaque trame. Sortante du maitre: on date l'action
// au cas ou. Entrante du maitre et de type ieb: le maitre entre en combat.
//
// N'AGIT QUE SI LA DUPLICATION EST ARMEE: sans elle aucun esclave n'a rejoue
// quoi que ce soit, il n'y a donc rien a annuler ni a reparer.
function gardeCombat({ pid, dir, frame, estMaitre }) {
  if (frame === null || !estMaitre || !superviseur.arme) return;
  // Les reglages sont poses avant la fenetre, donc avant tout client; la garde
  // est la pour ne pas dependre de cet ordre.
  if (favoris === null) return;

  if (dir === 'out') {
    if (!estSensible(frame.type)) return;
    const cle = cleDe(frame.type, frame);
    if (cle !== null) derniereActionSensible = { cle, instant: Date.now() };
    if (frame.type === 'iov' || frame.type === 'ioy') dernierDialogue = Date.now();
    return;
  }

  if (frame.type !== TYPE_ENTREE_COMBAT) return;

  // 1. Ce qui n'est pas encore ecrit ne partira pas.
  const annules = superviseur.annulerRejeux();
  if (annules > 0) journal(pid, `garde combat : ${annules} rejeu(x) annule(s)`);

  // 2. Retenir, mais seulement si l'action est fraiche: un monstre agressif
  //    qui saute sur le maitre trois secondes apres un dialogue anodin n'a pas
  //    a empoisonner la liste.
  const depuis = Date.now() - derniereActionSensible.instant;
  if (derniereActionSensible.cle !== null && depuis < FENETRE_APPRENTISSAGE_MS) {
    if (!favoris.combats().includes(derniereActionSensible.cle)) {
      favoris.apprendreCombat(derniereActionSensible.cle);
      journal(pid, `garde combat : ${derniereActionSensible.cle} retenue (+${depuis} ms)`);
    }
    derniereActionSensible = { cle: null, instant: 0 };
  }

  // 3. Fermer le dialogue des esclaves. Les reponses precedentes de
  //    l'enchainement sont parties il y a plusieurs secondes et ne sont pas
  //    annulables; le maitre, lui, ne fermera jamais leur dialogue puisqu'il
  //    est en combat.
  if (Date.now() - dernierDialogue >= FENETRE_DIALOGUE_MS) return;
  for (const etat of superviseur.comptes.esclaves(pid)) {
    const r = superviseur.emettre(etat.pid, TRAME_FERMER_DIALOGUE);
    if (!r.ok) journal(etat.pid, `garde combat : fermeture du dialogue refusee : ${r.raison}`);
  }
}
```

- [ ] **Step 4: Brancher le garde et la liste apprise**

Dans la composition des politiques, ajouter `gardeCombat` **après** `creerDuplicateur`.

L'ordre n'a pas d'effet sur le comportement — le garde ne fait que dater la trame sortante, et il n'apprend que sur une trame entrante. Le placer après le duplicateur met simplement les deux politiques du rejeu côte à côte, dans l'ordre où elles se lisent.

```js
    gardeCombat,
```

Et passer la liste au duplicateur, dans son appel existant :

```js
    creerDuplicateur({
      superviseur,
      estApprise: (cle) => favoris !== null && favoris.combats().includes(cle),
      onCompteRendu: ({ nom, rendu }) => {
```

Le corps de `onCompteRendu` ne change pas.

- [ ] **Step 5: Vérifier**

Run: `node --check desktop/main.js && npm test`
Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add desktop/main.js
git commit -m "feat: brancher le garde contre les combats dupliques

Sur un ieb entrant chez le maitre — le message mesure le 28/08 comme
marquant l'entree en combat — le garde annule les rejeux en attente,
retient l'action si elle date de moins de deux secondes, et ferme le
dialogue des esclaves.

Il n'agit que si la duplication est armee: sans elle aucun esclave n'a
rejoue quoi que ce soit, il n'y a rien a annuler ni a reparer."
```

---

### Task 6: Le bouton d oubli

**Files:**
- Modify: `desktop/index.html`
- Modify: `desktop/preload.js`
- Modify: `desktop/main.js`
- Test: `test/pont-ipc.test.js` couvre l'accord des trois fichiers, sans modification.

**Interfaces:**
- Consumes: `favoris.oublierCombats()` (tâche 4).
- Produces: le canal IPC `oublierCombats`.

**Les trois fichiers vont ensemble.** `test/pont-ipc.test.js` vérifie sur le source qu'un canal existe dans les trois ou dans aucun, dans les deux sens. Les séparer rendrait la suite rouge entre deux commits.

- [ ] **Step 1: Ajouter le gestionnaire**

Dans `desktop/main.js`, près de `ipcMain.handle('reglerTouche', ...)` :

```js
// LE SEUL RECOURS quand OMNI a retenu a tort qu'une action lance un combat.
// La liste est faite de numeros: personne ne peut deviner quelle entree est
// fautive, donc on vide tout. Le delai continue de proteger apres l'oubli.
ipcMain.handle('oublierCombats', async () => {
  favoris.oublierCombats();
  await envoyerEtat();
});
```

- [ ] **Step 2: Ouvrir le canal dans le preload**

Dans `desktop/preload.js`, après `reglerTouche` :

```js
  // Vide la liste des actions connues pour lancer un combat.
  oublierCombats: () => ipcRenderer.invoke('oublierCombats'),
```

- [ ] **Step 3: Envoyer le compte dans l état**

Dans `envoyerEtat` de `desktop/main.js`, à côté des autres champs :

```js
    combats: favoris.combats().length,
```

- [ ] **Step 4: Ajouter le bouton**

Dans `desktop/index.html`, dans `<div class="barre-nav">`, **avant** le bouton « Fermer les clients » :

```html
  <button class="coupe" id="boubli" title="oublier les actions connues pour lancer un combat" hidden>Oublier les combats</button>
```

Et le brancher, à côté du gestionnaire de `boff` :

```js
  document.getElementById('boubli').addEventListener('click', () => {
    window.app.oublierCombats();
  });
```

Dans la fonction qui applique l'état reçu, juste à côté de la ligne qui remplit `avisNav` et du champ `delai` — c'est le bloc qui met le pied à jour :

```js
    // Le bouton ne parait que s'il y a quelque chose a oublier: un bouton qui
    // ne peut rien faire est une promesse fausse.
    const oubli = document.getElementById('boubli');
    oubli.hidden = !etat.combats;
    oubli.textContent = etat.combats === 1
      ? 'Oublier 1 combat' : `Oublier ${etat.combats} combats`;
```

- [ ] **Step 5: Vérifier**

Run: `node --check desktop/preload.js && node --check desktop/main.js && npm test`
Expected: `fail 0`, `test/pont-ipc.test.js` compris.

Si `pont-ipc` est rouge, un des trois fichiers a été oublié — son message nomme lequel. **Ne pas modifier le test.**

- [ ] **Step 6: Commit**

```bash
git add desktop/index.html desktop/preload.js desktop/main.js
git commit -m "feat(interface): un bouton pour oublier les combats retenus

C'est le seul recours si OMNI retient a tort qu'une action lance un
combat — un monstre agressif au mauvais moment suffirait. La liste etant
faite de numeros, personne ne peut deviner quelle entree est fautive: on
vide tout.

Le bouton ne parait que s'il y a quelque chose a oublier, et il dit
combien: un bouton qui ne peut rien faire est une promesse fausse."
```

---

### Task 7: Verification en conditions reelles

**Files:** aucun, sauf correctif éventuel.

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: la certitude, ou un défaut nommé.

**Le doute principal, à lever en premier :** `ieb` est un candidat mesuré, pas une preuve. Six entrées en combat sur 58 changements de carte du journal du 28/08, mais une seule session et un seul type de quête. Si `ieb` n'est pas le bon message, rien de ce plan ne protège.

- [ ] **Step 1: Lancer avec la capture**

Fermer OMNI, puis :

```bash
OMNI_CAPTURE=1 cscript //nologo /f/omni_project/outils/lancer-diag.vbs
```

Relancer les clients Dofus **après** OMNI — leur session passe par son proxy.

- [ ] **Step 2: Refaire la quête, duplication armée**

Aller jusqu'au combat solo de quête et accepter, exactement comme lors de la mesure.

Attendu : **les esclaves n'entrent pas en combat**, et leur fenêtre de dialogue se ferme.

Dans `F:\omni_project\journal-dev.log`, chercher les trois lignes du garde :

```
garde combat : N rejeu(x) annule(s)
garde combat : ioy:XXXXX retenue (+NN ms)
```

Le `+NN ms` doit être petit — la mesure du 28/08 donnait 30 ms.

- [ ] **Step 3: Vérifier que l'apprentissage tient**

Refaire la même étape de quête une seconde fois, ou relancer OMNI et la refaire.

Attendu : les esclaves ne rejouent pas l'action du tout, et leur ligne dans le panneau affiche `action connue pour lancer un combat`.

- [ ] **Step 4: Vérifier que le reste n'a pas ralenti**

Une téléportation et un changement de carte : les esclaves doivent suivre comme avant, sans retard perceptible. Seuls les dialogues sont retardés de 250 ms.

- [ ] **Step 5: Vérifier le bouton d'oubli**

Le pied doit afficher « Oublier 1 combat ». Cliquer : le bouton disparaît. Refaire l'étape de quête — le garde doit retenir de nouveau, et les esclaves ne doivent toujours pas entrer en combat, cette fois grâce au délai seul.

**C'est l'essai qui prouve que les deux mécanismes fonctionnent séparément.**

- [ ] **Step 6: Vérifier l'effet du `kla`**

Point non mesuré de la conception : l'effet d'un `kla` envoyé à un client sans dialogue ouvert. Après un combat déclenché **sans dialogue** (par un élément interactif, si tu en as un sous la main), vérifier que les esclaves ne subissent rien d'anormal — pas de fenêtre qui se ferme à tort, pas de déconnexion.

- [ ] **Step 7: Rendre compte**

Il n'y a rien à committer si tout va bien. Dire à l'utilisateur ce qui a été vérifié, geste par geste, et ce qui ne l'a pas été.

---

## Ce que ce plan ne fait pas

- Distinguer une agression d'un combat choisi.
- Une liste consultable ou modifiable entrée par entrée.
- Retarder les cinq autres types rejoués.
- Rattraper un rejeu déjà écrit : c'est impossible, et c'est précisément pourquoi le délai existe.
