'use strict';
const net = require('node:net');

// Le client injecté écrit exactement `"CONNECT " + adresse + ":" + port + " HTTP/1.0"`,
// sans CRLF ni espace finale, et la charge utile suit immédiatement. La fin de
// la ligne se reconnaît donc au suffixe, pas à un terminateur.
const PREFIX = 'CONNECT ';
const SUFFIX = ' HTTP/1.0';

function parseConnectLine(buf) {
  const head = buf.subarray(0, Math.min(buf.length, 128)).toString('latin1');
  if (!head.startsWith(PREFIX)) return null;
  const end = head.indexOf(SUFFIX, PREFIX.length);
  if (end < 0) return null;

  const target = head.slice(PREFIX.length, end);
  // Une adresse IPv6 contient elle-même des deux-points : seul le dernier
  // sépare l'hôte du port.
  const sep = target.lastIndexOf(':');
  if (sep <= 0) return null;
  const host = target.slice(0, sep);
  const port = Number(target.slice(sep + 1));
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;

  return {
    host,
    port,
    rest: Buffer.from(buf.subarray(Buffer.byteLength(head.slice(0, end + SUFFIX.length), 'latin1'))),
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
