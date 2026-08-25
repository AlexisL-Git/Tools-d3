'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { creerClient, appliquerSchema } = require('../lib/db');
const { verifierCle } = require('../lib/amis');
const { lireManifeste } = require('../lib/manifeste');
const { lireArchive: lireArchiveEnBase } = require('../lib/versions');

async function traiterPaquet({ cle, sql, lireArchive }) {
  if (!cle) return { statut: 404, corps: null };
  const v = await verifierCle(sql, cle);
  if (!v.ok) return { statut: 404, corps: null };
  const manifeste = await lireManifeste(sql);
  if (!manifeste.version) return { statut: 404, corps: null };
  try {
    const corps = await lireArchive(manifeste.version);
    if (!corps) return { statut: 404, corps: null };
    return { statut: 200, corps, type: 'application/gzip' };
  } catch (e) {
    return { statut: 404, corps: null };
  }
}

module.exports = async (req, res) => {
  try {
    const sql = creerClient();
    await appliquerSchema(sql);
    const cle = req.headers['x-cle'];
    const lireArchive = async (version) => {
      const octets = await lireArchiveEnBase(sql, version);
      if (octets) return octets;
      // REPLI TEMPORAIRE — le temps que 0.2.2 et 0.2.3 soient televersees.
      // Retire par la tache 6 du plan, avec includeFiles et le dossier paquets/.
      return fs.readFileSync(path.join(__dirname, '..', 'paquets', `${version}.tar.gz`));
    };
    const { statut, corps, type } = await traiterPaquet({ cle, sql, lireArchive });
    res.statusCode = statut;
    if (corps === null) return res.end('');
    res.setHeader('Content-Type', type);
    res.end(corps);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end('');
  }
};
module.exports.traiterPaquet = traiterPaquet;
