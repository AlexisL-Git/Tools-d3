'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { decodeFrameRaw } = require('../src/codec/rawProto');
const { creerSuiviSonge, FENETRE_ARRIVEE } = require('../src/songe-en-cours');
const { TYPE_LANCEMENT, TYPE_ACCEPTATION } = require('../src/songes');

// Une horloge qu'on avance a la main: la fenetre se teste sans dormir, comme
// celle de src/songes.js.
function horloge() {
  let t = 1000;
  return { maintenant: () => t, avancer: (ms) => { t += ms; } };
}

const SONGE = 237781005n;   // la carte du songe, mesuree le 08/09
const AILLEURS = 192416776n; // la carte de depart des deux clients, meme journal

const lancement = (pid = 1) => ({
  pid, dir: 'out', frame: { kind: 'request', type: TYPE_LANCEMENT, payload: [{ no: 1, value: 1n }] },
});
const acceptation = (pid = 1) => ({
  pid, dir: 'out', frame: { kind: 'request', type: TYPE_ACCEPTATION, payload: [{ no: 1, value: 1n }] },
});
const arrivee = (carte, pid = 1) => ({
  pid, dir: 'in', frame: { kind: 'event', type: 'jpw', payload: [{ no: 1, value: carte }] },
});

test('sans rien, personne n est dans un songe', () => {
  const s = creerSuiviSonge();
  assert.strictEqual(s.dansUnSonge(1), false);
});

test('un lancement suivi d une arrivee met le client dans le songe', () => {
  const h = horloge();
  const s = creerSuiviSonge({ maintenant: h.maintenant });
  s.onTrame(lancement(1));
  h.avancer(65); // le delai mesure le 08/09
  s.onTrame(arrivee(SONGE, 1));
  assert.strictEqual(s.dansUnSonge(1), true);
});

// REJOINDRE le songe d'un autre passe par une acceptation, pas par un
// lancement: seul celui qui LANCE emet le second. Meme raison que dans
// src/songes.js, ou l'oubli de ce cas avait fait refuser des invitations.
test('une acceptation vaut un lancement', () => {
  const h = horloge();
  const s = creerSuiviSonge({ maintenant: h.maintenant });
  s.onTrame(acceptation(1));
  h.avancer(65);
  s.onTrame(arrivee(SONGE, 1));
  assert.strictEqual(s.dansUnSonge(1), true);
});

test('une arrivee sans lancement ne met dans aucun songe', () => {
  const s = creerSuiviSonge();
  s.onTrame(arrivee(AILLEURS, 1));
  assert.strictEqual(s.dansUnSonge(1), false);
});

// LE POINT QUI JUSTIFIE LA FENETRE: un lancement refuse n'est suivi d'aucune
// arrivee. Sans borne, la prochaine carte — celle d'un deplacement a pied, des
// minutes plus tard — serait baptisee songe, et le dialogue des mules
// resterait coupe pour toujours.
test('une arrivee hors fenetre ne compte pas comme un songe', () => {
  const h = horloge();
  const s = creerSuiviSonge({ maintenant: h.maintenant });
  s.onTrame(lancement(1));
  h.avancer(FENETRE_ARRIVEE + 1);
  s.onTrame(arrivee(SONGE, 1));
  assert.strictEqual(s.dansUnSonge(1), false);
});

test('a la limite exacte de la fenetre, l arrivee compte encore', () => {
  const h = horloge();
  const s = creerSuiviSonge({ maintenant: h.maintenant });
  s.onTrame(lancement(1));
  h.avancer(FENETRE_ARRIVEE);
  s.onTrame(arrivee(SONGE, 1));
  assert.strictEqual(s.dansUnSonge(1), true);
});

test('partir sur une autre carte sort du songe', () => {
  const h = horloge();
  const s = creerSuiviSonge({ maintenant: h.maintenant });
  s.onTrame(lancement(1));
  h.avancer(65);
  s.onTrame(arrivee(SONGE, 1));
  s.onTrame(arrivee(AILLEURS, 1));
  assert.strictEqual(s.dansUnSonge(1), false);
});

// Le serveur peut renvoyer l'arrivee sur la carte ou l'on est deja. La traiter
// comme un depart couperait la regle au milieu du songe.
test('une arrivee sur la carte ou l on est deja ne fait pas sortir', () => {
  const h = horloge();
  const s = creerSuiviSonge({ maintenant: h.maintenant });
  s.onTrame(lancement(1));
  h.avancer(65);
  s.onTrame(arrivee(SONGE, 1));
  s.onTrame(arrivee(SONGE, 1));
  assert.strictEqual(s.dansUnSonge(1), true);
});

// LA FENETRE EST PERSONNELLE, contrairement a celle de l'accepteur: c'est la
// carte de CE client qu'on cherche. Le songe d'un autre ne dit rien de la
// sienne — une mule restee dehors ne doit pas etre comptee dedans.
test('le lancement d un autre client ne met pas celui-ci dans un songe', () => {
  const h = horloge();
  const s = creerSuiviSonge({ maintenant: h.maintenant });
  s.onTrame(lancement(1));
  h.avancer(65);
  s.onTrame(arrivee(SONGE, 2));
  assert.strictEqual(s.dansUnSonge(2), false);
  assert.strictEqual(s.dansUnSonge(1), false);
});

// Le maitre entre dans un songe, la mule reste dehors et se contente de
// changer de carte. Aucun des deux ne doit deteindre sur l autre.
test('deux clients sont suivis independamment', () => {
  const h = horloge();
  const s = creerSuiviSonge({ maintenant: h.maintenant });
  s.onTrame(lancement(1));
  h.avancer(65);
  s.onTrame(arrivee(SONGE, 1));
  s.onTrame(arrivee(AILLEURS, 2));
  assert.strictEqual(s.dansUnSonge(1), true);
  assert.strictEqual(s.dansUnSonge(2), false);

  // Et le maitre qui ressort ne fait pas rentrer la mule.
  s.onTrame(arrivee(AILLEURS, 1));
  assert.strictEqual(s.dansUnSonge(1), false);
  assert.strictEqual(s.dansUnSonge(2), false);
});

test('une trame nulle ne casse rien', () => {
  const s = creerSuiviSonge();
  s.onTrame({ pid: 1, dir: 'in', frame: null });
  s.onTrame({ pid: 1, dir: 'in', frame: undefined });
  assert.strictEqual(s.dansUnSonge(1), false);
});

// Un lancement ENTRANT, ou de kind 'event', n'arme pas: meme exigence que
// src/songes.js, pour que la reponse du serveur ne soit pas prise pour le
// geste du joueur.
test('un lancement entrant n arme pas', () => {
  const h = horloge();
  const s = creerSuiviSonge({ maintenant: h.maintenant });
  s.onTrame({ pid: 1, dir: 'in', frame: { kind: 'request', type: TYPE_LANCEMENT, payload: [] } });
  h.avancer(65);
  s.onTrame(arrivee(SONGE, 1));
  assert.strictEqual(s.dansUnSonge(1), false);
});

// --- LES OCTETS REELS DU 08/09 --------------------------------------------
//
// Les trames ci-dessus sont fabriquees a la main. Celle-ci vient du journal:
// le vrai lancement du maitre, tel qu'il est parti sur le fil.
test('le lancement REEL du 08/09 arme le suivi', () => {
  const h = horloge();
  const s = creerSuiviSonge({ maintenant: h.maintenant });
  const brute = Buffer.from(fs.readFileSync('test/fixtures/songe-ixm.hex', 'utf8').trim(), 'hex');
  const frame = decodeFrameRaw(brute);
  assert.strictEqual(frame.type, TYPE_LANCEMENT, 'la fixture doit porter le lancement');
  s.onTrame({ pid: 1, dir: 'out', frame });
  h.avancer(65);
  s.onTrame(arrivee(SONGE, 1));
  assert.strictEqual(s.dansUnSonge(1), true);
});
