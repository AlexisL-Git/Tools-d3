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

// CRITICAL 1 (revue finale): une connexion vue pour la premiere fois alors
// que le no-anim etait eteint peut deja etre en cours depuis un decalage
// arbitraire du flux. Elle est donc refusee DEFINITIVEMENT au rallumage, pas
// reprise sur un flux suppose propre -- ce que faisait l ancien code, a tort.
test('rallume une connexion deja vue hors armement: refusee pour de bon, un seul compte rendu', () => {
  const { f, reglages, rendu, conn } = flux(false);
  assert.strictEqual(f(surLeFil(AUTRE), conn), null);
  reglages.actif = true;
  // Relaye tel quel: aucune transformation, meme si le contenu se trouve
  // aligne sur une frontiere de trame par coincidence.
  assert.strictEqual(f(surLeFil(AUTRE), conn), null);
  assert.strictEqual(f(surLeFil(JSJ), conn), null);
  // Un seul compte rendu, pas un par chunk: le trafic ordinaire ne doit pas
  // remplir le journal.
  assert.strictEqual(rendu.length, 1);
  assert.match(rendu[0].raison, /deja en cours/);
});

// Test manquant #1 de la revue finale: rallumage HORS FRONTIERE de trame. La
// sortie totale doit rester egale a l entree totale, ou la connexion doit
// etre refusee avec un compte rendu -- jamais un gel silencieux.
test('rallumage hors frontiere de trame: total sortant == total entrant, refus journalise (test manquant #1)', () => {
  const { f, reglages, rendu, conn } = flux();
  const entree = [];
  const sortie = [];
  const noter = (chunk) => { const s = f(chunk, conn); entree.push(chunk); sortie.push(Buffer.isBuffer(s) ? s : chunk); };

  noter(surLeFil(AUTRE));   // arme depuis le debut, trame complete: pending == 0

  // Toujours arme: on coupe une trame en deux pour laisser des octets en
  // attente dans le reassembleur (pending > 0), PUIS on eteint pendant que
  // ces octets sont encore bufferises -- c est le cas qui desynchronise.
  const fil2 = surLeFil(AUTRE, JSJ);
  noter(fil2.subarray(0, 5));
  reglages.actif = false;
  noter(fil2.subarray(5));

  reglages.actif = true;
  noter(surLeFil(AUTRE));

  assert.strictEqual(Buffer.concat(sortie).toString('hex'), Buffer.concat(entree).toString('hex'));
  assert.ok(rendu.some((r) => /deja en cours/.test(r.raison)), 'le refus doit etre journalise');
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

// Test manquant #3 de la revue finale: deux comptes dont un seul est arme --
// celui qui ne l est pas voit son flux inchange. estArmePourCompte est le
// predicat que desktop/main.js branche sur l etat.noAnim de chaque compte.
test('deux comptes, un seul arme via estArmePourCompte: l autre est inchange (test manquant #3)', () => {
  const reglages = { actif: true };
  const estArmePourCompte = (pid) => pid === 2;
  const f = creerTransformateurFlux({ reglages, estArmePourCompte, onCompteRendu: () => {} });
  // Cle composee comme le fait superviseur._transformateurPour.
  const connEteint = { id: '1/1', port: 5555, pid: 1 };
  const connArme = { id: '2/1', port: 5555, pid: 2 };

  const sortieEteint = f(surLeFil(JSJ), connEteint);
  assert.strictEqual(sortieEteint, null, 'le compte non arme ne doit rien voir transforme');

  const sortieArme = f(surLeFil(JSJ), connArme);
  assert.ok(sortieArme.length > surLeFil(JSJ).length, 'le compte arme doit voir la pose ajoutee');
});

// Corrections apportees: les deux critical de perte de donnees, et l important de securite.
test('octets bufferises puis cadrage impossible: rien n est perdu (CRITICAL 1)', () => {
  const { f, conn } = flux();
  const fil = surLeFil(AUTRE);
  // Envoyer la trame complete.
  const sortie1 = f(fil, conn);
  assert.ok(sortie1.length > 0);
  // Poison: une longueur gigantesque, sendee en deux chunks pour que le varint
  // poison soit incomplet au premier chunk et lance une exception au second.
  const poison = Buffer.concat([writeVarint(9 * 1024 * 1024), Buffer.alloc(8)]);
  const poisonPart1 = poison.subarray(0, 1);
  const poisonPart2 = poison.subarray(1);
  const sortie2_a = f(poisonPart1, conn);
  const sortie2_b = f(poisonPart2, conn);
  // Concatener tout ce qui est sorti.
  const sortieTotal = Buffer.concat([sortie1, sortie2_a === null ? Buffer.alloc(0) : sortie2_a, sortie2_b === null ? Buffer.alloc(0) : sortie2_b]);
  // Doit etre EXACTEMENT l entree: trame + poison.
  const entreeTotal = Buffer.concat([fil, poison]);
  assert.strictEqual(sortieTotal.toString('hex'), entreeTotal.toString('hex'));
});

test('octets bufferises puis extinction: rien n est perdu (CRITICAL 2)', () => {
  const { f, reglages, conn } = flux();
  const fil = surLeFil(AUTRE);
  // Bufferiser une partie.
  const entree1 = fil.subarray(0, 3);
  const sortie1 = f(entree1, conn);
  assert.strictEqual(sortie1.length, 0);
  // Eteindre le transformateur.
  reglages.actif = false;
  const entree2 = fil.subarray(3);
  const sortie2 = f(entree2, conn);
  // Concatener tout ce qui est sorti.
  const sortieTotal = Buffer.concat([sortie1, sortie2]);
  // Doit etre EXACTEMENT l entree complète.
  assert.strictEqual(sortieTotal.toString('hex'), fil.toString('hex'));
});

test('eteint depuis le debut, rien en attente: rend null (GARANTIE 1)', () => {
  const { f, conn } = flux(false);
  const fil = surLeFil(AUTRE);
  assert.strictEqual(f(fil, conn), null);
  // Et un second appel aussi.
  assert.strictEqual(f(fil, conn), null);
});

test('conn sans id: octets d origine inchanges (IMPORTANT)', () => {
  const { f } = flux();
  const fil = surLeFil(AUTRE);
  const connSansId = { id: undefined, port: 5555 };
  const sortie = f(fil, connSansId);
  assert.strictEqual(sortie.toString('hex'), fil.toString('hex'));
});

// Sans le pid, un compte rendu ne dit que le numero de connexion — et ce
// numero se repete d'un compte a l'autre (createProxy repart a 1 a chaque
// appel), rendant le journal inexploitable en multicompte.
test('le pid de la connexion remonte dans le compte rendu', () => {
  const { f, rendu } = flux();
  const conn = { id: 1, port: 5555, pid: 4242 };
  const poison = Buffer.concat([writeVarint(9 * 1024 * 1024), Buffer.alloc(8)]);
  f(poison, conn);
  assert.strictEqual(rendu[0].pid, 4242);
});

test('duplication apres cadrage perdu puis extinction: buffer vide (CRITICAL nouveau)', () => {
  const { f, reglages, conn } = flux();
  // Provoquer un cadrage perdu: une longueur gigantesque lance une exception.
  const poison = Buffer.concat([writeVarint(9 * 1024 * 1024), Buffer.alloc(8)]);
  const out1 = f(poison, conn);
  // Le poison est emis (octets en attente + poison).
  assert.ok(out1.length > 0);
  // Eteindre le transformateur pendant que la connexion est inerte.
  reglages.actif = false;
  // Envoyer un nouveau chunk.
  const nouveau = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  const out2 = f(nouveau, conn);
  // L extinction doit emettre le nouveau chunk tel quel, pas d octets residuels
  // du cadrage perdu (sinon duplication).
  assert.strictEqual(out2.toString('hex'), nouveau.toString('hex'));
});
