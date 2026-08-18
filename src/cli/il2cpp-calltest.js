'use strict';
const frida = require('frida');
const { findDofusProcesses } = require('../injector');
const { callTestAgentSource } = require('../il2cpp/callTestAgent');

async function main() {
  const procs = await findDofusProcesses();
  if (procs.length === 0) { console.error('Aucun process Dofus.'); process.exit(1); }
  const session = await frida.attach(procs[0].pid);
  const script = await session.createScript(callTestAgentSource());

  const done = new Promise((resolve) => {
    script.message.connect((m) => {
      if (m.type === 'error') { console.error('AGENT:', m.description); return resolve(); }
      const p = m.payload || {};
      if (p.kind === 'ready') console.log('agent prêt — joue quelques secondes');
      else if (p.kind === 'capture') console.log(`objet capturé et épinglé: ${p.className} (handle ${p.handle})`);
      else if (p.kind === 'result') {
        if (p.ok) {
          console.log(`\nAPPEL RÉUSSI sur ${p.className}`);
          console.log(p.text);
        } else {
          console.log(`\nAPPEL ÉCHOUÉ: ${p.why}`);
        }
        resolve();
      }
    });
  });

  await script.load();
  await Promise.race([done, new Promise((r) => setTimeout(r, 30000))]);
  await script.unload().catch(() => {});
  await session.detach().catch(() => {});
}
main().catch((e) => { console.error(e.message); process.exit(1); });
