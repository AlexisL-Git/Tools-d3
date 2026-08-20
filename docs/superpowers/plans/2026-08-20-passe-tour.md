# Passe-tour automatique — plan d'implémentation

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE — utiliser
> `superpowers:subagent-driven-development` (recommandé) ou
> `superpowers:executing-plans` pour dérouler ce plan tâche par tâche. Les
> étapes utilisent des cases à cocher (`- [ ]`).

**But :** passer automatiquement le tour d'un compte en combat, avec un
interrupteur par compte et un interrupteur général dans l'application.

**Architecture :** un module `src/passeur.js`, jumeau de `src/replicateur.js` :
une fabrique qui reçoit le superviseur et rend une fonction `onTrame`. Le
superviseur gagne une méthode `emettre(pid, octets)` pour écrire une trame sur
un client précis. Les appelants composent les deux fabriques.

**Pile :** Node 24, `node:test`, Electron pour la coquille.

## Contraintes globales

- Les deux messages, mesurés le 20/08 sur un combat à deux personnages :
  - entrant `jxh { 2: characterId }` — début du tour de ce personnage
  - sortant `jti { 1: 1, 2: 12 }` — passer le tour
- **`jxh` est diffusé à tous les clients** mais porte l'identifiant du
  personnage concerné. Chaque compte doit filtrer sur **son propre**
  `characterId`, appris de `kvw`. Ne pas filtrer ferait passer le tour d'un
  autre combattant.
- **Ne pas se fier à `jxz`** : c'est le compteur de tours du combat, diffusé
  identiquement à tout le monde. Une première version de ce plan s'appuyait
  dessus — un combat à deux l'a démentie.
- **La requête est constante** : `{ 1: 1, 2: 12 }`, sans identifiant ni numéro
  de tour.
- **Le passe-tour est indépendant du Replicate.** Il ne doit PAS être gouverné
  par `superviseur.arme`, qui appartient au Replicate. Il a son propre drapeau.
- Toute nouvelle annonce `jxh` **annule** le minuteur en attente du même
  compte, y compris celle qui concerne un autre personnage : elle signifie que
  notre tour est terminé.
- `src/passeur.js` ne dépend ni d'Electron, ni de Frida, ni du système.
- Commentaires en français ; messages de commit en français **sans accents**.
- Les 159 tests existants restent verts.

---

### Tâche 1 : émettre une trame vers un client précis

**Fichiers :**
- Modifier : `src/superviseur.js` (ajouter une méthode à la classe `Superviseur`)
- Modifier : `test/superviseur.test.js`

**Interfaces :**
- Consomme : `writeVarint` de `src/codec/framing`, déjà importé dans le fichier
- Produit : `superviseur.emettre(pid, octets) -> { ok: boolean, raison?: string, octets?: number }`

`rejouer()` sait déjà écrire vers les esclaves, mais toujours vers *tous* et
sous condition de `this.arme`. Le passe-tour vise **un** client et obéit à un
autre interrupteur : il lui faut son propre chemin d'émission.

- [ ] **Étape 1 : écrire les tests qui échouent**

Ajouter à `test/superviseur.test.js`, avant le dernier test du fichier :

```js
// Le passe-tour vise UN client, pas tous les esclaves, et n'obeit pas au
// drapeau `arme` qui appartient au Replicate: il lui faut son propre chemin.
test('emettre ecrit la trame sur le client vise', () => {
  const s = superviseurAvecComptes([1, 2]);
  const ecritsUn = fauxClient(s, 1);
  const ecritsDeux = fauxClient(s, 2);

  const res = s.emettre(2, Buffer.from([0xaa, 0xbb, 0xcc]));

  assert.strictEqual(res.ok, true);
  assert.strictEqual(ecritsUn.length, 0, 'le client non vise ne recoit rien');
  assert.strictEqual(ecritsDeux.length, 1);
  // Le reassembleur retire le prefixe de longueur: emettre doit le remettre.
  assert.deepStrictEqual([...ecritsDeux[0]], [3, 0xaa, 0xbb, 0xcc]);
  assert.strictEqual(res.octets, 4);
});

// `arme` gouverne le Replicate. Si emettre s'y soumettait, eteindre le
// Replicate eteindrait le passe-tour avec lui.
test('emettre ne depend pas du drapeau arme du Replicate', () => {
  const s = superviseurAvecComptes([1]);
  s.arme = false;
  const ecrits = fauxClient(s, 1);
  s.emettre(1, Buffer.from([0x01]));
  assert.strictEqual(ecrits.length, 1);
});

test('emettre refuse proprement un client inconnu ou sans socket', () => {
  const s = superviseurAvecComptes([1, 2]);
  assert.deepStrictEqual(s.emettre(99, Buffer.from([1])), { ok: false, raison: 'client inconnu' });
  assert.deepStrictEqual(s.emettre(1, Buffer.from([1])), { ok: false, raison: 'pas de socket amont' });
});
```

- [ ] **Étape 2 : lancer les tests pour vérifier qu'ils échouent**

Lancer : `node --test --test-timeout=15000 test/superviseur.test.js`
Attendu : ÉCHEC, `s.emettre is not a function`.

- [ ] **Étape 3 : écrire l'implémentation**

Dans `src/superviseur.js`, ajouter cette méthode à la classe `Superviseur`,
juste avant `async retirer(pid)` :

```js
  // Ecrit une trame sur UN client. Contrairement a rejouer(), qui vise tous
  // les esclaves et obeit au drapeau `arme` du Replicate, emettre ne juge
  // rien: l'appelant a deja decide. C'est ce qui permet au passe-tour d'avoir
  // son propre interrupteur sans dependre de celui du Replicate.
  emettre(pid, octets) {
    const client = this.clients.get(pid);
    if (!client) return { ok: false, raison: 'client inconnu' };
    if (!client.amont) return { ok: false, raison: 'pas de socket amont' };
    // Le reassembleur retire le prefixe de longueur: il faut le remettre.
    const paquet = Buffer.concat([writeVarint(octets.length), octets]);
    client.amont.write(paquet);
    return { ok: true, octets: paquet.length };
  }
```

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

Lancer : `node --test --test-timeout=15000 test/superviseur.test.js`
Attendu : tous réussis, dont les trois nouveaux.

- [ ] **Étape 5 : lancer la suite complète**

Lancer : `node --test --test-timeout=15000`
Attendu : 162 tests, 0 échec.

- [ ] **Étape 6 : commiter**

```bash
git add src/superviseur.js test/superviseur.test.js
git commit -m "feat(superviseur): emettre une trame vers un client precis"
```

---

### Tâche 2 : interrupteur de passe-tour par compte

**Fichiers :**
- Modifier : `src/protocol/compte.js` (classe `EtatCompte`)
- Modifier : `test/compte.test.js`

**Interfaces :**
- Consomme : `EtatCompte` existant
- Produit : `etat.passeTour` (booléen, faux par défaut)

Symétrique du champ `exclu` qui gouverne le Replicate.

- [ ] **Étape 1 : écrire les tests qui échouent**

Ajouter à `test/compte.test.js`, avant le dernier test du fichier :

```js
// Le passe-tour et le Replicate sont deux fonctions independantes: eteindre
// l'une ne doit rien faire a l'autre.
test('le passe-tour est eteint par defaut et independant de l exclusion', () => {
  const c = new Comptes();
  const e = c.ajouter({ pid: 1, port: 1 });

  assert.strictEqual(e.passeTour, false);

  e.passeTour = true;
  assert.strictEqual(e.exclu, false, 'activer le passe-tour ne touche pas au Replicate');

  e.exclu = true;
  assert.strictEqual(e.passeTour, true, 'exclure du Replicate ne coupe pas le passe-tour');
});
```

- [ ] **Étape 2 : lancer les tests pour vérifier qu'ils échouent**

Lancer : `node --test --test-timeout=15000 test/compte.test.js`
Attendu : ÉCHEC, `passeTour` vaut `undefined`.

- [ ] **Étape 3 : écrire l'implémentation**

Dans `src/protocol/compte.js`, dans le constructeur de `EtatCompte`, juste
après la ligne `this.exclu = false;` :

```js
    // Passe-tour automatique en combat. Independant de `exclu`: un compte peut
    // suivre le maitre sans passer ses tours, ou l'inverse.
    this.passeTour = false;
```

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

Lancer : `node --test --test-timeout=15000 test/compte.test.js`
Attendu : tous réussis.

- [ ] **Étape 5 : commiter**

```bash
git add src/protocol/compte.js test/compte.test.js
git commit -m "feat(comptes): interrupteur de passe-tour par compte"
```

---

### Tâche 3 : le module passeur

**Fichiers :**
- Créer : `src/passeur.js`
- Créer : `test/passeur.test.js`

**Interfaces :**
- Consomme : `superviseur.emettre(pid, octets)` (tâche 1),
  `etat.passeTour` (tâche 2), `etat.characterId` (existant, appris de `kvw`),
  `encodeRaw` et `WIRE` de `src/codec/rawProto`
- Produit :
  `creerPasseur({ superviseur, reglages, onCompteRendu }) -> onTrame(evenement)`
  et la constante exportée `TRAME_PASSE` (Buffer).

  `reglages` porte `{ actif: boolean, delaiMs: number }` et est **lu à chaque
  trame**, pour que l'interrupteur général et le délai prennent effet sans
  reconstruire le passeur.

Rappel de la contrainte centrale : `jxh` est **diffusé à tous les clients** et
porte l'identifiant du personnage dont le tour commence. Le filtre sur
`characterId` est ce qui empêche de passer le tour d'un autre combattant.

- [ ] **Étape 1 : écrire les tests qui échouent**

Créer `test/passeur.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerPasseur, TRAME_PASSE } = require('../src/passeur');
const { decodeFrameRaw } = require('../src/codec/rawProto');

const MOI = 677057659174n;
const AUTRE = 665809125670n;

// Double du superviseur: on n'a besoin que d'emettre() et des etats de compte.
function fauxSuperviseur(comptes = [[1, MOI]]) {
  const emis = [];
  const etats = new Map(comptes.map(([pid, id]) => [pid, { pid, passeTour: true, characterId: id }]));
  return {
    emis,
    etats,
    comptes: { get: (pid) => etats.get(pid) || null },
    emettre: (pid, octets) => { emis.push({ pid, octets }); return { ok: true, octets: octets.length + 1 }; },
  };
}

// jxh { 2: <characterId> } — debut du tour de ce personnage.
const trameJxh = (id) => ({ kind: 'event', type: 'jxh', payload: [{ no: 2, value: id }] });
const evenement = (frame, pid = 1) => ({ pid, dir: 'in', frame, brute: Buffer.alloc(0), estMaitre: false });

function passeur(sup, reglages = { actif: true, delaiMs: 0 }, rendu = []) {
  return creerPasseur({ superviseur: sup, reglages, onCompteRendu: (r) => rendu.push(r) });
}

// La trame emise doit etre exactement celle de l'autopasse mesuree le 20/08.
test('la trame emise est jti { 1: 1, 2: 12 }', () => {
  const f = decodeFrameRaw(TRAME_PASSE);
  assert.notStrictEqual(f, null);
  assert.strictEqual(f.kind, 'request');
  assert.strictEqual(f.type, 'jti');
  assert.strictEqual(f.uid, -1n);
  const parNo = Object.fromEntries(f.payload.map((x) => [x.no, x.value]));
  assert.strictEqual(parNo[1], 1n);
  assert.strictEqual(parNo[2], 12n);
});

test('un delai de 0 emet immediatement', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(trameJxh(MOI)));
  assert.strictEqual(sup.emis.length, 1);
  assert.strictEqual(sup.emis[0].pid, 1);
  assert.deepStrictEqual(sup.emis[0].octets, TRAME_PASSE);
});

// LE test qui compte: jxh est diffuse a tous, y compris pour les tours des
// autres. Emettre sur celui d'un autre lui ferait perdre son tour.
test('le tour d un AUTRE personnage ne declenche rien', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(trameJxh(AUTRE)));
  assert.strictEqual(sup.emis.length, 0);
});

test('le tour d un monstre ne declenche rien', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(trameJxh(-1n)));
  assert.strictEqual(sup.emis.length, 0);
});

// jxz est le compteur de tours du combat, diffuse identiquement a tous: s'en
// servir ferait passer chaque compte des que n'importe qui commence son tour.
test('jxz ne declenche jamais rien', () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup);
  p(evenement({ kind: 'event', type: 'jxz', payload: [{ no: 2, value: 3n }] }));
  p(evenement({ kind: 'event', type: 'jyj', payload: null }));
  p(evenement({ kind: 'request', type: 'jxh', payload: [{ no: 2, value: MOI }] }));   // sortant
  p({ pid: 1, dir: 'out', frame: trameJxh(MOI), brute: Buffer.alloc(0), estMaitre: false });
  assert.strictEqual(sup.emis.length, 0);
});

test('un compte dont le characterId est inconnu ne declenche pas', () => {
  const sup = fauxSuperviseur([[1, null]]);
  const rendu = [];
  passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(trameJxh(MOI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(rendu.length, 1);
  assert.match(rendu[0].raison, /characterId/);
});

test('un compte dont l interrupteur est eteint ne declenche pas', () => {
  const sup = fauxSuperviseur();
  sup.comptes.get(1).passeTour = false;
  passeur(sup)(evenement(trameJxh(MOI)));
  assert.strictEqual(sup.emis.length, 0);
});

test('l interrupteur general eteint neutralise tous les comptes', () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: false, delaiMs: 0 })(evenement(trameJxh(MOI)));
  assert.strictEqual(sup.emis.length, 0);
});

test('un compte inconnu du superviseur ne declenche pas', () => {
  const sup = fauxSuperviseur();
  passeur(sup)(evenement(trameJxh(MOI), 99));
  assert.strictEqual(sup.emis.length, 0);
});

// Le garde-fou central: une trame en retard passerait le tour d'un AUTRE
// personnage. Toute nouvelle annonce annule celle en attente, y compris celle
// qui concerne quelqu'un d'autre — elle signifie que notre tour est fini.
test('le tour d un autre annule le minuteur en attente', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 60 });
  p(evenement(trameJxh(MOI)));
  p(evenement(trameJxh(AUTRE)));
  await new Promise((r) => setTimeout(r, 160));
  assert.strictEqual(sup.emis.length, 0, 'notre tour etait fini, rien ne doit partir');
});

test('deux annonces pour nous n arment qu un seul envoi', async () => {
  const sup = fauxSuperviseur();
  const p = passeur(sup, { actif: true, delaiMs: 40 });
  p(evenement(trameJxh(MOI)));
  p(evenement(trameJxh(MOI)));
  await new Promise((r) => setTimeout(r, 140));
  assert.strictEqual(sup.emis.length, 1);
});

test('le delai est respecte', async () => {
  const sup = fauxSuperviseur();
  passeur(sup, { actif: true, delaiMs: 60 })(evenement(trameJxh(MOI)));
  assert.strictEqual(sup.emis.length, 0, 'rien avant l echeance');
  await new Promise((r) => setTimeout(r, 160));
  assert.strictEqual(sup.emis.length, 1);
});

test('deux comptes arment deux minuteurs independants', async () => {
  const sup = fauxSuperviseur([[1, MOI], [2, AUTRE]]);
  const p = passeur(sup, { actif: true, delaiMs: 30 });
  p(evenement(trameJxh(MOI), 1));
  p(evenement(trameJxh(AUTRE), 2));
  await new Promise((r) => setTimeout(r, 120));
  assert.deepStrictEqual(sup.emis.map((e) => e.pid).sort(), [1, 2]);
});

test('le compte rendu dit ce qui a ete emis', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(trameJxh(MOI)));
  assert.strictEqual(rendu.length, 1);
  assert.strictEqual(rendu[0].pid, 1);
  assert.strictEqual(rendu[0].ok, true);
});

// Un client ferme pendant l'attente ne doit pas faire remonter d'exception.
test('un echec d emission est signale sans exception', () => {
  const sup = fauxSuperviseur();
  sup.emettre = () => ({ ok: false, raison: 'pas de socket amont' });
  const rendu = [];
  assert.doesNotThrow(() => passeur(sup, { actif: true, delaiMs: 0 }, rendu)(evenement(trameJxh(MOI))));
  assert.strictEqual(rendu[0].ok, false);
  assert.match(rendu[0].raison, /socket amont/);
});
```

- [ ] **Étape 2 : lancer les tests pour vérifier qu'ils échouent**

Lancer : `node --test --test-timeout=15000 test/passeur.test.js`
Attendu : ÉCHEC, « Cannot find module '../src/passeur' ».

- [ ] **Étape 3 : écrire l'implémentation**

Créer `src/passeur.js` :

```js
'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

// Le passe-tour automatique, et lui seul.
//
// Deux messages, mesures le 20/08 sur un combat a deux personnages dont l'un
// etait pilote par l'autopasse de krm35:
//
//   entrant  jxh { 2: characterId }   debut du tour de CE personnage
//   sortant  jti { 1: 1, 2: 12 }      passer le tour
//
// jxh est DIFFUSE a tous les clients du combat, et porte l'identifiant du
// personnage concerne (-1 pour les monstres). Le filtre sur characterId est
// donc obligatoire: sans lui, chaque compte passerait le tour d'un autre.
//
// Ne pas confondre avec jxz, le compteur de tours du combat, identique pour
// tout le monde. Une premiere version de ce module s'appuyait dessus; un
// combat a deux personnages l'a demontree fausse.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur.

const TYPE_DEBUT_TOUR = 'jxh';
const CHAMP_PERSONNAGE = 2;
const URL_PASSE = 'type.ankama.com/jti';

// La requete est CONSTANTE: ni identifiant, ni numero de tour. On la construit
// une fois pour toutes. Le code 12 est celui de l'autopasse mesuree; l'effet
// est verifiable, le compteur de tours s'incremente 100 ms plus tard.
const CHARGE_PASSE = encodeRaw([
  { no: 1, wire: WIRE.VARINT, value: 1n },
  { no: 2, wire: WIRE.VARINT, value: 12n },
]);

const TRAME_PASSE = encodeRaw([
  { no: 2, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'string', value: URL_PASSE },
      { no: 2, wire: WIRE.LEN, kind: 'bytes', value: CHARGE_PASSE },
    ] },
    // uid = -1, comme toutes les requetes observees.
    { no: 2, wire: WIRE.VARINT, value: -1n },
  ] },
]);

function personnageAnnonce(frame) {
  const f = (frame.payload || []).find((x) => x.no === CHAMP_PERSONNAGE);
  return f === undefined ? null : f.value;
}

// superviseur   — porte emettre(pid, octets) et comptes.get(pid)
// reglages      — { actif, delaiMs }, RELU a chaque trame pour que
//                 l'interrupteur general et le delai prennent effet aussitot
// onCompteRendu — recoit ce qui a ete emis, ou refuse et pourquoi
function creerPasseur({ superviseur, reglages, onCompteRendu = () => {} }) {
  // Un minuteur en attente par compte. Toute nouvelle annonce annule celle en
  // cours: c'est le garde-fou. Sans lui, une trame en retard passerait le tour
  // d'un AUTRE personnage — la seule erreur de ce projet qui coute quelque
  // chose en jeu.
  const minuteurs = new Map();

  function annuler(pid) {
    const t = minuteurs.get(pid);
    if (t !== undefined) { clearTimeout(t); minuteurs.delete(pid); }
  }

  function emettre(pid) {
    minuteurs.delete(pid);
    const res = superviseur.emettre(pid, TRAME_PASSE);
    onCompteRendu({ pid, ok: res.ok, raison: res.raison, octets: res.octets });
  }

  return function onTrame({ pid, dir, frame }) {
    if (dir !== 'in' || frame === null) return;
    if (frame.kind !== 'event' || frame.type !== TYPE_DEBUT_TOUR) return;

    // Toute annonce de tour annule l'attente en cours, y compris celle qui
    // concerne un autre personnage: elle signifie que notre tour est termine.
    annuler(pid);

    if (!reglages.actif) return;
    const etat = superviseur.comptes.get(pid);
    if (etat === null || !etat.passeTour) return;

    if (etat.characterId === null || etat.characterId === undefined) {
      onCompteRendu({ pid, ok: false, raison: 'characterId inconnu' });
      return;
    }
    // Le filtre qui evite de passer le tour d'un autre combattant.
    if (personnageAnnonce(frame) !== etat.characterId) return;

    const delai = Math.max(0, Number(reglages.delaiMs) || 0);
    if (delai === 0) { emettre(pid); return; }
    minuteurs.set(pid, setTimeout(() => emettre(pid), delai));
  };
}

module.exports = { creerPasseur, TRAME_PASSE, TYPE_DEBUT_TOUR };
```

- [ ] **Étape 4 : lancer les tests pour vérifier qu'ils passent**

Lancer : `node --test --test-timeout=15000 test/passeur.test.js`
Attendu : 15 tests, 15 réussis.

- [ ] **Étape 5 : lancer la suite complète**

Lancer : `node --test --test-timeout=15000`
Attendu : 178 tests, 0 échec.

- [ ] **Étape 6 : commiter**

```bash
git add src/passeur.js test/passeur.test.js
git commit -m "feat(passeur): passe-tour automatique, jxh du bon personnage declenche jti 12"
```

---

### Tâche 4 : composer les deux fonctions

**Fichiers :**
- Créer : `src/composer.js`
- Créer : `test/composer.test.js`
- Modifier : `src/cli/mm.js`
- Modifier : `desktop/main.js`

**Interfaces :**
- Consomme : `creerReplicateur` de `src/replicateur.js`, `creerPasseur` de
  `src/passeur.js` (tâche 3)
- Produit : `composer(...fonctions) -> onTrame` qui appelle chaque fonction
  avec le même événement.

Le superviseur n'accepte qu'un seul `onTrame`. Plutôt que de lui ajouter un
second point d'entrée — il est validé en jeu, on n'y touche pas — les appelants
composent.

- [ ] **Étape 1 : écrire les tests qui échouent**

Créer `test/composer.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { composer } = require('../src/composer');

test('chaque fonction recoit le meme evenement', () => {
  const vus = [[], []];
  const f = composer((e) => vus[0].push(e), (e) => vus[1].push(e));
  const evenement = { pid: 1, dir: 'in' };
  f(evenement);
  assert.deepStrictEqual(vus[0], [evenement]);
  assert.deepStrictEqual(vus[1], [evenement]);
});

// Le Replicate et le passe-tour sont independants: si l'un jette, l'autre doit
// quand meme voir la trame.
test('une fonction qui jette n empeche pas les suivantes', () => {
  const vues = [];
  const f = composer(() => { throw new Error('boum'); }, (e) => vues.push(e));
  assert.doesNotThrow(() => f({ pid: 1 }));
  assert.strictEqual(vues.length, 1);
});

test('composer sans fonction ne jette pas', () => {
  assert.doesNotThrow(() => composer()({ pid: 1 }));
});
```

- [ ] **Étape 2 : lancer les tests pour vérifier qu'ils échouent**

Lancer : `node --test --test-timeout=15000 test/composer.test.js`
Attendu : ÉCHEC, module introuvable.

- [ ] **Étape 3 : écrire le module**

Créer `src/composer.js` :

```js
'use strict';

// Le superviseur n'accepte qu'un seul rappel onTrame. Plutot que de lui
// ajouter un second point d'entree — il est valide en jeu, on n'y touche pas —
// les appelants composent leurs politiques ici.
//
// Une politique qui echoue ne doit pas priver les autres de la trame: le
// Replicate et le passe-tour sont independants, et une exception dans l'un ne
// regarde pas l'autre.
function composer(...fonctions) {
  return function onTrame(evenement) {
    for (const f of fonctions) {
      try { f(evenement); } catch (e) { /* une politique defaillante n'en bloque pas d'autres */ }
    }
  };
}

module.exports = { composer };
```

- [ ] **Étape 4 : brancher le CLI**

Dans `src/cli/mm.js`, remplacer l'affectation actuelle de `onTrame` par la
composition. Le CLI n'a pas d'interface : son passe-tour est actif pour tous
les comptes dès qu'on le lance avec `--passe-tour`, avec le délai donné par
`--delai <secondes>` (défaut 0).

Ajouter en tête du fichier, à côté des autres `require` :

```js
const { creerPasseur } = require('../passeur');
const { composer } = require('../composer');
```

Ajouter à l'analyse des arguments, à côté de `--armer` :

```js
  const passeTour = process.argv.includes('--passe-tour');
  const iDelai = process.argv.indexOf('--delai');
  const delaiMs = iDelai >= 0 ? Math.round(Number(process.argv[iDelai + 1]) * 1000) : 0;
```

Puis, là où `onTrame` est affecté au superviseur, composer les deux :

```js
  superviseur.onTrame = composer(
    creerReplicateur({ superviseur, onCompteRendu: /* le rappel existant, inchange */ }),
    creerPasseur({
      superviseur,
      reglages: { actif: passeTour, delaiMs },
      onCompteRendu: ({ pid, ok, raison }) => {
        console.log(`  passe-tour ${pid} : ${ok ? 'ENVOYÉ' : raison}`);
      },
    }),
  );
```

Et, au démarrage, activer le passe-tour sur tous les comptes pris en charge —
le CLI n'ayant pas d'interrupteur par ligne, à l'endroit où un client vient
d'être ajouté :

```js
      if (passeTour) {
        const etat = superviseur.comptes.get(p.pid);
        if (etat) etat.passeTour = true;
      }
```

- [ ] **Étape 5 : vérifier que le CLI démarre toujours**

Lancer : `node src/cli/mm.js --passe-tour --delai 0.5`
Attendu : le message d'attente des clients s'affiche, sans erreur. Arrêter par
Ctrl+C.

- [ ] **Étape 6 : brancher l'application**

Dans `desktop/main.js`, ajouter les `require` :

```js
const { creerPasseur } = require('../src/passeur');
const { composer } = require('../src/composer');
```

Déclarer les réglages du passe-tour à côté des autres variables de module :

```js
// Lus a chaque trame par le passeur: modifier ces champs suffit, sans
// reconstruire quoi que ce soit.
const reglagesPasseTour = { actif: false, delaiMs: 0 };
```

Et remplacer l'affectation de `superviseur.onTrame` par :

```js
  superviseur.onTrame = composer(
    creerReplicateur({ superviseur, onCompteRendu: /* le rappel existant, inchange */ }),
    creerPasseur({
      superviseur,
      reglages: reglagesPasseTour,
      onCompteRendu: ({ pid, ok, raison }) => {
        if (!ok) journal(pid, `passe-tour : ${raison}`);
      },
    }),
  );
```

- [ ] **Étape 7 : lancer la suite complète**

Lancer : `node --test --test-timeout=15000`
Attendu : 177 tests, 0 échec.

- [ ] **Étape 8 : commiter**

```bash
git add src/composer.js test/composer.test.js src/cli/mm.js desktop/main.js
git commit -m "feat: composer replicateur et passeur, le superviseur reste intact"
```

---

### Tâche 5 : interrupteurs et persistance dans l'application

**Fichiers :**
- Modifier : `src/comptes/favoris.js` → renommer en réglages persistants
- Modifier : `test/comptes-favoris.test.js`
- Modifier : `src/comptes/vue.js`
- Modifier : `test/comptes-vue.test.js`
- Modifier : `desktop/main.js`, `desktop/preload.js`, `desktop/index.html`

**Interfaces :**
- Consomme : `Favoris` (classe existante), `construireVue` (existant),
  `reglagesPasseTour` (tâche 4)
- Produit : `Ligne` gagne `passeTour: boolean` ; le preload expose
  `basculerPasseTour(actif)`, `basculerPasseTourCompte(idCompte, actif)` et
  `reglerDelai(secondes)`.

- [ ] **Étape 1 : écrire les tests de persistance qui échouent**

Ajouter à `test/comptes-favoris.test.js` :

```js
// Les interrupteurs par compte suivent le sort des favoris: enregistres, et
// ne contenant QUE des identifiants numeriques et des booleens.
test('le passe-tour par compte est enregistre et relu', (t) => {
  const p = fichierTemporaire(t);
  const a = new Favoris(p);
  a.charger();
  a.marquerPasseTour(10612457, true);

  const b = new Favoris(p);
  b.charger();
  assert.strictEqual(b.passeTourActif(10612457), true);
  assert.strictEqual(b.passeTourActif(999), false);
});

test('le delai global est enregistre et relu', (t) => {
  const p = fichierTemporaire(t);
  const a = new Favoris(p);
  a.charger();
  a.reglerDelai(1.5);

  const b = new Favoris(p);
  b.charger();
  assert.strictEqual(b.delai(), 1.5);
});

test('le delai par defaut est 0', (t) => {
  const f = new Favoris(fichierTemporaire(t));
  f.charger();
  assert.strictEqual(f.delai(), 0);
});

test('le fichier ne contient que des identifiants, booleens et le delai', (t) => {
  const p = fichierTemporaire(t);
  const f = new Favoris(p);
  f.charger();
  f.marquer(10612457, true);
  f.marquerPasseTour(10612457, true);
  f.reglerDelai(0.5);
  const contenu = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.deepStrictEqual(Object.keys(contenu).sort(), ['delai', 'favoris', 'passeTour']);
  assert.deepStrictEqual(contenu.favoris, [10612457]);
  assert.deepStrictEqual(contenu.passeTour, [10612457]);
  assert.strictEqual(contenu.delai, 0.5);
});
```

- [ ] **Étape 2 : lancer les tests pour vérifier qu'ils échouent**

Lancer : `node --test --test-timeout=15000 test/comptes-favoris.test.js`
Attendu : ÉCHEC, `marquerPasseTour is not a function`.

- [ ] **Étape 3 : étendre la persistance**

Dans `src/comptes/favoris.js`, ajouter au constructeur, après `this._ids = new Set();` :

```js
    // Comptes dont le passe-tour est actif, et delai global en secondes.
    // Comme les favoris: que des identifiants numeriques et un nombre.
    this._passeTour = new Set();
    this._delai = 0;
```

Dans `charger()`, après la lecture des favoris, à l'intérieur du `try` :

```js
      if (Array.isArray(json.passeTour)) {
        this._passeTour = new Set(json.passeTour.filter((n) => Number.isInteger(n)));
      }
      if (typeof json.delai === 'number' && json.delai >= 0) this._delai = json.delai;
```

Et dans le `catch`, à côté de `this._ids = new Set();` :

```js
      this._passeTour = new Set();
      this._delai = 0;
```

Ajouter ces méthodes à la classe :

```js
  passeTourActif(id) {
    return this._passeTour.has(id);
  }

  marquerPasseTour(id, actif) {
    if (actif) this._passeTour.add(id);
    else this._passeTour.delete(id);
    this._ecrire();
  }

  delai() {
    return this._delai;
  }

  reglerDelai(secondes) {
    const v = Number(secondes);
    this._delai = Number.isFinite(v) && v >= 0 ? v : 0;
    this._ecrire();
  }

  tousPasseTour() {
    return [...this._passeTour];
  }
```

Et remplacer le corps de `_ecrire()` par :

```js
  _ecrire() {
    try {
      fs.mkdirSync(path.dirname(this.chemin), { recursive: true });
      const contenu = { delai: this._delai, favoris: this.tous(), passeTour: this.tousPasseTour() };
      fs.writeFileSync(this.chemin, JSON.stringify(contenu), 'utf8');
    } catch (e) {
      // Perdre les reglages est benin; empecher l'application de fonctionner
      // ne l'est pas.
    }
  }
```

- [ ] **Étape 4 : lancer les tests de persistance**

Lancer : `node --test --test-timeout=15000 test/comptes-favoris.test.js`
Attendu : tous réussis.

- [ ] **Étape 5 : écrire le test de vue qui échoue**

Ajouter à `test/comptes-vue.test.js` :

```js
test('la ligne porte l etat du passe-tour', () => {
  const lignes = construireVue({
    comptes: COMPTES,
    clients: [],
    intercepte: new Set(),
    maitre: null,
    exclus: new Set(),
    favoris: new Set(),
    passeTour: new Set([2]),
  });
  assert.strictEqual(lignes.find((l) => l.id === 1).passeTour, false);
  assert.strictEqual(lignes.find((l) => l.id === 2).passeTour, true);
});

test('l absence de passeTour ne casse pas la vue', () => {
  const lignes = construireVue({
    comptes: COMPTES, clients: [], intercepte: new Set(),
    maitre: null, exclus: new Set(), favoris: new Set(),
  });
  assert.strictEqual(lignes[0].passeTour, false);
});
```

- [ ] **Étape 6 : étendre la vue**

Dans `src/comptes/vue.js`, changer la signature :

```js
function construireVue({ comptes, clients, intercepte, maitre, exclus, favoris, passeTour = new Set() }) {
```

Dans `ligneBase`, ajouter le champ — et passer `passeTour` en paramètre de la
fonction :

```js
function ligneBase(compte, favoris, exclus, passeTour) {
```

avec, dans l'objet rendu, à côté de `exclu` :

```js
    passeTour: passeTour.has(compte.id),
```

Mettre à jour son appel : `ligneBase(compte, favoris, exclus, passeTour)`.

Et pour les lignes de clients au compte inconnu, ajouter `passeTour: false`
à côté de `exclu: false`.

- [ ] **Étape 7 : lancer la suite complète**

Lancer : `node --test --test-timeout=15000`
Attendu : 183 tests, 0 échec.

- [ ] **Étape 8 : exposer les trois ordres**

Dans `desktop/preload.js`, ajouter au bloc exposé :

```js
  basculerPasseTour: (actif) => ipcRenderer.invoke('basculerPasseTour', actif),
  basculerPasseTourCompte: (idCompte, actif) => ipcRenderer.invoke('basculerPasseTourCompte', idCompte, actif),
  reglerDelai: (secondes) => ipcRenderer.invoke('reglerDelai', secondes),
```

Dans `desktop/main.js`, ajouter les trois gestionnaires à côté des existants :

```js
ipcMain.handle('basculerPasseTour', async (_e, actif) => {
  reglagesPasseTour.actif = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('basculerPasseTourCompte', async (_e, idCompte, actif) => {
  // La frontiere IPC est la frontiere de confiance: on ne laisse pas une
  // valeur non numerique atteindre le fichier de reglages.
  if (!Number.isInteger(idCompte)) return;
  favoris.marquerPasseTour(idCompte, Boolean(actif));
  const clients = await listerClients();
  const pid = compteVersPid(idCompte, clients);
  const etat = pid === null ? null : superviseur.comptes.get(pid);
  if (etat) etat.passeTour = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('reglerDelai', async (_e, secondes) => {
  const v = Number(secondes);
  if (!Number.isFinite(v) || v < 0) return;
  favoris.reglerDelai(v);
  reglagesPasseTour.delaiMs = Math.round(v * 1000);
  await envoyerEtat();
});
```

Dans `envoyerEtat()`, passer l'ensemble à la vue et ajouter les deux réglages
à l'état envoyé :

```js
      passeTour: new Set(favoris.tousPasseTour()),
```

et, dans l'objet envoyé au renderer, à côté de `replicate: superviseur.arme` :

```js
    passeTourActif: reglagesPasseTour.actif,
    delai: favoris.delai(),
```

Au démarrage, après `favoris = new Favoris(...).charger();`, restaurer le
délai :

```js
  reglagesPasseTour.delaiMs = Math.round(favoris.delai() * 1000);
```

Et dans `balayerProcess`, après l'ajout réussi d'un client, appliquer
l'interrupteur enregistré — un compte relancé doit retrouver son réglage :

```js
      const clients = await listerClients();
      const idCompte = pidVersCompte(p.pid, clients);
      const etat = superviseur.comptes.get(p.pid);
      if (etat && idCompte !== null) {
        etat.passeTour = favoris.passeTourActif(idCompte);
        etat.exclu = false;
      }
```

- [ ] **Étape 9 : dessiner les icônes et les interrupteurs**

Dans `desktop/index.html`, ajouter au `<style>` :

```css
  .icone { width: 15px; height: 15px; flex: none; color: #8b93a3; }
  .sw { display: inline-flex; align-items: center; gap: 5px; }
  .sw input { accent-color: #2e7d4f; }
  #delai { width: 58px; background: #22252c; color: #e6e8ec; border: 1px solid #3a3f4b;
           border-radius: 5px; padding: 4px 6px; font: inherit; }
  #bpt { padding: 7px 14px; border: 0; border-radius: 6px; background: #3a3f4b;
         color: #e6e8ec; cursor: pointer; font: inherit; }
  #bpt.actif { background: #2e7d4f; }
```

Remplacer l'en-tête par :

```html
<header>
  <h1>Replicate</h1>
  <button id="bascule">INACTIF</button>
  <button id="bpt">PASSE-TOUR</button>
  <label style="color:#8b93a3">délai <input id="delai" type="number" min="0" step="0.1" value="0"></label>
  <span id="resume" style="margin-left:auto"></span>
</header>
```

Ajouter les deux icônes en SVG, reprises du launcher de krm35 — astérisque à
six branches pour le Replicate, cercle barré pour le passe-tour. Les insérer
dans le script, avant la construction des lignes :

```js
  // Icones redessinees d'apres le launcher de krm35: elles suivent la couleur
  // du texte, donc le theme, et n'ajoutent aucun fichier ni dependance.
  const ICONE_REPLICATE =
    '<svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
    '<line x1="12" y1="3" x2="12" y2="21"/><line x1="4.2" y1="7.5" x2="19.8" y2="16.5"/>' +
    '<line x1="4.2" y1="16.5" x2="19.8" y2="7.5"/></svg>';
  const ICONE_PASSE =
    '<svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<circle cx="12" cy="12" r="9"/><line x1="5.6" y1="18.4" x2="18.4" y2="5.6"/></svg>';

  function interrupteur(icone, coche, desactive, surChangement) {
    const l = document.createElement('label');
    l.className = 'sw';
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = coche;
    c.disabled = desactive;
    c.addEventListener('change', () => surChangement(c.checked));
    const i = document.createElement('span');
    i.innerHTML = icone;
    l.append(c, i);
    return l;
  }
```

Dans la boucle qui construit chaque ligne, remplacer la case à cocher unique
par les deux interrupteurs :

```js
      const utilisable = l.id !== null && l.etat === 'intercepte';
      const swRep = interrupteur(ICONE_REPLICATE, !l.exclu, !utilisable,
        (v) => window.app.exclureCompte(l.id, !v));
      const swPasse = interrupteur(ICONE_PASSE, l.passeTour, !utilisable,
        (v) => window.app.basculerPasseTourCompte(l.id, v));
```

et remplacer `li.append(etoile, suit, nom, perso, badge);` par :

```js
      li.append(etoile, swRep, swPasse, nom, perso, badge);
```

Ajouter enfin les gestionnaires de l'en-tête, à côté de celui de `#bascule` :

```js
  let passeTourActif = false;
  document.getElementById('bpt').addEventListener('click', () => {
    passeTourActif = !passeTourActif;
    window.app.basculerPasseTour(passeTourActif);
  });
  document.getElementById('delai').addEventListener('change', (e) => {
    window.app.reglerDelai(e.target.value);
  });
```

et, dans le rappel `surEtat`, après la mise à jour de `#bascule` :

```js
    passeTourActif = etat.passeTourActif;
    const bpt = document.getElementById('bpt');
    bpt.classList.toggle('actif', passeTourActif);
    const champDelai = document.getElementById('delai');
    if (document.activeElement !== champDelai) champDelai.value = etat.delai;
```

- [ ] **Étape 10 : vérifier l'application**

Lancer : `npm run app`

Attendu : la fenêtre s'ouvre, chaque ligne porte deux interrupteurs avec leurs
icônes, l'en-tête porte les deux boutons et le champ de délai. Régler le délai
à 0,5, fermer l'application, la relancer : le délai est conservé.

- [ ] **Étape 11 : lancer la suite complète et commiter**

Lancer : `node --test --test-timeout=15000`
Attendu : 183 tests, 0 échec.

```bash
git add src/comptes desktop test
git commit -m "feat(desktop): interrupteurs de passe-tour par compte, delai reglable"
```

---

## Ce que ce plan ne fait pas

Les six autres icônes du launcher de krm35 ne sont pas reprises : elles ne
correspondent à aucune fonction demandée.

**La réserve d'origine a été levée**, et dans le mauvais sens : un combat à deux
personnages a montré que `jxz` est bien diffusé pour tous les tours. Le plan
s'appuyait dessus ; il a été corrigé pour utiliser `jxh` et son filtre sur le
`characterId`.

Deux points restent ouverts, à surveiller au premier essai réel :

- **Deux codes semblent terminer un tour.** `12` est celui de l'autopasse de
  krm35, mesuré et retenu ; `31` apparaissait en combat solo. Si `12` était
  refusé dans un contexte particulier, `31` est la première chose à essayer.
- **`jti` est un message générique** dont le champ 2 est un code d'action. Se
  tromper de code ne rate pas silencieusement : cela déclenche une autre action
  en combat.
