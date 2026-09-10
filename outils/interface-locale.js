'use strict';

// LE BANC D'ESSAI DE L'INTERFACE, SUR http://localhost:8787
// Conception: docs/superpowers/specs/2026-09-10-interface-locale-design.md
//
// Sert desktop/ tel quel et injecte un faux window.app dans la page. Ce n'est
// PAS un mode de fonctionnement d'OMNI: rien du code de production n'est
// modifie pour lui, et desktop/index.html n'est jamais reecrit -- l'injection
// vit en memoire, le temps d'une reponse.
//
// Lance a l'ouverture du projet par .vscode/tasks.json.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { fabriquerEtat } = require('./faux-etat');

const RACINE = path.join(__dirname, '..', 'desktop');
const SHIM = path.join(__dirname, 'faux-app.js');
const PORT_DEFAUT = 8787;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Le chevron ouvrant devient <: un `</script>` glisse dans une chaine de
// l'etat fermerait la balise injectee et la page ne s'afficherait plus, sans
// un mot ailleurs que dans la console.
function serialiser(etat) {
  return JSON.stringify(etat).replace(/</g, '\\u003c');
}

// Le point d'insertion est le PREMIER `<script>` de la page, retrouve par
// recherche et non par numero de ligne: index.html bouge a chaque seance.
function injecter(html, etat) {
  const balises = `<script>window.__FAUX_ETAT__ = ${serialiser(etat)};</script>`
    + '<script src="/faux-app.js"></script>';
  const i = html.indexOf('<script');
  if (i === -1) return html + balises;
  return html.slice(0, i) + balises + html.slice(i);
}

function repondre(res, code, type, corps) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(corps);
}

function servirFichier(res, chemin) {
  fs.readFile(chemin, (err, contenu) => {
    if (err) return repondre(res, 404, 'text/plain; charset=utf-8', 'introuvable');
    const type = TYPES[path.extname(chemin).toLowerCase()] || 'application/octet-stream';
    return repondre(res, 200, type, contenu);
  });
}

function creerServeur() {
  return http.createServer((req, res) => {
    let chemin;
    try {
      chemin = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch (e) {
      return repondre(res, 400, 'text/plain; charset=utf-8', 'chemin illisible');
    }

    if (chemin === '/' || chemin === '/index.html') {
      return fs.readFile(path.join(RACINE, 'index.html'), 'utf8', (err, html) => {
        if (err) return repondre(res, 500, 'text/plain; charset=utf-8', 'index.html illisible');
        return repondre(res, 200, TYPES['.html'], injecter(html, fabriquerEtat()));
      });
    }

    if (chemin === '/faux-app.js') return servirFichier(res, SHIM);

    const resolu = path.resolve(RACINE, '.' + chemin);
    if (resolu !== RACINE && !resolu.startsWith(RACINE + path.sep)) {
      return repondre(res, 403, 'text/plain; charset=utf-8', 'hors du dossier');
    }
    return servirFichier(res, resolu);
  });
}

if (require.main === module) {
  const port = Number(process.env.OMNI_PORT) || PORT_DEFAUT;
  const serveur = creerServeur();
  // Pas de saut silencieux vers un autre port: l'onglet Simple Browser
  // pointerait dans le vide sans qu'on comprenne pourquoi.
  serveur.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`[banc] le port ${port} est deja pris. OMNI_PORT=xxxx pour en changer.`);
      process.exit(1);
    }
    throw e;
  });
  serveur.listen(port, '127.0.0.1', () => {
    console.log(`[banc] interface d'OMNI sur http://localhost:${port}`);
  });
}

module.exports = { creerServeur, injecter, PORT_DEFAUT };
