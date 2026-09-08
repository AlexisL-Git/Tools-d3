'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decodeRaw } = require('../src/codec/rawProto');
const { empreinte } = require('../src/dev/appariement');

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');

// L'appariement structurel repose entierement sur cette propriete: apres un
// patch les NOMS changent, la STRUCTURE reste. Une empreinte qui regarderait
// les valeurs apparierait au hasard.
test('l empreinte ignore les valeurs et ne retient que la structure', () => {
  const kep = decodeRaw(hex('08 01 10 01'));
  const memeForme = decodeRaw(hex('08 63 10 07'));
  assert.strictEqual(empreinte(kep), empreinte(memeForme));
});

test('l empreinte distingue deux structures differentes', () => {
  const deuxVarints = decodeRaw(hex('08 01 10 01'));
  const unVarint = decodeRaw(hex('08 2a'));
  assert.notStrictEqual(empreinte(deuxVarints), empreinte(unVarint));
});

// ijz porte ses champs en 2 et 5: c'est le numero qui identifie, pas le rang.
test('l empreinte retient le numero du champ, pas son rang', () => {
  const champs14 = decodeRaw(hex('08 01 20 01'));
  const champs12 = decodeRaw(hex('08 01 10 01'));
  assert.notStrictEqual(empreinte(champs14), empreinte(champs12));
});

test('un payload vide a une empreinte propre', () => {
  assert.strictEqual(empreinte([]), '(vide)');
  assert.strictEqual(empreinte(null), '(vide)');
});

// Extrait REEL de journal-hdv.log, session du 08/09. Le parseur doit tenir le
// format tel qu'il est ecrit, offsets decimaux et continuation compris.
const CAPTURE = [
  '  14472ms [27780] cap : --> event koa { 1=0a66dbee5c3a437f8130be69cfd9d85a 2=<2o> }',
  '  14472ms [27780]         0000  0a4a0a3d0a13747970652e616e6b616d612e636f6d2f6b6f6112260a20306136',
  '  14473ms [27780]         0032  3664626565356333613433376638313330626536396366643964383561120266',
  '  14473ms [27780]         0064  7210ffffffffffffffffff01',
].join('\n');

test('lit une capture reelle et en rend le nom, le sens et l instant', () => {
  const { lireCaptures } = require('../src/dev/appariement');
  const [t] = lireCaptures(CAPTURE);
  assert.strictEqual(t.nom, 'koa');
  assert.strictEqual(t.sens, 'sortant');
  assert.strictEqual(t.ms, 14472);
});

test('la capture lue porte l empreinte de son payload', () => {
  const { lireCaptures } = require('../src/dev/appariement');
  const [t] = lireCaptures(CAPTURE);
  assert.strictEqual(t.empreinte, '1:len,2:len');
});

// decodeRaw classe un champ de longueur en `string` ou `bytes` selon que son
// CONTENU est imprimable. C'est une heuristique de lecture, pas une propriete
// du message: un meme champ « nom du joueur » tombe d'un cote ou de l'autre
// selon le joueur. Une empreinte qui en dependrait apparierait au hasard — la
// seule distinction structurelle est: sous-message, ou feuille.
test('l empreinte ne distingue pas une chaine imprimable d octets bruts', () => {
  // decodeRaw ne classe en `string` qu'au-dela de 3 octets: la mesure doit
  // porter sur des champs assez longs pour que l'heuristique se declenche.
  const imprimable = decodeRaw(Buffer.concat([hex('0a 04'), Buffer.from('abcd')]));
  const binaire = decodeRaw(hex('0a 04 00 ff 00 ff'));
  assert.strictEqual(empreinte(imprimable), empreinte(binaire));
});

test('l empreinte distingue une feuille d un sous-message', () => {
  const feuille = decodeRaw(hex('0a 02 00 ff'));
  const sousMessage = decodeRaw(hex('0a 03 08 96 01'));
  assert.notStrictEqual(empreinte(feuille), empreinte(sousMessage));
});

// L'appariement croise DEUX criteres. L'empreinte seule ne suffit pas: un
// payload vide est l'empreinte la plus repandue du flux, et kgi comme jxy la
// portent. Le sens elimine d'emblee la moitie du bruit.
test('propose les noms de meme sens et de meme empreinte', () => {
  const { candidats } = require('../src/dev/appariement');
  const trames = [
    { nom: 'aaa', sens: 'entrant', empreinte: '1:varint,2:varint,4:varint', ms: 100 },
    { nom: 'bbb', sens: 'entrant', empreinte: '1:varint', ms: 200 },
    { nom: 'ccc', sens: 'sortant', empreinte: '1:varint,2:varint,4:varint', ms: 300 },
  ];
  const [r] = candidats([{ cle: 'kfz', sens: 'entrant', empreinte: '1:varint,2:varint,4:varint' }], trames);
  assert.deepStrictEqual(r.propositions.map((p) => p.nom), ['aaa']);
});

// Un nom vu vingt fois pendant qu'on cherche un geste unique est presque
// surement du bruit de fond. Le compte doit remonter pour qu'on en juge.
test('chaque proposition dit combien de fois elle a ete vue', () => {
  const { candidats } = require('../src/dev/appariement');
  const trames = [
    { nom: 'aaa', sens: 'entrant', empreinte: '1:varint', ms: 100 },
    { nom: 'aaa', sens: 'entrant', empreinte: '1:varint', ms: 150 },
  ];
  const [r] = candidats([{ cle: 'ijx', sens: 'entrant', empreinte: '1:varint' }], trames);
  assert.strictEqual(r.propositions[0].vus, 2);
  assert.deepStrictEqual(r.propositions[0].instants, [100, 150]);
});

test('une cle sans candidat le dit plutot que de disparaitre', () => {
  const { candidats } = require('../src/dev/appariement');
  const [r] = candidats([{ cle: 'kep', sens: 'sortant', empreinte: '1:varint,2:varint' }], []);
  assert.strictEqual(r.cle, 'kep');
  assert.deepStrictEqual(r.propositions, []);
});
