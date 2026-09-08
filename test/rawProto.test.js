'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decodeRaw, decodeFrameRaw, encodeRaw, remplacerChamp, render } = require('../src/codec/rawProto');

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');

test('lit un varint simple', () => {
  assert.deepStrictEqual(decodeRaw(hex('08 96 01')), [{ no: 1, wire: 0, value: 150n }]);
});

// uid = -1 est encode sur dix octets tous bits a 1. Sans conversion signee il
// se lirait 18446744073709551615, ce qui masquerait completement sa nature.
test('rend un varint négatif comme tel', () => {
  const out = decodeRaw(hex('10 ff ff ff ff ff ff ff ff ff 01'));
  assert.strictEqual(out[0].value, -1n);
});

test('reconnaît une chaîne imprimable', () => {
  const out = decodeRaw(Buffer.concat([hex('0a 13'), Buffer.from('type.ankama.com/jsj')]));
  assert.strictEqual(out[0].kind, 'string');
  assert.strictEqual(out[0].value, 'type.ankama.com/jsj');
});

test('descend dans un sous-message', () => {
  const out = decodeRaw(hex('12 03 08 96 01'));
  assert.strictEqual(out[0].kind, 'message');
  assert.strictEqual(out[0].value[0].value, 150n);
});

test('rend null sur des octets qui ne sont pas du protobuf', () => {
  assert.strictEqual(decodeRaw(hex('ff ff ff')), null);
});

// Trame reelle, relevee le 19/08 sur la socket 0x604 du proxy de l'esclave:
// c'est l'une des quatre que le proxy de krm35 a injectees.
const HJC_INJECTE = hex(
  '12 2b 0a 1e 0a 13 74 79 70 65 2e 61 6e 6b 61 6d 61 2e 63 6f 6d 2f 68 6a 63' +
  '12 07 08 03 18 82 90 90 5b 10 ff ff ff ff ff ff ff ff ff 01',
);

// `kind` vaut 'event': cette trame d'aout est en kind 2, que le patch
// 3.6.11.12 a reaffecte aux events. L'etiquette suit le protocole COURANT, pas
// celui de l'archive — ce qui compte ici, type/uid/payload, est intact.
test('décode une trame réelle du jeu', () => {
  const f = decodeFrameRaw(HJC_INJECTE);
  assert.notStrictEqual(f, null);
  assert.strictEqual(f.kind, 'event');
  assert.strictEqual(f.type, 'hjc');
  assert.strictEqual(f.uid, -1n);
});

test('le contenu du Any est décodé en champs', () => {
  const f = decodeFrameRaw(HJC_INJECTE);
  const nums = f.payload.map((x) => [x.no, x.value]);
  assert.deepStrictEqual(nums, [[1, 3n], [3, 191105026n]]);
});

// Echantillon avec verite terrain: le launcher de krm35 diffuse sur son
// WebSocket de coordination la trame brute ET sa version decodee. On peut donc
// verifier notre decodeur contre des valeurs etiquetees, ce qu'aucune capture
// precedente ne permettait.
//
//   realType : NpcGenericActionRequest
//   payload  : { npcActionId: 3, npcMapId: "192937992", npcId: -20000 }
const IOV = hex(
  '38 12 36 0a 29 0a 13 74 79 70 65 2e 61 6e 6b 61 6d 61 2e 63 6f 6d 2f 69 6f 76' +
  '12 12 08 03 10 88 80 80 5c 18 e0 e3 fe ff ff ff ff ff ff 01' +
  '10 ff ff ff ff ff ff ff ff ff 01',
).subarray(1);   // on retire le prefixe varint de longueur, deja consomme par le reassembleur

test('le décodeur retrouve les valeurs que le launcher publie', () => {
  const f = decodeFrameRaw(IOV);
  assert.notStrictEqual(f, null);
  assert.strictEqual(f.kind, 'event');   // archive d'aout, voir plus haut
  assert.strictEqual(f.type, 'iov');
  assert.strictEqual(f.uid, -1n);

  const by = Object.fromEntries(f.payload.map((x) => [x.no, x.value]));
  assert.strictEqual(by[1], 3n, 'npcActionId');
  assert.strictEqual(by[2], 192937992n, 'npcMapId');
  assert.strictEqual(by[3], -20000n, 'npcId — un varint négatif sur dix octets');
});

// MESURE DU 08/09, patch Dofus 3.6.11.12. L'enveloppe a bouge, et c'est ce qui
// a éteint OMNI en silence: sur les 255 trames non décodées de la session HDV,
// 244 portent leur Any en CHAMP 3 et non plus en champ 1. Le sens entrant est
// aussi passé du kind 1 au kind 2, et le sortant du 2 au 1 — voir requete().
//
// Le décodeur ne cherchait le Any qu'au champ 1: il rendait null, et le métier
// entier (HDV, PDA, passe-tour) ne voyait plus rien passer. Le silence, encore.
//
// Structure relevée sur les 244 trames; le nom 'kra' est un event réel du 02/09.
const EVENT_3_6_11 = hex(
  '12 17 1a 15 0a 13 74 79 70 65 2e 61 6e 6b 61 6d 61 2e 63 6f 6d 2f 6b 72 61',
);

test('décode un event du patch 3.6.11.12, dont le Any est en champ 3', () => {
  const f = decodeFrameRaw(EVENT_3_6_11);
  assert.notStrictEqual(f, null, 'la trame doit être décodée');
  assert.strictEqual(f.type, 'kra');
});

test('rend null sur une trame sans enveloppe reconnaissable', () => {
  assert.strictEqual(decodeFrameRaw(hex('08 01')), null);
});

// Le rejeu reconstruit la trame au lieu de la retoucher: changer un entier
// change sa longueur en varint, donc celle de tous les messages qui
// l'englobent. L'aller-retour doit donc etre exact a l'octet pres.
test('décoder puis réencoder rend les octets d origine', () => {
  for (const [nom, trame] of [['hjc', HJC_INJECTE], ['iov', IOV]]) {
    const refait = encodeRaw(decodeRaw(trame, 6));
    assert.deepStrictEqual(refait, trame, `aller-retour ${nom}`);
  }
});

test('l aller-retour préserve un varint négatif', () => {
  const trame = hex('10 ff ff ff ff ff ff ff ff ff 01');
  assert.deepStrictEqual(encodeRaw(decodeRaw(trame)), trame);
});

// Substitution reellement mesuree le 19/08: la trame jbn injectee chez
// l'esclave portait 677057659174 la ou le maitre valait 665809125670 — soit
// l'identifiant de personnage de chacun.
test('remplacerChamp substitue l identifiant sans toucher au reste', () => {
  const maitre = 665809125670n;
  const esclave = 677057659174n;

  const varint = (v) => {
    const out = []; let x = v;
    do { let b = Number(x & 0x7fn); x >>= 7n; if (x > 0n) b |= 0x80; out.push(b); } while (x > 0n);
    return Buffer.from(out);
  };
  const construire = (id) => {
    const champ = Buffer.concat([Buffer.from([0x10]), varint(id)]);     // champ 2
    const url = Buffer.from('type.ankama.com/jbn');
    const any = Buffer.concat([
      Buffer.from([0x0a, url.length]), url,
      Buffer.from([0x12, champ.length]), champ,
    ]);
    const boite = Buffer.concat([Buffer.from([0x0a, any.length]), any]);
    return Buffer.concat([Buffer.from([0x12, boite.length]), boite]);
  };

  const refait = remplacerChamp(construire(maitre), 2, esclave);
  assert.deepStrictEqual(refait, construire(esclave));

  const relu = decodeFrameRaw(refait);
  assert.strictEqual(relu.type, 'jbn');
  assert.strictEqual(relu.payload.find((f) => f.no === 2).value, esclave);
});

test('remplacerChamp rend null si le champ visé est absent', () => {
  assert.strictEqual(remplacerChamp(HJC_INJECTE, 9, 1n), null);
});

test('render produit un texte lisible', () => {
  const txt = render(decodeRaw(hex('12 03 08 96 01')));
  assert.match(txt, /2 \{/, 'le tag 0x12 est le champ 2, pas le champ 1');
  assert.match(txt, /1 = 150/);
});
