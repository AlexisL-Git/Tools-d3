'use strict';
const frida = require('frida');
const { findDofusProcesses } = require('../injector');
const { pipelineAgentSource } = require('../il2cpp/pipelineAgent');

async function main() {
  const seconds = Number(process.argv[2] || 30);
  const procs = await findDofusProcesses();
  if (procs.length === 0) { console.error('Aucun process Dofus.'); process.exit(1); }
  const session = await frida.attach(procs[0].pid);
  const script = await session.createScript(pipelineAgentSource({}));
  const t0 = Date.now();
  const seen = new Map();

  script.message.connect((m) => {
    if (m.type === 'error') { console.error('AGENT:', m.description); return; }
    const p = m.payload || {};
    if (p.kind !== 'msg' || p.dir !== 'out') return;
    if (String(p.name).indexOf('DotNetty') === 0) return;
    const t = ((Date.now() - t0) / 1000).toFixed(1);
    seen.set(p.name, (seen.get(p.name) || 0) + 1);
    console.log(`t+${t.padStart(5)}s  ${p.name}  ${JSON.stringify(p.json).slice(0, 220)}`);
  });

  await script.load();
  console.log(`observation SORTANTE de ${procs[0].name} pendant ${seconds}s\n`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await script.unload().catch(() => {});
  await session.detach().catch(() => {});
  console.log('\nrécapitulatif:');
  for (const [k, v] of [...seen.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
