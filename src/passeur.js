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
// l'appliquer qu'a l'emetteur. Passer le tour d'un autre combattant est donc
// impossible par construction — c'est ce qui autorise le declencheur large
// ci-dessous.
//
// LE DECLENCHEUR. Le message qui annonce « ton tour commence » n'est pas
// identifie. Deux jalons encadrent le debut d'un tour:
//
//   jxh { 2: characterId }   FIN du tour de ce personnage (-1 pour un monstre)
//   jxz { 2: numero }        compteur de tours, dernier message avant le notre
//                            dans les combats mesures
//
// jxh a longtemps ete lu comme un DEBUT de tour. Les durees mesurees l'ont
// dementi: les tours du joueur duraient 36 s et se terminaient sur ce message.
// S'en servir comme declencheur revenait a passer un tour deja fini.
//
// On emet donc sur TOUS les jalons qui precedent un debut de tour possible:
// chaque fin de tour d'un autre combattant, et le compteur. Un jxy hors tour
// etant ignore, un declencheur imprecis coute des trames inutiles, pas une
// erreur de jeu. Le seul cas ecarte est la fin de NOTRE tour: la, notre tour
// vient de finir, il n'y a rien a passer.
//
// N'essayer QU'UNE FOIS par manche serait tentant pour economiser des trames.
// C'est ce que faisait une version precedente, et elle echouait en
// multicompte: la tentative unique partait des la fin du premier tour de la
// manche, donc bien avant le notre si le personnage jouait en cinquieme
// position, et la manche se terminait sans autre essai. Le nombre de jalons
// est borne par le nombre de combattants, pas par le temps: huit comptes
// coutent huit trames par manche. La borne est acceptable, le limiteur non.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur.

const TYPE_FIN_TOUR = 'jxh';
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
// manche coutait cinq trames pour rien — c'est ce cout qui avait fait ajouter
// une annulation, et l'annulation tuait la seule chose qui servait.
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
  // Les minuteurs en attente par compte. Il peut y en avoir plusieurs: le
  // delai configure par l'utilisateur, et la relance du compteur ci-dessous.
  const minuteurs = new Map();   // pid -> Set de timeouts annulables

  // Les relances d'ouverture ne sont PAS enregistrees ici, donc pas annulables.
  // Le journal du 20/08 dit pourquoi: a l'ouverture, un jxh portant notre
  // propre characterId arrive 29 ms apres le compteur, avant que le moindre
  // tour ait pu avoir lieu. Lu comme « notre tour vient de finir », il annulait
  // les cinq relances, et le premier tour partait au chronometre complet
  // (36,0 s mesurees). On ne sait pas ce qu'annonce ce jxh; on sait qu'il ne
  // doit rien annuler. Une relance qui survit a notre vrai tour ne coute qu'une
  // trame ignoree — le passeur en emet deja une par combattant et par manche.
  function programmer(pid, fn, delai, annulable = true) {
    if (!annulable) { setTimeout(fn, delai); return; }
    let lot = minuteurs.get(pid);
    if (lot === undefined) { lot = new Set(); minuteurs.set(pid, lot); }
    const t = setTimeout(() => { lot.delete(t); fn(); }, delai);
    lot.add(t);
  }

  function annuler(pid) {
    const lot = minuteurs.get(pid);
    if (lot === undefined) return;
    for (const t of lot) clearTimeout(t);
    minuteurs.delete(pid);
  }

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
    const finTour = frame.type === TYPE_FIN_TOUR;
    const compteur = frame.type === TYPE_COMPTEUR;
    if (!finTour && !compteur) return;

    // DIAGNOSTIC TEMPORAIRE. Le compteur ouvre la manche: si le passe-tour
    // reste muet a cet instant, c'est l'une de ces gardes qui l'a arrete, et
    // rien dans le journal ne permettait de dire laquelle.
    const dire = (raison) => { if (compteur) onCompteRendu({ pid, ok: false, raison }); };
    // Avant TOUTE garde: separe « le passeur n'est pas appele » de « une garde
    // l'arrete ». Les deux produisent le meme journal vide.
    dire('jxz vu, avant toute garde');

    if (!reglages.actif) { dire('jxz ignore : interrupteur general eteint'); return; }
    const etat = superviseur.comptes.get(pid);
    if (etat === null) { dire('jxz ignore : compte inconnu du superviseur'); return; }
    if (!etat.passeTour) { dire('jxz ignore : passe-tour eteint pour ce compte'); return; }

    if (etat.characterId === null || etat.characterId === undefined) {
      // Sans characterId, impossible de distinguer la fin de notre tour de
      // celle d'un autre. On s'abstient plutot que d'emettre a l'aveugle.
      onCompteRendu({ pid, ok: false, raison: 'characterId inconnu' });
      return;
    }

    // Notre propre tour vient de finir: rien a passer, et tout envoi encore
    // en attente est desormais sans objet.
    if (finTour && personnageAnnonce(frame) === etat.characterId) {
      annuler(pid);
      return;
    }

    const jalon = finTour ? `jxh ${personnageAnnonce(frame)}` : TYPE_COMPTEUR;
    const delai = Math.max(0, Number(reglages.delaiMs) || 0);
    if (delai === 0) emettre(pid, etat, jalon);
    else programmer(pid, () => emettre(pid, etat, jalon), delai);

    // Le compteur ouvre la manche, et rien ne garantit que notre tour soit
    // deja actif quand il arrive — c'est le cas du PREMIER tour d'un combat,
    // le seul que rien d'autre ne precede. Les relances le rattrapent.
    if (compteur && estPremiereManche(frame)) {
      for (const t of RELANCES_MS) programmer(pid, () => emettre(pid, etat, `jxz relance ${t}`), delai + t, false);
    }
  };
}

module.exports = { creerPasseur, TRAME_PASSE, TYPE_FIN_TOUR, TYPE_COMPTEUR };
