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

function source(cap, integral) {
  return `
    const CAP = ${cap};
    const INTEGRAL = ${integral ? 'true' : 'false'};
    const mod = Process.getModuleByName('ws2_32.dll');
    const get = (n) => mod.findExportByName ? mod.findExportByName(n) : mod.getExportByName(n);

    // WSABUF x64: { ULONG len; <4 octets de bourrage>; CHAR* buf; }, soit 16
    // octets par entree. WSASend en accepte un TABLEAU: la bibliotheque ws de
    // Node met l'en-tete de trame dans le premier et la charge utile dans le
    // second. Ne lire que le premier ne montrait que des en-tetes.
    const WSABUF = 16;
    function gather(bufs, count) {
      if (!bufs || bufs.isNull() || count <= 0) return null;
      const parts = [];
      let total = 0;
      for (let i = 0; i < Math.min(count, 8); i++) {
        const e = bufs.add(i * WSABUF);
        const len = e.readU32();
        const p = e.add(8).readPointer();
        if (p.isNull() || len === 0) continue;
        parts.push({ len: len, p: p });
        total += len;
      }
      return parts.length ? { parts: parts, len: total } : null;
    }
    function firstBuf(bufs) {
      if (!bufs || bufs.isNull()) return null;
      const len = bufs.readU32();
      const p = bufs.add(8).readPointer();
      return p.isNull() ? null : { len: len, p: p };
    }
    function head(p, n) {
      try { return Array.from(new Uint8Array(p.readByteArray(Math.min(n, CAP)))); }
      catch (e) { return []; }
    }

    // Lecture INTEGRALE d'un envoi, sans plafond.
    //
    // Le plafond convient a une inspection a l'oeil, mais il est destructeur
    // des qu'on veut reassembler le flux: un seul envoi tronque desynchronise
    // le decoupage varint, et TOUT ce qui suit sur cette socket devient
    // illisible. Mesure du 20/08: 15% des blocs tronques, 11,4 Mo perdus,
    // 37 sockets touchees — et une conclusion entierement fausse tiree dessus.
    function entier(parts) {
      const morceaux = [];
      for (const part of parts) {
        try { morceaux.push(part.p.readByteArray(part.len)); } catch (e) { return null; }
      }
      if (morceaux.length === 1) return morceaux[0];
      const total = morceaux.reduce((n, m) => n + m.byteLength, 0);
      const sortie = new Uint8Array(total);
      let o = 0;
      for (const m of morceaux) { sortie.set(new Uint8Array(m), o); o += m.byteLength; }
      return sortie.buffer;
    }

    const hooked = [];
    const sendp = get('WSASend');
    if (sendp) {
      Interceptor.attach(sendp, {
        onEnter: function (args) {
          const g = gather(args[1], args[2].toInt32());
          if (!g) return;
          // Les tampons sont concatenes: c'est la trame telle qu'elle part sur
          // le fil, en-tete et charge utile reunis.
          if (INTEGRAL) {
            const tout = entier(g.parts);
            if (tout === null) return;
            // Canal binaire de Frida: aucun plafond, et pas de cout de
            // serialisation JSON sur des megaoctets.
            send({ dir: 'out', sock: args[0].toString(), len: g.len, bin: true }, tout);
            return;
          }
          let bytes = [];
          for (const part of g.parts) {
            if (bytes.length >= CAP) break;
            bytes = bytes.concat(head(part.p, part.len));
          }
          send({ dir: 'out', sock: args[0].toString(), len: g.len, head: bytes.slice(0, CAP) });
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
          if (INTEGRAL) {
            const tout = entier([{ p: this.b.p, len: n }]);
            if (tout === null) return;
            send({ dir: 'in', sock: this.sock, len: n, bin: true }, tout);
            return;
          }
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
  // 'tout' capture l'INTEGRALITE des octets, indispensable des qu'on veut
  // reassembler le flux: un seul envoi tronque desynchronise le decoupage
  // varint et rend illisible tout ce qui suit sur la socket.
  const integral = process.argv[5] === 'tout';
  const cap = integral ? 0 : Number(process.argv[5] || 160);
  if (!pid) { console.error('usage: node src/cli/proxy-tap.js <pid> [secondes] [fichier.jsonl] [octetsParTrame|tout]'); process.exit(1); }

  const session = await frida.attach(pid);
  const script = await session.createScript(source(cap, integral));
  const socks = new Map();
  const t0 = Date.now();
  const sink = outFile ? fs.createWriteStream(outFile) : null;

  let tronques = 0;
  script.message.connect((m, data) => {
    if (m.type === 'error') { console.error('AGENT:', m.description); return; }
    const p = m.payload || {};
    if (p.ready) {
      console.log(`accroche: ${p.ready.join(', ')}\nenregistrement ${seconds}s${integral ? ' (capture integrale)' : ''}\n`);
      return;
    }
    if (!p.dir) return;

    // En mode integral les octets arrivent par le canal binaire; on les
    // enregistre en hexadecimal, sous la meme cle que le mode tronque pour ne
    // pas casser les outils d'analyse existants.
    const octets = p.bin && data ? Array.from(new Uint8Array(data)) : (p.head || []);
    if (!p.bin && p.len > octets.length) tronques++;
    if (sink) sink.write(JSON.stringify({ t: Date.now() - t0, dir: p.dir, sock: p.sock, len: p.len, head: octets }) + '\n');

    let s = socks.get(p.sock);
    if (!s) { s = { in: 0, out: 0, bin: 0, bout: 0, tls: 0, n: 0, bytes: [] }; socks.set(p.sock, s); }
    s[p.dir]++; s['b' + p.dir] += p.len; s.n++;
    if (looksTls(octets)) s.tls++;
    if (s.bytes.length < 2048) s.bytes.push(...octets.slice(0, 512));
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
  // Une capture tronquee ne permet PAS de reassembler le flux. Le dire, plutot
  // que de laisser croire que les donnees sont exploitables.
  if (tronques > 0) {
    console.log(`ATTENTION: ${tronques} bloc(s) tronque(s) — le reassemblage sera faux. Relancer avec l'option "tout".`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
