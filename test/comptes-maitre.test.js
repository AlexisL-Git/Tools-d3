'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { resoudreMaitre } = require('../src/comptes/maitre');

// Les clients tels que listerClients() les rend: pid, idCompte, et le reste
// dont la resolution n'a pas besoin.
const CLIENTS = [
  { pid: 100, idCompte: 10612457, personnage: 'macpc', classe: 'Iop' },
  { pid: 200, idCompte: 10612458, personnage: 'Zkz', classe: 'Eni' },
  { pid: 300, idCompte: null, personnage: null, classe: null },
];

test('sans compte épinglé, il n y a pas de maître', () => {
  const pid = resoudreMaitre({ epingle: null, clients: CLIENTS, intercepte: new Set([100, 200]) });
  assert.strictEqual(pid, null);
});

test('le compte épinglé et intercepté devient maître', () => {
  const pid = resoudreMaitre({ epingle: 10612458, clients: CLIENTS, intercepte: new Set([100, 200]) });
  assert.strictEqual(pid, 200);
});

// Un client lance apres l'application est attache mais sa session reste hors du
// proxy: il n'emet rien qu'on puisse repliquer. Le designer maitre ferait
// attendre une duplication qui n'arrivera jamais.
test('le compte épinglé sans trafic prouvé ne devient pas maître', () => {
  const pid = resoudreMaitre({ epingle: 10612458, clients: CLIENTS, intercepte: new Set([100]) });
  assert.strictEqual(pid, null);
});

test('le compte épinglé absent de la liste des clients ne donne pas de maître', () => {
  const pid = resoudreMaitre({ epingle: 99999999, clients: CLIENTS, intercepte: new Set([100, 200]) });
  assert.strictEqual(pid, null);
});

test('aucun client lancé ne donne pas de maître', () => {
  const pid = resoudreMaitre({ epingle: 10612458, clients: [], intercepte: new Set() });
  assert.strictEqual(pid, null);
});

// Le choix est memorise PAR IDENTIFIANT DE COMPTE: un client dont la ligne de
// commande ne porte pas de -logFile exploitable n'a pas d'identifiant, donc
// aucun choix le concernant ne survivrait au redemarrage.
test('un client sans identifiant de compte ne peut pas être maître', () => {
  const pid = resoudreMaitre({ epingle: null, clients: CLIENTS, intercepte: new Set([300]) });
  assert.strictEqual(pid, null);
});

// Windows recycle les pid: deux lancements successifs d'un meme compte n'ont
// pas le meme. C'est l'identifiant de compte qui est memorise, et le pid s'en
// deduit a chaque tick.
test('le pid rendu suit le client courant du compte épinglé', () => {
  const avant = resoudreMaitre({
    epingle: 10612457,
    clients: [{ pid: 100, idCompte: 10612457 }],
    intercepte: new Set([100]),
  });
  const apres = resoudreMaitre({
    epingle: 10612457,
    clients: [{ pid: 777, idCompte: 10612457 }],
    intercepte: new Set([777]),
  });
  assert.strictEqual(avant, 100);
  assert.strictEqual(apres, 777);
});
