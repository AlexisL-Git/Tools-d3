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
// On emet donc sur les deux jalons qui PRECEDENT un debut de tour possible:
// la fin du tour d'un autre, et le compteur. Un jxy hors tour etant ignore,
// un declencheur imprecis coute des trames inutiles, pas une erreur de jeu.
// Le seul cas ecarte est la fin de NOTRE tour: la, notre tour vient de finir,
// il n'y a rien a passer.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur.

const TYPE_FIN_TOUR = 'jxh';
const TYPE_COMPTEUR = 'jxz';
const CHAMP_PERSONNAGE = 2;
const URL_PASSE = 'type.ankama.com/jxy';

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

// superviseur   — porte emettre(pid, octets) et comptes.get(pid)
// reglages      — { actif, delaiMs }, RELU a chaque trame pour que
//                 l'interrupteur general et le delai prennent effet aussitot
// onCompteRendu — recoit ce qui a ete emis, ou refuse et pourquoi
function creerPasseur({ superviseur, reglages, onCompteRendu = () => {} }) {
  // Plusieurs jalons se succedent avant un meme tour — la fin du tour de
  // chaque adversaire, puis le compteur. Sans memoire, chacun produirait sa
  // trame et un combat a huit inonderait le serveur. On n'essaie donc qu'une
  // fois par tour, et la fin de NOTRE tour rouvre le droit d'essayer.
  const essaye = new Set();
  // Un minuteur en attente par compte, quand un delai est configure.
  const minuteurs = new Map();

  function annuler(pid) {
    const t = minuteurs.get(pid);
    if (t !== undefined) { clearTimeout(t); minuteurs.delete(pid); }
  }

  // etatArme — l'objet d'etat tel qu'il etait au moment de l'armement.
  function emettre(pid, etatArme) {
    minuteurs.delete(pid);

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
    onCompteRendu({ pid, ok: res.ok, raison: res.raison, octets: res.octets });
  }

  return function onTrame({ pid, dir, frame }) {
    if (dir !== 'in' || frame === null) return;

    const finTour = frame.kind === 'event' && frame.type === TYPE_FIN_TOUR;
    const compteur = frame.kind === 'event' && frame.type === TYPE_COMPTEUR;
    if (!finTour && !compteur) return;

    if (!reglages.actif) return;
    const etat = superviseur.comptes.get(pid);
    if (etat === null || !etat.passeTour) return;

    if (etat.characterId === null || etat.characterId === undefined) {
      // Sans characterId, impossible de distinguer la fin de notre tour de
      // celle d'un autre. On s'abstient plutot que d'emettre a l'aveugle.
      onCompteRendu({ pid, ok: false, raison: 'characterId inconnu' });
      return;
    }

    // Notre propre tour vient de finir: rien a passer, et le tour suivant
    // redevient candidat.
    if (finTour && personnageAnnonce(frame) === etat.characterId) {
      annuler(pid);
      essaye.delete(pid);
      return;
    }

    if (essaye.has(pid)) return;
    essaye.add(pid);

    const delai = Math.max(0, Number(reglages.delaiMs) || 0);
    if (delai === 0) { emettre(pid, etat); return; }
    minuteurs.set(pid, setTimeout(() => emettre(pid, etat), delai));
  };
}

module.exports = { creerPasseur, TRAME_PASSE, TYPE_FIN_TOUR, TYPE_COMPTEUR };
