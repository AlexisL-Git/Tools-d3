'use strict';
const { creerClient, appliquerSchema } = require('../lib/db');
const { verifierCle } = require('../lib/amis');
const { enregistrerEtat } = require('../lib/etat');
const { prevenir } = require('../lib/discord');

// Logique pure, sans HTTP: c'est elle qu'on teste.
async function traiterEtat({ cle, corps, sql, prevenirFn = prevenir }) {
  // Normalise corps: les defauts de parametre ne remplacent que undefined, pas null.
  // JSON.parse('null') rend null, et corps.version aurait leve. Explicite.
  const c = corps && typeof corps === 'object' ? corps : {};
  if (!cle) return { statut: 404, corps: null };
  // verifierCle AVANT toute ecriture: une cle revoquee ne doit laisser
  // aucune trace, ni lancement, ni refus.
  const v = await verifierCle(sql, cle);
  if (!v.ok) return { statut: 404, corps: null };
  const r = await enregistrerEtat(sql, { cle, version: c.version, refus: c.refus });
  for (const version of r.nouveaux) {
    // prevenir n'est pas cense lever; on s'en assure ici quand meme, parce
    // qu'un ping rate ne doit jamais devenir un 500 chez l'ami.
    try {
      await prevenirFn(`⚠ ${v.nom} a refuse ${version} — elle n'a pas demarre chez lui`);
    } catch (e) {
      console.error('[etat] ping impossible:', e && e.message ? e.message : e);
    }
  }
  return { statut: 200, corps: { ok: true } };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.statusCode = 404; return res.end(''); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let corps = {};
    try {
      corps = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    } catch (e) {
      // Un corps illisible n'est pas une raison d'empecher un ami de demarrer.
      corps = {};
    }
    const sql = creerClient();
    await appliquerSchema(sql);
    const { statut, corps: sortie } = await traiterEtat({ cle: req.headers['x-cle'], corps, sql });
    res.statusCode = statut;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(sortie === null ? '' : JSON.stringify(sortie));
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end('');
  }
};
module.exports.traiterEtat = traiterEtat;
