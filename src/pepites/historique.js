'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Les passes de classement deja faites, sur disque, a cote de favoris.json.
//
// Conception: docs/superpowers/specs/2026-09-11-opti-pepite-design.md.
//
// POURQUOI UN FICHIER. La colonne de variation compare la passe courante a la
// precedente. Sans disque, la premiere passe apres chaque lancement d'OMNI
// n'aurait rien a quoi se comparer, et la colonne serait vide precisement au
// moment ou on revient voir ce qui a bouge.

// QUINZE JOURS A DEUX PASSES PAR JOUR. Sans plafond le fichier grossirait sans
// fin pour une donnee que personne ne relira: seule la derniere passe sert a
// la comparaison, le reste est du confort.
const PASSES_GARDEES = 30;

// La forme d'une passe. Une entree qui ne la respecte pas est ecartee sans
// bruit -- le fichier se relit a la main quand on debugue, et une ligne mal
// recopiee ne doit pas faire tomber le panneau.
function estUnePasse(p) {
  return p !== null && typeof p === 'object' && !Array.isArray(p)
    && typeof p.quand === 'number' && Array.isArray(p.lignes);
}

// `onErreur` est appele pour ce qui merite le journal, et pour cela seulement:
// un fichier ABSENT n'en fait pas partie. C'est le premier lancement, pas un
// incident, et le journaliser apprendrait aux amis a ignorer ce canal.
function creerHistorique({ chemin, onErreur = () => {} }) {
  let passes = null;

  function lire() {
    if (passes !== null) return passes;
    try {
      const json = JSON.parse(fs.readFileSync(chemin, 'utf8'));
      passes = Array.isArray(json.passes) ? json.passes.filter(estUnePasse) : [];
    } catch (e) {
      // ENOENT est le premier lancement. Tout le reste est un fichier qu'on
      // n'a pas su lire, et celui-la se dit.
      if (e.code !== 'ENOENT') onErreur(e);
      passes = [];
    }
    return passes;
  }

  function dernier() {
    const tout = lire();
    return tout.length === 0 ? null : tout[tout.length - 1];
  }

  function ajouter(passe) {
    const tout = [...lire(), passe].slice(-PASSES_GARDEES);
    passes = tout;
    try {
      fs.mkdirSync(path.dirname(chemin), { recursive: true });
      fs.writeFileSync(chemin, JSON.stringify({ passes: tout }), 'utf8');
    } catch (e) {
      // L'ECRITURE QUI ECHOUE NE PERD QUE L'HISTORIQUE, pas la passe: elle
      // reste en memoire et s'affiche. Un disque plein ne doit pas priver du
      // classement qu'on vient de calculer.
      onErreur(e);
    }
    return tout;
  }

  return { lire, dernier, ajouter };
}

module.exports = { creerHistorique, PASSES_GARDEES };
