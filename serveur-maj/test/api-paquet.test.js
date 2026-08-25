'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { traiterPaquet } = require('../api/paquet');

function fauxSql(reponses) {
  const sql = (c, ...v) => Promise.resolve(reponses.length ? reponses.shift() : []);
  return sql;
}

test('sans cle valide, 404 et l archive n est jamais lue', async () => {
  let lu = false;
  const r = await traiterPaquet({ cle: 'zzz', sql: fauxSql([[]]), lireArchive: async () => { lu = true; } });
  assert.strictEqual(r.statut, 404);
  assert.strictEqual(lu, false);
});

test('cle valide, l archive de la version courante est servie', async () => {
  const sql = fauxSql([[{ nom: 'K' }], [], [{ version: '0.2.0', sha256: 'abc', actif: true, message: null }]]);
  const r = await traiterPaquet({ cle: 'ok', sql, lireArchive: async (v) => Buffer.from(`archive-${v}`) });
  assert.strictEqual(r.statut, 200);
  assert.strictEqual(r.corps.toString(), 'archive-0.2.0');
  assert.strictEqual(r.type, 'application/gzip');
});

// Version annoncee mais archive introuvable: 404, pas 500. Ne pas exposer une
// erreur serveur pour une incoherence de publication.
test('archive absente (exception), 404', async () => {
  const sql = fauxSql([[{ nom: 'K' }], [], [{ version: '9.9.9', sha256: 'x', actif: true, message: null }]]);
  const r = await traiterPaquet({ cle: 'ok', sql, lireArchive: async () => { throw new Error('ENOENT'); } });
  assert.strictEqual(r.statut, 404);
});

// La base rend null quand la ligne n'existe pas: ce n'est pas une exception,
// et ca doit quand meme faire 404 plutot que servir un corps vide.
test('archive absente (null), 404', async () => {
  const sql = fauxSql([[{ nom: 'K' }], [], [{ version: '9.9.9', sha256: 'x', actif: true, message: null }]]);
  const r = await traiterPaquet({ cle: 'ok', sql, lireArchive: async () => null });
  assert.strictEqual(r.statut, 404);
});

test('aucune version publiee, 404', async () => {
  const sql = fauxSql([[{ nom: 'K' }], [], [{ version: null, sha256: null, actif: true, message: null }]]);
  const r = await traiterPaquet({ cle: 'ok', sql, lireArchive: async () => Buffer.from('x') });
  assert.strictEqual(r.statut, 404);
});

// Verifier que la cle est validee AVANT le manifeste.
// Si l'ordre etait inverse, lireManifeste consommerait réponse 1 (version valide),
// verifierCle consommerait réponses 2 et 3 (clé acceptée), et lireArchive serait appelée.
// Donc l'ordre inverse ferait échouer ce test (lu == true).
test('verifierCle avant lireManifeste: archive jamais lue meme avec version', async () => {
  let lu = false;
  // Reponses configurees pour l'ordre:
  // Bon ordre (verifierCle d'abord):
  //   1: verifierCle SELECT (accepte car réponse non-vide)
  //   2: lireManifeste (pas de 'version', donc version null) -> 404
  // Mauvais ordre (lireManifeste d'abord):
  //   1: lireManifeste (version: '0.2.0') -> continue
  //   2: verifierCle SELECT (accepte car réponse non-vide) -> continue
  //   3: verifierCle UPDATE -> continue
  //   4: lireArchive appelée -> lu = true -> TEST ÉCHOUE
  const sql = fauxSql([
    [{ version: '0.2.0', sha256: 'abc', actif: true, message: null }],
    [{ nom: 'K' }],
    []
  ]);
  const r = await traiterPaquet({
    cle: 'ok',
    sql,
    lireArchive: async () => { lu = true; return Buffer.from('x'); }
  });
  assert.strictEqual(r.statut, 404);
  assert.strictEqual(lu, false);
});
