'use strict';
const fs = require('fs');
const frida = require('frida');
const { shannonEntropy } = require('../analysis/entropy');

// Ecoute des E/S du proxy local du launcher, socket par socket.
//
// La duplication du Replicate n'est PAS observable dans le jeu: c'est le proxy
// qui fabrique le message et l'emet a la place du client esclave. Le seul point
// ou elle se voit est donc le launcher. Node y passe bien par WSASend/WSARecv,
// contrairement a .NET.
//
// Deux corrections par rapport a wsa-probe:
//   - le tampon de WSARecv est VIDE a l'aller; il ne peut etre lu qu'au retour,
//     et seulement sur le nombre d'octets effectivement recus;
//   - tout est ventile par descripteur de socket. Sans cela on melange le
//     tunnel de jeu et les appels du launcher a son propre serveur, et on
//     conclut n'importe quoi sur le chiffrement.
//
// usage: node src/cli/proxy-tap.js <pid> [secondes] [fichier.jsonl]

function source() {
  return `
    const mod = Process.getModuleByName('ws2_32.dll');
    const get = (n) => mod.findExportByName ? mod.findExportByName(n) : mod.getExportByName(n);

    // WSABUF x64: { ULONG len; <4 octets de bourrage>; CHAR* buf; }
    function firstBuf(bufs) {
      if (!bufs || bufs.isNull()) return null;
      const len = bufs.readU32();
      const p = bufs.add(8).readPointer();
      return p.isNull() ? null : { len: len, p: p };
    }
    function head(p, n) {
      try { return Array.from(new Uint8Array(p.readByteArray(Math.min(n, 96)))); }
      catch (e) { return []; }
    }

    const hooked = [];
    const sendp = get('WSASend');
    if (sendp) {
      Interceptor.attach(sendp, {
        onEnter: function (args) {
          const b = firstBuf(args[1]);
          if (!b || b.len === 0) return;
          send({ dir: 'out', sock: args[0].toString(), len: b.len, head: head(b.p, b.len) });
        }
      });
      hooked.push('WSASend');
    }

    const recvp = get('WSARecv');
    if (recvp) {
      Interceptor.attach(recvp, {
        onEnter: function (args) {
          this.sock = args[0].toString();
          this.b = firstBuf(args[1]);
          this.received = args[3];          // LPDWORD lpNumberOfBytesRecvd
        },
        onLeave: function () {
          if (!this.b) return;
          let n = 0;
          try { if (this.received && !this.received.isNull()) n = this.received.readU32(); } catch (e) {}
          // En E/S recouvertes, lpNumberOfBytesRecvd n'est pas renseigne au
          // retour: la valeur lue est alors du residu de pile. Un compte
          // superieur au tampon annonce la trahit — sans ce garde-fou on
          // additionnait des gigaoctets imaginaires.
          if (n === 0 || n > this.b.len) return;
          send({ dir: 'in', sock: this.sock, len: n, head: head(this.b.p, n) });
        }
      });
      hooked.push('WSARecv');
    }

    send({ ready: hooked });
  `;
}

// Un record TLS commence par un type (20..23), la version (03 0x) et une
// longueur. Le reconnaitre evite de confondre du chiffre avec du lisible,
// ce que l'entropie seule fait sur de petits echantillons.
function looksTls(head) {
  if (head.length < 5) return false;
  return head[0] >= 20 && head[0] <= 23 && head[1] === 3 && head[2] <= 4;
}

async function main() {
  const pid = Number(process.argv[2]);
  const seconds = Number(process.argv[3] || 30);
  const outFile = process.argv[4];
  if (!pid) { console.error('usage: node src/cli/proxy-tap.js <pid> [secondes] [fichier.jsonl]'); process.exit(1); }

  const session = await frida.attach(pid);
  const script = await session.createScript(source());
  const socks = new Map();
  const t0 = Date.now();
  const sink = outFile ? fs.createWriteStream(outFile) : null;

  script.message.connect((m) => {
    if (m.type === 'error') { console.error('AGENT:', m.description); return; }
    const p = m.payload || {};
    if (p.ready) { console.log(`accroche: ${p.ready.join(', ')}\nenregistrement ${seconds}s\n`); return; }
    if (!p.dir) return;
    if (sink) sink.write(JSON.stringify({ t: Date.now() - t0, ...p }) + '\n');
    let s = socks.get(p.sock);
    if (!s) { s = { in: 0, out: 0, bin: 0, bout: 0, tls: 0, n: 0, bytes: [] }; socks.set(p.sock, s); }
    s[p.dir]++; s['b' + p.dir] += p.len; s.n++;
    if (looksTls(p.head)) s.tls++;
    if (s.bytes.length < 2048) s.bytes.push(...p.head);
  });

  await script.load();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await script.unload().catch(() => {});
  await session.detach().catch(() => {});
  if (sink) sink.end();

  const rows = [...socks.entries()].sort((a, b) => (b[1].bin + b[1].bout) - (a[1].bin + a[1].bout));
  if (rows.length === 0) { console.log('aucun trafic.'); return; }
  console.log('socket        entrant        sortant     records TLS  entropie  verdict');
  for (const [sock, s] of rows) {
    const h = s.bytes.length ? shannonEntropy(Buffer.from(s.bytes)) : 0;
    const part = s.n ? s.tls / s.n : 0;
    const verdict = part > 0.5 ? 'TUNNEL TLS' : h > 7.2 ? 'chiffre/compresse' : 'EN CLAIR';
    console.log(
      `${sock.padEnd(12)}  ${String(s.in).padStart(4)} / ${String(s.bin).padStart(7)} o` +
      `  ${String(s.out).padStart(4)} / ${String(s.bout).padStart(7)} o` +
      `   ${String(Math.round(part * 100)).padStart(3)}%` +
      `     ${h.toFixed(2)}    ${verdict}`
    );
  }
  if (outFile) console.log(`\ntrames ecrites dans ${outFile}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
