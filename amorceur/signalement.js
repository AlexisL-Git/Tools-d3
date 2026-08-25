'use strict';

// Orchestration de la remontee d'etat. Aucun fs, aucun Electron, aucun reseau
// en direct: tout arrive par injection, donc tout se teste.
function creerSignalement({ depot, canal, lireJournal, lignes = 30 }) {
  async function envoyer(cle, version) {
    if (!cle) return { etat: 'sans-cle' };
    const attente = depot.signalementsEnAttente();
    let journal = null;
    if (attente.length) {
      // Le journal n'est lu QUE s'il y a un refus a expliquer: le cas courant
      // est un lancement sans incident, et il ne doit rien couter.
      try {
        journal = lireJournal(lignes);
      } catch (e) {
        journal = null;   // un journal illisible ne doit pas perdre le refus
      }
    }
    const r = await canal.signaler(cle, {
      version: version || null,
      refus: attente.map((v) => ({ version: v, journal })),
    });
    // La file n'est videe que sur un vrai 200. Sur 'refuse' comme sur
    // 'injoignable', elle repart au lancement suivant.
    if (r.etat === 'ok') depot.viderSignalements();
    return r;
  }
  return { envoyer };
}

module.exports = { creerSignalement };
