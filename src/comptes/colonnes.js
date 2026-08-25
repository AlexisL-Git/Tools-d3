'use strict';

// Les cinq colonnes de fonctions, leur etat d'ensemble, et ce que fait un clic
// sur leur titre. Rien d'autre.
//
// POURQUOI CE MODULE EXISTE. Le panneau avait deux niveaux: cinq interrupteurs
// generaux en haut, cinq colonnes de cases en dessous, et RIEN ne reliait les
// deux a l'ecran. Une case cochee sous un general eteint ne faisait rien, sans
// que ca se voie. Les cases par compte sont desormais la seule verite, et le
// titre de colonne est une ACTION GROUPEE sur tout le monde.
//
// Il absorbe aussi le piege de la colonne « Repl. », qui est INVERSEE: son
// champ est `exclu`, et cocher veut dire « suit le meneur ». Personne ne
// devrait avoir a s'en souvenir ailleurs.
//
// Fonction pure: ni Electron, ni Frida, ni disque.

const COLONNES = [
  {
    nom: 'repl',
    titre: 'Répl.',
    champ: 'exclu',
    // La seule inversee des cinq: cochee = NON exclue = suit le meneur.
    inverse: true,
    canal: 'exclureCompte',
  },
  { nom: 'tour', titre: 'Tour', champ: 'passeTour', inverse: false, canal: 'basculerPasseTourCompte' },
  { nom: 'groupe', titre: 'Groupe', champ: 'invitation', inverse: false, canal: 'basculerInvitationCompte' },
  { nom: 'anim', titre: 'Anim', champ: 'noAnim', inverse: false, canal: 'basculerNoAnimCompte' },
  { nom: 'echange', titre: 'Éch.', champ: 'echange', inverse: false, canal: 'basculerEchangeCompte' },
];

const parNom = new Map(COLONNES.map((c) => [c.nom, c]));

// Ce que la case affiche pour cette ligne, inversion comprise.
function valeurDe(ligne, nom) {
  const c = parNom.get(nom);
  if (c === undefined) return null;
  const brut = Boolean(ligne[c.champ]);
  return c.inverse ? !brut : brut;
}

// Seules les lignes portant un identifiant de compte comptent: sans lui, rien
// ne peut etre enregistre, donc la ligne ne participe ni a l'etat d'ensemble
// ni a l'action groupee.
function pertinentes(lignes) {
  return (lignes || []).filter((l) => l.id !== null && l.id !== undefined);
}

// 'tous' | 'aucun' | 'partiel'. Une liste vide vaut 'aucun': un panneau sans
// client afficherait sinon cinq colonnes armees.
function etatColonne(lignes, nom) {
  if (!parNom.has(nom)) return null;
  const utiles = pertinentes(lignes);
  if (utiles.length === 0) return 'aucun';
  let coches = 0;
  for (const l of utiles) if (valeurDe(l, nom)) coches += 1;
  if (coches === 0) return 'aucun';
  return coches === utiles.length ? 'tous' : 'partiel';
}

// Ce que le clic groupe doit poser. Depuis 'partiel' on COMPLETE plutot que de
// tout eteindre: c'est le geste qui demande le moins de clics dans le cas
// courant, ou l'on veut aligner l'equipe.
function cibleBascule(lignes, nom) {
  const etat = etatColonne(lignes, nom);
  if (etat === null) return null;
  return etat !== 'tous';
}

module.exports = { COLONNES, parNom, valeurDe, etatColonne, cibleBascule };
