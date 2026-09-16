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
const { construire: construireTableauArchi } = require('../src/pda-archi/tableau');

// Node met les modules en cache: sans cette invalidation, enregistrer
// faux-etat.js rechargerait l'onglet pour y afficher l'etat d'avant. Le
// veilleur se declencherait, et le banc mentirait sur lui-meme.
function chargerFauxEtat() {
  delete require.cache[require.resolve('./faux-etat')];
  return require('./faux-etat');
}

const RACINE = path.join(__dirname, '..', 'desktop');
const SHIM = path.join(__dirname, 'faux-app.js');
const CADRE = path.join(__dirname, 'banc-cadre.html');
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

// LE REGROUPEMENT N'EST PAS UN LUXE: fs.watch emet souvent deux evenements
// pour un seul enregistrement d'editeur, et le second rechargement d'onglet
// arriverait pendant le premier.
function creerDiffuseur(options) {
  const delaiMs = (options && options.delaiMs) || 100;
  const abonnes = new Set();
  let minuterie = null;

  return {
    abonner(res) {
      abonnes.add(res);
      res.on('close', () => abonnes.delete(res));
    },
    signaler() {
      if (minuterie !== null) return;
      minuterie = setTimeout(() => {
        minuterie = null;
        for (const res of abonnes) res.write('data: recharge\n\n');
      }, delaiMs);
      // Une minuterie en vol ne doit pas retenir le process au moment de
      // fermer le serveur.
      if (typeof minuterie.unref === 'function') minuterie.unref();
    },
    nombreAbonnes: () => abonnes.size,
  };
}

function creerServeur() {
  const diffuseur = creerDiffuseur({ delaiMs: 100 });
  // Tout ce qui change pendant une seance de mise en page, et non plus le
  // seul index.html: la refonte repartit la page entre skin/*.css et
  // vues/*.js, et surveiller un seul fichier laisserait le banc muet sur
  // les deux tiers du travail. Un watch recursif couvre aussi les dossiers
  // qui n existent pas encore.
  for (const cible of [RACINE, path.join(__dirname, 'faux-etat.js')]) {
    try {
      const veilleur = cible === RACINE
        ? fs.watch(cible, { recursive: true }, () => diffuseur.signaler())
        : fs.watch(cible, () => diffuseur.signaler());
      veilleur.unref();
    } catch (e) {
      console.warn(`[banc] surveillance impossible : ${cible}`);
    }
  }

  return http.createServer((req, res) => {
    let chemin;
    try {
      // Lire le req.url brut au lieu de new URL().pathname qui normalise les
      // segments .., y compris leur forme encodee %2e%2e. Si on passait par
      // new URL, la garde 403 ci-dessous serait du code mort: les tentatives
      // de traversee seraient deja resolues avant qu'on puisse les refuser.
      const urlBrute = req.url.split('?')[0];
      chemin = decodeURIComponent(urlBrute);
    } catch (e) {
      return repondre(res, 400, 'text/plain; charset=utf-8', 'chemin illisible');
    }

    // Verifie moi-meme: GET /%00 fait tomber le process. fs.readFile leve
    // ERR_INVALID_ARG_VALUE de facon SYNCHRONE sur un chemin contenant un
    // octet NUL -- avant meme d'atteindre son callback -- donc la seule
    // facon fiable de s'en proteger est de refuser ce chemin ici, avant
    // qu'aucune des routes ci-dessous ne le touche.
    if (chemin.indexOf('\0') !== -1) {
      return repondre(res, 400, 'text/plain; charset=utf-8', 'chemin illisible');
    }

    // Le corps entier est protege: un banc qui meurt en silence (reveal:
    // silent dans la tache VS Code laisse un Simple Browser blanc, sans un
    // mot) est pire qu'un banc qui rend une erreur visible.
    try {
      // LA RACINE SERT LE CADRE, ET PAS LA PAGE. Le cadre charge /index.html
      // dans une iframe de 1097x720: un onglet Simple Browser fait la largeur
      // du panneau, et la page d'OMNI y arrivait etiree sur une mise en page
      // qui n'existe sur l'ecran de personne. Le pourquoi du detour par une
      // iframe est ecrit en tete de outils/banc-cadre.html.
      //
      // /index.html RESTE LA PAGE NUE, sans cadre: c'est la meme adresse
      // qu'avant, et c'est par la qu'on regarde la page seule quand on
      // soupconne le cadre.
      if (chemin === '/') return servirFichier(res, CADRE);

      if (chemin === '/index.html') {
        // chargerFauxEtat() (et fabriquerEtat()) sont appeles ICI, avant
        // fs.readFile, et non dans son callback: un require() qui leve a
        // l'interieur d'un callback fs n'est plus rattrapable par le try qui
        // entoure ce gestionnaire -- il devient une uncaughtException et le
        // banc meurt EN SILENCE (reveal: silent dans la tache VS Code),
        // precisement au moment ou l'on modifie faux-etat.js. Ici l'appel
        // reste dans la portee synchrone du try englobant, qui le rattrape
        // et rend 500 au lieu de faire tomber le process.
        const etat = chargerFauxEtat().fabriquerEtat();
        return fs.readFile(path.join(RACINE, 'index.html'), 'utf8', (err, html) => {
          if (err) return repondre(res, 500, 'text/plain; charset=utf-8', 'index.html illisible');
          // Meme raison que ci-dessus: le try englobant ne couvre pas ce
          // callback. On protege ici, localement, injecter() dont
          // JSON.stringify peut lever de facon synchrone (reference
          // circulaire, BigInt) si un faux etat mal forme s'y glisse.
          try {
            return repondre(res, 200, TYPES['.html'], injecter(html, etat));
          } catch (e) {
            console.error(`[banc] erreur pendant l injection sur ${chemin} :`, e);
            return repondre(res, 500, 'text/plain; charset=utf-8', 'erreur interne');
          }
        });
      }

      if (chemin === '/faux-app.js') return servirFichier(res, SHIM);

      if (chemin === '/faux/rechargement') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        res.write('\n');
        return diffuseur.abonner(res);
      }

      if (chemin === '/faux/tableau-archi') {
        // `chemin` vient de req.url coupe au premier `?`: il ne contient plus
        // la chaine de requete. On relit req.url une seconde fois, via
        // new URL().searchParams cette fois, pour le seul parametre `quoi` --
        // sans risque ici puisqu'on ne s'en sert jamais comme chemin de
        // fichier, la normalisation de new URL n'a donc rien a exploiter.
        const quoi = new URL(req.url, 'http://127.0.0.1').searchParams.get('quoi');
        const table = construireTableauArchi({
          quoi: typeof quoi === 'string' && quoi ? quoi : 'archi',
          comptes: chargerFauxEtat().comptesArchi(),
        });
        return repondre(res, 200, TYPES['.json'], JSON.stringify(table));
      }

      if (chemin === '/faux/devlog') return servirFichier(res, path.join(RACINE, 'devlog.json'));

      const resolu = path.resolve(RACINE, '.' + chemin);
      if (resolu !== RACINE && !resolu.startsWith(RACINE + path.sep)) {
        return repondre(res, 403, 'text/plain; charset=utf-8', 'hors du dossier');
      }
      return servirFichier(res, resolu);
    } catch (e) {
      console.error(`[banc] erreur pendant la requete ${chemin} :`, e);
      return repondre(res, 500, 'text/plain; charset=utf-8', 'erreur interne');
    }
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

module.exports = { creerServeur, injecter, creerDiffuseur, PORT_DEFAUT };
