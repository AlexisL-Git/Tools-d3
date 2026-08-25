'use strict';
const crypto = require('node:crypto');
const { ecrireManifeste } = require('./manifeste');

// Vercel coupe un corps de requete a ~4,5 Mo sans un mot. On refuse avant,
// avec un message, pour que la panne soit lisible le jour ou l'archive grossit.
const PLAFOND = 4 * 1024 * 1024;

function empreinte(octets) {
  return crypto.createHash('sha256').update(octets).digest('hex');
}

async function enregistrerVersion(sql, { version, archive }) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ''))) {
    return { erreur: 'version attendue au format x.y.z' };
  }
  if (!archive || archive.length === 0) return { erreur: 'archive vide' };
  if (archive.length > PLAFOND) {
    const mo = (archive.length / (1024 * 1024)).toFixed(1);
    return { erreur: `archive trop grosse (${mo} Mo, plafond 4)` };
  }
  // Deux octets: ca ne prouve pas que l'archive est bonne, seulement qu'elle
  // est plausible. La vraie preuve reste le sha256 verifie chez l'ami. Mais
  // ca attrape l'erreur la plus probable: avoir depose le mauvais fichier.
  if (archive[0] !== 0x1f || archive[1] !== 0x8b) {
    return { erreur: "ce fichier n'est pas un .tar.gz" };
  }
  const sha256 = empreinte(archive);
  const existantes = await sql`SELECT sha256 FROM versions WHERE version = ${version}`;
  if (existantes.length) {
    if (existantes[0].sha256 !== sha256) {
      return { erreur: `${version} existe deja avec une autre empreinte` };
    }
    return { version, sha256, taille: archive.length, deja: true };
  }
  await sql`INSERT INTO versions (version, sha256, archive, taille)
            VALUES (${version}, ${sha256}, ${archive}, ${archive.length})`;
  return { version, sha256, taille: archive.length, deja: false };
}

async function listerVersions(sql) {
  return sql`SELECT version, sha256, taille, publiee_le FROM versions ORDER BY publiee_le DESC`;
}

async function lireArchive(sql, version) {
  const lignes = await sql`SELECT archive FROM versions WHERE version = ${version}`;
  return lignes.length ? lignes[0].archive : null;
}

async function activerVersion(sql, version) {
  const lignes = await sql`SELECT version, sha256 FROM versions WHERE version = ${version}`;
  if (!lignes.length) return { erreur: 'version inconnue — televerse-la d abord' };
  // L'empreinte vient de la ligne stockee. Aucune valeur exterieure n'entre ici.
  await ecrireManifeste(sql, { version: lignes[0].version, sha256: lignes[0].sha256 });
  return { ok: true, version: lignes[0].version, sha256: lignes[0].sha256 };
}

module.exports = { enregistrerVersion, listerVersions, lireArchive, activerVersion, PLAFOND };
