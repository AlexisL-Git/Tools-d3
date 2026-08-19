'use strict';
const { Superviseur } = require('../superviseur');
const { findDofusProcesses } = require('../injector');
const { lookup } = require('../protocol/replicate');

// Le Replicate complet: 1 a 8 clients, le maitre est celui dont la fenetre a
// le focus, ses actions sont rejouees chez les autres.
//
//   node src/cli/mm.js               observe et affiche ce qui SERAIT rejoue
//   node src/cli/mm.js --armer       rejoue pour de bon
//
// Sans --armer, rien ne part sur le reseau. C'est le defaut, et c'est
// volontaire: le compte rendu permet de verifier chaque decision avant que la
// premiere action ne soit reellement dupliquee.

function nomCourt(pid, clients) {
  const c = clients.get(pid);
  return c ? `${c.nom || 'client'}/${pid}` : `pid ${pid}`;
}

async function main() {
  const arme = process.argv.includes('--armer');

  const procs = await findDofusProcesses();
  if (procs.length === 0) {
    console.error('Aucun client Dofus lancé.');
    process.exit(1);
  }
  if (procs.length > 8) {
    console.error(`${procs.length} clients trouvés — le maximum prévu est 8.`);
    process.exit(1);
  }

  const superviseur = new Superviseur({
    arme,
    onJournal: (pid, texte) => console.log(`[${pid}] ${texte}`),
    onTrame: ({ pid, dir, frame, brute, estMaitre }) => {
      // Seules les requetes SORTANTES du maitre se rejouent: ce que le serveur
      // renvoie est propre a chaque client et n'a rien a faire ailleurs.
      if (dir !== 'out' || frame.kind !== 'request') return;
      const connu = lookup(frame.type);
      if (connu === null) return;
      if (!estMaitre) return;

      const rendu = superviseur.rejouer({ type: frame.type, brute, pidMaitre: pid });
      const faits = rendu.filter((r) => r.fait).length;
      const refus = rendu.filter((r) => !r.fait);
      console.log(
        `${connu.name} (${frame.type}) — ${arme ? `${faits}/${rendu.length} rejoué(s)` : `${rendu.length} rejeu(x) simulé(s)`}`,
      );
      for (const r of refus) console.log(`    ${nomCourt(r.pid, superviseur.clients)} : ${r.raison}`);
    },
  });

  console.log(`${procs.length} client(s) — mode ${arme ? 'ARMÉ : les actions seront dupliquées' : "observation : rien n'est envoyé"}\n`);
  for (const p of procs) {
    await superviseur.ajouter({ pid: p.pid, nom: p.name });
  }

  console.log('\nLe client au premier plan est le maître. Ctrl+C pour arrêter.\n');

  let arret = false;
  process.on('SIGINT', async () => {
    if (arret) return;
    arret = true;
    console.log('\narrêt…');
    for (const etat of superviseur.comptes.tous) {
      console.log(`  ${etat.pid} : ${etat.trames} trames, personnage ${etat.characterId ?? '(inconnu)'}`);
    }
    await superviseur.arreter();
    process.exit(0);
  });

  await new Promise(() => {});
}

main().catch((e) => { console.error(e.message); process.exit(1); });
