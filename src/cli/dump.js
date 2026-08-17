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

  let lastCounters = null;
  const session = await redirect(target.pid, proxy.port, {
    onReady: (info) => console.log('agent prêt:', info),
    onCounters: (c) => {
      lastCounters = c;
      console.log(
        `  appels réseau vus: connect=${c.connect} WSAConnect=${c.WSAConnect} ` +
          `ConnectEx=${c.ConnectEx} redirigés=${c.redirected}`
      );
    },
  });
  console.log(`Redirection de ${target.name} (pid ${target.pid}) pendant ${seconds}s...`);
  console.log('IMPORTANT: le hook ne prend effet que sur les NOUVELLES connexions.');
  console.log('Change de map, ou reconnecte le personnage, pour forcer un connect().');

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

  await session.detach();
  await proxy.close();
  recorder.close();
  console.log(`${recorder.count} enregistrements capturés dans ${file}`);

  if (recorder.count === 0) {
    console.log('\nCapture vide. Diagnostic:');
    if (lastCounters === null) {
      console.log("  L'agent n'a jamais rapporté ses compteurs — il a probablement échoué au chargement.");
    } else if (lastCounters.connect === 0 && lastCounters.WSAConnect === 0 && lastCounters.ConnectEx === 0) {
      console.log('  Aucun appel de connexion pendant la fenêtre: le client réutilise sa socket existante.');
      console.log('  Un changement de map ne crée PAS de nouvelle connexion TCP dans Dofus.');
      console.log('  Il faut soit une reconnexion complète du personnage, soit lancer le jeu sous Frida.');
    } else if (lastCounters.connect === 0) {
      console.log(`  Le client n'utilise pas connect() mais WSAConnect=${lastCounters.WSAConnect} / ConnectEx=${lastCounters.ConnectEx}.`);
      console.log("  Le hook doit viser ces API-là, pas connect().");
    } else {
      console.log(`  ${lastCounters.connect} connect() vus mais ${lastCounters.redirected} redirigés:`);
      console.log('  les connexions étaient non-IPv4 ou déjà locales.');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
