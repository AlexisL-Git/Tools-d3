'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { creerServeur, injecter } = require('../outils/interface-locale');

let serveur;
let base;

// fetch normalise les segments `..` avant l'envoi: une tentative de traversee
// n'arriverait jamais jusqu'au serveur. Ce client brut envoie le chemin tel quel.
const brut = (chemin) => new Promise((ok, ko) => {
  const req = http.request({ host: '127.0.0.1', port: serveur.address().port, path: chemin }, (r) => {
    let corps = '';
    r.setEncoding('utf8');
    r.on('data', (m) => { corps += m; });
    r.on('end', () => ok({ status: r.statusCode, corps }));
  });
  req.on('error', ko);
  req.end();
});

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

test('/index.html sert la page avec l injection', async () => {
  const r = await fetch(`${base}/index.html`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const html = await r.text();
  assert.ok(html.includes('/faux-app.js'), 'injection absente');
  assert.ok(html.includes('__FAUX_ETAT__'), 'etat absent');
});

// L'etat injecte doit etre du JSON relisable: s'il ne l'est pas, la page
// n'affiche rien du tout et l'erreur n'apparait que dans la console.
test('l etat injecte se relit en JSON', async () => {
  const html = await (await fetch(`${base}/index.html`)).text();
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
  const r1 = await brut('/%2e%2e/package.json');
  assert.strictEqual(r1.status, 403);
  assert.ok(!r1.corps.includes('"name":'), 'fichier du depot ne doit pas etre servi');

  const r2 = await brut('/../package.json');
  assert.strictEqual(r2.status, 403);
  assert.ok(!r2.corps.includes('"name":'), 'fichier du depot ne doit pas etre servi');
});

test('un fichier absent rend 404', async () => {
  assert.strictEqual((await fetch(`${base}/rien-du-tout.css`)).status, 404);
});

// Verifie moi-meme: GET /%00 faisait tomber le processus. fs.readFile leve
// ERR_INVALID_ARG_VALUE de facon SYNCHRONE sur un chemin contenant un octet
// NUL, hors du try/catch qui n'entoure que decodeURIComponent. La seconde
// assertion (une requete SUIVANTE sur / repond toujours 200) est celle qui
// prouve que le serveur a survecu, pas seulement que celle-ci a un code 400.
test('un chemin avec un octet NUL est refuse et le serveur survit', async () => {
  const r1 = await brut('/%00');
  assert.strictEqual(r1.status, 400);

  const r2 = await fetch(`${base}/index.html`);
  assert.strictEqual(r2.status, 200, 'le serveur ne repond plus apres /%00');
});

// Le navigateur ne peut pas charger un module CommonJS: c'est Node qui calcule
// le tableau avec le VRAI src/pda-archi/tableau.js, la page qui l'affiche.
test('le tableau archi est calcule par le vrai module', async () => {
  const r = await fetch(`${base}/faux/tableau-archi?quoi=archi`);
  assert.strictEqual(r.status, 200);
  const table = await r.json();
  assert.ok(table.total > 200, `total suspect : ${table.total}`);
  assert.strictEqual(table.lignes.length, table.total);
  assert.ok(Array.isArray(table.comptes) && table.comptes.length > 0);
  assert.ok(table.comptes.some((c) => c.lu === true), 'aucun inventaire lu');
  assert.ok(table.comptes.some((c) => c.lu === false), 'aucun inventaire non lu');
  assert.ok(table.zones, 'la vue par zones manque');
});

// Meme repli que le handler d'OMNI: une valeur inconnue rend les
// archimonstres, le panneau ne peut pas casser sur une faute de frappe.
test('une collection inconnue retombe sur les archimonstres', async () => {
  const a = await (await fetch(`${base}/faux/tableau-archi?quoi=nimportequoi`)).json();
  const b = await (await fetch(`${base}/faux/tableau-archi?quoi=archi`)).json();
  assert.strictEqual(a.titre, b.titre);
});

// Node met les modules require() en cache: sans invalidation explicite,
// enregistrer outils/faux-etat.js rechargerait l'onglet (le veilleur se
// declenche bien) pour reservir un etat IDENTIQUE -- le banc mentirait sur
// lui-meme. On modifie le vrai fichier sur disque, on verifie que le
// changement apparait dans la reponse, PUIS on le restaure a l'identique
// dans un finally pour que git status reste propre meme si l'assertion rate.
test('la route /index.html relit vraiment faux-etat.js a chaque requete', async () => {
  const cheminFauxEtat = path.join(__dirname, '..', 'outils', 'faux-etat.js');
  const original = fs.readFileSync(cheminFauxEtat, 'utf8');
  const marqueur = "version: 'dev'";
  assert.ok(original.includes(marqueur), 'marqueur introuvable, le test doit etre adapte');
  try {
    const modifie = original.replace(marqueur, "version: 'banc-modifie-par-le-test'");
    fs.writeFileSync(cheminFauxEtat, modifie);
    const html = await (await fetch(`${base}/index.html`)).text();
    assert.ok(html.includes('banc-modifie-par-le-test'), 'la modification de faux-etat.js n a pas ete relue');
  } finally {
    fs.writeFileSync(cheminFauxEtat, original);
  }
});

// Reproduction du defaut: si faux-etat.js est momentanement invalide (faute
// de frappe en cours de frappe, enregistrement pris a mi-chemin), le require
// qui le recharge doit lever DANS la portee du try/catch qui protege deja le
// gestionnaire -- pas dans un callback fs ulterieur ou plus rien ne rattrape
// l exception et le processus meurt en silence (reveal: silent). La deuxieme
// requete sur / est celle qui prouve la survie: sans elle, un simple 500 sur
// la premiere ne distingue pas "protege" de "mort avant de repondre".
test('un faux-etat.js momentanement invalide rend 500 et le serveur survit', async () => {
  const cheminFauxEtat = path.join(__dirname, '..', 'outils', 'faux-etat.js');
  const original = fs.readFileSync(cheminFauxEtat, 'utf8');
  try {
    fs.writeFileSync(cheminFauxEtat, 'const x = ;\n');
    const r1 = await fetch(`${base}/index.html`);
    assert.strictEqual(r1.status, 500, 'le rechargement invalide doit rendre 500, pas casser la connexion');
  } finally {
    fs.writeFileSync(cheminFauxEtat, original);
  }

  const r2 = await fetch(`${base}/index.html`);
  assert.strictEqual(r2.status, 200, 'le serveur ne repond plus apres un faux-etat.js invalide');
});

test('le devlog est servi tel quel', async () => {
  const r = await fetch(`${base}/faux/devlog`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /json/);
  const attendu = require('../desktop/devlog.json');
  assert.deepStrictEqual(await r.json(), attendu);
});

const { creerDiffuseur } = require('../outils/interface-locale');

// fs.watch emet souvent DEUX evenements pour un seul enregistrement
// d'editeur. Sans regroupement, l'onglet se rechargerait deux fois -- et le
// second rechargement arrive pendant le premier.
test('deux signaux rapproches ne font qu un evenement', async () => {
  const diffuseur = creerDiffuseur({ delaiMs: 10 });
  const ecrits = [];
  diffuseur.abonner({ write: (t) => ecrits.push(t), on: () => {} });
  diffuseur.signaler();
  diffuseur.signaler();
  await new Promise((ok) => setTimeout(ok, 40));
  assert.strictEqual(ecrits.length, 1, `evenements ecrits : ${ecrits.length}`);
  assert.ok(ecrits[0].includes('data:'));
});

test('deux signaux espaces font deux evenements', async () => {
  const diffuseur = creerDiffuseur({ delaiMs: 10 });
  const ecrits = [];
  diffuseur.abonner({ write: (t) => ecrits.push(t), on: () => {} });
  diffuseur.signaler();
  await new Promise((ok) => setTimeout(ok, 40));
  diffuseur.signaler();
  await new Promise((ok) => setTimeout(ok, 40));
  assert.strictEqual(ecrits.length, 2);
});

test('la route de rechargement ouvre un flux d evenements', async () => {
  const ctrl = new AbortController();
  const r = await fetch(`${base}/faux/rechargement`, { signal: ctrl.signal });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  ctrl.abort();
});

// LE CADRE EXISTE PARCE QU'UN ONGLET N'A PAS LA TAILLE D'UNE FENETRE. Un
// Simple Browser fait la largeur du panneau VS Code; desktop/index.html est
// calibree pour 1097x720 exactement. Servie nue a la racine, elle arrivait
// etiree sur une mise en page qui n'existe sur l'ecran de personne.
test('la racine sert le cadre, pas la page', async () => {
  const r = await fetch(`${base}/`);
  assert.strictEqual(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('id="cadre"'), 'la racine ne sert pas le cadre');
  assert.ok(html.includes('src="/index.html"'), 'le cadre ne charge pas la page');
  // Le cadre est un fichier STATIQUE: aucune injection ne doit l'atteindre,
  // sinon le faux etat serait pose deux fois -- une fois hors de l'iframe, ou
  // il ne sert a rien, et une fois dedans.
  assert.ok(!html.includes('__FAUX_ETAT__'), 'le cadre a recu une injection');
});

// LES DEUX NOMBRES SONT RECOPIES de desktop/main.js:887. Une recopie qu'aucun
// test ne relit derive en silence: le cadre continuerait d'afficher 1097x720
// longtemps apres que la vraie fenetre a change de taille, et on reglerait une
// mise en page sur des mesures perimees.
test('le cadre garde les mesures de la vraie fenetre', async () => {
  const cadre = await (await fetch(`${base}/`)).text();
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
  const bloc = source.slice(source.indexOf('function creerFenetre()'));
  const nombre = (nom) => {
    // Premiere occurrence APRES creerFenetre(): celle de la fenetre
    // principale. Celles de l'overlay viennent bien plus loin.
    const i = bloc.indexOf(nom + ':');
    assert.ok(i !== -1, nom + ' introuvable dans creerFenetre()');
    const valeur = parseInt(bloc.slice(i + nom.length + 1).trim(), 10);
    assert.ok(Number.isInteger(valeur), nom + ' n est pas un nombre');
    return String(valeur);
  };
  assert.ok(cadre.includes('const LARGEUR = ' + nombre('width') + ';'), 'largeur du cadre perimee');
  assert.ok(cadre.includes('const HAUTEUR = ' + nombre('height') + ';'), 'hauteur du cadre perimee');
});
