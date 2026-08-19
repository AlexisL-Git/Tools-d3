'use strict';

// Croise les comptes du launcher et les clients en cours pour produire l'etat
// affichable. Fonction pure: ni fichier, ni process, ni reseau.
//
// Quatre etats possibles, dont le troisieme est le plus important:
//   hors-ligne       le compte existe, aucun client ne tourne
//   intercepte       un client tourne et passe par notre proxy
//   non-intercepte   un client tourne mais s'est connecte avant l'application
//   inconnu          un client tourne sans compte identifiable
//
// Un client lance avant l'application a etabli sa session hors du proxy et ne
// peut pas etre rattrape. Le dire explicitement evite a l'utilisateur de
// chercher pourquoi ce compte ne suit pas.

function ligneBase(compte, favoris, exclus) {
  return {
    id: compte.id,
    nickname: compte.nickname,
    personnage: null,
    classe: null,
    pid: null,
    favori: favoris.has(compte.id),
    exclu: exclus.has(compte.id),
    etat: 'hors-ligne',
    estMaitre: false,
  };
}

function construireVue({ comptes, clients, intercepte, maitre, exclus, favoris }) {
  const parCompte = new Map();
  for (const c of clients) {
    if (c.idCompte !== null && !parCompte.has(c.idCompte)) parCompte.set(c.idCompte, c);
  }

  const lignes = comptes.map((compte) => {
    const ligne = ligneBase(compte, favoris, exclus);
    const client = parCompte.get(compte.id);
    if (!client) return ligne;

    ligne.pid = client.pid;
    ligne.personnage = client.personnage;
    ligne.classe = client.classe;
    ligne.etat = intercepte.has(client.pid) ? 'intercepte' : 'non-intercepte';
    ligne.estMaitre = client.pid === maitre;
    return ligne;
  });

  // Les clients sans compte connu sont ajoutes a la fin plutot qu'ignores.
  for (const c of clients) {
    if (c.idCompte !== null) continue;
    lignes.push({
      id: null,
      nickname: `client ${c.pid}`,
      personnage: c.personnage,
      classe: c.classe,
      pid: c.pid,
      favori: false,
      exclu: false,
      etat: 'inconnu',
      estMaitre: c.pid === maitre,
    });
  }

  return lignes;
}

module.exports = { construireVue };
