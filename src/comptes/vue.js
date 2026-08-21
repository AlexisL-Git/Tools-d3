'use strict';

// Croise les comptes du launcher et les clients en cours pour produire l'etat
// affichable. Fonction pure: ni fichier, ni process, ni reseau.
//
// Cinq etats possibles, dont le troisieme est le plus important:
//   hors-ligne       le compte existe, aucun client ne tourne
//   intercepte       un client tourne et passe par notre proxy
//   non-intercepte   un client tourne mais s'est connecte avant l'application
//   erreur           l'attache a echoue: ce client ne suivra rien
//   inconnu          un client tourne sans compte connu de la liste
//
// Un client lance avant l'application a etabli sa session hors du proxy et ne
// peut pas etre rattrape. Le dire explicitement evite a l'utilisateur de
// chercher pourquoi ce compte ne suit pas. Meme raison pour `erreur`: un
// client dont frida.attach a echoue affiche comme « suit » ferait attendre un
// rejeu qui n'arrivera jamais.
//
// Deux champs completent l'etat:
//   suivi    le client passe par notre proxy, independamment du libelle
//            affiche. C'est lui, et non `etat`, qui dit si une exclusion a un
//            sens: un client au compte inconnu peut tres bien etre intercepte.
//   message  derniere raison utile pour cette ligne — echec d'attache, ou
//            refus rendu par rejouer() (« manque skillInstanceUid pour
//            l'element N »). null quand il n'y a rien a dire.

function ligneBase(compte, favoris, exclus, passeTour, invitation, noAnim) {
  return {
    id: compte.id,
    nickname: compte.nickname,
    personnage: null,
    classe: null,
    pid: null,
    favori: favoris.has(compte.id),
    exclu: exclus.has(compte.id),
    passeTour: passeTour.has(compte.id),
    invitation: invitation.has(compte.id),
    noAnim: noAnim.has(compte.id),
    etat: 'hors-ligne',
    estMaitre: false,
    suivi: false,
    message: null,
  };
}

function construireVue({
  comptes, clients, intercepte, maitre, exclus, favoris, passeTour = new Set(),
  invitation = new Set(), noAnim = new Set(),
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

  // Les clients repris a la fin sont ceux qu'aucune ligne de compte n'a
  // absorbes: on les suit ici plutot que de tester a nouveau leur idCompte.
  const absorbes = new Set();

  const lignes = comptes.map((compte) => {
    const ligne = ligneBase(compte, favoris, exclus, passeTour, invitation, noAnim);
    const client = parCompte.get(compte.id);
    if (!client) return ligne;
    absorbes.add(client.pid);

    ligne.pid = client.pid;
    ligne.personnage = client.personnage;
    ligne.classe = client.classe;
    ligne.suivi = intercepte.has(client.pid);
    ligne.etat = etatDe(client.pid, ligne.suivi ? 'intercepte' : 'non-intercepte');
    ligne.estMaitre = client.pid === maitre;
    ligne.message = messageDe(client.pid);
    return ligne;
  });

  // Tout client qui n'a pas trouve sa ligne est ajoute a la fin plutot
  // qu'ignore. Deux cas: aucun idCompte dans sa ligne de commande, ou un
  // idCompte absent de la liste — un compte ajoute dans Zaap apres le
  // demarrage, la liste n'etant lue qu'une fois. Le second etait invisible: il
  // etait attache et rejoue sans qu'aucune ligne ne permette de l'exclure.
  for (const c of clients) {
    if (absorbes.has(c.pid)) continue;
    const suivi = intercepte.has(c.pid);
    lignes.push({
      // L'identifiant de compte, quand la ligne de commande le porte: c'est
      // lui que l'IPC attend pour exclure ou mettre en favori. Sans lui la
      // ligne reste informative, et la vue qui la consomme doit alors se
      // reperer au pid.
      id: c.idCompte,
      nickname: c.idCompte === null ? `client ${c.pid}` : `compte ${c.idCompte}`,
      personnage: c.personnage,
      classe: c.classe,
      pid: c.pid,
      favori: c.idCompte !== null && favoris.has(c.idCompte),
      exclu: c.idCompte !== null && exclus.has(c.idCompte),
      // Comme favori et exclu: un passe-tour code en dur a faux rendait la
      // case eteinte alors que le compte emettait, donc impossible a debrayer.
      // Le cas n'a rien d'exotique — si lireComptes() echoue, TOUTES les
      // lignes passent par ce repli.
      passeTour: c.idCompte !== null && passeTour.has(c.idCompte),
      invitation: c.idCompte !== null && invitation.has(c.idCompte),
      noAnim: c.idCompte !== null && noAnim.has(c.idCompte),
      etat: etatDe(c.pid, 'inconnu'),
      estMaitre: c.pid === maitre,
      suivi,
      message: messageDe(c.pid),
    });
  }

  return lignes;
}

module.exports = { construireVue };
