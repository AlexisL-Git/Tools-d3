'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { Superviseur, PORT_JEU } = require('../src/superviseur');
const { createProxy } = require('../src/proxy/server');
const { creerDuplicateur } = require('../src/duplicateur');

// Les sept types dont l'utilisateur a besoin — zaap, havre-sac, PNJ, quetes,
// dialogue, donjon, et le deplacement associe. InteractiveUseRequest, seul
// message exigeant une substitution de skillInstanceUid, est celui de la
// recolte de metier, hors perimetre.
// `jqk` et `jrh` restent de ce perimetre MECANIQUE: le superviseur sait les
// preparer et les ecrire. C est la POLITIQUE (src/duplicateur.js) qui ne les
// demande plus depuis le 28/08 — mesure a l appui. Ne pas les retirer d ici
// pour autant: ces tests verrouillent la mecanique, pas la decision.
const PERIMETRE = ['hjc', 'jbn', 'iov', 'ioy', 'kla', 'kjw', 'jqk', 'jrh'];

function superviseurAvecComptes(pids) {
  const s = new Superviseur();
  for (const pid of pids) s.comptes.ajouter({ pid, port: 8300 + pid });
  return s;
}

test('le plan de rejeu couvre tous les esclaves, jamais le maître', () => {
  const s = superviseurAvecComptes([1, 2, 3, 4, 5, 6, 7, 8]);
  const plan = s.planRejeu('hjc', 3);
  assert.strictEqual(plan.length, 7);
  assert.ok(!plan.some((p) => p.pid === 3));
});

// Six des sept types du perimetre ne decrivent que le monde: ils se rejouent
// sans rien connaitre du compte destinataire.
test('les messages de monde se copient sans état préalable', () => {
  const s = superviseurAvecComptes([1, 2]);
  for (const type of ['hjc', 'iov', 'ioy', 'kla', 'kjw', 'jqk', 'jrh']) {
    const plan = s.planRejeu(type, 1);
    assert.deepStrictEqual(plan, [{ pid: 2, action: 'copier' }], type);
  }
});

test('le havre-sac attend le characterId de chaque esclave', () => {
  const s = superviseurAvecComptes([1, 2]);
  assert.deepStrictEqual(s.planRejeu('jbn', 1), [
    { pid: 2, action: 'ignorer', raison: 'manque characterId' },
  ]);

  s.comptes.get(2).characterId = 665809125670n;
  const plan = s.planRejeu('jbn', 1);
  assert.strictEqual(plan[0].action, 'réécrire');
  assert.ok('fsor' in plan[0].champs);
});

// Emettre une trame dont on ne sait rien serait pire que de s'abstenir.
test('un type non répertorié est ignoré, pas rejoué au hasard', () => {
  const s = superviseurAvecComptes([1, 2]);
  assert.deepStrictEqual(s.planRejeu('zzz', 1), [
    { pid: 2, action: 'ignorer', raison: 'type non répertorié' },
  ]);
});

// Cliquer un zaap, un arbre ou une porte de donjon passe par le meme message.
// Sans connaitre l'element designe par le maitre, on ne peut pas chercher le
// numero correspondant chez l'esclave — et on s'abstient.
test('un clic sans élément identifié n est pas rejoué', () => {
  const s = superviseurAvecComptes([1, 2]);
  s.comptes.get(2).characterId = 1n;
  assert.deepStrictEqual(s.planRejeu('iwo', 1), [
    { pid: 2, action: 'ignorer', raison: 'manque elementId du maître' },
  ]);
});

test('chaque compte du périmètre est bien répertorié', () => {
  const s = superviseurAvecComptes([1, 2]);
  for (const type of PERIMETRE) {
    const plan = s.planRejeu(type, 1);
    assert.notStrictEqual(plan[0].raison, 'type non répertorié', type);
  }
});

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
const HJC = hex(
  '12 2b 0a 1e 0a 13 74 79 70 65 2e 61 6e 6b 61 6d 61 2e 63 6f 6d 2f 68 6a 63' +
  '12 07 08 03 18 82 90 90 5b 10 ff ff ff ff ff ff ff ff ff 01',
);

function fauxClient(s, pid) {
  const ecrits = [];
  s.clients.set(pid, { pid, amont: { write: (b) => ecrits.push(b) } });
  return ecrits;
}

// Rien ne doit partir sur le reseau tant que le superviseur n'est pas arme.
test('à vide, tout est calculé et rien n est envoyé', () => {
  const s = superviseurAvecComptes([1, 2]);
  const ecrits = fauxClient(s, 2);
  const rendu = s.rejouer({ type: 'hjc', brute: HJC, pidMaitre: 1 });
  // `ok` dit que le rejeu est possible, `emis` qu'il a eu lieu. Les confondre
  // faisait passer tout succes pour un refus en mode observation.
  assert.strictEqual(rendu[0].ok, true);
  assert.strictEqual(rendu[0].emis, false);
  assert.strictEqual(rendu[0].action, 'copier');
  assert.strictEqual(ecrits.length, 0, 'aucun octet ne doit partir');
});

test('un client fermé disparaît des plans de rejeu', async () => {
  const s = superviseurAvecComptes([1, 2]);
  fauxClient(s, 2);
  assert.strictEqual(s.rejouer({ type: 'hjc', brute: HJC, pidMaitre: 1 }).length, 1);

  await s.retirer(2);
  assert.strictEqual(s.rejouer({ type: 'hjc', brute: HJC, pidMaitre: 1 }).length, 0);
  assert.strictEqual(s.comptes.get(2), null);
});

test('une fois armé, la trame part avec son préfixe de longueur', () => {
  const s = superviseurAvecComptes([1, 2]);
  s.arme = true;
  const ecrits = fauxClient(s, 2);
  const rendu = s.rejouer({ type: 'hjc', brute: HJC, pidMaitre: 1 });

  assert.strictEqual(rendu[0].ok, true);
  assert.strictEqual(rendu[0].emis, true);
  assert.strictEqual(ecrits.length, 1);
  // Le reassembleur retire le prefixe: il doit etre remis a l'emission.
  assert.strictEqual(ecrits[0][0], HJC.length);
  assert.deepStrictEqual(ecrits[0].subarray(1), HJC);
});

test('la trame part vers les sept esclaves, jamais vers le maître', () => {
  const s = superviseurAvecComptes([1, 2, 3, 4, 5, 6, 7, 8]);
  s.arme = true;
  const ecrits = new Map();
  for (const pid of [1, 2, 3, 4, 5, 6, 7, 8]) ecrits.set(pid, fauxClient(s, pid));

  const rendu = s.rejouer({ type: 'hjc', brute: HJC, pidMaitre: 3 });
  assert.strictEqual(rendu.length, 7);
  assert.strictEqual(ecrits.get(3).length, 0, 'le maître ne se rejoue pas lui-même');
  for (const pid of [1, 2, 4, 5, 6, 7, 8]) assert.strictEqual(ecrits.get(pid).length, 1, `pid ${pid}`);
});

// --- etalement du rejeu ----------------------------------------------------
//
// Sept esclaves qui se teleportent a la milliseconde pres, c'est une signature.
// Chaque esclave part donc apres son predecesseur, d'un ecart tire au hasard
// entre minMs et maxMs. Les tirages sont cumules: c'est l'ECART ENTRE DEUX
// COMPTES qui est borne, pas le retard absolu du dernier.

// `alea` rend une suite fixee, `planifier` capture au lieu d'attendre: le test
// reste instantane et deterministe. Sans injection, rien de tout cela ne
// serait testable autrement qu'en dormant 300 ms.
function superviseurEtale(pids, { tirages, minMs = 1, maxMs = 40 } = {}) {
  let i = 0;
  const planifies = [];
  const s = new Superviseur({
    arme: true,
    etalementRejeu: { minMs, maxMs },
    alea: () => tirages[i++ % tirages.length],
    planifier: (fn, delai) => { planifies.push({ fn, delai }); return null; },
  });
  for (const pid of pids) s.comptes.ajouter({ pid, port: 8300 + pid });
  return { s, planifies };
}

test('chaque esclave part après le précédent, jamais tous ensemble', () => {
  // 0 -> minMs, 0.5 -> milieu, ~1 -> maxMs.
  const { s, planifies } = superviseurEtale([1, 2, 3, 4], { tirages: [0, 0.5, 0.999999] });
  const ecrits = new Map();
  for (const pid of [2, 3, 4]) ecrits.set(pid, fauxClient(s, pid));

  const rendu = s.rejouer({ type: 'hjc', brute: HJC, pidMaitre: 1 });

  assert.strictEqual(rendu.length, 3);
  assert.strictEqual(planifies.length, 3);
  // Rien n'est encore parti: l'emission est differee, pas immediate.
  for (const pid of [2, 3, 4]) assert.strictEqual(ecrits.get(pid).length, 0, `pid ${pid}`);

  // Ecarts tires: 1, 21, 40 — cumules, donc 1, 22, 62. Croissance stricte.
  assert.deepStrictEqual(planifies.map((p) => p.delai), [1, 22, 62]);
  const retards = planifies.map((p) => p.delai);
  for (let k = 1; k < retards.length; k++) {
    const ecart = retards[k] - retards[k - 1];
    assert.ok(ecart >= 1 && ecart <= 40, `écart ${ecart} hors bornes`);
  }

  for (const p of planifies) p.fn();
  for (const pid of [2, 3, 4]) assert.strictEqual(ecrits.get(pid).length, 1, `pid ${pid}`);
});

test('le compte rendu porte le retard de chaque esclave', () => {
  const { s } = superviseurEtale([1, 2, 3], { tirages: [0, 0.999999] });
  fauxClient(s, 2);
  fauxClient(s, 3);
  const rendu = s.rejouer({ type: 'hjc', brute: HJC, pidMaitre: 1 });
  assert.deepStrictEqual(rendu.map((r) => r.retardMs), [1, 41]);
  // `emis` reste vrai: l'emission est acquise, seule son echeance est differee.
  for (const r of rendu) assert.strictEqual(r.emis, true);
});

// Un esclave qui s'abstient ne doit pas consommer de tour d'etalement: sinon
// un trou de 40 ms s'ouvre sans qu'aucune trame ne parte.
test('un esclave qui ne rejoue pas ne décale pas les suivants', () => {
  const { s, planifies } = superviseurEtale([1, 2, 3], { tirages: [0] });
  // pid 2 n'a pas de socket amont: il est refuse.
  fauxClient(s, 3);
  const rendu = s.rejouer({ type: 'hjc', brute: HJC, pidMaitre: 1 });
  assert.strictEqual(rendu[0].ok, false);
  assert.strictEqual(rendu[1].retardMs, 1);
  assert.deepStrictEqual(planifies.map((p) => p.delai), [1]);
});

// Meme garde que emettre(): a l'echeance, on est hors de toute pile d'appel.
// Une socket fermee entre-temps y ferait remonter une exception non capturee
// dans le process principal.
test('une socket fermée à l échéance se journalise au lieu de lever', () => {
  const journaux = [];
  const s = new Superviseur({
    arme: true,
    etalementRejeu: { minMs: 1, maxMs: 40 },
    alea: () => 0,
    planifier: (fn) => { fn(); return null; },   // echeance immediate
    onJournal: (pid, texte) => journaux.push({ pid, texte }),
  });
  s.comptes.ajouter({ pid: 1, port: 1 });
  s.comptes.ajouter({ pid: 2, port: 2 });
  s.clients.set(2, { pid: 2, amont: { write: () => { throw new Error('socket fermée'); } } });

  const rendu = s.rejouer({ type: 'hjc', brute: HJC, pidMaitre: 1 });
  assert.strictEqual(rendu[0].ok, true);
  assert.strictEqual(journaux.length, 1);
  assert.match(journaux[0].texte, /socket fermée/);
  assert.strictEqual(journaux[0].pid, 2);
});

// Le desarmement prime sur tout le reste: pas d'emission, donc rien a etaler.
test('non armé, l étalement ne planifie rien', () => {
  const { s, planifies } = superviseurEtale([1, 2], { tirages: [0] });
  s.arme = false;
  const ecrits = fauxClient(s, 2);
  const rendu = s.rejouer({ type: 'hjc', brute: HJC, pidMaitre: 1 });
  assert.strictEqual(rendu[0].emis, false);
  assert.strictEqual(planifies.length, 0);
  assert.strictEqual(ecrits.length, 0);
});

// Defaut inerte, comme `arme`: sans etalement configure, rejouer() ecrit
// pendant l'appel. C'est ce que verifient les tests d'emission ci-dessus.
test('sans étalement configuré, la trame part pendant l appel', () => {
  const s = superviseurAvecComptes([1, 2]);
  s.arme = true;
  const ecrits = fauxClient(s, 2);
  const rendu = s.rejouer({ type: 'hjc', brute: HJC, pidMaitre: 1 });
  assert.strictEqual(ecrits.length, 1);
  assert.strictEqual(rendu[0].retardMs, 0);
});

test('sans socket amont, rien n est émis et la raison est donnée', () => {
  const s = superviseurAvecComptes([1, 2]);
  s.arme = true;
  const rendu = s.rejouer({ type: 'hjc', brute: HJC, pidMaitre: 1 });
  assert.deepStrictEqual(rendu, [{ pid: 2, ok: false, emis: false, raison: 'pas de socket amont' }]);
});

// Emettre la trame du maitre telle quelle ferait agir l'esclave avec
// l'identifiant d'un autre: mieux vaut ne rien envoyer.
test('un message à substituer n est pas émis tant que la valeur manque', () => {
  const s = superviseurAvecComptes([1, 2]);
  s.arme = true;
  const ecrits = fauxClient(s, 2);
  const rendu = s.rejouer({ type: 'jbn', brute: HJC, pidMaitre: 1 });
  assert.strictEqual(rendu[0].ok, false);
  assert.strictEqual(rendu[0].emis, false);
  assert.match(rendu[0].raison, /characterId/);
  assert.strictEqual(ecrits.length, 0);
});

// Le coeur du projet: le maitre clique sur un zaap avec SON numero d'action,
// l'esclave doit envoyer le SIEN pour le meme element. Valeurs relevees le
// 19/08 — element 540322, numero 14948 chez le client mesure.
test('le clic du maître est rejoué avec le numéro propre à l esclave', () => {
  const { decodeFrameRaw } = require('../src/codec/rawProto');
  const { EtatCompte } = require('../src/protocol/compte');

  const varint = (v) => {
    const out = []; let x = BigInt(v);
    do { let b = Number(x & 0x7fn); x >>= 7n; if (x > 0n) b |= 0x80; out.push(b); } while (x > 0n);
    return Buffer.from(out);
  };
  const bloc = (no, corps) => Buffer.concat([Buffer.from([(no << 3) | 2, corps.length]), corps]);
  const vchamp = (no, v) => Buffer.concat([Buffer.from([(no << 3) | 0]), varint(v)]);
  const enveloppe = (no, type, corps) => {
    const url = Buffer.from(`type.ankama.com/${type}`);
    const any = Buffer.concat([Buffer.from([0x0a, url.length]), url, bloc(2, corps)]);
    return Buffer.concat([Buffer.from([(no << 3) | 2, any.length + 2, 0x0a, any.length]), any]);
  };

  const clicMaitre = enveloppe(2, 'iwo', Buffer.concat([vchamp(1, 14948), vchamp(2, 540322)]));
  const jssEsclave = enveloppe(1, 'jss', bloc(11, Buffer.concat([
    vchamp(1, 1),
    bloc(4, Buffer.concat([vchamp(1, 20777), vchamp(2, 114)])),
    vchamp(5, 540322),
    vchamp(6, 16),
  ])));

  const s = new Superviseur({ arme: true });
  s.comptes.ajouter({ pid: 1, port: 1 });
  const esclave = s.comptes.ajouter({ pid: 2, port: 2 });
  const ecrits = fauxClient(s, 2);

  // Avant d'avoir recu sa carte, l'esclave ne sait rien et s'abstient.
  assert.strictEqual(s.rejouer({ type: 'iwo', brute: clicMaitre, pidMaitre: 1 })[0].ok, false);
  assert.strictEqual(ecrits.length, 0);

  esclave.observer(decodeFrameRaw(jssEsclave));
  assert.strictEqual(esclave.skillPour(540322n), 20777n);

  const rendu = s.rejouer({ type: 'iwo', brute: clicMaitre, pidMaitre: 1 });
  assert.strictEqual(rendu[0].ok, true);
  assert.strictEqual(rendu[0].action, 'réécrire');
  assert.strictEqual(ecrits.length, 1);

  const envoye = decodeFrameRaw(ecrits[0].subarray(1));   // sans le préfixe de longueur
  assert.strictEqual(envoye.type, 'iwo');
  const parNo = Object.fromEntries(envoye.payload.map((f) => [f.no, f.value]));
  assert.strictEqual(parNo[1], 20777n, "le numéro doit être celui de l'esclave, pas du maître");
  assert.strictEqual(parNo[2], 540322n, "l'élément du monde doit être inchangé");
});

// Le passe-tour vise UN client, pas tous les esclaves, et n'obeit pas au
// drapeau `arme` qui appartient au OMNI: il lui faut son propre chemin.
test('emettre ecrit la trame sur le client vise', () => {
  const s = superviseurAvecComptes([1, 2]);
  const ecritsUn = fauxClient(s, 1);
  const ecritsDeux = fauxClient(s, 2);

  const res = s.emettre(2, Buffer.from([0xaa, 0xbb, 0xcc]));

  assert.strictEqual(res.ok, true);
  assert.strictEqual(ecritsUn.length, 0, 'le client non vise ne recoit rien');
  assert.strictEqual(ecritsDeux.length, 1);
  // Le reassembleur retire le prefixe de longueur: emettre doit le remettre.
  assert.deepStrictEqual([...ecritsDeux[0]], [3, 0xaa, 0xbb, 0xcc]);
  assert.strictEqual(res.octets, 4);
});

// `arme` gouverne le OMNI. Si emettre s'y soumettait, eteindre le
// OMNI eteindrait le passe-tour avec lui.
test('emettre ne depend pas du drapeau arme du OMNI', () => {
  const s = superviseurAvecComptes([1]);
  s.arme = false;
  const ecrits = fauxClient(s, 1);
  s.emettre(1, Buffer.from([0x01]));
  assert.strictEqual(ecrits.length, 1);
});

// Le passe-tour a delai non nul appelle emettre depuis un setTimeout, hors de
// toute garde: une socket fermee entre-temps y ferait remonter une exception
// non capturee dans le process principal d'Electron.
test('une socket qui refuse l ecriture rend un refus, pas une exception', () => {
  const s = superviseurAvecComptes([1]);
  s.clients.set(1, { pid: 1, amont: { write: () => { throw new Error('socket fermée'); } } });
  let res;
  assert.doesNotThrow(() => { res = s.emettre(1, Buffer.from([0x01])); });
  assert.strictEqual(res.ok, false);
  assert.match(res.raison, /socket fermée/);
});

test('emettre refuse proprement un client inconnu ou sans socket', () => {
  const s = superviseurAvecComptes([1, 2]);
  s.clients.set(1, { pid: 1, amont: null });
  assert.deepStrictEqual(s.emettre(99, Buffer.from([1])), { ok: false, raison: 'client inconnu' });
  assert.deepStrictEqual(s.emettre(1, Buffer.from([1])), { ok: false, raison: 'pas de socket amont' });
});

// Le transformateur doit arriver jusqu'au proxy: sans ce fil, tout le reste
// est ecrit pour rien. C'est exactement l'erreur trouvee en revue finale sur
// le OMNI, ou onTrame n'etait pas branche et l'application ne dupliquait
// rien tout en ayant l'air de marcher.
test('le superviseur transmet son transformateur au proxy', () => {
  const t = () => null;
  const s = new Superviseur({ transformerEntrant: t });
  assert.strictEqual(s.transformerEntrant, t);
});

test('sans transformateur, le superviseur n en invente pas', () => {
  const s = new Superviseur({});
  assert.strictEqual(s.transformerEntrant, null);
});

// CRITICAL trouve en revue: createProxy attribue ses conn.id localement a
// chaque appel, donc deux comptes ont chacun une connexion n°1. Sans cle
// composee par pid, src/noanim-flux.js ferait partager le meme reassembleur
// a deux comptes differents.
test('deux comptes avec le meme conn.id recoivent des cles differentes', () => {
  const vus = [];
  const s = new Superviseur({ transformerEntrant: (buf, conn) => { vus.push(conn.id); return null; } });

  const t1 = s._transformateurPour(1);
  const t2 = s._transformateurPour(2);
  t1(Buffer.alloc(0), { id: 1, port: 5555 });
  t2(Buffer.alloc(0), { id: 1, port: 5555 });

  assert.strictEqual(vus.length, 2);
  assert.notStrictEqual(vus[0], vus[1]);
});

// La garantie « inerte par defaut » du proxy repose sur l'absence de
// fonction transformerEntrant, pas sur le resultat d'une fonction qui rend
// toujours null: l'enveloppe ne doit donc pas exister quand il n'y a rien a
// envelopper.
test('sans transformateur, createProxy recoit null et non une fonction enveloppee', () => {
  const s = new Superviseur({});
  assert.strictEqual(s._transformateurPour(1), null);
});

// Test manquant #2 de la revue finale: une connexion sur un port autre que
// celui du jeu n'est pas touchee. CRITICAL trouve en revue: _transformateurPour
// ne filtrait pas conn.port, contrairement a _recevoir -- le transformateur
// s'appliquait au HTTPS et aux CDN du client.
test('une connexion hors du port du jeu n est jamais transmise au transformateur', () => {
  const vus = [];
  const s = new Superviseur({ transformerEntrant: (buf, conn) => { vus.push(conn); return Buffer.from('MODIFIE'); } });
  const t = s._transformateurPour(1);

  const surLeJeu = t(Buffer.from('a'), { id: 1, port: PORT_JEU });
  assert.strictEqual(vus.length, 1);
  assert.deepStrictEqual(surLeJeu, Buffer.from('MODIFIE'));

  // Un port different (HTTPS, CDN...): ne doit jamais atteindre transformerEntrant.
  const horsJeu = t(Buffer.from('b'), { id: 2, port: 443 });
  assert.strictEqual(vus.length, 1, 'le transformateur ne doit pas etre appele hors du port du jeu');
  assert.strictEqual(horsJeu, null, 'null relaie les octets d origine, sans y toucher');
});

// La socket amont est le chemin d'emission: sans elle, rejouer est impossible.
test('le proxy expose la socket amont une fois établie', async (t) => {
  const echo = net.createServer((sock) => sock.on('data', (d) => sock.write(d)));
  await new Promise((r) => echo.listen(0, '127.0.0.1', r));
  const cible = echo.address().port;

  const vues = [];
  const proxy = await createProxy({ port: 0, onData: (dir, buf, conn) => vues.push(conn) });
  const client = net.connect(proxy.port, '127.0.0.1');
  t.after(async () => { client.destroy(); await proxy.close(); echo.close(); });

  await new Promise((r) => client.once('connect', r));
  client.write(Buffer.concat([Buffer.from(`CONNECT 127.0.0.1:${cible} HTTP/1.0`), Buffer.from('x')]));
  await new Promise((r) => client.once('data', r));

  assert.ok(vues.length > 0);
  assert.ok(vues[0].amont !== null, 'la socket amont doit être exposée');
  assert.strictEqual(typeof vues[0].amont.write, 'function');
});

// --- annulation des rejeux differes ---------------------------------------

// Un rejeu differe qui n'a pas encore ete ecrit peut etre repris. C'est tout
// le mecanisme du garde contre les combats dupliques: le serveur annonce le
// combat au maitre 30 ms apres son action, bien avant l'echeance du rejeu.
function superviseurAvecEsclaveEcrivant(pidMaitre, pidEsclave) {
  const ecrits = [];
  const s = new Superviseur({ arme: true, etalementRejeu: { minMs: 60, maxMs: 60 } });
  s.comptes.ajouter({ pid: pidMaitre, port: 8301 });
  s.comptes.ajouter({ pid: pidEsclave, port: 8302 });
  s.clients.set(pidEsclave, { pid: pidEsclave, amont: { write: (p) => ecrits.push(p) } });
  return { s, ecrits };
}

test('un rejeu differe s annule avant son echeance', async () => {
  const { s, ecrits } = superviseurAvecEsclaveEcrivant(1, 2);
  const rendu = s.rejouer({ type: 'hjc', brute: Buffer.from([0x08, 0x01]), pidMaitre: 1 });
  assert.strictEqual(rendu[0].emis, true);
  assert.strictEqual(s.annulerRejeux(), 1);
  await new Promise((r) => setTimeout(r, 160));
  assert.deepStrictEqual(ecrits, [], 'rien ne doit avoir ete ecrit');
});

test('annulerRejeux rend zero quand rien n attend', () => {
  const { s } = superviseurAvecEsclaveEcrivant(1, 2);
  assert.strictEqual(s.annulerRejeux(), 0);
});

// Un minuteur echu ne doit pas rester en memoire: sans cela, la liste grossit
// a chaque rejeu de la session.
test('un rejeu arrive a echeance ne reste pas annulable', async () => {
  const { s, ecrits } = superviseurAvecEsclaveEcrivant(1, 2);
  s.rejouer({ type: 'hjc', brute: Buffer.from([0x08, 0x01]), pidMaitre: 1 });
  await new Promise((r) => setTimeout(r, 160));
  assert.strictEqual(ecrits.length, 1, 'le rejeu a bien eu lieu');
  assert.strictEqual(s.annulerRejeux(), 0);
});

// Sans etalement, l'ecriture est immediate: il n'y a rien a annuler, et c'est
// le comportement voulu — un rejeu deja ecrit ne se rattrape pas.
test('un rejeu immediat n est pas annulable', () => {
  const ecrits = [];
  const s = new Superviseur({ arme: true });
  s.comptes.ajouter({ pid: 1, port: 8301 });
  s.comptes.ajouter({ pid: 2, port: 8302 });
  s.clients.set(2, { pid: 2, amont: { write: (p) => ecrits.push(p) } });
  s.rejouer({ type: 'hjc', brute: Buffer.from([0x08, 0x01]), pidMaitre: 1 });
  assert.strictEqual(ecrits.length, 1);
  assert.strictEqual(s.annulerRejeux(), 0);
});

// Deux esclaves, deux minuteurs: annulerRejeux() doit tous les reprendre,
// pas seulement celui du premier pid rencontre.
test('annulerRejeux annule les rejeux de plusieurs pids a la fois', async () => {
  const s = new Superviseur({ arme: true, etalementRejeu: { minMs: 60, maxMs: 60 } });
  s.comptes.ajouter({ pid: 1, port: 8301 });
  s.comptes.ajouter({ pid: 2, port: 8302 });
  s.comptes.ajouter({ pid: 3, port: 8303 });
  const ecrits2 = fauxClient(s, 2);
  const ecrits3 = fauxClient(s, 3);
  s.rejouer({ type: 'hjc', brute: Buffer.from([0x08, 0x01]), pidMaitre: 1 });
  assert.strictEqual(s.annulerRejeux(), 2, 'les deux esclaves avaient un rejeu en attente');
  await new Promise((r) => setTimeout(r, 160));
  assert.deepStrictEqual(ecrits2, [], 'rien ne doit avoir ete ecrit pour le pid 2');
  assert.deepStrictEqual(ecrits3, [], 'rien ne doit avoir ete ecrit pour le pid 3');
});

// Un client retire ne doit plus recevoir de trame differee: sa fermeture ne
// doit pas laisser un minuteur ecrire sur une socket morte.
test('un client retire ne reçoit plus son rejeu différé', async () => {
  const { s, ecrits } = superviseurAvecEsclaveEcrivant(1, 2);
  s.rejouer({ type: 'hjc', brute: Buffer.from([0x08, 0x01]), pidMaitre: 1 });
  await s.retirer(2);
  await new Promise((r) => setTimeout(r, 160));
  assert.deepStrictEqual(ecrits, [], 'rien ne doit avoir ete ecrit apres le retrait');
});

// --- plancher de retard ----------------------------------------------------

// Le plancher s'ajoute a l'etalement, il ne le remplace pas: les esclaves
// restent decales les uns des autres.
test('le plancher de retard recule le premier esclave', () => {
  const s = new Superviseur({ arme: false, etalementRejeu: { minMs: 20, maxMs: 20 } });
  s.comptes.ajouter({ pid: 1, port: 8301 });
  s.comptes.ajouter({ pid: 2, port: 8302 });
  s.comptes.ajouter({ pid: 3, port: 8303 });
  // Sans socket amont, rejouer refuse avant meme de calculer un retard: il
  // faut un client pour chaque esclave, comme partout ailleurs dans ce
  // fichier (voir fauxClient).
  fauxClient(s, 2);
  fauxClient(s, 3);
  const sans = s.rejouer({ type: 'hjc', brute: Buffer.from([0x08, 0x01]), pidMaitre: 1 });
  assert.deepStrictEqual(sans.map((r) => r.retardMs), [20, 40]);
  const avec = s.rejouer({ type: 'hjc', brute: Buffer.from([0x08, 0x01]), pidMaitre: 1, retardPlancher: 250 });
  assert.deepStrictEqual(avec.map((r) => r.retardMs), [270, 290]);
});

// --- absence de maitre -----------------------------------------------------

// PIEGE VERIFIE, PAS SUPPOSE. Sans maitre choisi, this.maitre vaut null et
// esclaves(null) rend TOUS les comptes, puisque aucun pid n'est egal a null.
// La liste d'esclaves n'est donc PAS ce qui protege: ce test fige le piege
// pour que personne ne se repose dessus.
test('esclaves(null) rend tous les comptes, sans exception', () => {
  const s = superviseurAvecComptes([1, 2, 3]);
  assert.strictEqual(s.comptes.esclaves(null).length, 3);
});

// Ce qui protege reellement, c'est estMaitre: le duplicateur teste ce drapeau
// avant d'appeler rejouer(), et `client.pid === null` est toujours faux. La
// surete traverse donc deux fichiers, et rien ne la signale a la lecture de
// l'un ou de l'autre.
test('sans maître, aucune trame n est marquée comme venant du maître', () => {
  const s = superviseurAvecComptes([1, 2]);
  const vues = [];
  s.onTrame = (e) => vues.push(e);
  s.maitre = null;

  const client = { pid: 1, reassembleurs: new Map() };
  const conn = { id: 1, port: PORT_JEU, amont: { write: () => {} } };
  s._recevoir(client, 'out', Buffer.concat([Buffer.from([HJC.length]), HJC]), conn);

  assert.ok(vues.length > 0, 'la trame doit bien être décodée et transmise');
  assert.ok(vues.every((v) => v.estMaitre === false));
});

// Le duplicateur reel, branche sur un superviseur sans maitre: rien ne part.
test('sans maître, le duplicateur ne rejoue chez personne', () => {
  const s = superviseurAvecComptes([1, 2]);
  const ecrits = fauxClient(s, 2);
  s.arme = true;
  s.maitre = null;
  const comptesRendus = [];
  s.onTrame = creerDuplicateur({ superviseur: s, onCompteRendu: (c) => comptesRendus.push(c) });

  const client = { pid: 1, reassembleurs: new Map() };
  const conn = { id: 1, port: PORT_JEU, amont: { write: () => {} } };
  s._recevoir(client, 'out', Buffer.concat([Buffer.from([HJC.length]), HJC]), conn);

  assert.deepStrictEqual(ecrits, [], 'aucun octet ne doit partir sans maître désigné');
  assert.strictEqual(comptesRendus.length, 0);
});

// LE MAITRE N'EST PLUS SUBI, et c'est la seule chose qui compte ici.
//
// Le message `premierPlan` alimente `enAvant`, jamais `maitre`: confondre les
// deux est exactement ce qui faisait partir les actions d'un alt chez toute
// l'equipe des qu'on cliquait sa fenetre.
//
// Le superviseur redemande cette surveillance depuis le 2026-08-29
// (reportFocus est rallume), pour que l'overlay encadre la fenetre devant
// laquelle on est. C'est exactement le « si elle est rallumee un jour » que ce
// test attendait: elle ne doit surtout pas se remettre a decerner le
// commandement.
//
// L'assertion porte desormais sur le COMPORTEMENT et non sur le source: elle
// couvre le chemin reel, et survivra a une reecriture du module.
test('le premier plan alimente enAvant, jamais le rôle de maître', () => {
  const s = superviseurAvecComptes([1, 2]);
  s.maitre = 2;

  s._recevoirMessageAgent(1, { premierPlan: true });

  assert.strictEqual(s.enAvant, 1, 'le premier plan doit être noté');
  assert.strictEqual(s.maitre, 2, 'le maître épinglé ne doit pas bouger');
});

// L'effacement est DIFFERE depuis le 2026-08-29 — voir _effacerPlusTard — mais
// ce qu'il protege n'a pas change: quitter une fenetre ne touche pas au maitre,
// ni avant l'echeance ni apres.
test('quitter le premier plan efface le point de départ, sans toucher au maître', () => {
  const differes = [];
  const s = new Superviseur({ planifier: (fn) => { differes.push(fn); return null; } });
  for (const pid of [1, 2]) s.comptes.ajouter({ pid, port: 8300 + pid });
  s.maitre = 2;
  s._recevoirMessageAgent(1, { premierPlan: true });
  s._recevoirMessageAgent(1, { premierPlan: false });
  assert.strictEqual(s.maitre, 2, 'avant l échéance');

  for (const f of differes.splice(0)) f();
  assert.strictEqual(s.enAvant, null);
  assert.strictEqual(s.maitre, 2, 'après l échéance');
});

// --- bascule de fenetre ----------------------------------------------------

function fauxScript(s, pid) {
  const postes = [];
  s.clients.set(pid, { pid, amont: null, script: { post: (m) => postes.push(m) } });
  return postes;
}

test('basculerVers poste la commande à l agent du bon client', () => {
  const s = superviseurAvecComptes([1, 2]);
  const un = fauxScript(s, 1);
  const deux = fauxScript(s, 2);

  assert.strictEqual(s.basculerVers(2).ok, true);

  assert.deepStrictEqual(deux, [{ type: 'premierPlan' }]);
  assert.deepStrictEqual(un, [], 'le client non vise ne doit rien recevoir');
});

test('basculerVers refuse un client inconnu, sans lever', () => {
  const s = superviseurAvecComptes([1]);
  const r = s.basculerVers(999);
  assert.strictEqual(r.ok, false);
  assert.match(r.raison, /inconnu/);
});

// Un client attache dont le script n'a pas fini de charger n'a pas encore de
// post: le dire plutot que de lever dans un gestionnaire de raccourci global.
test('basculerVers refuse un client sans agent en place', () => {
  const s = superviseurAvecComptes([1]);
  s.clients.set(1, { pid: 1, amont: null, script: null });
  const r = s.basculerVers(1);
  assert.strictEqual(r.ok, false);
  assert.match(r.raison, /agent/);
});

// Une exception de Frida ne doit pas remonter jusqu'au raccourci: elle se rend
// comme un refus ordinaire.
test('un post qui lève se rend comme un refus', () => {
  const s = superviseurAvecComptes([1]);
  s.clients.set(1, { pid: 1, amont: null, script: { post: () => { throw new Error('script detruit'); } } });
  const r = s.basculerVers(1);
  assert.strictEqual(r.ok, false);
  assert.match(r.raison, /script detruit/);
});

// `enAvant` n'a plus aucun lecteur, mais il est ecrit des la construction. Il
// ne decerne PAS le role de maitre: celui-la est epingle, et le focus ne le
// decide plus.
test('le superviseur ne connaît aucun premier plan au départ', () => {
  assert.strictEqual(new Superviseur().enAvant, null);
});

// --- les boutons de souris ------------------------------------------------

function clientFactice(pid) {
  const postes = [];
  return {
    pid,
    postes,
    script: { post: (m) => postes.push(m) },
  };
}

test('un appui remonte par onSouris avec le pid', () => {
  const vus = [];
  const s = new Superviseur({ onSouris: (e) => vus.push(e) });
  s._recevoirMessageAgent(7, { souris: { button: 3, ctrlKey: true, altKey: false, shiftKey: false } }, 8300);
  assert.strictEqual(vus.length, 1);
  assert.strictEqual(vus[0].pid, 7);
  assert.deepStrictEqual(vus[0].clic, { button: 3, ctrlKey: true, altKey: false, shiftKey: false });
});

test('reglerSouris poste a tous les clients attaches', () => {
  const s = new Superviseur();
  const a = clientFactice(1);
  const b = clientFactice(2);
  s.clients.set(1, a);
  s.clients.set(2, b);
  s.reglerSouris(true);
  assert.deepStrictEqual(a.postes, [{ type: 'souris', actif: true }]);
  assert.deepStrictEqual(b.postes, [{ type: 'souris', actif: true }]);
  s.reglerSouris(false);
  assert.deepStrictEqual(a.postes[1], { type: 'souris', actif: false });
});

// La boucle ne doit tourner que si un bouton est assigne, et l'etat est
// decide AVANT qu'un client s'attache aussi bien qu'apres.
test('l etat de la souris est retenu pour les clients suivants', () => {
  const s = new Superviseur();
  assert.strictEqual(s.sourisActive, false);
  s.reglerSouris(true);
  assert.strictEqual(s.sourisActive, true);
});

// Un client sans agent charge ne doit pas faire lever reglerSouris, ni etre
// journalise comme une erreur: il y en a toujours un en cours d'attache quand
// l'utilisateur change un raccourci, et c'est un etat parfaitement normal.
test('un client sans script ne fait pas lever reglerSouris, ni journaliser', () => {
  const lignes = [];
  const s = new Superviseur({ onJournal: (pid, texte) => lignes.push({ pid, texte }) });
  const avecScript = { pid: 1, script: { post: () => {} } };
  s.clients.set(1, avecScript);
  s.clients.set(2, { pid: 2, script: null });
  assert.doesNotThrow(() => s.reglerSouris(true));
  assert.deepStrictEqual(lignes, [], 'un client sans script ne doit produire aucune ligne de journal');
});

// --- le rappel de changement de fenetre -------------------------------------
//
// L'overlay encadre le picto de la fenetre devant laquelle on est. Sans ce
// rappel il n'apprenait le changement qu'au tick d'etat suivant: jusqu'a deux
// secondes de retard, et l'air de ne pas s'actualiser du tout quand on
// enchaine les bascules plus vite que ca.

// `planifier` capture au lieu d'attendre: l'effacement differe se teste sans
// dormir 400 ms, et on choisit le moment ou il tombe.
function superviseurQuiNote(pids) {
  const vus = [];
  const differes = [];
  const s = new Superviseur({
    onEnAvant: (pid) => vus.push(pid),
    planifier: (fn) => { differes.push(fn); return null; },
  });
  for (const pid of pids) s.comptes.ajouter({ pid, port: 8300 + pid });
  return { s, vus, differes, echeance: () => { for (const f of differes.splice(0)) f(); } };
}

test('un changement de fenêtre prévient tout de suite', () => {
  const { s, vus } = superviseurQuiNote([1, 2]);
  s._recevoirMessageAgent(1, { premierPlan: true });
  assert.deepStrictEqual(vus, [1]);
});

// Les agents ne parlent que sur changement, mais rien n'empeche un doublon.
// Redessiner l'overlay pour une valeur identique est du travail pour rien.
test('deux fois la même fenêtre ne prévient qu une fois', () => {
  const { s, vus } = superviseurQuiNote([1, 2]);
  s._recevoirMessageAgent(1, { premierPlan: true });
  s._recevoirMessageAgent(1, { premierPlan: true });
  assert.deepStrictEqual(vus, [1]);
});

// L'EFFACEMENT EST DIFFERE. Les agents sondent chacun de leur cote toutes les
// 250 ms: en passant de 1 a 2, le depart de 1 arrive jusqu'a un tour de
// sondage avant l'arrivee de 2. Effacer tout de suite afficherait « personne
// n'est devant » a chaque bascule.
test('quitter une fenêtre n efface pas tout de suite', () => {
  const { s, vus } = superviseurQuiNote([1, 2]);
  s._recevoirMessageAgent(1, { premierPlan: true });
  s._recevoirMessageAgent(1, { premierPlan: false });
  assert.strictEqual(s.enAvant, 1, 'rien ne doit bouger avant l échéance');
  assert.deepStrictEqual(vus, [1]);
});

test('sans personne d autre, l échéance efface bien', () => {
  const { s, vus, echeance } = superviseurQuiNote([1, 2]);
  s._recevoirMessageAgent(1, { premierPlan: true });
  s._recevoirMessageAgent(1, { premierPlan: false });
  echeance();
  assert.strictEqual(s.enAvant, null);
  assert.deepStrictEqual(vus, [1, null]);
});

// LE CROISEMENT, et c'est le cas qui eteignait l'encadre. En passant de 1 a 2,
// le « je pars » de 1 arrive avant ou apres le « j'arrive » de 2, sans ordre
// garanti. Dans les deux sens, l'encadre doit finir sur 2.
test('une arrivée avant l échéance annule l effacement', () => {
  const { s, vus, echeance } = superviseurQuiNote([1, 2]);
  s._recevoirMessageAgent(1, { premierPlan: true });
  s._recevoirMessageAgent(1, { premierPlan: false });
  s._recevoirMessageAgent(2, { premierPlan: true });
  echeance();
  assert.strictEqual(s.enAvant, 2, 'la fenêtre arrivée depuis doit rester');
  assert.deepStrictEqual(vus, [1, 2], 'aucun passage par « personne »');
});

test('le départ d une fenêtre déjà remplacée n efface rien', () => {
  const { s, vus, echeance } = superviseurQuiNote([1, 2]);
  s._recevoirMessageAgent(1, { premierPlan: true });
  s._recevoirMessageAgent(2, { premierPlan: true });
  s._recevoirMessageAgent(1, { premierPlan: false });
  echeance();
  assert.strictEqual(s.enAvant, 2, 'la fenêtre courante doit rester');
  assert.deepStrictEqual(vus, [1, 2]);
});

// Une bascule confirmee APRES coup doit aussi annuler l'effacement en attente:
// c'est le cas de la reponse differee de l'agent, qui met 150 ms a arriver.
test('une bascule confirmée tardivement annule l effacement', () => {
  const { s, vus, echeance } = superviseurQuiNote([1, 2]);
  s._recevoirMessageAgent(1, { premierPlan: true });
  s._recevoirMessageAgent(1, { premierPlan: false });
  s._recevoirMessageAgent(2, { premierPlanFait: true });
  echeance();
  assert.strictEqual(s.enAvant, 2);
  assert.deepStrictEqual(vus, [1, 2]);
});

// La bascule demandee par OMNI passe par premierPlanFait, pas par premierPlan.
test('une bascule confirmée prévient aussi', () => {
  const { s, vus } = superviseurQuiNote([1, 2]);
  s._recevoirMessageAgent(2, { premierPlanFait: true });
  assert.strictEqual(s.enAvant, 2);
  assert.deepStrictEqual(vus, [2]);
});

test('une bascule sans effet ne prévient personne', () => {
  const { s, vus } = superviseurQuiNote([1, 2]);
  s._recevoirMessageAgent(2, { premierPlanFait: false });
  assert.deepStrictEqual(vus, []);
  assert.strictEqual(s.enAvant, null);
});

// Un rappel qui leve ne doit pas emporter le suivi: c'est un affichage.
test('un rappel qui lève ne casse pas le suivi', () => {
  const s = new Superviseur({ onEnAvant: () => { throw new Error('boum'); } });
  s.comptes.ajouter({ pid: 1, port: 8301 });
  assert.doesNotThrow(() => s._recevoirMessageAgent(1, { premierPlan: true }));
  assert.strictEqual(s.enAvant, 1);
});
