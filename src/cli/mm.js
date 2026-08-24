'use strict';
const { Superviseur } = require('../superviseur');
const { findDofusProcesses } = require('../injector');
const { creerDuplicateur, ETALEMENT_REJEU } = require('../duplicateur');
const { creerPasseur } = require('../passeur');
const { composer } = require('../composer');

// Le OMNI complet: 1 a 8 clients, le maitre est celui dont la fenetre a
// le focus, ses actions sont rejouees chez les autres.
//
//   node src/cli/mm.js               observe et affiche ce qui SERAIT rejoue
//   node src/cli/mm.js --armer       rejoue pour de bon
//
// Sans --armer, aucun REJEU ne part sur le reseau. C'est le defaut, et c'est
// volontaire: le compte rendu permet de verifier chaque decision avant que la
// premiere action ne soit reellement dupliquee.
//
// Le passe-tour, lui, ne depend pas de --armer: c'est une politique
// independante, avec son propre interrupteur. --passe-tour emet donc de
// vraies trames jxy, arme ou non. C'est voulu.

function nomCourt(pid, clients) {
  const c = clients.get(pid);
  return c ? `${c.nom || 'client'}/${pid}` : `pid ${pid}`;
}

// Les valeurs decodees sont des BigInt et des Buffer: JSON.stringify les
// refuse ou les deforme. On les rend lisibles sans perdre l'exactitude.
function aplatir(champs) {
  if (!Array.isArray(champs)) return champs;
  return champs.map((f) => ({
    no: f.no,
    v: typeof f.value === 'bigint' ? f.value.toString()
      : Buffer.isBuffer(f.value) ? f.value.toString('hex')
      : Array.isArray(f.value) ? aplatir(f.value)
      : f.value,
  }));
}

async function main() {
  const arme = process.argv.includes('--armer');
  // Le passe-tour est independant du OMNI: son propre interrupteur, son
  // propre delai. Le CLI n'ayant pas d'interface, il est actif pour TOUS les
  // comptes pris en charge des qu'on le lance avec --passe-tour.
  const passeTour = process.argv.includes('--passe-tour');
  const iDelai = process.argv.indexOf('--delai');
  const delaiMs = iDelai >= 0 ? Math.round(Number(process.argv[iDelai + 1]) * 1000) : 0;
  const iJournal = process.argv.indexOf('--journal');
  // Journal de TOUTES les trames decodees, dans les deux sens et pour chaque
  // client. Sert a retrouver par correlation le message entrant qui annonce a
  // un client une valeur qu'il reutilise ensuite dans ses requetes.
  const journal = iJournal >= 0 ? require('node:fs').createWriteStream(process.argv[iJournal + 1]) : null;

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
        // Le CLI n'a pas d'interrupteur par compte: --passe-tour l'active pour
        // tous, des la prise en charge.
        if (passeTour) {
          const etat = superviseur.comptes.get(p.pid);
          if (etat) etat.passeTour = true;
        }
      } catch (e) {
        console.log(`[${p.pid}] attache impossible : ${e.message}`);
      }
    }
  }

  const superviseur = new Superviseur({
    arme,
    // Meme etalement que l'application. Une politique de rejeu qui differe
    // entre les deux rendrait un essai au CLI non representatif.
    etalementRejeu: ETALEMENT_REJEU,
    onJournal: (pid, texte) => console.log(`[${pid}] ${texte}`),
  });

  // La decision de rejeu vit dans src/duplicateur.js, partagee avec
  // l'application: la recopier d'un cote a l'autre a deja produit une
  // application qui decodait tout et ne rejouait rien. Ici, elle n'ecrit que
  // le compte rendu console.
  const rejouer = creerDuplicateur({
    superviseur,
    onCompteRendu: ({ type, nom, arme: armeAlors, rendu }) => {
      const ok = rendu.filter((r) => r.ok);
      const refus = rendu.filter((r) => !r.ok);
      console.log(
        `${nom} (${type}) — ${ok.length}/${rendu.length} ` +
        (armeAlors ? 'rejoué(s)' : 'rejouable(s), rien envoyé'),
      );
      for (const r of ok) {
        // Le retard fait partie du compte rendu: sans lui, un rejeu etale et
        // un rejeu simultane produisent la meme sortie.
        const quand = r.emis ? ` — ENVOYÉ dans ${r.retardMs} ms` : '';
        console.log(`    ${nomCourt(r.pid, superviseur.clients)} : ${r.action}, ${r.octets} o${quand}`);
      }
      for (const r of refus) console.log(`    ${nomCourt(r.pid, superviseur.clients)} : ${r.raison}`);
    },
  });

  // Le passe-tour est une politique independante du OMNI: son propre
  // reglage, relu a chaque trame et a chaque echeance de minuteur.
  const passer = creerPasseur({
    superviseur,
    reglages: { actif: passeTour, delaiMs },
    onCompteRendu: ({ pid, ok, raison }) => {
      console.log(`  passe-tour ${pid} : ${ok ? 'ENVOYÉ' : raison}`);
    },
  });

  // Le superviseur n'appelle qu'un seul onTrame: les deux politiques se
  // composent ici, sans se gener l'une l'autre.
  const traiter = composer(rejouer, passer);

  // Le journal brut est propre au CLI et precede toute decision: il doit
  // porter TOUTES les trames, y compris celles qui ne se rejouent pas.
  superviseur.onTrame = (trame) => {
    if (journal) {
      journal.write(JSON.stringify({
        t: Date.now(), pid: trame.pid, dir: trame.dir,
        kind: trame.frame.kind, type: trame.frame.type,
        payload: aplatir(trame.frame.payload),
      }) + '\n');
    }
    traiter(trame);
  };

  // Le message ne parle que du OMNI: annoncer « rien n'est envoyé » alors
  // que --passe-tour emet de vraies trames serait le contraire de la verite.
  console.log(`mode ${arme ? 'ARMÉ : les actions seront dupliquées' : "observation : aucun rejeu n'est envoyé"}`);
  if (passeTour) {
    console.log(`passe-tour ACTIF pour tous les comptes — il ÉMET pour de bon, indépendamment de --armer (délai ${delaiMs} ms)`);
  }
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
