# La pierre d'âme équipée toute seule, plan d'implémentation

> **Pour un agent :** SOUS-COMPÉTENCE REQUISE. Utiliser
> superpowers:subagent-driven-development (recommandé) ou
> superpowers:executing-plans pour exécuter tâche par tâche. Les étapes sont
> des cases à cocher.

**But :** quand la chasse est allumée, OMNI équipe sur chaque client connecté
la pierre d'âme de la tranche qui couvre le monstre le plus haut du groupe
attaqué, et signale par écrit et par un bip quand il ne peut pas.

**Architecture :** trois modules dans `src/pda-archi/`. Ce qui décide est pur et
se teste sans le jeu (`pierres.js`), ce qui lit et construit les trames est pur
aussi (`trames.js`), ce qui agit est branché sur le flux (`chasse.js`). Même
découpage que `src/hdv/`, et le module branché suit exactement la forme de
`creerVente` : une fabrique qui rend `{ onTrame, ... }`.

**Outillage :** node:test, `node --test`. Aucune dépendance nouvelle.

**Conception :** `2026-09-03-pda-archi-design.md`, à copier dans
`docs/superpowers/specs/` en même temps que la branche est créée.

---

## Avant de commencer

`master` doit être à jour (`46d68b8` ou plus récent) et la branche créée :

```bash
cd C:/Users/jibef/mm
git checkout -b feat/chasse
cp C:/Users/jibef/labo-chasse/2026-09-03-pda-archi-design.md docs/superpowers/specs/
cp C:/Users/jibef/labo-chasse/2026-09-03-pda-archi-plan.md docs/superpowers/plans/
git add docs/superpowers
git commit -m "docs(chasse): equiper la bonne pierre d ame, conception et plan"
```

Les deux fixtures de mesure sont dans `C:\Users\jibef\labo-chasse\` et servent
aux tâches 1 et 3 :

- `pda-archi-ivx-inventaire.hex`, l'inventaire de connexion, 471 piles
- `jss-groupes-monstres.hex`, la carte et ses deux groupes de monstres

---

## Fichiers

| Fichier | Responsabilité |
|---|---|
| `src/hdv/trames.js` | modifié : `lirePile` garde la position |
| `src/pda-archi/pierres.js` | créé : la table des pierres, le choix. Pur. |
| `src/pda-archi/trames.js` | créé : lire `jss` et `ivq`, construire `iuk`. Pur. |
| `src/pda-archi/chasse.js` | créé : l'écoute, la décision, l'ordre, le compte rendu |
| `src/droits/liste.js` | modifié : la dixième fonction |
| `serveur-maj/lib/fonctions.js` | modifié : la même, côté panneau |
| `src/comptes/favoris.js` | modifié : la clé `chasse` |
| `desktop/main.js` | modifié : branchement, interrupteur, compte rendu |
| `desktop/preload.js` | modifié : les deux canaux |
| `desktop/index.html` | modifié : la case à cocher et le bip |
| `test/pda-archi-pierres.test.js` | créé |
| `test/pda-archi-trames.test.js` | créé |
| `test/pda-archi.test.js` | créé |
| `test/fixtures/pda-archi-ivx-inventaire.hex` | créé (copie) |
| `test/fixtures/pda-archi-jss-groupes.hex` | créé (copie) |

---

### Tâche 1 : la position dans les piles d'inventaire

`lirePile` jette aujourd'hui le champ 1 d'une pile, qui est sa position
d'équipement. Sans lui on ne peut pas savoir si une pierre est déjà portée.

**PIÈGE, et c'est tout l'objet du premier test.** Le zéro protobuf ne s'écrit
pas : un champ 1 ABSENT vaut la position 0, l'amulette, PAS l'inventaire.
Prendre 63 par défaut ferait passer l'amulette pour un objet rangé. Dans
l'inventaire mesuré, exactement une pile est dans ce cas.

**Fichiers :**
- Modifier : `src/hdv/trames.js`, fonction `lirePile`
- Créer : `test/fixtures/pda-archi-ivx-inventaire.hex`
- Créer : `test/pda-archi-trames.test.js`

**C'EST LA SEULE TÂCHE QUI TOUCHE LE TERRITOIRE D'UN AUTRE.** `src/hdv/trames.js`
est le fichier d'Alexis, il y travaille en ce moment. La modification est
volontairement additive, trois lignes qui n'enlèvent rien, donc un rebase ne
devrait pas se battre. **Pousser cette tâche tout de suite après son commit**
plutôt que d'attendre la fin : c'est ce qui évite qu'Alexis découvre le
changement dans un rebase.

- [ ] **Étape 1 : copier la fixture**

```bash
cp C:/Users/jibef/labo-chasse/pda-archi-ivx-inventaire.hex test/fixtures/
```

- [ ] **Étape 2 : écrire le test qui échoue**

Créer `test/pda-archi-trames.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFrameRaw } = require('../src/codec/rawProto');
const { lireStock, POSITION_INVENTAIRE } = require('../src/hdv/trames');

const fixture = (nom) => decodeFrameRaw(
  Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures', nom), 'utf8').trim(), 'hex'),
);

// L'inventaire de connexion du 03/09: 471 piles, 454 rangees, 17 portees.
// UNE SEULE pile n'a pas de champ 1 -- l'amulette, position 0. La lire comme
// 63 la ferait passer pour rangee, et le compte tomberait a 455 et 16.
test('lireStock rend la position, et un champ absent vaut 0 et non 63', () => {
  const piles = lireStock(fixture('pda-archi-ivx-inventaire.hex'));
  assert.strictEqual(piles.length, 471);
  assert.strictEqual(piles.filter((p) => p.pos === POSITION_INVENTAIRE).length, 454);
  assert.strictEqual(piles.filter((p) => p.pos !== POSITION_INVENTAIRE).length, 17);
  assert.strictEqual(piles.filter((p) => p.pos === 0).length, 1);
});

// La position 31 est l'emplacement de la pierre d'ame, mesure du 03/09.
test('la pierre d ame portee se trouve en position 31', () => {
  const piles = lireStock(fixture('pda-archi-ivx-inventaire.hex'));
  const portees = piles.filter((p) => p.pos === 31);
  assert.strictEqual(portees.length, 1);
  assert.strictEqual(portees[0].gid, 9687);
  assert.strictEqual(portees[0].uid, 233525940);
  assert.strictEqual(portees[0].qte, 47);
});
```

- [ ] **Étape 3 : lancer le test, vérifier qu'il échoue**

```bash
node --test test/pda-archi-trames.test.js
```

Attendu : échec, `POSITION_INVENTAIRE` vaut `undefined` et `p.pos` aussi.

- [ ] **Étape 4 : la modification minimale**

Dans `src/hdv/trames.js`, ajouter la constante près de `TAILLES` :

```js
// La position d'une pile. 63 est l'inventaire, c'est-a-dire « pas equipe ».
// LE ZERO PROTOBUF NE S'ECRIT PAS: un champ 1 absent vaut 0, l'amulette, et
// surtout PAS 63. Mesure du 03/09: sur 471 piles, une seule est dans ce cas.
const POSITION_INVENTAIRE = 63;
```

Dans `lirePile`, remplacer la fin de la fonction par :

```js
  const avecEffets = (detail.value || []).some((f) => f.no === 2);
  const p = entier(el.value, 1);
  return { uid, gid, qte, avecEffets, pos: p === null ? 0 : p };
```

Et ajouter `POSITION_INVENTAIRE` aux exports du fichier.

- [ ] **Étape 5 : lancer le test, vérifier qu'il passe**

```bash
node --test test/pda-archi-trames.test.js
```

Attendu : 2 tests, 2 réussites.

- [ ] **Étape 6 : lancer toute la suite**

```bash
npm test
```

Attendu : 0 échec. `lireStock` gagne un champ, et aucun test existant ne
compare les piles par égalité profonde, donc rien ne doit casser. Si quelque
chose casse, c'est un vrai signal : lire l'échec, ne pas le contourner.

- [ ] **Étape 7 : commit**

```bash
git add src/hdv/trames.js test/pda-archi-trames.test.js test/fixtures/pda-archi-ivx-inventaire.hex
git commit -m "feat(hdv): la pile d inventaire porte sa position d equipement"
```

---

### Tâche 2 : choisir la pierre

La fonction pure qui décide. Niveau max du groupe et piles d'inventaire en
entrée, un seul verdict en sortie.

**Fichiers :**
- Créer : `src/pda-archi/pierres.js`
- Créer : `test/pda-archi-pierres.test.js`

- [ ] **Étape 1 : écrire les tests qui échouent**

Créer `test/pda-archi-pierres.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { tranche, choisir, POSITION_PIERRE } = require('../src/pda-archi/pierres');

const pile = (gid, uid, qte, pos = 63) => ({ gid, uid, qte, pos, avecEffets: false });

test('la tranche est la plus petite pierre qui couvre le niveau', () => {
  assert.strictEqual(tranche(1).gid, 9686);
  assert.strictEqual(tranche(20).gid, 9686);
  assert.strictEqual(tranche(21).gid, 9687);
  assert.strictEqual(tranche(50).gid, 9687);
  assert.strictEqual(tranche(51).gid, 9688);
  assert.strictEqual(tranche(100).gid, 9688);
  assert.strictEqual(tranche(101).gid, 9689);
  assert.strictEqual(tranche(150).gid, 9689);
  assert.strictEqual(tranche(151).gid, 9690);
  assert.strictEqual(tranche(190).gid, 9690);
});

// La Gargantuesque est ecartee: c'est le combat final d'une chasse, il se
// prepare a la main.
test('au-dela de 190 aucune tranche ne repond', () => {
  assert.strictEqual(tranche(191), null);
  assert.strictEqual(tranche(230), null);
});

test('un niveau absurde ne repond pas non plus', () => {
  assert.strictEqual(tranche(0), null);
  assert.strictEqual(tranche(-1), null);
  assert.strictEqual(tranche(null), null);
});

test('la pierre presente en inventaire est celle a equiper', () => {
  const piles = [pile(9688, 111, 40), pile(9686, 222, 89)];
  assert.deepStrictEqual(choisir({ niveauMax: 90, piles }), {
    quoi: 'equiper', gid: 9688, uid: 111, qte: 40,
  });
});

// Le cas nominal: une pierre est deja portee, c'est un remplacement.
test('une autre pierre deja portee ne change rien a la decision', () => {
  const piles = [pile(9687, 333, 47, POSITION_PIERRE), pile(9688, 111, 40)];
  assert.deepStrictEqual(choisir({ niveauMax: 90, piles }), {
    quoi: 'equiper', gid: 9688, uid: 111, qte: 40,
  });
});

test('la bonne pierre deja portee n appelle aucun ordre', () => {
  const piles = [pile(9688, 111, 40, POSITION_PIERRE)];
  assert.deepStrictEqual(choisir({ niveauMax: 90, piles }), { quoi: 'deja', gid: 9688 });
});

// JAMAIS DE REMPLACEMENT PAR LA TRANCHE DU DESSUS. Une Enorme capturerait bien
// un monstre de niveau 90, mais elle vaut plus cher que la capture ne rapporte.
// Decision de Jibef le 03/09.
test('la tranche du dessus ne remplace jamais la tranche manquante', () => {
  const piles = [pile(9689, 444, 11)];
  assert.deepStrictEqual(choisir({ niveauMax: 90, piles }), {
    quoi: 'manque', gid: 9688, nom: 'Grande pierre d ame',
  });
});

test('un niveau hors portee ne fait rien et le dit', () => {
  const piles = [pile(9690, 555, 3)];
  assert.deepStrictEqual(choisir({ niveauMax: 200, piles }), {
    quoi: 'hors-portee', niveauMax: 200,
  });
});

// Une pierre PLEINE porte des effets: ce n'est pas une pierre vide.
test('une pierre a effets ne compte pas comme une pierre vide', () => {
  const piles = [{ gid: 9688, uid: 111, qte: 1, pos: 63, avecEffets: true }];
  assert.deepStrictEqual(choisir({ niveauMax: 90, piles }), {
    quoi: 'manque', gid: 9688, nom: 'Grande pierre d ame',
  });
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

```bash
node --test test/pda-archi-pierres.test.js
```

Attendu : échec, `Cannot find module '../src/pda-archi/pierres'`.

- [ ] **Étape 3 : écrire le module**

Créer `src/pda-archi/pierres.js` :

```js
'use strict';

// La table des pierres d'ame, et le choix. Fonction pure: ni trame, ni reseau,
// ni disque.
//
// Conception: docs/superpowers/specs/2026-09-03-pda-archi-design.md.
//
// LES NIVEAUX NE SONT PAS DEVINES. Ils viennent du champ niveau des objets du
// jeu, typeId 83, et disent le PLAFOND de capture: une pierre prend tout ce
// qui est inferieur ou egal a son niveau.
//
// LA GARGANTUESQUE (gid 9718) N'EST PAS DANS LA TABLE, volontairement: c'est
// le combat final d'une chasse, il se prepare a la main.
const PIERRES = [
  { gid: 9686, niveau: 20, nom: 'Petite pierre d ame' },
  { gid: 9687, niveau: 50, nom: 'Moyenne pierre d ame' },
  { gid: 9688, niveau: 100, nom: 'Grande pierre d ame' },
  { gid: 9689, niveau: 150, nom: 'Enorme pierre d ame' },
  { gid: 9690, niveau: 190, nom: 'Gigantesque pierre d ame' },
];

// L'emplacement d'equipement d'une pierre d'ame, mesure le 03/09: poser une
// pile en 31 renvoie en inventaire celle qui s'y trouvait.
const POSITION_PIERRE = 31;

// La plus petite pierre qui couvre le niveau, ou null.
function tranche(niveauMax) {
  const n = Number(niveauMax);
  if (!Number.isFinite(n) || n <= 0) return null;
  return PIERRES.find((p) => n <= p.niveau) || null;
}

// LE VERDICT EST UN SEUL OBJET, jamais une exception ni un null nu: chacun des
// quatre cas doit pouvoir s'afficher tel quel dans le panneau.
//
// JAMAIS DE REMPLACEMENT PAR LA TRANCHE DU DESSUS. Une pierre plus grande
// capturerait bien un monstre plus faible, la regle du jeu etant « inferieur ou
// egal », mais elle vaut plus cher que ce que la capture rapporte. Decision de
// Jibef le 2026-09-03.
function choisir({ niveauMax, piles }) {
  const voulue = tranche(niveauMax);
  if (voulue === null) return { quoi: 'hors-portee', niveauMax };

  // Une pierre PLEINE porte des lignes d'effets: l'equiper ne capturerait rien.
  const siennes = (piles || []).filter((p) => p.gid === voulue.gid && !p.avecEffets);
  const portee = siennes.find((p) => p.pos === POSITION_PIERRE);
  if (portee !== undefined) return { quoi: 'deja', gid: voulue.gid };

  // La plus grosse pile d'abord: c'est celle qui tiendra le plus de captures.
  const rangee = siennes.filter((p) => p.pos !== POSITION_PIERRE)
    .sort((a, b) => (b.qte - a.qte) || (a.uid - b.uid))[0];
  if (rangee === undefined) return { quoi: 'manque', gid: voulue.gid, nom: voulue.nom };

  return { quoi: 'equiper', gid: voulue.gid, uid: rangee.uid, qte: rangee.qte };
}

module.exports = { PIERRES, POSITION_PIERRE, tranche, choisir };
```

- [ ] **Étape 4 : lancer, vérifier que ça passe**

```bash
node --test test/pda-archi-pierres.test.js
```

Attendu : 9 tests, 9 réussites.

- [ ] **Étape 5 : commit**

```bash
git add src/pda-archi/pierres.js test/pda-archi-pierres.test.js
git commit -m "feat(chasse): la table des pierres d ame et le choix de la tranche"
```

---

### Tâche 3 : lire les groupes de monstres, construire l'ordre

**Fichiers :**
- Créer : `src/pda-archi/trames.js`
- Créer : `test/fixtures/pda-archi-jss-groupes.hex`
- Modifier : `test/pda-archi-trames.test.js`

Ce que la mesure du 03/09 a donné, et qui fixe les chemins :

```
jss payload
  5 (repete) = un acteur
    3 = son identifiant, NEGATIF pour un groupe de monstres
    2.1.4 = les infos de groupe, absentes chez un joueur
      2 = le bloc des monstres, un sous-message par monstre:
            { 1 = identifiant du monstre, 2 = NIVEAU, 4 = grade }
```

Le bloc mélange deux numéros de champ : le 2 est la créature qui mène le
groupe, le 1 les autres, répété. **On ne fait pas la différence**, la règle ne
demande que le maximum, donc on lit toutes les entrées du bloc.

- [ ] **Étape 1 : copier la fixture**

```bash
cp C:/Users/jibef/labo-chasse/jss-groupes-monstres.hex test/fixtures/pda-archi-jss-groupes.hex
```

- [ ] **Étape 2 : ajouter les tests qui échouent**

Ajouter en tête de `test/pda-archi-trames.test.js`, à côté des autres `require` :

```js
const { encodeRaw, WIRE } = require('../src/codec/rawProto');
const {
  lireGroupes, lireGroupeAttaque, lirePosition, trameEquiper,
} = require('../src/pda-archi/trames');
```

Puis à la fin du fichier :

```js
// La carte de mesure du 03/09 portait deux groupes. Le -20000 est celui que
// Jibef a attaque: deux Black Wabbit de niveau 46. Le -20001 en portait quatre,
// dont un Black Wabbit de niveau 50 qui menait le groupe.
test('lireGroupes rend les deux groupes de la carte mesuree', () => {
  const groupes = lireGroupes(fixture('pda-archi-jss-groupes.hex'));
  assert.strictEqual(groupes.size, 2);
  assert.strictEqual(groupes.get(-20000).niveauMax, 46);
  assert.strictEqual(groupes.get(-20000).monstres, 2);
  assert.strictEqual(groupes.get(-20001).niveauMax, 50);
  assert.strictEqual(groupes.get(-20001).monstres, 4);
});

test('le joueur n est pas un groupe de monstres', () => {
  const groupes = lireGroupes(fixture('pda-archi-jss-groupes.hex'));
  assert.strictEqual(groupes.has(677158453542), false);
});

// kmu { 2 = identifiant du groupe } arrive au demarrage du combat.
test('lireGroupeAttaque lit l identifiant du groupe dans kmu', () => {
  const frame = { type: 'kmu', payload: [{ no: 2, wire: WIRE.VARINT, value: -20000n }] };
  assert.strictEqual(lireGroupeAttaque(frame), -20000);
});

test('lireGroupeAttaque ignore une autre trame et un kmu vide', () => {
  assert.strictEqual(lireGroupeAttaque({ type: 'kmk', payload: [] }), null);
  assert.strictEqual(lireGroupeAttaque({ type: 'kmu', payload: [] }), null);
});

// ivq { 1 = uid, 2 = nouvelle position } confirme le deplacement en 40 ms.
test('lirePosition lit la confirmation ivq', () => {
  const frame = { type: 'ivq', payload: [
    { no: 1, wire: WIRE.VARINT, value: 233526404n },
    { no: 2, wire: WIRE.VARINT, value: 31n },
  ] };
  assert.deepStrictEqual(lirePosition(frame), { uid: 233526404, pos: 31 });
});

test('lirePosition rend null sur autre chose', () => {
  assert.strictEqual(lirePosition({ type: 'ivj', payload: [] }), null);
});

// L'ordre mesure le 03/09: iuk { 1 = quantite, 2 = uid, 3 = position }.
// Le client deplace la PILE ENTIERE quand il equipe, pas une unite.
test('trameEquiper reproduit l ordre mesure', () => {
  const octets = trameEquiper({ uid: 233526404, qte: 89, position: 31 });
  const attendu = encodeRaw([
    { no: 2, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: 'type.ankama.com/iuk' },
        { no: 2, wire: WIRE.LEN, kind: 'message', value: [
          { no: 1, wire: WIRE.VARINT, value: 89n },
          { no: 2, wire: WIRE.VARINT, value: 233526404n },
          { no: 3, wire: WIRE.VARINT, value: 31n },
        ] },
      ] },
      { no: 2, wire: WIRE.VARINT, value: -1n },
    ] },
  ]);
  assert.deepStrictEqual(octets, attendu);
});
```

- [ ] **Étape 3 : lancer, vérifier l'échec**

```bash
node --test test/pda-archi-trames.test.js
```

Attendu : échec, `Cannot find module '../src/pda-archi/trames'`.

- [ ] **Étape 4 : écrire le module**

Créer `src/pda-archi/trames.js` :

```js
'use strict';
const { encodeRaw, decodeRaw, WIRE } = require('../codec/rawProto');

// Les trames de la chasse: ce qu'on emet, ce qu'on lit.
//
// Mesure du 2026-09-03, journal-chasse1.log. La requete construite ici
// reproduit celle que le jeu emet quand on equipe a la main.
//
// Fonctions pures: ni Electron, ni Frida, ni reseau.

// La meme enveloppe que src/hdv/trames.js: request { content: Any{ type_url,
// value }, uid: -1 }.
const v = (no, valeur) => ({ no, wire: WIRE.VARINT, value: BigInt(valeur) });

function requete(type, champs) {
  const contenu = [{ no: 1, wire: WIRE.LEN, kind: 'string', value: `type.ankama.com/${type}` }];
  if (champs.length > 0) contenu.push({ no: 2, wire: WIRE.LEN, kind: 'message', value: champs });
  return encodeRaw([
    { no: 2, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: contenu },
      { no: 2, wire: WIRE.VARINT, value: -1n },
    ] },
  ]);
}

// iuk { 1: quantite, 2: uid de la pile, 3: position }
//
// LE CLIENT DEPLACE LA PILE ENTIERE quand il equipe, pas une unite: mesure du
// 03/09, une pile de 89 s'equipe en un seul ordre a 89.
//
// LE SERVEUR DESEQUIPE TOUT SEUL. Poser une pile en 31 renvoie en 63 celle qui
// s'y trouvait, sans qu'on ait rien a demander: un ordre suffit.
function trameEquiper({ uid, qte, position }) {
  return requete('iuk', [v(1, qte), v(2, uid), v(3, position)]);
}

const champ = (payload, no) => (payload || []).find((f) => f.no === no) || null;
const tous = (payload, no) => (payload || []).filter((f) => f.no === no);

function entier(payload, no) {
  const f = champ(payload, no);
  if (f === null || f.wire !== WIRE.VARINT) return null;
  return Number(f.value);
}

// UN CHAMP LEN EST AMBIGU PAR CONSTRUCTION, et rawProto.js le rappelle: une
// chaine, un sous-message et une suite d'octets sont indiscernables sans
// schema, donc le decodeur DEVINE. Un sous-message peut tres bien revenir en
// 'bytes'. On redecode alors nous-memes plutot que de croire le kind, et c'est
// exactement le piege qui avait fait refuser a tort des chemins de deplacement.
function sousMessage(f) {
  if (f === null || f === undefined) return null;
  if (Array.isArray(f.value)) return f.value;
  if (Buffer.isBuffer(f.value)) {
    try {
      const d = decodeRaw(f.value);
      return d.length > 0 ? d : null;
    } catch (e) { return null; }
  }
  return null;
}

// ivq { 1: uid, 2: nouvelle position } est la confirmation d'un deplacement,
// rendue en 40 ms a la mesure. C'est elle qu'on attend, pas un delai.
function lirePosition(frame) {
  if (!frame || frame.type !== 'ivq') return null;
  const uid = entier(frame.payload, 1);
  const pos = entier(frame.payload, 2);
  if (uid === null || pos === null) return null;
  return { uid, pos };
}

// kmu { 2: identifiant du groupe attaque } arrive au demarrage du combat.
function lireGroupeAttaque(frame) {
  if (!frame || frame.type !== 'kmu') return null;
  return entier(frame.payload, 2);
}

// jss, la liste des acteurs de la carte. Voir le plan pour les chemins.
//
// LE NIVEAU EST DANS LA TRAME. Aucune donnee de reference n'est necessaire:
// verifie le 03/09 contre DofusDB sur quatre monstres, exact au niveau pres.
//
// LE BLOC MELANGE DEUX NUMEROS DE CHAMP: le 2 est la creature qui mene le
// groupe, le 1 les autres, repete. On ne fait pas la difference, la regle ne
// demande que le maximum, donc on lit toutes les entrees.
function lireGroupes(frame) {
  const groupes = new Map();
  if (!frame || frame.type !== 'jss') return groupes;
  for (const acteur of tous(frame.payload, 5)) {
    const a = sousMessage(acteur);
    if (a === null) continue;
    const id = entier(a, 3);
    // UN IDENTIFIANT POSITIF EST UN JOUEUR, et il n'a pas d'infos de groupe.
    if (id === null || id >= 0) continue;
    const bloc = sousMessage(champ(
      sousMessage(champ(sousMessage(champ(sousMessage(champ(a, 2)), 1)), 4)), 2,
    ));
    if (bloc === null) continue;
    let niveauMax = 0;
    let monstres = 0;
    for (const f of bloc) {
      const m = sousMessage(f);
      const niveau = entier(m, 2);
      if (entier(m, 1) === null || niveau === null) continue;
      monstres += 1;
      if (niveau > niveauMax) niveauMax = niveau;
    }
    if (monstres > 0) groupes.set(id, { niveauMax, monstres });
  }
  return groupes;
}

module.exports = { trameEquiper, lirePosition, lireGroupeAttaque, lireGroupes };
```

- [ ] **Étape 5 : lancer, vérifier que ça passe**

```bash
node --test test/pda-archi-trames.test.js
```

Attendu : 9 tests, 9 réussites. Si `lireGroupes` rend une Map vide, le
coupable est presque toujours `sousMessage` : vérifier que `decodeRaw` est bien
importé et que les champs en `bytes` sont redécodés.

- [ ] **Étape 6 : commit**

```bash
git add src/pda-archi/trames.js test/pda-archi-trames.test.js test/fixtures/pda-archi-jss-groupes.hex
git commit -m "feat(chasse): lire les groupes de monstres et construire l ordre d equipement"
```

---

### Tâche 4 : le module branché

L'écoute, la décision, l'ordre, l'attente de confirmation. Même forme que
`creerVente` : une fabrique qui rend `{ onTrame, ... }`, et un double du
superviseur dans les tests.

**Fichiers :**
- Créer : `src/pda-archi/chasse.js`
- Créer : `test/pda-archi.test.js`

- [ ] **Étape 1 : écrire les tests qui échouent**

Créer `test/pda-archi.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFrameRaw, WIRE } = require('../src/codec/rawProto');
const { creerPdaArchi } = require('../src/pda-archi/chasse');
const { POSITION_PIERRE } = require('../src/pda-archi/pierres');

const fixture = (nom) => decodeFrameRaw(
  Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures', nom), 'utf8').trim(), 'hex'),
);

// Un double du superviseur, comme dans hdv-vente.test.js: il retient ce qu'on
// lui demande d'emettre au lieu d'ouvrir une socket.
function doubleSuperviseur(pid = 42, etat = { nom: 'Iop' }) {
  return {
    comptes: new Map([[pid, etat]]),
    envois: [],
    emettre(p, octets) { this.envois.push({ pid: p, octets }); return { ok: true }; },
  };
}

const kmu = (id) => ({ type: 'kmu', payload: [{ no: 2, wire: WIRE.VARINT, value: BigInt(id) }] });
const ivq = (uid, pos) => ({ type: 'ivq', payload: [
  { no: 1, wire: WIRE.VARINT, value: BigInt(uid) },
  { no: 2, wire: WIRE.VARINT, value: BigInt(pos) },
] });

// Une carte fabriquee: un groupe qui porte un seul monstre du niveau demande.
function jssNiveau(niveau, idGroupe = -300) {
  const monstre = { no: 1, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.VARINT, value: 65n },
    { no: 2, wire: WIRE.VARINT, value: BigInt(niveau) },
    { no: 4, wire: WIRE.VARINT, value: 1n },
  ] };
  return { type: 'jss', payload: [
    { no: 5, wire: WIRE.LEN, kind: 'message', value: [
      { no: 2, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'message', value: [
          { no: 4, wire: WIRE.LEN, kind: 'message', value: [
            { no: 2, wire: WIRE.LEN, kind: 'message', value: [monstre] },
          ] },
        ] },
      ] },
      { no: 3, wire: WIRE.VARINT, value: BigInt(idGroupe) },
    ] },
  ] };
}

// L'inventaire mesure porte la Moyenne (9687) en position 31, la Grande (9688,
// uid 233526391) et l'Enorme (9689) rangees, et AUCUNE Gigantesque.
function monte({ actif = true } = {}) {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const chasse = creerPdaArchi({
    superviseur, actif, onCompteRendu: (r) => rendus.push(r),
  });
  chasse.onTrame({ pid: 42, dir: 'in', frame: fixture('pda-archi-ivx-inventaire.hex') });
  chasse.onTrame({ pid: 42, dir: 'in', frame: fixture('pda-archi-jss-groupes.hex') });
  return { superviseur, chasse, rendus };
}

// Le groupe -20000 de la carte mesuree est de niveau 46, couvert par la Moyenne
// qui est deja portee: rien a faire.
test('la bonne pierre deja portee n envoie aucun ordre', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-20000) });
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.at(-1).quoi, 'deja');
});

test('un groupe inconnu ne fait rien et le dit', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-99999) });
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.at(-1).quoi, 'groupe-inconnu');
});

test('eteinte, la chasse ne fait rien du tout', () => {
  const { superviseur, chasse, rendus } = monte({ actif: false });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-20000) });
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.length, 0);
});

test('un niveau 90 fait equiper la Grande pierre et attend la confirmation', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(90) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  assert.strictEqual(superviseur.envois.length, 1);
  assert.strictEqual(rendus.at(-1).quoi, 'envoye');
  assert.strictEqual(rendus.at(-1).gid, 9688);
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivq(233526391, POSITION_PIERRE) });
  assert.strictEqual(rendus.at(-1).quoi, 'equipe');
  assert.strictEqual(rendus.at(-1).gid, 9688);
});

test('une confirmation sur un autre uid ne conclut rien', () => {
  const { chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(90) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivq(999999, POSITION_PIERRE) });
  assert.strictEqual(rendus.at(-1).quoi, 'envoye');
});

// Jibef n'a aucune Gigantesque: un groupe de niveau 160 doit dire le manque.
test('sans la pierre de la tranche, rien n est envoye et le manque est dit', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(160) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.at(-1).quoi, 'manque');
  assert.strictEqual(rendus.at(-1).gid, 9690);
});

test('un niveau au-dela de 190 ne fait rien et le dit', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(200) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.at(-1).quoi, 'hors-portee');
});

// Une trame SORTANTE ne doit jamais declencher: le client emet lui aussi des
// choses qu'on ne lit qu'en entree.
test('une trame sortante est ignoree', () => {
  const { superviseur, chasse } = monte();
  chasse.onTrame({ pid: 42, dir: 'out', frame: kmu(-20000) });
  assert.strictEqual(superviseur.envois.length, 0);
});
```

- [ ] **Étape 2 : lancer, vérifier l'échec**

```bash
node --test test/pda-archi.test.js
```

Attendu : échec, `Cannot find module '../src/pda-archi/chasse'`.

- [ ] **Étape 3 : écrire le module**

Créer `src/pda-archi/chasse.js` :

```js
'use strict';
const { lireStock } = require('../hdv/trames');
const { choisir, POSITION_PIERRE } = require('./pierres');
const { trameEquiper, lirePosition, lireGroupeAttaque, lireGroupes } = require('./trames');

// La chasse a l'archimonstre: equiper la bonne pierre d'ame, et rien d'autre.
//
// Conception: docs/superpowers/specs/2026-09-03-pda-archi-design.md.
//
// CE QUI REND LA FONCTION SIMPLE, c'est qu'on peut changer d'equipement en
// PHASE DE PREPARATION: verifie en jeu le 03/09. On declenche donc sur l'entree
// en combat, pas sur la lecture de la carte avant l'attaque, et il n'y a jamais
// besoin de reconnaitre un archimonstre, le combat est deja le sien, puisque
// c'est l'utilisateur qui l'a lance.
//
// LA FENETRE EST LARGE: 18 secondes de preparation mesurees, ordre confirme en
// 40 ms. Aucun rythme a etaler, aucun delai a menager, contrairement a l'hotel
// de vente.
//
// L'INTERRUPTEUR N'EST PAS UN CONFORT. Une pierre d'ame capture aussi les
// monstres ordinaires: allumee en permanence, la chasse remplirait des Enormes
// pierres avec des Bouftous.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme.
function creerPdaArchi({ superviseur, actif = false, onCompteRendu = () => {} }) {
  // Ce que l'ecoute permanente retient, par client.
  const stocks = new Map();   // pid -> [pile]
  const cartes = new Map();   // pid -> Map(idGroupe -> { niveauMax, monstres })
  const attentes = new Map(); // pid -> { uid, gid }

  let allume = actif === true;

  function armer(valeur) {
    allume = valeur === true;
    if (!allume) attentes.clear();
  }

  const nomDe = (pid) => {
    const etat = superviseur.comptes.get(pid);
    return etat && etat.nom ? etat.nom : String(pid);
  };

  // LA CLE S'APPELLE `compte`, PAS `nom`: `choisir` rend deja un `nom`, celui
  // de la pierre qui manque, et l'etalement ci-dessous l'ecraserait.
  const rendre = (pid, rendu) => onCompteRendu({ pid, compte: nomDe(pid), ...rendu });

  function entrerEnCombat(pid, idGroupe) {
    const carte = cartes.get(pid);
    const groupe = carte === undefined ? undefined : carte.get(idGroupe);
    // UN GROUPE INCONNU N'EQUIPE RIEN. La liste des acteurs arrive a l'arrivee
    // sur la carte; un groupe qui n'y est pas est un trou dans ce qu'on sait,
    // pas une invitation a deviner.
    if (groupe === undefined) { rendre(pid, { quoi: 'groupe-inconnu', idGroupe }); return; }

    const verdict = choisir({ niveauMax: groupe.niveauMax, piles: stocks.get(pid) || [] });
    if (verdict.quoi !== 'equiper') {
      rendre(pid, { ...verdict, niveauMax: groupe.niveauMax });
      return;
    }

    const res = superviseur.emettre(pid, trameEquiper({
      uid: verdict.uid, qte: verdict.qte, position: POSITION_PIERRE,
    }));
    if (res === null || res === undefined || res.ok !== true) {
      rendre(pid, { quoi: 'echec', gid: verdict.gid, niveauMax: groupe.niveauMax });
      return;
    }
    attentes.set(pid, { uid: verdict.uid, gid: verdict.gid });
    rendre(pid, { quoi: 'envoye', gid: verdict.gid, niveauMax: groupe.niveauMax });
  }

  function onTrame({ pid, dir, frame }) {
    if (frame === null || frame === undefined || dir !== 'in') return;

    // L'ECOUTE PERMANENTE TOURNE MEME ETEINTE. Elle ne coute que de la memoire,
    // et sans elle allumer l'interrupteur devant un combat n'aurait aucun effet
    // avant le prochain changement de carte.
    if (frame.type === 'ivx' || frame.type === 'iwb') {
      const piles = lireStock(frame);
      // Une trame qui ne rend aucune pile n'efface pas ce qu'on sait.
      if (piles.length > 0) stocks.set(pid, piles);
      return;
    }

    if (frame.type === 'jss') {
      const groupes = lireGroupes(frame);
      // La carte REMPLACE la precedente: un groupe tue n'a pas a survivre.
      if (groupes.size > 0) cartes.set(pid, groupes);
      return;
    }

    // LA POSITION SE SUIT EN CONTINU, allumee ou non: c'est ce qui evite de
    // reequiper au combat suivant une pierre deja en place.
    if (frame.type === 'ivq') {
      const maj = lirePosition(frame);
      if (maj === null) return;
      const piles = stocks.get(pid);
      if (piles !== undefined) {
        const pile = piles.find((p) => p.uid === maj.uid);
        if (pile !== undefined) pile.pos = maj.pos;
      }
      const attente = attentes.get(pid);
      if (allume && attente !== undefined && attente.uid === maj.uid
          && maj.pos === POSITION_PIERRE) {
        attentes.delete(pid);
        rendre(pid, { quoi: 'equipe', gid: attente.gid });
      }
      return;
    }

    if (!allume) return;

    if (frame.type === 'kmu') {
      const idGroupe = lireGroupeAttaque(frame);
      if (idGroupe !== null) entrerEnCombat(pid, idGroupe);
    }
  }

  return { onTrame, armer, estAllume: () => allume };
}

module.exports = { creerPdaArchi };
```

- [ ] **Étape 4 : lancer, vérifier que ça passe**

```bash
node --test test/pda-archi.test.js
```

Attendu : 9 tests, 9 réussites. Si `la bonne pierre deja portee` échoue, lire
d'abord ce que rend `choisir` : l'inventaire mesuré porte la Moyenne en
position 31 et le groupe -20000 est de niveau 46, donc le verdict attendu est
bien `deja`.

- [ ] **Étape 5 : la suite complète**

```bash
npm test
```

Attendu : 0 échec.

- [ ] **Étape 6 : commit**

```bash
git add src/pda-archi/chasse.js test/pda-archi.test.js
git commit -m "feat(chasse): equiper la pierre a l entree en combat"
```

---

### Tâche 5 : la dixième fonction verrouillable et l'interrupteur

**Fichiers :**
- Modifier : `src/droits/liste.js`
- Modifier : `serveur-maj/lib/fonctions.js`
- Modifier : `src/comptes/favoris.js`

Un test existant compare les deux listes de fonctions, celle de l'application
et celle du panneau d'administration. **Modifier une seule des deux le fera
échouer**, et c'est exactement son rôle.

- [ ] **Étape 1 : retrouver ce test avant de toucher quoi que ce soit**

```bash
grep -rln "fonctions" test/
```

- [ ] **Étape 2 : ajouter la fonction des deux côtés**

Dans `src/droits/liste.js`, juste après la ligne `vente` :

```js
  { nom: 'chasse', libelle: 'chasse a l archimonstre, pierre d ame equipee' },
```

Puis la même entrée, à la même place, dans `serveur-maj/lib/fonctions.js`.

- [ ] **Étape 3 : lancer la suite**

```bash
npm test
```

Attendu : 0 échec. Un échec sur la comparaison des deux listes veut dire qu'une
seule des deux a été modifiée.

- [ ] **Étape 4 : la clé de réglage**

Cinq retouches dans `src/comptes/favoris.js`, aux mêmes endroits que la clé
`overlay` déjà présente.

Près de `this._overlay = { ... };` (ligne 79 environ), la déclaration :

```js
    // La chasse part ETEINTE chez qui n'a jamais ouvert le fichier, et c'est
    // voulu: une pierre d'ame capture aussi les monstres ordinaires.
    this._chasse = false;
```

Au chargement, près de `if (json.overlay !== null ...)` (ligne 146 environ) :

```js
      if (typeof json.chasse === 'boolean') this._chasse = json.chasse;
```

Dans la remise à zéro, près de la seconde occurrence de `this._overlay = { ... }`
(ligne 167 environ) :

```js
      this._chasse = false;
```

Les deux accesseurs, juste après `reglerOverlay` :

```js
  chasse() {
    return this._chasse;
  }

  marquerChasse(actif) {
    this._chasse = actif === true;
    this._ecrire();
  }
```

Et la clé dans `_ecrire`, après `overlay: this.overlay(),` :

```js
        chasse: this._chasse,
```

**La chasse part éteinte chez qui n'a jamais ouvert le fichier**, c'est le
comportement voulu et pas un oubli.

- [ ] **Étape 5 : lancer la suite**

```bash
npm test
```

Attendu : 0 échec.

- [ ] **Étape 6 : commit**

```bash
git add src/droits/liste.js serveur-maj/lib/fonctions.js src/comptes/favoris.js
git commit -m "feat(chasse): la fonction verrouillable et l interrupteur enregistre"
```

---

### Tâche 6 : le branchement dans l'application

**Fichiers :**
- Modifier : `desktop/main.js`

- [ ] **Étape 1 : déclarer le module**

En tête de fichier, à côté de `creerVente` :

```js
const { creerPdaArchi } = require('../src/pda-archi/chasse');
```

Et près de `let vente = null;` :

```js
// La chasse a l'archimonstre. Declaree ici comme la vente: le panneau lit son
// etat, et la perte du droit doit pouvoir la desarmer.
let chasse = null;
```

- [ ] **Étape 2 : construire, juste après `vente = creerVente({...})`**

```js
  chasse = creerPdaArchi({
    superviseur,
    actif: favoris.chasse(),
    onCompteRendu: (r) => {
      if (r.quoi === 'equipe') {
        journal(r.pid, `chasse : pierre ${r.gid} equipee`);
        messages.delete(r.pid);
        return;
      }
      if (r.quoi === 'deja' || r.quoi === 'envoye') {
        journal(r.pid, `chasse : ${r.quoi} ${r.gid}`);
        return;
      }
      // LES CAS OU LA CAPTURE EST IMPOSSIBLE, ET EUX SEULS, remontent au
      // panneau et font biper: c'est pendant la preparation qu'on les regarde,
      // et a ce moment-la on regarde le jeu, pas OMNI.
      const textes = {
        manque: `chasse : pas de ${r.nom || 'pierre'} pour du niveau ${r.niveauMax}`,
        'hors-portee': `chasse : niveau ${r.niveauMax}, aucune pierre ne couvre`,
        'groupe-inconnu': 'chasse : groupe inconnu, rien equipe',
        echec: 'chasse : ordre refuse',
      };
      const texte = textes[r.quoi];
      if (texte === undefined) return;
      journal(r.pid, texte);
      messages.set(r.pid, texte);
      fenetre.webContents.send('chasseAlerte', { pid: r.pid, texte });
    },
  });
```

Dans ce compte rendu, `r.nom` est le nom de la PIERRE qui manque et `r.compte`
celui du personnage : la tâche 4 les a séparés exprès.

- [ ] **Étape 3 : ajouter l'écouteur à la composition**

Dans l'appel à `composer(...)`, juste après `protege('vente', vente.onTrame),` :

```js
    protege('chasse', chasse.onTrame),
```

- [ ] **Étape 4 : désarmer à la perte du droit**

Là où `perdus.includes('vente')` est traité :

```js
      if (perdus.includes('chasse')) chasse.armer(false);
```

- [ ] **Étape 5 : le canal de l'interrupteur**

Sur le modèle du canal de l'overlay déjà présent : un `ipcMain.handle('chasseArmer', ...)`
qui appelle `chasse.armer(valeur)`, puis `favoris.marquerChasse(valeur)`, puis
la sauvegarde. Et exposer `chasse !== null && chasse.estAllume()` dans l'état
envoyé au panneau, à côté de `hdvVenteEnCours`.

- [ ] **Étape 6 : vérifier que l'application démarre**

**NE PAS lancer OMNI depuis la session Claude Code**, la sortie noie le
terminal. Demander à Jibef de lancer le raccourci « OMNI (dev) » et de dire si
la fenêtre s'ouvre sans erreur.

- [ ] **Étape 7 : commit**

```bash
git add desktop/main.js
git commit -m "feat(chasse): brancher la chasse dans l application"
```

---

### Tâche 7 : la case à cocher et le bip

**Fichiers :**
- Modifier : `desktop/preload.js`
- Modifier : `desktop/index.html`

**OMNI n'émet aucun son aujourd'hui, ce serait le premier.** Un bip synthétisé,
sans fichier audio : rien à embarquer, et surtout **rien à ajouter dans
`FICHIERS_DESKTOP` de `outils/faire-etape.js`**, l'oubli silencieux qui a failli
coûter l'overlay.

- [ ] **Étape 1 : exposer les deux canaux dans le preload**

Dans `contextBridge.exposeInMainWorld('app', { ... })`, ajouter les deux
entrées :

```js
  // La chasse a l'archimonstre: l'interrupteur, et l'alerte quand la capture
  // est impossible.
  chasseArmer: (actif) => ipcRenderer.invoke('chasseArmer', actif),
  onChasseAlerte: (rappel) => ipcRenderer.on('chasseAlerte', (_e, a) => rappel(a)),
```

**Le commentaire en tête de `preload.js` est un avertissement, pas une
décoration** : chaque nom exposé ici doit avoir son `ipcMain.handle` dans
`desktop/main.js`, sans quoi le bouton « ne fait rien » et rien ne le signale
au démarrage. `chasseArmer` a été posé à la tâche 6, étape 5. Le vérifier.

- [ ] **Étape 2 : la case à cocher**

Dans `desktop/index.html`, à côté des autres interrupteurs généraux, une case
« Chasse » qui appelle `window.app.chasseArmer(coche)`. **Cyan quand elle est
armée**, c'est la règle de la palette : une couleur, un rôle.

- [ ] **Étape 3 : le bip**

Dans le script de `desktop/index.html` :

```js
// Deux notes basses, distinctes de tout ce que fait Dofus. Synthetisees plutot
// que jouees depuis un fichier: rien a embarquer dans le paquet, donc rien a
// oublier dans FICHIERS_DESKTOP.
let audio = null;
function bip() {
  try {
    if (audio === null) audio = new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const debut = audio.currentTime;
    for (const [rang, hz] of [[0, 330], [1, 247]]) {
      const t = debut + rang * 0.22;
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.2);
    }
  } catch (e) { /* pas de son disponible: l'ecrit suffit */ }
}
```

- [ ] **Étape 4 : ne biper qu'une fois par combat**

```js
// UN SEUL BIP, meme si les quatre comptes sont en defaut au meme combat:
// quatre bips superposes ne disent rien de plus qu'un seul. Le detail par
// compte est deja sur sa ligne.
let dernierBip = 0;
window.app.onChasseAlerte(() => {
  const t = Date.now();
  if (t - dernierBip > 3000) { bip(); dernierBip = t; }
});
```

- [ ] **Étape 5 : vérifier à la main**

Demander à Jibef de lancer « OMNI (dev) », de cocher Chasse, et de vérifier que
la case tient après un redémarrage. Le bip se vérifie en vrai à la tâche 8.

- [ ] **Étape 6 : commit**

```bash
git add desktop/index.html desktop/preload.js
git commit -m "feat(chasse): l interrupteur et l alerte sonore"
```

---

### Tâche 8 : la vérification en jeu

Le seul point que les tests ne peuvent pas couvrir.

- [ ] **Étape 1 : vérifier `kmu` sur plusieurs clients**

`kmu { 2 }` n'a été observé que sur **un seul client**. Rien ne prouve encore
que les quatre reçoivent le même identifiant de groupe. Séance : quatre clients
connectés, chasse allumée, attaquer un groupe, relire le journal.

```powershell
$env:OMNI_DEV = 'C:\Users\jibef\mm'
$env:OMNI_JOURNAL = 'complet'
$env:OMNI_CAPTURE = '1'
$env:OMNI_JOURNAL_FICHIER = 'C:\Users\jibef\mm\journal-chasse2.log'
C:\Users\jibef\mm\desktop\dist\OMNI-win32-x64\OMNI.exe
```

Attendu au journal : une ligne `chasse :` par compte, et la même pierre choisie
partout.

- [ ] **Étape 2 : si les identifiants divergent**

Alors `kmu` porte un identifiant local au client, et il faut se rabattre sur la
trame SORTANTE `hqa { 1 }`, qui nomme le groupe attaqué au moment de l'attaque
et que le duplicateur rejoue sur chaque mule. Le changement se limite alors à
`lireGroupeAttaque` et à la garde `dir !== 'in'` de `onTrame`.

- [ ] **Étape 3 : vérifier le cas du manque**

Jibef n'a **aucune Gigantesque pierre d'âme**. Attaquer un groupe entre 151 et
190 doit donc écrire le manque et faire biper, sans rien équiper.

- [ ] **Étape 4 : reporter et committer**

Reporter ce que la séance donne dans la spec, section « Ce que la séance du
2026-09-03 a donné », puis :

```bash
git add docs/superpowers/specs/2026-09-03-pda-archi-design.md
git commit -m "docs(chasse): la verification en jeu"
```

---

## Le workflow, celui d'Alexis adopté le 2026-09-03

**Pousser la branche dès le premier commit**, pas à la fin. Tristan et Alexis
travaillent sur le même dépôt en même temps : une branche qui n'existe que sur
la machine de Jibef ne prévient personne de ce qui arrive.

```bash
git push -u origin feat/chasse
```

Ensuite un `git push` après chaque tâche. Les tâches sont indépendantes et
chacune laisse la suite verte, donc pousser n'expose jamais un état cassé.

**L'intégration, une fois les huit tâches faites**, dans cet ordre exact :

```bash
git fetch origin
git rebase origin/master          # sur feat/chasse
npm test                          # le rebase peut casser ce qui passait
git push --force-with-lease
git checkout master
git merge feat/chasse             # fast-forward, aucun commit de fusion
git push
git checkout feat/chasse
git rebase master                 # recaler la branche
```

Le `npm test` après le rebase n'est pas dans l'énoncé du workflow, il est
ajouté ici : rejouer ses commits sur un `master` qui a bougé peut très bien
donner un arbre qui ne compile plus, et la fusion se fait sans relecture.

**Deux points restent ouverts avec Tristan et Alexis**, et ce plan ne les
tranche pas :

- **personne ne relit avant la fusion.** La méthode telle qu'énoncée n'a pas de
  Pull Request. Si une relecture est voulue sur cette fonction, c'est à demander
  avant de fusionner, pas après.
- **trois branches entièrement fusionnées traînent sur le distant**
  (`feat/overlay`, `feat/socle-de-lecture`, `ltu`). Ne pas en ajouter une
  quatrième : supprimer `feat/chasse` une fois fusionnée.

```bash
git push origin --delete feat/chasse
```
