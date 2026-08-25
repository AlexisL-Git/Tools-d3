'use strict';

// Croise les comptes du launcher et les clients en cours pour produire l'etat
// affichable. Fonction pure: ni fichier, ni process, ni reseau.
//
// Six etats possibles, dont le quatrieme est le plus important:
//   hors-ligne       le compte existe, aucun client ne tourne
//   intercepte       une trame a ete decodee: le trafic passe par notre proxy
//   en-attente       l'agent est en place, aucune trame encore — trop tot pour
//                    conclure
//   non-intercepte   un client tourne mais s'est connecte avant l'application
//   erreur           l'attache a echoue: ce client ne suivra rien
//   inconnu          un client tourne sans compte connu de la liste
//
// ATTENTION: `intercepte` se prouve par une TRAME OBSERVEE, jamais par une
// attache reussie. L'agent detourne `connect` pour les connexions A VENIR: il
// s'injecte tres bien dans un client deja connecte, dont la session restera
// pourtant hors du proxy. C'est le faux positif du 22/08 — client lance a
// 13:09, application a 14:27, affiche « suit », incapable de rejouer quoi que
// ce soit. Un client attache sans trafic et un client irrattrapable produisent
// le meme silence; seule la trame les separe.
//
// `en-attente` existe pour ne pas remplacer ce faux positif par un faux
// negatif: entre l'attache et la premiere trame il s'ecoule une seconde ou
// deux, pendant lesquelles « relance ce client » serait un mauvais conseil.
// C'est l'appelant qui borne cette fenetre — la vue reste une fonction pure.
//
// Un client lance avant l'application a etabli sa session hors du proxy et ne
// peut pas etre rattrape. Le dire explicitement evite a l'utilisateur de
// chercher pourquoi ce compte ne suit pas. Meme raison pour `erreur`: un
// client dont frida.attach a echoue affiche comme « suit » ferait attendre un
// rejeu qui n'arrivera jamais.
//
// Trois champs completent l'etat:
//   suivi      une trame a prouve que ce client passe par notre proxy. C'est
//              lui qui compte les « comptes en jeu »: il ne vaut vrai que sur
//              preuve.
//   pilotable  l'agent est en place — trafic prouve ou fenetre d'attente. Ce
//              n'est PAS `etat` qui en decide: un client passe par notre proxy
//              mais absent de la liste Zaap s'affiche « compte inconnu » tout
//              en etant parfaitement pilotable.
//   message    derniere raison utile pour cette ligne — echec d'attache, ou
//              refus rendu par rejouer() (« manque skillInstanceUid pour
//              l'element N »). null quand il n'y a rien a dire.

function ligneBase(compte, favoris, exclus, passeTour, invitation, noAnim, echange) {
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
    echange: echange.has(compte.id),
    etat: 'hors-ligne',
    estMaitre: false,
    suivi: false,
    pilotable: false,
    eligibleMaitre: false,
    message: null,
  };
}

function construireVue({
  comptes, clients, intercepte, maitre, exclus, favoris, passeTour = new Set(),
  invitation = new Set(), noAnim = new Set(), echange = new Set(), enAttente = new Set(),
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

  // L'ordre compte: la preuve (une trame) avant l'attente, l'attente avant le
  // constat d'echec. `erreur` passe devant tout, via etatDe.
  const etatClient = (pid, defaut) => {
    if (intercepte.has(pid)) return etatDe(pid, defaut);
    if (enAttente.has(pid)) return etatDe(pid, 'en-attente');
    return etatDe(pid, 'non-intercepte');
  };
  // Un client en erreur n'a pas d'agent en place: ses interrupteurs ne
  // commanderaient rien.
  const pilotableDe = (pid) =>
    !erreurs.has(pid) && (intercepte.has(pid) || enAttente.has(pid));

  // Qui a le droit de COMMANDER, ce qui n est pas qui a le droit d etre
  // pilote. Deux differences avec pilotableDe, chacune payee d une raison.
  //
  // La preuve de trafic est exigee, pas la fenetre d attente: un maitre doit
  // EMETTRE des trames, sinon il n y a rien a repliquer. Avant la premiere
  // trame il n y a par construction aucune action a dupliquer, donc exclure
  // l attente ne coute rien.
  //
  // Un identifiant de compte est exige: le choix est memorise PAR IDENTIFIANT
  // dans favoris.json, et un client dont la ligne de commande n en porte pas
  // ne survivrait pas au redemarrage. Un maitre qui s oublie a chaque
  // lancement est le contraire de ce qui est demande.
  const eligibleMaitreDe = (pid, id) =>
    id !== null && !erreurs.has(pid) && intercepte.has(pid);

  // Les clients repris a la fin sont ceux qu'aucune ligne de compte n'a
  // absorbes: on les suit ici plutot que de tester a nouveau leur idCompte.
  const absorbes = new Set();

  const lignes = comptes.map((compte) => {
    const ligne = ligneBase(compte, favoris, exclus, passeTour, invitation, noAnim, echange);
    const client = parCompte.get(compte.id);
    if (!client) return ligne;
    absorbes.add(client.pid);

    ligne.pid = client.pid;
    ligne.personnage = client.personnage;
    ligne.classe = client.classe;
    ligne.suivi = intercepte.has(client.pid);
    ligne.pilotable = pilotableDe(client.pid);
    ligne.etat = etatClient(client.pid, 'intercepte');
    ligne.estMaitre = client.pid === maitre;
    ligne.eligibleMaitre = eligibleMaitreDe(client.pid, compte.id);
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
      echange: c.idCompte !== null && echange.has(c.idCompte),
      etat: etatClient(c.pid, 'inconnu'),
      estMaitre: c.pid === maitre,
      suivi,
      // Meme piege que passeTour/invitation/noAnim, rencontre trois fois deja:
      // un champ code en dur ici rendrait la ligne indebrayable. Toutes les
      // lignes passent par ce repli si lireComptes() echoue.
      pilotable: pilotableDe(c.pid),
      eligibleMaitre: eligibleMaitreDe(c.pid, c.idCompte),
      message: messageDe(c.pid),
    });
  }

  return lignes;
}

module.exports = { construireVue };
