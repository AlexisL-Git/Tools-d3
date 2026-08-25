'use strict';

// La traduction entre une frappe au clavier, l'accelerateur qu'Electron
// enregistre, et le libelle qu'on affiche. Rien d'autre.
//
// Trois vocabulaires pour la meme touche, et les confondre coute cher:
//
//   KeyboardEvent   'ArrowLeft'            ce que le navigateur rend
//   Electron        'CommandOrControl+Left' ce que globalShortcut accepte
//   affichage       'Ctrl+←'                ce qu'on montre
//
// Fonction pure, aucun acces au systeme: elle se teste sans clavier.

// KeyboardEvent.key -> nom Electron, quand les deux different.
const NOMS = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ' ': 'Space',
  Spacebar: 'Space',
  Enter: 'Return',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Tab: 'Tab',
  Backspace: 'Backspace',
};

const MODIFICATEURS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph']);

// Echap sert a ANNULER une saisie de raccourci. L'assigner rendrait
// l'annulation impossible, donc il ne s'assigne pas.
const REFUSEES = new Set(['Escape', 'Dead', 'Unidentified']);

// frappe — un KeyboardEvent, ou tout objet portant key/ctrlKey/altKey/shiftKey.
// Rend l'accelerateur Electron, ou null si la frappe n'en est pas un.
function depuisFrappe(frappe) {
  if (frappe === null || typeof frappe !== 'object') return null;
  const k = frappe.key;
  if (typeof k !== 'string' || k.length === 0) return null;
  if (MODIFICATEURS.has(k) || REFUSEES.has(k)) return null;

  // L'ordre des modificateurs est FIXE, sans quoi deux frappes identiques
  // produiraient deux chaines differentes et la detection de doublon les
  // laisserait passer.
  const parties = [];
  if (frappe.ctrlKey) parties.push('CommandOrControl');
  if (frappe.altKey) parties.push('Alt');
  if (frappe.shiftKey) parties.push('Shift');

  const nom = NOMS[k] || (k.length === 1 ? k.toUpperCase() : k);
  parties.push(nom);
  return parties.join('+');
}

// Une touche NUE, courante en jeu, est un mauvais choix: un raccourci global
// confisque la touche a Dofus tant qu'OMNI tourne. On le signale sans
// l'interdire — c'est l'utilisateur qui sait ce qu'il utilise en combat.
function estUtilisable(accelerateur) {
  if (typeof accelerateur !== 'string' || accelerateur.length === 0) {
    return { risque: false, raison: null };
  }
  const parties = accelerateur.split('+');
  const nom = parties[parties.length - 1];
  const nue = parties.length === 1;
  const fonction = /^F([1-9]|1[0-9]|2[0-4])$/.test(nom);
  if (nue && !fonction) {
    return { risque: true, raison: 'Dofus ne recevra plus cette touche tant qu OMNI tourne' };
  }
  return { risque: false, raison: null };
}

const AFFICHAGE = {
  CommandOrControl: 'Ctrl',
  Shift: 'Maj',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  Space: 'Espace',
  Return: 'Entrée',
  Backspace: 'Retour',
  Delete: 'Suppr',
};

function libelle(accelerateur) {
  if (typeof accelerateur !== 'string' || accelerateur.length === 0) return '';
  return accelerateur.split('+').map((p) => AFFICHAGE[p] || p).join('+');
}

module.exports = { depuisFrappe, libelle, estUtilisable, NOMS };
