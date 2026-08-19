'use strict';
const frida = require('frida');
const { createProxy } = require('../proxy/server');
const { FrameReassembler } = require('../codec/framing');
const { decodeFrameRaw, render } = require('../codec/rawProto');
const { connectAgentSource } = require('../il2cpp/connectAgent');
const { findDofusProcesses } = require('../injector');

// Premier bout-en-bout: un client passe par NOTRE proxy et on lit ses trames.
// Aucune reemission — cette etape ne fait qu'observer, par la voie que le
// produit payant utilise, au lieu de lire depuis l'interieur du jeu.
//
// usage:
//   node src/cli/replicate.js spawn <chemin\Dofus.exe> [--port 8210] [--id <empreinte>]
//   node src/cli/replicate.js attach [pid]            (trop tard pour les premiers connect)

function parseArgs(argv) {
  const out = { port: 8210, id: null, mode: argv[0], target: argv[1] };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--port') out.port = Number(argv[++i]);
    else if (argv[i] === '--id') out.id = argv[++i];
  }
  if (out.target === '--port' || out.target === '--id') out.target = null;
  return out;
}

function makeReader(label) {
  const asm = new FrameReassembler();
  let bad = 0;
  return (chunk) => {
    let frames = [];
    try { frames = asm.push(chunk); } catch (e) { console.log(`${label} ! ${e.message}`); return; }
    for (const f of frames) {
      const d = decodeFrameRaw(f);
      if (d === null) { bad++; continue; }
      const uid = d.uid === null || d.uid === -1n ? '' : ` uid=${d.uid}`;
      console.log(`${label} ${d.kind.padEnd(8)} ${String(d.type).padEnd(5)}${uid}`);
      if (d.payload) console.log(render(d.payload, '          '));
    }
    if (bad && bad % 20 === 0) console.log(`${label} (${bad} trames non décodées)`);
  };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.mode !== 'spawn' && a.mode !== 'attach') {
    console.error('usage: node src/cli/replicate.js spawn <Dofus.exe> [--port N] [--id X]');
    console.error('       node src/cli/replicate.js attach [pid] [--port N] [--id X]');
    process.exit(1);
  }

  const seen = { in: makeReader('  <='), out: makeReader('=>  ') };
  const proxy = await createProxy({
    port: a.port,
    onData: (dir, buf) => seen[dir](buf),
  });
  console.log(`proxy à l'écoute sur 127.0.0.1:${proxy.port}`);

  const src = connectAgentSource({ proxyPort: proxy.port, fakeDeviceId: a.id });

  let session;
  let pid = null;
  if (a.mode === 'spawn') {
    if (!a.target) { console.error('chemin du binaire manquant'); process.exit(1); }
    // Le jeu est demarre suspendu: l'agent doit etre en place AVANT le premier
    // connect, sinon la session s'etablit hors de notre proxy et il est trop
    // tard pour la rattraper.
    pid = await frida.spawn([a.target]);
    session = await frida.attach(pid);
  } else {
    if (a.target) pid = Number(a.target);
    else {
      const procs = await findDofusProcesses();
      if (procs.length === 0) { console.error('Aucun process Dofus.'); process.exit(1); }
      pid = procs[0].pid;
    }
    session = await frida.attach(pid);
  }

  const script = await session.createScript(src);
  script.message.connect((m) => {
    if (m.type === 'error') { console.error('AGENT:', m.description); return; }
    const p = m.payload || {};
    if (p.ready) console.log(`agent en place — ${p.ready.join(' | ')}`);
    else if (p.hooked) console.log(`agent: ${p.hooked}`);
    else if (p.warn) console.log(`agent (avertissement): ${p.warn}`);
  });
  await script.load();

  if (a.mode === 'spawn') {
    await frida.resume(pid);
    console.log(`client démarré (pid ${pid})`);
  } else {
    console.log(`attaché au pid ${pid} — les connexions déjà ouvertes échappent au proxy`);
  }

  console.log('Ctrl+C pour arrêter.\n');
  process.on('SIGINT', async () => {
    await script.unload().catch(() => {});
    await session.detach().catch(() => {});
    await proxy.close();
    process.exit(0);
  });
  await new Promise(() => {});
}

main().catch((e) => { console.error(e.message); process.exit(1); });
