'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  enregistrerVersion, listerVersions, lireArchive, activerVersion, PLAFOND,
} = require('../lib/versions');

// Rend les reponses dans l'ordre des appels: le faux sql ne lit pas la requete.
function fauxSql(reponses = []) {
  const appels = [];
  const sql = (c, ...v) => { appels.push(v); return Promise.resolve(reponses.length ? reponses.shift() : []); };
  sql.appels = appels;
  return sql;
}

// Un gzip minimal valide commence par 1f 8b. Le reste n'a pas besoin d'etre
// decompressable: on ne verifie que la plausibilite, jamais le contenu.
function gz(charge = 'x') {
  return Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from(charge)]);
}

test('version mal formee, refus', async () => {
  const r = await enregistrerVersion(fauxSql(), { version: 'zero-deux', archive: gz() });
  assert.strictEqual(r.erreur, 'version attendue au format x.y.z');
});

test('version absente, refus', async () => {
  const r = await enregistrerVersion(fauxSql(), { version: undefined, archive: gz() });
  assert.strictEqual(r.erreur, 'version attendue au format x.y.z');
});

test('archive vide, refus', async () => {
  const r = await enregistrerVersion(fauxSql(), { version: '0.2.3', archive: Buffer.alloc(0) });
  assert.strictEqual(r.erreur, 'archive vide');
});

test('archive absente, refus', async () => {
  const r = await enregistrerVersion(fauxSql(), { version: '0.2.3', archive: null });
  assert.strictEqual(r.erreur, 'archive vide');
});

test('au-dela du plafond, refus qui dit la taille', async () => {
  const trop = Buffer.alloc(PLAFOND + 1);
  trop[0] = 0x1f; trop[1] = 0x8b;
  const r = await enregistrerVersion(fauxSql(), { version: '0.2.3', archive: trop });
  assert.match(r.erreur, /^archive trop grosse \(4\.0 Mo, plafond 4\)$/);
});

test('ce n est pas un gzip, refus', async () => {
  const r = await enregistrerVersion(fauxSql(), { version: '0.2.3', archive: Buffer.from('PKzip') });
  assert.strictEqual(r.erreur, "ce fichier n'est pas un .tar.gz");
});

test('archive valide: le sha256 est calcule par nous, jamais recu', async () => {
  const archive = gz('contenu');
  const attendu = crypto.createHash('sha256').update(archive).digest('hex');
  const sql = fauxSql([[]]);            // aucune ligne existante
  const r = await enregistrerVersion(sql, { version: '0.2.3', archive });
  assert.strictEqual(r.sha256, attendu);
  assert.strictEqual(r.version, '0.2.3');
  assert.strictEqual(r.taille, archive.length);
  assert.strictEqual(r.deja, false);
});

test('meme version, memes octets: accepte sans reinserer', async () => {
  const archive = gz('contenu');
  const sha = crypto.createHash('sha256').update(archive).digest('hex');
  const sql = fauxSql([[{ sha256: sha }]]);
  const r = await enregistrerVersion(sql, { version: '0.2.3', archive });
  assert.strictEqual(r.deja, true);
  assert.strictEqual(r.sha256, sha);
  assert.strictEqual(sql.appels.length, 1, 'aucune insertion ne doit suivre le SELECT');
});

// Republier un contenu different sous un numero deja distribue est ce qui
// casse un parc en silence: les clients qui l'ont deja ne retelechargent pas.
test('meme version, octets differents: refus', async () => {
  const sql = fauxSql([[{ sha256: 'a'.repeat(64) }]]);
  const r = await enregistrerVersion(sql, { version: '0.2.3', archive: gz('autre') });
  assert.strictEqual(r.erreur, '0.2.3 existe deja avec une autre empreinte');
});

test('listerVersions rend les lignes de la base', async () => {
  const lignes = [{ version: '0.2.3', sha256: 'a', taille: 82, publiee_le: 'hier' }];
  assert.deepStrictEqual(await listerVersions(fauxSql([lignes])), lignes);
});

test('lireArchive rend les octets, ou null', async () => {
  const octets = gz('z');
  assert.deepStrictEqual(await lireArchive(fauxSql([[{ archive: octets }]]), '0.2.3'), octets);
  assert.strictEqual(await lireArchive(fauxSql([[]]), '9.9.9'), null);
});

test('activer une version inconnue, refus', async () => {
  const r = await activerVersion(fauxSql([[]]), '9.9.9');
  assert.strictEqual(r.erreur, 'version inconnue — televerse-la d abord');
});

// L'INVARIANT du chantier: l'empreinte ecrite dans config est celle de la
// ligne stockee, jamais une valeur fournie de l'exterieur.
test('activer recopie l empreinte depuis la ligne stockee', async () => {
  const archive = gz('contenu');
  const sha = crypto.createHash('sha256').update(archive).digest('hex');
  const sql = fauxSql([[{ version: '0.2.3', sha256: sha }], []]);
  const r = await activerVersion(sql, '0.2.3');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sha256, sha);
  // Le 2e appel est l'UPDATE de config. Ordre des valeurs impose par
  // ecrireManifeste: `SET version = ${version}, sha256 = ${sha256}`.
  assert.deepStrictEqual(sql.appels[1], ['0.2.3', sha]);
});
