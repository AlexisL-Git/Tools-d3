'use strict';
const { neon } = require('@neondatabase/serverless');

// Un client par invocation de fonction: le driver serverless de Neon ne
// maintient pas de pool, chaque requete est un appel HTTP autonome.
function creerClient() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL absente');
  return neon(process.env.DATABASE_URL);
}

// Idempotent: sur pour etre appele a chaque demarrage. Deux tables:
//   amis      une ligne par ami, la cle est l'identifiant
//   config    UNE seule ligne (id=1) portant le manifeste courant
async function appliquerSchema(sql) {
  await sql`CREATE TABLE IF NOT EXISTS amis (
    cle TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    actif BOOLEAN NOT NULL DEFAULT true,
    cree_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    derniere_vue TIMESTAMPTZ
  )`;
  await sql`CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    version TEXT,
    sha256 TEXT,
    actif BOOLEAN NOT NULL DEFAULT true,
    message TEXT,
    CHECK (id = 1)
  )`;
  // Ajoutee apres coup: l'URL du paquet complet (480 Mo), qui vit chez un
  // hebergeur de fichiers — Vercel ne sert pas des objets de cette taille.
  await sql`ALTER TABLE config ADD COLUMN IF NOT EXISTS url_paquet TEXT`;
  // Les octets de chaque archive de code (82 Ko mesures). C'est ce qui permet
  // de publier sans redeployer: /api/paquet lit ici, plus sur le disque.
  await sql`CREATE TABLE IF NOT EXISTS versions (
    version    TEXT PRIMARY KEY,
    sha256     TEXT NOT NULL,
    archive    BYTEA NOT NULL,
    taille     INTEGER NOT NULL,
    publiee_le TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  // La derniere version vue par chaque ami. Denormalisation volontaire: le
  // tableau du panneau doit rester une seule requete, sans DISTINCT ON.
  await sql`ALTER TABLE amis ADD COLUMN IF NOT EXISTS version_vue TEXT`;
  // Un refus = une version qu'un ami a ecartee parce qu'elle n'a pas demarre
  // chez lui. La cle primaire (cle, version) fait le dedoublonnage: la file
  // du client renvoie le meme refus tant qu'elle n'a pas eu son 200.
  await sql`CREATE TABLE IF NOT EXISTS refus (
    cle        TEXT NOT NULL,
    version    TEXT,
    journal    TEXT,
    signale_le TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (cle, version)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS lancements (
    id      BIGSERIAL PRIMARY KEY,
    cle     TEXT NOT NULL,
    version TEXT,
    au      TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS lancements_cle_au ON lancements (cle, au DESC)`;
  await sql`INSERT INTO config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
}

module.exports = { creerClient, appliquerSchema };
