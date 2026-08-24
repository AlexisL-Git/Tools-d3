'use strict';
const { empreinte } = require('./archive');

const DELAI_MS = 5000;

// Trois etats qui ne se confondent jamais:
//   'refuse'      le serveur a dit non (cle inconnue ou revoquee) -> on arrete
//   'injoignable' incident reseau -> on demarre sur la version en place
//   'corrompu'    l'empreinte ne correspond pas -> on n'installe rien
// Confondre les deux premiers ferait qu'une simple coupure de connexion
// revoquerait tout le monde.
function creerCanal({ base, chercher = globalThis.fetch }) {
  async function appeler(chemin, cle) {
    return chercher(base + chemin, {
      headers: { 'x-cle': cle },
      signal: AbortSignal.timeout(DELAI_MS),
    });
  }

  async function manifeste(cle) {
    let r;
    try {
      r = await appeler('/api/manifeste', cle);
    } catch (e) {
      return { etat: 'injoignable', raison: String(e && e.message ? e.message : e) };
    }
    if (r.status === 404) return { etat: 'refuse' };
    if (!r.ok) return { etat: 'injoignable', raison: 'statut ' + r.status };
    try {
      return { etat: 'ok', manifeste: await r.json() };
    } catch (e) {
      return { etat: 'injoignable', raison: 'reponse illisible' };
    }
  }

  async function paquet(cle, sha256Attendu) {
    let r;
    try {
      r = await appeler('/api/paquet', cle);
    } catch (e) {
      return { etat: 'injoignable', raison: String(e && e.message ? e.message : e) };
    }
    if (r.status === 404) return { etat: 'refuse' };
    if (!r.ok) return { etat: 'injoignable', raison: 'statut ' + r.status };
    let archive;
    try {
      archive = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      return { etat: 'injoignable', raison: 'telechargement interrompu' };
    }
    const obtenu = empreinte(archive);
    // L'archive n'est jamais rendue quand l'empreinte differe: seul moyen sur
    // de garantir qu'un octet altere ne s'installe pas.
    if (obtenu !== sha256Attendu) return { etat: 'corrompu', obtenu };
    return { etat: 'ok', archive };
  }

  return { manifeste, paquet };
}

module.exports = { creerCanal, DELAI_MS };
