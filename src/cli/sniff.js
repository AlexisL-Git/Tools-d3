'use strict';
const path = require('node:path');
const { createProxy } = require('../proxy/server');
const { redirect, findDofusProcesses } = require('../injector');
const { FrameReassembler } = require('../codec/framing');
const { loadRegistry } = require('../codec/registry');
const { decodeEnvelope } = require('../codec/envelope');
const { MessageStats } = require('../stats');
const { Recorder } = require('../capture/recorder');

// Le dictionnaire est versionne avec le projet. Il vivait dans .cache, le dossier
// de dofus-multi, qui le vide a chaque mise a jour : le 2026-08-23 game/ est revenu
// vide et loadRegistry echouait avant meme d'ouvrir Dofus (cf. protocole/README.md).
const PROTOCOLE = path.join(__dirname, '..', '..', 'protocole');
// L'enveloppe et les messages de jeu sont deux roots distincts (cf. registry.js).
const PROTO_SOURCES = [path.join(PROTOCOLE, '_Message.proto'), path.join(PROTOCOLE, 'game')];

const SEUIL_INCONNUS = 0.3;

async function main() {
  const registry = await loadRegistry(PROTO_SOURCES);
  const processes = await findDofusProcesses();
  if (processes.length === 0) {
    console.error('Aucun process Dofus trouvé.');
    process.exit(1);
  }
  const target = processes[0];

  // Un réassembleur par sens : ce sont deux flux TCP distincts.
  const reassemblers = { in: new FrameReassembler(), out: new FrameReassembler() };
  const stats = new MessageStats();
  const recorder = new Recorder(path.join('captures', `sniff-${target.pid}-${Date.now()}.bin`));

  const proxy = await createProxy({
    port: 0,
    onData: (direction, buf) => {
      recorder.write(direction, buf);
      let frames;
      try {
        frames = reassemblers[direction].push(buf);
      } catch (err) {
        console.error(`framing (${direction}): ${err.message}`);
        return;
      }
      for (const frame of frames) {
        try {
          const msg = decodeEnvelope(registry, frame);
          stats.record(msg);
          const tag = msg.unknown ? '?' : ' ';
          const arrow = direction === 'in' ? '<-' : '->';
          console.log(`${tag} ${arrow} ${msg.kind.padEnd(8)} ${msg.name}`);
        } catch (err) {
          stats.record({ name: '<illisible>', unknown: true });
        }
      }
    },
  });

  const session = await redirect(target.pid, proxy.port);
  console.log(`Sniffing ${target.name} (pid ${target.pid}) via 127.0.0.1:${proxy.port}. Ctrl+C pour arrêter.`);
  console.log('Le hook ne prend effet que sur les nouvelles connexions : change de map pour en forcer une.');

  const timer = setInterval(() => {
    const ratio = stats.unknownRatio();
    if (ratio > SEUIL_INCONNUS && stats.total > 50) {
      console.warn(
        `\nALERTE: ${(ratio * 100).toFixed(1)}% de messages inconnus sur ${stats.total}. ` +
          `Le jeu de .proto est probablement périmé — Dofus a-t-il été patché ?\n`
      );
    }
  }, 10000);

  process.on('SIGINT', async () => {
    clearInterval(timer);
    await session.detach();
    await proxy.close();
    recorder.close();
    console.log('\n--- messages les plus fréquents ---');
    for (const row of stats.top(20)) {
      console.log(`${String(row.count).padStart(6)}  ${row.unknown ? '?' : ' '} ${row.name}`);
    }
    console.log(`\ntotal ${stats.total}, inconnus ${(stats.unknownRatio() * 100).toFixed(1)}%`);
    console.log(`capture: ${recorder.filePath}`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
