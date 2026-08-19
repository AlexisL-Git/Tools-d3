'use strict';
const frida = require('frida');
const { findDofusProcesses } = require('../injector');
const { egressAgentSource } = require('../il2cpp/egressAgent');

// Cartographie du chemin de sortie: quelles methodes de DotNetty sont
// reellement traversees, et a quel rythme.
//
// La question a laquelle cet outil repond: le client emet-il quelque chose
// TOUT SEUL, personnage au repos? Si oui, ce message est le candidat ideal
// pour la premiere ecriture, puisque le rejouer n'a aucun effet en jeu.
//
// usage: node src/cli/il2cpp-egress.js [secondes] [sousChaineDeClasse]

// Un keepalive se reconnait a la regularite de ses intervalles. On resume donc
// chaque point d'ancrage par la mediane de ses ecarts et leur dispersion:
// un intervalle stable (faible dispersion) sur plusieurs occurrences est un
// battement, un intervalle erratique est du trafic de jeu.
function rhythm(times) {
  if (times.length < 3) return null;
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return null;
  const spread = gaps.reduce((s, g) => s + Math.abs(g - median), 0) / gaps.length / median;
  return { median, spread, periodic: spread < 0.25 };
}

async function main() {
  const seconds = Number(process.argv[2] || 60);
  const filter = process.argv[3] === undefined ? 'Channel' : process.argv[3];

  const procs = await findDofusProcesses();
  if (procs.length === 0) { console.error('Aucun process Dofus.'); process.exit(1); }

  const session = await frida.attach(procs[0].pid);
  const script = await session.createScript(egressAgentSource({ classSubstring: filter }));

  const t0 = Date.now();
  // Le rythme se mesure PAR TYPE de message, pas par point d'ancrage: trois
  // battements distincts emis coup sur coup donnent des ecarts 0/0/2000 dont
  // la mediane vaut 0, ce qui masquait la periodicite au premier essai.
  const anchors = new Map();   // label -> Map(type -> { times: [], sample })

  script.message.connect((m) => {
    if (m.type === 'error') { console.error('AGENT:', m.description); return; }
    const p = m.payload || {};
    if (p.kind === 'ready') {
      console.log(`${p.hooked.length} points d'ancrage accroches:`);
      for (const h of p.hooked) console.log(`  ${h}`);
      console.log(`\nobservation de ${procs[0].name} pendant ${seconds}s — NE TOUCHE A RIEN\n`);
      return;
    }
    if (p.kind !== 'hit') return;
    let a = anchors.get(p.at);
    if (!a) { a = new Map(); anchors.set(p.at, a); }
    const k = p.arg1 || p.self || '(?)';
    let e = a.get(k);
    if (!e) { e = { times: [], sample: null }; a.set(k, e); }
    e.times.push(p.t - t0);
    if (e.sample === null && p.json) e.sample = p.json;
  });

  await script.load();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await script.unload().catch(() => {});
  await session.detach().catch(() => {});

  const total = (a) => [...a.values()].reduce((s, e) => s + e.times.length, 0);
  const rows = [...anchors.entries()].sort((a, b) => total(b[1]) - total(a[1]));
  if (rows.length === 0) {
    console.log('AUCUN appel sortant. Le client est muet au repos sur toute la chaine DotNetty.');
    return;
  }

  const beats = [];
  console.log('\nrecapitulatif — appels par point d ancrage, rythme par type:');
  for (const [label, kinds] of rows) {
    console.log(`\n  ${String(total(kinds)).padStart(5)}  ${label}`);
    const byCount = [...kinds.entries()].sort((x, y) => y[1].times.length - x[1].times.length);
    for (const [k, e] of byCount.slice(0, 8)) {
      const r = rhythm(e.times);
      const beat = r
        ? `${(r.median / 1000).toFixed(2)}s ±${(r.spread * 100).toFixed(0)}%${r.periodic ? '  <== PERIODIQUE' : ''}`
        : '(trop peu d appels)';
      if (r && r.periodic) beats.push({ label, k, median: r.median, n: e.times.length });
      console.log(`         ${String(e.times.length).padStart(5)}  ${k.padEnd(46)} ${beat}`);
      if (e.sample) console.log(`                ${JSON.stringify(e.sample).slice(0, 300)}`);
    }
  }

  if (beats.length === 0) {
    console.log('\nAucun rythme regulier. Pas de keepalive cote client sur cette chaine.');
    return;
  }
  console.log(`\n${beats.length} battement(s) regulier(s) — candidats keepalive:`);
  for (const b of beats) {
    console.log(`  ${b.k}  toutes les ${(b.median / 1000).toFixed(2)}s  (${b.n} fois)  via ${b.label}`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
