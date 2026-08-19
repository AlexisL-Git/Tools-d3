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

  // On n'attend pas que les clients soient la: on les attend. La connexion au
  // serveur de jeu s'ouvre des l'ecran de connexion, pas a l'entree en partie
  // — attacher un client deja lance arrive donc systematiquement trop tard.
  // C'est aussi ce qu'il faut pour huit comptes lances les uns apres les
  // autres.
  const connus = new Set();
  async function balayer() {
    let procs = [];
    try { procs = await findDofusProcesses(); } catch (e) { return; }

    const vivants = new Set(procs.map((p) => p.pid));
    for (const pid of [...connus]) {
      if (vivants.has(pid)) continue;
      connus.delete(pid);
      if (await superviseur.retirer(pid)) console.log(`[${pid}] client fermé, retiré`);
    }

    for (const p of procs) {
      if (connus.has(p.pid)) continue;
      if (connus.size >= 8) {
        console.log(`[${p.pid}] ignoré — maximum de 8 clients atteint`);
        connus.add(p.pid);
        continue;
      }
      connus.add(p.pid);
      try {
        await superviseur.ajouter({ pid: p.pid, nom: p.name });
        console.log(`[${p.pid}] client ${connus.size} pris en charge`);
      } catch (e) {
        console.log(`[${p.pid}] attache impossible : ${e.message}`);
      }
    }
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
      if (rendu.length === 0) return;
      const ok = rendu.filter((r) => r.ok);
      const refus = rendu.filter((r) => !r.ok);
      console.log(
        `${connu.name} (${frame.type}) — ${ok.length}/${rendu.length} ` +
        (arme ? 'rejoué(s)' : 'rejouable(s), rien envoyé'),
      );
      for (const r of ok) {
        console.log(`    ${nomCourt(r.pid, superviseur.clients)} : ${r.action}, ${r.octets} o${r.emis ? ' — ENVOYÉ' : ''}`);
      }
      for (const r of refus) console.log(`    ${nomCourt(r.pid, superviseur.clients)} : ${r.raison}`);
    },
  });

  console.log(`mode ${arme ? 'ARMÉ : les actions seront dupliquées' : "observation : rien n'est envoyé"}`);
  console.log('en attente des clients Dofus — lance-les maintenant.\n');

  await balayer();
  // Surtout pas de unref() ici: une promesse jamais resolue ne retient pas la
  // boucle d'evenements. Sans client encore attache, plus rien ne maintenait
  // le process et il sortait aussitot. C'est ce minuteur qui le tient en vie
  // pendant qu'on attend les clients.
  setInterval(balayer, 500);

  console.log('Le client au premier plan est le maître. Ctrl+C pour arrêter.\n');

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
