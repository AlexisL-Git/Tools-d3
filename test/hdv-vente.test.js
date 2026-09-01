'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFrameRaw, encodeRaw, WIRE } = require('../src/codec/rawProto');
const { creerVente } = require('../src/hdv/vente');

const fixture = (nom) => decodeFrameRaw(
  Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures', nom), 'utf8').trim(), 'hex'),
);

// Un double du superviseur, comme dans passeur.test.js: il retient ce qu'on lui
// demande d'emettre au lieu d'ouvrir une socket.
function doubleSuperviseur(pid = 42, etat = { nom: 'compte' }) {
  return {
    comptes: new Map([[pid, etat]]),
    envois: [],
    emettre(p, octets) { this.envois.push({ pid: p, octets }); return { ok: true }; },
  };
}

// Une trame ivi fabriquee: la vraie fait 90 Ko et 9861 paires, on n'en a pas
// besoin pour verifier que la table est retenue.
function trameIvi(paires) {
  return decodeFrameRaw(encodeRaw([
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: 'type.ankama.com/ivi' },
        { no: 2, wire: WIRE.LEN, kind: 'message', value: paires.map(([gid, prix]) => ({
          no: 2, wire: WIRE.LEN, kind: 'message', value: [
            { no: 1, wire: WIRE.VARINT, value: BigInt(gid) },
            { no: 2, wire: WIRE.VARINT, value: BigInt(prix) },
          ],
        })) },
      ] },
    ] },
  ]));
}

test('l ecoute retient les piles fongibles d une ivx', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-ivx-inventaire.hex') });
  // 219 piles mesurees, dont 204 a effets ecartees.
  assert.strictEqual(vente.pilesConnues(42), 15);
});

test('l ecoute retient aussi la banque, et remplace la liste precedente', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-ivx-inventaire.hex') });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-iwb.hex') });
  // 814 piles mesurees en banque, dont 57 a effets ecartees.
  assert.strictEqual(vente.pilesConnues(42), 757);
});

// UNE TRAME QUI NE REND AUCUNE PILE N'EFFACE PAS CE QU'ON SAIT. ivx n'a ete
// observee que comme une liste de stock, mais un decodage a vide ecraserait la
// liste utile — et le bouton deviendrait inerte sans raison visible.
test('une ivx sans pile lisible n efface pas la liste memorisee', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-iwb.hex') });
  const vide = decodeFrameRaw(encodeRaw([
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: 'type.ankama.com/ivx' },
        { no: 2, wire: WIRE.LEN, kind: 'message', value: [{ no: 1, wire: WIRE.VARINT, value: 7n }] },
      ] },
    ] },
  ]));
  vente.onTrame({ pid: 42, dir: 'in', frame: vide });
  assert.strictEqual(vente.pilesConnues(42), 757);
});

test('l ecoute ignore le sens sortant', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur });
  vente.onTrame({ pid: 42, dir: 'out', frame: fixture('hdv-iwb.hex') });
  assert.strictEqual(vente.pilesConnues(42), 0);
});

test('lancer refuse tant qu aucun stock n est memorise', () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({ superviseur, onCompteRendu: (r) => rendus.push(r) });
  vente.lancer(42);
  assert.strictEqual(rendus.length, 1);
  assert.strictEqual(rendus[0].ok, false);
  assert.match(rendus[0].raison, /ouvre l hotel de vente/);
  assert.strictEqual(superviseur.envois.length, 0);
});

test('lancer refuse sur un compte qui n est pas pilote', () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({ superviseur, onCompteRendu: (r) => rendus.push(r) });
  vente.onTrame({ pid: 99, dir: 'in', frame: fixture('hdv-iwb.hex') });
  vente.lancer(99);
  assert.strictEqual(rendus[0].ok, false);
  assert.match(rendus[0].raison, /pilote/);
});

test('l ecoute retient les prix moyens d ivi', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur, reglages: { delaiObjetMs: 0, delaiRafaleMs: 0, delaiReponseMs: 0 } });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32], [8437, 39]]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-iwb.hex') });
  vente.lancer(42);
  // La passe a demarre: le premier envoi est un abonnement.
  assert.ok(superviseur.envois.length > 0);
  // ET C'EST BIEN LA TABLE D'IVI QUI A DECIDE DE L'ORDRE. Sans elle tous les
  // lots vaudraient zero et le tri retomberait sur le gid 1731; avec elle, le
  // lot le plus cher est le gid 8437. Une assertion sur le seul nombre
  // d'envois ne prouverait rien: la passe demarre dans les deux cas.
  const abonnement = decodeFrameRaw(superviseur.envois[0].octets);
  assert.strictEqual(abonnement.type, 'keh');
  assert.strictEqual(Number(abonnement.payload.find((f) => f.no === 1).value), 8437);
  // Le champ 2 distingue l'abonnement du DESABONNEMENT, qui est le meme
  // message sans lui. Sans cette assertion, confondre les deux passerait.
  assert.strictEqual(Number(abonnement.payload.find((f) => f.no === 2).value), 1);
  vente.arreter(42);
});
