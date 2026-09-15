'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// UN BOUTON DE RAIL SANS SA VUE NE FAIT RIEN. Le rail commute en posant
// `actif` sur `#v-<data-vue>`; si l element n existe pas, le clic retire
// l ecran courant et n en montre aucun -- la fenetre devient vide, et la
// seule trace est un TypeError dans une console que la production n ouvre
// pas (devTools: false, main.js:928).

const INDEX = path.join(__dirname, '..', 'desktop', 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');

const VUES = ['raccourcis', 'courses', 'hotel', 'archi', 'reglages'];

// LA PAGE PORTE DES data-vue QUI NE SONT PAS CEUX DU RAIL: le selecteur
// segmente de l ecran Archimonstres en a deux, `liste` et `zones`
// (la paire `data-vue="liste"` / `data-vue="zones"`). Balayer la page entiere les ramasserait et ferait
// echouer ce test sur du balisage juste. On se borne donc au bloc du rail.
const blocRail = () => {
  const d = html.indexOf('<div class="rail"');
  assert.notStrictEqual(d, -1, 'le rail est introuvable');
  const f = html.indexOf('<div class="corps"', d);
  assert.notStrictEqual(f, -1, 'le corps ne suit plus le rail');
  return html.slice(d, f);
};

test('les cinq boutons du rail sont la, dans l ordre de la maquette', () => {
  const trouves = [...blocRail().matchAll(/data-vue="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(trouves, VUES);
});

test('chaque bouton du rail a sa vue', () => {
  const sans = VUES.filter((v) => !html.includes(`id="v-${v}"`));
  assert.deepStrictEqual(sans, [], `vue absente pour : ${sans.join(', ')}`);
});

// LE `no-drag` N EST PAS DECORATIF. `.haut` est `-webkit-app-region: drag`
// comme l etait `.barre-titre`: sans no-drag sur ce qui s y clique, Windows
// avale le clic comme un deplacement de fenetre et le bouton ne fait RIEN,
// sans le moindre message. Le piege est ecrit en toutes lettres a
// tete de la regle .version-lien du bloc <style> depuis qu il a coute une soiree.
test('tout ce qui se clique dans la barre du haut est no-drag', () => {
  const debut = html.indexOf('<div class="haut"');
  assert.notStrictEqual(debut, -1, 'la barre du haut est introuvable');
  // La barre s arrete au premier `<div class="avis"`, qui la suit
  // immediatement dans l ossature. Borne par un REPERE du balisage et non
  // par un comptage de balises: un `</div>` se compte mal a la regex, et un
  // test qui se trompe de fin garderait la mauvaise zone.
  const fin = html.indexOf('<div class="avis"', debut);
  assert.notStrictEqual(fin, -1, 'les bandeaux ne suivent plus la barre du haut');
  const bloc = html.slice(debut, fin);

  // LA REGLE EST: CHAQUE BOUTON PORTE no-drag DANS SA PROPRE BALISE.
  // On pourrait le poser sur un parent et laisser hériter -- Windows
  // l accepte -- mais alors ce test devrait deviner l imbrication a la
  // regex, et un test qui devine garde mal. La regle stricte coute un
  // attribut repete et se verifie en trois lignes.
  const balises = bloc.match(/<button[^>]*>/g) || [];
  assert.ok(
    balises.length >= 4,
    'la barre du haut doit porter version, theme, reduire et fermer',
  );
  const nus = balises.filter((b) => !b.includes('no-drag'));
  assert.deepStrictEqual(
    nus, [],
    'bouton sans no-drag dans la barre du haut : sous Windows, la zone de '
    + 'deplacement avale le clic et le bouton ne fait RIEN, sans un message',
  );
});

// Le banc injecte `<script src="/faux-app.js"></script>` AVANT le premier
// <script> de la page, retrouve par recherche et non par numero de ligne.
// Sans point d accroche, l injection tombe et le banc sert une page morte.
test('la page garde un point d accroche pour l injection du banc', () => {
  assert.ok(html.includes('<script'), 'plus un seul <script> dans la page');
});

// UN SIGNAL QUI S ETEINT SANS BRUIT. le script bascule `retard` sur
// #versionBouton quand le depot a avance, et la SEULE regle qui le dessine
// est `.version-lien.retard`. Changer la classe du bouton pour `fant` seule
// n aurait casse ni le clic, ni l affichage, ni un test: le bouton aurait
// simplement cesse, pour toujours, de dire qu il y a du retard.
test('le bouton de version garde la classe qui porte son etat', () => {
  const balise = html.match(/<button[^>]*id="versionBouton"[^>]*>/);
  assert.notStrictEqual(balise, null, '#versionBouton a disparu de la page');
  assert.ok(
    balise[0].includes('version-lien'),
    'le bouton de version doit garder la classe version-lien tant que la regle '
    + '.version-lien.retard vit dans l ancienne feuille',
  );
});
