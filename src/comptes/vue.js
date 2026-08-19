'use strict';

// Croise les comptes du launcher et les clients en cours pour produire l'etat
// affichable. Fonction pure: ni fichier, ni process, ni reseau.
//
// Cinq etats possibles, dont le troisieme est le plus important:
//   hors-ligne       le compte existe, aucun client ne tourne
//   intercepte       un client tourne et passe par notre proxy
//   non-intercepte   un client tourne mais s'est connecte avant l'application
//   erreur           l'attache a echoue: ce client ne suivra rien
//   inconnu          un client tourne sans compte identifiable
//
// Un client lance avant l'application a etabli sa session hors du proxy et ne
// peut pas etre rattrape. Le dire explicitement evite a l'utilisateur de
// chercher pourquoi ce compte ne suit pas. Meme raison pour `erreur`: un
// client dont frida.attach a echoue affiche comme « suit » ferait attendre un
// rejeu qui n'arrivera jamais.
//
// Chaque ligne porte en plus un `message`: la derniere raison utile pour ce
// client — echec d'attache, ou refus rendu par rejouer() (« manque
// skillInstanceUid pour l'element N »). Sans lui, un compte qui ne rejoue pas
// est indiscernable d'un compte inactif. null quand il n'y a rien a dire.

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
    message: null,
  };
}

function construireVue({
  comptes, clients, intercepte, maitre, exclus, favoris,
  erreurs = new Map(), messages = new Map(),
}) {
  const parCompte = new Map();
  for (const c of clients) {
    if (c.idCompte !== null && !parCompte.has(c.idCompte)) parCompte.set(c.idCompte, c);
  }

  // Un client en erreur n'est pas intercepte, quoi qu'en dise l'appelant: son
  // agent n'est pas en place. L'erreur prime donc sur les autres libelles.
  const etatDe = (pid, defaut) => (erreurs.has(pid) ? 'erreur' : defaut);
  const messageDe = (pid) => erreurs.get(pid) ?? messages.get(pid) ?? null;

  const lignes = comptes.map((compte) => {
    const ligne = ligneBase(compte, favoris, exclus);
    const client = parCompte.get(compte.id);
    if (!client) return ligne;

    ligne.pid = client.pid;
    ligne.personnage = client.personnage;
    ligne.classe = client.classe;
    ligne.etat = etatDe(client.pid, intercepte.has(client.pid) ? 'intercepte' : 'non-intercepte');
    ligne.estMaitre = client.pid === maitre;
    ligne.message = messageDe(client.pid);
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
      etat: etatDe(c.pid, 'inconnu'),
      estMaitre: c.pid === maitre,
      message: messageDe(c.pid),
    });
  }

  return lignes;
}

module.exports = { construireVue };
