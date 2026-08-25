'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { depuisFrappe, libelle, estUtilisable } = require('../src/comptes/raccourcis');

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
