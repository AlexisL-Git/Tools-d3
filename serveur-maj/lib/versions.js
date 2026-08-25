'use strict';
const crypto = require('node:crypto');
const { ecrireManifeste } = require('./manifeste');

// Vercel coupe un corps de requete a ~4,5 Mo AVANT que la fonction ne soit
// appelee — et ce corps, c'est le base64 envoye par le panneau, environ 33%
// plus gros que les octets qu'il encode. Le plafond utile porte donc sur
// l'archive DECODEE: environ 4,5 / 1,33 = 3,28 Mio, pas 4,5 et pas 4. On se
// cale a 3 Mio (3 145 728 octets, qui donnent un corps base64 d'exactement
// 4 Mio) pour garder de la marge, afin que ce message reste atteignable au
// lieu que Vercel coupe la requete en silence avant que le serveur ne la voie.
const PLAFOND = 3 * 1024 * 1024;

function empreinte(octets) {
  return crypto.createHash('sha256').update(octets).digest('hex');
}

async function enregistrerVersion(sql, { version, archive }) {
  // Coerce une seule fois, tot: tout le reste de la fonction (regex, requetes
  // SQL, valeur rendue) utilise cette meme chaine. Sans ca, un corps forge
  // {"version":["0.2.3"], ...} passe la garde de format (String() d'un
  // tableau a un element rend "0.2.3") mais laisse le tableau brut atteindre
  // les requetes SQL, ou il devient un parametre inatteignable par "activer".
  const v = String(version || '');
  if (!/^\d+\.\d+\.\d+$/.test(v)) {
    return { erreur: 'version attendue au format x.y.z' };
  }
  if (!archive || archive.length === 0) return { erreur: 'archive vide' };
  if (archive.length > PLAFOND) {
    const mo = (archive.length / (1024 * 1024)).toFixed(1);
    return { erreur: `archive trop grosse (${mo} Mo, plafond 3)` };
  }
  // Deux octets: ca ne prouve pas que l'archive est bonne, seulement qu'elle
  // est plausible. La vraie preuve reste le sha256 verifie chez l'ami. Mais
  // ca attrape l'erreur la plus probable: avoir depose le mauvais fichier.
  if (archive[0] !== 0x1f || archive[1] !== 0x8b) {
    return { erreur: "ce fichier n'est pas un .tar.gz" };
  }
  const sha256 = empreinte(archive);
  // INSERT direct, avec ON CONFLICT DO NOTHING: l'unicite de la version est
  // arbitree par postgres en une seule requete, pas par un SELECT-puis-INSERT
  // ou la fenetre entre les deux laisse passer un second televersement de la
  // meme version (violation de cle primaire non attrapee, 500 a corps vide).
  const inserees = await sql`INSERT INTO versions (version, sha256, archive, taille)
            VALUES (${v}, ${sha256}, ${archive}, ${archive.length})
            ON CONFLICT (version) DO NOTHING
            RETURNING version`;
  if (inserees.length) {
    return { version: v, sha256, taille: archive.length, deja: false };
  }
  // Une ligne existait deja: soit televersee plus tot, soit une requete
  // concurrente vient de gagner la course ci-dessus. Meme comparaison
  // qu'avant, sur la ligne reellement en base.
  const existantes = await sql`SELECT sha256 FROM versions WHERE version = ${v}`;
  if (existantes[0].sha256 !== sha256) {
    return { erreur: `${v} existe deja avec une autre empreinte` };
  }
  return { version: v, sha256, taille: archive.length, deja: true };
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
