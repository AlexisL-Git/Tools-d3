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

// Le journal numerote ses lignes d'octets par offset DECIMAL, sur quatre
// chiffres tant que la trame tient sous 10 000 octets — et cinq au-dela. Un
// lecteur qui n'accepte que quatre chiffres s'arrete pile a 10 016 octets et
// rend une trame TRONQUEE, qui se decode en null sans que rien ne le signale.
//
// Mesure du 08/09: neuf trames du journal HDV depassaient ce seuil, dont celle
// qui porte la table des prix moyens. Le symptome etait « on ne connait pas le
// prix moyen », a trois couches de la vraie cause.
test('les octets continuent d etre lus au-dela de 10 000', () => {
  const { lireCaptures } = require('../src/dev/appariement');
  const journal = [
    '  100ms [1] cap :  <-- event xyz {  }',
    '  100ms [1]         0000  0a190a170a13747970652e616e6b616d612e636f6d2f78797a',
    '  100ms [1]         10016  00',
  ].join(String.fromCharCode(10));
  const [t] = lireCaptures(journal);
  // 25 octets sur la premiere ligne, 1 sur celle a offset 10016: la lire ou non
  // fait toute la difference, et c'est exactement le seuil ou le journal passe
  // de quatre chiffres a cinq.
  assert.strictEqual(t.octets.length, 26, 'la ligne a cinq chiffres doit etre lue');
});

// --- LE CATALOGUE ---------------------------------------------------------
//
// Une empreinte fausse dans le catalogue ne casse rien: candidats() rend une
// liste vide, et l'outil affiche « aucun candidat — le geste a-t-il ete fait
// pendant la mesure ? ». Il accuse la seance au lieu de lui-meme, et la seance
// est refaite pour rien.
//
// C'est arrive: l'entree `ijz` a d'abord porte trois champs (1, 2 et 5), ceux
// que le commentaire de src/invitation.js nommait utilement, la ou la trame en
// portait six.
//
// ET UNE EMPREINTE JUSTE NE SUFFIT PAS TOUJOURS. Corrigee sur ses six champs,
// `ijz` n'a quand meme rien apparie le 08/09: le patch avait aussi RENUMEROTE
// ses champs, ce que l'appariement suppose impossible. C'est la chronologie
// qui a retrouve ikb. Ces tests figent donc ce qui reste verifiable — le
// rapprochement entre le catalogue et des OCTETS REELS.
const { decodeFrameRaw } = require('../src/codec/rawProto');
const { CATALOGUE } = require('../src/dev/catalogue');
const fsc = require('node:fs');

const entree = (prefixe) => CATALOGUE.find((e) => e.cle.startsWith(prefixe));
const capture = (nom) => decodeFrameRaw(
  Buffer.from(fsc.readFileSync('test/fixtures/' + nom + '.hex', 'utf8').trim(), 'hex'),
);

// Les cinq messages remappes le 08/09, chacun face aux octets qui l'ont fait
// nommer. Si le catalogue derive, c'est ici que ca se voit.
const REMAPPES = [
  ['ikb', 'invitation-ikb', 'entrant'],
  ['ikg', 'invitation-ikg', 'sortant'],
  ['ixm', 'songe-ixm', 'sortant'],
  ['ivj', 'songe-ivj', 'entrant'],
  ['ixo', 'songe-ixo', 'sortant'],
];

for (const [nom, fixture, sens] of REMAPPES) {
  test(`l empreinte de ${nom} au catalogue est celle de ses octets reels`, () => {
    const e = entree(nom);
    assert.ok(e, `${nom} manque au catalogue`);
    const f = capture(fixture);
    assert.strictEqual(f.type, nom, 'la fixture doit porter le message attendu');
    assert.strictEqual(e.empreinte, empreinte(f.payload));
    assert.strictEqual(e.sens, sens);
  });
}

// CE DOUBLON EST VOULU, et c'est le piege de la seance de mesure: accepter un
// groupe et accepter un songe sont deux requetes sortantes a un seul varint.
// L'appariement ne les separera jamais; seul l'instant du geste le fera.
test('ikg et ixo partagent leur empreinte: seule la chronologie les separe', () => {
  assert.strictEqual(entree('ikg').empreinte, entree('ixo').empreinte);
  assert.strictEqual(entree('ikg').sens, entree('ixo').sens);
});

// L'empreinte d'avant le patch, gardee comme temoin: elle prouve que le
// changement de structure a bien eu lieu, et que ce n'est pas la lecture des
// octets qui a bouge. Six champs des deux cotes, deux types echanges.
test('la structure de l invitation a bien change entre les deux patchs', () => {
  const avant = empreinte(decodeRaw(hex(
    '08a68284cbb413 10a682c4aab013 1808 289c9c02 3001 3a0653706f6f6e79',
  )));
  assert.strictEqual(avant, '1:varint,2:varint,3:varint,5:varint,6:varint,7:len');
  assert.notStrictEqual(avant, entree('ikb').empreinte, 'le patch a change la structure');
});
