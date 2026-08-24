'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { traiterPaquet } = require('../api/paquet');

function fauxSql(reponses) {
  const sql = (c, ...v) => Promise.resolve(reponses.length ? reponses.shift() : []);
  return sql;
}

test('sans cle valide, 404 et le fichier n est jamais lu', async () => {
  let lu = false;
  const r = await traiterPaquet({ cle: 'zzz', sql: fauxSql([[]]), lireFichier: () => { lu = true; } });
  assert.strictEqual(r.statut, 404);
  assert.strictEqual(lu, false);
});

test('cle valide, l archive de la version courante est servie', async () => {
  const sql = fauxSql([[{ nom: 'K' }], [], [{ version: '0.2.0', sha256: 'abc', actif: true, message: null }]]);
  const r = await traiterPaquet({ cle: 'ok', sql, lireFichier: (v) => Buffer.from(`archive-${v}`) });
  assert.strictEqual(r.statut, 200);
  assert.strictEqual(r.corps.toString(), 'archive-0.2.0');
  assert.strictEqual(r.type, 'application/gzip');
});

// Version annoncee mais fichier absent: 404, pas 500. Ne pas exposer une
// erreur serveur pour une incoherence de publication.
test('archive absente, 404', async () => {
  const sql = fauxSql([[{ nom: 'K' }], [], [{ version: '9.9.9', sha256: 'x', actif: true, message: null }]]);
  const r = await traiterPaquet({ cle: 'ok', sql, lireFichier: () => { throw new Error('ENOENT'); } });
  assert.strictEqual(r.statut, 404);
});
