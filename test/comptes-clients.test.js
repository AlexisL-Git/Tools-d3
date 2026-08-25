'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { extraireIdCompte, extrairePersonnage, analyserSortie, listerClients, fermerClients } = require('../src/comptes/clients');

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
    extrairePersonnage('Spoony OMNI:ON Follow:OFF'),
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

test('chaque pid est tue une fois, dans l ordre', () => {
  const tues = [];
  const rendu = fermerClients([101, 102, 103], (pid) => tues.push(pid));
  assert.deepStrictEqual(tues, [101, 102, 103]);
  assert.deepStrictEqual(rendu.map((r) => r.ok), [true, true, true]);
});

// process.kill(0) vise le GROUPE de processus courant: l'application se
// fermerait elle-meme au lieu de fermer les clients.
test('le pid zero est refuse, jamais transmis', () => {
  const tues = [];
  const rendu = fermerClients([0], (pid) => tues.push(pid));
  assert.deepStrictEqual(tues, []);
  assert.strictEqual(rendu[0].ok, false);
  assert.match(rendu[0].raison, /invalide/);
});

test('un pid negatif ou non entier est refuse', () => {
  const tues = [];
  const rendu = fermerClients([-1, 1.5, null, 'x'], (pid) => tues.push(pid));
  assert.deepStrictEqual(tues, []);
  assert.strictEqual(rendu.filter((r) => r.ok).length, 0);
});

test('notre propre pid est refuse', () => {
  const tues = [];
  const rendu = fermerClients([process.pid], (pid) => tues.push(pid));
  assert.deepStrictEqual(tues, []);
  assert.strictEqual(rendu[0].ok, false);
});

// Un client deja ferme entre l'enumeration et le clic fait lever process.kill.
// Ce n'est pas une anomalie: les autres doivent quand meme etre fermes.
test('un echec n interrompt pas les suivants', () => {
  const tues = [];
  const rendu = fermerClients([101, 102, 103], (pid) => {
    if (pid === 102) throw new Error('ESRCH');
    tues.push(pid);
  });
  assert.deepStrictEqual(tues, [101, 103]);
  assert.deepStrictEqual(rendu.map((r) => r.ok), [true, false, true]);
  assert.match(rendu[1].raison, /ESRCH/);
});

test('une liste vide ne fait rien et ne leve pas', () => {
  assert.deepStrictEqual(fermerClients([], () => { throw new Error('jamais'); }), []);
});

// --- noms de personnage contenant des tirets ------------------------------

// MESURE du 2026-08-25, titre releve sur un client reel:
//   "Lance-poule-ultime - Pandawa - 3.6.10.11 - Release"
//
// L'analyse lisait de gauche a droite avec [^-]+?, ce qui EXCLUAIT le tiret
// du nom. L'hypothese etait ecrite dans le module: « ni le nom du personnage
// ni celui de la classe ne contiennent de tiret ». Elle tombe sur toute une
// equipe nommee ainsi, et la consequence n'etait pas une erreur mais un
// SILENCE: colonne personnage vide, classe inconnue, donc aucun embleme de
// classe possible.
test('un nom de personnage à tirets est reconnu', () => {
  assert.deepStrictEqual(
    extrairePersonnage('Lance-poule-ultime - Pandawa - 3.6.10.11 - Release'),
    { personnage: 'Lance-poule-ultime', classe: 'Pandawa' },
  );
});

test('toute une équipe nommée avec des tirets est reconnue', () => {
  for (const [titre, attendu] of [
    ['Lance-moineau-ultime - Crâ - 3.6.10.11 - Release', 'Lance-moineau-ultime'],
    ['Lance-toucan-ultime - Iop - 3.6.10.11 - Release', 'Lance-toucan-ultime'],
    ['Lance-manchot-ultime - Sram - 3.6.10.11 - Release', 'Lance-manchot-ultime'],
  ]) {
    assert.strictEqual(extrairePersonnage(titre).personnage, attendu, titre);
  }
});

// La version a change de forme en cours de route (3.6.10.10 puis 3.6.10.11).
// L'analyse ne doit pas dependre du nombre de composants.
test('la reconnaissance ne dépend pas du nombre de composants de version', () => {
  assert.strictEqual(extrairePersonnage('Spoony - Iop - 3.6.10 - Release').classe, 'Iop');
  assert.strictEqual(extrairePersonnage('Spoony - Iop - 3.6.10.11 - Release').classe, 'Iop');
});
