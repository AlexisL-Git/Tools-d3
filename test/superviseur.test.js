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
