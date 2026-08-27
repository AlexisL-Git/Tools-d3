'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { depuisBouton } = require('../src/comptes/raccourcis');

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

test('la copie est delimitee par ses marqueurs', () => {
  const i = html.indexOf(DEBUT);
  const j = html.indexOf(FIN);
  assert.notStrictEqual(i, -1, 'marqueur de debut absent de index.html');
  assert.notStrictEqual(j, -1, 'marqueur de fin absent de index.html');
  assert.ok(j > i, 'le marqueur de fin doit suivre celui de debut');
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

// Le libelle vit lui aussi en double. Il ne rend pas le raccourci muet, mais il
// afficherait « Souris4 » a l'utilisateur au lieu de « M4 ».
test('les trois boutons ont leur libelle court dans le renderer', () => {
  for (const nom of ['Souris4', 'Souris5', 'SourisMilieu']) {
    assert.match(html, new RegExp(nom + ":\\s*'"), nom + ' n a pas de libelle dans AFFICHAGE de index.html');
  }
});
