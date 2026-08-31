# Abandon groupé — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** quand le maître abandonne un combat, les mules qui sont dans **le même combat que lui** abandonnent aussi — et elles seules, ce qui laisse les combats de quête intacts.

**Architecture :** une politique de plus, composée dans `desktop/main.js` à côté du duplicateur, de la garde combat et des accepteurs. Elle tient une table `pid → identifiant de combat` remplie sur chaque `ieb` entrant, chez tous les clients ; sur la trame d'abandon sortante du maître, elle ré-émet cette même trame aux esclaves dont l'identifiant est celui du maître.

**Tech Stack :** Node.js pur (aucune dépendance nouvelle), `node --test`, `src/codec/rawProto` pour le décodage déjà fait en amont, `superviseur.emettre(pid, octets)` pour l'écriture.

**Spec :** `docs/superpowers/specs/2026-09-01-abandon-groupe-design.md`
**Branche :** `feat/abandon-groupe` (déjà créée, spec commitée en `c7d3684`)

## Global Constraints

- **Le module ne dépend ni d'Electron, ni de Frida, ni du système.** Il se teste avec un double du superviseur, comme `src/invitation.js` et `src/passeur.js`.
- **Le compte rendu passe par la Map `messages` de `desktop/main.js`, pas seulement par `journal()`.** `journal()` ne s'écrit que sous `OMNI_JOURNAL=complet` : une politique qui n'y parle que serait muette chez l'utilisateur. Piège payé le 29/08 sur les songes.
- **Rien n'entre dans `src/protocol/omni.js`.** La trame d'abandon n'est pas un message répliqué au sens de la table.
- **`src/garde-combat.js` n'est pas modifié.**
- **Aucun interrupteur nouveau** : ni colonne dans la fenêtre, ni clé dans `favoris.json`. La politique suit `superviseur.arme`.
- **Le CLI (`src/cli/mm.js`) n'est pas modifié** : comme l'invitation, l'échange et les songes, cette politique est propre à l'application.
- **Pas de bump de version, pas d'entrée devlog, pas de fabrication de paquet.** `package.json` reste à 0.2.7 ; la distribution est une décision de l'utilisateur, prise plus tard. (`outils/faire-etape.js` copie `src/` en entier : un fichier neuf dans `src/` n'a aucune liste blanche à mettre à jour.)
- **Français sans accent dans le code et les messages de commit**, comme tout le dépôt. Les accents sont admis dans les docs `.md` et dans le texte affiché à l'utilisateur.
- **Tests :** `npm test` (soit `node --test`), 742 tests verts avant de commencer.

---

### Tâche 1 : Mesurer les trames en jeu — POINT D'ARRÊT

Rien de ce plan ne tient sans ces mesures. **Cette tâche se fait avec l'utilisateur devant le jeu**, elle ne peut pas être exécutée par un agent seul.

**Files :**
- Modify (temporairement) : `outils/lancer-diag.vbs:30` — ajout d'une ligne, retirée en fin de tâche
- Create : `docs/superpowers/specs/2026-09-01-trames-abandon.md`

**Interfaces :**
- Consumes : rien.
- Produces : trois valeurs que la tâche 2 recopie telles quelles dans `src/abandon-combat.js` — `TYPES_ABANDON` (un ou deux types à trois lettres), `CHAMP_COMBAT` (un numéro de champ de `ieb`), et la confirmation que maître et mule portent le même identifiant.

- [ ] **Étape 1 : Sauvegarder le journal précédent**

Le fichier est **remis à zéro à chaque lancement** d'OMNI.

```bash
cd /f/omni_project
test -f journal-dev.log && cp journal-dev.log "journal-dev.$(date +%H%M).log"
```

- [ ] **Étape 2 : Allumer la capture complète**

`outils/lancer-diag.vbs` allume déjà `OMNI_JOURNAL=complet` et le fichier. La capture de TOUTES les trames est volontairement laissée à la main — c'est plusieurs milliers de lignes par combat. Ajouter la ligne juste après `OMNI_JOURNAL_FICHIER` :

```vbs
sh.Environment("PROCESS")("OMNI_CAPTURE") = "1"
```

- [ ] **Étape 3 : Lancer OMNI en mode capture, maître + une mule**

Double-clic sur `outils/lancer-diag.vbs`. Attacher les deux clients, désigner le maître, **armer le replicate**.

Vérifier que la capture parle avant d'aller plus loin :

```bash
grep -c "cap :" /f/omni_project/journal-dev.log
```
Attendu : un nombre qui grimpe. S'il vaut 0, `OMNI_CAPTURE` n'est pas passé — ne pas continuer.

- [ ] **Étape 4 : Entrer en combat ordinaire, maître ET mule dans le MÊME combat**

Un groupe de monstres quelconque, hors quête. Les deux personnages engagés dans le même combat.

- [ ] **Étape 5 : Relever les deux `ieb` — LA MESURE DÉCISIVE**

```bash
grep "ieb" /f/omni_project/journal-dev.log | tail -20
```

Attendu, deux lignes de la forme `cap :  <-- event ieb { 1=… 2=… }`, une par pid.

**Comparer champ par champ.** Le champ qui porte la **même valeur des deux côtés** est l'identifiant de combat : c'est lui qui devient `CHAMP_COMBAT`. (Candidat connu : le champ 2, vu s'incrémenter d'un combat à l'autre le 28/08.)

**POINT D'ARRÊT.** Si aucun champ n'est commun aux deux `ieb`, le critère du spec s'effondre. **Arrêter le plan ici**, écrire ce qui a été vu dans le doc de l'étape 9, et revenir vers l'utilisateur. Ne pas improviser un autre critère.

- [ ] **Étape 6 : Le maître abandonne, en plein combat**

Bouton « Abandonner le combat » sur le client maître, à la main.

- [ ] **Étape 7 : Relever la trame d'abandon sortante**

```bash
grep -- "-->" /f/omni_project/journal-dev.log | tail -30
```

La trame cherchée est **sortante** (`-->`), émise par le **pid du maître**, à l'instant du clic. Noter son type (trois lettres) et ses champs. Deux vérifications qui comptent :
- ses champs contiennent-ils l'identifiant de combat relevé à l'étape 5 ? (alors la trame se ré-émet telle quelle) ;
- contiennent-ils un identifiant propre au compte — le `characterId` visible dans les lignes `characterId=…` du journal ? (alors il faudra le substituer, et la tâche 2 change de forme : le signaler avant de coder).

- [ ] **Étape 8 : Refaire la mesure en phase de placement**

Réengager un combat ordinaire, et **quitter pendant le placement**, avant le premier tour. Relever la trame sortante comme à l'étape 7. Elle peut être du même type que l'abandon, ou d'un autre : les deux cas sont prévus, `TYPES_ABANDON` est une liste.

- [ ] **Étape 9 : Écrire les mesures**

Créer `docs/superpowers/specs/2026-09-01-trames-abandon.md`, sur le modèle de `docs/superpowers/specs/2026-08-20-trames-invitation-groupe.md` : les lignes de journal **recopiées telles quelles**, avec leur horodatage, puis la conclusion en une phrase par mesure.

Le doc doit répondre à quatre questions, et rien d'autre :
1. Quel type porte l'abandon en plein combat, et quels champs ?
2. Quel type porte la sortie de placement, et quels champs ?
3. Quel numéro de champ de `ieb` porte l'identifiant de combat, et **est-il identique chez le maître et chez la mule** ?
4. A-t-on vu une trame de fin de combat ? (bonus, pas bloquant)

- [ ] **Étape 10 : Éteindre la capture**

```bash
cd /f/omni_project && git checkout -- outils/lancer-diag.vbs && git diff --stat
```
Attendu : aucune ligne. `lancer-diag.vbs` doit être revenu à l'identique.

- [ ] **Étape 11 : Commit**

```bash
cd /f/omni_project
git add docs/superpowers/specs/2026-09-01-trames-abandon.md
git commit -m "docs(abandon): les trames mesurees en jeu, et le champ de ieb qui identifie le combat"
```

---

### Tâche 2 : Le module `src/abandon-combat.js`

**Files :**
- Create : `src/abandon-combat.js`
- Test : `test/abandon-combat.test.js`

**Interfaces :**
- Consumes : les trois valeurs mesurées en tâche 1.
- Produces : `creerAbandonGroupe({ superviseur, onCompteRendu })` → `onTrame({ pid, dir, frame, brute, estMaitre })`. Exporte aussi `TYPES_ABANDON` (tableau de chaînes), `TYPE_ENTREE_COMBAT` (`'ieb'`), `CHAMP_COMBAT` (nombre) et `idCombat(frame)` → chaîne ou `null`. `onCompteRendu` reçoit `{ pid, ok, raison, octets, combat }`.

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `test/abandon-combat.test.js`. Les tests s'appuient sur les **constantes exportées**, jamais sur les valeurs mesurées en dur : ils restent justes quelles que soient les valeurs trouvées en tâche 1.

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  creerAbandonGroupe, idCombat,
  TYPES_ABANDON, TYPE_ENTREE_COMBAT, CHAMP_COMBAT,
} = require('../src/abandon-combat');

// Deux combats, deux identifiants: c'est le fait mesure le 28/08 (-20147 chez
// le maitre, -20148 chez l'esclave) qui rend le critere utilisable.
const COMBAT = 9828n;
const AUTRE_COMBAT = 9829n;

// Le maitre est le pid 1. Les esclaves rendus par comptes.esclaves() sont
// ceux qu'on lui donne: le module ne les choisit pas, il les filtre.
function fauxSuperviseur({ arme = true, esclaves = [2, 3], emettre = null } = {}) {
  const emis = [];
  return {
    arme,
    emis,
    comptes: { esclaves: () => esclaves.map((pid) => ({ pid })) },
    emettre: emettre || ((pid, octets) => { emis.push({ pid, octets }); return { ok: true, octets: octets.length }; }),
  };
}

const entree = (pid, combat) => ({
  pid, dir: 'in', estMaitre: pid === 1, brute: Buffer.alloc(0),
  frame: {
    kind: 'event', type: TYPE_ENTREE_COMBAT,
    payload: [{ no: 1, value: 1642n }, { no: CHAMP_COMBAT, value: combat }],
  },
});

// La trame d'abandon est ré-émise TELLE QUELLE: son contenu exact n'a pas
// d'importance pour le module, seuls comptent son type et ses octets.
const BRUTE = Buffer.from('0102030405', 'hex');
const abandon = (pid = 1, estMaitre = true, type = TYPES_ABANDON[0]) => ({
  pid, dir: 'out', estMaitre, brute: BRUTE,
  frame: { kind: 'request', type, payload: [] },
});

function politique(sup, rendu = []) {
  const f = creerAbandonGroupe({ superviseur: sup, onCompteRendu: (r) => rendu.push(r) });
  f.rendu = rendu;
  return f;
}

test('l identifiant de combat se lit au champ mesure', () => {
  assert.strictEqual(idCombat(entree(1, COMBAT).frame), String(COMBAT));
});

test('un ieb sans le champ du combat ne donne pas d identifiant', () => {
  const sans = { kind: 'event', type: TYPE_ENTREE_COMBAT, payload: [{ no: 1, value: 1642n }] };
  assert.strictEqual(idCombat(sans), null);
});

test('une mule dans le meme combat que le maitre abandonne avec lui', () => {
  const sup = fauxSuperviseur({ esclaves: [2] });
  const p = politique(sup);
  p(entree(1, COMBAT));
  p(entree(2, COMBAT));
  p(abandon());
  assert.strictEqual(sup.emis.length, 1);
  assert.strictEqual(sup.emis[0].pid, 2);
  // La trame partie est CELLE DU MAITRE, octet pour octet.
  assert.strictEqual(sup.emis[0].octets.toString('hex'), BRUTE.toString('hex'));
  assert.deepStrictEqual(p.rendu.map((r) => [r.pid, r.ok]), [[2, true]]);
});

// LE TEST QUI PORTE LA DEMANDE: un combat de quete est solo, la mule n'y est
// pas, donc elle ne recoit rien. Ce n'est pas un cas particulier du code.
test('une mule dans un autre combat ne recoit rien', () => {
  const sup = fauxSuperviseur({ esclaves: [2] });
  const p = politique(sup);
  p(entree(1, COMBAT));
  p(entree(2, AUTRE_COMBAT));
  p(abandon());
  assert.strictEqual(sup.emis.length, 0);
});

test('une mule qui n est dans aucun combat ne recoit rien', () => {
  const sup = fauxSuperviseur({ esclaves: [2] });
  const p = politique(sup);
  p(entree(1, COMBAT));
  p(abandon());
  assert.strictEqual(sup.emis.length, 0);
});

test('un maitre dont on ignore le combat n envoie rien', () => {
  const sup = fauxSuperviseur({ esclaves: [2] });
  const p = politique(sup);
  p(entree(2, COMBAT));
  p(abandon());
  assert.strictEqual(sup.emis.length, 0);
});

test('replicate coupe, rien ne part', () => {
  const sup = fauxSuperviseur({ esclaves: [2], arme: false });
  const p = politique(sup);
  p(entree(1, COMBAT));
  p(entree(2, COMBAT));
  p(abandon());
  assert.strictEqual(sup.emis.length, 0);
});

test('l abandon d une mule ne declenche rien chez les autres', () => {
  const sup = fauxSuperviseur({ esclaves: [2, 3] });
  const p = politique(sup);
  p(entree(1, COMBAT));
  p(entree(2, COMBAT));
  p(entree(3, COMBAT));
  p(abandon(2, false));
  assert.strictEqual(sup.emis.length, 0);
});

test('un second abandon sur le meme combat ne renvoie rien', () => {
  const sup = fauxSuperviseur({ esclaves: [2] });
  const p = politique(sup);
  p(entree(1, COMBAT));
  p(entree(2, COMBAT));
  p(abandon());
  p(abandon());
  assert.strictEqual(sup.emis.length, 1);
});

// Chaque esclave dans son propre essai: une socket morte sur la premiere mule
// ne doit pas priver la seconde de son abandon.
test('une exception sur une mule n empeche pas les autres d abandonner', () => {
  const emis = [];
  const sup = fauxSuperviseur({
    esclaves: [2, 3],
    emettre: (pid, octets) => {
      if (pid === 2) throw new Error('socket morte');
      emis.push({ pid, octets });
      return { ok: true, octets: octets.length };
    },
  });
  const p = politique(sup);
  p(entree(1, COMBAT));
  p(entree(2, COMBAT));
  p(entree(3, COMBAT));
  p(abandon());
  assert.deepStrictEqual(emis.map((e) => e.pid), [3]);
  assert.deepStrictEqual(p.rendu.map((r) => [r.pid, r.ok]), [[2, false], [3, true]]);
});

test('un refus du superviseur se rend comme un refus, pas comme un envoi', () => {
  const sup = fauxSuperviseur({
    esclaves: [2],
    emettre: () => ({ ok: false, raison: 'pas de socket amont' }),
  });
  const p = politique(sup);
  p(entree(1, COMBAT));
  p(entree(2, COMBAT));
  p(abandon());
  assert.deepStrictEqual(p.rendu, [{ pid: 2, ok: false, raison: 'pas de socket amont', octets: undefined, combat: String(COMBAT) }]);
});

test('une trame sortante d un autre type ne declenche rien', () => {
  const sup = fauxSuperviseur({ esclaves: [2] });
  const p = politique(sup);
  p(entree(1, COMBAT));
  p(entree(2, COMBAT));
  p(abandon(1, true, 'ioy'));
  assert.strictEqual(sup.emis.length, 0);
});

test('une trame absente ne fait pas lever', () => {
  const sup = fauxSuperviseur();
  const p = politique(sup);
  p({ pid: 1, dir: 'in', frame: null, brute: Buffer.alloc(0), estMaitre: true });
  p({ pid: 1, dir: 'out', frame: undefined, brute: Buffer.alloc(0), estMaitre: true });
  assert.strictEqual(sup.emis.length, 0);
});

// Les deux phases sont demandees: en plein combat ET pendant le placement. Si
// la mesure les a trouvees identiques, TYPES_ABANDON n'a qu'une entree et ce
// test ne boucle qu'une fois.
test('chaque type d abandon mesure declenche la replication', () => {
  for (const type of TYPES_ABANDON) {
    const sup = fauxSuperviseur({ esclaves: [2] });
    const p = politique(sup);
    p(entree(1, COMBAT));
    p(entree(2, COMBAT));
    p(abandon(1, true, type));
    assert.strictEqual(sup.emis.length, 1, type);
  }
});
```

- [ ] **Étape 2 : Lancer le test pour le voir échouer**

```bash
cd /f/omni_project && npm test -- test/abandon-combat.test.js
```
Attendu : ÉCHEC, `Cannot find module '../src/abandon-combat'`.

- [ ] **Étape 3 : Écrire le module**

Créer `src/abandon-combat.js`. **Remplacer les trois constantes marquées `<- tache 1` par les valeurs mesurées**, et recopier dans le commentaire d'en-tête les lignes de journal réelles, comme le font `src/invitation.js` et `src/songes.js`.

```js
'use strict';

// L'abandon groupe, et lui seul.
//
// CE QUE C'EST. Le maitre abandonne un combat, les mules qui sont dans LE
// MEME combat que lui abandonnent aussi. Sans cela, il faut abandonner a la
// main sur chaque client apres un donjon rate.
//
// LE CRITERE EST UN FAIT, PAS UN JUGEMENT. On ne cherche jamais a savoir si
// un combat est « de quete » ou « normal »: on compare des identifiants de
// combat. Un combat de quete est solo — aucune mule ne partage l'identifiant
// du maitre, donc rien ne part. L'exigence de l'utilisateur (« que ca ne
// morde pas sur les combats de quete ») est satisfaite sans un seul cas
// particulier dans le code. C'est la meme famille de decision que le refus
// d'inscrire `kbm` dans la table des messages repliques: la garantie tient a
// une absence, pas a une machine a etats.
//
// LES TRAMES, mesurees le 2026-09-01, journal dans
// docs/superpowers/specs/2026-09-01-trames-abandon.md:
//
//   <RECOPIER ICI LES LIGNES REELLES DU JOURNAL, comme dans src/invitation.js>
//
// L'ETAT PERIME EST SANS DANGER. Rien ne garantit qu'on voie la fin d'un
// combat: un identifiant peut trainer dans la table. Cela ne peut faire que
// RATER un abandon, jamais en declencher un a tort — le maitre entre dans un
// combat neuf a un identifiant neuf, la mule restee sur l'ancien ne l'egale
// pas. Meme chose pour un pid retire: son entree survit, sans effet.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur, comme src/invitation.js et src/passeur.js.

const TYPE_ENTREE_COMBAT = 'ieb';

// Le champ de `ieb` qui porte l'identifiant du combat — le seul qui vaille la
// MEME valeur chez le maitre et chez une mule du meme combat.
const CHAMP_COMBAT = 2;                    // <- tache 1

// Les types qui disent « je quitte ce combat ». Une liste, parce que la phase
// de placement peut en avoir un a elle.
const TYPES_ABANDON = ['xxx'];             // <- tache 1

const champ = (frame, no) => (frame.payload || []).find((f) => f.no === no) || null;

// L'identifiant du combat porte par un `ieb`, ou null.
//
// Rendu en CHAINE: le decodeur rend des BigInt sur certains champs et des
// nombres sur d'autres, et 9828n !== 9828. Une comparaison entre deux formes
// differentes ne serait jamais vraie, et la politique serait inerte — sans
// rien dire. Meme precaution que cleDe() dans src/garde-combat.js.
function idCombat(frame) {
  if (frame === null || typeof frame !== 'object') return null;
  const f = champ(frame, CHAMP_COMBAT);
  if (f === null || f.value === undefined || f.value === null) return null;
  return String(f.value);
}

// superviseur   — porte `arme`, emettre(pid, octets) et comptes.esclaves(pid)
// onCompteRendu — recoit { pid, ok, raison, octets, combat } par esclave
function creerAbandonGroupe({ superviseur, onCompteRendu = () => {} }) {
  // pid -> identifiant du combat en cours, chez TOUS les clients. Le maitre y
  // figure comme les autres: c'est son entree qui sert de reference.
  const combats = new Map();

  return function onTrame({ pid, dir, frame, brute, estMaitre }) {
    if (frame === null || frame === undefined) return;

    // 1. Apprendre, chez tous les clients. Le duplicateur et la garde combat
    // sortent tous deux sur !estMaitre: aucun des deux ne peut tenir cette
    // table, et c'est la raison d'etre de ce module.
    if (dir === 'in') {
      if (frame.type !== TYPE_ENTREE_COMBAT) return;
      const id = idCombat(frame);
      if (id !== null) combats.set(pid, id);
      return;
    }

    // 2. Repliquer, sur le maitre seul. OMNI NE REPARE QUE CE QU'IL A CAUSE:
    // sans duplication armee, les mules ne sont pas entrees dans ce combat a
    // sa suite, et l'abandon ne les regarde pas.
    if (!estMaitre || !superviseur.arme) return;
    if (!TYPES_ABANDON.includes(frame.type)) return;

    const idMaitre = combats.get(pid);
    // Consomme: un second abandon sur le meme combat ne renvoie rien.
    combats.delete(pid);
    if (idMaitre === undefined) return;

    for (const etat of superviseur.comptes.esclaves(pid)) {
      if (combats.get(etat.pid) !== idMaitre) continue;
      combats.delete(etat.pid);
      // Chaque esclave dans son propre essai, comme les etapes de
      // src/garde-combat.js: une socket morte sur l'un ne doit pas priver
      // les suivants de leur abandon.
      try {
        const r = superviseur.emettre(etat.pid, brute);
        onCompteRendu({ pid: etat.pid, ok: r.ok, raison: r.raison, octets: r.octets, combat: idMaitre });
      } catch (e) {
        onCompteRendu({ pid: etat.pid, ok: false, raison: `abandon en erreur : ${e.message}`, combat: idMaitre });
      }
    }
  };
}

module.exports = {
  creerAbandonGroupe, idCombat,
  TYPE_ENTREE_COMBAT, CHAMP_COMBAT, TYPES_ABANDON,
};
```

- [ ] **Étape 4 : Lancer les tests du module**

```bash
cd /f/omni_project && npm test -- test/abandon-combat.test.js
```
Attendu : tous les tests passent.

- [ ] **Étape 5 : Lancer la suite entière**

```bash
cd /f/omni_project && npm test 2>&1 | tail -20
```
Attendu : `fail 0`, et un total supérieur aux 742 d'avant.

- [ ] **Étape 6 : Commit**

```bash
cd /f/omni_project
git add src/abandon-combat.js test/abandon-combat.test.js
git commit -m "feat(abandon): les mules du meme combat abandonnent avec le maitre"
```

---

### Tâche 3 : Brancher la politique dans l'application

Sans ce branchement, le module est du code mort : il n'est appelé par rien. C'est exactement ce qui est arrivé au duplicateur avant le 25/08 — `desktop/main.js` construisait un superviseur sans `onTrame`.

**Files :**
- Modify : `desktop/main.js:7-14` (les `require`) et `desktop/main.js:854-950` (l'appel à `composer`)

**Interfaces :**
- Consumes : `creerAbandonGroupe({ superviseur, onCompteRendu })` de la tâche 2.
- Produces : rien pour les tâches suivantes.

- [ ] **Étape 1 : Ajouter le require**

Dans le bloc de requires en tête de `desktop/main.js`, juste après la ligne `const { creerGardeCombat } = require('../src/garde-combat');` :

```js
const { creerAbandonGroupe } = require('../src/abandon-combat');
```

- [ ] **Étape 2 : Composer la politique**

Dans l'appel à `composer(...)`, **juste après le bloc `creerGardeCombat({ … })`** et avant `creerPasseur({ … })` :

```js
    creerAbandonGroupe({
      superviseur,
      // Les deux canaux, et pour deux raisons differentes: `journal()` ne
      // s'ecrit que sous OMNI_JOURNAL=complet et sert la mesure, `messages`
      // est ce que l'utilisateur voit sur la ligne du compte. Le succes efface
      // le message precedent, comme le fait le duplicateur au rejeu suivant:
      // une mule qui a bien abandonne n'a rien a signaler.
      onCompteRendu: ({ pid, ok, raison, combat }) => {
        if (ok) journal(pid, `abandon : replique (combat ${combat})`);
        else journal(pid, `abandon : ${raison}`);
        if (ok) messages.delete(pid);
        else messages.set(pid, `abandon : ${raison}`);
      },
    }),
```

- [ ] **Étape 3 : Vérifier que le fichier se charge et que la suite reste verte**

```bash
cd /f/omni_project && node --check desktop/main.js && npm test 2>&1 | tail -20
```
Attendu : `node --check` muet, `fail 0`.

- [ ] **Étape 4 : Vérifier que la politique est bien dans la chaîne**

Une politique branchée par erreur en dehors de `composer` passerait `node --check` sans jamais tourner.

```bash
cd /f/omni_project && grep -n "creerAbandonGroupe" desktop/main.js
```
Attendu : deux lignes — le `require`, et un appel **à l'intérieur** de l'appel à `composer` (entre les lignes de `creerGardeCombat` et de `creerPasseur`).

- [ ] **Étape 5 : Commit**

```bash
cd /f/omni_project
git add desktop/main.js
git commit -m "feat(abandon): brancher l abandon groupe dans l application"
```

---

### Tâche 4 : Vérifier en jeu — obligatoire

Deux fois le 26/08, et encore le 28/08, le défaut n'est apparu **qu'en lançant l'application**. Ni les tests ni la relecture ne l'auraient montré. **Cette tâche se fait avec l'utilisateur devant le jeu.**

**Files :**
- Modify : `docs/superpowers/specs/2026-09-01-trames-abandon.md` (section « vérification en jeu »)

**Interfaces :**
- Consumes : l'application branchée de la tâche 3.
- Produces : la preuve, ou le défaut à corriger.

- [ ] **Étape 1 : Relancer OMNI en mode journal**

Double-clic sur `outils/lancer-diag.vbs`. **Le mode dev lit le code du dépôt AU LANCEMENT** : sans redémarrage après la tâche 3, on mesure l'ancien code. Attacher maître + au moins une mule, désigner le maître, **armer le replicate**.

- [ ] **Étape 2 : L'essai qui doit marcher — un combat ordinaire**

Engager un groupe de monstres ou un donjon avec la mule. Le maître abandonne.

Attendu à l'écran : la mule sort du combat elle aussi, sans intervention.

```bash
grep "abandon :" /f/omni_project/journal-dev.log
```
Attendu : une ligne `abandon : replique (combat …)` par mule.

- [ ] **Étape 3 : L'essai qui doit NE RIEN faire — un combat de quête**

Prendre une quête qui propose un combat solo, celle qui a servi le 28/08 si elle est encore disponible. Le maître entre en combat, la garde combat empêche les mules de lancer le leur. Le maître abandonne.

Attendu : **les mules ne bougent pas**, et aucune ligne `abandon : replique` dans le journal. C'est l'essai qui porte la demande de l'utilisateur.

- [ ] **Étape 4 : L'essai de la phase de placement**

Réengager un combat ordinaire et quitter **pendant le placement**. Même attendu qu'à l'étape 2. Si `TYPES_ABANDON` n'a qu'une entrée parce que la mesure a trouvé le même type dans les deux phases, cet essai le confirme ou l'infirme.

- [ ] **Étape 5 : Écrire ce qui a été mesuré**

Ajouter au doc de trames une section « Vérification en jeu du 2026-09-01 » avec, **recopiées du journal** : l'abandon du maître, la ligne `abandon : replique` de chaque mule, et l'écart en millisecondes. Puis l'essai de quête, avec **l'absence** de ligne comme résultat.

- [ ] **Étape 6 : Commit**

```bash
cd /f/omni_project
git add docs/superpowers/specs/2026-09-01-trames-abandon.md
git commit -m "docs(abandon): la preuve en jeu, la mule sort avec le maitre et la quete reste intacte"
```

---

### Tâche 5 : Fermer la branche

**Files :** aucun fichier de code.

- [ ] **Étape 1 : Suite complète et arbre propre**

```bash
cd /f/omni_project && npm test 2>&1 | tail -5 && git status --short
```
Attendu : `fail 0`, aucune ligne de statut.

- [ ] **Étape 2 : Fusionner**

REQUIRED SUB-SKILL : `superpowers:finishing-a-development-branch`. Fusion de `feat/abandon-groupe` dans `master`, poussée, suppression de la branche.

- [ ] **Étape 3 : Ne pas distribuer**

`package.json` reste à **0.2.7**, aucune entrée de devlog, aucun paquet fabriqué. Le travail ne touche que `src/`, `test/`, `desktop/` et `docs/` : une mise à jour de code suffira le jour où l'utilisateur décidera de publier. **C'est sa décision, pas une étape de ce plan.**

- [ ] **Étape 4 : Mettre à jour la mémoire de session**

Ajouter une entrée datée en tête de `C:\Users\Utilisateur\.claude\projects\C--WINDOWS-system32\memory\session-handoff.md` : ce qui a été mesuré, ce qui a été vérifié en jeu, et ce qui reste non distribué.

---

## Ce que ce plan ne fait pas

- **Pas de nouvelle entrée dans `src/protocol/omni.js`.** La trame d'abandon n'est pas répliquée par la table : elle l'est par une politique, sous condition d'état.
- **Pas de modification de `src/garde-combat.js`.** Les deux politiques sont voisines et indépendantes.
- **Pas de modification du CLI.** Comme l'invitation, l'échange et les songes, l'abandon groupé est propre à l'application.
- **Pas d'interrupteur.** Ni colonne, ni réglage dans `favoris.json`.
- **Pas de détection de la fin d'un combat.** L'état périmé est inoffensif par construction ; si la mesure de la tâche 1 a livré la trame de fin gratuitement, elle est notée dans le doc mais **n'est pas implémentée ici**.
