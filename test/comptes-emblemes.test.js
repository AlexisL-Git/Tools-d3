'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { idDeClasse, CLASSES, creerEmblemes } = require('../src/comptes/emblemes');

function racineTemporaire(t) {
  const p = path.join(os.tmpdir(), `emblemes-${process.pid}-${Math.random().toString(36).slice(2)}`);
  t.after(() => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} });
  return p;
}

// Un PNG minuscule mais valide, pour ne pas dependre du reseau.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000a49444154789c6360000002000100ffff0300000600' +
  '05'.padEnd(2, '0'), 'hex');

function fauxChercher(reponses) {
  const appels = [];
  return {
    appels,
    chercher: async (url) => {
      appels.push(url);
      const r = reponses[appels.length - 1];
      if (r === 'reseau') throw new Error('ECONNREFUSED');
      if (r === 404) return { ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) };
      return { ok: true, status: 200, arrayBuffer: async () => r };
    },
  };
}

// --- la table des classes --------------------------------------------------

// Les noms viennent du titre de la fenetre Dofus, accents compris. Une table
// qui ne les reconnaitrait pas rendrait tout le reste inutile.
test('les 19 classes sont connues, accents compris', () => {
  assert.strictEqual(Object.keys(CLASSES).length, 19);
  assert.strictEqual(idDeClasse('Pandawa'), 12);
  assert.strictEqual(idDeClasse('Crâ'), 9);
  assert.strictEqual(idDeClasse('Féca'), 1);
  assert.strictEqual(idDeClasse('Xélor'), 5);
  assert.strictEqual(idDeClasse('Forgelance'), 20);
});

test('une classe inconnue ou absente ne donne pas d identifiant', () => {
  assert.strictEqual(idDeClasse('Bonta'), null);
  assert.strictEqual(idDeClasse(null), null);
  assert.strictEqual(idDeClasse(''), null);
  assert.strictEqual(idDeClasse(42), null);
});

// Le titre peut arriver avec des blancs de bordure selon le launcher.
test('les blancs autour du nom sont tolérés', () => {
  assert.strictEqual(idDeClasse('  Iop  '), 8);
});

// --- récupération et cache -------------------------------------------------

test('sans rien en cache, l emblème n est pas encore disponible', (t) => {
  const e = creerEmblemes({ racine: racineTemporaire(t), chercher: async () => { throw new Error('jamais'); } });
  assert.strictEqual(e.pour('Iop'), null);
});

test('un emblème récupéré devient disponible et s écrit sur le disque', async (t) => {
  const racine = racineTemporaire(t);
  const f = fauxChercher([PNG]);
  const e = creerEmblemes({ racine, chercher: f.chercher });

  await e.assurer('Iop');

  const uri = e.pour('Iop');
  assert.match(uri, /^data:image\/png;base64,/);
  assert.ok(fs.existsSync(path.join(racine, 'symbol_8.png')), 'le fichier doit être en cache');
  assert.strictEqual(f.appels.length, 1);
});

// Le reseau n'est sollicite qu'une fois par classe et par machine: c'est tout
// l'interet du cache, et un ami hors ligne garde ses emblemes.
test('un emblème déjà sur le disque ne redemande rien au réseau', async (t) => {
  const racine = racineTemporaire(t);
  fs.mkdirSync(racine, { recursive: true });
  fs.writeFileSync(path.join(racine, 'symbol_8.png'), PNG);

  const f = fauxChercher([]);
  const e = creerEmblemes({ racine, chercher: f.chercher });
  await e.assurer('Iop');

  assert.match(e.pour('Iop'), /^data:image\/png;base64,/);
  assert.strictEqual(f.appels.length, 0, 'aucun appel réseau attendu');
});

test('un emblème déjà en mémoire ne relit même pas le disque', async (t) => {
  const racine = racineTemporaire(t);
  const f = fauxChercher([PNG]);
  const e = creerEmblemes({ racine, chercher: f.chercher });
  await e.assurer('Iop');
  await e.assurer('Iop');
  assert.strictEqual(f.appels.length, 1);
});

// --- échecs ----------------------------------------------------------------

// Une panne de reseau ne doit jamais faire echouer l'affichage: l'interface
// retombe sur l'abreviation de classe, et reessaiera au prochain lancement.
test('une panne réseau ne lève pas et laisse l emblème absent', async (t) => {
  const e = creerEmblemes({ racine: racineTemporaire(t), chercher: fauxChercher(['reseau', 'reseau']).chercher });
  await assert.doesNotReject(() => e.assurer('Iop'));
  assert.strictEqual(e.pour('Iop'), null);
});

test('un 404 ne lève pas et n écrit rien', async (t) => {
  const racine = racineTemporaire(t);
  const e = creerEmblemes({ racine, chercher: fauxChercher([404, 404]).chercher });
  await e.assurer('Iop');
  assert.strictEqual(e.pour('Iop'), null);
  assert.strictEqual(fs.existsSync(path.join(racine, 'symbol_8.png')), false);
});

// Le second hote sert de secours: les deux servent exactement les memes images.
test('si le premier hôte échoue, le second est tenté', async (t) => {
  const f = fauxChercher(['reseau', PNG]);
  const e = creerEmblemes({ racine: racineTemporaire(t), chercher: f.chercher });
  await e.assurer('Iop');
  assert.match(e.pour('Iop'), /^data:image\/png;base64,/);
  assert.strictEqual(f.appels.length, 2);
  assert.notStrictEqual(f.appels[0], f.appels[1], 'les deux hôtes doivent différer');
});

test('une classe inconnue ne déclenche aucun appel', async (t) => {
  const f = fauxChercher([]);
  const e = creerEmblemes({ racine: racineTemporaire(t), chercher: f.chercher });
  await e.assurer('Bonta');
  await e.assurer(null);
  assert.strictEqual(f.appels.length, 0);
});
