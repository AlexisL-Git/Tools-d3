'use strict';
const path = require('node:path');
const { sniff, findDofusProcesses } = require('../injector');
const { Recorder } = require('../capture/recorder');

async function main() {
  const seconds = Number(process.argv[2] || 30);
  const processes = await findDofusProcesses();
  if (processes.length === 0) {
    console.error('Aucun process Dofus trouvé.');
    process.exit(1);
  }
  const target = processes[0];

  const file = path.join('captures', `sniff-${target.pid}-${Date.now()}.bin`);
  const recorder = new Recorder(file);
  const perSocket = new Map();
  const peers = new Map();

  const session = await sniff(target.pid, {
    onReady: (info) => console.log('agent prêt (lecture seule):', JSON.stringify(info.hooks)),
    onPeer: (sock, peer) => {
      peers.set(String(Number(sock) >>> 0), peer);
      console.log(`  socket ${sock} -> ${peer}`);
    },
    onCounters: (c) =>
      console.log(
        '  ' + Object.entries(c).filter(([k, v]) => v > 0 || k === 'bytes').map(([k, v]) => `${k}=${v}`).join(' ')
      ),
    onData: (direction, buf, sock) => {
      const id = Number(sock) >>> 0;
      recorder.write(direction, buf, id);
      const key = `${id}`;
      const s = perSocket.get(key) || { in: 0, out: 0 };
      s[direction] += buf.length;
      perSocket.set(key, s);
    },
  });

  console.log(`Capture LECTURE SEULE de ${target.name} (pid ${target.pid}) pendant ${seconds}s.`);
  console.log('Aucun octet modifié, aucune connexion redirigée. Joue normalement.');

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  await session.detach();
  recorder.close();

  console.log(`\n${recorder.count} enregistrements, ${recorder.bytes} octets -> ${file}`);
  console.log('\ntrafic par socket:');
  const rows = [...perSocket.entries()].sort((a, b) => b[1].in + b[1].out - (a[1].in + a[1].out));
  for (const [sock, s] of rows.slice(0, 10)) {
    const peer = peers.get(sock) || '?';
    console.log(`  socket ${sock.padStart(6)}  in=${String(s.in).padStart(7)}  out=${String(s.out).padStart(7)}  ${peer}`);
  }
  if (rows.length > 0) {
    console.log(`\nLa socket de jeu est très probablement la plus bavarde: ${rows[0][0]}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
