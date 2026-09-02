'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { etatDepot, mettreAJour } = require('../src/dev/maj-git');

// Un faux git: on lui donne ce que chaque commande doit rendre, il note ce
// qu'on lui a demande. Aucun depot, aucun reseau -- meme motif que le faux
// `chercher` de test/droits-veille.test.js.
function faireGit(reponses) {
  const vues = [];
  const executer = async (args) => {
    vues.push(args.join(' '));
    for (const [motif, reponse] of reponses) {
      if (args.join(' ').startsWith(motif)) return reponse;
    }
    return { ok: true, sortie: '', erreur: '' };
  };
  executer.vues = vues;
  return executer;
}

const OK = (sortie = '') => ({ ok: true, sortie, erreur: '' });
const KO = (erreur, code) => ({ ok: false, sortie: '', erreur, code });

test('a jour: zero commit de retard', async () => {
  const git = faireGit([
    ['rev-parse --abbrev-ref @{upstream}', OK('origin/master')],
    ['rev-list --count', OK('0')],
    ['rev-parse --short HEAD', OK('599d242')],
    ['rev-parse --short origin/master', OK('599d242')],
    ['rev-parse --abbrev-ref HEAD', OK('master')],
    ['status --porcelain', OK('')],
  ]);
  const r = await etatDepot({ racine: '/depot', executer: git });
  assert.strictEqual(r.etat, 'a-jour');
  assert.strictEqual(r.retard, 0);
  assert.strictEqual(r.branche, 'master');
  assert.strictEqual(r.propre, true);
});

test('en retard: le compte remonte tel quel', async () => {
  const git = faireGit([
    ['rev-parse --abbrev-ref @{upstream}', OK('origin/master')],
    ['rev-list --count', OK('3')],
    ['rev-parse --short HEAD', OK('599d242')],
    ['rev-parse --short origin/master', OK('a1b2c3d')],
    ['rev-parse --abbrev-ref HEAD', OK('master')],
    ['status --porcelain', OK(' M desktop/main.js')],
  ]);
  const r = await etatDepot({ racine: '/depot', executer: git });
  assert.strictEqual(r.etat, 'en-retard');
  assert.strictEqual(r.retard, 3);
  assert.strictEqual(r.locale, '599d242');
  assert.strictEqual(r.distante, 'a1b2c3d');
  assert.strictEqual(r.propre, false);
});

test('pas un depot: inconnu, et on ne va pas plus loin', async () => {
  const git = faireGit([['rev-parse --git-dir', KO('not a git repository')]]);
  const r = await etatDepot({ racine: '/ailleurs', executer: git });
  assert.strictEqual(r.etat, 'inconnu');
  assert.match(r.raison, /depot git/);
  assert.ok(!git.vues.some((v) => v.startsWith('fetch')), 'aucun fetch ne doit partir');
});

test('git absent de la machine: dit autre chose que « pas un depot »', async () => {
  const git = faireGit([['rev-parse --git-dir', KO('spawn git ENOENT', 'ENOENT')]]);
  const r = await etatDepot({ racine: '/depot', executer: git });
  assert.strictEqual(r.etat, 'inconnu');
  assert.match(r.raison, /git introuvable/);
});

test('reseau coupe: inconnu, JAMAIS a-jour', async () => {
  const git = faireGit([
    ['fetch', KO('could not resolve host: github.com')],
    ['rev-list --count', OK('0')],
  ]);
  const r = await etatDepot({ racine: '/depot', executer: git });
  assert.strictEqual(r.etat, 'inconnu');
  assert.match(r.raison, /github\.com/);
  assert.ok(!git.vues.some((v) => v.startsWith('rev-list')), 'on ne compte pas sur des refs perimees');
});

test('avance rapide refusee: le message de git remonte', async () => {
  const git = faireGit([
    ['rev-parse HEAD', OK('599d242')],
    ['rev-parse --abbrev-ref @{upstream}', OK('origin/master')],
    ['merge --ff-only', KO('fatal: Not possible to fast-forward, aborting.')],
  ]);
  const r = await mettreAJour({ racine: '/depot', executer: git });
  assert.strictEqual(r.etat, 'refus');
  assert.strictEqual(r.relancable, false);
  assert.match(r.raison, /fast-forward/);
});

test('package.json touche par le pull: on ne relance pas', async () => {
  const git = faireGit([
    ['rev-parse HEAD', OK('599d242')],
    ['rev-parse --abbrev-ref @{upstream}', OK('origin/master')],
    ['merge --ff-only', OK('Updating 599d242..a1b2c3d')],
    ['diff --name-only', OK('package.json\nsrc/superviseur.js')],
  ]);
  const r = await mettreAJour({ racine: '/depot', executer: git });
  assert.strictEqual(r.etat, 'ok');
  assert.strictEqual(r.relancable, false);
  assert.match(r.raison, /npm install/);
});

test('pull propre: relance autorisee', async () => {
  const git = faireGit([
    ['rev-parse HEAD', OK('599d242')],
    ['rev-parse --abbrev-ref @{upstream}', OK('origin/master')],
    ['merge --ff-only', OK('Updating 599d242..a1b2c3d')],
    ['diff --name-only', OK('desktop/index.html\nsrc/hdv/reprix.js')],
  ]);
  const r = await mettreAJour({ racine: '/depot', executer: git });
  assert.strictEqual(r.etat, 'ok');
  assert.strictEqual(r.relancable, true);
  assert.strictEqual(r.raison, null);
});

test('branche locale sans amont: on se compare a la branche par defaut', async () => {
  const git = faireGit([
    ['rev-parse --abbrev-ref @{upstream}', KO('no upstream configured')],
    ['rev-parse --abbrev-ref origin/HEAD', OK('origin/master')],
    ['rev-list --count HEAD..origin/master', OK('2')],
    ['rev-parse --short HEAD', OK('3579c2f')],
    ['rev-parse --short origin/master', OK('a1b2c3d')],
    ['rev-parse --abbrev-ref HEAD', OK('feat/maj-git-dev')],
    ['status --porcelain', OK('')],
  ]);
  const r = await etatDepot({ racine: '/depot', executer: git });
  assert.strictEqual(r.etat, 'en-retard');
  assert.strictEqual(r.retard, 2);
  assert.strictEqual(r.reference, 'origin/master');
  assert.strictEqual(r.branche, 'feat/maj-git-dev');
});

test('ni amont ni branche par defaut: inconnu, pas « a jour »', async () => {
  const git = faireGit([
    ['rev-parse --abbrev-ref @{upstream}', KO('no upstream configured')],
    ['rev-parse --abbrev-ref origin/HEAD', KO('unknown revision')],
  ]);
  const r = await etatDepot({ racine: '/depot', executer: git });
  assert.strictEqual(r.etat, 'inconnu');
  assert.match(r.raison, /branche distante/);
});
