'use strict';
const { creerClient, appliquerSchema } = require('../lib/db');
const { verifierCle } = require('../lib/amis');
const { lireManifeste } = require('../lib/manifeste');

// Logique pure, sans HTTP: c'est elle qu'on teste.
async function traiterManifeste({ cle, sql }) {
  if (!cle) return { statut: 404, corps: null };
  const v = await verifierCle(sql, cle);
  if (!v.ok) return { statut: 404, corps: null };
  const manifeste = await lireManifeste(sql);
  return { statut: 200, corps: manifeste };
}

module.exports = async (req, res) => {
  try {
    const sql = creerClient();
    await appliquerSchema(sql);
    const cle = req.headers['x-cle'];
    const { statut, corps } = await traiterManifeste({ cle, sql });
    res.statusCode = statut;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(corps === null ? '' : JSON.stringify(corps));
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end('');
  }
};
module.exports.traiterManifeste = traiterManifeste;
