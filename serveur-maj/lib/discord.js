'use strict';

// 700 ms, pas 2000: ce ping est attendu sur le chemin critique du lancement
// d'un ami (/api/etat repond apres lui), dont le budget cote client est de
// 2000 ms. Un webhook Discord lent ne doit jamais faire passer un
// signalement deja ecrit en base pour un echec cote ami. Le refus reste de
// toute facon visible en rouge dans le panneau, meme si l'alerte est ratee:
// ce ping n'est qu'une courtoisie.
const DELAI_MS = 700;

// Ne leve JAMAIS. Ce webhook est un confort pour l'administrateur; le
// lancement d'un ami ne doit pas dependre de la sante de Discord.
async function prevenir(texte, { url = process.env.DISCORD_WEBHOOK, chercher = globalThis.fetch } = {}) {
  if (!url) return { envoye: false, raison: 'sans webhook' };
  try {
    const r = await chercher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: texte }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!r.ok) {
      console.error('[discord] statut', r.status);
      return { envoye: false, raison: 'statut ' + r.status };
    }
    return { envoye: true };
  } catch (e) {
    console.error('[discord]', e && e.message ? e.message : e);
    return { envoye: false, raison: 'injoignable' };
  }
}

module.exports = { prevenir, DELAI_MS };
