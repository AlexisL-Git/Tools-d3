'use strict';
const { creerClient, appliquerSchema } = require('../lib/db');
const { verifierCle } = require('../lib/amis');
const { droitsDe } = require('../lib/droits');

// Logique pure, sans HTTP: c est elle qu on teste.
async function traiterDroits({ cle, sql }) {
  if (!cle) return { statut: 404, corps: null };
  // verifierCle AVANT toute lecture: une cle revoquee ne doit rien apprendre.
  const v = await verifierCle(sql, cle);
  if (!v.ok) return { statut: 404, corps: null };
  return { statut: 200, corps: { droits: await droitsDe(sql, cle) } };
}

module.exports = async (req, res) => {
  try {
    const sql = creerClient();
    await appliquerSchema(sql);
    const cle = req.headers['x-cle'];
    const { statut, corps } = await traiterDroits({ cle, sql });
    res.statusCode = statut;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(corps === null ? '' : JSON.stringify(corps));
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end('');
  }
};
module.exports.traiterDroits = traiterDroits;
