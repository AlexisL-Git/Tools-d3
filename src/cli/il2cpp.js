'use strict';
const frida = require('frida');
const { findDofusProcesses } = require('../injector');
const { il2cppAgentSource } = require('../il2cpp/agent');

// usage: node src/cli/il2cpp.js <assemblies|classes|methods> [filtre] [limite]
async function main() {
  const mode = process.argv[2] || 'assemblies';
  const filter = process.argv[3] || '';
  const limit = Number(process.argv[4] || 400);
  const image = process.argv[5] || '';

  const processes = await findDofusProcesses();
  if (processes.length === 0) {
    console.error('Aucun process Dofus trouvé.');
    process.exit(1);
  }
  const target = processes[0];
  console.error(`# attach ${target.name} pid ${target.pid} — mode=${mode} filtre="${filter}"`);

  const session = await frida.attach(target.pid);
  const script = await session.createScript(il2cppAgentSource({ mode, filter, limit, image }));

  const done = new Promise((resolve) => {
    script.message.connect((message) => {
      if (message.type === 'error') {
        console.error('AGENT ERREUR:', message.description);
        resolve();
        return;
      }
      const p = message.payload || {};
      if (p.kind === 'assemblies') {
        console.log(`${p.count} assemblies:`);
        for (const a of p.list.sort((x, y) => y.classes - x.classes)) {
          console.log(`  ${String(a.classes).padStart(6)} classes  ${a.name}`);
        }
      } else if (p.kind === 'classes') {
        console.log(`${p.list.length} classes retenues (${p.scanned} parcourues):`);
        for (const c of p.list) console.log(`  [${c.image}] ${c.name}`);
      } else if (p.kind === 'methods') {
        for (const c of p.list) {
          console.log(`\n=== ${c.name} (${c.methods.length} méthodes)`);
          for (const m of c.methods) console.log(`    ${m}`);
        }
      } else if (p.kind === 'done') {
        resolve();
      }
    });
  });

  await script.load();
  await done;
  await script.unload().catch(() => {});
  await session.detach().catch(() => {});
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
