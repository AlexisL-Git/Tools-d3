'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { depuisFrappe, depuisBouton, estSouris, libelle, estUtilisable } = require('../src/comptes/raccourcis');

const frappe = (extra) => ({ key: 'a', ctrlKey: false, altKey: false, shiftKey: false, ...extra });

// --- de la frappe vers l'accelerateur Electron -----------------------------

test('une touche de fonction devient elle-même', () => {
  assert.strictEqual(depuisFrappe(frappe({ key: 'F1' })), 'F1');
  assert.strictEqual(depuisFrappe(frappe({ key: 'F12' })), 'F12');
});

test('une lettre est mise en majuscule', () => {
  assert.strictEqual(depuisFrappe(frappe({ key: 'a' })), 'A');
  assert.strictEqual(depuisFrappe(frappe({ key: 'Z' })), 'Z');
});

// Electron n'accepte pas « ArrowLeft »: son nom est « Left ».
test('les flèches prennent le nom attendu par Electron', () => {
  assert.strictEqual(depuisFrappe(frappe({ key: 'ArrowLeft' })), 'Left');
  assert.strictEqual(depuisFrappe(frappe({ key: 'ArrowRight' })), 'Right');
  assert.strictEqual(depuisFrappe(frappe({ key: 'ArrowUp' })), 'Up');
  assert.strictEqual(depuisFrappe(frappe({ key: 'ArrowDown' })), 'Down');
});

test('l espace et la tabulation prennent leur nom', () => {
  assert.strictEqual(depuisFrappe(frappe({ key: ' ' })), 'Space');
  assert.strictEqual(depuisFrappe(frappe({ key: 'Tab' })), 'Tab');
});

// Ctrl s ecrit CommandOrControl: c'est la forme portable, et le projet peut
// finir sur un autre systeme sans que les raccourcis enregistres soient a
// refaire.
test('les modificateurs suivent la forme d Electron', () => {
  assert.strictEqual(depuisFrappe(frappe({ key: 'ArrowLeft', ctrlKey: true })), 'CommandOrControl+Left');
  assert.strictEqual(depuisFrappe(frappe({ key: 'a', altKey: true })), 'Alt+A');
  assert.strictEqual(depuisFrappe(frappe({ key: 'a', shiftKey: true })), 'Shift+A');
});

test('les modificateurs se cumulent dans un ordre stable', () => {
  const a = depuisFrappe(frappe({ key: 'p', ctrlKey: true, altKey: true, shiftKey: true }));
  const b = depuisFrappe(frappe({ key: 'p', shiftKey: true, altKey: true, ctrlKey: true }));
  assert.strictEqual(a, b);
  assert.strictEqual(a, 'CommandOrControl+Alt+Shift+P');
});

// --- ce qu'on refuse -------------------------------------------------------

// Un modificateur seul n'est pas un raccourci: on attend la vraie touche.
test('un modificateur seul n est pas un raccourci', () => {
  for (const k of ['Control', 'Alt', 'Shift', 'Meta']) {
    assert.strictEqual(depuisFrappe(frappe({ key: k })), null, k);
  }
});

// Échap sert a ANNULER la saisie: l'assigner rendrait l'annulation impossible.
test('Échap ne s assigne pas', () => {
  assert.strictEqual(depuisFrappe(frappe({ key: 'Escape' })), null);
});

test('une frappe malformée ne lève pas', () => {
  assert.strictEqual(depuisFrappe(null), null);
  assert.strictEqual(depuisFrappe({}), null);
  assert.strictEqual(depuisFrappe(frappe({ key: '' })), null);
});

// --- ce qu'on décourage ----------------------------------------------------

// Un raccourci GLOBAL confisque la touche a Dofus tant qu'OMNI tourne. Une
// touche nue et courante en jeu est donc un mauvais choix, sans etre interdit:
// c'est l'utilisateur qui decide, l'interface se contente de l'avertir.
test('une touche nue courante en jeu est signalée comme risquée', () => {
  assert.strictEqual(estUtilisable('A').risque, true);
  assert.strictEqual(estUtilisable('Space').risque, true);
  assert.strictEqual(estUtilisable('1').risque, true);
});

test('une touche avec modificateur ou une touche de fonction est sûre', () => {
  assert.strictEqual(estUtilisable('CommandOrControl+Left').risque, false);
  assert.strictEqual(estUtilisable('F9').risque, false);
  assert.strictEqual(estUtilisable('Alt+A').risque, false);
});

// --- vers l'affichage ------------------------------------------------------

test('le libellé affiché est plus court que l accélérateur', () => {
  assert.strictEqual(libelle('CommandOrControl+Left'), 'Ctrl+←');
  assert.strictEqual(libelle('Alt+Shift+P'), 'Alt+Maj+P');
  assert.strictEqual(libelle('F1'), 'F1');
  assert.strictEqual(libelle('Space'), 'Espace');
});

test('un accélérateur absent s affiche comme tel', () => {
  assert.strictEqual(libelle(null), '');
  assert.strictEqual(libelle(''), '');
});

// --- les boutons de souris ------------------------------------------------

const clic = (extra) => ({ button: 3, ctrlKey: false, altKey: false, shiftKey: false, ...extra });

test('les trois boutons assignables ont leur nom', () => {
  assert.strictEqual(depuisBouton(clic({ button: 3 })), 'Souris4');
  assert.strictEqual(depuisBouton(clic({ button: 4 })), 'Souris5');
  assert.strictEqual(depuisBouton(clic({ button: 1 })), 'SourisMilieu');
});

// Il faut pouvoir cliquer sur la case pour armer la saisie: le clic gauche ne
// peut pas etre un raccourci. Le clic droit ouvre les menus du jeu.
test('les clics gauche et droit ne sont pas assignables', () => {
  assert.strictEqual(depuisBouton(clic({ button: 0 })), null);
  assert.strictEqual(depuisBouton(clic({ button: 2 })), null);
});

test('un bouton inconnu ou un objet invalide rend null', () => {
  assert.strictEqual(depuisBouton(clic({ button: 9 })), null);
  assert.strictEqual(depuisBouton(clic({ button: undefined })), null);
  assert.strictEqual(depuisBouton(null), null);
  assert.strictEqual(depuisBouton('Souris4'), null);
});

// L'ordre doit etre celui du clavier: la chaine fabriquee a la capture et
// celle fabriquee a la reception doivent coincider caractere pour caractere.
test('les modificateurs suivent l ordre du clavier', () => {
  assert.strictEqual(depuisBouton(clic({ button: 3, ctrlKey: true })), 'CommandOrControl+Souris4');
  assert.strictEqual(depuisBouton(clic({ button: 4, altKey: true })), 'Alt+Souris5');
  assert.strictEqual(depuisBouton(clic({ button: 1, shiftKey: true })), 'Shift+SourisMilieu');
  assert.strictEqual(
    depuisBouton(clic({ button: 3, ctrlKey: true, altKey: true, shiftKey: true })),
    'CommandOrControl+Alt+Shift+Souris4',
  );
});

test('estSouris distingue un bouton d une touche', () => {
  assert.strictEqual(estSouris('Souris4'), true);
  assert.strictEqual(estSouris('CommandOrControl+Souris5'), true);
  assert.strictEqual(estSouris('SourisMilieu'), true);
  assert.strictEqual(estSouris('CommandOrControl+A'), false);
  assert.strictEqual(estSouris('F1'), false);
  assert.strictEqual(estSouris(''), false);
  assert.strictEqual(estSouris(null), false);
});

// Un bouton de souris n'est pas confisque a Dofus: on lit un etat, on
// n'intercepte rien. M4 et M5 sont libres dans le jeu, la molette non.
test('M4 et M5 ne sont pas signales, la molette si', () => {
  assert.strictEqual(estUtilisable('Souris4').risque, false);
  assert.strictEqual(estUtilisable('Souris5').risque, false);
  assert.strictEqual(estUtilisable('CommandOrControl+Souris4').risque, false);
  const molette = estUtilisable('SourisMilieu');
  assert.strictEqual(molette.risque, true);
  assert.match(molette.raison, /aussi/);
});

// La molette est PARTAGEE avec Dofus, une touche nue lui est VOLEE: deux
// situations opposees, deux textes.
test('le texte de la molette differe de celui d une touche nue', () => {
  assert.notStrictEqual(estUtilisable('SourisMilieu').raison, estUtilisable('A').raison);
});

test('les boutons ont un libelle court', () => {
  assert.strictEqual(libelle('Souris4'), 'M4');
  assert.strictEqual(libelle('Souris5'), 'M5');
  assert.strictEqual(libelle('SourisMilieu'), 'Molette');
  assert.strictEqual(libelle('CommandOrControl+Souris4'), 'Ctrl+M4');
});
