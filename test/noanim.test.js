'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  traduire, construirePose, casesDuChemin, ACTION_POSE,
} = require('../src/noanim');
const { decodeFrameRaw } = require('../src/codec/rawProto');

// Mesures du 2026-08-21. Chaque jsj porte un chemin, chaque pose est celle que
// le proxy de krm35 fabrique juste avant lui.
const JSJ_3_CASES = Buffer.from(
  '0a2e0a2c0a13747970652e616e6b616d612e636f6d2f6a736a12150a06f302e402d602100528ffffffffffffffffff01', 'hex');
const POSE_3_CASES = Buffer.from(
  '0a370a350a13747970652e616e6b616d612e636f6d2f6a7765121e18ffffffffffffffffff0170049a020e08d60210ffffffffffffffffff01', 'hex');

const JSJ_4_CASES = Buffer.from(
  '0a300a2e0a13747970652e616e6b616d612e636f6d2f6a736a12170a08f30181028e029c02100328fcffffffffffffffff01', 'hex');
const POSE_4_CASES = Buffer.from(
  '0a370a350a13747970652e616e6b616d612e636f6d2f6a7765121e18fcffffffffffffffff0170049a020e089c0210fcffffffffffffffff01', 'hex');

test('les cases du chemin se lisent en varints empaquetes', () => {
  // Le chemin mesure du jsj a 4 cases: 243 -> 257 -> 270 -> 284.
  assert.deepStrictEqual(
    casesDuChemin(Buffer.from('f30181028e029c02', 'hex')),
    [243n, 257n, 270n, 284n]);
});

test('un chemin vide ne rend aucune case', () => {
  assert.deepStrictEqual(casesDuChemin(Buffer.alloc(0)), []);
});

test('la pose construite est celle mesuree, octet pour octet', () => {
  assert.strictEqual(construirePose(342n, -1n).toString('hex'), POSE_3_CASES.toString('hex'));
  assert.strictEqual(construirePose(284n, -4n).toString('hex'), POSE_4_CASES.toString('hex'));
});

test('un deplacement rend la pose PUIS la trame d origine intacte', () => {
  const r = traduire(JSJ_4_CASES);
  assert.strictEqual(r.octets.length, 2);
  assert.strictEqual(r.octets[0].toString('hex'), POSE_4_CASES.toString('hex'));
  // La trame d'origine est relayee SANS modification: le client doit la
  // recevoir telle que le serveur l'a envoyee.
  assert.strictEqual(r.octets[1].toString('hex'), JSJ_4_CASES.toString('hex'));
  assert.strictEqual(r.raison, null);
});

test('la pose porte la DERNIERE case du chemin, pas la premiere', () => {
  const r = traduire(JSJ_3_CASES);
  const d = decodeFrameRaw(r.octets[0]);
  assert.strictEqual(d.type, 'jwe');
  assert.strictEqual(d.payload.find((f) => f.no === 14).value, ACTION_POSE);
  const oneof = d.payload.find((f) => f.no === 35);
  // Chemin 371 -> 356 -> 342: c'est 342 qu'il faut, 371 serait le depart.
  assert.strictEqual(oneof.value.find((f) => f.no === 1).value, 342n);
  assert.strictEqual(oneof.value.find((f) => f.no === 2).value, -1n);
});

test('l acteur de la pose est celui du deplacement', () => {
  const d = decodeFrameRaw(traduire(JSJ_4_CASES).octets[0]);
  assert.strictEqual(d.payload.find((f) => f.no === 3).value, -4n);
});

// GARANTIE 2, cas par cas. Chacun rend une liste vide.
test('une trame indecodable est relayee telle quelle', () => {
  const r = traduire(Buffer.from('00ff00ff', 'hex'));
  assert.deepStrictEqual(r.octets, []);
  assert.match(r.raison, /indecodable/);
});

test('un autre type que jsj est relaye tel quel, sans bruit', () => {
  const jxz = Buffer.from('0a1d0a1b0a13747970652e616e6b616d612e636f6d2f6a787a120408011803', 'hex');
  const r = traduire(jxz);
  assert.deepStrictEqual(r.octets, []);
  assert.strictEqual(r.raison, null);
});

test('un jsj sans chemin est relaye tel quel', () => {
  // Le meme jsj, prive de son champ 1.
  const sansChemin = Buffer.from(
    '0a260a240a13747970652e616e6b616d612e636f6d2f6a736a120d100328fcffffffffffffffff01', 'hex');
  const r = traduire(sansChemin);
  assert.deepStrictEqual(r.octets, []);
  assert.match(r.raison, /chemin/);
});

test('un jsj sans acteur est relaye tel quel', () => {
  // Le meme jsj, prive de son champ 5.
  const sansActeur = Buffer.from(
    '0a1f0a1d0a13747970652e616e6b616d612e636f6d2f6a736a12060a04f3018102', 'hex');
  const r = traduire(sansActeur);
  assert.deepStrictEqual(r.octets, []);
  assert.match(r.raison, /acteur/);
});

test('traduire ne leve jamais, quoi qu on lui donne', () => {
  for (const mauvais of [Buffer.alloc(0), Buffer.from('ff', 'hex'), Buffer.alloc(64, 0xff)]) {
    assert.doesNotThrow(() => traduire(mauvais));
  }
});
