'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  enregistrerEtat, compterLancements, lancementsDe, listerRefus, purgerLancements,
  MAX_JOURNAL, MAX_REFUS,
} = require('../lib/etat');

// Rend les reponses dans l'ordre des appels: le faux sql ne lit pas la requete.
function fauxSql(reponses = []) {
  const appels = [];
  const sql = (c, ...v) => { appels.push(v); return Promise.resolve(reponses.length ? reponses.shift() : []); };
  sql.appels = appels;
  return sql;
}

test('un lancement sans refus: version_vue ecrite, une ligne de lancement', async () => {
  const sql = fauxSql([[], []]);
  const r = await enregistrerEtat(sql, { cle: 'CLE', version: '0.2.4', refus: [] });
  assert.deepStrictEqual(r, { ok: true, nouveaux: [] });
  assert.strictEqual(sql.appels.length, 2);
  assert.deepStrictEqual(sql.appels[0], ['0.2.4', 'CLE']);   // UPDATE amis
  assert.deepStrictEqual(sql.appels[1], ['CLE', '0.2.4']);   // INSERT lancements
});

test('version invalide: n ecrase pas version_vue, et aucun lancement n est enregistre', async () => {
  const sql = fauxSql([[]]);
  const r = await enregistrerEtat(sql, { cle: 'CLE', version: 'dev; DROP TABLE amis', refus: [] });
  assert.deepStrictEqual(r, { ok: true, nouveaux: [] });
  assert.strictEqual(sql.appels.length, 1);            // UPDATE amis seulement, pas d'INSERT lancements
  assert.deepStrictEqual(sql.appels[0], [null, 'CLE']);
});

test('un signalement sans version (chemin arreter) enregistre quand meme ses refus', async () => {
  // UPDATE amis, puis INSERT refus ... RETURNING: pas d'INSERT lancements
  // puisque version est nulle — mais le refus, lui, ne doit pas se perdre.
  const sql = fauxSql([[], [{ version: '0.2.3' }]]);
  const r = await enregistrerEtat(sql, {
    cle: 'CLE', version: null, refus: [{ version: '0.2.3', journal: 'boum' }],
  });
  assert.deepStrictEqual(r.nouveaux, ['0.2.3']);
  assert.strictEqual(sql.appels.length, 2);
  assert.deepStrictEqual(sql.appels[0], [null, 'CLE']);
  assert.deepStrictEqual(sql.appels[1], ['CLE', '0.2.3', 'boum']);
});

test('un refus insere pour la premiere fois figure dans nouveaux', async () => {
  // 3e appel = INSERT refus ... RETURNING version, qui rend une ligne.
  const sql = fauxSql([[], [], [{ version: '0.2.3' }]]);
  const r = await enregistrerEtat(sql, {
    cle: 'CLE', version: '0.2.4', refus: [{ version: '0.2.3', journal: 'boum' }],
  });
  assert.deepStrictEqual(r.nouveaux, ['0.2.3']);
  assert.deepStrictEqual(sql.appels[2], ['CLE', '0.2.3', 'boum']);
});

test('le meme refus renvoye: aucune insertion, nouveaux vide', async () => {
  const sql = fauxSql([[], [], []]);   // ON CONFLICT DO NOTHING: aucune ligne rendue
  const r = await enregistrerEtat(sql, {
    cle: 'CLE', version: '0.2.4', refus: [{ version: '0.2.3', journal: 'boum' }],
  });
  assert.deepStrictEqual(r.nouveaux, []);
});

test('journal tronque au plafond', async () => {
  const sql = fauxSql([[], [], [{ version: '0.2.3' }]]);
  await enregistrerEtat(sql, {
    cle: 'CLE', version: '0.2.4', refus: [{ version: '0.2.3', journal: 'x'.repeat(MAX_JOURNAL + 500) }],
  });
  assert.strictEqual(sql.appels[2][2].length, MAX_JOURNAL);
});

test('journal absent: null, pas undefined', async () => {
  const sql = fauxSql([[], [], [{ version: '0.2.3' }]]);
  await enregistrerEtat(sql, { cle: 'CLE', version: '0.2.4', refus: [{ version: '0.2.3' }] });
  assert.strictEqual(sql.appels[2][2], null);
});

test('au-dela du plafond de refus, le surplus est ignore', async () => {
  const refus = [];
  for (let i = 0; i < MAX_REFUS + 5; i += 1) refus.push({ version: `0.1.${i}` });
  const sql = fauxSql([[], []]);
  await enregistrerEtat(sql, { cle: 'CLE', version: '0.2.4', refus });
  // 2 appels d'entete + MAX_REFUS insertions, pas une de plus.
  assert.strictEqual(sql.appels.length, 2 + MAX_REFUS);
});

test('un refus a version invalide est saute sans faire echouer les autres', async () => {
  const sql = fauxSql([[], [], [{ version: '0.2.3' }]]);
  const r = await enregistrerEtat(sql, {
    cle: 'CLE', version: '0.2.4',
    refus: [{ version: 'boum' }, { version: '0.2.3' }],
  });
  assert.deepStrictEqual(r.nouveaux, ['0.2.3']);
  assert.strictEqual(sql.appels.length, 3);
});

test('refus absent ou non tableau: traite comme vide', async () => {
  const sql = fauxSql([[], []]);
  const r = await enregistrerEtat(sql, { cle: 'CLE', version: '0.2.4', refus: 'boum' });
  assert.deepStrictEqual(r.nouveaux, []);
  assert.strictEqual(sql.appels.length, 2);
});

test('compterLancements passe le nombre de jours en parametre', async () => {
  const sql = fauxSql([[{ cle: 'CLE', n: 3 }]]);
  const r = await compterLancements(sql, { jours: 30 });
  assert.deepStrictEqual(r, [{ cle: 'CLE', n: 3 }]);
  assert.deepStrictEqual(sql.appels[0], [30]);
});

test('lancementsDe borne la limite', async () => {
  const sql = fauxSql([[]]);
  await lancementsDe(sql, 'CLE', 10000);
  assert.deepStrictEqual(sql.appels[0], ['CLE', 100]);
});

test('lancementsDe: limite absente vaut 20', async () => {
  const sql = fauxSql([[]]);
  await lancementsDe(sql, 'CLE');
  assert.deepStrictEqual(sql.appels[0], ['CLE', 20]);
});

test('listerRefus rend les lignes telles quelles', async () => {
  const ligne = { cle: 'CLE', nom: 'Jibb', version: '0.2.3', journal: null, signale_le: 'hier' };
  const sql = fauxSql([[ligne]]);
  assert.deepStrictEqual(await listerRefus(sql), [ligne]);
});

test('purgerLancements rend le nombre de lignes effacees', async () => {
  const sql = fauxSql([[{ id: 1 }, { id: 2 }]]);
  assert.strictEqual(await purgerLancements(sql, 90), 2);
  assert.deepStrictEqual(sql.appels[0], [90]);
});
