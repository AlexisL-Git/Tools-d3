# Acceptation automatique des invitations de groupe — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qu'un compte piloté par l'application accepte seul l'invitation de groupe envoyée par un autre compte piloté par l'application.

**Architecture:** Une politique de plus, `src/invitation.js`, jumelle de `src/passeur.js` : elle observe les trames entrantes, reconnaît une invitation, vérifie que l'invitant est l'un de nos clients, et émet l'acceptation par `superviseur.emettre`. Elle est branchée dans `superviseur.onTrame` via `composer()`, à côté du OMNI et du passe-tour. `src/passeur.js` n'est pas touché : il vient d'être validé en combat réel.

**Tech Stack:** Node ≥ 18 sans dépendance de test (`node --test`), Electron 43 pour l'application, protobuf sans schéma via `src/codec/rawProto.js`.

## Global Constraints

- **Périmètre : les invitations de groupe, et elles seules.** Guilde, alliance, échange, défi sont hors sujet.
- **`npm test` est le seul point d'entrée correct.** `node --test test/` échoue pour une autre raison et fait croire à une régression.
- **Aucun chemin ne mène au silence.** Chaque refus produit un compte rendu portant sa raison. C'est le mode d'échec le plus coûteux du projet : il s'est présenté quatre fois, toujours sous forme de silence indiscernable d'une absence d'activité.
- **La frontière IPC est la frontière de confiance.** Tout `idCompte` venant du renderer est validé par `Number.isInteger` avant d'atteindre le fichier de réglages ou l'état du superviseur.
- **`favoris.json` ne contient que des identifiants numériques.** Ni login, ni jeton.
- **L'application doit tourner AVANT que les clients Dofus se connectent.** Un client déjà lancé est irrattrapable.
- **Style du dépôt :** commentaires et identifiants en français **sans accents** dans le code source ; les accents sont admis dans les chaînes affichées et la documentation.
- **Vérifier `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` avant de conclure quoi que ce soit** : un CLI zombie a déjà intercepté les clients à la place de l'application pendant toute une session.

---

### Task 1 : Mesurer les deux trames

**Cette tâche ne produit pas de code livré : elle produit des faits.** Les tâches 3 à 6 en dépendent entièrement. Ne pas commencer la tâche 3 avant que les valeurs mesurées soient consignées.

Les types de messages sont obfusqués sur trois lettres et aucune liste à jour n'existe : les 1414 `.proto` de `.cache\game\` sont périmés face au client 3.6.10.10.

**Files:**
- Modify: `desktop/main.js` (instrumentation temporaire, retirée en tâche 6)
- Create: `docs/superpowers/specs/2026-08-20-trames-invitation-groupe.md`

**Interfaces:**
- Consumes: rien.
- Produces: quatre faits nommés, repris littéralement par les tâches suivantes — `TYPE_INVITATION` (trois lettres, entrant), `TYPE_ACCEPTATION` (trois lettres, sortant), les octets hexadécimaux exacts de l'acceptation, et le numéro du champ qui identifie l'invitant dans l'invitation (ou le constat qu'il n'y en a pas).

- [ ] **Step 1 : Ajouter le journal « premier du genre »**

Dans `desktop/main.js`, juste après la fonction `premiereTrame()` :

```js
// MESURE TEMPORAIRE — tache 1 du plan invitation, a retirer en tache 6.
// Journalise le PREMIER exemplaire de chaque type de trame, par client et par
// sens. Une invitation est un evenement rare: elle ressort du bruit sans qu'il
// faille tout journaliser. L'instrumentation precedente journalisait chaque
// jalon de tour et noyait le signal sous trente lignes par manche.
function typesInedits() {
  const vus = new Map();   // pid -> Set de "sens type"
  return function onTrame({ pid, dir, frame }) {
    if (frame === null) return;
    let lot = vus.get(pid);
    if (lot === undefined) { lot = new Set(); vus.set(pid, lot); }
    const cle = `${dir} ${frame.type}`;
    if (lot.has(cle)) return;
    lot.add(cle);
    const champs = (frame.payload || []).map((f) => `${f.no}=${f.value}`).join(' ');
    journal(pid, `inedit : ${dir} ${frame.kind} ${frame.type} { ${champs} }`);
  };
}
```

- [ ] **Step 2 : Brancher la mesure**

Dans `desktop/main.js`, dans l'appel à `composer(...)`, ajouter `typesInedits(),` juste après `premiereTrame(),`.

- [ ] **Step 3 : Vérifier que l'application démarre**

```bash
node --check desktop/main.js
npm test
```
Attendu : « syntaxe OK » implicite (aucune sortie), et 202 tests verts.

- [ ] **Step 4 : Lancer l'application, puis les clients**

Lancer l'application avec sa sortie redirigée vers un fichier, **puis seulement** démarrer deux clients Dofus. Vérifier dans le journal la ligne « première trame décodée » pour chacun des deux pid : sans elle, le client n'est pas derrière le proxy et la mesure ne vaut rien.

- [ ] **Step 5 : Mesurer, deux fois**

Depuis le client A, inviter le personnage du client B dans le groupe. Accepter **à la main** sur B. Quitter le groupe. Recommencer une seconde fois.

Dans le journal, relever chez le pid de B :
- la ligne `inedit : in …` apparue au moment de l'invitation → `TYPE_INVITATION` et ses champs ;
- la ligne `inedit : out …` apparue au moment du clic sur « accepter » → `TYPE_ACCEPTATION` et ses champs.

Le second essai ne produira **pas** de ligne `inedit` pour ces types : ils ne sont plus inédits. Pour comparer les deux passages, relever les octets bruts du second essai via le journal complet, ou relancer l'application entre les deux essais — c'est la comparaison qui dit ce qui varie.

> Ce qui varie entre les deux essais est un identifiant. Ce qui ne varie pas est constant. C'est la méthode qui a livré `jxy` : deux clics sur « Passer », octets identiques, donc trame sans aucun champ.

- [ ] **Step 6 : Consigner la mesure**

Écrire `docs/superpowers/specs/2026-08-20-trames-invitation-groupe.md` avec, littéralement : la date, les deux types à trois lettres, les champs de l'invitation avec leur numéro et leur valeur pour les deux essais, les octets hexadécimaux de l'acceptation pour les deux essais, et la conclusion — trame constante, ou champ à recopier depuis l'invitation avec les deux numéros de champ concernés.

Répondre explicitement à la question du filtre : **l'invitation identifie-t-elle l'invitant ?** Trois issues possibles, et il faut nommer laquelle :
1. elle porte un `characterId` → le filtre compare aux `characterId` de nos clients ;
2. elle ne porte qu'un nom de personnage → le filtre compare aux noms connus par `src/comptes/clients.js` ;
3. elle ne porte rien d'exploitable → **s'arrêter et le dire à l'utilisateur.** La fonction n'est pas livrable telle qu'elle a été conçue, et la question du filtre est rouverte.

- [ ] **Step 7 : Commit**

```bash
git add docs/superpowers/specs/2026-08-20-trames-invitation-groupe.md desktop/main.js
git commit -m "mesure: les trames d'invitation et d'acceptation de groupe"
```

---

### Task 2 : La liste `invitation` dans les réglages

Indépendante de la mesure : elle peut être faite avant, pendant ou après la tâche 1.

**Files:**
- Modify: `src/comptes/favoris.js`
- Test: `test/comptes-favoris.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: `Favoris.invitationActive(id) → boolean`, `Favoris.marquerInvitation(id, actif) → void`, `Favoris.tousInvitation() → number[]`. Le fichier gagne une clé `invitation`, tableau d'entiers.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `test/comptes-favoris.test.js` :

```js
test('l invitation se marque, se lit et se relit du fichier', () => {
  const chemin = fichierTemporaire();
  const f = new Favoris(chemin).charger();
  assert.strictEqual(f.invitationActive(12), false);
  f.marquerInvitation(12, true);
  assert.strictEqual(f.invitationActive(12), true);
  assert.deepStrictEqual(new Favoris(chemin).charger().tousInvitation(), [12]);
});

test('l invitation se demarque', () => {
  const chemin = fichierTemporaire();
  const f = new Favoris(chemin).charger();
  f.marquerInvitation(12, true);
  f.marquerInvitation(12, false);
  assert.deepStrictEqual(new Favoris(chemin).charger().tousInvitation(), []);
});

// Les trois listes sont independantes: un compte peut accepter les invitations
// sans passer ses tours, et l'inverse.
test('invitation, passe-tour et favoris ne se melangent pas', () => {
  const chemin = fichierTemporaire();
  const f = new Favoris(chemin).charger();
  f.marquerInvitation(12, true);
  const relu = new Favoris(chemin).charger();
  assert.strictEqual(relu.passeTourActif(12), false);
  assert.strictEqual(relu.estFavori(12), false);
});

// Un fichier ecrit par une version anterieure n'a pas la cle: la lecture doit
// rendre une liste vide, pas faire echouer le demarrage.
test('un fichier sans cle invitation se lit sans erreur', () => {
  const chemin = fichierTemporaire();
  fs.writeFileSync(chemin, JSON.stringify({ delai: 0, favoris: [3], passeTour: [] }), 'utf8');
  const f = new Favoris(chemin).charger();
  assert.deepStrictEqual(f.tousInvitation(), []);
  assert.strictEqual(f.estFavori(3), true);
});
```

Si `fichierTemporaire()` et l'import de `fs` n'existent pas déjà dans ce fichier de test, reprendre le motif utilisé par les tests de passe-tour du même fichier plutôt que d'en inventer un autre.

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

```bash
npm test
```
Attendu : ÉCHEC, `f.invitationActive is not a function`.

- [ ] **Step 3 : Implémenter**

Dans `src/comptes/favoris.js`, dans le constructeur, après `this._passeTour` :

```js
    // Comptes qui acceptent seuls les invitations de groupe. Meme nature que
    // les deux listes precedentes: que des identifiants numeriques.
    this._invitation = new Set();
```

Dans `charger()`, après le bloc `passeTour` :

```js
      if (Array.isArray(json.invitation)) {
        this._invitation = new Set(json.invitation.filter((n) => Number.isInteger(n)));
      }
```

Dans le `catch` de `charger()`, ajouter `this._invitation = new Set();`.

Après `tousPasseTour()` :

```js
  invitationActive(id) {
    return this._invitation.has(id);
  }

  marquerInvitation(id, actif) {
    if (actif) this._invitation.add(id);
    else this._invitation.delete(id);
    this._ecrire();
  }

  tousInvitation() {
    return [...this._invitation];
  }
```

Dans `_ecrire()`, remplacer la ligne `contenu` par :

```js
      const contenu = {
        delai: this._delai,
        favoris: this.tous(),
        passeTour: this.tousPasseTour(),
        invitation: this.tousInvitation(),
      };
```

- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent**

```bash
npm test
```
Attendu : tous verts, 206 tests.

- [ ] **Step 5 : Commit**

```bash
git add src/comptes/favoris.js test/comptes-favoris.test.js
git commit -m "feat(favoris): enregistrer les comptes qui acceptent les invitations"
```

---

### Task 3 : `src/invitation.js`, l'accepteur

**Dépend de la tâche 1.** Les deux types à trois lettres et les octets de l'acceptation viennent de `docs/superpowers/specs/2026-08-20-trames-invitation-groupe.md`. Partout où ce plan écrit `TYPE_INVITATION`, `TYPE_ACCEPTATION`, `CHAMP_INVITANT` ou `HEX_ACCEPTATION`, substituer la valeur mesurée. Ne rien deviner : si la mesure manque, la tâche est bloquée.

**Files:**
- Create: `src/invitation.js`
- Modify: `src/protocol/compte.js` (un champ d'état)
- Test: `test/invitation.test.js`
- Test: `test/compte.test.js`

**Interfaces:**
- Consumes: `superviseur.comptes.get(pid)`, `superviseur.comptes.tous`, `superviseur.emettre(pid, octets) → { ok, raison?, octets? }`, `encodeRaw` et `WIRE` de `src/codec/rawProto.js`.
- Produces: `creerAccepteur({ superviseur, reglages, onCompteRendu }) → onTrame({ pid, dir, frame })`, et les constantes exportées `TRAME_ACCEPTATION`, `TYPE_INVITATION`. `EtatCompte.accepteInvitation`, booléen, faux par défaut.

- [ ] **Step 1 : Écrire le test d'état qui échoue**

Ajouter à `test/compte.test.js` :

```js
// Jumeau de passeTour, et independant de lui: un compte peut accepter les
// invitations sans passer ses tours.
test('accepteInvitation est faux par defaut et independant de passeTour', () => {
  const e = new EtatCompte({ pid: 1 });
  assert.strictEqual(e.accepteInvitation, false);
  e.accepteInvitation = true;
  assert.strictEqual(e.passeTour, false);
  assert.strictEqual(e.exclu, false);
});
```

- [ ] **Step 2 : Lancer et vérifier l'échec**

```bash
npm test
```
Attendu : ÉCHEC, `undefined !== false`.

- [ ] **Step 3 : Ajouter le champ d'état**

Dans `src/protocol/compte.js`, dans le constructeur de `EtatCompte`, après `this.passeTour = false;` :

```js
    // Acceptation automatique des invitations de groupe. Independant de
    // `exclu` et de `passeTour`.
    this.accepteInvitation = false;
```

- [ ] **Step 4 : Lancer et vérifier que ça passe**

```bash
npm test
```
Attendu : tous verts.

- [ ] **Step 5 : Écrire les tests de l'accepteur qui échouent**

Créer `test/invitation.test.js`. `MOI` est le compte qui reçoit l'invitation, `AMI` un autre de nos clients, `ETRANGER` un joueur quelconque.

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerAccepteur, TRAME_ACCEPTATION } = require('../src/invitation');
const { decodeFrameRaw } = require('../src/codec/rawProto');

const MOI = 665809125670n;
const AMI = 677057659174n;
const ETRANGER = 123456789012n;

function fauxSuperviseur(comptes = [[1, MOI], [2, AMI]]) {
  const emis = [];
  const etats = new Map(comptes.map(([pid, id]) => [pid, {
    pid, accepteInvitation: true, characterId: id,
  }]));
  return {
    emis,
    etats,
    comptes: { get: (pid) => etats.get(pid) || null, get tous() { return [...etats.values()]; } },
    emettre: (pid, octets) => { emis.push({ pid, octets }); return { ok: true, octets: octets.length }; },
  };
}

// CHAMP_INVITANT est le numero de champ mesure en tache 1.
const invitation = (invitant) => ({
  kind: 'event', type: TYPE_INVITATION,
  payload: [{ no: CHAMP_INVITANT, value: invitant }],
});
const evenement = (frame, pid = 1) => ({ pid, dir: 'in', frame, brute: Buffer.alloc(0) });

function accepteur(sup, reglages = { actif: true }, rendu = []) {
  return creerAccepteur({ superviseur: sup, reglages, onCompteRendu: (r) => rendu.push(r) });
}

test('la trame emise est celle mesuree', () => {
  assert.strictEqual(TRAME_ACCEPTATION.toString('hex'), HEX_ACCEPTATION);
  assert.notStrictEqual(decodeFrameRaw(TRAME_ACCEPTATION), null);
});

test('une invitation venue d un de nos comptes est acceptee', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(invitation(AMI)));
  assert.strictEqual(sup.emis.length, 1);
  assert.strictEqual(sup.emis[0].pid, 1);
});

// Le coeur de la fonction: sans ce filtre, n'importe qui en jeu peut faire
// rejoindre son groupe a un compte dont l'interrupteur est actif.
test('une invitation venue d un tiers est refusee, et le dit', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(invitation(ETRANGER)));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(rendu[0].ok, false);
  assert.match(rendu[0].raison, /invitant/);
});

// Notre propre characterId n'est pas un invitant valable: il designe le
// destinataire, pas un autre client.
test('une invitation portant notre propre identifiant est refusee', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(invitation(MOI)));
  assert.strictEqual(sup.emis.length, 0);
});

test('l interrupteur general eteint bloque et le dit', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: false }, rendu)(evenement(invitation(AMI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /interrupteur/);
});

test('un compte inconnu du superviseur bloque et le dit', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(invitation(AMI), 99));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /inconnu/);
});

test('un compte dont l interrupteur est eteint bloque et le dit', () => {
  const sup = fauxSuperviseur();
  sup.etats.get(1).accepteInvitation = false;
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(invitation(AMI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /eteint/);
});

// Une trame sortante porte les memes types: le client emet lui-meme
// l'acceptation quand l'utilisateur clique. La rejouer serait un doublon.
test('une trame sortante ne declenche rien', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)({ pid: 1, dir: 'out', frame: invitation(AMI), brute: Buffer.alloc(0) });
  assert.strictEqual(sup.emis.length, 0);
});

test('un autre type de trame ne declenche rien', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement({ kind: 'event', type: 'jxz', payload: [] }));
  assert.strictEqual(sup.emis.length, 0);
});

// Un client ferme entre l'invitation et l'acceptation.
test('un echec d emission est signale sans exception', () => {
  const sup = fauxSuperviseur();
  sup.emettre = () => ({ ok: false, raison: 'pas de socket amont' });
  const rendu = [];
  assert.doesNotThrow(() => accepteur(sup, { actif: true }, rendu)(evenement(invitation(AMI))));
  assert.strictEqual(rendu[0].ok, false);
  assert.match(rendu[0].raison, /socket amont/);
});

test('deux comptes sont independants', () => {
  const sup = fauxSuperviseur();
  const a = accepteur(sup);
  a(evenement(invitation(AMI), 1));
  a(evenement(invitation(MOI), 2));
  assert.deepStrictEqual(sup.emis.map((e) => e.pid).sort(), [1, 2]);
});
```

Si la mesure a montré que l'acceptation porte un identifiant à recopier depuis l'invitation, ajouter ces deux tests, en substituant les numéros de champ mesurés :

```js
test('l identifiant de l invitation est recopie dans l acceptation', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(invitationAvecId(AMI, 4242n)));
  const f = decodeFrameRaw(sup.emis[0].octets);
  const c = f.payload.find((x) => x.no === CHAMP_ID_ACCEPTATION);
  assert.strictEqual(c.value, 4242n);
});

// Accepter a l'aveugle une invitation dont on n'a pas l'identifiant enverrait
// une trame a moitie traduite; c'est ce que peutRejouer() refuse deja ailleurs.
test('une invitation sans identifiant est refusee, pas acceptee a l aveugle', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(invitation(AMI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /identifiant/);
});
```

- [ ] **Step 6 : Lancer et vérifier l'échec**

```bash
npm test
```
Attendu : ÉCHEC, `Cannot find module '../src/invitation'`.

- [ ] **Step 7 : Implémenter `src/invitation.js`**

```js
'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

// L'acceptation automatique des invitations de groupe, et elle seule.
//
// LES TRAMES. Mesurees le 20/08, protocole en tache 1 du plan: deux clients
// attaches, invitation depuis A, acceptation a la main sur B. Voir
// docs/superpowers/specs/2026-08-20-trames-invitation-groupe.md.
//
// LE FILTRE. Une invitation n'est acceptee que si l'invitant est un AUTRE
// client pilote par l'application. Sans lui, n'importe quel joueur peut faire
// rejoindre son groupe a un compte dont l'interrupteur est actif. Les
// characterId sont appris du trafic de chaque client (kvw, champ 1), donc
// connus sans configuration.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur, comme le passeur.

const TYPE_INVITATION = '???';     // substituer le type mesure
const CHAMP_INVITANT = 0;          // substituer le numero mesure

const TRAME_ACCEPTATION = encodeRaw([/* substituer la structure mesuree */]);

const champ = (frame, no) => (frame.payload || []).find((f) => f.no === no) || null;

// superviseur   — porte emettre(pid, octets), comptes.get(pid) et comptes.tous
// reglages      — { actif }, RELU a chaque trame pour que l'interrupteur
//                 general prenne effet aussitot
// onCompteRendu — recoit ce qui a ete emis, ou refuse et pourquoi
function creerAccepteur({ superviseur, reglages, onCompteRendu = () => {} }) {
  return function onTrame({ pid, dir, frame }) {
    if (dir !== 'in' || frame === null) return;
    if (frame.type !== TYPE_INVITATION) return;

    // Une invitation est un evenement rare: dire pourquoi on ne l'accepte pas
    // ne coute rien et repond a la seule question que l'utilisateur se pose.
    const refus = (raison) => onCompteRendu({ pid, ok: false, raison });

    if (!reglages.actif) return refus('invitation ignoree : interrupteur general eteint');
    const etat = superviseur.comptes.get(pid);
    if (etat === null || etat === undefined) return refus('invitation ignoree : compte inconnu du superviseur');
    if (!etat.accepteInvitation) return refus('invitation ignoree : acceptation eteinte pour ce compte');

    const c = champ(frame, CHAMP_INVITANT);
    if (c === null) return refus('invitation refusee : aucun invitant dans la trame');

    // Un AUTRE de nos clients: notre propre identifiant designe le
    // destinataire, pas un invitant.
    const notres = superviseur.comptes.tous
      .filter((e) => e.pid !== pid && e.characterId !== null && e.characterId !== undefined)
      .map((e) => e.characterId);
    if (!notres.some((id) => id === c.value)) {
      return refus(`invitation refusee : invitant ${c.value} inconnu de l'application`);
    }

    const res = superviseur.emettre(pid, TRAME_ACCEPTATION);
    onCompteRendu({ pid, ok: res.ok, raison: res.raison, octets: res.octets });
  };
}

module.exports = { creerAccepteur, TRAME_ACCEPTATION, TYPE_INVITATION, CHAMP_INVITANT };
```

Si la mesure impose de recopier un identifiant, remplacer la constante `TRAME_ACCEPTATION` par une fonction `construireAcceptation(idInvitation)` qui l'insère au numéro de champ mesuré, et refuser l'invitation qui ne le porte pas plutôt que d'émettre une trame à moitié traduite.

- [ ] **Step 8 : Lancer et vérifier que tout passe**

```bash
npm test
```
Attendu : tous verts. Sortie propre, sans avertissement.

- [ ] **Step 9 : Commit**

```bash
git add src/invitation.js src/protocol/compte.js test/invitation.test.js test/compte.test.js
git commit -m "feat: accepter les invitations de groupe venant de nos comptes"
```

---

### Task 4 : La vue expose l'interrupteur

**Files:**
- Modify: `src/comptes/vue.js`
- Test: `test/comptes-vue.test.js`

**Interfaces:**
- Consumes: rien des tâches précédentes.
- Produces: `construireVue({ …, invitation })` accepte un `Set` d'`idCompte` de plus et pose `ligne.invitation` sur **toutes** les lignes, y compris celles du repli en fin de liste.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `test/comptes-vue.test.js`, en reprenant les fabriques de `comptes` et `clients` déjà utilisées dans ce fichier :

```js
test('l invitation remonte sur la ligne du compte', () => {
  const lignes = construireVue({
    comptes: [{ id: 7, nickname: 'a' }],
    clients: [{ pid: 100, idCompte: 7, personnage: 'Spoony', classe: 'Iop' }],
    intercepte: new Set([100]),
    maitre: null,
    exclus: new Set(),
    favoris: new Set(),
    invitation: new Set([7]),
  });
  assert.strictEqual(lignes[0].invitation, true);
});

// Meme piege que pour passeTour: code en dur a faux, la case s'affichait
// eteinte alors que le compte acceptait, donc impossible a debrayer. Toutes
// les lignes passent par ce repli si lireComptes() echoue.
test('l invitation remonte aussi sur un client sans ligne de compte', () => {
  const lignes = construireVue({
    comptes: [],
    clients: [{ pid: 100, idCompte: 7, personnage: 'Spoony', classe: 'Iop' }],
    intercepte: new Set([100]),
    maitre: null,
    exclus: new Set(),
    favoris: new Set(),
    invitation: new Set([7]),
  });
  assert.strictEqual(lignes[0].invitation, true);
});

test('l invitation vaut faux quand rien n est passe', () => {
  const lignes = construireVue({
    comptes: [{ id: 7, nickname: 'a' }],
    clients: [],
    intercepte: new Set(),
    maitre: null,
    exclus: new Set(),
    favoris: new Set(),
  });
  assert.strictEqual(lignes[0].invitation, false);
});
```

- [ ] **Step 2 : Lancer et vérifier l'échec**

```bash
npm test
```
Attendu : ÉCHEC, `undefined !== true`.

- [ ] **Step 3 : Implémenter**

Dans `src/comptes/vue.js` :

```js
function ligneBase(compte, favoris, exclus, passeTour, invitation) {
```
et dans l'objet rendu, après `passeTour: passeTour.has(compte.id),` :
```js
    invitation: invitation.has(compte.id),
```

Dans la signature de `construireVue`, après `passeTour = new Set(),` :
```js
  invitation = new Set(),
```

Dans l'appel `ligneBase(compte, favoris, exclus, passeTour)`, ajouter `, invitation`.

Dans l'objet du repli en fin de liste, après la ligne `passeTour: …` :
```js
      invitation: c.idCompte !== null && invitation.has(c.idCompte),
```

- [ ] **Step 4 : Lancer et vérifier que ça passe**

```bash
npm test
```
Attendu : tous verts.

- [ ] **Step 5 : Commit**

```bash
git add src/comptes/vue.js test/comptes-vue.test.js
git commit -m "feat(vue): exposer l'interrupteur d'acceptation par compte"
```

---

### Task 5 : Câbler l'application

**Dépend des tâches 2, 3 et 4.**

**Files:**
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`

**Interfaces:**
- Consumes: `creerAccepteur` (tâche 3), `Favoris.invitationActive` / `marquerInvitation` (tâche 2), `construireVue({ invitation })` (tâche 4).
- Produces: deux canaux IPC, `basculerInvitation(actif)` et `basculerInvitationCompte(idCompte, actif)` ; l'état envoyé au renderer gagne `invitationActive` et, par ligne, `invitation`.

- [ ] **Step 1 : Importer et déclarer les réglages**

Dans `desktop/main.js`, à côté de l'import du passeur :
```js
const { creerAccepteur } = require('../src/invitation');
```
et à côté de `reglagesPasseTour` :
```js
// Lu a chaque trame par l'accepteur: modifier ce champ suffit.
const reglagesInvitation = { actif: false };
```

- [ ] **Step 2 : Brancher la politique**

Dans l'appel à `composer(...)`, après le bloc `creerPasseur({...})` :

```js
    creerAccepteur({
      superviseur,
      reglages: reglagesInvitation,
      onCompteRendu: ({ pid, ok, raison }) => {
        if (ok) journal(pid, 'invitation : acceptee');
        else journal(pid, `invitation : ${raison}`);
      },
    }),
```

- [ ] **Step 3 : Restaurer l'interrupteur d'un compte attaché**

Dans `balayerProcess()`, à côté de `etat.passeTour = favoris.passeTourActif(idCompte);` :
```js
        etat.accepteInvitation = favoris.invitationActive(idCompte);
```

- [ ] **Step 4 : Resynchroniser et envoyer l'état**

Dans `envoyerEtat()`, dans la boucle de resynchronisation, après `etat.passeTour = …` :
```js
    etat.accepteInvitation = favoris.invitationActive(idCompte);
```

Après le `const passeTour = new Set(...)` :
```js
  // Comme `passeTour`: la case affichee vient de l'etat vivant, celui que
  // l'accepteur consulte a chaque trame, pas du seul fichier.
  const invitation = new Set(
    superviseur.comptes.tous.filter((e) => e.accepteInvitation).map((e) => pidVersCompte(e.pid, clients)),
  );
```

Dans l'objet envoyé, après `passeTourActif: reglagesPasseTour.actif,` :
```js
    invitationActive: reglagesInvitation.actif,
```
et dans l'appel à `construireVue({...})`, après `passeTour,` :
```js
      invitation,
```

- [ ] **Step 5 : Ajouter les deux gestionnaires IPC**

Après le gestionnaire `basculerPasseTourCompte` :

```js
ipcMain.handle('basculerInvitation', async (_e, actif) => {
  reglagesInvitation.actif = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('basculerInvitationCompte', async (_e, idCompte, actif) => {
  // La frontiere IPC est la frontiere de confiance: on ne laisse pas une
  // valeur non numerique atteindre le fichier de reglages.
  if (!Number.isInteger(idCompte)) return;
  favoris.marquerInvitation(idCompte, Boolean(actif));
  const clients = await listerClients();
  const pid = compteVersPid(idCompte, clients);
  const etat = pid === null ? null : superviseur.comptes.get(pid);
  if (etat) etat.accepteInvitation = Boolean(actif);
  await envoyerEtat();
});
```

- [ ] **Step 6 : Ouvrir les deux ordres au renderer**

Dans `desktop/preload.js`, corriger le commentaire — « six ordres » devient « huit ordres », et la liste énumère les deux nouveaux — puis ajouter :

```js
  basculerInvitation: (actif) => ipcRenderer.invoke('basculerInvitation', actif),
  basculerInvitationCompte: (idCompte, actif) => ipcRenderer.invoke('basculerInvitationCompte', idCompte, actif),
```

- [ ] **Step 7 : Vérifier**

```bash
node --check desktop/main.js
node --check desktop/preload.js
npm test
```
Attendu : aucune sortie des deux `--check`, tous les tests verts.

- [ ] **Step 8 : Commit**

```bash
git add desktop/main.js desktop/preload.js
git commit -m "feat(app): brancher l'acceptation des invitations et ses deux interrupteurs"
```

---

### Task 6 : L'interface

**Dépend de la tâche 5.**

**Files:**
- Modify: `desktop/index.html`

**Interfaces:**
- Consumes: `etat.invitationActive`, `l.invitation`, `window.app.basculerInvitation`, `window.app.basculerInvitationCompte`.
- Produces: rien pour les tâches suivantes.

- [ ] **Step 1 : Le bouton global**

Dans le `<style>`, après la règle `#bpt.actif` :
```css
  #binv { padding: 7px 14px; border: 0; border-radius: 6px; background: #3a3f4b;
          color: #e6e8ec; cursor: pointer; font: inherit; }
  #binv.actif { background: #2e7d4f; }
```

Dans le `<header>`, après le bouton `bpt` :
```html
  <button id="binv">GROUPE</button>
```

- [ ] **Step 2 : L'icône deux personnes**

Après `ICONE_PASSE`, à la même facture — au trait, `currentColor`, sans fichier ni dépendance :

```js
  const ICONE_GROUPE =
    '<svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="9" cy="8" r="3.2"/><path d="M3.2 19.5c0-3.2 2.6-5.2 5.8-5.2s5.8 2 5.8 5.2"/>' +
    '<path d="M16.4 5.2a3.2 3.2 0 0 1 0 5.9"/><path d="M17.6 14.6c2.1.5 3.6 2.3 3.6 4.9"/></svg>';
```

- [ ] **Step 3 : Brancher le bouton global**

Après la déclaration `let passeTourActif = false;` :
```js
  let invitationActive = false;
```

Après le gestionnaire du bouton `bpt` :
```js
  document.getElementById('binv').addEventListener('click', () => {
    invitationActive = !invitationActive;
    window.app.basculerInvitation(invitationActive);
  });
```

Dans `window.app.surEtat`, après le bloc `bpt` :
```js
    invitationActive = etat.invitationActive;
    document.getElementById('binv').classList.toggle('actif', invitationActive);
```

- [ ] **Step 4 : L'interrupteur par ligne**

Après `const swPasse = …` :
```js
      const swInv = interrupteur(ICONE_GROUPE, l.invitation, !utilisable,
        (v) => window.app.basculerInvitationCompte(l.id, v));
```

et remplacer l'assemblage de la ligne par :
```js
      li.append(etoile, swRep, swPasse, swInv, nom, perso, badge);
```

> `utilisable` vaut `l.id !== null && l.suivi`. Un interrupteur actionnable sur un client injoignable est une promesse fausse — c'est déjà la règle des deux autres, et elle vaut pour celui-ci.

- [ ] **Step 5 : Vérifier à l'œil**

Lancer l'application, sans client Dofus. Attendu : le bouton `GROUPE` est présent et bascule au vert ; chaque ligne porte trois interrupteurs, tous grisés tant qu'aucun client n'est suivi ; l'icône est reconnaissable à sa taille réelle de 15 px.

- [ ] **Step 6 : Commit**

```bash
git add desktop/index.html
git commit -m "feat(ui): bouton GROUPE et interrupteur d'acceptation par compte"
```

---

### Task 7 : Essai en jeu, retrait de la mesure, fusion

**Dépend de toutes les précédentes.** Un journal vert et un effet en jeu sont deux choses distinctes : c'est la leçon du passe-tour, où l'application affichait « suivi » des clients qu'elle ne pouvait pas atteindre.

**Files:**
- Modify: `desktop/main.js` (retrait de `typesInedits`)
- Modify: `docs/superpowers/specs/2026-08-20-acceptation-invitation-design.md` (statut)

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: la fonction validée en jeu, la branche fusionnée.

- [ ] **Step 1 : Vérifier qu'aucun processus parasite ne tourne**

```bash
Get-CimInstance Win32_Process -Filter "Name='node.exe'"
```
Attendu : aucun `node src/cli/mm.js`. Un CLI zombie intercepte les clients à la place de l'application et invalide tout ce qui suit.

- [ ] **Step 2 : Essayer en jeu**

Lancer l'application, **puis** deux clients Dofus. Activer `GROUPE` en global et sur le compte B. Depuis A, inviter B.

Attendu : **B rejoint le groupe sans qu'on touche à sa fenêtre.** Vérifier dans le jeu, pas seulement au journal.

- [ ] **Step 3 : Vérifier le filtre**

Éteindre l'interrupteur du compte B, inviter à nouveau. Attendu : rien ne se passe, et le journal porte `invitation : invitation ignoree : acceptation eteinte pour ce compte`.

> Si un troisième joueur est disponible, faire inviter B par lui : attendu, `invitant … inconnu de l'application`. Sinon, s'en tenir au test unitaire, qui couvre déjà ce cas.

- [ ] **Step 4 : Retirer l'instrumentation de mesure**

Supprimer de `desktop/main.js` la fonction `typesInedits()` et son appel dans `composer(...)`. Garder `premiereTrame()`, l'horodatage du journal, et les lignes `invitation : …` — ce sont elles qui répondent à « pourquoi ça n'accepte pas ».

- [ ] **Step 5 : Vérifier**

```bash
node --check desktop/main.js
npm test
```
Attendu : aucune sortie du `--check`, tous les tests verts.

- [ ] **Step 6 : Mettre le spec à jour et commiter**

Passer le statut du spec de « conçu et validé, non implémenté » à « implémenté et validé en jeu le 2026-08-20 », et y reporter les deux types de trames mesurés.

```bash
git add desktop/main.js docs/superpowers/specs/2026-08-20-acceptation-invitation-design.md
git commit -m "chore: retirer l'instrumentation de mesure des invitations"
```

- [ ] **Step 7 : Fusionner**

```bash
git checkout master
git merge --no-ff <branche> -m "merge: acceptation automatique des invitations de groupe"
npm test
```
Attendu : tous les tests verts après la fusion.

---

## Auto-revue

**Couverture du spec.** Besoin → tâches 3, 5, 6. Périmètre groupe seulement → contrainte globale. Filtre « seulement mes comptes » → tâche 3, étapes 5 et 7. Hypothèse sur l'identification de l'invitant → tâche 1, étape 6, avec les trois issues nommées et l'arrêt explicite sur la troisième. Mesure préalable → tâche 1. Architecture et point de branchement → tâche 3, étapes 7 et 5. « Aucun chemin ne mène au silence » → contrainte globale, `refus()` en tâche 3, tests de chaque garde. État et persistance → tâches 2 et 3. Interface → tâches 5 et 6. Tableau des erreurs → tests de la tâche 3, étape 5. Critère de réussite → tâche 7, étape 2.

**Trous connus, assumés.** Les valeurs mesurées (`TYPE_INVITATION`, `CHAMP_INVITANT`, `HEX_ACCEPTATION`, la structure de `TRAME_ACCEPTATION`) ne peuvent pas être écrites avant la tâche 1 : ce ne sont pas des espaces réservés à combler au jugé, mais des faits à relever. La tâche 3 est bloquée tant qu'ils manquent, et la tâche 1 dit où les lire.

**Cohérence des noms.** `accepteInvitation` sur l'état vivant, `invitation` dans `favoris.json` et dans la vue, `invitationActive` dans l'état envoyé au renderer, `basculerInvitation` et `basculerInvitationCompte` pour l'IPC, `reglagesInvitation` dans `main.js`, `creerAccepteur` et `TRAME_ACCEPTATION` dans le module. Vérifié tâche par tâche.
