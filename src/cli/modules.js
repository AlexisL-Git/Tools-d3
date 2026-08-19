'use strict';
const frida = require('frida');
const { findDofusProcesses } = require('../injector');

// Releve des modules charges dans chaque client Dofus.
//
// Sert a repondre a une question precise: par quelle voie un injecteur tiers
// (le Replicate de krm35) se greffe-t-il dans le jeu? Une DLL etrangere aux
// dossiers du jeu et du systeme trahit une injection classique; son absence
// oriente vers une voie externe, ou vers une injection sans module (shellcode,
// thread distant).
//
// usage: node src/cli/modules.js [sousChaineDeFiltre]

const SYSTEM_ROOTS = ['c:\\windows\\', 'c:\\program files\\windowsapps\\'];

function classify(pathLower, gameDir) {
  if (gameDir && pathLower.indexOf(gameDir) === 0) return 'jeu';
  for (const r of SYSTEM_ROOTS) if (pathLower.indexOf(r) === 0) return 'systeme';
  return 'ETRANGER';
}

async function main() {
  const filter = (process.argv[2] || '').toLowerCase();
  const procs = await findDofusProcesses();
  if (procs.length === 0) { console.error('Aucun process Dofus.'); process.exit(1); }

  for (const proc of procs) {
    console.log(`\n=== pid ${proc.pid}  ${proc.name} ===`);
    let session;
    try { session = await frida.attach(proc.pid); }
    catch (e) { console.log(`  attache impossible: ${e.message}`); continue; }

    const script = await session.createScript(`
      send({ mods: Process.enumerateModules().map(m => ({ name: m.name, path: m.path, size: m.size })) });
    `);
    const mods = await new Promise((resolve) => {
      script.message.connect((m) => {
        if (m.type === 'error') { console.log('  AGENT:', m.description); return resolve([]); }
        resolve((m.payload || {}).mods || []);
      });
      script.load();
    });

    // Le repertoire du jeu se deduit de l'executable principal, sans le
    // supposer: l'installation peut etre ailleurs que sous Program Files.
    const main = mods.find((m) => /Dofus\.exe$/i.test(m.path));
    const gameDir = main ? main.path.toLowerCase().replace(/[^\\]+$/, '') : null;

    const rows = mods
      .map((m) => ({ ...m, kind: classify(m.path.toLowerCase(), gameDir) }))
      .filter((m) => !filter || m.path.toLowerCase().indexOf(filter) >= 0);

    const foreign = rows.filter((m) => m.kind === 'ETRANGER');
    const counts = rows.reduce((a, m) => (a[m.kind] = (a[m.kind] || 0) + 1, a), {});
    console.log(`  ${rows.length} modules — ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    if (foreign.length === 0) console.log('  aucun module etranger.');
    for (const m of foreign) console.log(`  ETRANGER  ${m.name.padEnd(28)} ${m.path}`);

    await script.unload().catch(() => {});
    await session.detach().catch(() => {});
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
