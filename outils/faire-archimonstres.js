'use strict';
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

// Fabrique src/pda-archi/archimonstres.json depuis DofusDB.
//
//   node outils/faire-archimonstres.js
//
// IL NE TOURNE JAMAIS EN PRODUCTION. C est tout l interet: OMNI ne fait aucun
// appel reseau pour afficher le tableau des archimonstres, il lit un fichier de
// 16 Ko fige dans le depot. Ce script ne sert qu a le regenerer le jour ou le
// jeu en ajoute -- et ce jour-la, le test qui fige le compte a 286 tombera le
// premier.
//
// LE DRAPEAU EXISTE, contrairement a ce qu annoncait la spec de la chasse le
// 03/09. Dans les donnees du jeu, « mini-boss » EST le nom interne de
// l archimonstre: un monstre ordinaire porte un `correspondingMiniBossId` qui
// pointe vers le sien. Les 306 que rend le drapeau sont tous de race 78, tous
// capturables, aucun cache du bestiaire. Aucune liste montee a la main.
//
// MOINS VULKANIA. Vingt des 306 vivent dans l Archipel de Vulkania, une ile
// SAISONNIERE dont les archimonstres ne sont capturables que pendant
// l evenement: les compter ferait vingt lignes definitivement vides onze mois
// sur douze. Signale par Jibef le 04/09.
//
// LA REGLE D EXCLUSION EST LA ZONE, PAS LA PLAGE D IDENTIFIANTS. Les vingt
// portent aujourd hui les identifiants 3178 a 3197, contigus -- mais un
// archimonstre ajoute par Ankama dans cet intervalle casserait un filtre par
// plage sans un mot. La plage ne sert que de controle, dans le test.
const RACINE = 'https://api.dofusdb.fr';
const ZONE_VULKANIA = 50;
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

// L API plafonne a 50 par appel, et l annonce dans `total`. On pagine jusqu a
// l avoir atteint plutot que de deviner le nombre de pages.
async function tout(chemin) {
  const out = [];
  let total = null;
  while (total === null || out.length < total) {
    const j = await lireJson(`${RACINE}/${chemin}&$limit=${PAGE}&$skip=${out.length}`);
    total = j.total;
    if (!Array.isArray(j.data) || j.data.length === 0) break;
    out.push(...j.data);
  }
  if (total !== null && out.length !== total) {
    throw new Error(`${chemin}: ${out.length} recus pour ${total} annonces`);
  }
  return out;
}

async function principal() {
  const sousZones = await tout(`subareas?areaId=${ZONE_VULKANIA}&`);
  const vulkania = new Set(sousZones.map((s) => s.id));
  console.log(`Vulkania : ${vulkania.size} sous-zones`);

  const miniBoss = await tout('monsters?isMiniBoss=true&');
  console.log(`archimonstres bruts : ${miniBoss.length}`);

  const gardes = miniBoss.filter((m) => !(m.subareas || []).some((s) => vulkania.has(s)));
  console.log(`moins Vulkania : ${gardes.length}`);

  // Le niveau est celui du grade 1, le seul qui existe pour un archimonstre.
  const table = gardes
    .map((m) => ({
      id: m.id,
      nom: (m.name && m.name.fr) || '',
      niveau: ((m.grades && m.grades[0]) || {}).level || 0,
    }))
    .sort((a, b) => (a.niveau - b.niveau) || a.nom.localeCompare(b.nom, 'fr') || (a.id - b.id));

  const boiteux = table.filter((a) => a.nom === '' || a.niveau === 0);
  if (boiteux.length > 0) throw new Error(`sans nom ou sans niveau : ${JSON.stringify(boiteux)}`);

  // Une ligne par archimonstre: le fichier se relit dans un diff.
  const lignes = table.map((a) => `  ${JSON.stringify(a)}`).join(',\n');
  const cible = path.join(__dirname, '..', 'src', 'pda-archi', 'archimonstres.json');
  fs.writeFileSync(cible, `[\n${lignes}\n]\n`, 'utf8');
  console.log(`ecrit : ${cible} (${table.length} archimonstres)`);
}

principal().catch((e) => { console.error(e.message); process.exit(1); });
