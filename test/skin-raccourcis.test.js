'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dossier = path.join(__dirname, '..', 'desktop');
const html = fs.readFileSync(path.join(dossier, 'index.html'), 'utf8');
const briques = fs.readFileSync(path.join(dossier, 'skin', 'briques.css'), 'utf8');
const ecrans = fs.readFileSync(path.join(dossier, 'skin', 'ecrans.css'), 'utf8');

// Le bloc #v-raccourcis seul, pour ne pas faire lever ce test sur les
// autres écrans (Archimonstres, Hôtel, Réglages) qui portent encore l'ancien
// prefixe v0- et ne sont pas dans le périmètre de cette tâche.
function blocRaccourcis() {
  const i = html.indexOf('<div class="vue actif" id="v-raccourcis">');
  const j = html.indexOf('<div class="vue" id="v-courses">');
  assert.notStrictEqual(i, -1, 'ouverture de #v-raccourcis introuvable');
  assert.notStrictEqual(j, -1, 'ouverture de #v-courses introuvable : bornes du bloc perdues');
  return html.slice(i, j);
}

test('le balisage de #v-raccourcis porte le vocabulaire de la maquette', () => {
  const bloc = blocRaccourcis();
  for (const classe of ['panneau', 'entete', 'liste']) {
    assert.ok(
      bloc.includes('class="' + classe + '"') || bloc.includes(' ' + classe + '"') || bloc.includes(' ' + classe + ' '),
      `classe "${classe}" absente du balisage de #v-raccourcis`,
    );
  }
  assert.ok(!bloc.includes('class="defile"'), '.defile aurait du disparaitre avec l etape Raccourcis');
  assert.ok(!bloc.includes('id="entete"') || bloc.includes('class="entete"'), 'l entete doit porter la classe de la maquette');
});

test('creerRang() et majRang() ne construisent plus les anciennes classes', () => {
  const i = html.indexOf('function creerRang()');
  const j = html.indexOf('window.app.surEtat(');
  assert.notStrictEqual(i, -1, 'creerRang introuvable');
  assert.notStrictEqual(j, -1, 'window.app.surEtat introuvable');
  const script = html.slice(i, j);
  for (const ancienne of ["'rang'", "'plaque'", "'case'", "'verdict'", "'bouton-commande'", "'zone-clic'"]) {
    assert.ok(!script.includes(ancienne), `l ancienne classe ${ancienne} est encore construite par le JS`);
  }
  for (const nouvelle of ["'ligne'", "'perso-mini'", "'inter'", "'pastille-etat'", "'cabochon'"]) {
    assert.ok(script.includes(nouvelle), `la nouvelle classe ${nouvelle} n est jamais construite`);
  }
});

test('les anciennes regles CSS -v0- de Raccourcis ont disparu de index.html', () => {
  for (const selecteur of ['.rang {', '.rang.', '.plaque {', '.case {', '.verdict {', '.bouton-commande {', '.zone-clic ', '.cellule-touche {']) {
    assert.ok(!html.includes(selecteur), `la regle "${selecteur}" existe encore dans index.html`);
  }
});

test('le nouveau vocabulaire de Raccourcis vit dans skin/, pas dans index.html', () => {
  for (const selecteur of ['.ligne.commande', '.hdv', '.menu-hdv', '.fermer-un', '.motif']) {
    assert.ok(ecrans.includes(selecteur), `"${selecteur}" attendu dans skin/ecrans.css`);
  }
  for (const selecteur of ['.ligne.hors-ligne', '.cabochon.risque', '.pastille-etat.attente', '.bt-vide.pleine']) {
    assert.ok(briques.includes(selecteur), `"${selecteur}" attendu dans skin/briques.css`);
  }
});

test('#avertTouches ne pointe plus sur un jeton -v0-', () => {
  assert.ok(!html.includes("id=\"avertTouches\" style=\"margin-left:auto;text-transform:none;letter-spacing:0;font-weight:400;color:var(--v0-alerte)\""),
    'avertTouches porte encore --v0-alerte en style inline');
});
