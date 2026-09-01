'use strict';

// Toutes les requetes passent par l interpolation tag de Neon: les valeurs
// sont parametrees, jamais concatenees.

async function droitsDe(sql, cle) {
  const lignes = await sql`SELECT fonction FROM droits WHERE cle = ${cle}`;
  return lignes.map((l) => l.fonction);
}

async function listerDroits(sql) {
  return sql`SELECT cle, fonction FROM droits ORDER BY cle, fonction`;
}

async function accorder(sql, cle, fonction) {
  // ON CONFLICT DO NOTHING: cocher deux fois n est pas une erreur.
  await sql`INSERT INTO droits (cle, fonction) VALUES (${cle}, ${fonction})
            ON CONFLICT (cle, fonction) DO NOTHING`;
  return { ok: true };
}

async function retirer(sql, cle, fonction) {
  await sql`DELETE FROM droits WHERE cle = ${cle} AND fonction = ${fonction}`;
  return { ok: true };
}

module.exports = { droitsDe, listerDroits, accorder, retirer };
