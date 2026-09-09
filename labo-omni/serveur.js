// Petit serveur de maquettes. Aucune dependance:
//   node serveur.js          -> http://localhost:8731
//   node serveur.js 8740     -> sur le port de ton choix
//
// IL INTERDIT LE CACHE, expres. Sans ca le navigateur garde l ancienne
// version de la page en memoire et on croit que les modifications ne sont
// pas passees -- exactement ce qui est arrive le 08/09.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8731;
const RACINE = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const fichier = path.join(RACINE, rel);
  if (!fichier.startsWith(RACINE)) { res.writeHead(403).end('non'); return; }
  fs.readFile(fichier, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('pas trouve: ' + rel);
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(fichier)] || 'application/octet-stream',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'pragma': 'no-cache',
      'expires': '0',
    });
    res.end(data);
  });
}).listen(PORT, () => console.log('Maquettes OMNI  ->  http://localhost:' + PORT));
