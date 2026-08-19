'use strict';
const fs = require('fs');
const frida = require('frida');

// Extraction brute d'une region memoire vers un fichier.
//
// Complement de scan-js: une fois la region du tas contenant le source d'un
// agent tiers reperee, la lire d'un bloc permet de l'analyser hors ligne, sans
// garder le jeu ouvert ni multiplier les allers-retours.
//
// usage: node src/cli/dump-mem.js <pid> <adresse> <octets> <fichier>

function source(addr, size) {
  return `
    setTimeout(function () {
      const CHUNK = 256 * 1024;
      let done = 0;
      const base = ptr('${addr}');
      const total = ${size};
      while (done < total) {
        const n = Math.min(CHUNK, total - done);
        let buf = null;
        try { buf = base.add(done).readByteArray(n); } catch (e) {}
        // Une page illisible ne doit pas interrompre l'extraction: on la
        // signale et on continue, sinon un trou unique perdrait tout le reste.
        send({ off: done, n: n, ok: buf !== null }, buf || new ArrayBuffer(0));
        done += n;
      }
      send({ fini: true });
    }, 0);
  `;
}

async function main() {
  const pid = Number(process.argv[2]);
  const addr = process.argv[3];
  const size = Number(process.argv[4]);
  const out = process.argv[5];
  if (!pid || !addr || !size || !out) {
    console.error('usage: node src/cli/dump-mem.js <pid> <adresse> <octets> <fichier>');
    process.exit(1);
  }

  const session = await frida.attach(pid);
  const script = await session.createScript(source(addr, size));
  const buf = Buffer.alloc(size);
  let holes = 0;

  const done = new Promise((resolve) => {
    script.message.connect((m, data) => {
      if (m.type === 'error') { console.error('AGENT:', m.description); return resolve(); }
      const p = m.payload || {};
      if (p.fini) return resolve();
      if (!p.ok) { holes++; return; }
      if (data) Buffer.from(data).copy(buf, p.off);
    });
  });

  await script.load();
  await done;
  await script.unload().catch(() => {});
  await session.detach().catch(() => {});

  fs.writeFileSync(out, buf);
  console.log(`${size} octets ecrits dans ${out}${holes ? ` (${holes} bloc(s) illisible(s))` : ''}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
