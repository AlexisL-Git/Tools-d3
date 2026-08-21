# No-anim « Safe » — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que les combattants apparaissent directement à leur case d'arrivée au lieu de marcher, en traduisant sur le flux descendant les trames `jwe` d'action 300 en trames `jwe` d'action 4.

**Architecture:** Le proxy cesse d'être un simple observateur du flux descendant et devient, **et seulement sur demande**, un transformateur. `createProxy` reçoit un `transformerEntrant` optionnel ; tant qu'il est absent ou rend `null`, `client.write(data)` s'exécute sur les octets d'origine, exactement comme aujourd'hui. La traduction elle-même vit dans `src/noanim.js`, fonction pure testable sans réseau, jumelle de `src/passeur.js` et `src/invitation.js`.

**Tech Stack:** Node ≥ 18 sans dépendance de test (`node --test`), Electron 43 pour l'application, protobuf sans schéma via `src/codec/rawProto.js`, cadrage varint via `src/codec/framing.js`.

## Global Constraints

- **Périmètre : le no-anim « Safe », et lui seul.** L'« Ultra » (suppression des effets visuels de sorts) est hors sujet : la mesure du 21/08 n'a pas réussi à observer ce qu'il fait.
- **Garantie 1 — inerte par défaut.** Tant qu'aucun compte n'a le no-anim actif, le chemin de relais est identique octet pour octet au code d'aujourd'hui. Verrouillé par test.
- **Garantie 2 — au moindre doute, relayer tel quel.** Trame indécodable, type inattendu, champ manquant, exception : les octets d'origine repartent inchangés. Le no-anim dégrade vers « animations normales », jamais vers une connexion cassée. Verrouillé par test.
- **`npm test` est le seul point d'entrée correct.** `node --test test/` échoue pour une autre raison et fait croire à une régression.
- **Aucun chemin ne mène au silence.** Chaque refus de transformer produit un compte rendu portant sa raison. C'est le mode d'échec le plus coûteux du projet : il s'est présenté quatre fois.
- **La frontière IPC est la frontière de confiance.** Tout `idCompte` venant du renderer est validé par `Number.isInteger` avant d'atteindre le fichier de réglages ou l'état du superviseur.
- **`favoris.json` ne contient que des identifiants numériques.** Ni login, ni jeton.
- **Style du dépôt :** commentaires et identifiants en français **sans accents** dans le code source ; les accents sont admis dans les chaînes affichées et la documentation.
- **L'application doit tourner AVANT que les clients Dofus se connectent.** Un client déjà lancé est irrattrapable.
- **Vérifier `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` avant de conclure quoi que ce soit** : un CLI zombie a déjà intercepté les clients à la place de l'application pendant toute une session.
- **Le launcher de krm35 (`jklshdj.exe`) et notre application ne doivent jamais tourner en même temps** sur les mêmes clients : les deux détournent `connect`.

---

### Task 1 : Mesurer la règle de traduction

**Cette tâche ne produit pas de code livré : elle produit des faits.** Les tâches 3 et 4 en dépendent entièrement. Ne pas commencer la tâche 3 avant que la règle soit consignée.

Le spec établit déjà : le champ `14` de `jwe` est le discriminant d'action, l'action 300 est le déplacement animé, l'action 4 est « pose cet acteur sur cette case », la case vient du champ `7.6` et l'acteur du champ `7.2` (ou du champ `3` à défaut). **Ce qui manque : 13 trames retenues ont produit 27 trames fabriquées, et les cases des acteurs secondaires n'apparaissent dans aucun champ identifié.**

**Files:**
- Create: `docs/superpowers/specs/2026-08-21-trames-deplacement-combat.md`

**Interfaces:**
- Consumes: rien.
- Produces: deux faits nommés, repris littéralement par les tâches 3 et 4 — `REGLE_UN_POUR_UN` (confirmée ou infirmée) et `REGLE_MULTI_ACTEURS` (la règle, ou le constat qu'elle reste introuvable).

- [ ] **Step 1 : Vérifier qu'aucun processus parasite ne tourne**

```bash
Get-CimInstance Win32_Process -Filter "Name='node.exe' or Name='electron.exe'"
```
Attendu : aucun `node src/cli/mm.js`, aucune instance de notre application Electron. Notre application ne doit **pas** tourner : c'est le launcher de krm35 qu'on observe.

- [ ] **Step 2 : Relever le pid du proxy de krm35**

```bash
Get-NetTCPConnection -LocalPort 8103 | Select-Object -First 1 OwningProcess
```
Attendu : un pid dont le processus s'appelle `jklshdj.exe`. Le port peut changer d'une session à l'autre ; si 8103 ne répond pas, retrouver le proxy par les connexions du client Dofus :

```bash
Get-NetTCPConnection -OwningProcess <pid Dofus> | Where-Object { $_.RemoteAddress -match '127.0.0.1|::1' }
```

- [ ] **Step 3 : Capturer des déplacements SIMPLES**

Dans le launcher de krm35, activer **No anim Safe** seul. Entrer en combat. Pendant la capture, ne provoquer que de la **marche** : passer son tour et laisser les monstres se déplacer. **Ne lancer aucun sort de poussée ni d'attirance** — c'est tout l'objet de ce passage.

```bash
node src/cli/proxy-tap.js <pid jklshdj> 90 mesure-simple.jsonl tout
```

L'option `tout` est obligatoire : une capture tronquée désynchronise le découpage varint et rend illisible tout ce qui suit sur la socket. La mesure du 20/08 y a perdu 11,4 Mo et une conclusion entièrement fausse en a été tirée.

- [ ] **Step 4 : Aligner les deux flux**

Reprendre le script d'alignement écrit le 21/08. Il compare les trames par contenu et non par index — une insertion décale tout le reste et fait passer 92 trames pour différentes alors qu'une seule l'est.

```js
'use strict';
const fs = require('fs');
const { FrameReassembler } = require('../src/codec/framing');
const { decodeFrameRaw, render } = require('../src/codec/rawProto');

const lignes = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l));

function flux(cle) {
  const r = new FrameReassembler();
  const out = [];
  for (const l of lignes) {
    if (`${l.sock} ${l.dir}` !== cle) continue;
    try { for (const t of r.push(Buffer.from(l.head))) out.push(t); } catch (e) { break; }
  }
  return out;
}

const compte = (ts) => {
  const m = new Map();
  for (const t of ts) { const k = t.toString('hex'); m.set(k, (m.get(k) || 0) + 1); }
  return m;
};

const A = flux(process.argv[3]);   // "<sock> in"  : ce que le proxy recoit du serveur
const B = flux(process.argv[4]);   // "<sock> out" : ce que le client recoit
const ca = compte(A); const cb = compte(B);
const perdues = []; const ajoutees = [];
for (const [k, n] of ca) { for (let i = 0; i < n - (cb.get(k) || 0); i++) perdues.push(k); }
for (const [k, n] of cb) { for (let i = 0; i < n - (ca.get(k) || 0); i++) ajoutees.push(k); }

for (const [titre, liste] of [['RETENUES', perdues], ['FABRIQUEES', ajoutees]]) {
  console.log(`\n########## ${titre} : ${liste.length} ##########`);
  for (const k of liste) {
    const d = decodeFrameRaw(Buffer.from(k, 'hex'));
    console.log(`\n--- ${d && d.type} (${k.length / 2} o)\n    ${k}`);
    if (d && d.payload) console.log(render(d.payload, '      '));
  }
}
```

Les deux clés de socket se lisent dans le tableau récapitulatif imprimé par `proxy-tap.js` : la paire du tunnel de jeu est celle dont les volumes se répondent en croix, marquée `EN CLAIR`.

- [ ] **Step 5 : Établir la règle un-pour-un**

Sur cette capture sans poussée, attendu : **autant de trames fabriquées que de trames retenues**. Pour chaque paire, vérifier les trois points :

1. la retenue porte `14 = 300`, la fabriquée `14 = 4` ;
2. la case de la fabriquée (`35.1`) est égale au champ `7.6` de la retenue ;
3. l'acteur de la fabriquée (`3` et `35.2`) est égal au champ `7.2` de la retenue s'il existe, sinon à son champ `3`.

Si les trois tiennent sur au moins cinq paires, `REGLE_UN_POUR_UN` est **confirmée**. Si l'un tombe, consigner ce qu'on observe à la place : c'est ce fait-là qui compte, pas la confirmation attendue.

- [ ] **Step 6 : Capturer une poussée**

Relancer une capture, et cette fois lancer un sort qui **pousse ou attire** plusieurs combattants.

```bash
node src/cli/proxy-tap.js <pid jklshdj> 90 mesure-poussee.jsonl tout
```

Rejouer l'alignement de l'étape 4. Chercher une trame retenue dont le champ `7.4` est répété plusieurs fois, et les trames fabriquées qui lui correspondent.

- [ ] **Step 7 : Chercher la règle multi-acteurs**

Pour cette trame et ses fabriquées, répondre à une seule question : **d'où sort la case de chaque acteur secondaire ?** Trois pistes, à examiner dans cet ordre :

1. les sous-champs de chaque entrée `7.4` — la mesure du 21/08 y a vu un champ `3` valant 1 ou 2, qui pourrait être un nombre de cases parcourues ;
2. une relation arithmétique avec le champ `7.6` — dans une grille Dofus, les cases voisines diffèrent d'un pas constant ;
3. aucune des deux : la case n'est pas dans la trame, et leur proxy tient un état des positions.

- [ ] **Step 8 : Consigner la mesure**

Écrire `docs/superpowers/specs/2026-08-21-trames-deplacement-combat.md` avec, littéralement : la date, le nombre de paires observées, les octets hexadécimaux d'au moins trois paires retenue/fabriquée, le verdict sur `REGLE_UN_POUR_UN`, et le verdict sur `REGLE_MULTI_ACTEURS`.

Pour le multi-acteurs, nommer explicitement laquelle des trois issues est retenue :

1. **règle trouvée** → l'écrire en toutes lettres, avec les numéros de champ ; la tâche 3 l'implémente ;
2. **règle introuvable** → le dire ; la tâche 3 implémente le repli du spec : toute action 300 portant plus d'un acteur est **relayée sans transformation**, et le journal le dit ;
3. **l'action 300 un-pour-un elle-même ne se confirme pas** → **s'arrêter et le dire à l'utilisateur.** La fonction n'est pas livrable telle qu'elle a été conçue.

- [ ] **Step 9 : Commit**

```bash
git add docs/superpowers/specs/2026-08-21-trames-deplacement-combat.md
git commit -m "mesure: la traduction des trames de deplacement en combat"
```

---

### Task 2 : Le proxy accepte un transformateur, et reste inerte sans lui

**Indépendante de la tâche 1 :** elle ne touche pas à la traduction, seulement au point d'extension. Elle peut être faite avant, pendant ou après.

C'est la tâche qui porte la **garantie 1**. Elle doit être relue avec ça en tête : tant que `transformerEntrant` n'est pas fourni, pas une ligne du chemin de relais actuel ne change de comportement.

**Files:**
- Modify: `src/proxy/server.js:41` (signature) et `:86-89` (le relais descendant)
- Test: `test/proxy.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: `createProxy({ …, transformerEntrant })`. `transformerEntrant(buf, conn) → Buffer | null`. `null` (ou l'absence de la fonction) fait écrire les octets d'origine. Un `Buffer` est écrit à leur place, préfixes de longueur inclus. Toute exception levée par `transformerEntrant` est rattrapée et fait écrire les octets d'origine.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `test/proxy.test.js`, en reprenant `listenEcho` déjà présent en tête de fichier :

```js
// GARANTIE 1: sans transformateur, le proxy relaie le flux descendant octet
// pour octet. C'est la condition posee par l'utilisateur avant d'accepter que
// le proxy touche au chemin critique du jeu.
test('sans transformateur, le flux descendant est relaye tel quel', async () => {
  const { srv, port } = await listenEcho(() => {});
  const proxy = await createProxy({ port: 0 });
  const recu = [];
  await new Promise((resolve) => {
    const c = net.connect(proxy.port, '127.0.0.1', () => {
      c.write(Buffer.from(`CONNECT 127.0.0.1:${port} HTTP/1.0\r\n\r\n`));
      c.write(Buffer.from('bonjour'));
    });
    c.on('data', (d) => { recu.push(d); resolve(); });
  });
  assert.strictEqual(Buffer.concat(recu).toString(), 'R:bonjour');
  proxy.close(); srv.close();
});

test('un transformateur qui rend null laisse passer les octets d origine', async () => {
  const { srv, port } = await listenEcho(() => {});
  const vus = [];
  const proxy = await createProxy({
    port: 0,
    transformerEntrant: (buf) => { vus.push(buf.toString()); return null; },
  });
  const recu = [];
  await new Promise((resolve) => {
    const c = net.connect(proxy.port, '127.0.0.1', () => {
      c.write(Buffer.from(`CONNECT 127.0.0.1:${port} HTTP/1.0\r\n\r\n`));
      c.write(Buffer.from('bonjour'));
    });
    c.on('data', (d) => { recu.push(d); resolve(); });
  });
  assert.strictEqual(Buffer.concat(recu).toString(), 'R:bonjour');
  assert.deepStrictEqual(vus, ['R:bonjour']);
  proxy.close(); srv.close();
});

test('un transformateur qui rend un buffer le substitue', async () => {
  const { srv, port } = await listenEcho(() => {});
  const proxy = await createProxy({
    port: 0,
    transformerEntrant: () => Buffer.from('AUTRE'),
  });
  const recu = [];
  await new Promise((resolve) => {
    const c = net.connect(proxy.port, '127.0.0.1', () => {
      c.write(Buffer.from(`CONNECT 127.0.0.1:${port} HTTP/1.0\r\n\r\n`));
      c.write(Buffer.from('bonjour'));
    });
    c.on('data', (d) => { recu.push(d); resolve(); });
  });
  assert.strictEqual(Buffer.concat(recu).toString(), 'AUTRE');
  proxy.close(); srv.close();
});

// GARANTIE 2: une politique qui leve ne doit pas couper la connexion de jeu.
test('un transformateur qui leve laisse passer les octets d origine', async () => {
  const { srv, port } = await listenEcho(() => {});
  const proxy = await createProxy({
    port: 0,
    transformerEntrant: () => { throw new Error('casse'); },
  });
  const recu = [];
  await new Promise((resolve) => {
    const c = net.connect(proxy.port, '127.0.0.1', () => {
      c.write(Buffer.from(`CONNECT 127.0.0.1:${port} HTTP/1.0\r\n\r\n`));
      c.write(Buffer.from('bonjour'));
    });
    c.on('data', (d) => { recu.push(d); resolve(); });
  });
  assert.strictEqual(Buffer.concat(recu).toString(), 'R:bonjour');
  proxy.close(); srv.close();
});
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

```bash
npm test
```
Attendu : le premier test PASSE déjà (c'est le comportement actuel, et c'est voulu : il fixe la non-régression). Les trois autres ÉCHOUENT — le transformateur est ignoré.

- [ ] **Step 3 : Implémenter**

Dans `src/proxy/server.js`, la signature devient :

```js
function createProxy({ port = 0, host = DEFAULT_HOST, onData = () => {}, onProbleme = () => {}, transformerEntrant = null } = {}) {
```

et le relais descendant (`upstream.on('data', …)`) :

```js
        upstream.on('data', (data) => {
          onData('in', data, conn);
          // Le proxy n'observe le flux descendant que par defaut. Il ne le
          // transforme QUE si on lui a donne de quoi le faire, et il retombe
          // sur les octets d'origine au moindre incident: une erreur de
          // cadrage ici tue la connexion de jeu, la ou une politique qui
          // n'emet rien ne coute qu'une animation.
          let sortie = null;
          if (transformerEntrant !== null) {
            try {
              sortie = transformerEntrant(data, conn);
            } catch (e) {
              onProbleme({ id: conn.id, raison: `transformation en echec: ${e.message}` });
              sortie = null;
            }
          }
          client.write(sortie === null ? data : sortie);
        });
```

- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent**

```bash
npm test
```
Attendu : tous verts.

- [ ] **Step 5 : Commit**

```bash
git add src/proxy/server.js test/proxy.test.js
git commit -m "feat(proxy): point d'extension pour transformer le flux descendant"
```

---

### Task 3 : `src/noanim.js`, la traduction d'une trame

**Dépend de la tâche 1.** Partout où ce plan écrit `REGLE_MULTI_ACTEURS`, appliquer ce que la mesure a consigné. Ne rien deviner : si la mesure manque, la tâche est bloquée.

**Files:**
- Create: `src/noanim.js`
- Test: `test/noanim.test.js`

**Interfaces:**
- Consumes: `decodeFrameRaw`, `encodeRaw`, `WIRE` de `src/codec/rawProto.js`.
- Produces: `traduire(brute) → { octets: Buffer[], raison: string|null }` et les constantes `TYPE_ACTION`, `ACTION_DEPLACEMENT`, `ACTION_POSE`. `octets` vide signifie « ne rien changer » et `raison` dit pourquoi.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `test/noanim.test.js`. Les octets sont ceux mesurés le 21/08 sur le proxy de krm35, pas des valeurs inventées.

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { traduire, construirePose, ACTION_DEPLACEMENT, ACTION_POSE } = require('../src/noanim');
const { decodeFrameRaw } = require('../src/codec/rawProto');

// Mesures du 21/08. DEPLACEMENT est la trame que le serveur envoie et que le
// proxy de krm35 retient; POSE est celle qu'il fabrique a la place.
const DEPLACEMENT = Buffer.from(
  '0a3e0a3c0a13747970652e616e6b616d612e636f6d2f6a7765122518a682c4aab0133a192209100120a682c4aab01330d9013a0710876418e5d502400170ac02',
  'hex');
const POSE_ATTENDUE = Buffer.from(
  '0a2f0a2d0a13747970652e616e6b616d612e636f6d2f6a7765121618a682c4aab01370049a020a08d90110a682c4aab013',
  'hex');
const JOUEUR = 665809125670n;

test('la trame posee est celle mesuree, octet pour octet', () => {
  assert.strictEqual(construirePose(217n, JOUEUR).toString('hex'), POSE_ATTENDUE.toString('hex'));
  assert.notStrictEqual(decodeFrameRaw(construirePose(217n, JOUEUR)), null);
});

test('un deplacement devient une pose sur la case d arrivee', () => {
  const r = traduire(DEPLACEMENT);
  assert.strictEqual(r.octets.length, 1);
  const d = decodeFrameRaw(r.octets[0]);
  assert.strictEqual(d.type, 'jwe');
  assert.strictEqual(d.payload.find((f) => f.no === 14).value, ACTION_POSE);
  const oneof = d.payload.find((f) => f.no === 35);
  assert.strictEqual(oneof.value.find((f) => f.no === 1).value, 217n);
  assert.strictEqual(oneof.value.find((f) => f.no === 2).value, JOUEUR);
});

// Le champ 7.2 designe l'acteur quand il est present; le champ 3 ne le designe
// qu'a defaut. Se tromper de champ ici produirait une pose sur le mauvais
// combattant -- exactement le piege du champ 1 de ijz pour les invitations.
test('l acteur vient du champ 7.2 quand il existe', () => {
  // 3 = -2 (un monstre), 7.2 = le joueur, 7.6 = 241.
  const brute = Buffer.from(
    '0a650a630a13747970652e616e6b616d612e636f6d2f6a7765124c18feffffffffffffffff013a3c10a682c4aab013220b20ffffffffffffffffff0122180a09080110a682c4aab013180220feffffffffffffffff0130f1013a0710e32018c2a901400170ac02',
    'hex');
  const r = traduire(brute);
  assert.strictEqual(r.octets.length, 1);
  const d = decodeFrameRaw(r.octets[0]);
  assert.strictEqual(d.payload.find((f) => f.no === 3).value, JOUEUR);
  assert.strictEqual(d.payload.find((f) => f.no === 35).value.find((f) => f.no === 1).value, 241n);
});

// GARANTIE 2, cas par cas. Chacun rend une liste vide et dit pourquoi.
test('une trame indecodable est relayee telle quelle', () => {
  const r = traduire(Buffer.from('00ff00ff', 'hex'));
  assert.deepStrictEqual(r.octets, []);
  assert.match(r.raison, /indecodable/);
});

test('un autre type que jwe est relaye tel quel, sans bruit', () => {
  // jxz, le compteur de manche du passe-tour.
  const jxz = Buffer.from('0a220a200a13747970652e616e6b616d612e636f6d2f6a787a120308011003', 'hex');
  const r = traduire(jxz);
  assert.deepStrictEqual(r.octets, []);
  assert.strictEqual(r.raison, null);
});

test('un jwe sans champ 14 est relaye tel quel', () => {
  const sansAction = Buffer.from('0a220a200a13747970652e616e6b616d612e636f6d2f6a7765120908a682c4aab0131003', 'hex');
  const r = traduire(sansAction);
  assert.deepStrictEqual(r.octets, []);
  assert.match(r.raison, /sans action/);
});

test('une action autre que le deplacement est relayee telle quelle, sans bruit', () => {
  const r = traduire(POSE_ATTENDUE);
  assert.deepStrictEqual(r.octets, []);
  assert.strictEqual(r.raison, null);
});

test('un deplacement sans case d arrivee est relaye tel quel', () => {
  // 14 = 300 mais le champ 7 ne porte pas de champ 6.
  const sansCase = Buffer.from('0a2b0a290a13747970652e616e6b616d612e636f6d2f6a7765121218a682c4aab0133a0410ac0270ac02', 'hex');
  const r = traduire(sansCase);
  assert.deepStrictEqual(r.octets, []);
  assert.match(r.raison, /case/);
});

test('traduire ne leve jamais, quoi qu on lui donne', () => {
  for (const mauvais of [Buffer.alloc(0), Buffer.from('ff', 'hex'), Buffer.alloc(64, 0xff)]) {
    assert.doesNotThrow(() => traduire(mauvais));
  }
});
```

Si la mesure a livré `REGLE_MULTI_ACTEURS`, ajouter le test correspondant, avec les octets relevés en tâche 1 :

```js
test('une poussee deplace tous les acteurs qu elle porte', () => {
  const r = traduire(POUSSEE_MESUREE);   // octets releves en tache 1
  assert.strictEqual(r.octets.length, NOMBRE_D_ACTEURS_MESURE);
});
```

Si elle ne l'a pas livrée, ajouter celui-ci à la place — le repli du spec :

```js
// La mesure n'a pas livre d'ou sortent les cases des acteurs secondaires.
// Transformer quand meme laisserait les autres combattants colles a leur
// ancienne case: un bug visible en jeu, la ou ne rien faire ne coute qu'une
// animation.
test('une action a plusieurs acteurs est relayee telle quelle', () => {
  const r = traduire(POUSSEE_MESUREE);   // octets releves en tache 1
  assert.deepStrictEqual(r.octets, []);
  assert.match(r.raison, /acteurs/);
});
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

```bash
npm test
```
Attendu : ÉCHEC, `Cannot find module '../src/noanim'`.

- [ ] **Step 3 : Implémenter `src/noanim.js`**

```js
'use strict';
const { decodeFrameRaw, encodeRaw, WIRE } = require('./codec/rawProto');

// La suppression des animations de deplacement en combat, et elle seule.
//
// LA TRADUCTION. Mesuree le 21/08 en observant le proxy de krm35 par
// src/cli/proxy-tap.js, deux captures de 60 s. Voir
// docs/superpowers/specs/2026-08-21-no-anim-safe-design.md.
//
//   recu du serveur   jwe { 3: acteur, 7: { 2: acteur?, 6: case, ... }, 14: 300 }
//   rendu au client   jwe { 3: acteur, 14: 4, 35: { 1: case, 2: acteur } }
//
// Le champ 14 est un discriminant d'action: il commande le numero de la
// branche oneof qui porte les donnees. L'action 300 est le deplacement anime,
// l'action 4 est « pose cet acteur sur cette case ». Le client n'a alors plus
// rien a animer.
//
// L'ACTEUR EST AU CHAMP 7.2, PAS AU CHAMP 3, quand le champ 7.2 existe. Le
// champ 3 designe alors celui qui provoque le deplacement -- un monstre qui
// pousse -- et non celui qui se deplace. Meme piege que le champ 1 de ijz pour
// les invitations, ou un filtre bati sur le mauvais champ passait l'essai en
// jeu sans broncher.
//
// AU MOINDRE DOUTE, NE RIEN CHANGER. Ce module est sur le chemin critique du
// jeu: une trame mal reconstruite tue la connexion, la ou une animation de
// trop ne coute rien. `octets: []` fait relayer les octets d'origine, et c'est
// la valeur de retour par defaut de tous les chemins.

const TYPE_JWE = 'jwe';
const TYPE_ACTION = 14;
const ACTION_DEPLACEMENT = 300n;
const ACTION_POSE = 4n;
const BRANCHE_DEPLACEMENT = 7;
const BRANCHE_POSE = 35;
const CHAMP_ACTEUR = 3;
const CHAMP_ACTEUR_DEPLACE = 2;   // dans la branche 7
const CHAMP_CASE = 6;             // dans la branche 7
const URL_JWE = 'type.ankama.com/jwe';

const champ = (fields, no) => (fields || []).find((f) => f.no === no) || null;

// L'enveloppe est celle de toutes les trames observees: Message{ event = 1 },
// event{ Any content = 1 }, Any{ string type_url = 1, bytes value = 2 }. Un
// evenement n'a pas d'uid, contrairement aux requetes.
function construirePose(idCase, acteur) {
  return encodeRaw([
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: URL_JWE },
        { no: 2, wire: WIRE.LEN, kind: 'message', value: [
          { no: CHAMP_ACTEUR, wire: WIRE.VARINT, value: acteur },
          { no: TYPE_ACTION, wire: WIRE.VARINT, value: ACTION_POSE },
          { no: BRANCHE_POSE, wire: WIRE.LEN, kind: 'message', value: [
            { no: 1, wire: WIRE.VARINT, value: idCase },
            { no: 2, wire: WIRE.VARINT, value: acteur },
          ] },
        ] },
      ] },
    ] },
  ]);
}

// Rend { octets, raison }. `octets` vide = ne rien changer; `raison` non nulle
// = le dire au journal. Une raison nulle avec des octets vides est le cas
// courant: ce n'est ni un deplacement, ni une anomalie.
function traduire(brute) {
  let decodee = null;
  try { decodee = decodeFrameRaw(brute); }
  catch (e) { return { octets: [], raison: `trame indecodable, relayee telle quelle : ${e.message}` }; }
  if (decodee === null) return { octets: [], raison: 'trame indecodable, relayee telle quelle' };
  if (decodee.type !== TYPE_JWE) return { octets: [], raison: null };

  const action = champ(decodee.payload, TYPE_ACTION);
  if (action === null) return { octets: [], raison: 'jwe sans action, relayee telle quelle' };
  if (action.value !== ACTION_DEPLACEMENT) return { octets: [], raison: null };

  const branche = champ(decodee.payload, BRANCHE_DEPLACEMENT);
  if (branche === null || branche.kind !== 'message') {
    return { octets: [], raison: 'deplacement sans donnees, relaye tel quel' };
  }

  const idCase = champ(branche.value, CHAMP_CASE);
  if (idCase === null) return { octets: [], raison: 'deplacement sans case d arrivee, relaye tel quel' };

  const deplace = champ(branche.value, CHAMP_ACTEUR_DEPLACE);
  const defaut = champ(decodee.payload, CHAMP_ACTEUR);
  const acteur = deplace !== null ? deplace.value : (defaut === null ? null : defaut.value);
  if (acteur === null) return { octets: [], raison: 'deplacement sans acteur, relaye tel quel' };

  try {
    return { octets: [construirePose(idCase.value, acteur)], raison: null };
  } catch (e) {
    return { octets: [], raison: `pose non construite, relayee telle quelle : ${e.message}` };
  }
}

module.exports = {
  traduire, construirePose,
  TYPE_ACTION, ACTION_DEPLACEMENT, ACTION_POSE, BRANCHE_DEPLACEMENT, BRANCHE_POSE,
};
```

Si la mesure a livré `REGLE_MULTI_ACTEURS`, remplacer le `return` final par la boucle qui construit une pose par acteur, en lisant les cases là où la mesure a dit qu'elles sont. Sinon, ajouter avant ce `return` le repli du spec :

```js
  // La mesure n'a pas livre d'ou sortent les cases des acteurs secondaires.
  const acteurs = (branche.value || []).filter((f) => f.no === 4);
  if (acteurs.length > 1) {
    return { octets: [], raison: `action 300 a ${acteurs.length} acteurs, relayee telle quelle` };
  }
```

- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent**

```bash
npm test
```
Attendu : tous verts. En particulier le test d'égalité octet pour octet : il vaut preuve que l'encodeur reconstruit exactement ce que le client attend.

- [ ] **Step 5 : Commit**

```bash
git add src/noanim.js test/noanim.test.js
git commit -m "feat: traduire les deplacements animes en poses instantanees"
```

---

### Task 4 : Le flux, le cadrage et le désarmement

**Dépend des tâches 2 et 3.** C'est la tâche qui porte la **garantie 1** dans le cas armé, et la plus délicate du plan : elle manipule le cadrage du flux de jeu.

Un chunk TCP ne contient pas un nombre entier de trames. Le transformateur doit donc réassembler, et **retenir** les octets d'une trame incomplète jusqu'à ce qu'elle le soit. C'est un changement de rythme, pas de contenu — mais si le réassembleur se désynchronise, la connexion est perdue. D'où le mode inerte définitif décrit ci-dessous.

**Files:**
- Create: `src/noanim-flux.js`
- Test: `test/noanim-flux.test.js`

**Interfaces:**
- Consumes: `traduire` de `src/noanim.js`, `FrameReassembler` et `writeVarint` de `src/codec/framing.js`.
- Produces: `creerTransformateurFlux({ reglages, onCompteRendu }) → transformer(buf, conn) → Buffer | null`, signature exacte attendue par `createProxy` (tâche 2). `reglages` est `{ actif }`, relu à chaque chunk.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `test/noanim-flux.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerTransformateurFlux } = require('../src/noanim-flux');
const { writeVarint } = require('../src/codec/framing');

const DEPLACEMENT = Buffer.from(
  '0a3e0a3c0a13747970652e616e6b616d612e636f6d2f6a7765122518a682c4aab0133a192209100120a682c4aab01330d9013a0710876418e5d502400170ac02',
  'hex');
const JXZ = Buffer.from('0a220a200a13747970652e616e6b616d612e636f6d2f6a787a120308011003', 'hex');

// Le reassembleur retire le prefixe de longueur: sur le fil, chaque trame le
// porte.
const surLeFil = (...trames) => Buffer.concat(trames.flatMap((t) => [writeVarint(t.length), t]));

function flux(actif = true, rendu = []) {
  const reglages = { actif };
  const f = creerTransformateurFlux({ reglages, onCompteRendu: (r) => rendu.push(r) });
  return { f, reglages, rendu, conn: { id: 1, port: 5555 } };
}

// GARANTIE 1: eteint, le transformateur ne touche a rien et ne retient rien.
test('eteint, il rend null sans meme regarder les octets', () => {
  const { f, conn } = flux(false);
  assert.strictEqual(f(surLeFil(DEPLACEMENT), conn), null);
});

test('rallume en cours de route, il repart d un flux propre', () => {
  const { f, reglages, conn } = flux(false);
  assert.strictEqual(f(surLeFil(JXZ), conn), null);
  reglages.actif = true;
  const sortie = f(surLeFil(JXZ), conn);
  assert.strictEqual(sortie.toString('hex'), surLeFil(JXZ).toString('hex'));
});

test('une trame sans rapport ressort identique', () => {
  const { f, conn } = flux();
  assert.strictEqual(f(surLeFil(JXZ), conn).toString('hex'), surLeFil(JXZ).toString('hex'));
});

test('un deplacement ressort traduit, et plus court', () => {
  const { f, conn } = flux();
  const sortie = f(surLeFil(DEPLACEMENT), conn);
  assert.notStrictEqual(sortie.toString('hex'), surLeFil(DEPLACEMENT).toString('hex'));
  assert.ok(sortie.length < surLeFil(DEPLACEMENT).length);
});

// Le cas qui casse tout si on le rate: TCP ne respecte pas les frontieres de
// trames.
test('une trame coupee en deux chunks est reconstituee', () => {
  const { f, conn } = flux();
  const fil = surLeFil(JXZ);
  const a = f(fil.subarray(0, 5), conn);
  const b = f(fil.subarray(5), conn);
  const total = Buffer.concat([a === null ? Buffer.alloc(0) : a, b === null ? Buffer.alloc(0) : b]);
  assert.strictEqual(total.toString('hex'), fil.toString('hex'));
});

test('deux trames dans un seul chunk ressortent toutes les deux', () => {
  const { f, conn } = flux();
  const sortie = f(surLeFil(JXZ, JXZ), conn);
  assert.strictEqual(sortie.toString('hex'), surLeFil(JXZ, JXZ).toString('hex'));
});

// GARANTIE 2: un cadrage qui part en vrille ne doit pas couper la partie.
test('un cadrage impossible fait passer le transformateur en inerte definitif', () => {
  const { f, rendu, conn } = flux();
  // Une longueur annoncee gigantesque: le reassembleur refuse.
  const poison = Buffer.concat([writeVarint(9 * 1024 * 1024), Buffer.alloc(8)]);
  const sortie = f(poison, conn);
  assert.strictEqual(sortie.toString('hex'), poison.toString('hex'));
  assert.match(rendu[0].raison, /cadrage/);
  // Et tout ce qui suit passe sans etre touche, meme un deplacement.
  assert.strictEqual(f(surLeFil(DEPLACEMENT), conn), null);
});

test('deux connexions ne partagent pas leur reassembleur', () => {
  const { f } = flux();
  const a = { id: 1, port: 5555 };
  const b = { id: 2, port: 5555 };
  const fil = surLeFil(JXZ);
  f(fil.subarray(0, 5), a);
  const sortieB = f(fil, b);
  assert.strictEqual(sortieB.toString('hex'), fil.toString('hex'));
});

test('le compte rendu porte la raison de chaque refus', () => {
  const { f, rendu, conn } = flux();
  f(surLeFil(Buffer.from('00ff00ff', 'hex')), conn);
  assert.ok(rendu.some((r) => /indecodable/.test(r.raison)));
});
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

```bash
npm test
```
Attendu : ÉCHEC, `Cannot find module '../src/noanim-flux'`.

- [ ] **Step 3 : Implémenter `src/noanim-flux.js`**

```js
'use strict';
const { FrameReassembler, writeVarint } = require('./codec/framing');
const { traduire } = require('./noanim');

// L'enveloppe de flux du no-anim: cadrage, etat par connexion, desarmement.
//
// src/noanim.js traduit UNE trame. Ce module-ci decide quelles trames lui
// donner, et surtout dans quels cas ne rien faire du tout.
//
// POURQUOI UN REASSEMBLEUR. Un chunk TCP ne porte pas un nombre entier de
// trames: il peut en couper une en deux, ou en contenir trois. On ne peut donc
// pas traduire un chunk, seulement des trames completes. Les octets d'une
// trame incomplete sont retenus jusqu'a ce qu'elle le soit -- un changement de
// rythme, pas de contenu.
//
// POURQUOI UN MODE INERTE DEFINITIF. Si le reassembleur se desynchronise une
// fois, il ne se resynchronise jamais: toutes les longueurs suivantes sont
// lues au mauvais endroit. Continuer a transformer detruirait la connexion de
// jeu. On repart alors les octets tels quels et on ne retouche plus jamais a
// cette connexion, jusqu'a sa fermeture.
//
// POURQUOI ETEINT SIGNIFIE INTOUCHE. Tant que reglages.actif est faux, ce
// module rend null sans rien lire: le proxy ecrit les octets d'origine, et le
// chemin de relais est exactement celui d'avant cette fonction. C'est la
// condition posee avant d'accepter que le proxy touche au chemin critique.

function creerTransformateurFlux({ reglages, onCompteRendu = () => {} }) {
  // conn.id -> { reassembleur, inerte }
  const etats = new Map();

  return function transformer(buf, conn) {
    if (!reglages.actif) return null;

    let etat = etats.get(conn.id);
    if (etat === undefined) {
      etat = { reassembleur: new FrameReassembler(), inerte: false };
      etats.set(conn.id, etat);
    }
    if (etat.inerte) return null;

    let trames = [];
    try {
      trames = etat.reassembleur.push(buf);
    } catch (e) {
      // Desynchronise: on ne sait plus ou commencent les trames. On rend le
      // chunk tel quel et on ne touche plus a cette connexion.
      etat.inerte = true;
      onCompteRendu({ conn: conn.id, raison: `cadrage perdu, connexion relayee telle quelle : ${e.message}` });
      return buf;
    }

    if (trames.length === 0) return Buffer.alloc(0);

    const morceaux = [];
    for (const brute of trames) {
      let r = { octets: [], raison: null };
      try { r = traduire(brute); }
      catch (e) { r = { octets: [], raison: `traduction en echec, trame relayee telle quelle : ${e.message}` }; }
      if (r.raison !== null) onCompteRendu({ conn: conn.id, raison: r.raison });
      const sortantes = r.octets.length === 0 ? [brute] : r.octets;
      for (const t of sortantes) morceaux.push(writeVarint(t.length), t);
    }
    return Buffer.concat(morceaux);
  };
}

module.exports = { creerTransformateurFlux };
```

> Le test « rallume en cours de route » passe parce qu'un transformateur éteint ne lit rien : son réassembleur est vide au moment où on l'allume, et il repart sur une frontière de trame propre. C'est vrai tant que l'allumage se fait entre deux chunks, ce que garantit le fil d'exécution unique de Node.

- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent**

```bash
npm test
```
Attendu : tous verts.

- [ ] **Step 5 : Commit**

```bash
git add src/noanim-flux.js test/noanim-flux.test.js
git commit -m "feat: cadrage et desarmement du no-anim sur le flux descendant"
```

---

### Task 5 : L'état, les réglages et la vue

**Indépendante des tâches 1 à 4.** Quatrième jumelle d'un motif rodé trois fois : `favori`, `exclu`, `passeTour`, `accepteInvitation`.

**Files:**
- Modify: `src/comptes/favoris.js`
- Modify: `src/protocol/compte.js`
- Modify: `src/comptes/vue.js`
- Test: `test/comptes-favoris.test.js`
- Test: `test/compte.test.js`
- Test: `test/comptes-vue.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: `Favoris.noAnimActif(id) → boolean`, `Favoris.marquerNoAnim(id, actif) → void`, `Favoris.tousNoAnim() → number[]`, la clé `noAnim` dans le fichier ; `EtatCompte.noAnim`, booléen faux par défaut ; `construireVue({ noAnim })` posant `ligne.noAnim` sur **toutes** les lignes.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `test/comptes-favoris.test.js` :

```js
test('le no-anim se marque, se lit et se relit du fichier', () => {
  const chemin = fichierTemporaire();
  const f = new Favoris(chemin).charger();
  assert.strictEqual(f.noAnimActif(12), false);
  f.marquerNoAnim(12, true);
  assert.strictEqual(f.noAnimActif(12), true);
  assert.deepStrictEqual(new Favoris(chemin).charger().tousNoAnim(), [12]);
});

test('le no-anim se demarque', () => {
  const chemin = fichierTemporaire();
  const f = new Favoris(chemin).charger();
  f.marquerNoAnim(12, true);
  f.marquerNoAnim(12, false);
  assert.deepStrictEqual(new Favoris(chemin).charger().tousNoAnim(), []);
});

// Les quatre listes sont independantes.
test('no-anim, invitation, passe-tour et favoris ne se melangent pas', () => {
  const chemin = fichierTemporaire();
  const f = new Favoris(chemin).charger();
  f.marquerNoAnim(12, true);
  const relu = new Favoris(chemin).charger();
  assert.strictEqual(relu.passeTourActif(12), false);
  assert.strictEqual(relu.invitationActive(12), false);
  assert.strictEqual(relu.estFavori(12), false);
});

// Un fichier ecrit par une version anterieure n'a pas la cle: la lecture doit
// rendre une liste vide, pas faire echouer le demarrage.
test('un fichier sans cle noAnim se lit sans erreur', () => {
  const chemin = fichierTemporaire();
  fs.writeFileSync(chemin, JSON.stringify({ delai: 0, favoris: [3], passeTour: [], invitation: [] }), 'utf8');
  const f = new Favoris(chemin).charger();
  assert.deepStrictEqual(f.tousNoAnim(), []);
  assert.strictEqual(f.estFavori(3), true);
});
```

Ajouter à `test/compte.test.js` :

```js
// Quatrieme interrupteur, independant des trois autres.
test('noAnim est faux par defaut et independant des autres interrupteurs', () => {
  const e = new EtatCompte({ pid: 1 });
  assert.strictEqual(e.noAnim, false);
  e.noAnim = true;
  assert.strictEqual(e.passeTour, false);
  assert.strictEqual(e.accepteInvitation, false);
  assert.strictEqual(e.exclu, false);
});
```

Ajouter à `test/comptes-vue.test.js` :

```js
test('le no-anim remonte sur la ligne du compte', () => {
  const lignes = vue({ noAnim: new Set([2]) });
  assert.strictEqual(lignes.find((l) => l.id === 1).noAnim, false);
  assert.strictEqual(lignes.find((l) => l.id === 2).noAnim, true);
});

// Meme piege que pour passeTour et invitation, rencontre deux fois: code en
// dur a faux, la case s'affichait eteinte alors que la fonction agissait.
test('le no-anim remonte aussi sur un client sans ligne de compte', () => {
  const l = construireVue({
    comptes: COMPTES,
    clients: [{ pid: 500, idCompte: 42, personnage: 'Tardif', classe: 'Eniripsa' }],
    intercepte: new Set([500]),
    maitre: null,
    exclus: new Set(),
    favoris: new Set(),
    noAnim: new Set([42]),
  }).pop();
  assert.strictEqual(l.id, 42);
  assert.strictEqual(l.noAnim, true);
});

test('l absence de noAnim ne casse pas la vue', () => {
  const lignes = vue();
  assert.strictEqual(lignes[0].noAnim, false);
});
```

- [ ] **Step 2 : Lancer les tests et vérifier qu'ils échouent**

```bash
npm test
```
Attendu : ÉCHEC, `f.noAnimActif is not a function` puis `undefined !== false`.

- [ ] **Step 3 : Implémenter les trois fichiers**

Dans `src/comptes/favoris.js`, dans le constructeur, après `this._invitation` :

```js
    // Comptes dont les animations de deplacement sont supprimees. Meme nature
    // que les trois listes precedentes: que des identifiants numeriques.
    this._noAnim = new Set();
```

Dans `charger()`, après le bloc `invitation` :

```js
      if (Array.isArray(json.noAnim)) {
        this._noAnim = new Set(json.noAnim.filter((n) => Number.isInteger(n)));
      }
```

Dans le `catch` de `charger()`, ajouter `this._noAnim = new Set();`.

Après `tousInvitation()` :

```js
  noAnimActif(id) {
    return this._noAnim.has(id);
  }

  marquerNoAnim(id, actif) {
    if (actif) this._noAnim.add(id);
    else this._noAnim.delete(id);
    this._ecrire();
  }

  tousNoAnim() {
    return [...this._noAnim];
  }
```

Dans `_ecrire()`, ajouter la clé au bout de l'objet `contenu` :

```js
        noAnim: this.tousNoAnim(),
```

Dans `src/protocol/compte.js`, après `this.accepteInvitation = false;` :

```js
    // Suppression des animations de deplacement en combat. Independant des
    // trois autres interrupteurs.
    this.noAnim = false;
```

Dans `src/comptes/vue.js` : ajouter `noAnim` au dernier paramètre de `ligneBase`, poser `noAnim: noAnim.has(compte.id),` dans l'objet rendu, ajouter `noAnim = new Set(),` à la signature de `construireVue`, passer `, noAnim` dans l'appel à `ligneBase`, et ajouter dans l'objet du repli en fin de liste :

```js
      noAnim: c.idCompte !== null && noAnim.has(c.idCompte),
```

- [ ] **Step 4 : Lancer les tests et vérifier qu'ils passent**

```bash
npm test
```
Attendu : tous verts.

- [ ] **Step 5 : Commit**

```bash
git add src/comptes/favoris.js src/protocol/compte.js src/comptes/vue.js test/comptes-favoris.test.js test/compte.test.js test/comptes-vue.test.js
git commit -m "feat: enregistrer et exposer l'interrupteur de no-anim par compte"
```

---

### Task 6 : Câbler l'application

**Dépend des tâches 2, 4 et 5.**

Le no-anim se branche **ailleurs** que les trois autres fonctions : elles passent par `composer()` dans `superviseur.onTrame`, qui observe. Celle-ci passe par `createProxy({ transformerEntrant })`, qui transforme. Ne pas les mélanger.

**Files:**
- Modify: `src/superviseur.js:42` (constructeur) et `:61-65` (l'appel à `createProxy`)
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Test: `test/superviseur.test.js`

**Interfaces:**
- Consumes: `creerTransformateurFlux` (tâche 4), `Favoris.noAnimActif` / `marquerNoAnim` (tâche 5), `construireVue({ noAnim })` (tâche 5).
- Produces: `new Superviseur({ transformerEntrant })`, passé tel quel à chaque `createProxy` ; deux canaux IPC, `basculerNoAnim(actif)` et `basculerNoAnimCompte(idCompte, actif)` ; l'état envoyé au renderer gagne `noAnimActif` et, par ligne, `noAnim`.

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à `test/superviseur.test.js` :

```js
// Le transformateur doit arriver jusqu'au proxy: sans ce fil, tout le reste
// est ecrit pour rien. C'est exactement l'erreur trouvee en revue finale sur
// le Replicate, ou onTrame n'etait pas branche et l'application ne dupliquait
// rien tout en ayant l'air de marcher.
test('le superviseur transmet son transformateur au proxy', () => {
  const t = () => null;
  const s = new Superviseur({ transformerEntrant: t });
  assert.strictEqual(s.transformerEntrant, t);
});

test('sans transformateur, le superviseur n en invente pas', () => {
  const s = new Superviseur({});
  assert.strictEqual(s.transformerEntrant, null);
});
```

- [ ] **Step 2 : Lancer et vérifier l'échec**

```bash
npm test
```
Attendu : ÉCHEC, `undefined !== function`.

- [ ] **Step 3 : Faire passer le transformateur du superviseur au proxy**

Dans `src/superviseur.js`, le constructeur devient :

```js
  constructor({ onTrame = () => {}, onJournal = () => {}, arme = false, transformerEntrant = null } = {}) {
```

et, après `this.onJournal = onJournal;` :

```js
    // Transforme le flux descendant avant qu'il n'atteigne le client. Nul par
    // defaut: le proxy relaie alors octet pour octet, comme avant l'ajout du
    // no-anim.
    this.transformerEntrant = transformerEntrant;
```

Dans `ajouter()`, l'appel à `createProxy` gagne une ligne :

```js
    client.proxy = await createProxy({
      port: 0,
      onProbleme: (p) => this.journal(pid, `connexion ${p.id} abandonnée — ${p.raison}`),
      onData: (dir, buf, conn) => this._recevoir(client, dir, buf, conn),
      transformerEntrant: this.transformerEntrant,
    });
```

- [ ] **Step 4 : Lancer et vérifier que ça passe**

```bash
npm test
```
Attendu : tous verts.

- [ ] **Step 5 : Déclarer les réglages dans `desktop/main.js`**

À côté de l'import de l'accepteur :

```js
const { creerTransformateurFlux } = require('../src/noanim-flux');
```

et à côté de `reglagesInvitation` :

```js
// Lu a chaque chunk par le transformateur: modifier ce champ suffit. Faux =
// le proxy relaie le flux descendant octet pour octet, comme avant.
const reglagesNoAnim = { actif: false };
```

- [ ] **Step 6 : Brancher le transformateur sur le superviseur**

Le `new Superviseur({ … })` de `desktop/main.js` gagne un argument :

```js
  transformerEntrant: creerTransformateurFlux({
    reglages: reglagesNoAnim,
    onCompteRendu: ({ conn, raison }) => journal(null, `no-anim (connexion ${conn}) : ${raison}`),
  }),
```

> `journal(null, …)` parce qu'un compte rendu de transformation porte un numéro de connexion, pas un pid : le transformateur vit dans le proxy, en amont de l'association client/compte. Si `journal` n'accepte pas `null` comme pid, lui passer `0` et vérifier que la ligne s'affiche.

- [ ] **Step 7 : Restaurer et resynchroniser l'interrupteur**

Dans `balayerProcess()`, à côté de `etat.accepteInvitation = favoris.invitationActive(idCompte);` :

```js
        etat.noAnim = favoris.noAnimActif(idCompte);
```

Dans `envoyerEtat()`, dans la boucle de resynchronisation, après `etat.accepteInvitation = …` :

```js
    etat.noAnim = favoris.noAnimActif(idCompte);
```

Après le `const invitation = new Set(...)` :

```js
  // Comme les trois autres: la case affichee vient de l'etat vivant.
  const noAnim = new Set(
    superviseur.comptes.tous.filter((e) => e.noAnim).map((e) => pidVersCompte(e.pid, clients)),
  );
  // L'interrupteur general du no-anim suit les comptes: le transformateur est
  // pose sur le proxy, qui ne connait pas les comptes. Des qu'au moins un
  // compte l'active, il s'arme; quand le dernier l'eteint, il se desarme et le
  // relais redevient octet pour octet.
  reglagesNoAnim.actif = noAnim.size > 0;
```

Dans l'objet envoyé, après `invitationActive: reglagesInvitation.actif,` :

```js
    noAnimActif: reglagesNoAnim.actif,
```

et dans l'appel à `construireVue({...})`, après `invitation,` :

```js
      noAnim,
```

- [ ] **Step 8 : Ajouter les deux gestionnaires IPC**

Après le gestionnaire `basculerInvitationCompte` :

```js
ipcMain.handle('basculerNoAnim', async (_e, actif) => {
  // L'interrupteur general n'a pas d'etat propre: il eteint tous les comptes
  // d'un coup. Sans cela, le bouton et les cases pourraient se contredire.
  if (!actif) for (const id of favoris.tousNoAnim()) favoris.marquerNoAnim(id, false);
  for (const etat of superviseur.comptes.tous) if (!actif) etat.noAnim = false;
  await envoyerEtat();
});

ipcMain.handle('basculerNoAnimCompte', async (_e, idCompte, actif) => {
  // La frontiere IPC est la frontiere de confiance: on ne laisse pas une
  // valeur non numerique atteindre le fichier de reglages.
  if (!Number.isInteger(idCompte)) return;
  favoris.marquerNoAnim(idCompte, Boolean(actif));
  const clients = await listerClients();
  const pid = compteVersPid(idCompte, clients);
  const etat = pid === null ? null : superviseur.comptes.get(pid);
  if (etat) etat.noAnim = Boolean(actif);
  await envoyerEtat();
});
```

- [ ] **Step 9 : Ouvrir les deux ordres au renderer**

Dans `desktop/preload.js`, corriger le commentaire — « huit ordres » devient « dix ordres », et la liste énumère les deux nouveaux — puis ajouter :

```js
  basculerNoAnim: (actif) => ipcRenderer.invoke('basculerNoAnim', actif),
  basculerNoAnimCompte: (idCompte, actif) => ipcRenderer.invoke('basculerNoAnimCompte', idCompte, actif),
```

- [ ] **Step 10 : Vérifier**

```bash
node --check desktop/main.js
node --check desktop/preload.js
npm test
```
Attendu : aucune sortie des deux `--check`, tous les tests verts.

- [ ] **Step 11 : Commit**

```bash
git add src/superviseur.js desktop/main.js desktop/preload.js test/superviseur.test.js
git commit -m "feat(app): brancher le no-anim sur le proxy et ses interrupteurs"
```

---

### Task 7 : L'interface

**Dépend de la tâche 6.**

**Files:**
- Modify: `desktop/index.html`

**Interfaces:**
- Consumes: `etat.noAnimActif`, `l.noAnim`, `window.app.basculerNoAnim`, `window.app.basculerNoAnimCompte`.
- Produces: rien pour les tâches suivantes.

- [ ] **Step 1 : Le bouton global**

Dans le `<style>`, après la règle `#binv.actif` :

```css
  #banim { padding: 7px 14px; border: 0; border-radius: 6px; background: #3a3f4b;
           color: #e6e8ec; cursor: pointer; font: inherit; }
  #banim.actif { background: #2e7d4f; }
```

Dans le `<header>`, après le bouton `binv` :

```html
  <button id="banim">ANIM</button>
```

- [ ] **Step 2 : L'icône**

Après `ICONE_GROUPE`, à la même facture — au trait, `currentColor`, sans fichier ni dépendance. Un personnage en mouvement barré :

```js
  const ICONE_ANIM =
    '<svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="4.6" r="2.2"/><path d="M9 21l2.2-5.2 2.4 2.2 1 3"/>' +
    '<path d="M7.4 12.2l3.4-2.6 2.6 1.4 2.6 2.4"/><line x1="4" y1="20" x2="20" y2="4"/></svg>';
```

- [ ] **Step 3 : Brancher le bouton global**

Après la déclaration `let invitationActive = false;` :

```js
  let noAnimActif = false;
```

Après le gestionnaire du bouton `binv` :

```js
  document.getElementById('banim').addEventListener('click', () => {
    noAnimActif = !noAnimActif;
    window.app.basculerNoAnim(noAnimActif);
  });
```

Dans `window.app.surEtat`, après le bloc `binv` :

```js
    noAnimActif = etat.noAnimActif;
    document.getElementById('banim').classList.toggle('actif', noAnimActif);
```

- [ ] **Step 4 : L'interrupteur par ligne**

Après `const swInv = …` :

```js
      const swAnim = interrupteur(ICONE_ANIM, l.noAnim, !utilisable,
        (v) => window.app.basculerNoAnimCompte(l.id, v));
```

et remplacer l'assemblage de la ligne par :

```js
      li.append(etoile, swRep, swPasse, swInv, swAnim, nom, perso, badge);
```

Corriger au passage le commentaire au-dessus de `utilisable` : « aucun des trois » devient « aucun des quatre ».

- [ ] **Step 5 : Vérifier à l'œil**

Lancer l'application, sans client Dofus. Attendu : le bouton `ANIM` est présent ; chaque ligne porte quatre interrupteurs, tous grisés tant qu'aucun client n'est suivi ; l'icône est reconnaissable à sa taille réelle de 15 px.

> Le bouton `ANIM` ne s'allume **pas** au clic quand aucun compte n'a le no-anim actif : l'interrupteur général reflète les comptes, il ne les commande qu'à l'extinction. C'est voulu, et c'est différent du bouton `PASSE-TOUR`. Le vérifier plutôt que de le prendre pour un bug.

- [ ] **Step 6 : Commit**

```bash
git add desktop/index.html
git commit -m "feat(ui): bouton ANIM et interrupteur de no-anim par compte"
```

---

### Task 8 : Essai en jeu, non-régression, fusion

**Dépend de toutes les précédentes.** Un journal vert et un effet en jeu sont deux choses distinctes : c'est la leçon du passe-tour, où l'application affichait « suivi » des clients qu'elle ne pouvait pas atteindre.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-21-no-anim-safe-design.md` (statut)

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: la fonction validée en jeu, la branche fusionnée.

- [ ] **Step 1 : Vérifier qu'aucun processus parasite ne tourne**

```bash
Get-CimInstance Win32_Process -Filter "Name='node.exe' or Name='electron.exe'"
Get-Process | Where-Object { $_.ProcessName -eq 'jklshdj' }
```
Attendu : aucun `node src/cli/mm.js`, et **surtout aucun `jklshdj.exe`** — le launcher de krm35 détourne `connect` comme nous, les deux ne peuvent pas piloter les mêmes clients.

- [ ] **Step 2 : Vérifier la non-régression AVANT d'allumer quoi que ce soit**

Lancer l'application, **puis** deux clients Dofus. Ne toucher à aucun interrupteur de no-anim.

Attendu : le Replicate duplique toujours (cliquer un zaap sur le maître le duplique sur l'esclave), le passe-tour passe toujours les tours, et le journal ne porte **aucune** ligne `no-anim`. C'est la garantie 1 vérifiée en conditions réelles : tant que personne n'allume, le proxy relaie comme avant.

- [ ] **Step 3 : Essayer le no-anim en jeu**

Activer l'interrupteur `ANIM` sur un compte, entrer en combat.

Attendu : **les combattants apparaissent directement à leur case d'arrivée, sans marcher.** Vérifier dans le jeu, pas seulement au journal.

- [ ] **Step 4 : Vérifier que le combat reste jouable de bout en bout**

Mener le combat jusqu'à sa fin : déplacements, sorts, fin de tour, victoire, gains. C'est le point où une trame mal reconstruite se verrait — un combattant figé sur une case, un tour qui ne passe plus, une déconnexion.

Attendu : rien d'anormal, et le combat se termine normalement.

- [ ] **Step 5 : Vérifier l'extinction**

Éteindre l'interrupteur pendant un combat.

Attendu : les animations reviennent immédiatement, et le combat continue sans coupure. Le journal ne porte plus de lignes `no-anim`.

- [ ] **Step 6 : Mettre le spec à jour et commiter**

Passer le statut du spec de « conçu et validé, non implémenté » à « implémenté et validé en jeu le 2026-08-21 », et y reporter ce que la tâche 1 a mesuré sur le multi-acteurs.

```bash
git add docs/superpowers/specs/2026-08-21-no-anim-safe-design.md
git commit -m "docs: no-anim safe valide en jeu"
```

- [ ] **Step 7 : Fusionner**

```bash
git checkout master
git merge --no-ff feat/no-anim -m "merge: no-anim safe, suppression des animations de deplacement"
npm test
```
Attendu : tous les tests verts après la fusion.

---

## Auto-revue

**Couverture du spec.** Besoin → tâches 3, 4, 6, 7. Périmètre Safe seul → contrainte globale. Le no-anim est réseau → tâches 2 et 4. La règle de transformation → tâche 3, avec ses octets mesurés. Le trou multi-acteurs → tâche 1 étapes 6-8, avec les trois issues nommées et l'arrêt explicite sur la troisième, et le repli codé en tâche 3 étape 3. Garantie 1 (inerte par défaut) → tâche 2 étape 1 (test de non-régression écrit en premier), tâche 4 (`if (!reglages.actif) return null`), tâche 6 étape 7 (désarmement quand le dernier compte s'éteint), tâche 8 étape 2 (vérification en jeu). Garantie 2 (fail-open) → tâche 2 (exception rattrapée), tâche 3 (tous les chemins rendent `[]`), tâche 4 (inerte définitif sur cadrage perdu). Aucun chemin ne mène au silence → `raison` sur chaque refus, journalisée en tâche 6 étape 6. État et persistance → tâche 5. Interface → tâches 6 et 7. Tableau des erreurs → tests de la tâche 3 étape 1 et de la tâche 4 étape 1. Critère de réussite → tâche 8 étapes 3 et 4. Critère de non-régression → tâche 8 étape 2.

**Trous connus, assumés.** `REGLE_MULTI_ACTEURS` ne peut pas être écrite avant la tâche 1 : ce n'est pas un espace réservé à combler au jugé, mais un fait à relever. La tâche 3 est bloquée tant qu'il manque, la tâche 1 dit où le lire, et le repli est écrit d'avance pour le cas où il resterait introuvable. Les octets de `POUSSEE_MESUREE`, dans les deux variantes du test de la tâche 3, viennent également de la tâche 1.

**Cohérence des noms.** `noAnim` sur l'état vivant, dans `favoris.json`, dans la vue et dans l'état envoyé au renderer sous `noAnimActif` ; `basculerNoAnim` et `basculerNoAnimCompte` pour l'IPC ; `reglagesNoAnim` dans `main.js` ; `traduire` et `construirePose` dans `src/noanim.js` ; `creerTransformateurFlux` dans `src/noanim-flux.js` ; `transformerEntrant` dans `createProxy` et dans `Superviseur`. Vérifié tâche par tâche.

**Point de vigilance pour le relecteur.** La tâche 2 est la seule qui touche au chemin critique du jeu pour tous les utilisateurs, y compris ceux qui n'allument jamais le no-anim. Son premier test — « sans transformateur, le flux descendant est relayé tel quel » — passe déjà avant l'implémentation : c'est voulu, il fixe la non-régression et doit continuer de passer après.
