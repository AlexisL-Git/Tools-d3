'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { creerServeur, injecter } = require('../outils/interface-locale');

let serveur;
let base;

before(async () => {
  serveur = creerServeur();
  await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${serveur.address().port}`;
});

after(async () => {
  // Le flux d'evenements de la tache 5 tient une connexion ouverte: sans
  // closeAllConnections, close() attend indefiniment et la suite se fige.
  if (typeof serveur.closeAllConnections === 'function') serveur.closeAllConnections();
  await new Promise((ok) => serveur.close(ok));
});

// L'injection se fait en memoire. desktop/index.html n'est JAMAIS reecrit:
// c'est la regle qui rend le banc sans danger pour le code de production.
test('l injection precede le premier script de la page', () => {
  const html = '<html><head><style>a{}</style></head><body><script>vrai()</script></body></html>';
  const sorti = injecter(html, { version: 'dev' });
  assert.ok(sorti.indexOf('/faux-app.js') < sorti.indexOf('vrai()'), 'injecte apres le script de la page');
  assert.ok(sorti.includes('__FAUX_ETAT__'));
});

// Un </script> dans les donnees fermerait la balise et casserait la page en
// silence. On echappe le chevron ouvrant, comme partout ailleurs.
test('l injection echappe les chevrons de l etat', () => {
  const sorti = injecter('<script>x</script>', { piege: '</script><script>alert(1)</script>' });
  assert.ok(!sorti.includes('</script><script>alert(1)'), 'chevron non echappe');
  assert.ok(sorti.includes('\\u003c'));
});

test('la racine sert index.html avec l injection', async () => {
  const r = await fetch(`${base}/`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const html = await r.text();
  assert.ok(html.includes('/faux-app.js'), 'injection absente');
  assert.ok(html.includes('__FAUX_ETAT__'), 'etat absent');
});

// L'etat injecte doit etre du JSON relisable: s'il ne l'est pas, la page
// n'affiche rien du tout et l'erreur n'apparait que dans la console.
test('l etat injecte se relit en JSON', async () => {
  const html = await (await fetch(`${base}/`)).text();
  const m = html.match(/window\.__FAUX_ETAT__ = (\{.*?\});<\/script>/s);
  assert.ok(m, 'etat introuvable dans la page');
  const etat = JSON.parse(m[1].replace(/\\u003c/g, '<'));
  assert.strictEqual(etat.version, 'dev');
  assert.ok(etat.lignes.length >= 6);
});

test('le shim est servi en javascript', async () => {
  const r = await fetch(`${base}/faux-app.js`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.ok((await r.text()).includes('creerFauxApp'));
});

test('les polices et le son sont servis avec leur type', async () => {
  const police = await fetch(`${base}/polices/karla.woff2`);
  assert.strictEqual(police.status, 200);
  assert.strictEqual(police.headers.get('content-type'), 'font/woff2');
  const son = await fetch(`${base}/sons/ping.ogg`);
  assert.strictEqual(son.status, 200);
  assert.strictEqual(son.headers.get('content-type'), 'audio/ogg');
});

// Le serveur n'ecoute que sur 127.0.0.1, mais la regle ne coute rien et evite
// d'avoir a y revenir le jour ou quelqu'un le publie « juste pour essayer ».
test('un chemin qui sort de desktop est refuse', async () => {
  const r = await fetch(`${base}/%2e%2e/package.json`);
  assert.strictEqual(r.status, 403);
});

test('un fichier absent rend 404', async () => {
  assert.strictEqual((await fetch(`${base}/rien-du-tout.css`)).status, 404);
});
