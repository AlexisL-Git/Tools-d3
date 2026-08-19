'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Lecture de la liste des comptes du launcher Ankama.
//
// %APPDATA%\zaap\Settings est un JSON contenant USER_ACCOUNTS: identifiant,
// pseudo, avatar, en clair. Aucun mot de passe, aucun jeton.
//
// Le dossier voisin contenant les identifiants CHIFFRES n'est jamais touche
// par ce module, et un test verifie que son source n'y fait meme pas reference.

function cheminParDefaut() {
  const base = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return path.join(base, 'zaap', 'Settings');
}

const CHAMPS = ['id', 'login', 'nickname', 'tag', 'nicknameWithTag', 'avatar', 'isMain'];

// Rend toujours { comptes, erreur }: une liste vide avec une raison plutot
// qu'une exception, pour que l'interface affiche le probleme au lieu de
// planter.
function lireComptes(chemin = cheminParDefaut()) {
  let brut;
  try {
    brut = fs.readFileSync(chemin, 'utf8');
  } catch (e) {
    return { comptes: [], erreur: `Settings de Zaap introuvable ou illisible : ${e.code || e.message}` };
  }

  let json;
  try {
    json = JSON.parse(brut);
  } catch (e) {
    return { comptes: [], erreur: `Settings de Zaap illisible : ${e.message}` };
  }

  const liste = json.USER_ACCOUNTS;
  if (!Array.isArray(liste) || liste.length === 0) {
    return { comptes: [], erreur: 'aucun compte dans le Settings de Zaap' };
  }

  const comptes = liste
    .filter((c) => c && typeof c.id === 'number')
    .map((c) => {
      const sortie = {};
      for (const champ of CHAMPS) sortie[champ] = c[champ] ?? null;
      return sortie;
    });

  return { comptes, erreur: null };
}

module.exports = { lireComptes, cheminParDefaut };
