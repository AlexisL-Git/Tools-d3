'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { creerClient, appliquerSchema } = require('../lib/db');
const { listerAmis, creerAmi, basculerAmi, supprimerAmi } = require('../lib/amis');
const { basculerService, ecrireUrlPaquet, lireUrlPaquet, lireManifeste } = require('../lib/manifeste');
const { enregistrerVersion, listerVersions, activerVersion, supprimerVersion } = require('../lib/versions');
const { listerRefus, compterLancements, lancementsDe, purgerLancements } = require('../lib/etat');
const { listerDroits, accorder, retirer } = require('../lib/droits');
const { FONCTIONS, estConnue } = require('../lib/fonctions');

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
    case 'fonctions':
      // La liste que le panneau dessine. Servie plutot que recopiee dans la
      // page: une seule source, et le panneau suit une fonction ajoutee sans
      // qu on touche au HTML.
      return { statut: 200, corps: FONCTIONS };
    case 'droits':
      return { statut: 200, corps: await listerDroits(sql) };
    case 'droit': {
      if (!corps.cle) return { statut: 400, corps: { erreur: 'cle requise' } };
      // Une fonction hors liste ecrirait une ligne que l application ne lit
      // jamais: la case resterait cochee sans rien accorder.
      if (!estConnue(corps.fonction)) return { statut: 400, corps: { erreur: 'fonction inconnue' } };
      if (corps.actif) await accorder(sql, corps.cle, corps.fonction);
      else await retirer(sql, corps.cle, corps.fonction);
      return { statut: 200, corps: { ok: true } };
    }
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
    case 'refus':
      return { statut: 200, corps: await listerRefus(sql) };
    case 'lancements': {
      if (corps.cle) return { statut: 200, corps: await lancementsDe(sql, String(corps.cle)) };
      // La purge est portee par la consultation admin, jamais par le
      // lancement d'un ami: personne ne doit attendre un DELETE pour demarrer.
      await purgerLancements(sql);
      return { statut: 200, corps: await compterLancements(sql, {}) };
    }
    case 'lister-manifeste':
      return { statut: 200, corps: await lireManifeste(sql) };
    case 'supprimer-ami':
      if (!corps.cle) return { statut: 400, corps: { erreur: 'cle requise' } };
      await supprimerAmi(sql, String(corps.cle));
      return { statut: 200, corps: { ok: true } };
    case 'supprimer-version': {
      if (!corps.version) return { statut: 400, corps: { erreur: 'version requise' } };
      // LA VERSION ACTIVE NE SE SUPPRIME PAS: le manifeste la designe par son
      // numero (config.version), et sans ses octets en base /api/paquet rend
      // 404 -- plus aucun ami ne peut installer quoi que ce soit. C'est cette
      // garde-la qui compte; le bouton desactive dans la page n'est qu'un
      // confort, un second admin ou un onglet en retard peuvent quand meme
      // arriver ici.
      const manifeste = await lireManifeste(sql);
      if (manifeste.version === String(corps.version)) {
        return { statut: 409, corps: { erreur: 'version active : active-en une autre avant de la supprimer' } };
      }
      await supprimerVersion(sql, String(corps.version));
      return { statut: 200, corps: { ok: true } };
    }
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
