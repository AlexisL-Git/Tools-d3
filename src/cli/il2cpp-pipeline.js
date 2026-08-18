'use strict';
const frida = require('frida');
const { findDofusProcesses } = require('../injector');
const { pipelineAgentSource } = require('../il2cpp/pipelineAgent');

// usage: node src/cli/il2cpp-watch.js [secondes]
async function main() {
  const seconds = Number(process.argv[2] || 25);
  const processes = await findDofusProcesses();
  if (processes.length === 0) {
    console.error('Aucun process Dofus trouvé.');
    process.exit(1);
  }
  const target = processes[0];

  const session = await frida.attach(target.pid);
  const script = await session.createScript(pipelineAgentSource({}));

  const counts = new Map();
  let total = 0;
  let shown = 0;

  script.message.connect((message) => {
    if (message.type === 'error') {
      console.error('AGENT ERREUR:', message.description);
      return;
    }
    const p = message.payload || {};
    if (p.kind === 'ready') {
      console.log('hooks posés:');
      for (const h of p.hooked) console.log('  ' + h);
      if (p.hooked.length === 0) console.log('  (aucun — les méthodes n’ont pas été résolues)');
      console.log('');
    } else if (p.kind === 'diag') {
      console.log(`  [diag] ${p.step} ${p.extra}`);
    } else if (p.kind === 'msg') {
      total += 1;
      const key = `${p.dir} ${p.name}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (p.json && shown < 12) {
        shown += 1;
        console.log(`${p.dir === 'in' ? '<-' : '->'} ${p.name}  ${JSON.stringify(p.json).slice(0, 420)}`);
      }
    }
  });

  await script.load();
  console.log(`observation de ${target.name} (pid ${target.pid}) pendant ${seconds}s — joue normalement`);
  await new Promise((r) => setTimeout(r, seconds * 1000));

  await script.unload().catch(() => {});
  await session.detach().catch(() => {});

  console.log(`\n${total} messages observés, ${counts.size} types distincts\n`);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of rows.slice(0, 40)) {
    console.log(`${String(v).padStart(6)}  ${k}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
