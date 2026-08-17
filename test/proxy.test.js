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
