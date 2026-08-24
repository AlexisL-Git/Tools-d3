'use strict';

async function lireManifeste(sql) {
  const lignes = await sql`SELECT version, sha256, actif, message FROM config WHERE id = 1`;
  if (lignes.length === 0) return { version: null, sha256: null, actif: false, message: null };
  return lignes[0];
}

async function ecrireManifeste(sql, { version, sha256 }) {
  await sql`UPDATE config SET version = ${version}, sha256 = ${sha256} WHERE id = 1`;
}

async function basculerService(sql, actif, message) {
  await sql`UPDATE config SET actif = ${actif}, message = ${message} WHERE id = 1`;
}

module.exports = { lireManifeste, ecrireManifeste, basculerService };
