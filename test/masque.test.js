'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerMasque } = require('../src/masque');
const { writeVarint, FrameReassembler } = require('../src/codec/framing');
const { encodeRaw, WIRE } = require('../src/codec/rawProto');

// Deux trames distinctes, construites plutot que recopiees: une trame tronquee
// a la main ne se relit pas, et le test porterait alors sur « indecodable »
// au lieu de « masquee » ou « intacte ».
const trame = (url, champ) => encodeRaw([
  { no: 1, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'string', value: url },
      { no: 2, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.VARINT, value: champ },
      ] },
    ] },
  ] },
]);

const IJZ = trame('type.ankama.com/ijz', 36380n);
const AUTRE = trame('type.ankama.com/ink', 36380n);

// Le reassembleur retire le prefixe de longueur: sur le fil, chaque trame le
// porte.
const surLeFil = (...trames) => Buffer.concat(trames.flatMap((t) => [writeVarint(t.length), t]));
const relire = (buf) => new FrameReassembler().push(buf);

function masque() {
  const rendu = [];
  const m = creerMasque({ onCompteRendu: (r) => rendu.push(r) });
  return { m, rendu, conn: { id: 1, pid: 42 } };
}

// GARANTIE: rien de marque, rien de touche. Le proxy ecrit les octets
// d'origine, exactement comme si ce module n'existait pas.
test('sans marque, le flux n est pas touche', () => {
  const { m, conn } = masque();
  assert.strictEqual(m.transformer(surLeFil(IJZ, AUTRE), conn), null);
});

test('la trame marquee disparait du flux, ses voisines restent intactes', () => {
  const { m, conn } = masque();
  m.marquer(42, IJZ);
  const sortie = m.transformer(surLeFil(AUTRE, IJZ, AUTRE), conn);
  const trames = relire(sortie);
  assert.strictEqual(trames.length, 2);
  assert.ok(trames.every((t) => t.equals(AUTRE)));
});

// Le cadrage du client ne doit jamais bouger: on retire une trame ENTIERE,
// prefixe de longueur compris, ou rien du tout.
test('ce qui reste se relit trame par trame, sans octet en trop', () => {
  const { m, conn } = masque();
  m.marquer(42, IJZ);
  const sortie = m.transformer(surLeFil(IJZ, AUTRE), conn);
  assert.strictEqual(sortie.length, surLeFil(AUTRE).length);
  assert.ok(sortie.equals(surLeFil(AUTRE)));
});

// Une marque qui survivrait a son chunk masquerait une invitation ULTERIEURE
// que personne n'a decide d'accepter.
test('la marque ne sert qu une fois: la meme trame repasse au chunk suivant', () => {
  const { m, conn } = masque();
  m.marquer(42, IJZ);
  assert.notStrictEqual(m.transformer(surLeFil(IJZ), conn), null);
  assert.strictEqual(m.transformer(surLeFil(IJZ), conn), null);
});

// Le cas ou la fonction ne peut rien: la trame commence dans le chunk
// precedent, deja ecrit au client. On ne retire rien plutot que de couper au
// hasard -- le panneau s'affichera, ce qui est le defaut d'avant, jamais une
// connexion perdue.
test('une trame marquee coupee entre deux chunks n est pas retiree, et rien n est perdu', () => {
  const { m, conn } = masque();
  m.marquer(42, IJZ);
  const fil = surLeFil(IJZ);
  const coupe = Math.floor(fil.length / 2);
  const a = m.transformer(fil.subarray(0, coupe), conn);
  const b = m.transformer(fil.subarray(coupe), conn);
  assert.strictEqual(a, null);
  assert.strictEqual(b, null);
});

test('la marque d un compte ne masque rien chez un autre', () => {
  const { m } = masque();
  m.marquer(42, IJZ);
  assert.strictEqual(m.transformer(surLeFil(IJZ), { id: 2, pid: 7 }), null);
});

test('le masquage se journalise, une ligne par trame retiree', () => {
  const { m, rendu, conn } = masque();
  m.marquer(42, IJZ);
  m.transformer(surLeFil(IJZ), conn);
  assert.strictEqual(rendu.length, 1);
  assert.strictEqual(rendu[0].pid, 42);
  assert.match(rendu[0].raison, /masquee/);
});

// Un chunk qui commence au milieu d'une trame fait lire n'importe quoi comme
// longueur. Le module doit s'arreter la et rendre les octets tels quels.
test('un cadrage illisible ne retire rien', () => {
  const { m, conn } = masque();
  m.marquer(42, IJZ);
  const bruit = Buffer.from('ffffffff0102030405', 'hex');
  assert.strictEqual(m.transformer(bruit, conn), null);
});

// Le seul cas ou la fonction ne peut rien doit se voir dans le journal:
// sinon l'utilisateur constate un panneau qui reste, alors que la ligne
// « invitation : acceptee » lui dit que tout s'est bien passe, et rien ne
// relie les deux.
test('une marque qu on n a pas pu retirer se journalise', () => {
  const { m, rendu, conn } = masque();
  m.marquer(42, IJZ);
  const fil = surLeFil(IJZ);
  m.transformer(fil.subarray(0, Math.floor(fil.length / 2)), conn);
  assert.strictEqual(rendu.length, 1);
  assert.strictEqual(rendu[0].pid, 42);
  assert.match(rendu[0].raison, /pas pu etre masquee/);
});

// LA COMPOSITION DES DEUX POLITIQUES DESCENDANTES. Le superviseur n'accepte
// qu'un seul transformateur entrant, et il y en a desormais deux: le no-anim
// REECRIT des trames, le masquage en RETIRE. Le contrat `null` = « je n'ai
// rien fait, ecris l'original » doit survivre a la composition, sinon la
// Garantie 1 du no-anim tombe: eteint ne signifierait plus intouche.
const { composerDescendant } = require('../src/masque');

const inerte = () => { const f = () => null; f.fermer = () => {}; return f; };

test('les deux politiques inertes: le flux composé rend null', () => {
  const f = composerDescendant(inerte(), () => null);
  assert.strictEqual(f(surLeFil(IJZ), { id: 1, pid: 42 }), null);
});

test('le masquage s applique a ce que le no-anim a produit, pas a l original', () => {
  const noAnim = () => surLeFil(AUTRE, IJZ);
  noAnim.fermer = () => {};
  const vus = [];
  const f = composerDescendant(noAnim, (buf) => { vus.push(buf); return null; });
  f(surLeFil(IJZ), { id: 1, pid: 42 });
  assert.strictEqual(vus.length, 1);
  assert.ok(vus[0].equals(surLeFil(AUTRE, IJZ)));
});

test('le masquage qui ne retire rien laisse passer la sortie du no-anim', () => {
  const sortieNoAnim = surLeFil(AUTRE);
  const noAnim = () => sortieNoAnim;
  noAnim.fermer = () => {};
  const f = composerDescendant(noAnim, () => null);
  assert.strictEqual(f(surLeFil(IJZ), { id: 1, pid: 42 }), sortieNoAnim);
});

test('le masquage voit les octets d origine quand le no-anim rend null', () => {
  const vus = [];
  const f = composerDescendant(inerte(), (buf) => { vus.push(buf); return null; });
  const fil = surLeFil(IJZ);
  f(fil, { id: 1, pid: 42 });
  assert.ok(vus[0].equals(fil));
});

// Sans ce relais, l'etat par connexion du no-anim ne serait plus jamais purge.
test('fermer() est transmis au no-anim', () => {
  const fermees = [];
  const noAnim = () => null;
  noAnim.fermer = (id) => fermees.push(id);
  composerDescendant(noAnim, () => null).fermer('42/7');
  assert.deepStrictEqual(fermees, ['42/7']);
});

// BOUT EN BOUT, la seule chose qui prouve que le defaut est corrige: une vraie
// trame `ijz` traverse le vrai accepteur, puis le vrai masque, dans l'ordre ou
// desktop/main.js les enchaine -- onData('in') d'abord, ecriture au client
// ensuite (src/proxy/server.js). L'invitation doit disparaitre du flux, et
// l'acceptation doit tout de meme etre partie.
const { creerAccepteur } = require('../src/invitation');
const { decodeFrameRaw } = require('../src/codec/rawProto');

const MOI = 666951024934n;
const AMI = 665809125670n;
const ETRANGER = 123456789012n;

const IJZ_REELLE = (invitant) => encodeRaw([{ no: 1, wire: WIRE.LEN, kind: 'message', value: [
  { no: 1, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.LEN, kind: 'string', value: 'type.ankama.com/ijz' },
    { no: 2, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.VARINT, value: MOI },
      { no: 2, wire: WIRE.VARINT, value: invitant },
      { no: 5, wire: WIRE.VARINT, value: 36380n },
    ] },
  ] },
] }]);

// Le double du superviseur, comme dans test/invitation.test.js.
function chaine() {
  const emis = [];
  const etats = new Map([[1, { pid: 1, accepteInvitation: true, characterId: MOI }],
                         [2, { pid: 2, accepteInvitation: true, characterId: AMI }]]);
  const sup = {
    comptes: { get: (pid) => etats.get(pid) || null, get tous() { return [...etats.values()]; } },
    emettre: (pid, octets) => { emis.push({ pid, octets }); return { ok: true, octets: octets.length }; },
  };
  const m = creerMasque();
  const accepteur = creerAccepteur({
    superviseur: sup, reglages: { actif: true },
    masquer: (pid, brute) => m.marquer(pid, brute),
  });
  // L'ordre du proxy: le superviseur voit la trame, PUIS le client est ecrit.
  const chunkDescendant = (buf, pid) => {
    for (const brute of new FrameReassembler().push(buf)) {
      accepteur({ pid, dir: 'in', frame: decodeFrameRaw(brute), brute });
    }
    return m.transformer(buf, { id: 1, pid });
  };
  return { emis, chunkDescendant };
}

test('bout en bout: l invitation acceptee ne parvient jamais au client', () => {
  const { emis, chunkDescendant } = chaine();
  const brute = IJZ_REELLE(AMI);
  const sortie = chunkDescendant(surLeFil(AUTRE, brute), 1);
  assert.strictEqual(emis.length, 1, 'l acceptation est bien partie');
  assert.ok(sortie.equals(surLeFil(AUTRE)), 'et l invitation a disparu du flux');
});

test('bout en bout: l invitation d un inconnu parvient au client, intacte', () => {
  const { emis, chunkDescendant } = chaine();
  const fil = surLeFil(IJZ_REELLE(ETRANGER));
  assert.strictEqual(chunkDescendant(fil, 1), null, 'rien n est touche');
  assert.strictEqual(emis.length, 0, 'et rien n est accepte');
});
