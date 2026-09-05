'use strict';
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

// Fabrique src/hdv/objets.json depuis DofusDB: le nom francais de chaque objet.
//
//   node outils/faire-objets.js
//
// IL NE TOURNE JAMAIS EN PRODUCTION, comme faire-archimonstres.js dont il est
// le frere. OMNI ne demande rien a personne pour nommer un objet: il lit un
// fichier fige dans le depot.
//
// POURQUOI IL EXISTE. Aucune trame ne porte de nom d'objet: `ivi` ne donne que
// des prix, `kbt` une categorie, et le client Dofus lit ses noms dans ses
// propres fichiers de langue. Le tableau des lots ecartes affichait donc des
// gids nus — « gid 13731, six lots a 7000001 » — et un gid ne se relit pas.
//
// LA TABLE EST COMPLETE, ET C'EST UN CHOIX. On pourrait n'y garder que les
// ressources, seule marchandise que l'hotel de vente ressources accepte, et le
// fichier tomberait de 580 Ko a une centaine. Mais le tri de stock.js se fait
// sur les LIGNES D'EFFETS, pas sur la categorie: ce qui arrive dans les lots
// n'est pas « une ressource » au sens du jeu, c'est « un objet sans effets ».
// Une table restreinte a une categorie afficherait un gid nu le jour ou les
// deux definitions divergent, c'est-a-dire precisement le jour ou on regarde.
const RACINE = 'https://api.dofusdb.fr';

// L'API plafonne a 50 par appel — mesure du 05/09: `$limit=100` en rend 50
// quand meme, sans le dire. Elle annonce en revanche le `total`, et `$skip`
// tient jusqu'au bout: 21 748 objets, soit 435 pages.
const PAGE = 50;

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

// `$select` ne change pas le nombre d'appels, il change leur poids: une entree
// complete porte ses effets, ses recettes et ses monstres, soit des dizaines de
// fois ce qu'on garde.
async function tout() {
  const out = [];
  let total = null;
  while (total === null || out.length < total) {
    const j = await lireJson(
      `${RACINE}/items?$select[]=id&$select[]=name.fr&$limit=${PAGE}&$skip=${out.length}`,
    );
    total = j.total;
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
  const objets = await tout();
  console.log(`objets bruts : ${objets.length}`);

  // UN OBJET SANS NOM EST LAISSE DEHORS, PAS ECRIT VIDE. La table sert a
  // nommer; une entree vide ferait afficher du blanc la ou le gid, lui, se
  // recopie dans le jeu. `nomDe` rend null pour un gid absent, et le tableau
  // retombe sur le numero — exactement ce qu'il montrait avant cette table.
  const table = {};
  let sansNom = 0;
  for (const o of objets.sort((a, b) => a.id - b.id)) {
    const nom = (o.name && o.name.fr) || '';
    if (nom === '') { sansNom += 1; continue; }
    table[o.id] = nom;
  }
  console.log(`sans nom, ecartes : ${sansNom}`);

  ecrire(table);
}

// Une ligne par entree: 21 748 lignes se relisent dans un diff, un objet JSON
// sur une seule ligne ne se relit pas du tout.
function ecrire(table) {
  const cible = path.join(__dirname, '..', 'src', 'hdv', 'objets.json');
  const lignes = Object.keys(table)
    .map((gid) => `  ${JSON.stringify(gid)}: ${JSON.stringify(table[gid])}`)
    .join(',\n');
  fs.writeFileSync(cible, `{\n${lignes}\n}\n`, 'utf8');
  const ko = Math.round(fs.statSync(cible).size / 1024);
  console.log(`ecrit : ${cible} (${Object.keys(table).length} objets, ${ko} Ko)`);
}

principal().catch((e) => { console.error(e.message); process.exit(1); });
