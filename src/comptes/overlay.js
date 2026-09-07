'use strict';

// Ce que l'overlay affiche, et rien d'autre.
//
// L'overlay est la petite fenetre flottante posee sur le jeu: un picto de
// classe par compte en jeu, et l'interrupteur du replicate. Il ne decide
// d'aucun comportement — basculer de fenetre, donner la commande et armer le
// replicate sont des ordres qui existaient deja pour le panneau. Ce module ne
// fait qu'une chose: reduire la vue du panneau a ce qu'une barre de pictos
// peut montrer.
//
// POURQUOI UN MODULE A PART. La vue du panneau porte quinze champs par ligne,
// dont dix ne veulent rien dire sur un carre de 36 px. Passer la vue entiere a
// l'overlay obligerait la page a refaire ces choix a chaque rendu, hors de
// portee des tests. Ici, la regle est ecrite une fois et verifiee sans
// Electron, sans jeu et sans reseau.
//
// SEULS LES COMPTES EN JEU. Decide le 2026-08-29 avec Jibef. Un compte hors
// ligne n'a pas de fenetre vers laquelle basculer, son picto ne porterait
// aucun ordre. La contrepartie est connue et acceptee: la barre change de
// largeur quand un client se ferme, donc les pictos se decalent. Les touches
// F2 a F5 restent le moyen fiable de viser sans regarder.
//
// Fonction pure: ni Electron, ni Frida, ni disque.

const { etatColonne } = require('./colonnes');

// L'abreviation qui tient la place d'un embleme pas encore telecharge. Meme
// repli que le panneau: un embleme absent est un defaut d'agrement, jamais une
// panne. Voir src/comptes/emblemes.js.
function abregerClasse(classe) {
  if (typeof classe !== 'string' || classe.trim() === '') return '—';
  return classe.normalize('NFC').trim().slice(0, 3).toUpperCase();
}

// L'ETAT EN UNE PASTILLE, et l'ordre des tests compte.
//
// L'erreur et le defaut d'interception passent devant le suivi: une ligne qui
// se dirait suivie tout en etant en erreur afficherait un cyan rassurant sur
// un client qui ne rejouera rien. C'est precisement le faux positif du 22/08,
// que l'overlay doit rendre visible sans ouvrir le panneau.
//
// L'attente vient ensuite: entre l'attache et la premiere trame il s'ecoule
// une seconde ou deux, pendant lesquelles crier a l'anomalie serait faux.
function pastilleDe(ligne) {
  if (ligne.etat === 'erreur' || ligne.etat === 'non-intercepte') return 'souci';
  if (ligne.suivi) return 'suit';
  if (ligne.etat === 'en-attente') return 'attente';
  return 'souci';
}

// lignes  — la vue construite par src/comptes/vue.js, deja ordonnee par
//           src/comptes/ordre.js et enrichie de `touche` et `embleme` par
//           desktop/main.js.
// enAvant — le pid du client dont la fenetre a le focus, ou null. Vient de
//           superviseur.enAvant, alimente par les agents.
//
// « OU ON EST » N'EST PAS « QUI COMMANDE », et les deux marquages coexistent
// sur le meme picto sans se melanger. Confondre les deux est precisement ce
// qui faisait partir les actions d'un alt chez toute l'equipe des qu'on
// cliquait sa fenetre: `ici` ne fait que MONTRER, il ne decerne rien.
//
// Rend une NOUVELLE liste d'objets plats, sans reference vers les lignes
// recues: elle traverse une frontiere IPC, et un objet partage se modifierait
// des deux cotes sans passer par un envoi d'etat.
function pourOverlay(lignes, enAvant = null) {
  const pictos = [];
  for (const l of lignes || []) {
    if (l.pid === null || l.pid === undefined) continue;
    pictos.push({
      id: l.id ?? null,
      pid: l.pid,
      classe: l.classe ?? null,
      personnage: l.personnage ?? null,
      embleme: l.embleme ?? null,
      abrege: abregerClasse(l.classe),
      touche: l.touche ?? null,
      // Ce que dit l'infobulle: on doit savoir QUI on vise avant de cliquer.
      titre: l.personnage || l.nickname || `client ${l.pid}`,
      commande: Boolean(l.estMaitre),
      // La fenetre devant laquelle on est en ce moment. Null n'est pas une
      // anomalie: c'est le cas des qu'on regarde autre chose qu'un client
      // Dofus, le panneau OMNI compris.
      ici: enAvant !== null && enAvant !== undefined && l.pid === enAvant,
      pastille: pastilleDe(l),
      // basculerVersCompte() prend un identifiant de compte. Un client dont la
      // ligne de commande n'en porte pas s'affiche — sa fenetre est bien
      // reelle — mais son picto ne peut porter aucun ordre.
      cliquable: l.id !== null && l.id !== undefined,
      // Le clic droit donne la commande, et vue.js a deja tranche qui a le
      // droit de la prendre: identifiant connu, pas d'erreur, trafic prouve.
      peutCommander: Boolean(l.eligibleMaitre),
    });
  }
  return pictos;
}

// LE PASSE-TOUR DE LA BARRE, EN DEUX TAS: le meneur d'un cote, les mules de
// l'autre.
//
// Pourquoi deux et pas un. Le titre de colonne « Tour » du panneau pose la meme
// valeur pour tout le monde, et c'est justement ce qu'on ne veut pas ici: en
// combat les mules passent leur tour toutes seules pendant que le meneur joue a
// la main. Il faut pouvoir armer les unes sans armer l'autre, et l'inverse.
// Demande le 2026-09-07.
//
// Rien n'est recalcule a la main: chaque tas passe par etatColonne(_, 'tour')
// de src/comptes/colonnes.js, celui-la meme qui peint le losange du titre de
// colonne. Les deux fenetres ne peuvent donc pas donner deux versions du meme
// etat.
//
// MEME ENSEMBLE QUE LES PICTOS — les comptes en jeu, comme pourOverlay(). Les
// deux tas que basculerTourGroupe touche sont tires du meme ensemble: un compte
// hors ligne compte ferait afficher « partiel » sur une equipe entierement
// alignee, sans rien a cliquer pour la corriger.
//
// Rend { meneur, mules }:
//   meneur — 'actif' | 'eteint' | 'absent'. UN SEUL COMPTE, donc pas de
//            'partiel'. 'absent' n'est PAS un synonyme de 'eteint': sans lui,
//            la moitie gauche du bouton dirait « le meneur ne passe pas son
//            tour » alors qu'il n'y a aucun meneur en jeu — un losange creux
//            qui ment, et un clic qui ne peut rien faire. C'est pour ce
//            troisieme cas que cette fonction existe plutot qu'un appel direct
//            a etatColonne, qui rend 'aucun' pour une liste vide.
//   mules  — 'tous' | 'partiel' | 'aucun', les trois etats habituels.
function etatTour(lignes) {
  const jouables = (lignes || []).filter((l) => l.pid !== null && l.pid !== undefined);
  // Un meneur sans identifiant de compte ne peut rien enregistrer dans le
  // fichier de reglages: meme garde que pertinentes() dans colonnes.js.
  const meneurs = jouables.filter((l) => l.estMaitre && l.id !== null && l.id !== undefined);
  const mules = jouables.filter((l) => !l.estMaitre);
  return {
    meneur: meneurs.length === 0
      ? 'absent'
      : (etatColonne(meneurs, 'tour') === 'tous' ? 'actif' : 'eteint'),
    mules: etatColonne(mules, 'tour'),
  };
}

module.exports = { abregerClasse, pourOverlay, etatTour };
