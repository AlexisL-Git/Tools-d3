'use strict';

// Toutes les requetes passent par l'interpolation tag de Neon: les valeurs
// sont parametrees, jamais concatenees. C'est ce qui empeche l'injection.
async function verifierCle(sql, cle) {
  const lignes = await sql`SELECT nom FROM amis WHERE cle = ${cle} AND actif = true`;
  if (lignes.length === 0) return { ok: false };
  await sql`UPDATE amis SET derniere_vue = now() WHERE cle = ${cle}`;
  return { ok: true, nom: lignes[0].nom };
}

async function listerAmis(sql) {
  return sql`SELECT cle, nom, actif, cree_le, derniere_vue FROM amis ORDER BY cree_le`;
}

async function creerAmi(sql, nom, genererCle) {
  const cle = genererCle();
  await sql`INSERT INTO amis (cle, nom) VALUES (${cle}, ${nom})`;
  return { cle, nom };
}

async function basculerAmi(sql, cle, actif) {
  await sql`UPDATE amis SET actif = ${actif} WHERE cle = ${cle}`;
  return { ok: true };
}

module.exports = { verifierCle, listerAmis, creerAmi, basculerAmi };
