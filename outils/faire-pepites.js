'use strict';
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Fabrique src/pepites/taux.json depuis DofusDB: le taux de recyclage en
// pepites, a l'unite, de chaque objet recyclable.
//
//   node outils/faire-pepites.js
//
// IL NE TOURNE JAMAIS EN PRODUCTION, comme faire-objets.js dont il copie
// l'API, la pagination et les raisons.
//
// POURQUOI DOFUSDB ET PAS LE JEU. Le client porte la meme donnee, et elle a
// ete verifiee contre lui le 11/09: 21 776 objets, valeurs identiques au
// 1e-9, zero ecart. Mais la lire demande d'ouvrir un bundle UnityFS, de
// decompresser un bloc LZMA de 16 Mo et de resoudre un registre de references
// managees. C'est un geste de developpement, pas une etape d'outil.
//
// LA TABLE EST RESTREINTE AUX TAUX > 0, contrairement a objets.json qui garde
// tout. Ici la restriction ne cache rien: un objet sans taux n'est pas
// recyclable, il n'a aucune ligne a occuper, et la table tombe de 21 776 a
// 4 049 entrees.
const RACINE = 'https://api.dofusdb.fr';

// L'API plafonne a 50 par appel, meme si on demande plus. Mesure du 05/09,
// recopiee de faire-objets.js.
const PAGE = 50;

// D'ou vient la version du jeu qu'on enregistre. Absente, la table le dit
// plutot que de mentir.
const VERSION = path.join(
  os.homedir(), 'AppData', 'Local', 'Ankama', 'Dofus-dofus3',
  'Dofus_Data', 'StreamingAssets', 'version',
);

function lireJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`${res.statusCode} sur ${url}`));
        return;
      }
      let corps = '';
      res.setEncoding('utf8');
      res.on('data', (m) => { corps += m; });
      res.on('end', () => {
        try { resolve(JSON.parse(corps)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// LE JEU N'EST PAS INTERROGE, SEULEMENT LU. Si l'installation n'est pas la,
// on ecrit null: une table qui pretendrait avoir ete verifiee contre une
// version qu'on n'a pas vue serait pire qu'une table qui l'avoue.
function versionDuJeu() {
  try {
    const m = /Version=([0-9.]+)/.exec(fs.readFileSync(VERSION, 'utf8'));
    return m === null ? null : m[1];
  } catch (e) {
    return null;
  }
}

async function tout() {
  const out = [];
  let total = null;
  while (total === null || out.length < total) {
    const j = await lireJson(
      `${RACINE}/items?$select[]=id&$select[]=recyclingNuggets`
      + `&$limit=${PAGE}&$skip=${out.length}`,
    );
    total = j.total;
    // MEME GARDE QUE faire-objets.js, ET ELLE MANQUAIT ICI. Sans
    // Array.isArray, une reponse dont `data` est absent (une page en erreur,
    // une API qui change de forme) leve un TypeError sur `.length` au lieu de
    // s'arreter proprement -- et sans la verification finale, une page vide
    // en milieu de course sortirait de la boucle EN SILENCE et ecrirait un
    // taux.json tronque, avec pour seul filet le test qui fige 4 049 entrees,
    // qu'on serait tente de « mettre a jour » plutot que d'enqueter.
    if (!Array.isArray(j.data) || j.data.length === 0) break;
    out.push(...j.data);
    if (out.length % 2000 < PAGE) console.log(`  ${out.length} / ${total}`);
  }
  if (total !== null && out.length !== total) {
    throw new Error(`${out.length} objets recus pour ${total} annonces`);
  }
  return out;
}

async function principal() {
  const items = await tout();
  const objets = {};
  for (const it of items) {
    const t = it.recyclingNuggets;
    if (typeof t === 'number' && t > 0) objets[String(it.id)] = t;
  }
  const jeu = versionDuJeu();
  ecrire(jeu, objets);
  console.log(`${items.length} objets parcourus, ${Object.keys(objets).length} recyclables`);
  console.log(jeu === null
    ? 'version du jeu introuvable: taux.json porte jeu=null'
    : `verifie contre le jeu ${jeu}`);
}

// UNE LIGNE PAR ENTREE, COMME faire-objets.js -- ET POUR LA MEME RAISON QU'IL
// DONNE EN COMMENTAIRE: un objet JSON sur une seule ligne ne se relit pas du
// tout. Le jour ou Ankama bouge 22 taux (mesure du 11/09, entre le client
// live et la beta), c'est un diff de 22 lignes qu'on veut voir, pas un octet
// perdu au milieu de 100 Ko. Trie par gid numerique pour que l'ordre ne
// bouge pas d'une regeneration a l'autre.
function ecrire(jeu, objets) {
  const cible = path.join(__dirname, '..', 'src', 'pepites', 'taux.json');
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  const lignes = Object.keys(objets)
    .sort((a, b) => Number(a) - Number(b))
    .map((gid) => `    ${JSON.stringify(gid)}: ${JSON.stringify(objets[gid])}`)
    .join(',\n');
  const corps = `{\n  "jeu": ${JSON.stringify(jeu)},\n  "objets": {\n${lignes}\n  }\n}\n`;
  fs.writeFileSync(cible, corps, 'utf8');
  const ko = Math.round(fs.statSync(cible).size / 1024);
  console.log(`ecrit : ${cible} (${Object.keys(objets).length} objets, ${ko} Ko)`);
}

principal().catch((e) => { console.error(e); process.exit(1); });
