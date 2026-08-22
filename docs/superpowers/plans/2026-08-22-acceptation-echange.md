# Acceptation automatique de l'échange — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUISE — utiliser `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans` pour exécuter ce plan tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`).

**Objectif :** le maître lance un échange à un esclave ; l'esclave accepte seul, puis valide dès que le maître a validé.

**Architecture :** un module de traduction pure `src/echange.js`, composé dans `superviseur.onTrame` à côté des quatre politiques existantes, filtrant sur le `characterId` de nos autres clients. Branchement identique aux quatre fonctions déjà livrées : champ par compte, entrée dans `favoris.json`, deux IPC, un bouton et une case.

**Pile :** Node 18+, `node:test`, Electron 43, protobuf sans schéma via `src/codec/rawProto.js`.

## Contraintes globales

Elles s'appliquent à **toutes** les tâches.

- **`npm test` est le seul point d'entrée correct.** `node --test test/` échoue pour une autre raison et fait croire à une régression. Vérifier que la suite **imprime son total** (`ℹ tests N`), pas seulement que les tests défilent : un test qui ouvre une socket sans la fermer fait que la suite ne se termine plus jamais.
- **Construire les trames de test avec `encodeRaw`.** Une trame protobuf tronquée à la main ne se décode pas : le test croit vérifier « autre type de trame » alors qu'il vérifie « trame indécodable ».
- **`decodeRaw` DEVINE le type d'un champ LEN** (>3 octets imprimables → `string`, sinon sous-message). Lire les octets bruts via le champ `raw`, jamais se fier au `kind`.
- **Tuer les `node`/`npm test` orphelins avant tout essai en jeu :** `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`. Un CLI zombie a déjà intercepté les clients à la place de l'application pendant une session entière.
- **L'application doit tourner AVANT que les clients Dofus se connectent.** La connexion au serveur de jeu s'ouvre dès l'écran de connexion : un client déjà lancé est irrattrapable.
- **PowerShell :** `$?` passe à faux dès qu'une commande native écrit sur stderr (git le fait tout le temps) — ne pas chaîner avec `if ($?)`. Les here-strings `@'…'@` ne survivent pas au chaînage par `;` : passer par `git commit -F fichier`.
- **Un seul échantillon ne fait pas une règle.** Le projet l'a payé deux fois en deux jours.

---

## Structure des fichiers

| fichier | responsabilité | tâche |
|---|---|---|
| `src/echange.js` | **créer** — décide d'accepter et de valider, construit les deux trames | 2, 3, 4 |
| `test/echange.test.js` | **créer** — la totalité du comportement du module | 2, 3, 4 |
| `docs/superpowers/specs/2026-08-22-trames-echange.md` | **créer** — la mesure : séquence, champs, octets bruts | 1 |
| `src/protocol/compte.js` | modifier — `accepteEchange` par compte | 5 |
| `src/comptes/favoris.js` | modifier — persistance de la liste | 5 |
| `src/comptes/vue.js` | modifier — l'ensemble `echange` sur la ligne | 6 |
| `desktop/main.js` | modifier — réglages, IPC, composition, largeur | 7 |
| `desktop/preload.js` | modifier — deux ordres de plus | 7 |
| `desktop/index.html` | modifier — 5ᵉ bouton, 5ᵉ case, icône | 8 |

---

### Tâche 0 : rebaser la branche sur les corrections d'application

`feat/acceptation-echange` part de `master`. Or `desktop/index.html` et
`desktop/main.js` ont été refondus sur `feat/etalement-et-interception` (bouton
`REPLI`, champ `pilotable`, état `en-attente`, étalement du rejeu). Écrire le
5ᵉ interrupteur sur la version de `master` garantit un conflit sur les deux
fichiers que les tâches 7 et 8 touchent le plus.

**Fichiers :** aucun. Opération git seule.

- [ ] **Étape 1 : vérifier que la branche des corrections est verte**

```bash
git checkout feat/etalement-et-interception
npm test
```

Attendu : `ℹ pass 291`, `ℹ fail 0`, et le total imprimé.

- [ ] **Étape 2 : rebaser la branche du spec dessus**

```bash
git checkout feat/acceptation-echange
git rebase feat/etalement-et-interception
```

Attendu : `Successfully rebased`. Le seul commit de la branche est le spec, qui
ne touche que `docs/` — aucun conflit possible.

- [ ] **Étape 3 : vérifier**

```bash
git log --oneline -3
npm test
```

Attendu : le commit du spec au-dessus des deux commits de corrections, et
`ℹ pass 291`.

---

### Tâche 1 : mesurer les trames de l'échange

**Pas de code livré.** Cette tâche produit un document de mesure. Tout ce qui
suit en dépend : les tâches 2 à 4 ne peuvent pas être commencées sans elle.

**Fichiers :**
- Modifier : `desktop/main.js` (instrumentation temporaire, retirée en tâche 9)
- Créer : `docs/superpowers/specs/2026-08-22-trames-echange.md`

**Interfaces :**
- Produit : les valeurs que la tâche 2 inscrira en constantes — `TYPE_PROPOSITION`, `TYPE_ACCEPTATION`, `TYPE_PARTENAIRE_PRET`, `TYPE_VALIDATION`, `CHAMP_PROPOSANT`, et les octets hexadécimaux complets des deux trames sortantes.

- [ ] **Étape 1 : restaurer l'instrumentation retirée en `49d5889`**

Dans `desktop/main.js`, juste après la fonction `noterTrafic()`, réinsérer :

```js
// MESURE TEMPORAIRE — tache 1 du plan echange, a retirer en tache 9.
// Journalise le PREMIER exemplaire de chaque type de trame, par client et par
// sens. Un echange est un evenement rare: il ressort du bruit sans qu'il
// faille tout journaliser.
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

Et la composer, dans `superviseur.onTrame`, juste après `noterTrafic(),` :

```js
    typesInedits(),
```

- [ ] **Étape 2 : passe 1, découverte**

Tuer les `node` orphelins, lancer l'application **avant** les clients, puis
lancer **deux** clients. Amener les deux personnages sur la même carte. Depuis
le maître : ouvrir un échange avec l'esclave, accepter à la main sur l'esclave,
poser un objet, valider des deux côtés.

Relever dans le journal toutes les lignes `inedit :` apparues pendant la
séquence. Ce sont les types candidats.

- [ ] **Étape 3 : ajouter le journal des octets, restreint aux candidats**

Toujours dans `desktop/main.js`, après `typesInedits()` :

```js
// MESURE TEMPORAIRE — tache 1 du plan echange, a retirer en tache 9.
// Les octets bruts des trames d'echange, a CHAQUE occurrence et non
// seulement a la premiere: la validation est un evenement qui se repete, et
// c'est sa repetition qu'on veut observer. Les champs decodes ne suffisent
// pas a construire une trame, il faut l'hexadecimal.
const TYPES_MESURES = new Set([/* les types releves a l'etape 2 */]);

function octetsDesTrames() {
  return function onTrame({ pid, dir, frame, brute }) {
    if (frame === null || !TYPES_MESURES.has(frame.type)) return;
    const champs = (frame.payload || []).map((f) => `${f.no}=${f.value}`).join(' ');
    journal(pid, `octets : ${dir} ${frame.kind} ${frame.type} { ${champs} } = ${brute.toString('hex')}`);
  };
}
```

Composer `octetsDesTrames(),` après `typesInedits(),`.

- [ ] **Étape 4 : passe 2, trois échanges dans les deux sens**

Trois échanges complets minimum : maître→esclave, esclave→maître, puis un
troisième. À chaque fois : proposition, acceptation, dépôt d'un objet,
validation des deux côtés.

**Quatrième échange, recommandé :** un joueur tiers propose un échange à un
esclave. C'est le seul essai qui teste le filtre pour de vrai — les trois
premiers le trouvent toujours satisfait.

**Cinquième essai, obligatoire pour la question 4 :** valider des deux côtés,
puis modifier le contenu, et observer ce que le serveur renvoie.

- [ ] **Étape 5 : identifier le champ du proposant, en croisant les deux sens**

Le piège est nommé : pour l'invitation de groupe, l'ordre des champs suggérait
que le champ 1 portait l'invitant ; il portait le **destinataire**. Un filtre
bâti dessus aurait comparé notre propre identifiant, l'aurait toujours trouvé,
et aurait accepté **toutes** les invitations — en passant l'essai en jeu sans
broncher.

**Le champ qui bascule quand on inverse les rôles est le proposant.** Les
`characterId` des deux comptes se lisent dans le journal (`etat.characterId`,
appris du trafic) ; les comparer aux valeurs des champs des deux passages.

- [ ] **Étape 6 : écrire le document de mesure**

Créer `docs/superpowers/specs/2026-08-22-trames-echange.md`, sur le modèle de
`docs/superpowers/specs/2026-08-20-trames-invitation-groupe.md` :

1. date, version du client, nombre de clients ;
2. tableau des deux `characterId` mesurés et de leurs personnages ;
3. la séquence complète, une ligne par trame, dans l'ordre ;
4. un tableau par type : numéro de champ → contenu, en marquant ceux qui sont
   constants sur les trois passages ;
5. **les octets bruts complets** des deux trames sortantes ;
6. la réponse explicite aux quatre questions du spec, dont : **existe-t-il un
   événement « l'autre a validé », et porte-t-il l'identifiant du partenaire ?**
7. la preuve du champ « proposant », par croisement des deux sens ;
8. les trames voisines relevées mais hors périmètre.

- [ ] **Étape 7 : commiter la mesure**

```bash
git add docs/superpowers/specs/2026-08-22-trames-echange.md desktop/main.js
git commit -F message.txt
```

Message : `mesure: les trames de l'echange, relevees sur trois passages`.

---

### Tâche 2 : construire les deux trames sortantes

**Fichiers :**
- Créer : `src/echange.js`
- Créer : `test/echange.test.js`

**Interfaces :**
- Consomme : les valeurs mesurées en tâche 1.
- Produit : `construireAcceptation(valeur)` et `construireValidation(valeur)`, rendant chacune un `Buffer` ; les constantes `TYPE_PROPOSITION`, `TYPE_PARTENAIRE_PRET`, `CHAMP_PROPOSANT`.

- [ ] **Étape 1 : reporter les valeurs mesurées**

Créer `src/echange.js` avec l'en-tête et les constantes. **Les cinq valeurs
marquées se lisent dans `docs/superpowers/specs/2026-08-22-trames-echange.md`,
sections 3 et 4** — ne rien inventer, ne rien deviner :

```js
'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

// L'acceptation automatique de l'echange, et elle seule.
//
// LES TRAMES. Mesurees le 22/08 sur deux clients attaches, trois passages dans
// les deux sens. Le detail et les octets bruts sont dans
// docs/superpowers/specs/2026-08-22-trames-echange.md.
//
// LE FILTRE. Un echange n'est accepte que si le proposant est un AUTRE client
// pilote par l'application. Les characterId sont appris du trafic de chaque
// client, donc connus sans configuration. Sans ce filtre, n'importe quel
// joueur ouvrant un echange avec un esclave le verrait valider des qu'il coche.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur, comme l'accepteur d'invitation.

const TYPE_PROPOSITION = '';        // section 3 du doc de mesure
const TYPE_PARTENAIRE_PRET = '';    // section 3 du doc de mesure
const URL_ACCEPTATION = 'type.ankama.com/';   // section 4
const URL_VALIDATION = 'type.ankama.com/';    // section 4
const CHAMP_PROPOSANT = 0;          // section 7 — le champ PROUVE par croisement
```

- [ ] **Étape 2 : écrire les tests d'octets, qui échouent**

Dans `test/echange.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { construireAcceptation, construireValidation } = require('../src/echange');
const { decodeFrameRaw } = require('../src/codec/rawProto');

// Les octets exacts releves le 22/08. Recopier ici l'hexadecimal de la
// section 5 du document de mesure, et la valeur qui va avec.
const VALEUR_MESUREE = 0n;
const HEX_ACCEPTATION = '';
const HEX_VALIDATION = '';

test('la trame d acceptation construite est celle mesuree', () => {
  assert.strictEqual(construireAcceptation(VALEUR_MESUREE).toString('hex'), HEX_ACCEPTATION);
  assert.notStrictEqual(decodeFrameRaw(construireAcceptation(VALEUR_MESUREE)), null);
});

test('la trame de validation construite est celle mesuree', () => {
  assert.strictEqual(construireValidation(VALEUR_MESUREE).toString('hex'), HEX_VALIDATION);
  assert.notStrictEqual(decodeFrameRaw(construireValidation(VALEUR_MESUREE)), null);
});
```

- [ ] **Étape 3 : lancer, vérifier l'échec**

```bash
npm test
```

Attendu : les deux tests en `✖`, `construireAcceptation is not a function`.

- [ ] **Étape 4 : implémenter les deux constructeurs**

Même enveloppe que `construireAcceptation` de `src/invitation.js` — c'est la
forme commune à toutes les requêtes observées. Ajouter dans `src/echange.js` :

```js
// Enveloppe commune a toutes les requetes observees:
// request { content: Any{ type_url, value }, uid: -1 }.
function requete(url, champs) {
  return encodeRaw([
    { no: 2, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: url },
        { no: 2, wire: WIRE.LEN, kind: 'message', value: champs },
      ] },
      // uid = -1, comme toutes les requetes observees.
      { no: 2, wire: WIRE.VARINT, value: -1n },
    ] },
  ]);
}

function construireAcceptation(valeur) {
  return requete(URL_ACCEPTATION, [{ no: 1, wire: WIRE.VARINT, value: valeur }]);
}

function construireValidation(valeur) {
  return requete(URL_VALIDATION, [{ no: 1, wire: WIRE.VARINT, value: valeur }]);
}

module.exports = {
  construireAcceptation, construireValidation,
  TYPE_PROPOSITION, TYPE_PARTENAIRE_PRET, CHAMP_PROPOSANT,
};
```

**Si la mesure montre que l'acceptation ou la validation ne porte aucun champ**
(comme `jxy`, le passe-tour), passer `[]` au lieu du tableau à un élément. **Si
elle en porte plusieurs ou d'un autre numéro**, les reporter tels quels : les
octets du test tranchent, pas cette esquisse.

- [ ] **Étape 5 : lancer, vérifier le passage**

```bash
npm test
```

Attendu : les deux tests en `✔`, total imprimé, `fail 0`.

- [ ] **Étape 6 : commiter**

```bash
git add src/echange.js test/echange.test.js
git commit -m "feat(echange): construire l'acceptation et la validation"
```

---

### Tâche 3 : accepter la proposition, avec le filtre

**Fichiers :**
- Modifier : `src/echange.js`
- Modifier : `test/echange.test.js`

**Interfaces :**
- Consomme : `construireAcceptation`, `CHAMP_PROPOSANT`, `TYPE_PROPOSITION` de la tâche 2.
- Produit : `creerAccepteurEchange({ superviseur, reglages, onCompteRendu })`, rendant une fonction `onTrame({ pid, dir, frame })`.

- [ ] **Étape 1 : écrire les tests du filtre et des refus**

Ajouter dans `test/echange.test.js` :

```js
const {
  creerAccepteurEchange, TYPE_PROPOSITION, CHAMP_PROPOSANT,
} = require('../src/echange');

const MOI = 665809125670n;
const AMI = 677057659174n;
const ETRANGER = 123456789012n;

function fauxSuperviseur(comptes = [[1, MOI], [2, AMI]]) {
  const emis = [];
  const etats = new Map(comptes.map(([pid, id]) => [pid, {
    pid, accepteEchange: true, characterId: id,
  }]));
  return {
    emis,
    etats,
    comptes: { get: (pid) => etats.get(pid) || null, get tous() { return [...etats.values()]; } },
    emettre: (pid, octets) => { emis.push({ pid, octets }); return { ok: true, octets: octets.length }; },
  };
}

const proposition = (proposant, valeur = VALEUR_MESUREE) => ({
  kind: 'event', type: TYPE_PROPOSITION,
  payload: [{ no: CHAMP_PROPOSANT, value: proposant }, { no: 1, value: valeur }],
});
const evenement = (frame, pid = 1) => ({ pid, dir: 'in', frame, brute: Buffer.alloc(0) });

function accepteur(sup, reglages = { actif: true }, rendu = []) {
  return creerAccepteurEchange({ superviseur: sup, reglages, onCompteRendu: (r) => rendu.push(r) });
}

test('un echange propose par un de nos comptes est accepte', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(proposition(AMI)));
  assert.strictEqual(sup.emis.length, 1);
  assert.strictEqual(sup.emis[0].pid, 1);
});

// Le coeur de la fonction: sans ce filtre, n'importe quel joueur ouvrant un
// echange avec un esclave le verrait valider des qu'il coche.
test('un echange propose par un tiers est refuse, et le dit', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(proposition(ETRANGER)));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(rendu[0].ok, false);
  assert.match(rendu[0].raison, /proposant/);
});

// Notre propre characterId ne designe pas un proposant: c'est le piege qui a
// failli livrer un filtre acceptant toutes les invitations de groupe.
test('un echange portant notre propre identifiant est refuse', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(proposition(MOI)));
  assert.strictEqual(sup.emis.length, 0);
});

test('interrupteur general eteint : rien n est emis', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: false }, rendu)(evenement(proposition(AMI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /interrupteur general/);
});

test('case du compte eteinte : rien n est emis', () => {
  const sup = fauxSuperviseur();
  sup.etats.get(1).accepteEchange = false;
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(proposition(AMI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /eteinte pour ce compte/);
});

test('compte inconnu du superviseur : rien n est emis', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(proposition(AMI), 99));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /compte inconnu/);
});

test('une trame sortante n est jamais traitee', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)({ pid: 1, dir: 'out', frame: proposition(AMI), brute: Buffer.alloc(0) });
  assert.strictEqual(sup.emis.length, 0);
});

test('un autre type de trame est ignore sans compte rendu', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement({ kind: 'event', type: 'zzz', payload: [] }));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(rendu.length, 0);
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

```bash
npm test
```

Attendu : les huit tests en `✖`, `creerAccepteurEchange is not a function`.

- [ ] **Étape 3 : implémenter l'accepteur**

Ajouter dans `src/echange.js`, avant `module.exports` :

```js
const champ = (frame, no) => (frame.payload || []).find((f) => f.no === no) || null;

// Les characterId de nos AUTRES clients. Notre propre identifiant n'en fait
// jamais partie: il designe le destinataire, pas un proposant.
function autresNotres(superviseur, pid) {
  return superviseur.comptes.tous
    .filter((e) => e.pid !== pid && e.characterId !== null && e.characterId !== undefined)
    .map((e) => e.characterId);
}

// superviseur   — porte emettre(pid, octets), comptes.get(pid) et comptes.tous
// reglages      — { actif }, RELU a chaque trame pour que l'interrupteur
//                 general prenne effet aussitot
// onCompteRendu — recoit ce qui a ete emis, ou refuse et pourquoi
function creerAccepteurEchange({ superviseur, reglages, onCompteRendu = () => {} }) {
  return function onTrame({ pid, dir, frame }) {
    if (dir !== 'in' || frame === null || frame === undefined) return;
    if (frame.type !== TYPE_PROPOSITION) return;

    // Un echange est un evenement rare: dire pourquoi on ne l'accepte pas ne
    // coute rien et repond a la seule question que l'utilisateur se pose.
    const refus = (raison) => onCompteRendu({ pid, ok: false, raison });

    if (!reglages.actif) return refus('echange ignore : interrupteur general eteint');
    const etat = superviseur.comptes.get(pid);
    if (etat === null || etat === undefined) return refus('echange ignore : compte inconnu du superviseur');
    if (!etat.accepteEchange) return refus('echange ignore : acceptation eteinte pour ce compte');

    const proposant = champ(frame, CHAMP_PROPOSANT);
    if (proposant === null) return refus('echange refuse : aucun proposant dans la trame');
    if (!autresNotres(superviseur, pid).some((id) => id === proposant.value)) {
      return refus(`echange refuse : proposant ${proposant.value} inconnu de l'application`);
    }

    const res = superviseur.emettre(pid, construireAcceptation(proposant.value));
    onCompteRendu({ pid, ok: res.ok, raison: res.raison, octets: res.octets });
  };
}
```

**Note :** `construireAcceptation` reçoit ici la valeur du champ proposant. **Si
la mesure montre que l'acceptation recopie un autre champ** (un identifiant
d'échange, par exemple), lire ce champ-là et le passer à la place — la section 4
du document de mesure le dit.

Ajouter `creerAccepteurEchange` à `module.exports`.

- [ ] **Étape 4 : lancer, vérifier le passage**

```bash
npm test
```

Attendu : tout en `✔`, total imprimé, `fail 0`.

- [ ] **Étape 5 : commiter**

```bash
git add src/echange.js test/echange.test.js
git commit -m "feat(echange): accepter la proposition d'un autre de nos clients"
```

---

### Tâche 4 : valider en réaction à la validation du partenaire

**Fichiers :**
- Modifier : `src/echange.js`
- Modifier : `test/echange.test.js`

**Interfaces :**
- Consomme : `construireValidation`, `TYPE_PARTENAIRE_PRET` de la tâche 2 ; `autresNotres`, `champ` de la tâche 3.
- Produit : la même fonction `onTrame` rendue par `creerAccepteurEchange`, qui traite désormais **deux** types de trames.

**Cette tâche a deux formes. Le document de mesure, section 6, dit laquelle.**

- [ ] **Étape 1 : lire la réponse à la question 3**

Ouvrir `docs/superpowers/specs/2026-08-22-trames-echange.md`, section 6.

- **L'événement « l'autre a validé » porte l'identifiant du partenaire** →
  forme A, étapes 2 à 5.
- **Il ne le porte pas** → forme B, étapes 6 à 10. Elle exige que la section 6
  dise aussi **comment un échange se termine** ; si ce n'est pas mesuré,
  retourner en tâche 1 plutôt que d'inventer une fin d'échange.

#### Forme A — sans état

- [ ] **Étape 2 : écrire les tests**

```js
const { TYPE_PARTENAIRE_PRET } = require('../src/echange');

const partenairePret = (partenaire) => ({
  kind: 'event', type: TYPE_PARTENAIRE_PRET,
  payload: [{ no: CHAMP_PROPOSANT, value: partenaire }],
});

test('la validation du partenaire declenche la notre', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(partenairePret(AMI)));
  assert.strictEqual(sup.emis.length, 1);
  assert.strictEqual(sup.emis[0].pid, 1);
});

// Un tiers qui coche ne doit pas nous faire cocher: c'est le vol en un clic
// que le filtre existe pour empecher.
test('la validation d un tiers ne declenche rien', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(partenairePret(ETRANGER)));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(rendu[0].ok, false);
});

// La proposition ouvre la fenetre, elle ne valide pas. Confondre les deux
// ferait valider un echange vide avant que l'utilisateur ait pose quoi que
// ce soit.
test('l acceptation seule n emet pas de validation', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(proposition(AMI)));
  assert.strictEqual(sup.emis.length, 1, 'une seule trame: l acceptation');
});

test('interrupteur general eteint : la validation ne part pas non plus', () => {
  const sup = fauxSuperviseur();
  accepteur(sup, { actif: false })(evenement(partenairePret(AMI)));
  assert.strictEqual(sup.emis.length, 0);
});
```

- [ ] **Étape 3 : lancer, vérifier l'échec**

```bash
npm test
```

Attendu : `la validation du partenaire declenche la notre` en `✖`, aucune trame émise.

- [ ] **Étape 4 : implémenter la seconde réaction**

Dans `creerAccepteurEchange`, remplacer la garde de type par un aiguillage.
Après les trois gardes communes (`reglages.actif`, compte connu,
`etat.accepteEchange`), router selon le type :

```js
    if (frame.type !== TYPE_PROPOSITION && frame.type !== TYPE_PARTENAIRE_PRET) return;
```

puis, après les gardes et la vérification du proposant :

```js
    // Le partenaire a valide: on valide a notre tour. Le meme filtre
    // s'applique -- un tiers qui coche ne doit pas nous faire cocher.
    if (frame.type === TYPE_PARTENAIRE_PRET) {
      const res = superviseur.emettre(pid, construireValidation(proposant.value));
      return onCompteRendu({ pid, ok: res.ok, raison: res.raison, octets: res.octets, validation: true });
    }
```

Renommer la variable `proposant` en `partenaire` si le champ mesuré porte un
autre nom dans le document ; garder un seul nom dans tout le module.

- [ ] **Étape 5 : lancer, vérifier le passage, commiter**

```bash
npm test
git add src/echange.js test/echange.test.js
git commit -m "feat(echange): valider en reaction a la validation du partenaire"
```

#### Forme B — avec état par compte

- [ ] **Étape 6 : écrire les tests, dont celui de non-fuite**

```js
test('la validation du partenaire declenche la notre apres acceptation', () => {
  const sup = fauxSuperviseur();
  const a = accepteur(sup);
  a(evenement(proposition(AMI)));
  a(evenement(partenairePret()));
  assert.strictEqual(sup.emis.length, 2);
});

// LE test de cette forme: sans effacement a la fermeture, un echange
// ultérieur avec un inconnu hérite de l'autorisation du precedent. C'est la
// collision d'etat deja corrigee dans le no-anim.
test('l autorisation ne survit pas a la fermeture de l echange', () => {
  const sup = fauxSuperviseur();
  const a = accepteur(sup);
  a(evenement(proposition(AMI)));
  a(evenement(fermeture()));
  a(evenement(partenairePret()));
  assert.strictEqual(sup.emis.length, 1, 'seule l acceptation initiale');
});

test('la validation sans acceptation prealable ne declenche rien', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(partenairePret()));
  assert.strictEqual(sup.emis.length, 0);
});
```

`partenairePret()` et `fermeture()` se construisent d'après les types et champs
de la section 3 du document de mesure, sur le modèle de `proposition()`.

- [ ] **Étape 7 : lancer, vérifier l'échec**

```bash
npm test
```

- [ ] **Étape 8 : implémenter l'état par compte**

```js
  // Echanges acceptes, par pid. Pose a l'acceptation, EFFACE a la fermeture:
  // sans cet effacement l'autorisation fuit vers l'echange suivant, y compris
  // avec un inconnu. Meme piege que l'etat par connexion du no-anim.
  const enCours = new Map();   // pid -> characterId du partenaire
```

Poser `enCours.set(pid, proposant.value)` après l'émission de l'acceptation,
`enCours.delete(pid)` sur le type de fermeture, et n'émettre la validation que
si `enCours.has(pid)`.

- [ ] **Étape 9 : lancer, vérifier le passage**

```bash
npm test
```

- [ ] **Étape 10 : commiter**

```bash
git add src/echange.js test/echange.test.js
git commit -m "feat(echange): valider en reaction, avec etat par compte"
```

---

### Tâche 5 : le champ par compte et sa persistance

**Fichiers :**
- Modifier : `src/protocol/compte.js:57` (à côté de `accepteInvitation`)
- Modifier : `src/comptes/favoris.js`
- Modifier : `test/comptes-favoris.test.js`

**Interfaces :**
- Produit : `EtatCompte.accepteEchange` (booléen, faux par défaut) ; `Favoris.echangeActif(id)`, `Favoris.marquerEchange(id, actif)`, `Favoris.tousEchange()`.

- [ ] **Étape 1 : écrire les tests de persistance**

Dans `test/comptes-favoris.test.js`, sur le modèle des tests `invitation`
existants :

```js
test('l echange se marque, se lit et survit au rechargement', () => {
  const chemin = fichierTemporaire();
  const f = new Favoris(chemin).charger();
  assert.strictEqual(f.echangeActif(42), false);
  f.marquerEchange(42, true);
  assert.strictEqual(f.echangeActif(42), true);
  assert.deepStrictEqual(new Favoris(chemin).charger().tousEchange(), [42]);
});

test('l echange se retire', () => {
  const chemin = fichierTemporaire();
  const f = new Favoris(chemin).charger();
  f.marquerEchange(42, true);
  f.marquerEchange(42, false);
  assert.deepStrictEqual(new Favoris(chemin).charger().tousEchange(), []);
});
```

Réutiliser le helper de fichier temporaire déjà présent dans ce fichier de
tests ; ne pas en créer un second.

- [ ] **Étape 2 : lancer, vérifier l'échec**

```bash
npm test
```

Attendu : `f.echangeActif is not a function`.

- [ ] **Étape 3 : implémenter**

Dans `src/protocol/compte.js`, à côté de `this.accepteInvitation = false;` :

```js
    // Acceptation automatique de l'echange propose par un autre de nos
    // clients. Independant de `exclu`, `passeTour` et `accepteInvitation`.
    this.accepteEchange = false;
```

Dans `src/comptes/favoris.js` : un `this._echange = new Set()` dans le
constructeur, sa lecture dans `charger()` (avec le même filtre
`Number.isInteger`), sa remise à vide dans le `catch`, les trois méthodes sur le
modèle exact de `invitationActive`/`marquerInvitation`/`tousInvitation`, et la
clé `echange: this.tousEchange()` dans `_ecrire()`.

- [ ] **Étape 4 : lancer, vérifier le passage, commiter**

```bash
npm test
git add src/protocol/compte.js src/comptes/favoris.js test/comptes-favoris.test.js
git commit -m "feat(echange): champ par compte et persistance"
```

---

### Tâche 6 : la case sur la ligne du compte

**Fichiers :**
- Modifier : `src/comptes/vue.js`
- Modifier : `test/comptes-vue.test.js`

**Interfaces :**
- Consomme : rien des tâches précédentes.
- Produit : `construireVue({ …, echange })` ajoute un champ `echange` (booléen) à chaque ligne.

**Le piège de cette tâche a déjà été payé trois fois** — passe-tour, invitation,
no-anim : le champ codé en dur à faux dans les **lignes de repli** (celles des
clients dont le compte est absent de la liste Zaap). La case s'affiche alors
éteinte alors que la fonction agit, donc impossible à débrayer. Et toutes les
lignes passent par ce repli si `lireComptes()` échoue.

- [ ] **Étape 1 : écrire les trois tests**

```js
test('l echange remonte sur la ligne du compte', () => {
  const lignes = vue({ echange: new Set([2]) });
  assert.strictEqual(lignes.find((l) => l.id === 1).echange, false);
  assert.strictEqual(lignes.find((l) => l.id === 2).echange, true);
});

// Meme piege que passeTour, invitation et noAnim, rencontre trois fois: code
// en dur a faux, la case s'affiche eteinte alors que la fonction agit.
test('l echange remonte aussi sur un client sans ligne de compte', () => {
  const l = vue({
    clients: [{ pid: 500, idCompte: 42, personnage: 'Tardif', classe: 'Eniripsa' }],
    intercepte: new Set([500]),
    echange: new Set([42]),
  }).pop();
  assert.strictEqual(l.id, 42);
  assert.strictEqual(l.echange, true);
});

test('l absence d echange ne casse pas la vue', () => {
  assert.strictEqual(vue()[0].echange, false);
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

```bash
npm test
```

Attendu : les trois en `✖`, `undefined !== true`.

- [ ] **Étape 3 : implémenter aux trois endroits**

1. signature : `noAnim = new Set(), echange = new Set(),`
2. `ligneBase(...)` : nouveau paramètre `echange` et `echange: echange.has(compte.id),`
3. **ligne de repli** : `echange: c.idCompte !== null && echange.has(c.idCompte),`

- [ ] **Étape 4 : lancer, vérifier le passage, commiter**

```bash
npm test
git add src/comptes/vue.js test/comptes-vue.test.js
git commit -m "feat(echange): la case sur la ligne du compte"
```

---

### Tâche 7 : brancher dans l'application

**Fichiers :**
- Modifier : `desktop/main.js`
- Modifier : `desktop/preload.js`

**Interfaces :**
- Consomme : `creerAccepteurEchange` (tâche 3-4), `Favoris.echangeActif`/`marquerEchange` (tâche 5), le champ `echange` de `construireVue` (tâche 6).
- Produit : les IPC `basculerEchange` et `basculerEchangeCompte` ; le champ `echangeActif` dans l'état envoyé au renderer.

**Les deux pièges de cette couche :** l'interrupteur général recalculé à chaque
tick depuis les cases par compte (le bouton `ANIM` ne commandait rien —
`envoyerEtat()` écrasait son drapeau), et la resynchronisation depuis
`favoris.json` qui doit couvrir le nouveau champ, sinon un compte relancé repart
à faux.

- [ ] **Étape 1 : le réglage et la politique**

```js
const { creerAccepteurEchange } = require('../src/echange');
// Lu a chaque trame par l'accepteur d'echange: modifier ce champ suffit.
const reglagesEchange = { actif: false };
```

Composer dans `superviseur.onTrame`, après `creerAccepteur(...)` :

```js
    creerAccepteurEchange({
      superviseur,
      reglages: reglagesEchange,
      onCompteRendu: ({ pid, ok, raison, validation }) => {
        if (ok) journal(pid, `echange : ${validation ? 'valide' : 'accepte'}`);
        else journal(pid, `echange : ${raison}`);
      },
    }),
```

- [ ] **Étape 2 : la resynchronisation, aux DEUX endroits**

Dans `balayerProcess()`, à côté des trois lignes existantes :

```js
        etat.accepteEchange = favoris.echangeActif(idCompte);
```

Dans `envoyerEtat()`, dans la boucle de resynchronisation, la même ligne. Puis
l'ensemble affiché, sur le modèle exact des trois autres :

```js
  const echange = new Set(
    superviseur.comptes.tous.filter((e) => e.accepteEchange).map((e) => pidVersCompte(e.pid, clients)),
  );
```

Passer `echange` à `construireVue`, et `echangeActif: reglagesEchange.actif` dans
l'objet envoyé au renderer.

- [ ] **Étape 3 : les deux IPC**

```js
ipcMain.handle('basculerEchange', async (_e, actif) => {
  // Interrupteur general independant, mis a jour par l'IPC SEUL: le recalculer
  // dans envoyerEtat() depuis les cases par compte est ce qui a fait que le
  // bouton ANIM ne commandait rien.
  reglagesEchange.actif = Boolean(actif);
  await envoyerEtat();
});

ipcMain.handle('basculerEchangeCompte', async (_e, idCompte, actif) => {
  // Frontiere de confiance: le renderer est sandboxe mais reste hors de notre
  // controle. Un idCompte non entier ne doit ni chercher de pid ni atteindre
  // l'etat du superviseur.
  if (!Number.isInteger(idCompte)) return;
  favoris.marquerEchange(idCompte, Boolean(actif));
  const clients = await listerClients();
  const pid = compteVersPid(idCompte, clients);
  const etat = pid === null ? null : superviseur.comptes.get(pid);
  if (etat) etat.accepteEchange = Boolean(actif);
  await envoyerEtat();
});
```

Vérifier l'ordre exact des lignes sur `basculerNoAnimCompte` et le reproduire.

- [ ] **Étape 4 : la largeur de fenêtre**

Dans `creerFenetre()`, `width: 720` → `width: 820`. L'en-tête porte cinq
boutons, le délai et le résumé.

- [ ] **Étape 5 : le preload**

Deux lignes de plus, et mettre à jour le commentaire d'en-tête : « dix ordres »
devient « douze ordres ».

```js
  basculerEchange: (actif) => ipcRenderer.invoke('basculerEchange', actif),
  basculerEchangeCompte: (idCompte, actif) => ipcRenderer.invoke('basculerEchangeCompte', idCompte, actif),
```

- [ ] **Étape 6 : vérifier et commiter**

```bash
npm test
npm run app
```

L'application démarre, la fenêtre fait 820 px, la liste s'affiche. Fermer.

```bash
git add desktop/main.js desktop/preload.js
git commit -m "feat(echange): brancher dans l'application"
```

---

### Tâche 8 : le bouton et la case

**Fichiers :**
- Modifier : `desktop/index.html`

- [ ] **Étape 1 : le style et le bouton**

Après la règle `#banim.actif`, la même paire pour `#bech`. Puis dans
`<header>`, après le bouton `ANIM` :

```html
  <button id="bech">ÉCHANGE</button>
```

- [ ] **Étape 2 : l'icône**

Deux flèches opposées, dans le style des quatre autres (trait courant, aucune
dépendance, suit le thème) :

```js
  const ICONE_ECHANGE =
    '<svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 8h13"/><path d="M13 4l4 4-4 4"/>' +
    '<path d="M20 16H7"/><path d="M11 12l-4 4 4 4"/></svg>';
```

- [ ] **Étape 3 : le câblage**

Sur le modèle exact des quatre autres : un `let echangeActif = false;`, un
écouteur de clic qui bascule et appelle `window.app.basculerEchange`, et dans
`surEtat` la reprise depuis l'état plus le `classList.toggle('actif', …)`.

Puis la 5ᵉ case dans la ligne :

```js
      const swEch = interrupteur(ICONE_ECHANGE, l.echange, !utilisable,
        (v) => window.app.basculerEchangeCompte(l.id, v));
```

et l'ajouter au `li.append(...)` après `swAnim`.

- [ ] **Étape 4 : vérifier à l'œil**

```bash
npm run app
```

Cinq boutons sur une seule ligne, cinq cases par compte, rien qui déborde. Le
bouton passe au vert au clic et revient au gris.

- [ ] **Étape 5 : commiter**

```bash
git add desktop/index.html
git commit -m "feat(echange): bouton ECHANGE et case par compte"
```

---

### Tâche 9 : essai en jeu, retrait de l'instrumentation

**Fichiers :**
- Modifier : `desktop/main.js` (retrait de `typesInedits` et `octetsDesTrames`)

- [ ] **Étape 1 : essai en jeu, les six critères du spec**

Tuer les `node` orphelins. Lancer l'application, **puis** deux clients. Cocher
`ÉCHANGE` et la case des deux comptes.

1. Le maître lance un échange à l'esclave → la fenêtre s'ouvre des deux côtés
   sans aucun clic sur l'esclave.
2. Le maître valide → l'esclave valide, l'échange se conclut.
3. Modifier le contenu après validation, puis revalider → la séquence
   recommence et se conclut.
4. Un joueur tiers ouvre un échange avec un esclave → rien n'est accepté, et la
   ligne du compte dit pourquoi. **Si aucun tiers n'est disponible, le noter
   comme non vérifié en jeu** dans le compte rendu : le test unitaire couvre le
   filtre, mais pas la trame réelle d'un inconnu.
5. Interrupteur général éteint, ou case décochée → rien ne part.
6. `npm test` passe et imprime son total.

- [ ] **Étape 2 : retirer l'instrumentation**

Supprimer `typesInedits()`, `octetsDesTrames()`, `TYPES_MESURES` et leurs deux
lignes dans la composition. **Garder** `noterTrafic()` : elle n'est pas de
l'instrumentation, c'est elle qui prouve l'interception.

- [ ] **Étape 3 : vérifier que l'application marche toujours sans elle**

```bash
npm test
npm run app
```

- [ ] **Étape 4 : commiter**

```bash
git add desktop/main.js
git commit -m "chore: retirer l'instrumentation de mesure de l'echange"
```

- [ ] **Étape 5 : repackager**

```bash
npm run pack
```

L'exe de `desktop/dist/Replicate-win32-x64/` est périmée dès qu'une
fonctionnalité est ajoutée. La lancer une fois pour vérifier qu'elle porte bien
les cinq boutons.

---

## Revue du plan

**Couverture du spec.** Les six critères de réussite sont l'étape 1 de la
tâche 9. Le filtre « un autre de nos clients » est en tâche 3. La validation en
réaction est en tâche 4, dans ses deux formes. Les trois pièges de branchement
nommés dans le spec sont dans les tâches 6 (case codée en dur), 7 (interrupteur
recalculé, resynchronisation) et 7 (frontière de confiance). La fenêtre à 820 px
est en tâche 7. Le protocole de mesure, ses quatre questions et la preuve du
champ proposant sont la tâche 1. Le « on ne généralise pas `creerAccepteur` » du
spec est respecté : aucune tâche ne touche `src/invitation.js`.

**Valeurs à reporter depuis la mesure.** Cinq constantes en tâche 2 étape 1,
trois valeurs de test en tâche 2 étape 2. Elles ne sont pas des « TODO » : la
tâche 1 les produit, et chaque emplacement dit dans quelle section du document
de mesure les lire. Aucune ne peut être devinée, et le plan interdit
explicitement de le faire.

**Cohérence des noms.** `creerAccepteurEchange`, `construireAcceptation`,
`construireValidation`, `TYPE_PROPOSITION`, `TYPE_PARTENAIRE_PRET`,
`CHAMP_PROPOSANT`, `accepteEchange`, `echangeActif`, `marquerEchange`,
`tousEchange`, `basculerEchange`, `basculerEchangeCompte`, `bech`,
`ICONE_ECHANGE` — chacun est défini une fois et réutilisé tel quel.
`construireAcceptation` existe aussi dans `src/invitation.js` : les deux modules
ne s'importent pas l'un l'autre, il n'y a pas de collision.
