'use strict';
const frida = require('frida');

// Recherche du source d'un agent Frida tiers reste en memoire dans le process.
//
// Un agent Frida est envoye au process sous forme de source JavaScript, puis
// compile par le moteur embarque. Le texte d'origine survit en general dans le
// tas: le retrouver rend la recette complete du Replicate, plutot que d'avoir a
// la deduire de ses effets.
//
// Le motif est cherche en Latin-1 et en UTF-16, les deux representations que
// V8 utilise pour ses chaines selon leur contenu.
//
// usage: node src/cli/scan-js.js <pid> <motif> [octetsDeContexte]

function toPattern(text, utf16) {
  const bytes = [];
  for (const ch of text) {
    bytes.push(ch.charCodeAt(0).toString(16).padStart(2, '0'));
    if (utf16) bytes.push('00');
  }
  return bytes.join(' ');
}

function source(needle, context, maxBytes) {
  return `
    const CONTEXT = ${context};
    const BUDGET = ${maxBytes};
    const PATS = ${JSON.stringify([toPattern(needle, false), toPattern(needle, true)])};

    // Memory.readByteArray a disparu en Frida 14; la lecture passe par la
    // methode du NativePointer. Meme piege que Module.findExportByName.
    function render(addr, base) {
      try {
        const start = addr.compare(base.add(CONTEXT)) > 0 ? addr.sub(CONTEXT) : base;
        const u8 = new Uint8Array(start.readByteArray(CONTEXT * 3));
        let s = '';
        for (let i = 0; i < u8.length; i++) {
          const c = u8[i];
          s += (c === 0) ? '' : (c >= 9 && c < 127) ? String.fromCharCode(c) : '.';
        }
        return s;
      } catch (e) { return '(illisible)'; }
    }

    // Le scan tourne HORS du chargement du script: parcourir des gigaoctets de
    // memoire pendant load() faisait expirer la connexion Frida.
    // On se limite au tas inscriptible et prive, ou vit le heap V8 de l'agent
    // tiers; le code des modules est mappe en lecture seule et n'a pas a etre lu.
    setTimeout(function () {
      const hits = [];
      let scanned = 0, ranges = 0;
      const rs = Process.enumerateRanges({ protection: 'rw-', coalesce: true });
      for (const r of rs) {
        if (scanned > BUDGET || hits.length > 30) break;
        if (r.file) continue;                  // region adossee a un fichier: pas du tas
        if (r.size > 64 * 1024 * 1024) continue;
        ranges++; scanned += r.size;
        for (const pat of PATS) {
          let found;
          try { found = Memory.scanSync(r.base, r.size, pat); } catch (e) { continue; }
          for (const f of found) {
            hits.push({ addr: f.address.toString(), base: r.base.toString(), size: r.size, text: render(f.address, r.base) });
            if (hits.length > 30) break;
          }
        }
      }
      send({ hits: hits, scanned: scanned, ranges: ranges });
    }, 0);
  `;
}

async function main() {
  const pid = Number(process.argv[2]);
  const needle = process.argv[3];
  const context = Number(process.argv[4] || 400);
  if (!pid || !needle) {
    console.error('usage: node src/cli/scan-js.js <pid> <motif> [octetsDeContexte]');
    process.exit(1);
  }

  const session = await frida.attach(pid);
  const script = await session.createScript(source(needle, context, 1536 * 1024 * 1024));
  const done = new Promise((resolve) => {
    script.message.connect((m) => {
      if (m.type === 'error') { console.error('AGENT:', m.description); return resolve(); }
      const hits = (m.payload || {}).hits || [];
      const p = m.payload || {};
      console.log(`${p.ranges} regions, ${(p.scanned / 1048576).toFixed(0)} Mo balayes`);
      console.log(`${hits.length} occurrence(s) de ${JSON.stringify(needle)}:\n`);
      // Les regions portant les occurrences interessent plus que les
      // occurrences elles-memes: c'est la region entiere qu'on ira extraire.
      const regions = new Map();
      for (const h of hits) {
        const r = regions.get(h.base) || { n: 0, size: h.size };
        r.n++; regions.set(h.base, r);
      }
      console.log('regions concernees:');
      for (const [base, r] of regions) console.log(`  ${base}  ${(r.size / 1024).toFixed(0)} Ko  ${r.n} occurrence(s)`);
      console.log('');
      for (const h of hits) {
        console.log(`--- ${h.addr} (region ${h.base}, ${(h.size / 1024).toFixed(0)} Ko) ---`);
        console.log(h.text);
        console.log('');
      }
      resolve();
    });
  });

  await script.load();
  await done;
  await script.unload().catch(() => {});
  await session.detach().catch(() => {});
}

main().catch((e) => { console.error(e.message); process.exit(1); });
