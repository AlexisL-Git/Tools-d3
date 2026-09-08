'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { EtatCompte, Comptes } = require('../src/protocol/compte');
const { decodeFrameRaw } = require('../src/codec/rawProto');

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');

// Trame relevee le 19/08 a travers notre propre proxy, au moment de l'entree
// en jeu: request kvw { 1 = 665809125670 }. Le patch 3.6.11.12 du 08/09 l'a
// renommee kth et fait partir les requetes en kind 1: on reconstruit donc ici
// la forme COURANTE, celle que KTH_REEL fige plus bas sur des octets mesures.
function trameKth(id) {
  const varint = (v) => {
    const out = [];
    let x = BigInt(v);
    do { let b = Number(x & 0x7fn); x >>= 7n; if (x > 0n) b |= 0x80; out.push(b); } while (x > 0n);
    return Buffer.from(out);
  };
  const champ = Buffer.concat([Buffer.from([0x08]), varint(id)]);            // 1 = id
  const url = Buffer.from('type.ankama.com/kth');
  const any = Buffer.concat([
    Buffer.from([0x0a, url.length]), url,
    Buffer.from([0x12, champ.length]), champ,
  ]);
  const box = Buffer.concat([Buffer.from([0x0a, any.length]), any]);         // content = 1
  return Buffer.concat([Buffer.from([0x0a, box.length]), box]);              // request = 1
}

test('le compte apprend son identifiant de personnage depuis kth', () => {
  const e = new EtatCompte({ pid: 42 });
  assert.strictEqual(e.pret, false);
  e.observer(decodeFrameRaw(trameKth(665809125670n)));
  assert.strictEqual(e.characterId, 665809125670n);
  assert.strictEqual(e.pret, true);
});

test('les autres messages ne modifient pas l identifiant', () => {
  const e = new EtatCompte({ pid: 42 });
  e.observer(decodeFrameRaw(trameKth(1234n)));
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
  e.observer(decodeFrameRaw(trameKth(7n)));
  assert.deepStrictEqual(e.peutRejouer('jbn'), { possible: true, manque: [] });

  // Sans savoir quel element le maitre a designe, on ne peut pas chercher le
  // numero correspondant chez l'esclave.
  assert.deepStrictEqual(e.peutRejouer('iwo'), { possible: false, manque: ['elementId du maître'] });
});

// Trame jss reelle, relevee le 19/08: le serveur annonce a l'arrivee sur une
// carte la liste des elements interactifs avec, pour chacun, le numero
// d'action PROPRE A CE CLIENT. Le zaap de la carte y figure en
// { 4:{1:14948, 2:114}, 5:540322, 6:16 }.
function trameJss(elements) {
  const varint = (v) => {
    const out = []; let x = BigInt(v);
    do { let b = Number(x & 0x7fn); x >>= 7n; if (x > 0n) b |= 0x80; out.push(b); } while (x > 0n);
    return Buffer.from(out);
  };
  const bloc = (no, corps) => Buffer.concat([Buffer.from([(no << 3) | 2, corps.length]), corps]);
  const vchamp = (no, v) => Buffer.concat([Buffer.from([(no << 3) | 0]), varint(v)]);

  const entrees = elements.map(({ uid, skillId, elementId }) => bloc(11, Buffer.concat([
    vchamp(1, 1),
    bloc(4, Buffer.concat([vchamp(1, uid), vchamp(2, skillId)])),
    vchamp(5, elementId),
    vchamp(6, 16),
  ])));

  const url = Buffer.from('type.ankama.com/jss');
  const corps = Buffer.concat(entrees);
  const any = Buffer.concat([Buffer.from([0x0a, url.length]), url, Buffer.from([0x12, corps.length]), corps]);
  const boite = Buffer.concat([Buffer.from([0x0a, any.length]), any]);
  return Buffer.concat([Buffer.from([0x0a, boite.length]), boite]);   // event = 1
}

test('le compte apprend son numéro d action pour chaque élément', () => {
  const e = new EtatCompte({ pid: 1 });
  assert.strictEqual(e.skillPour(540322n), null);

  e.observer(decodeFrameRaw(trameJss([
    { uid: 30734, skillId: 153, elementId: 523669 },
    { uid: 14948, skillId: 114, elementId: 540322 },
  ])));

  assert.strictEqual(e.skillPour(540322n), 14948n, 'le zaap');
  assert.strictEqual(e.skillPour(523669n), 30734n);
  assert.strictEqual(e.skillPour(999999n), null);
});

// Deux comptes sur la meme carte recoivent des numeros differents pour le
// meme element: c'est toute la raison d'etre de cette table.
test('deux comptes ont des numéros différents pour le même élément', () => {
  const a = new EtatCompte({ pid: 1 });
  const b = new EtatCompte({ pid: 2 });
  a.observer(decodeFrameRaw(trameJss([{ uid: 14948, skillId: 114, elementId: 540322 }])));
  b.observer(decodeFrameRaw(trameJss([{ uid: 20777, skillId: 114, elementId: 540322 }])));
  assert.strictEqual(a.skillPour(540322n), 14948n);
  assert.strictEqual(b.skillPour(540322n), 20777n);
});

test('le clic est rejouable une fois l élément connu', () => {
  const e = new EtatCompte({ pid: 1 });
  assert.deepStrictEqual(
    e.peutRejouer('iwo', { elementId: 540322n }),
    { possible: false, manque: ["skillInstanceUid pour l'élément 540322"] },
  );

  e.observer(decodeFrameRaw(trameJss([{ uid: 14948, skillId: 114, elementId: 540322 }])));
  assert.deepStrictEqual(e.peutRejouer('iwo', { elementId: 540322n }), { possible: true, manque: [] });

  // Un element jamais annonce reste refuse: mieux vaut ne rien envoyer.
  assert.strictEqual(e.peutRejouer('iwo', { elementId: 1n }).possible, false);
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

// Un compte exclu reste en jeu et continue d'etre observe, mais ne recoit plus
// les actions du maitre.
test('un compte exclu ne figure plus parmi les esclaves', () => {
  const c = new Comptes();
  for (const pid of [1, 2, 3]) c.ajouter({ pid, port: 8300 + pid });

  assert.strictEqual(c.esclaves(1).length, 2);

  c.get(2).exclu = true;
  const restants = c.esclaves(1);
  assert.strictEqual(restants.length, 1);
  assert.strictEqual(restants[0].pid, 3);
});

test('un compte n est pas exclu par défaut', () => {
  const c = new Comptes();
  assert.strictEqual(c.ajouter({ pid: 1, port: 1 }).exclu, false);
});

// Exclure le maitre n'a pas de sens: il n'est jamais dans sa propre liste.
test('exclure le maître ne change rien', () => {
  const c = new Comptes();
  for (const pid of [1, 2]) c.ajouter({ pid, port: pid });
  c.get(1).exclu = true;
  assert.strictEqual(c.esclaves(1).length, 1);
});

// Le passe-tour et le OMNI sont deux fonctions independantes: eteindre
// l'une ne doit rien faire a l'autre.
test('le passe-tour est eteint par defaut et independant de l exclusion', () => {
  const c = new Comptes();
  const e = c.ajouter({ pid: 1, port: 1 });

  assert.strictEqual(e.passeTour, false);

  e.passeTour = true;
  assert.strictEqual(e.exclu, false, 'activer le passe-tour ne touche pas au OMNI');

  e.exclu = true;
  assert.strictEqual(e.passeTour, true, 'exclure du OMNI ne coupe pas le passe-tour');
});

test('chaque compte garde son propre identifiant', () => {
  const c = new Comptes();
  const a = c.ajouter({ pid: 1, port: 8301 });
  const b = c.ajouter({ pid: 2, port: 8302 });
  a.observer(decodeFrameRaw(trameKth(111n)));
  b.observer(decodeFrameRaw(trameKth(222n)));
  assert.strictEqual(c.get(1).characterId, 111n);
  assert.strictEqual(c.get(2).characterId, 222n);
});

// Jumeau de passeTour, et independant de lui: un compte peut accepter les
// invitations sans passer ses tours.
test('accepteInvitation est faux par defaut et independant de passeTour', () => {
  const e = new EtatCompte({ pid: 1 });
  assert.strictEqual(e.accepteInvitation, false);
  e.accepteInvitation = true;
  assert.strictEqual(e.passeTour, false);
  assert.strictEqual(e.exclu, false);
});

// Quatrieme interrupteur, independant des trois autres.
test('noAnim est faux par defaut et independant des autres interrupteurs', () => {
  const e = new EtatCompte({ pid: 1 });
  assert.strictEqual(e.noAnim, false);
  e.noAnim = true;
  assert.strictEqual(e.passeTour, false);
  assert.strictEqual(e.accepteInvitation, false);
  assert.strictEqual(e.exclu, false);
});

// --- Vérité terrain du 08/09, patch 3.6.11.12 ------------------------------
//
// Trame REELLE, relevee au login d'un client: la requete qui annonce le
// personnage s'appelle desormais kth, et part en kind 1 comme toute requete
// depuis ce patch. Le champ 1 n'a pas bouge.
//
// C'EST LE MESSAGE LE PLUS COUTEUX DU LOT. Sans lui, characterId reste null,
// donc autresNotres() rend une liste vide, donc l'echange refuse tout avec
// « proposant inconnu de l'application » — et la garde-combat comme
// l'abandon-combat s'eteignent de la meme facon. Un seul nom perime suffisait
// a faire tomber trois fonctions sans qu'aucune ne se plaigne.
const KTH_REEL = hex(
  '0a2b0a1e0a13747970652e616e6b616d612e636f6d2f6b7468120708a682c488da1310ffffffffffffffffff01',
);

test('le compte apprend son identifiant depuis la trame kth mesuree', () => {
  const e = new EtatCompte({ pid: 42 });
  e.observer(decodeFrameRaw(KTH_REEL));
  assert.strictEqual(e.characterId, 677012111654n);
  assert.strictEqual(e.pret, true);
});
