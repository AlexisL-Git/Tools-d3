# Socle de lecture — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire un sniffer qui attache Frida à un client Dofus 3, capture le flux réseau, détermine s'il est chiffré, et — s'il ne l'est pas — le décode en messages protobuf nommés.

**Architecture:** Un proxy TCP local en interception. Frida sert uniquement à réécrire la `sockaddr` de `connect` pour rediriger le client vers `127.0.0.1:<port>` ; le client annonce sa vraie destination par une ligne `CONNECT host:port`, et un `net.Server` Node relaie dans les deux sens en lisant tout au passage. Au-dessus, un `codec` de fonctions pures (réassemblage de trames, décodage d'enveloppe protobuf, résolution du `type_url`) entièrement testable hors ligne, et un module `capture` d'enregistrement/rejeu sur disque qui rend tout le reste déterministe sans lancer le jeu.

**Origine du design :** technique reprise de `back/dofus.js` du dépôt public `krm35/dofus-multi`, qui est l'amont du produit payant. Le dépôt public contient le squelette du launcher (auth Ankama, gestion de comptes, WS, lancement multi-compte) mais **aucune des six features** — celles-ci ne vivent que dans `index.jsc`, en bytecode. Le squelette est repris ; les features sont à écrire.

**Tech Stack:** Node.js (CommonJS), `frida` (attach et injection d'agent), `protobufjs` (décodage), `node:test` (runner de tests intégré, zéro dépendance).

## Global Constraints

- **Node.js ≥ 18** (requis par les prebuilds `frida`).
- **CommonJS** (`require`), pas ESM — les addons `.node` réutilisés plus tard se chargent ainsi sans friction.
- **Windows x64 uniquement.** Aucun support multi-plateforme.
- **Aucun appel réseau sortant** depuis le launcher. Pas de télémétrie, pas de vérification de version, pas de phone-home. C'est une exigence directe du projet : on remplace un produit qui en fait.
- **Aucune évasion anti-cheat.** Hors périmètre par décision explicite (spec §2). Ne pas hooker `CreateProcessW`, `gethostname`, `CreateFileW`, ni masquer Frida de l'énumération des process.
- **Tests via `node --test`.** Pas de framework externe. Le script est `node --test` sans argument : sous Node 24, passer `test/` fait interpréter le chemin comme un module à charger et échoue. L'auto-découverte trouve `**/*.test.js` et ignore `node_modules`.
- Le jeu de `.proto` de référence vit dans `C:\Users\Utilisateur\.cache\game\` et `...\connection\`. Il est **lu**, jamais modifié.
- Les captures vont dans `captures/`, déjà exclu par `.gitignore`. Elles contiennent des données de compte — ne jamais les committer.

---

### Task 1: Scaffolding du projet et harnais de test

**Files:**
- Create: `package.json`
- Create: `test/harness.test.js`

**Interfaces:**
- Consumes: rien
- Produces: la commande `npm test` exécutant `node --test test/`

- [ ] **Step 1: Écrire le test qui valide le harnais**

`test/harness.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

test('le harnais de test fonctionne', () => {
  assert.strictEqual(1 + 1, 2);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/`
Expected: FAIL — aucun `package.json`, le dossier `test/` n'existe pas encore selon le contexte d'exécution. Si Node exécute quand même le test, passer directement au Step 3.

- [ ] **Step 3: Créer le package.json**

```json
{
  "name": "mm",
  "version": "0.1.0",
  "private": true,
  "description": "Launcher multi-compte Dofus 3",
  "main": "src/index.js",
  "scripts": {
    "test": "node --test test/",
    "sniff": "node src/cli/sniff.js",
    "dump": "node src/cli/dump.js",
    "analyze": "node src/cli/analyze.js"
  },
  "engines": {
    "node": ">=18"
  },
  "license": "UNLICENSED"
}
```

- [ ] **Step 4: Installer les dépendances**

Run: `npm install frida protobufjs`

Ne pas figer les versions à la main : committer le `package.json` et le `package-lock.json` tels que npm les produit.

Si `frida` échoue à installer (absence de prebuild pour la version de Node locale), c'est un blocage réel à remonter — ne pas contourner en compilant depuis les sources sans en discuter.

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS, 1 test

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json test/harness.test.js
git commit -m "chore: scaffolding du projet et harnais de test"
```

---

### Task 2: Réassemblage de trames à préfixe varint

Le flux TCP n'est pas aligné sur les messages : une trame peut être coupée en deux, ou deux trames arriver dans un seul buffer. Ce module reconstitue les trames. Il est écrit **avant** le spike parce que ses tests sont synthétiques et ne dépendent pas du format réel — le Step final du spike (Task 5) confirmera ou infirmera l'hypothèse du préfixe varint.

**Files:**
- Create: `src/codec/framing.js`
- Test: `test/framing.test.js`

**Interfaces:**
- Consumes: rien
- Produces:
  - `readVarint(buf, offset) → {value: number, bytes: number} | null` — `null` si le varint est incomplet
  - `writeVarint(value) → Buffer`
  - `class FrameReassembler` avec `push(chunk: Buffer) → Buffer[]` (les trames complètes, sans leur préfixe) et la propriété `pending: number` (octets en attente)

- [ ] **Step 1: Écrire les tests qui échouent**

`test/framing.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { readVarint, writeVarint, FrameReassembler } = require('../src/codec/framing');

function frame(payload) {
  return Buffer.concat([writeVarint(payload.length), payload]);
}

test('writeVarint/readVarint font un aller-retour', () => {
  for (const n of [0, 1, 127, 128, 300, 16383, 16384, 1000000]) {
    const buf = writeVarint(n);
    assert.deepStrictEqual(readVarint(buf, 0), { value: n, bytes: buf.length }, `valeur ${n}`);
  }
});

test('readVarint retourne null sur un varint incomplet', () => {
  assert.strictEqual(readVarint(Buffer.from([0x80]), 0), null);
});

test('une trame complète dans un seul chunk', () => {
  const r = new FrameReassembler();
  const out = r.push(frame(Buffer.from('hello')));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].toString(), 'hello');
  assert.strictEqual(r.pending, 0);
});

test('deux trames dans un seul chunk', () => {
  const r = new FrameReassembler();
  const out = r.push(Buffer.concat([frame(Buffer.from('aa')), frame(Buffer.from('bbb'))]));
  assert.deepStrictEqual(out.map(String), ['aa', 'bbb']);
});

test('une trame coupée octet par octet est reconstituée', () => {
  const payload = Buffer.alloc(300, 0x41);
  const full = frame(payload);
  const r = new FrameReassembler();
  const collected = [];
  for (const byte of full) collected.push(...r.push(Buffer.from([byte])));
  assert.strictEqual(collected.length, 1);
  assert.ok(collected[0].equals(payload));
});

test('un préfixe varint coupé entre deux chunks est reconstitué', () => {
  const payload = Buffer.alloc(300, 0x42);
  const full = frame(payload);
  const r = new FrameReassembler();
  assert.deepStrictEqual(r.push(full.subarray(0, 1)), []);
  const out = r.push(full.subarray(1));
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].equals(payload));
});

test('une trame surdimensionnée lève une erreur', () => {
  const r = new FrameReassembler({ maxFrame: 16 });
  assert.throws(() => r.push(frame(Buffer.alloc(64))), /trame trop grande/);
});

test('pending reflète les octets en attente', () => {
  const r = new FrameReassembler();
  r.push(frame(Buffer.alloc(100)).subarray(0, 10));
  assert.strictEqual(r.pending, 10);
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/codec/framing'`

- [ ] **Step 3: Écrire l'implémentation minimale**

`src/codec/framing.js` :

```js
'use strict';

const DEFAULT_MAX_FRAME = 8 * 1024 * 1024;

function readVarint(buf, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result += (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) return { value: result, bytes: pos - offset };
    shift += 7;
    if (shift > 35) throw new Error('varint trop long');
  }
  return null;
}

function writeVarint(value) {
  const bytes = [];
  let v = value;
  do {
    let byte = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) byte |= 0x80;
    bytes.push(byte);
  } while (v > 0);
  return Buffer.from(bytes);
}

class FrameReassembler {
  constructor({ maxFrame = DEFAULT_MAX_FRAME } = {}) {
    this._buf = Buffer.alloc(0);
    this._maxFrame = maxFrame;
  }

  get pending() {
    return this._buf.length;
  }

  push(chunk) {
    this._buf = this._buf.length === 0 ? chunk : Buffer.concat([this._buf, chunk]);
    const frames = [];
    for (;;) {
      const header = readVarint(this._buf, 0);
      if (header === null) break;
      if (header.value > this._maxFrame) {
        throw new Error(`trame trop grande: ${header.value} octets`);
      }
      const total = header.bytes + header.value;
      if (this._buf.length < total) break;
      frames.push(Buffer.from(this._buf.subarray(header.bytes, total)));
      this._buf = Buffer.from(this._buf.subarray(total));
    }
    return frames;
  }
}

module.exports = { readVarint, writeVarint, FrameReassembler, DEFAULT_MAX_FRAME };
```

`result` est calculé avec des multiplications plutôt que des décalages binaires : en JavaScript, `<<` opère sur 32 bits signés et corromprait silencieusement les grandes valeurs.

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/codec/framing.js test/framing.test.js
git commit -m "feat(codec): réassemblage de trames à préfixe varint"
```

---

### Task 3: Format de capture sur disque (enregistrement et rejeu)

Rend tout ce qui est au-dessus de l'`injector` rejouable hors ligne. C'est aussi la base de l'enregistreur corrélé du plan 2.

**Files:**
- Create: `src/capture/format.js`
- Create: `src/capture/recorder.js`
- Create: `src/capture/player.js`
- Test: `test/capture.test.js`

**Interfaces:**
- Consumes: rien
- Produces:
  - `encodeRecord({direction, timestamp, payload}) → Buffer`
  - `decodeRecords(buf) → Array<{direction, timestamp, payload}>` — `direction` vaut `'in'` ou `'out'`, `timestamp` est un entier en millisecondes epoch
  - `class Recorder` : `constructor(filePath)`, `write(direction, payload)`, `close()`
  - `class Player` : `static load(filePath) → Player`, `records() → Array<record>`

Format d'un enregistrement, en petit-boutien :

```
[u8 direction]  0 = in (recv), 1 = out (send)
[f64 timestamp] millisecondes epoch
[u32 length]
[bytes payload]
```

- [ ] **Step 1: Écrire les tests qui échouent**

`test/capture.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encodeRecord, decodeRecords } = require('../src/capture/format');
const { Recorder } = require('../src/capture/recorder');
const { Player } = require('../src/capture/player');

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-')), 'capture.bin');
}

test('un enregistrement fait un aller-retour', () => {
  const rec = { direction: 'in', timestamp: 1755400000000, payload: Buffer.from('abc') };
  const out = decodeRecords(encodeRecord(rec));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].direction, 'in');
  assert.strictEqual(out[0].timestamp, 1755400000000);
  assert.strictEqual(out[0].payload.toString(), 'abc');
});

test('plusieurs enregistrements concaténés se décodent dans l ordre', () => {
  const a = encodeRecord({ direction: 'in', timestamp: 1, payload: Buffer.from('aa') });
  const b = encodeRecord({ direction: 'out', timestamp: 2, payload: Buffer.from('bbb') });
  const out = decodeRecords(Buffer.concat([a, b]));
  assert.deepStrictEqual(out.map((r) => r.direction), ['in', 'out']);
  assert.deepStrictEqual(out.map((r) => r.payload.toString()), ['aa', 'bbb']);
});

test('un enregistrement tronqué est ignoré plutôt que de faire planter', () => {
  const full = encodeRecord({ direction: 'in', timestamp: 1, payload: Buffer.from('abcdef') });
  const out = decodeRecords(full.subarray(0, full.length - 2));
  assert.deepStrictEqual(out, []);
});

test('une charge vide est supportée', () => {
  const out = decodeRecords(encodeRecord({ direction: 'out', timestamp: 5, payload: Buffer.alloc(0) }));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].payload.length, 0);
});

test('Recorder écrit un fichier que Player relit', () => {
  const file = tmpFile();
  const rec = new Recorder(file);
  rec.write('in', Buffer.from('un'));
  rec.write('out', Buffer.from('deux'));
  rec.close();

  const records = Player.load(file).records();
  assert.deepStrictEqual(records.map((r) => r.direction), ['in', 'out']);
  assert.deepStrictEqual(records.map((r) => r.payload.toString()), ['un', 'deux']);
  assert.ok(records[0].timestamp > 0);
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/capture/format'`

- [ ] **Step 3: Écrire l'implémentation minimale**

`src/capture/format.js` :

```js
'use strict';

const HEADER_SIZE = 1 + 8 + 4;

function encodeRecord({ direction, timestamp, payload }) {
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt8(direction === 'in' ? 0 : 1, 0);
  header.writeDoubleLE(timestamp, 1);
  header.writeUInt32LE(payload.length, 9);
  return Buffer.concat([header, payload]);
}

function decodeRecords(buf) {
  const records = [];
  let offset = 0;
  while (offset + HEADER_SIZE <= buf.length) {
    const direction = buf.readUInt8(offset) === 0 ? 'in' : 'out';
    const timestamp = buf.readDoubleLE(offset + 1);
    const length = buf.readUInt32LE(offset + 9);
    const start = offset + HEADER_SIZE;
    if (start + length > buf.length) break;
    records.push({ direction, timestamp, payload: Buffer.from(buf.subarray(start, start + length)) });
    offset = start + length;
  }
  return records;
}

module.exports = { encodeRecord, decodeRecords, HEADER_SIZE };
```

`src/capture/recorder.js` :

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { encodeRecord } = require('./format');

class Recorder {
  constructor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this._fd = fs.openSync(filePath, 'w');
    this.filePath = filePath;
    this.count = 0;
  }

  write(direction, payload) {
    fs.writeSync(this._fd, encodeRecord({ direction, timestamp: Date.now(), payload }));
    this.count += 1;
  }

  close() {
    if (this._fd !== null) {
      fs.closeSync(this._fd);
      this._fd = null;
    }
  }
}

module.exports = { Recorder };
```

`src/capture/player.js` :

```js
'use strict';
const fs = require('node:fs');
const { decodeRecords } = require('./format');

class Player {
  constructor(records) {
    this._records = records;
  }

  static load(filePath) {
    return new Player(decodeRecords(fs.readFileSync(filePath)));
  }

  records() {
    return this._records;
  }
}

module.exports = { Player };
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS, 13 tests au total

- [ ] **Step 5: Commit**

```bash
git add src/capture test/capture.test.js
git commit -m "feat(capture): format d'enregistrement et rejeu sur disque"
```

---

### Task 4: Proxy TCP en interception et redirection Frida

Premier contact avec le jeu. Technique reprise de `back/dofus.js` du dépôt public.

Le proxy est un `net.Server` ordinaire : entièrement testable **sans Dofus et sans Frida**, en lui parlant avec deux sockets Node. C'est ce qui rend cette tâche sérieusement couverte par des tests malgré son rôle système.

**Files:**
- Create: `src/proxy/server.js`
- Create: `src/injector/agent.js`
- Create: `src/injector/index.js`
- Create: `src/cli/dump.js`
- Test: `test/proxy.test.js`
- Test: `test/injector.test.js`

**Interfaces:**
- Consumes: `Recorder` de la Task 3
- Produces:
  - `createProxy({port, onData}) → Promise<{port, close(): Promise<void>}>` — `onData(direction, Buffer)` avec `direction` valant `'out'` (client → serveur) ou `'in'` (serveur → client)
  - `parseConnectLine(buf) → {host, port, rest: Buffer} | null`
  - `findDofusProcesses() → Promise<Array<{pid, name}>>`
  - `redirect(pid, proxyPort) → Promise<{detach(): Promise<void>}>`

`src/injector/agent.js` est le code exécuté **dans** le process Dofus. Il n'est pas requis par Node : il est lu comme texte et envoyé à Frida.

- [ ] **Step 1: Écrire le test qui échoue**

Le proxy est testable de bout en bout sans Dofus : on lui parle avec un socket Node qui joue le client, et on fait pointer la ligne `CONNECT` vers un second serveur Node qui joue le serveur Ankama.

`test/proxy.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { createProxy, parseConnectLine } = require('../src/proxy/server');

function listenEcho(onReceive) {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      sock.on('data', (d) => {
        onReceive(d);
        sock.write(Buffer.concat([Buffer.from('R:'), d]));
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

test('parseConnectLine extrait hôte et port', () => {
  const out = parseConnectLine(Buffer.from('CONNECT 10.0.0.1:5555 HTTP/1.0 '));
  assert.strictEqual(out.host, '10.0.0.1');
  assert.strictEqual(out.port, 5555);
});

test('parseConnectLine rend null sur autre chose', () => {
  assert.strictEqual(parseConnectLine(Buffer.from([0x01, 0x02, 0x03])), null);
});

test('parseConnectLine rend le reliquat après la ligne CONNECT', () => {
  const buf = Buffer.concat([Buffer.from('CONNECT 1.2.3.4:99 HTTP/1.0 '), Buffer.from([0xaa, 0xbb])]);
  assert.deepStrictEqual([...parseConnectLine(buf).rest], [0xaa, 0xbb]);
});

test('le proxy relaie dans les deux sens et observe les octets', async () => {
  const seenByServer = [];
  const { srv, port: upstreamPort } = await listenEcho((d) => seenByServer.push(d));

  const observed = [];
  const proxy = await createProxy({ port: 0, onData: (dir, buf) => observed.push([dir, buf]) });

  const client = net.connect(proxy.port, '127.0.0.1');
  await new Promise((r) => client.once('connect', r));

  client.write(`CONNECT 127.0.0.1:${upstreamPort} HTTP/1.0 `);
  await new Promise((r) => setTimeout(r, 50));
  client.write(Buffer.from('ping'));

  const reply = await new Promise((r) => client.once('data', r));
  assert.strictEqual(reply.toString(), 'R:ping');
  assert.strictEqual(Buffer.concat(seenByServer).toString(), 'ping');

  const out = observed.filter(([d]) => d === 'out').map(([, b]) => b.toString()).join('');
  const inn = observed.filter(([d]) => d === 'in').map(([, b]) => b.toString()).join('');
  assert.strictEqual(out, 'ping', 'le sens client→serveur doit être observé');
  assert.strictEqual(inn, 'R:ping', 'le sens serveur→client doit être observé');

  client.destroy();
  await proxy.close();
  srv.close();
});

test('les octets envoyés avant la connexion amont sont mis en file et non perdus', async () => {
  const seenByServer = [];
  const { srv, port: upstreamPort } = await listenEcho((d) => seenByServer.push(d));
  const proxy = await createProxy({ port: 0, onData: () => {} });

  const client = net.connect(proxy.port, '127.0.0.1');
  await new Promise((r) => client.once('connect', r));

  // CONNECT et charge utile dans le même write : la charge arrive avant que l'amont soit prêt
  client.write(Buffer.concat([
    Buffer.from(`CONNECT 127.0.0.1:${upstreamPort} HTTP/1.0 `),
    Buffer.from('early'),
  ]));

  const reply = await new Promise((r) => client.once('data', r));
  assert.strictEqual(reply.toString(), 'R:early');

  client.destroy();
  await proxy.close();
  srv.close();
});
```

`test/injector.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const injector = require('../src/injector');

test('le module injector expose son interface', () => {
  assert.strictEqual(typeof injector.redirect, 'function');
  assert.strictEqual(typeof injector.findDofusProcesses, 'function');
  assert.strictEqual(typeof injector.agentSource, 'function');
});

test('la source de l agent hooke connect et réécrit la sockaddr', () => {
  const src = injector.agentSource(9999);
  assert.ok(src.includes("'connect'"), 'doit hooker connect');
  assert.ok(src.includes('writeByteArray'), 'doit réécrire la sockaddr');
  assert.ok(src.includes('9999'), 'doit injecter le port du proxy');
});

test('l agent ne contient aucune évasion anti-cheat', () => {
  const src = injector.agentSource(9999);
  for (const interdit of ['CreateProcessW', 'gethostname', 'GetHostNameW', 'CreateFileW', 'IOPlatformUUID']) {
    assert.ok(!src.includes(interdit), `hors périmètre : ${interdit}`);
  }
});

test('findDofusProcesses ne lève pas si aucun Dofus ne tourne', async () => {
  const found = await injector.findDofusProcesses();
  assert.ok(Array.isArray(found));
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/proxy/server'`

- [ ] **Step 3: Écrire le proxy**

`src/proxy/server.js` :

```js
'use strict';
const net = require('node:net');

const CONNECT_RE = /^CONNECT ([0-9A-Za-z_.\-]+):(\d{1,5}) HTTP\/1\.0 /;

function parseConnectLine(buf) {
  const head = buf.subarray(0, Math.min(buf.length, 128)).toString('latin1');
  const m = CONNECT_RE.exec(head);
  if (m === null) return null;
  return {
    host: m[1],
    port: Number(m[2]),
    rest: Buffer.from(buf.subarray(Buffer.byteLength(m[0], 'latin1'))),
  };
}

function createProxy({ port = 0, host = '127.0.0.1', onData = () => {} } = {}) {
  const server = net.createServer((client) => {
    let upstream = null;
    let queue = [];

    client.on('data', (chunk) => {
      if (upstream === null) {
        const parsed = parseConnectLine(chunk);
        if (parsed === null) {
          // Pas encore de ligne CONNECT : on met en file jusqu'à en recevoir une.
          queue.push(chunk);
          return;
        }
        upstream = net.connect(parsed.port, parsed.host);

        upstream.on('connect', () => {
          for (const pending of queue) {
            onData('out', pending);
            upstream.write(pending);
          }
          queue = [];
        });

        upstream.on('data', (data) => {
          onData('in', data);
          client.write(data);
        });

        upstream.on('error', () => client.destroy());
        upstream.on('close', () => client.destroy());

        if (parsed.rest.length > 0) queue.push(parsed.rest);
        return;
      }

      if (upstream.connecting) {
        queue.push(chunk);
        return;
      }
      onData('out', chunk);
      upstream.write(chunk);
    });

    client.on('error', () => {});
    client.on('close', () => {
      if (upstream !== null) upstream.destroy();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        port: server.address().port,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

module.exports = { createProxy, parseConnectLine };
```

- [ ] **Step 4: Écrire la redirection Frida**

`src/injector/agent.js` exporte une **fonction** qui produit la source de l'agent, parce que le port du proxy doit y être interpolé.

```js
'use strict';

// Produit le script exécuté à l'intérieur du process Dofus par Frida.
// Rôle unique : rediriger connect() vers le proxy local et lui annoncer
// la destination réelle. Aucune lecture, aucune modification du flux ici.
function agentSource(proxyPort) {
  return `
    const connect_p = Module.getExportByName(null, 'connect');
    const send_p = Module.getExportByName(null, 'send');
    const socket_send = new NativeFunction(send_p, 'int', ['int', 'pointer', 'int', 'int']);

    Interceptor.attach(connect_p, {
      onEnter: function (args) {
        this.sockfd = args[0];
        const sockaddr_p = args[1];
        this.port = 256 * sockaddr_p.add(2).readU8() + sockaddr_p.add(3).readU8();
        this.addr = '';
        for (let i = 0; i < 4; i++) {
          this.addr += sockaddr_p.add(4 + i).readU8();
          if (i < 3) this.addr += '.';
        }
        const newport = ${proxyPort};
        sockaddr_p.add(2).writeByteArray([Math.floor(newport / 256), newport % 256]);
        sockaddr_p.add(4).writeByteArray([127, 0, 0, 1]);
        this.shouldSend = true;
      },
      onLeave: function () {
        if (!this.shouldSend) return;
        const line = 'CONNECT ' + this.addr + ':' + this.port + ' HTTP/1.0 ';
        const buf = Memory.allocUtf8String(line);
        socket_send(this.sockfd.toInt32(), buf, line.length, 0);
      }
    });

    send({ kind: 'ready', proxyPort: ${proxyPort} });
  `;
}

module.exports = { agentSource };
```

`src/injector/index.js` :

```js
'use strict';
const frida = require('frida');
const { agentSource } = require('./agent');

const DOFUS_PROCESS_NAMES = ['Dofus.exe', 'dofus.exe'];

async function findDofusProcesses() {
  const device = await frida.getLocalDevice();
  const processes = await device.enumerateProcesses();
  return processes
    .filter((p) => DOFUS_PROCESS_NAMES.some((n) => n.toLowerCase() === p.name.toLowerCase()))
    .map((p) => ({ pid: p.pid, name: p.name }));
}

async function redirect(pid, proxyPort, { onReady = () => {} } = {}) {
  const session = await frida.attach(pid);
  const script = await session.createScript(agentSource(proxyPort));

  script.message.connect((message) => {
    if (message.type === 'error') {
      console.error(`agent frida: ${message.description}`);
      return;
    }
    if ((message.payload || {}).kind === 'ready') onReady(message.payload);
  });

  await script.load();

  return {
    async detach() {
      await script.unload().catch(() => {});
      await session.detach().catch(() => {});
    },
  };
}

module.exports = { redirect, findDofusProcesses, agentSource };
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS, 23 tests au total

- [ ] **Step 6: Écrire la CLI de dump**

`src/cli/dump.js` :

```js
'use strict';
const path = require('node:path');
const { createProxy } = require('../proxy/server');
const { redirect, findDofusProcesses } = require('../injector');
const { Recorder } = require('../capture/recorder');

async function main() {
  const seconds = Number(process.argv[2] || 30);
  const processes = await findDofusProcesses();
  if (processes.length === 0) {
    console.error('Aucun process Dofus trouvé. Lance le jeu et connecte-toi à un personnage.');
    process.exit(1);
  }
  const target = processes[0];

  const file = path.join('captures', `dump-${target.pid}-${Date.now()}.bin`);
  const recorder = new Recorder(file);

  const proxy = await createProxy({
    port: 0,
    onData: (direction, buf) => recorder.write(direction, buf),
  });
  console.log(`Proxy sur 127.0.0.1:${proxy.port}`);

  const session = await redirect(target.pid, proxy.port, {
    onReady: (info) => console.log('agent prêt:', info),
  });
  console.log(`Redirection de ${target.name} (pid ${target.pid}) pendant ${seconds}s...`);
  console.log('IMPORTANT: le hook ne prend effet que sur les NOUVELLES connexions.');
  console.log('Change de map, ou reconnecte le personnage, pour forcer un connect().');

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

  await session.detach();
  await proxy.close();
  recorder.close();
  console.log(`${recorder.count} enregistrements capturés dans ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 7: Commit**

```bash
git add src/proxy src/injector src/cli/dump.js test/proxy.test.js test/injector.test.js
git commit -m "feat(proxy): proxy TCP en interception et redirection connect via Frida"
```

---

### Task 5: Verdict sur le chiffrement — le spike bloquant

Répond à la question qui conditionne le reste du projet. L'outil est écrit pour être **rejouable** à chaque patch, pas jeté après usage.

Deux signaux, dont un décisif :

- **Entropie de Shannon.** Un flux chiffré est indiscernable du bruit et tend vers 8,0 bits/octet. Du protobuf en clair contient beaucoup de petits entiers et d'octets nuls, et tourne typiquement entre 4,5 et 6,5. C'est le signal décisif.
- **Taux de consommation par le framing.** On tente le réassemblage varint sur la capture : si le flux est effectivement des trames à préfixe varint, on consomme la quasi-totalité des octets en trames de tailles plausibles.

**Files:**
- Create: `src/analysis/entropy.js`
- Create: `src/analysis/framingProbe.js`
- Create: `src/cli/analyze.js`
- Test: `test/analysis.test.js`

**Interfaces:**
- Consumes: `FrameReassembler` (Task 2), `Player` (Task 3)
- Produces:
  - `shannonEntropy(buf) → number` (bits par octet, 0 à 8)
  - `probeFraming(buffers) → {frames, bytesConsumed, bytesTotal, ratio, errors}`
  - `verdict({entropy, ratio}) → {conclusion: 'clair'|'chiffré'|'indéterminé', reason: string}`

- [ ] **Step 1: Écrire les tests qui échouent**

`test/analysis.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { shannonEntropy } = require('../src/analysis/entropy');
const { probeFraming, verdict } = require('../src/analysis/framingProbe');
const { writeVarint } = require('../src/codec/framing');

test('l entropie d un buffer constant vaut 0', () => {
  assert.strictEqual(shannonEntropy(Buffer.alloc(1000, 0x41)), 0);
});

test('l entropie de données aléatoires approche 8', () => {
  const e = shannonEntropy(crypto.randomBytes(65536));
  assert.ok(e > 7.9, `attendu > 7.9, obtenu ${e}`);
});

test('l entropie d un buffer vide vaut 0', () => {
  assert.strictEqual(shannonEntropy(Buffer.alloc(0)), 0);
});

test('probeFraming consomme tout un flux bien formé', () => {
  const payloads = [Buffer.alloc(10, 1), Buffer.alloc(200, 2), Buffer.alloc(30, 3)];
  const stream = Buffer.concat(payloads.map((p) => Buffer.concat([writeVarint(p.length), p])));
  const r = probeFraming([stream]);
  assert.strictEqual(r.frames, 3);
  assert.strictEqual(r.bytesTotal, stream.length);
  assert.ok(r.ratio > 0.99, `ratio ${r.ratio}`);
});

test('probeFraming consomme peu sur du bruit aléatoire', () => {
  const r = probeFraming([crypto.randomBytes(65536)]);
  assert.ok(r.ratio < 0.9, `ratio ${r.ratio} — du bruit ne devrait pas se réassembler proprement`);
});

test('verdict conclut au clair sur entropie basse et ratio haut', () => {
  assert.strictEqual(verdict({ entropy: 5.2, ratio: 0.99 }).conclusion, 'clair');
});

test('verdict conclut au chiffré sur entropie haute', () => {
  assert.strictEqual(verdict({ entropy: 7.95, ratio: 0.2 }).conclusion, 'chiffré');
});

test('verdict reste indéterminé sur des signaux contradictoires', () => {
  assert.strictEqual(verdict({ entropy: 7.95, ratio: 0.99 }).conclusion, 'indéterminé');
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/analysis/entropy'`

- [ ] **Step 3: Écrire l'implémentation**

`src/analysis/entropy.js` :

```js
'use strict';

function shannonEntropy(buf) {
  if (buf.length === 0) return 0;
  const counts = new Array(256).fill(0);
  for (const byte of buf) counts[byte] += 1;
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / buf.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

module.exports = { shannonEntropy };
```

`src/analysis/framingProbe.js` :

```js
'use strict';
const { FrameReassembler } = require('../codec/framing');

function probeFraming(buffers) {
  const reassembler = new FrameReassembler({ maxFrame: 1 << 20 });
  let frames = 0;
  let bytesConsumed = 0;
  let bytesTotal = 0;
  let errors = 0;

  for (const buf of buffers) {
    bytesTotal += buf.length;
    try {
      for (const frame of reassembler.push(buf)) {
        frames += 1;
        bytesConsumed += frame.length;
      }
    } catch (err) {
      errors += 1;
      break;
    }
  }

  return {
    frames,
    bytesConsumed,
    bytesTotal,
    ratio: bytesTotal === 0 ? 0 : bytesConsumed / bytesTotal,
    errors,
  };
}

const ENTROPY_CHIFFRE = 7.5;
const ENTROPY_CLAIR = 7.0;
const RATIO_BON = 0.9;

function verdict({ entropy, ratio }) {
  if (entropy < ENTROPY_CLAIR && ratio >= RATIO_BON) {
    return {
      conclusion: 'clair',
      reason: `entropie ${entropy.toFixed(2)} bits/octet et ${(ratio * 100).toFixed(1)}% du flux réassemblé en trames varint`,
    };
  }
  if (entropy >= ENTROPY_CHIFFRE && ratio < RATIO_BON) {
    return {
      conclusion: 'chiffré',
      reason: `entropie ${entropy.toFixed(2)} bits/octet, proche du bruit, et seulement ${(ratio * 100).toFixed(1)}% réassemblé`,
    };
  }
  return {
    conclusion: 'indéterminé',
    reason: `signaux contradictoires: entropie ${entropy.toFixed(2)}, ratio ${(ratio * 100).toFixed(1)}%`,
  };
}

module.exports = { probeFraming, verdict, ENTROPY_CHIFFRE, ENTROPY_CLAIR, RATIO_BON };
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS, 31 tests au total

- [ ] **Step 5: Écrire la CLI d'analyse**

`src/cli/analyze.js` :

```js
'use strict';
const { Player } = require('../capture/player');
const { shannonEntropy } = require('../analysis/entropy');
const { probeFraming, verdict } = require('../analysis/framingProbe');

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: npm run analyze -- <captures/dump-....bin>');
    process.exit(1);
  }

  const records = Player.load(file).records();
  if (records.length === 0) {
    console.error('Capture vide. Le jeu était-il connecté à un personnage pendant le dump ?');
    process.exit(1);
  }

  const payloads = records.map((r) => r.payload);
  const all = Buffer.concat(payloads);
  const entropy = shannonEntropy(all);
  const probe = probeFraming(payloads);
  const v = verdict({ entropy, ratio: probe.ratio });

  console.log(`enregistrements   : ${records.length}`);
  console.log(`octets            : ${all.length}`);
  console.log(`entropie          : ${entropy.toFixed(3)} bits/octet`);
  console.log(`trames réassemblées: ${probe.frames}`);
  console.log(`ratio consommé    : ${(probe.ratio * 100).toFixed(1)}%`);
  console.log(`erreurs framing   : ${probe.errors}`);
  console.log('');
  console.log(`VERDICT: ${v.conclusion.toUpperCase()} — ${v.reason}`);
  console.log('');
  console.log('premiers octets:');
  console.log(all.subarray(0, 64).toString('hex').replace(/(..)/g, '$1 '));
}

main();
```

- [ ] **Step 6: Exécuter le spike en conditions réelles**

C'est l'étape manuelle décisive.

1. Lancer Dofus et se connecter à un personnage.
2. `npm run dump -- 30` puis se déplacer, ouvrir l'inventaire, discuter — générer du trafic.
3. `npm run analyze -- captures/dump-<pid>-<ts>.bin`

Interpréter le résultat :

- **`CLAIR`** → l'approche du plan tient telle quelle. Passer à la Task 6.
- **`CHIFFRÉ`** → hooker `recv` ne suffit pas. Le plan 2 devra hooker les méthodes de sérialisation IL2CPP dans `GameAssembly.dll`, ce qui est nettement plus coûteux. **Arrêter et revenir vers l'utilisateur avec les chiffres** : c'est un point de décision qui peut faire basculer vers l'approche hybride écartée en conception.
- **`INDÉTERMINÉ`** → refaire le dump plus longtemps et avec plus d'activité. Si le résultat persiste, le framing n'est probablement pas un préfixe varint simple : inspecter le hexdump à la main avant d'aller plus loin.

- [ ] **Step 7: Commit**

```bash
git add src/analysis src/cli/analyze.js test/analysis.test.js
git commit -m "feat(analysis): sonde d'entropie et de framing, verdict sur le chiffrement"
```

---

### Task 6: Registre de types et décodage d'enveloppe

**Ne commencer que si la Task 5 a rendu `CLAIR`.**

**Files:**
- Create: `src/codec/registry.js`
- Create: `src/codec/envelope.js`
- Create: `test/fixtures/proto/Envelope.proto`
- Create: `test/fixtures/proto/Sample.proto`
- Test: `test/envelope.test.js`

**Interfaces:**
- Consumes: rien du code applicatif
- Produces:
  - `loadRegistry(protoDirs: string[]) → Promise<Registry>`
  - `Registry.typeNameFromUrl(typeUrl) → string`
  - `Registry.decodeAny(any) → {name: string, payload: object|null, unknown: boolean}`
  - `decodeEnvelope(registry, frame) → {kind: 'event'|'request'|'response', uid: number|null, name: string, payload: object|null, unknown: boolean}`

Les fixtures sont des `.proto` minimaux committés dans le dépôt, pour que les tests soient déterministes et n'aient pas besoin du `.cache` de l'utilisateur.

- [ ] **Step 1: Écrire les fixtures**

`test/fixtures/proto/Envelope.proto` :

```proto
syntax = "proto3";

import "google/protobuf/any.proto";

message Message {
  oneof dzlw {
    Request request = 2;
    Response response = 3;
    Event event = 1;
  }
}

message Event    { google.protobuf.Any content = 1; }
message Response { int32 uid = 2; google.protobuf.Any content = 1; }
message Request  { int32 uid = 2; google.protobuf.Any content = 1; }
```

`test/fixtures/proto/Sample.proto` :

```proto
syntax = "proto3";

message hdv {
  hdt dzpx = 1;
  int32 dzpy = 2;
  enum hdt {
    HDT_DDSU = 0;
    HDT_DDSV = 1;
  }
}
```

- [ ] **Step 2: Écrire les tests qui échouent**

`test/envelope.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const protobuf = require('protobufjs');
const { loadRegistry } = require('../src/codec/registry');
const { decodeEnvelope } = require('../src/codec/envelope');

const FIXTURES = path.join(__dirname, 'fixtures', 'proto');

async function buildFrame(kind, { uid = 0, typeName = 'hdv', body = { dzpx: 1, dzpy: 42 } } = {}) {
  const root = await protobuf.load([
    path.join(FIXTURES, 'Envelope.proto'),
    path.join(FIXTURES, 'Sample.proto'),
  ]);
  const Message = root.lookupType('Message');
  const Inner = root.lookupType(typeName);
  const any = {
    type_url: `type.googleapis.com/${typeName}`,
    value: Inner.encode(Inner.create(body)).finish(),
  };
  const content = kind === 'event' ? { content: any } : { uid, content: any };
  return Buffer.from(Message.encode(Message.create({ [kind]: content })).finish());
}

test('typeNameFromUrl extrait le nom du type', async () => {
  const registry = await loadRegistry([FIXTURES]);
  assert.strictEqual(registry.typeNameFromUrl('type.googleapis.com/hdv'), 'hdv');
  assert.strictEqual(registry.typeNameFromUrl('hdv'), 'hdv');
});

test('décode un Event et résout son type', async () => {
  const registry = await loadRegistry([FIXTURES]);
  const out = decodeEnvelope(registry, await buildFrame('event'));
  assert.strictEqual(out.kind, 'event');
  assert.strictEqual(out.name, 'hdv');
  assert.strictEqual(out.unknown, false);
  assert.strictEqual(out.uid, null);
  assert.strictEqual(out.payload.dzpy, 42);
});

test('décode un Request et remonte son uid', async () => {
  const registry = await loadRegistry([FIXTURES]);
  const out = decodeEnvelope(registry, await buildFrame('request', { uid: 7 }));
  assert.strictEqual(out.kind, 'request');
  assert.strictEqual(out.uid, 7);
  assert.strictEqual(out.name, 'hdv');
});

test('décode un Response et remonte son uid', async () => {
  const registry = await loadRegistry([FIXTURES]);
  const out = decodeEnvelope(registry, await buildFrame('response', { uid: 99 }));
  assert.strictEqual(out.kind, 'response');
  assert.strictEqual(out.uid, 99);
});

test('un type inconnu est marqué unknown sans lever', async () => {
  const registry = await loadRegistry([FIXTURES]);
  const root = await protobuf.load([path.join(FIXTURES, 'Envelope.proto')]);
  const Message = root.lookupType('Message');
  const frame = Buffer.from(
    Message.encode(
      Message.create({
        event: { content: { type_url: 'type.googleapis.com/zzz', value: Buffer.from([0x08, 0x01]) } },
      })
    ).finish()
  );
  const out = decodeEnvelope(registry, frame);
  assert.strictEqual(out.unknown, true);
  assert.strictEqual(out.name, 'zzz');
  assert.strictEqual(out.payload, null);
});

test('une trame illisible lève une erreur explicite', async () => {
  const registry = await loadRegistry([FIXTURES]);
  assert.throws(() => decodeEnvelope(registry, Buffer.from([0xff, 0xff, 0xff])), /enveloppe/);
});
```

- [ ] **Step 3: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/codec/registry'`

- [ ] **Step 4: Écrire l'implémentation**

`src/codec/registry.js` :

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const protobuf = require('protobufjs');

class Registry {
  constructor(root) {
    this.root = root;
    this._cache = new Map();
  }

  typeNameFromUrl(typeUrl) {
    const slash = typeUrl.lastIndexOf('/');
    return slash === -1 ? typeUrl : typeUrl.slice(slash + 1);
  }

  lookup(name) {
    if (this._cache.has(name)) return this._cache.get(name);
    let type = null;
    try {
      type = this.root.lookupType(name);
    } catch (err) {
      type = null;
    }
    this._cache.set(name, type);
    return type;
  }

  decodeAny(any) {
    const name = this.typeNameFromUrl(any.type_url || any.typeUrl || '');
    const type = this.lookup(name);
    if (type === null) return { name, payload: null, unknown: true };
    return { name, payload: type.toObject(type.decode(any.value), { defaults: true }), unknown: false };
  }
}

async function loadRegistry(protoDirs) {
  const files = [];
  for (const dir of protoDirs) {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith('.proto')) files.push(path.join(dir, entry));
    }
  }
  if (files.length === 0) throw new Error(`aucun .proto trouvé dans ${protoDirs.join(', ')}`);
  const root = await protobuf.load(files);
  return new Registry(root);
}

module.exports = { loadRegistry, Registry };
```

`src/codec/envelope.js` :

```js
'use strict';

function decodeEnvelope(registry, frame) {
  const Message = registry.lookup('Message');
  if (Message === null) throw new Error("type 'Message' absent du registre");

  let msg;
  try {
    msg = Message.toObject(Message.decode(frame), { defaults: false });
  } catch (err) {
    throw new Error(`enveloppe illisible: ${err.message}`);
  }

  for (const kind of ['event', 'request', 'response']) {
    const box = msg[kind];
    if (!box) continue;
    const resolved = registry.decodeAny(box.content || {});
    return {
      kind,
      uid: kind === 'event' ? null : (box.uid ?? 0),
      name: resolved.name,
      payload: resolved.payload,
      unknown: resolved.unknown,
    };
  }

  throw new Error('enveloppe sans event, request ni response');
}

module.exports = { decodeEnvelope };
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS, 37 tests au total

- [ ] **Step 6: Commit**

```bash
git add src/codec/registry.js src/codec/envelope.js test/envelope.test.js test/fixtures
git commit -m "feat(codec): registre de types et décodage d'enveloppe protobuf"
```

---

### Task 7: Sniffer live et statistiques de messages inconnus

Assemble tout ce qui précède en l'outil utilisable. Le compteur de messages inconnus est le détecteur de patch décrit dans la spec §6.3.

**Files:**
- Create: `src/stats.js`
- Create: `src/cli/sniff.js`
- Test: `test/stats.test.js`

**Interfaces:**
- Consumes: `FrameReassembler`, `loadRegistry`, `decodeEnvelope`, `attach`, `Recorder`
- Produces:
  - `class MessageStats` : `record({name, unknown})`, `top(n) → Array<{name, count, unknown}>`, `unknownRatio() → number`, `total` (nombre)

- [ ] **Step 1: Écrire les tests qui échouent**

`test/stats.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { MessageStats } = require('../src/stats');

test('compte les messages par nom', () => {
  const s = new MessageStats();
  s.record({ name: 'hdv', unknown: false });
  s.record({ name: 'hdv', unknown: false });
  s.record({ name: 'abc', unknown: true });
  assert.strictEqual(s.total, 3);
  assert.deepStrictEqual(s.top(1), [{ name: 'hdv', count: 2, unknown: false }]);
});

test('unknownRatio vaut 0 sans message', () => {
  assert.strictEqual(new MessageStats().unknownRatio(), 0);
});

test('unknownRatio reflète la proportion d inconnus', () => {
  const s = new MessageStats();
  s.record({ name: 'a', unknown: false });
  s.record({ name: 'b', unknown: true });
  s.record({ name: 'c', unknown: true });
  assert.ok(Math.abs(s.unknownRatio() - 2 / 3) < 1e-9);
});

test('top trie par fréquence décroissante', () => {
  const s = new MessageStats();
  for (let i = 0; i < 5; i++) s.record({ name: 'beaucoup', unknown: false });
  for (let i = 0; i < 2; i++) s.record({ name: 'peu', unknown: false });
  assert.deepStrictEqual(s.top(2).map((r) => r.name), ['beaucoup', 'peu']);
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/stats'`

- [ ] **Step 3: Écrire l'implémentation**

`src/stats.js` :

```js
'use strict';

class MessageStats {
  constructor() {
    this._byName = new Map();
    this.total = 0;
    this.unknownCount = 0;
  }

  record({ name, unknown }) {
    this.total += 1;
    if (unknown) this.unknownCount += 1;
    const existing = this._byName.get(name);
    if (existing) {
      existing.count += 1;
    } else {
      this._byName.set(name, { name, count: 1, unknown: Boolean(unknown) });
    }
  }

  top(n) {
    return [...this._byName.values()].sort((a, b) => b.count - a.count).slice(0, n);
  }

  unknownRatio() {
    return this.total === 0 ? 0 : this.unknownCount / this.total;
  }
}

module.exports = { MessageStats };
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS, 41 tests au total

- [ ] **Step 5: Écrire la CLI du sniffer**

`src/cli/sniff.js` :

```js
'use strict';
const path = require('node:path');
const { createProxy } = require('../proxy/server');
const { redirect, findDofusProcesses } = require('../injector');
const { FrameReassembler } = require('../codec/framing');
const { loadRegistry } = require('../codec/registry');
const { decodeEnvelope } = require('../codec/envelope');
const { MessageStats } = require('../stats');
const { Recorder } = require('../capture/recorder');

const CACHE = path.join(process.env.USERPROFILE || '', '.cache');
const PROTO_DIRS = [path.join(CACHE, 'game'), path.join(CACHE, 'connection')];

const SEUIL_INCONNUS = 0.3;

async function main() {
  const registry = await loadRegistry(PROTO_DIRS);
  const processes = await findDofusProcesses();
  if (processes.length === 0) {
    console.error('Aucun process Dofus trouvé.');
    process.exit(1);
  }
  const target = processes[0];

  // Un réassembleur par sens : ce sont deux flux TCP distincts.
  const reassemblers = { in: new FrameReassembler(), out: new FrameReassembler() };
  const stats = new MessageStats();
  const recorder = new Recorder(path.join('captures', `sniff-${target.pid}-${Date.now()}.bin`));

  const proxy = await createProxy({
    port: 0,
    onData: (direction, buf) => {
      recorder.write(direction, buf);
      let frames;
      try {
        frames = reassemblers[direction].push(buf);
      } catch (err) {
        console.error(`framing (${direction}): ${err.message}`);
        return;
      }
      for (const frame of frames) {
        try {
          const msg = decodeEnvelope(registry, frame);
          stats.record(msg);
          const tag = msg.unknown ? '?' : ' ';
          const arrow = direction === 'in' ? '<-' : '->';
          console.log(`${tag} ${arrow} ${msg.kind.padEnd(8)} ${msg.name}`);
        } catch (err) {
          stats.record({ name: '<illisible>', unknown: true });
        }
      }
    },
  });

  const session = await redirect(target.pid, proxy.port);
  console.log(`Sniffing ${target.name} (pid ${target.pid}) via 127.0.0.1:${proxy.port}. Ctrl+C pour arrêter.`);
  console.log('Le hook ne prend effet que sur les nouvelles connexions : change de map pour en forcer une.');

  const timer = setInterval(() => {
    const ratio = stats.unknownRatio();
    if (ratio > SEUIL_INCONNUS && stats.total > 50) {
      console.warn(
        `\nALERTE: ${(ratio * 100).toFixed(1)}% de messages inconnus sur ${stats.total}. ` +
          `Le jeu de .proto est probablement périmé — Dofus a-t-il été patché ?\n`
      );
    }
  }, 10000);

  process.on('SIGINT', async () => {
    clearInterval(timer);
    await session.detach();
    await proxy.close();
    recorder.close();
    console.log('\n--- messages les plus fréquents ---');
    for (const row of stats.top(20)) {
      console.log(`${String(row.count).padStart(6)}  ${row.unknown ? '?' : ' '} ${row.name}`);
    }
    console.log(`\ntotal ${stats.total}, inconnus ${(stats.unknownRatio() * 100).toFixed(1)}%`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Valider en conditions réelles**

1. Lancer Dofus, se connecter à un personnage.
2. `npm run sniff`
3. Se déplacer, entrer en combat, passer un tour, ouvrir un échange.
4. Ctrl+C et lire le classement.

Attendu : un flux de noms obfusqués (`hdv`, `jvk`, …) et un taux d'inconnus faible. Un taux élevé signifie que le jeu de `.proto` du `.cache` ne correspond plus à la version installée du jeu — il faut le ré-extraire (spec §5.1), ce qui sera outillé dans le plan 2.

Noter les noms qui apparaissent au moment précis où le tour commence : c'est la matière première du mapping du plan 2.

- [ ] **Step 7: Commit**

```bash
git add src/stats.js src/cli/sniff.js test/stats.test.js
git commit -m "feat(cli): sniffer live avec statistiques de messages inconnus"
```

---

## Auto-revue

**Couverture de la spec par ce plan.** Le plan 1 couvre : §3 (`injector`, `codec` — Tasks 2, 4, 6), §4 flux entrant intégralement (Tasks 2, 6, 7), §5.1 partiellement (le sniffer détecte la péremption des `.proto`, la ré-extraction est outillée au plan 2), §6.3 détecteur de patch (Task 7), §7.1 enregistrement/rejeu (Task 3), §7.2 lignes `codec` et `injector`, §8 étape 0 (Task 5).

Renvoyé explicitement aux plans suivants : §5.2 diff structurel, §5.3 enregistreur corrélé, §6.1/6.2/6.4/6.5/6.6, les modules `state`, `features`, `input`, `core`, `ui`.

**Révision du transport par rapport à la spec.** La spec §3 décrivait un `injector` hookant `send`/`recv`. L'inspection du dépôt public `krm35/dofus-multi` (`back/dofus.js`) montre que l'amont procède autrement : Frida réécrit la `sockaddr` de `connect` pour rediriger vers un proxy local, et toute la lecture se fait dans un `net.Server` Node. Ce plan adopte cette technique, qui est meilleure sur trois points :

- Elle donne **les deux sens** du flux, là où un hook `recv` seul ne donnait que l'entrant.
- Elle rend le point d'observation testable sans Frida ni Dofus (Task 4, `test/proxy.test.js`).
- Elle simplifie l'injection prévue au plan 3 : écrire dans un socket Node remplace le montage « plage d'`uid` réservée filtrée depuis l'agent Frida » décrit en spec §4. Le filtrage des `Response` reste nécessaire, mais devient du JavaScript ordinaire dans le proxy.

La spec §4 (flux sortant et `uid`) reste valable dans son intention ; son implémentation se déplace de l'agent Frida vers le proxy. À reporter dans la spec lors du plan 3.

**Cohérence des types vérifiée.** `direction` vaut `'in'`/`'out'` partout (format de capture, `onData` du proxy, `Recorder.write`). `FrameReassembler.push` rend toujours un tableau. `decodeEnvelope` rend toujours les cinq clés `kind`/`uid`/`name`/`payload`/`unknown`, `uid` étant `null` pour un event. `MessageStats.record` consomme exactement la forme produite par `decodeEnvelope`. Le sniffer de la Task 7 instancie **un réassembleur par sens** : entrant et sortant sont deux flux TCP distincts et les mélanger corromprait le framing.

**Une dépendance hors dépôt, assumée et documentée.** Le sniffer de la Task 7 lit les `.proto` depuis `%USERPROFILE%\.cache\` — répertoire du produit payant. Les tests, eux, n'en dépendent pas : ils utilisent les fixtures committées de la Task 6. Le plan 2 devra rendre le projet autonome en outillant la ré-extraction.

**Point d'arrêt obligatoire.** La Task 5 Step 6 peut conclure `CHIFFRÉ`, ce qui invalide l'hypothèse de travail des Tasks 6 et 7. Le plan l'énonce explicitement : dans ce cas, on s'arrête et on revient vers l'utilisateur avec les mesures, sans enchaîner. Ce risque est cependant fortement réduit par la découverte ci-dessus : `back/dofus.js` parse l'en-tête directement sur les octets relayés (`data.readUInt16BE(0) >> 2`), ce qui n'est possible que si le flux est en clair au niveau socket.
