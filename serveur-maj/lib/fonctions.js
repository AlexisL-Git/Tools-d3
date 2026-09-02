'use strict';

// COPIE DE src/droits/liste.js. Ne pas modifier ici sans modifier la-bas:
// serveur-maj se deploie seul (npx vercel --prod depuis ce dossier) et ne
// peut pas require un fichier hors de son arborescence.
// test/droits-liste.test.js compare les deux et echoue si elles divergent.
const FONCTIONS = [
  { nom: 'abandon', libelle: 'abandon de combat groupe' },
  { nom: 'passe-tour', libelle: 'passe-tour' },
  { nom: 'invitation', libelle: 'acceptation d invitation de groupe' },
  { nom: 'echange', libelle: 'acceptation d echange' },
  { nom: 'songe', libelle: 'acceptation d invitation a un songe' },
  { nom: 'overlay', libelle: 'barre flottante' },
  { nom: 'hdv', libelle: 'mise a jour des prix en hotel de vente' },
  { nom: 'vente', libelle: 'mise en vente en hotel de vente' },
  { nom: 'no-anim', libelle: 'animations du jeu coupees' },
];

const NOMS = FONCTIONS.map((f) => f.nom);

function estConnue(nom) {
  return NOMS.includes(nom);
}

module.exports = { FONCTIONS, NOMS, estConnue };
