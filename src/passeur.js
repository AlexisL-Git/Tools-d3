'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

// Le passe-tour automatique, et lui seul.
//
// LA TRAME. Mesuree le 20/08 sur les octets bruts, en cliquant deux fois sur
// le bouton « Passer » du jeu:
//
//   request { content: Any{ type_url: "type.ankama.com/jxy" }, uid: -1 }
//
// Les deux fois, le tour s'est termine 30 ms plus tard, a 1,5 s puis a 21,7 s
// du debut du tour. Aucun autre tour de la capture ne portait de jxy: tous ont
// dure les 36,0 s du chronometre complet. jxy ne porte AUCUN champ.
//
// Consequence importante: la trame ne designe personne. Le serveur ne peut
// l'appliquer qu'a l'emetteur, et seulement pendant SON tour. Passer le tour
// d'un autre combattant est impossible par construction; emettre hors de son
// tour ne coute qu'une trame ignoree.
//
// LE DECLENCHEUR: jxh { 2: characterId }, le DEBUT du tour de ce personnage.
//
//   jxh { 2: characterId }   debut du tour de ce personnage (-1 pour un monstre)
//   jxz { 2: numero }        compteur de manches du combat, diffuse a tous
//
// La preuve est celle du 20/08 sur un combat a deux, en ecoutant l'autopasse
// de krm35 pendant qu'elle fonctionnait: sa passe partait 16 ms apres un jxh
// portant SON PROPRE characterId, et le compteur jxz s'incrementait 100 ms
// plus tard. Quatre fois de suite. La causalite est mesuree, pas supposee.
//
// CE QUI AVAIT ETE LU A L'ENVERS. jxh a ete pris pour une FIN de tour: les
// tours du joueur duraient 36,0 s et « se terminaient » sur ce message. Le
// chiffre etait juste, la lecture fausse — 36,0 s est le chronometre COMPLET,
// donc un tour ouvert par jxh et jamais passe. Le passeur a donc ecarte notre
// propre jxh, et pire, annule sur lui les envois en attente. Il n'emettait
// plus que sur les jalons des AUTRES combattants, c'est-a-dire toujours trop
// tot.
//
// Le defaut etait invisible en solo, et seulement en solo: seul joueur, notre
// tour commence juste apres le compteur de manche, sur lequel le passeur
// emettait aussi. La coincidence tenait lieu de declencheur. En groupe, notre
// tour est troisieme ou cinquieme: le tir du compteur part une manche trop
// tot, chaque jalon adverse ouvre le tour de quelqu'un d'autre, et notre vrai
// debut de tour declenchait une annulation. Ne restaient que les relances
// d'ouverture, non annulables — d'ou un passe-tour qui marchait « parfois ».
//
// Le meme journal du 20/08 le disait deja sans etre entendu: a l'ouverture
// d'un combat, un jxh portant notre characterId arrive 29 ms apres le
// compteur, « avant que le moindre tour ait pu avoir lieu ». Ce n'etait pas
// une anomalie: c'est notre premier tour qui s'ouvre.
//
// LES JALONS DE REPLI. On continue d'emettre sur le debut du tour des autres
// combattants et sur le compteur. Ils ne sont plus le declencheur, mais ils ne
// coutent qu'une trame ignoree et couvrent le cas ou notre jxh n'arriverait
// pas. Le compte rendu nomme le jalon qui a tire: c'est lui, et lui seul, qui
// permet de savoir apres coup ce qui a reellement passe le tour.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur.

const TYPE_DEBUT_TOUR = 'jxh';
const TYPE_COMPTEUR = 'jxz';
const CHAMP_PERSONNAGE = 2;
const URL_PASSE = 'type.ankama.com/jxy';
// Relances echelonnees apres le compteur de manche.
//
// L'ouverture d'un combat n'accepte pas tout de suite le passe-tour: les
// durees mesurees donnent 383 ms par manche en regime etabli, mais 2754 ms
// pour la premiere — et les trois jxy emis dans la premiere seconde y sont
// tous restes sans effet, alors que la meme trame passe le tour des que le
// combat tourne. Une relance unique a 700 ms ne couvrait donc pas la fenetre.
//
// Elles ne sont armees qu'a l'OUVERTURE, c'est-a-dire sur le compteur a 1: le
// champ 2 de jxz est le numero de manche, deux combats mesures le montrent
// (1..12 pour le premier, puis retour a 1 pour le second). Les armer a chaque
// manche coutait cinq trames pour rien.
const RELANCES_MS = [700, 1400, 2100, 2800, 3500];
const PREMIERE_MANCHE = 1n;

// La requete est CONSTANTE et vide. On la construit une fois pour toutes.
const TRAME_PASSE = encodeRaw([
  { no: 2, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'string', value: URL_PASSE },
      // Pas de champ 2: Any.value est vide, et un champ vide ne s'ecrit pas.
    ] },
    // uid = -1, comme toutes les requetes observees.
    { no: 2, wire: WIRE.VARINT, value: -1n },
  ] },
]);

function personnageAnnonce(frame) {
  const f = (frame.payload || []).find((x) => x.no === CHAMP_PERSONNAGE);
  return f === undefined ? null : f.value;
}

// Le meme champ 2, sur jxz, porte le numero de manche.
function estPremiereManche(frame) {
  const n = personnageAnnonce(frame);
  if (n === null) return false;
  try { return BigInt(n) === PREMIERE_MANCHE; } catch { return false; }
}

// superviseur   — porte emettre(pid, octets) et comptes.get(pid)
// reglages      — { actif, delaiMs }, RELU a chaque trame pour que
//                 l'interrupteur general et le delai prennent effet aussitot
// onCompteRendu — recoit ce qui a ete emis, ou refuse et pourquoi
function creerPasseur({ superviseur, reglages, onCompteRendu = () => {} }) {
  // Aucun envoi programme n'est annule. Rien ne le justifie: jxy ne vise que
  // son emetteur et pendant son seul tour, donc un envoi devenu tardif est
  // ignore par le serveur, pas dangereux. C'est l'annulation qui coutait des
  // tours — elle tombait pile au debut du notre.
  //
  // Le coupe-circuit reste entier: les conditions sont RELUES a l'echeance
  // dans emettre(), donc eteindre un interrupteur pendant le delai empeche
  // toujours l'envoi.
  function programmer(fn, delai) { setTimeout(fn, delai); }

  // etatArme    — l'objet d'etat tel qu'il etait au moment de l'armement.
  // declencheur — le jalon qui a arme l'envoi, repris tel quel dans le compte
  //               rendu: sans lui, l'ordre des lignes de journal est le seul
  //               indice, et il ne suffit pas a savoir quel jalon a tire.
  function emettre(pid, etatArme, declencheur) {
    // L'interrupteur general est un coupe-circuit immediat: s'il a ete
    // eteint pendant le delai, ou que le compte a ete desactive entre-temps,
    // l'envoi programme doit s'annuler silencieusement. Ce n'est pas un refus
    // a signaler, c'est une annulation demandee par l'utilisateur.
    if (!reglages.actif) return;
    const etat = superviseur.comptes.get(pid);
    // On compare l'IDENTITE de l'objet, pas seulement le pid: si le compte a
    // ete retire pendant le delai et que Windows a reattribue le meme pid a un
    // nouveau client Dofus, comptes.get(pid) rend un AUTRE etat.
    if (etat === null || etat !== etatArme || !etat.passeTour) return;

    const res = superviseur.emettre(pid, TRAME_PASSE);
    onCompteRendu({ pid, ok: res.ok, raison: res.raison, octets: res.octets, declencheur });
  }

  return function onTrame({ pid, dir, frame }) {
    if (dir !== 'in' || frame === null) return;

    // On ne filtre PAS sur frame.kind. Le passeur exigeait « event », et jxz
    // n'a jamais declenche la moindre emission dans aucun journal, alors que
    // jxh en declenchait a chaque tour: les deux passent pourtant par le meme
    // diagnostic, qui lui ne regarde que le type. `dir === 'in'` suffit a
    // ecarter ce que le client emet lui-meme.
    const debutTour = frame.type === TYPE_DEBUT_TOUR;
    const compteur = frame.type === TYPE_COMPTEUR;
    if (!debutTour && !compteur) return;

    // Un passe-tour muet ressemble trait pour trait a un combat qui n'arrive
    // pas jusqu'ici. Sur le compteur — un message par manche, donc sans bruit —
    // on dit laquelle des gardes a arrete l'envoi.
    const dire = (raison) => { if (compteur) onCompteRendu({ pid, ok: false, raison }); };

    if (!reglages.actif) { dire('jxz ignore : interrupteur general eteint'); return; }
    const etat = superviseur.comptes.get(pid);
    if (etat === null) { dire('jxz ignore : compte inconnu du superviseur'); return; }
    if (!etat.passeTour) { dire('jxz ignore : passe-tour eteint pour ce compte'); return; }

    if (etat.characterId === null || etat.characterId === undefined) {
      // Sans characterId, impossible de reconnaitre NOTRE jxh parmi ceux de
      // tous les combattants: le seul declencheur fiable est perdu.
      onCompteRendu({ pid, ok: false, raison: 'characterId inconnu' });
      return;
    }

    // Notre propre jxh: notre tour commence. C'est LE declencheur; les autres
    // jalons ne sont que du repli.
    const estNous = debutTour && personnageAnnonce(frame) === etat.characterId;
    const jalon = debutTour
      ? (estNous ? 'jxh moi' : `jxh ${personnageAnnonce(frame)}`)
      : TYPE_COMPTEUR;
    const delai = Math.max(0, Number(reglages.delaiMs) || 0);
    if (delai === 0) emettre(pid, etat, jalon);
    else programmer(() => emettre(pid, etat, jalon), delai);

    // Le compteur ouvre la manche, et rien ne garantit que notre tour soit
    // deja actif quand il arrive — c'est le cas du PREMIER tour d'un combat,
    // le seul que rien d'autre ne precede. Les relances le rattrapent.
    if (compteur && estPremiereManche(frame)) {
      for (const t of RELANCES_MS) programmer(() => emettre(pid, etat, `jxz relance ${t}`), delai + t);
    }
  };
}

module.exports = { creerPasseur, TRAME_PASSE, TYPE_DEBUT_TOUR, TYPE_COMPTEUR };
