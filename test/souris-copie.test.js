'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { depuisBouton, libelle } = require('../src/comptes/raccourcis');

// LES DEUX COPIES DE LA TRADUCTION, TENUES ENSEMBLE.
//
// desktop/index.html porte une copie de ce que fait src/comptes/raccourcis.js.
// Elle est IMPOSEE: le renderer tourne avec sandbox: true, il n'a pas de
// require, et un preload en bac a sable ne peut charger que les modules
// d'Electron.
//
// Une divergence d'un seul caractere — un modificateur dans un autre ordre, un
// bouton mal nomme — produirait une chaine differente de celle que fabrique
// l'agent. Le raccourci deviendrait muet SANS la moindre erreur, et c'est le
// mode d'echec le plus couteux de ce projet.
//
// On n'assertionne donc pas sur le texte: on EXECUTE la copie et on compare son
// resultat a celui du module, sur toutes les combinaisons.

const html = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'index.html'), 'utf8');

const DEBUT = '// >>> COPIE DE src/comptes/raccourcis.js';
const FIN = '// <<< FIN DE COPIE';

test('la copie est delimitee par ses marqueurs, chacun unique', () => {
  const i = html.indexOf(DEBUT);
  const j = html.indexOf(FIN);
  assert.notStrictEqual(i, -1, 'marqueur de debut absent de index.html');
  assert.notStrictEqual(j, -1, 'marqueur de fin absent de index.html');
  assert.ok(j > i, 'le marqueur de fin doit suivre celui de debut');
  // Le commentaire pose dans index.html presente ce motif comme reutilisable.
  // Si un second bloc reutilise un jour la meme paire, indexOf() capturerait
  // une plage tronquee qui pourrait s'evaluer sans erreur en testant le
  // mauvais code. On l'interdit ici.
  assert.strictEqual(
    i, html.lastIndexOf(DEBUT),
    'marqueur de debut duplique dans index.html : donne un libelle distinct a chaque paire de marqueurs',
  );
  assert.strictEqual(
    j, html.lastIndexOf(FIN),
    'marqueur de fin duplique dans index.html : donne un libelle distinct a chaque paire de marqueurs',
  );
});

function copieDuRenderer() {
  const i = html.indexOf(DEBUT);
  const j = html.indexOf(FIN);
  const source = html.slice(i, j);
  // La copie est du code de module: on la charge telle quelle et on rend la
  // fonction qu'elle definit.
  return new Function(source + '\nreturn accelerateurSourisDe;')();
}

test('la copie du renderer rend exactement ce que rend le module', () => {
  const accelerateurSourisDe = copieDuRenderer();
  // Les six numeros de bouton du DOM, dont trois qui ne s'assignent pas.
  for (const button of [0, 1, 2, 3, 4, 5]) {
    for (const ctrlKey of [false, true]) {
      for (const altKey of [false, true]) {
        for (const shiftKey of [false, true]) {
          const clic = { button, ctrlKey, altKey, shiftKey };
          assert.strictEqual(
            accelerateurSourisDe(clic),
            depuisBouton(clic),
            'divergence sur ' + JSON.stringify(clic)
              + ' : index.html et raccourcis.js ne s accordent plus',
          );
        }
      }
    }
  }
});

// La table AFFICHAGE vit elle aussi en double, hors des marqueurs precedents
// (elle precede le bloc copie, separee par MODIF). Une seconde paire de
// marqueurs l'entoure. Les libelles sont volontairement distincts de ceux du
// premier bloc: "FIN DE COPIE" est un prefixe de "FIN DE COPIE AFFICHAGE",
// et indexOf() du premier trouverait le second s'il apparaissait avant dans
// le fichier — ce qui est le cas ici puisque AFFICHAGE precede le bloc
// accelerateurSourisDe.
const DEBUT_AFFICHAGE = "// >>> TABLE D'AFFICHAGE COPIEE DE src/comptes/raccourcis.js";
const FIN_AFFICHAGE = "// <<< FIN DE LA TABLE D'AFFICHAGE";

test('la table d affichage est delimitee par ses marqueurs, chacun unique', () => {
  const i = html.indexOf(DEBUT_AFFICHAGE);
  const j = html.indexOf(FIN_AFFICHAGE);
  assert.notStrictEqual(i, -1, 'marqueur de debut de la table d affichage absent de index.html');
  assert.notStrictEqual(j, -1, 'marqueur de fin de la table d affichage absent de index.html');
  assert.ok(j > i, 'le marqueur de fin doit suivre celui de debut');
  assert.strictEqual(
    i, html.lastIndexOf(DEBUT_AFFICHAGE),
    'marqueur de debut duplique dans index.html : donne un libelle distinct a chaque paire de marqueurs',
  );
  assert.strictEqual(
    j, html.lastIndexOf(FIN_AFFICHAGE),
    'marqueur de fin duplique dans index.html : donne un libelle distinct a chaque paire de marqueurs',
  );
});

function tableAffichageDuRenderer() {
  const i = html.indexOf(DEBUT_AFFICHAGE);
  const j = html.indexOf(FIN_AFFICHAGE);
  const source = html.slice(i, j);
  return new Function(source + '\nreturn AFFICHAGE;')();
}

// Le libelle vit lui aussi en double. Une simple presence de cle ne suffit
// pas: Souris4 et Souris5 pourraient etre intervertis, "M5" affiche sur le
// raccourci M4, sans qu'aucune assertion textuelle ne bronche. On EXECUTE
// donc la copie et on compare, cle par cle, au libelle que rend le module —
// ce qui couvre au passage les entrees clavier, dupliquees depuis plus
// longtemps encore et jamais surveillees jusqu'ici.
test('chaque entree de la table d affichage du renderer rend le meme libelle que le module', () => {
  const AFFICHAGE_RENDERER = tableAffichageDuRenderer();
  const cles = Object.keys(AFFICHAGE_RENDERER);
  assert.ok(cles.length >= 10, `seulement ${cles.length} entrees trouvees dans la table d affichage`);
  for (const cle of cles) {
    assert.strictEqual(
      AFFICHAGE_RENDERER[cle],
      libelle(cle),
      'divergence de libelle sur ' + cle + ' : index.html et raccourcis.js ne s accordent plus',
    );
  }
});
