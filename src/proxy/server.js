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
