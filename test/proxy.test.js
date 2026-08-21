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
      sock.on('error', () => {});
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

test('parseConnectLine extrait hôte et port', () => {
  const out = parseConnectLine(Buffer.from('CONNECT 10.0.0.1:5555 HTTP/1.0'));
  assert.strictEqual(out.host, '10.0.0.1');
  assert.strictEqual(out.port, 5555);
});

test('parseConnectLine rend null sur autre chose', () => {
  assert.strictEqual(parseConnectLine(Buffer.from([0x01, 0x02, 0x03])), null);
});

// L'agent réel écrit exactement `"CONNECT " + addr + ":" + port + " HTTP/1.0"` :
// ni espace finale, ni CRLF. Les tests d'origine encodaient tous une espace
// finale, ce qui rendait la suite verte alors que le proxy ne pouvait pas
// reconnaître un seul client réel.
test('parseConnectLine accepte la ligne sans espace ni CRLF final', () => {
  const out = parseConnectLine(Buffer.from('CONNECT 10.0.0.1:5555 HTTP/1.0'));
  assert.notStrictEqual(out, null, 'la ligne réellement émise doit être reconnue');
  assert.strictEqual(out.host, '10.0.0.1');
  assert.strictEqual(out.port, 5555);
  assert.strictEqual(out.rest.length, 0);
});

test('parseConnectLine rend le reliquat collé à la ligne sans séparateur', () => {
  const buf = Buffer.concat([Buffer.from('CONNECT 1.2.3.4:99 HTTP/1.0'), Buffer.from([0xaa, 0xbb])]);
  const out = parseConnectLine(buf);
  assert.deepStrictEqual([...out.rest], [0xaa, 0xbb]);
});

// Le jeu ouvre aussi des connexions IPv6 : l'adresse contient alors des
// deux-points, et seul le dernier sépare l'hôte du port.
test('parseConnectLine gère une adresse IPv6', () => {
  const out = parseConnectLine(Buffer.from('CONNECT 2001:db8::1:5555 HTTP/1.0'));
  assert.notStrictEqual(out, null);
  assert.strictEqual(out.host, '2001:db8::1');
  assert.strictEqual(out.port, 5555);
});

test('parseConnectLine rend le reliquat après la ligne CONNECT', () => {
  const buf = Buffer.concat([Buffer.from('CONNECT 1.2.3.4:99 HTTP/1.0'), Buffer.from([0xaa, 0xbb])]);
  assert.deepStrictEqual([...parseConnectLine(buf).rest], [0xaa, 0xbb]);
});

// Le nettoyage passe par t.after : place apres l'assertion, il etait saute des
// qu'une assertion echouait, laissant serveur et socket ouverts. Le runner
// attendait alors la vidange de la boucle d'evenements — un echec se
// manifestait par un blocage indefini au lieu d'un message.
test('le proxy relaie dans les deux sens et observe les octets', async (t) => {
  const seenByServer = [];
  const { srv, port: upstreamPort } = await listenEcho((d) => seenByServer.push(d));

  const observed = [];
  const proxy = await createProxy({ port: 0, onData: (dir, buf) => observed.push([dir, buf]) });

  const client = net.connect(proxy.port, '127.0.0.1');
  t.after(async () => { client.destroy(); await proxy.close(); srv.close(); });
  await new Promise((r) => client.once('connect', r));

  client.write(`CONNECT 127.0.0.1:${upstreamPort} HTTP/1.0`);
  await new Promise((r) => setTimeout(r, 50));
  client.write(Buffer.from('ping'));

  const reply = await new Promise((r) => client.once('data', r));
  assert.strictEqual(reply.toString(), 'R:ping');
  assert.strictEqual(Buffer.concat(seenByServer).toString(), 'ping');

  const out = observed.filter(([d]) => d === 'out').map(([, b]) => b.toString()).join('');
  const inn = observed.filter(([d]) => d === 'in').map(([, b]) => b.toString()).join('');
  assert.strictEqual(out, 'ping', 'le sens client→serveur doit être observé');
  assert.strictEqual(inn, 'R:ping', 'le sens serveur→client doit être observé');
});

// Sans identite de connexion, tous les flux tombent dans le meme
// reassembleur: le HTTPS des CDN y passe pour du protocole de jeu et produit
// des longueurs de trame absurdes. Constate sur un client reel.
// Le jeu joint son serveur en AF_INET6 et l'agent reecrit alors vers ::1. Un
// proxy lie au seul 127.0.0.1 ne recevait jamais cette connexion-la, alors que
// toutes les autres arrivaient — panne silencieuse constatee sur un client reel.
test('le proxy accepte les connexions IPv6 comme IPv4', async (t) => {
  const { srv, port: upstreamPort } = await listenEcho(() => {});
  const proxy = await createProxy({ port: 0, onData: () => {} });
  const clients = [];
  t.after(async () => { for (const c of clients) c.destroy(); await proxy.close(); srv.close(); });

  for (const host of ['127.0.0.1', '::1']) {
    const c = net.connect(proxy.port, host);
    clients.push(c);
    await new Promise((r, rej) => { c.once('connect', r); c.once('error', rej); });
    c.write(Buffer.concat([
      Buffer.from(`CONNECT 127.0.0.1:${upstreamPort} HTTP/1.0`),
      Buffer.from('salut'),
    ]));
    const rep = await new Promise((r) => c.once('data', r));
    assert.strictEqual(rep.toString(), 'R:salut', `via ${host}`);
  }
});

// Une connexion dont le preambule n'arrive jamais restait en file sans le
// moindre message: on constatait une absence de trafic sans pouvoir la
// distinguer d'une absence de connexion.
test('une connexion sans ligne CONNECT est signalée, pas ignorée', async (t) => {
  const soucis = [];
  const proxy = await createProxy({ port: 0, onData: () => {}, onProbleme: (p) => soucis.push(p) });
  const c = net.connect(proxy.port, '127.0.0.1');
  t.after(async () => { c.destroy(); await proxy.close(); });

  await new Promise((r) => c.once('connect', r));
  c.write(Buffer.alloc(600, 0x41));
  await new Promise((r) => c.once('close', r));

  assert.strictEqual(soucis.length, 1);
  assert.match(soucis[0].raison, /aucune ligne CONNECT/);
});

test('onData reçoit l identité et la destination de la connexion', async (t) => {
  const { srv, port: upstreamPort } = await listenEcho(() => {});
  const vues = [];
  const proxy = await createProxy({ port: 0, onData: (dir, buf, conn) => vues.push({ dir, conn }) });

  const clients = [];
  t.after(async () => { for (const c of clients) c.destroy(); await proxy.close(); srv.close(); });

  for (let i = 0; i < 2; i++) {
    const c = net.connect(proxy.port, '127.0.0.1');
    clients.push(c);
    await new Promise((r) => c.once('connect', r));
    c.write(Buffer.concat([
      Buffer.from(`CONNECT 127.0.0.1:${upstreamPort} HTTP/1.0`),
      Buffer.from(`m${i}`),
    ]));
    await new Promise((r) => c.once('data', r));
  }

  const ids = [...new Set(vues.map((v) => v.conn.id))];
  assert.strictEqual(ids.length, 2, 'deux connexions doivent porter deux identités distinctes');
  for (const v of vues) {
    assert.strictEqual(v.conn.port, upstreamPort, 'la destination doit être connue');
    assert.strictEqual(v.conn.host, '127.0.0.1');
  }
});

test('les octets envoyés avant la connexion amont sont mis en file et non perdus', async (t) => {
  const seenByServer = [];
  const { srv, port: upstreamPort } = await listenEcho((d) => seenByServer.push(d));
  const proxy = await createProxy({ port: 0, onData: () => {} });

  const client = net.connect(proxy.port, '127.0.0.1');
  t.after(async () => { client.destroy(); await proxy.close(); srv.close(); });
  await new Promise((r) => client.once('connect', r));

  // CONNECT et charge utile dans le même write : la charge arrive avant que l'amont soit prêt
  client.write(Buffer.concat([
    Buffer.from(`CONNECT 127.0.0.1:${upstreamPort} HTTP/1.0`),
    Buffer.from('early'),
  ]));

  const reply = await new Promise((r) => client.once('data', r));
  assert.strictEqual(reply.toString(), 'R:early');
});

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
  await proxy.close(); srv.close();
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
  await proxy.close(); srv.close();
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
  await proxy.close(); srv.close();
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
  await proxy.close(); srv.close();
});
