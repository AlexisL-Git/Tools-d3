'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerTransformateurFlux } = require('../src/noanim-flux');
const { writeVarint } = require('../src/codec/framing');
const { encodeRaw, WIRE } = require('../src/codec/rawProto');

// Un deplacement reel: acteur -4, chemin 243 -> 257 -> 270 -> 284.
const JSJ = Buffer.from(
  '0a300a2e0a13747970652e616e6b616d612e636f6d2f6a736a12170a08f30181028e029c02100328fcffffffffffffffff01', 'hex');

// Une trame d'un autre type, qui ne doit jamais etre touchee. Construite
// plutot que copiee: une trame tronquee a la main ne se decode pas, et le
// test porterait alors sur « indecodable » au lieu de « autre type ».
const AUTRE = encodeRaw([
  { no: 1, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'string', value: 'type.ankama.com/jxz' },
      { no: 2, wire: WIRE.LEN, kind: 'message', value: [
        { no: 2, wire: WIRE.VARINT, value: 3n },
      ] },
    ] },
  ] },
]);

// Le reassembleur retire le prefixe de longueur: sur le fil, chaque trame le
// porte.
const surLeFil = (...trames) => Buffer.concat(trames.flatMap((t) => [writeVarint(t.length), t]));

function flux(actif = true) {
  const reglages = { actif };
  const rendu = [];
  const f = creerTransformateurFlux({ reglages, onCompteRendu: (r) => rendu.push(r) });
  return { f, reglages, rendu, conn: { id: 1, port: 5555 } };
}

// GARANTIE 1: eteint, le transformateur ne touche a rien et ne retient rien.
test('eteint, il rend null sans meme regarder les octets', () => {
  const { f, conn } = flux(false);
  assert.strictEqual(f(surLeFil(JSJ), conn), null);
});

test('rallume en cours de route, il repart d un flux propre', () => {
  const { f, reglages, conn } = flux(false);
  assert.strictEqual(f(surLeFil(AUTRE), conn), null);
  reglages.actif = true;
  const sortie = f(surLeFil(AUTRE), conn);
  assert.strictEqual(sortie.toString('hex'), surLeFil(AUTRE).toString('hex'));
});

test('une trame sans rapport ressort identique', () => {
  const { f, conn } = flux();
  assert.strictEqual(f(surLeFil(AUTRE), conn).toString('hex'), surLeFil(AUTRE).toString('hex'));
});

// Le coeur de la fonction: la pose est ajoutee DEVANT, le deplacement suit
// intact. Le flux sortant est donc plus long que l'entrant, jamais plus court.
test('un deplacement ressort precede de sa pose, et la trame d origine est intacte', () => {
  const { f, conn } = flux();
  const sortie = f(surLeFil(JSJ), conn);
  assert.ok(sortie.length > surLeFil(JSJ).length);
  assert.ok(sortie.toString('hex').endsWith(JSJ.toString('hex')));
  // Deux trames sur le fil: la pose puis le deplacement.
  assert.ok(sortie.toString('hex').includes('9a020e089c0210fcffffffffffffffff01'));
});

// Le cas qui casse tout si on le rate: TCP ne respecte pas les frontieres de
// trames.
test('une trame coupee en deux chunks est reconstituee', () => {
  const { f, conn } = flux();
  const fil = surLeFil(AUTRE);
  const a = f(fil.subarray(0, 5), conn);
  const b = f(fil.subarray(5), conn);
  const total = Buffer.concat([a === null ? Buffer.alloc(0) : a, b === null ? Buffer.alloc(0) : b]);
  assert.strictEqual(total.toString('hex'), fil.toString('hex'));
});

test('deux trames dans un seul chunk ressortent toutes les deux', () => {
  const { f, conn } = flux();
  const sortie = f(surLeFil(AUTRE, AUTRE), conn);
  assert.strictEqual(sortie.toString('hex'), surLeFil(AUTRE, AUTRE).toString('hex'));
});

test('un deplacement au milieu de deux trames ordinaires ne perd rien', () => {
  const { f, conn } = flux();
  const sortie = f(surLeFil(AUTRE, JSJ, AUTRE), conn).toString('hex');
  assert.ok(sortie.startsWith(surLeFil(AUTRE).toString('hex')));
  assert.ok(sortie.endsWith(surLeFil(AUTRE).toString('hex')));
  assert.ok(sortie.includes(JSJ.toString('hex')));
});

// GARANTIE 2: un cadrage qui part en vrille ne doit pas couper la partie.
test('un cadrage impossible fait passer le transformateur en inerte definitif', () => {
  const { f, rendu, conn } = flux();
  // Une longueur annoncee gigantesque: le reassembleur refuse.
  const poison = Buffer.concat([writeVarint(9 * 1024 * 1024), Buffer.alloc(8)]);
  const sortie = f(poison, conn);
  assert.strictEqual(sortie.toString('hex'), poison.toString('hex'));
  assert.match(rendu[0].raison, /cadrage/);
  // Et tout ce qui suit passe sans etre touche, meme un deplacement.
  assert.strictEqual(f(surLeFil(JSJ), conn), null);
});

test('deux connexions ne partagent pas leur reassembleur', () => {
  const { f } = flux();
  const a = { id: 1, port: 5555 };
  const b = { id: 2, port: 5555 };
  const fil = surLeFil(AUTRE);
  f(fil.subarray(0, 5), a);
  const sortieB = f(fil, b);
  assert.strictEqual(sortieB.toString('hex'), fil.toString('hex'));
});

test('un chunk sans trame complete ne rend aucun octet, sans rien perdre', () => {
  const { f, conn } = flux();
  const fil = surLeFil(AUTRE);
  const a = f(fil.subarray(0, 3), conn);
  assert.strictEqual(a.length, 0);
  const b = f(fil.subarray(3), conn);
  assert.strictEqual(Buffer.concat([a, b]).toString('hex'), fil.toString('hex'));
});
