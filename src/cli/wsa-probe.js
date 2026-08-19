'use strict';
const frida = require('frida');
const { shannonEntropy } = require('../analysis/entropy');

// Sonde sur les E/S recouvertes de Winsock.
//
// Les sessions precedentes concluaient que le reseau de Dofus 3 etait
// invisible depuis ws2_32, sur la foi de hooks poses sur send/recv. C'est
// exact mais incomplet: DotNetty passe par des ports de completion, donc par
// WSASend/WSARecv, qui n'avaient jamais ete essayes.
//
// La question a laquelle cet outil repond: les octets qui circulent sont-ils
// lisibles, ou chiffres? Un proxy ne peut rejouer que ce qu'il comprend.
// L'entropie de Shannon tranche: proche de 8 bits/octet = chiffre ou compresse,
// nettement en dessous = structure lisible.
//
// usage: node src/cli/wsa-probe.js <pid> [secondes]

function source() {
  return `
    const NAMES = ['WSASend', 'WSARecv'];
    let _m = null;
    function resolve(n) {
      if (_m === null) _m = Process.getModuleByName('ws2_32.dll');
      return _m.findExportByName ? _m.findExportByName(n) : _m.getExportByName(n);
    }

    const raw = {};
    setInterval(function () { send({ raw: raw }); }, 5000);

    const hooked = [];
    for (const name of NAMES) {
      const p = resolve(name);
      if (!p) continue;
      const dir = name === 'WSASend' ? 'out' : 'in';
      Interceptor.attach(p, {
        // int WSASend(SOCKET s, LPWSABUF b, DWORD n, LPDWORD sent, DWORD flags, ...)
        // WSABUF = { ULONG len; CHAR* buf; } -> len a +0, pointeur a +8 en x64.
        onEnter: function (args) {
          // Compte inconditionnel: sans lui, un echec de lecture des arguments
          // se lit comme une absence d'appel, et on conclurait a tort que la
          // fonction n'est pas utilisee.
          raw[dir] = (raw[dir] || 0) + 1;
          try {
            const bufs = args[1];
            const count = args[2].toInt32();
            if (bufs.isNull() || count <= 0) return;
            const len = bufs.readU32();
            const p2 = bufs.add(8).readPointer();
            if (p2.isNull() || len === 0) return;
            const n = Math.min(len, 64);
            this.dir = dir;
            this.len = len;
            this.head = Array.from(new Uint8Array(p2.readByteArray(n)));
            // WSARecv annonce la taille du TAMPON a l'aller, pas des octets
            // recus: seul onLeave dit combien ont ete ecrits.
            this.sent = args[3];
          } catch (e) {}
        },
        onLeave: function () {
          if (!this.head) return;
          let real = this.len;
          try { if (this.sent && !this.sent.isNull()) real = this.sent.readU32(); } catch (e) {}
          if (real === 0) return;
          send({ dir: this.dir, len: real, head: this.head.slice(0, Math.min(64, real)) });
        }
      });
      hooked.push(name);
    }
    send({ ready: hooked });
  `;
}

async function main() {
  const pid = Number(process.argv[2]);
  const seconds = Number(process.argv[3] || 20);
  if (!pid) { console.error('usage: node src/cli/wsa-probe.js <pid> [secondes]'); process.exit(1); }

  const session = await frida.attach(pid);
  const script = await session.createScript(source());
  const acc = { in: [], out: [] };
  const samples = { in: null, out: null };
  let lastRaw = {};

  script.message.connect((m) => {
    if (m.type === 'error') { console.error('AGENT:', m.description); return; }
    const p = m.payload || {};
    if (p.ready) { console.log(`accroche: ${p.ready.join(', ')}\nobservation ${seconds}s\n`); return; }
    if (p.raw) { lastRaw = p.raw; return; }
    if (!p.dir) return;
    acc[p.dir].push(p.len);
    if (samples[p.dir] === null) samples[p.dir] = [];
    if (samples[p.dir].length < 4096) samples[p.dir].push(...p.head);
  });

  await script.load();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await script.unload().catch(() => {});
  await session.detach().catch(() => {});

  for (const dir of ['out', 'in']) {
    const lens = acc[dir];
    const s = samples[dir] || [];
    console.log(`\n=== ${dir === 'out' ? 'SORTANT (WSASend)' : 'ENTRANT (WSARecv)'} ===`);
    if (lens.length === 0) {
      const r = lastRaw[dir] || 0;
      console.log(r === 0
        ? '  fonction JAMAIS appelee (0 entree brute).'
        : `  ${r} entree(s) brute(s) mais aucun tampon lisible: lecture des arguments a revoir.`);
      continue;
    }
    const total = lens.reduce((a, b) => a + b, 0);
    const h = s.length ? shannonEntropy(Buffer.from(s)) : 0;
    console.log(`  ${lens.length} appels, ${total} octets, taille mediane ${lens.sort((a, b) => a - b)[Math.floor(lens.length / 2)]}`);
    console.log(`  entropie sur ${s.length} octets de tete: ${h.toFixed(2)} bits/octet`);
    console.log(`  verdict: ${h > 7.5 ? 'CHIFFRE ou compresse' : h > 6.5 ? 'ambigu' : 'LISIBLE (structure apparente)'}`);
    console.log(`  premiers octets: ${s.slice(0, 32).map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
