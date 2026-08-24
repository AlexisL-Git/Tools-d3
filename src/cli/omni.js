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
//   node src/cli/omni.js spawn <chemin\Dofus.exe> [--port 8210] [--id <empreinte>]
//   node src/cli/omni.js attach [pid]            (trop tard pour les premiers connect)

function parseArgs(argv) {
  const out = { port: 8210, id: null, exclude: [], only: null, mode: argv[0], target: argv[1] };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--port') out.port = Number(argv[++i]);
    else if (argv[i] === '--id') out.id = argv[++i];
    // Le client dialogue aussi avec le launcher Ankama en local. Detourner ces
    // connexions-la coupe la session et le jeu affiche « connection lost ».
    else if (argv[i] === '--exclude') out.exclude = argv[++i].split(',').map(Number);
    // --all detourne tout sauf les ports exclus, au lieu du seul port de jeu.
    else if (argv[i] === '--all') out.only = [];
    else if (argv[i] === '--only') out.only = argv[++i].split(',').map(Number);
    else if (argv[i] === '--arg') (out.extra = out.extra || []).push(argv[++i]);
  }
  if (out.target === '--port' || out.target === '--id') out.target = null;
  return out;
}

// Le compteur brut compte AVANT tout decodage. Sans lui, l'absence de sortie
// se lit aussi bien comme « aucun trafic » que comme « du trafic illisible »,
// et on ne peut rien conclure. Le meme piege a deja fausse deux conclusions
// dans ce projet.
function makeReader(label, stats) {
  const asm = new FrameReassembler();
  return (chunk) => {
    stats.chunks++;
    stats.bytes += chunk.length;
    let frames = [];
    try { frames = asm.push(chunk); } catch (e) { stats.erreurs++; return; }
    for (const f of frames) {
      stats.trames++;
      const d = decodeFrameRaw(f);
      if (d === null) { stats.illisibles++; continue; }
      stats.lues++;
      const uid = d.uid === null || d.uid === -1n ? '' : ` uid=${d.uid}`;
      console.log(`${label} ${d.kind.padEnd(8)} ${String(d.type).padEnd(5)}${uid}`);
      if (d.payload) console.log(render(d.payload, '          '));
    }
  };
}

function reportStats(stats) {
  const line = (dir, s) =>
    `  ${dir}  ${String(s.chunks).padStart(5)} blocs / ${String(s.bytes).padStart(8)} o` +
    `  ->  ${String(s.trames).padStart(5)} trames, ${s.lues} lues, ${s.illisibles} illisibles` +
    (s.erreurs ? `, ${s.erreurs} erreurs de cadrage` : '');
  console.log('— état —');
  console.log(line('=>', stats.out));
  console.log(line('<=', stats.in));
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.mode !== 'spawn' && a.mode !== 'attach') {
    console.error('usage: node src/cli/omni.js spawn <Dofus.exe> [--port N] [--id X]');
    console.error('       node src/cli/omni.js attach [pid] [--port N] [--id X]');
    process.exit(1);
  }

  const fresh = () => ({ chunks: 0, bytes: 0, trames: 0, lues: 0, illisibles: 0, erreurs: 0 });
  const stats = { in: fresh(), out: fresh() };
  // Un reassembleur par connexion ET par sens: les flux sont independants, et
  // seule la connexion vers le port de jeu porte le protocole. Y meler le
  // HTTPS des CDN produisait des longueurs de trame absurdes.
  const readers = new Map();
  const ignored = new Set();

  const proxy = await createProxy({
    port: a.port,
    onProbleme: (p) => console.log(`  !! connexion ${p.id} abandonnée — ${p.raison}${p.cible ? ` (${p.cible})` : ''}`),
    onData: (dir, buf, conn) => {
      const jeu = a.only === null || a.only.length === 0
        ? conn.port === 5555
        : a.only.includes(conn.port);
      if (!jeu) {
        if (!ignored.has(conn.id)) {
          ignored.add(conn.id);
          console.log(`  (connexion ${conn.id} vers ${conn.host}:${conn.port} relayée sans décodage)`);
        }
        return;
      }
      const key = `${conn.id}/${dir}`;
      if (!readers.has(key)) {
        readers.set(key, makeReader(dir === 'out' ? '=>  ' : '  <=', stats[dir]));
        if (dir === 'out') console.log(`  >>> connexion de JEU ${conn.id} vers ${conn.host}:${conn.port}`);
      }
      readers.get(key)(buf);
    },
  });
  console.log(`proxy à l'écoute sur 127.0.0.1:${proxy.port}`);
  const ticker = setInterval(() => reportStats(stats), 15000);
  ticker.unref();

  const src = connectAgentSource({
    proxyPort: proxy.port,
    fakeDeviceId: a.id,
    excludePorts: a.exclude,
    ...(a.only === null ? {} : { onlyPorts: a.only }),
  });

  let session;
  let pid = null;
  if (a.mode === 'spawn') {
    if (!a.target) { console.error('chemin du binaire manquant'); process.exit(1); }
    // Le jeu est demarre suspendu: l'agent doit etre en place AVANT le premier
    // connect, sinon la session s'etablit hors de notre proxy et il est trop
    // tard pour la rattraper.
    pid = await frida.spawn([a.target, ...(a.extra || [])]);
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
    if (p.connect) console.log(`  connect ${p.connect.padEnd(24)} ${p.detourne ? '-> DÉTOURNÉ' : '(laissé passer)'}`);
    else if (p.ready) console.log(`agent en place — ${p.ready.join(' | ')}`);
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
