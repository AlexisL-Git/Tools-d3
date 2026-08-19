'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { EtatCompte, Comptes } = require('../src/protocol/compte');
const { decodeFrameRaw } = require('../src/codec/rawProto');

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');

// Trame reelle relevee le 19/08 a travers notre propre proxy, au moment de
// l'entree en jeu: request kvw { 1 = 665809125670 }.
function trameKvw(id) {
  const varint = (v) => {
    const out = [];
    let x = BigInt(v);
    do { let b = Number(x & 0x7fn); x >>= 7n; if (x > 0n) b |= 0x80; out.push(b); } while (x > 0n);
    return Buffer.from(out);
  };
  const champ = Buffer.concat([Buffer.from([0x08]), varint(id)]);            // 1 = id
  const url = Buffer.from('type.ankama.com/kvw');
  const any = Buffer.concat([
    Buffer.from([0x0a, url.length]), url,
    Buffer.from([0x12, champ.length]), champ,
  ]);
  const box = Buffer.concat([Buffer.from([0x0a, any.length]), any]);         // content = 1
  return Buffer.concat([Buffer.from([0x12, box.length]), box]);              // request = 2
}

test('le compte apprend son identifiant de personnage depuis kvw', () => {
  const e = new EtatCompte({ pid: 42 });
  assert.strictEqual(e.pret, false);
  e.observer(decodeFrameRaw(trameKvw(665809125670n)));
  assert.strictEqual(e.characterId, 665809125670n);
  assert.strictEqual(e.pret, true);
});

test('les autres messages ne modifient pas l identifiant', () => {
  const e = new EtatCompte({ pid: 42 });
  e.observer(decodeFrameRaw(trameKvw(1234n)));
  e.observer(decodeFrameRaw(hex('12 2b 0a 1e 0a 13 74 79 70 65 2e 61 6e 6b 61 6d 61 2e 63 6f 6d 2f 68 6a 63 12 07 08 03 18 82 90 90 5b 10 ff ff ff ff ff ff ff ff ff 01')));
  assert.strictEqual(e.characterId, 1234n);
  assert.strictEqual(e.trames, 2);
});

test('une trame illisible est ignorée sans casser l état', () => {
  const e = new EtatCompte({ pid: 1 });
  e.observer(null);
  assert.strictEqual(e.trames, 0);
  assert.strictEqual(e.characterId, null);
});

// Emettre une trame a moitie traduite serait pire que ne rien emettre: le
// serveur agirait au nom du bon compte sur l'objet d'un autre.
test('le rejeu annonce ce qui lui manque', () => {
  const e = new EtatCompte({ pid: 1 });

  assert.deepStrictEqual(e.peutRejouer('hjc'), { possible: true, manque: [] });
  assert.deepStrictEqual(e.peutRejouer('kla'), { possible: true, manque: [] });

  assert.deepStrictEqual(e.peutRejouer('jbn'), { possible: false, manque: ['characterId'] });
  e.observer(decodeFrameRaw(trameKvw(7n)));
  assert.deepStrictEqual(e.peutRejouer('jbn'), { possible: true, manque: [] });

  // skillInstanceUid n'est pas encore apprenable: le message entrant qui le
  // porte n'a pas ete identifie.
  assert.deepStrictEqual(e.peutRejouer('iwo'), { possible: false, manque: ['skillInstanceUid'] });
});

test('huit comptes cohabitent et le maître est exclu des esclaves', () => {
  const c = new Comptes();
  for (let i = 0; i < 8; i++) c.ajouter({ pid: 1000 + i, port: 8300 + i });
  assert.strictEqual(c.tous.length, 8);
  assert.strictEqual(c.get(1003).port, 8303);

  const esclaves = c.esclaves(1003);
  assert.strictEqual(esclaves.length, 7);
  assert.ok(!esclaves.some((e) => e.pid === 1003));
});

test('chaque compte garde son propre identifiant', () => {
  const c = new Comptes();
  const a = c.ajouter({ pid: 1, port: 8301 });
  const b = c.ajouter({ pid: 2, port: 8302 });
  a.observer(decodeFrameRaw(trameKvw(111n)));
  b.observer(decodeFrameRaw(trameKvw(222n)));
  assert.strictEqual(c.get(1).characterId, 111n);
  assert.strictEqual(c.get(2).characterId, 222n);
});
