'use strict';

// LES FONCTIONS VERROUILLABLES, ET ELLES SEULES.
//
// Un seul endroit cote application. Le panneau d administration lit la meme
// liste, servie par sa propre copie (serveur-maj/lib/fonctions.js): deux
// listes qui derivent, c est le panneau qui coche une fonction que l app ne
// connait pas. Un test compare les deux.
//
// Le replicate (duplication) et le garde-combat n y sont pas: le premier est
// l outil lui-meme -- une cle sans lui ne sert a rien -- le second est une
// protection, et la couper ferait ouvrir un combat a chaque mule.
const FONCTIONS = [
  { nom: 'abandon', libelle: 'abandon de combat groupe' },
  { nom: 'passe-tour', libelle: 'passe-tour' },
  { nom: 'invitation', libelle: 'acceptation d invitation de groupe' },
  { nom: 'echange', libelle: 'acceptation d echange' },
  { nom: 'songe', libelle: 'acceptation d invitation a un songe' },
  { nom: 'overlay', libelle: 'barre flottante' },
  { nom: 'hdv', libelle: 'mise a jour des prix en hotel de vente' },
  { nom: 'vente', libelle: 'mise en vente en hotel de vente' },
  { nom: 'chasse', libelle: 'chasse a l archimonstre, pierre d ame equipee' },
  { nom: 'no-anim', libelle: 'animations du jeu coupees' },
];

const NOMS = FONCTIONS.map((f) => f.nom);

function estConnue(nom) {
  return NOMS.includes(nom);
}

module.exports = { FONCTIONS, NOMS, estConnue };
