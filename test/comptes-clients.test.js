'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { extraireIdCompte, extrairePersonnage, analyserSortie, listerClients } = require('../src/comptes/clients');

// Ligne de commande reelle relevee le 19/08.
const LIGNE = 'Dofus.exe  -logFile "C:\\Users\\X\\AppData\\Roaming\\zaap\\gamesLogs\\dofus-dofus3\\dofus.10612457.log" --port 26116 --gameName dofus --gameRelease dofus3 --instanceId 8 --hash fdc7ab5e-0940-4ac1-b275-7402c73b5cd4 --canLogin true --langCode fr --autoConnectType 0 --connectionPort 5555 ""';

test('extrait l identifiant de compte du chemin de journal', () => {
  assert.strictEqual(extraireIdCompte(LIGNE), 10612457);
});

test('rend null si la ligne ne porte pas de journal', () => {
  assert.strictEqual(extraireIdCompte('Dofus.exe --port 26116'), null);
  assert.strictEqual(extraireIdCompte(''), null);
  assert.strictEqual(extraireIdCompte(null), null);
});

test('extrait le personnage et la classe du titre', () => {
  assert.deepStrictEqual(
    extrairePersonnage('Spoony - Pandawa - 3.6.10.10 - Release'),
    { personnage: 'Spoony', classe: 'Pandawa' },
  );
});

// Avant l'entree en jeu, le titre ne porte que la version.
test('un titre sans personnage ne fabrique pas de nom', () => {
  assert.deepStrictEqual(
    extrairePersonnage('Dofus 3.6.10.10 - Release'),
    { personnage: null, classe: null },
  );
  assert.deepStrictEqual(extrairePersonnage(''), { personnage: null, classe: null });
});

// Le titre reecrit par un launcher tiers ne doit pas passer pour un personnage.
test('un titre de launcher tiers est ignoré', () => {
  assert.deepStrictEqual(
    extrairePersonnage('Spoony Replicate:ON Follow:OFF'),
    { personnage: null, classe: null },
  );
});

test('analyse la sortie PowerShell en liste de clients', () => {
  const json = JSON.stringify([
    { ProcessId: 4336, CommandLine: LIGNE, MainWindowTitle: 'Spoony - Pandawa - 3.6.10.10 - Release' },
    { ProcessId: 9564, CommandLine: 'Dofus.exe --port 26116', MainWindowTitle: '' },
  ]);
  assert.deepStrictEqual(analyserSortie(json), [
    { pid: 4336, idCompte: 10612457, personnage: 'Spoony', classe: 'Pandawa' },
    { pid: 9564, idCompte: null, personnage: null, classe: null },
  ]);
});

// PowerShell rend un objet seul, pas un tableau, quand il n'y a qu'un process.
test('analyse aussi un process unique rendu hors tableau', () => {
  const json = JSON.stringify({ ProcessId: 42, CommandLine: LIGNE, MainWindowTitle: '' });
  assert.strictEqual(analyserSortie(json).length, 1);
  assert.strictEqual(analyserSortie(json)[0].pid, 42);
});

test('une sortie vide ou illisible donne une liste vide', () => {
  assert.deepStrictEqual(analyserSortie(''), []);
  assert.deepStrictEqual(analyserSortie('pas du json'), []);
});

// listerClients() accepte un execFile injecte pour ne jamais dependre du vrai
// PowerShell dans les tests.
test('listerClients rend une liste vide si le lanceur echoue', async () => {
  const executeurEnErreur = (commande, args, options, callback) => callback(new Error('echec powershell'));
  assert.deepStrictEqual(await listerClients(executeurEnErreur), []);
});

test('listerClients analyse la sortie du lanceur quand il reussit', async () => {
  const json = JSON.stringify([
    { ProcessId: 4336, CommandLine: LIGNE, MainWindowTitle: 'Spoony - Pandawa - 3.6.10.10 - Release' },
  ]);
  const executeurEnSucces = (commande, args, options, callback) => callback(null, json);
  assert.deepStrictEqual(await listerClients(executeurEnSucces), [
    { pid: 4336, idCompte: 10612457, personnage: 'Spoony', classe: 'Pandawa' },
  ]);
});
