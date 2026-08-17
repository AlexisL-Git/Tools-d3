'use strict';
const path = require('node:path');
const { createProxy } = require('../proxy/server');
const { redirect, findDofusProcesses } = require('../injector');
const { Recorder } = require('../capture/recorder');

async function main() {
  const seconds = Number(process.argv[2] || 30);
  const processes = await findDofusProcesses();
  if (processes.length === 0) {
    console.error('Aucun process Dofus trouvé. Lance le jeu et connecte-toi à un personnage.');
    process.exit(1);
  }
  const target = processes[0];

  const file = path.join('captures', `dump-${target.pid}-${Date.now()}.bin`);
  const recorder = new Recorder(file);

  const proxy = await createProxy({
    port: 0,
    onData: (direction, buf) => recorder.write(direction, buf),
  });
  console.log(`Proxy sur 127.0.0.1:${proxy.port}`);

  const session = await redirect(target.pid, proxy.port, {
    onReady: (info) => console.log('agent prêt:', info),
  });
  console.log(`Redirection de ${target.name} (pid ${target.pid}) pendant ${seconds}s...`);
  console.log('IMPORTANT: le hook ne prend effet que sur les NOUVELLES connexions.');
  console.log('Change de map, ou reconnecte le personnage, pour forcer un connect().');

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

  await session.detach();
  await proxy.close();
  recorder.close();
  console.log(`${recorder.count} enregistrements capturés dans ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
