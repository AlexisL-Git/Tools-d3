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

// Le jeu joint son serveur en AF_INET6: l'agent reecrit alors la destination
// en ::1, et un proxy lie au seul 127.0.0.1 ne recoit jamais rien. On ecoute
// donc sur les deux piles. Le produit de krm35 fait de meme — ses ports
// apparaissent en LocalAddress "::".
const DEFAULT_HOST = '::';
// Au-dela, on considere que le premier bloc ne contient pas de ligne CONNECT
// et qu'il n'en contiendra pas: mieux vaut le signaler que d'attendre.
const MAX_PREAMBULE = 512;

function createProxy({ port = 0, host = DEFAULT_HOST, onData = () => {}, onProbleme = () => {} } = {}) {
  let nextId = 1;
  const server = net.createServer((client) => {
    let upstream = null;
    let queue = [];
    // Chaque connexion porte son identite et sa destination. Sans cela, un
    // seul flux melangeait le protocole de jeu et le HTTPS vers les CDN dans
    // le meme reassembleur, et les octets TLS y passaient pour des longueurs
    // de trame — 110 erreurs de cadrage sur un premier essai reel.
    const conn = { id: nextId++, host: null, port: null };

    client.on('data', (chunk) => {
      if (upstream === null) {
        const parsed = parseConnectLine(chunk);
        if (parsed === null) {
          // Pas encore de ligne CONNECT : on met en file jusqu'à en recevoir une.
          queue.push(chunk);
          const enFile = queue.reduce((n, c) => n + c.length, 0);
          if (enFile > MAX_PREAMBULE) {
            // Sans ce signal, une connexion sans préambule reconnaissable
            // restait en file indéfiniment, sans le moindre message : on
            // constatait une absence de trafic sans pouvoir l'expliquer.
            onProbleme({ id: conn.id, raison: 'aucune ligne CONNECT', octets: enFile });
            client.destroy();
          }
          return;
        }
        conn.host = parsed.host;
        conn.port = parsed.port;
        upstream = net.connect(parsed.port, parsed.host);

        upstream.on('connect', () => {
          for (const pending of queue) {
            onData('out', pending, conn);
            upstream.write(pending);
          }
          queue = [];
        });

        upstream.on('data', (data) => {
          onData('in', data, conn);
          client.write(data);
        });

        upstream.on('error', (e) => {
          onProbleme({ id: conn.id, raison: `amont injoignable: ${e.message}`, cible: `${conn.host}:${conn.port}` });
          client.destroy();
        });
        upstream.on('close', () => client.destroy());

        if (parsed.rest.length > 0) queue.push(parsed.rest);
        return;
      }

      if (upstream.connecting) {
        queue.push(chunk);
        return;
      }
      onData('out', chunk, conn);
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
