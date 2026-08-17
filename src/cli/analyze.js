'use strict';
const { Player } = require('../capture/player');
const { shannonEntropy } = require('../analysis/entropy');
const { probeFraming, verdict } = require('../analysis/framingProbe');

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: npm run analyze -- <captures/dump-....bin>');
    process.exit(1);
  }

  const records = Player.load(file).records();
  if (records.length === 0) {
    console.error('Capture vide. Le jeu était-il connecté à un personnage pendant le dump ?');
    process.exit(1);
  }

  // Les deux sens sont des flux TCP distincts : on les analyse séparément.
  for (const direction of ['in', 'out']) {
    const payloads = records.filter((r) => r.direction === direction).map((r) => r.payload);
    if (payloads.length === 0) {
      console.log(`\n=== sens ${direction} : aucun octet ===`);
      continue;
    }
    const all = Buffer.concat(payloads);
    const entropy = shannonEntropy(all);
    const probe = probeFraming(payloads);
    const v = verdict({ entropy, ratio: probe.ratio });

    console.log(`\n=== sens ${direction} (${direction === 'in' ? 'serveur → client' : 'client → serveur'}) ===`);
    console.log(`enregistrements    : ${payloads.length}`);
    console.log(`octets             : ${all.length}`);
    console.log(`entropie           : ${entropy.toFixed(3)} bits/octet`);
    console.log(`trames réassemblées: ${probe.frames}`);
    console.log(`ratio consommé     : ${(probe.ratio * 100).toFixed(1)}%`);
    console.log(`erreurs framing    : ${probe.errors}`);
    console.log(`VERDICT: ${v.conclusion.toUpperCase()} — ${v.reason}`);
    console.log('premiers octets:');
    console.log(all.subarray(0, 64).toString('hex').replace(/(..)/g, '$1 '));
  }
}

main();
