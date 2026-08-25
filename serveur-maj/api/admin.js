'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { creerClient, appliquerSchema } = require('../lib/db');
const { listerAmis, creerAmi, basculerAmi } = require('../lib/amis');
const { basculerService, ecrireUrlPaquet, lireUrlPaquet, lireManifeste } = require('../lib/manifeste');
const { enregistrerVersion, listerVersions, activerVersion } = require('../lib/versions');

// Comparaison a temps constant: une comparaison ordinaire revele la longueur
// et les prefixes du secret par le temps de reponse.
function memeSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Le champ Value du tableau de bord Vercel est une zone de texte multiligne:
// une valeur collee y arrive facilement avec un retour a la ligne ou une
// espace en trop, et la comparaison echouait alors sans rien dire. On coupe
// les blancs de bordure des deux cotes; un mot de passe qui commence ou finit
// par une espace n'est de toute facon pas saisissable de facon fiable.
function normaliser(x) {
  return typeof x === 'string' ? x.trim() : x;
}

async function traiterAdmin({ motDePasse, action, corps = {}, sql, genererCle, motDePasseAttendu }) {
  if (!memeSecret(normaliser(motDePasse), normaliser(motDePasseAttendu))) return { statut: 404, corps: null };
  const gen = genererCle || (() => crypto.randomBytes(24).toString('hex'));
  switch (action) {
    case 'lister':
      return { statut: 200, corps: await listerAmis(sql) };
    case 'creer':
      if (!corps.nom) return { statut: 400, corps: { erreur: 'nom requis' } };
      return { statut: 200, corps: await creerAmi(sql, corps.nom, gen) };
    case 'basculer':
      if (!corps.cle) return { statut: 400, corps: { erreur: 'cle requise' } };
      await basculerAmi(sql, corps.cle, Boolean(corps.actif));
      return { statut: 200, corps: { ok: true } };
    case 'paquet': {
      // L'adresse du paquet complet, chez l'hebergeur de fichiers choisi.
      if (corps.url === undefined) return { statut: 200, corps: { url: await lireUrlPaquet(sql) } };
      const url = String(corps.url).trim();
      if (url && !/^https:\/\//i.test(url)) {
        return { statut: 400, corps: { erreur: 'une adresse https est attendue' } };
      }
      await ecrireUrlPaquet(sql, url || null);
      return { statut: 200, corps: { ok: true, url: url || null } };
    }
    case 'service':
      await basculerService(sql, Boolean(corps.actif), corps.message || null);
      return { statut: 200, corps: { ok: true } };
    case 'versions':
      return { statut: 200, corps: await listerVersions(sql) };
    case 'televerser': {
      // Les octets arrivent en base64 dans le JSON: un seul chemin de requete
      // dans le panneau, et 82 Ko qui en font 110 — negligeable.
      const archive = corps.archive ? Buffer.from(String(corps.archive), 'base64') : null;
      const r = await enregistrerVersion(sql, { version: corps.version, archive });
      return r.erreur ? { statut: 400, corps: { erreur: r.erreur } } : { statut: 200, corps: r };
    }
    case 'activer': {
      const r = await activerVersion(sql, String(corps.version || ''));
      return r.erreur ? { statut: 400, corps: { erreur: r.erreur } } : { statut: 200, corps: r };
    }
    case 'lister-manifeste':
      return { statut: 200, corps: await lireManifeste(sql) };
    default:
      return { statut: 400, corps: { erreur: 'action inconnue' } };
  }
}

module.exports = async (req, res) => {
  try {
    const motDePasse = req.headers['x-admin'];
    const attendu = process.env.ADMIN_MDP;
    // GET sans en-tete admin ET sans action: on sert la page. Elle demandera
    // le mot de passe et le mettra dans x-admin pour toutes ses requetes.
    if (req.method === 'GET' && !req.headers['x-admin']) {
      const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'admin.html'), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(html);
    }
    let corps = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      corps = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    }
    const action = (req.query && req.query.action) || corps.action;
    const sql = creerClient();
    await appliquerSchema(sql);
    const r = await traiterAdmin({ motDePasse, action, corps, sql, motDePasseAttendu: attendu });
    res.statusCode = r.statut;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(r.corps === null ? '' : JSON.stringify(r.corps));
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end('');
  }
};
module.exports.traiterAdmin = traiterAdmin;
