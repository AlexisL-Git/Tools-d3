'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { creerClient, appliquerSchema } = require('../lib/db');
const { verifierCle } = require('../lib/amis');
const { lireUrlPaquet } = require('../lib/manifeste');

// Le paquet complet fait 480 Mo: il vit chez un hebergeur de fichiers, pas
// ici. Cette route ne sert donc pas le fichier, elle donne son adresse — et
// seulement a une cle valide. La cle passe par un POST, jamais par l'URL: une
// adresse se retrouve dans un historique, un journal de serveur, un partage
// d'ecran.
async function traiterTelechargement({ cle, sql }) {
  if (!cle) return { statut: 404, corps: null };
  const v = await verifierCle(sql, cle);
  if (!v.ok) return { statut: 404, corps: null };
  const url = await lireUrlPaquet(sql);
  if (!url) return { statut: 404, corps: null };
  return { statut: 200, corps: { url } };
}

module.exports = async (req, res) => {
  try {
    // GET: la page. Elle demande la cle et fait le POST elle-meme.
    if (req.method === 'GET') {
      const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'telecharger.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(html);
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const corps = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const sql = creerClient();
    await appliquerSchema(sql);
    const r = await traiterTelechargement({ cle: corps.cle, sql });
    res.statusCode = r.statut;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(r.corps === null ? '' : JSON.stringify(r.corps));
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end('');
  }
};
module.exports.traiterTelechargement = traiterTelechargement;
