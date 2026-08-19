'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { Superviseur } = require('../src/superviseur');
const { createProxy } = require('../src/proxy/server');

// Les sept types dont l'utilisateur a besoin — zaap, havre-sac, PNJ, quetes,
// dialogue, donjon, et le deplacement associe. InteractiveUseRequest, seul
// message exigeant une substitution de skillInstanceUid, est celui de la
// recolte de metier, hors perimetre.
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

test('la récolte reste hors de portée tant que skillInstanceUid manque', () => {
  const s = superviseurAvecComptes([1, 2]);
  s.comptes.get(2).characterId = 1n;
  assert.deepStrictEqual(s.planRejeu('iwo', 1), [
    { pid: 2, action: 'ignorer', raison: 'manque skillInstanceUid' },
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
