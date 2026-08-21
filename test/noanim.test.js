'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  traduire, construirePose, casesDuChemin, ACTION_POSE,
} = require('../src/noanim');
const { decodeFrameRaw, encodeRaw, WIRE } = require('../src/codec/rawProto');

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

// IMPORTANT 4 de revue finale. decodeRaw devine le kind d'un champ LEN sans
// schema: 'string' si plus de 3 octets imprimables, 'message' si les octets
// se relisent comme un sous-message plausible, 'bytes' sinon. Un chemin en
// varints empaquetes tombe regulierement dans les trois: mesure a 3 jsj reels
// sur 40 dans la capture du projet, 11% sur des chemins simules. traduire()
// doit accepter les trois formes en lisant `raw`, pas `value`.
function packVarint(v) {
  let x = typeof v === 'bigint' ? v : BigInt(v);
  const out = [];
  do { let b = Number(x & 0x7fn); x >>= 7n; if (x > 0n) b |= 0x80; out.push(b); } while (x > 0n);
  return out;
}
function packChemin(cases) {
  return Buffer.from(cases.flatMap(packVarint));
}
function faireJsj(cheminBuf, acteur) {
  return encodeRaw([
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: 'type.ankama.com/jsj' },
        { no: 2, wire: WIRE.LEN, kind: 'message', value: [
          { no: 1, wire: WIRE.LEN, kind: 'bytes', value: cheminBuf },
          { no: 2, wire: WIRE.VARINT, value: 5n },
          { no: 5, wire: WIRE.VARINT, value: acteur },
        ] },
      ] },
    ] },
  ]);
}

// Verite terrain: les mesures de decodeRaw pour ces trois jeux de cases,
// prises telles quelles avant d ecrire le test (pas ajustees pour coller a
// une attente).
const FORMES = [
  { nom: 'string', cases: [100n, 87n, 74n, 61n] },   // l exemple des findings: "dWJ="
  { nom: 'message', cases: [1000n, 999n] },
  { nom: 'bytes', cases: [300n, 300n] },
];

for (const { nom, cases } of FORMES) {
  test(`un chemin dont decodeRaw devine le kind '${nom}' est quand meme traduit`, () => {
    const cheminBuf = packChemin(cases);
    // Verifie que le montage du test correspond bien a la forme visee, sinon
    // le test ne prouverait rien.
    const { decodeRaw } = require('../src/codec/rawProto');
    const enveloppe = decodeRaw(Buffer.concat([Buffer.from([0x0a, cheminBuf.length]), cheminBuf]));
    assert.strictEqual(enveloppe[0].kind, nom, `precondition: ce chemin doit deviner '${nom}'`);

    const jsj = faireJsj(cheminBuf, -4n);
    const r = traduire(jsj);
    assert.strictEqual(r.raison, null);
    assert.strictEqual(r.octets.length, 2);
    const pose = decodeFrameRaw(r.octets[0]);
    const oneof = pose.payload.find((f) => f.no === 35);
    assert.strictEqual(oneof.value.find((f) => f.no === 1).value, cases[cases.length - 1], 'la pose doit porter la derniere case');
  });
}

// Cousin direct, corrige dans le meme geste puisque l extraction du chemin
// est reprise: un varint pathologique (plus de 10 octets de continuation)
// doit faire refuser le chemin entier, pas rendre les cases deja lues --
// sinon la pose se retrouve sur une case intermediaire du chemin.
test('un varint pathologique dans le chemin refuse franchement (cousin de IMPORTANT 4)', () => {
  const pathologique = Buffer.concat([
    Buffer.from([0x9d, 0x02]),                        // une case normale, lue avec succes
    Buffer.alloc(11, 0x80),                            // 11 octets de continuation: jamais termine
  ]);
  assert.strictEqual(casesDuChemin(pathologique), null);

  const jsj = faireJsj(pathologique, -1n);
  const r = traduire(jsj);
  assert.deepStrictEqual(r.octets, []);
  assert.match(r.raison, /illisible/);
});
