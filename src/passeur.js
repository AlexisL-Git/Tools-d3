'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

// Le passe-tour automatique, et lui seul.
//
// LA TRAME. Mesuree le 20/08 sur les octets bruts, en cliquant deux fois sur
// le bouton « Passer » du jeu:
//
//   request { content: Any{ type_url: "type.ankama.com/jxy" }, uid: -1 }
//
// jxy ne porte AUCUN champ. La trame ne designe donc personne: le serveur ne
// peut l'appliquer qu'a l'emetteur, et seulement pendant SON tour. Passer le
// tour d'un autre est impossible par construction, et un jxy hors tour est
// simplement ignore.
//
// LE DECLENCHEUR: jyj, un evenement ENTRANT et VIDE.
//
// Mesure le 27/08 sur un combat de groupe, les deux clients journalises. Sur
// 9 jyj recus, chacun suit de 2 a 39 ms un `jzc { 1: characterId }` portant
// l'identifiant de CE client — et les 49 jzc portant l'identifiant d'un autre
// combattant n'en ont produit aucun. Aucun orphelin dans un sens ni dans
// l'autre. jyj est donc personnel, et il ne porte aucun champ parce qu'il n'a
// rien a dire de plus que « c'est ton tour ».
//
// Il faut les deux messages pour comprendre le combat, mais un seul pour agir:
//
//   jzc { 1: id, 7: rang, 8: manche }   debut du tour de ce combattant
//   jyj { }                             c'est NOTRE tour  <- declencheur
//   jxh { 2: id }                       FIN du tour de ce combattant
//
// REMESURE LE 08/09, patch 3.6.11.12, sur un combat 2v2 de six tours. Les trois
// messages ont ete renommes, et le champ de la fin de tour a change de numero:
//
//   jzc -> jxl { 1: id, 3: {...} }      debut du tour
//   jyj -> juu { }                      c'est NOTRE tour
//   jxh -> jvn { 1: id }                FIN du tour        champ 2 -> 1
//   jxy -> jvv { }                      passer             kind 2 -> 1
//
// DEUX DE CES QUATRE SONT VIDES, donc inapparaissables a l'empreinte: le vide
// est la forme la plus repandue du flux. Ils ont ete identifies par le COMPTE
// et la CADENCE — 12 juu pour six tours a deux personnages, un par client et
// par tour, parfaitement alternes; 11 jvv pour onze clics sur « Passer ».
// Aucun orphelin ni d'un cote ni de l'autre, comme le 27/08.
//
// CE QUI NE MARCHAIT PAS, ET POURQUOI. Le passeur tirait sur jxh, la fin du
// tour du combattant precedent, en la prenant pour le debut du notre. Le
// serveur ouvre en realite notre tour ~400 ms plus tard: sur le combat mesure,
// TOUS les envois partis a l'instant du jxh ont ete ignores, sans exception.
//
// Le defaut se voyait a peine sur le maitre et pas du tout sur une mule, et
// c'est ce qui l'a rendu si difficile a cerner. Le maitre jouait en premier:
// les relances armees sur le compteur de manche finissaient par tomber dans la
// fenetre utile, et son tour passait — tard, mais il passait. Une mule qui
// joue en deuxieme ou en cinquieme n'avait plus une seule trame dans la
// fenetre. « En solo ca marche, en groupe non » decrivait en fait « sur le
// premier a jouer ca marche, sur les autres non ».
//
// jxh a ete lu tour a tour comme une fin de tour et comme un debut, chaque
// lecture expliquant aussi bien les intervalles observes. Ce qui a tranche
// n'est pas une correlation de plus mais une CAUSALITE: un vrai clic sur
// « Passer » a 72526 ms a produit le jxh portant notre characterId a 72560 ms,
// 34 ms plus tard. jxh est bien une fin de tour — celle que notre propre clic
// venait de provoquer.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur.

const TYPE_MON_TOUR = 'juu';
const TYPE_FIN_TOUR = 'jvn';
const CHAMP_PERSONNAGE = 1;
const URL_PASSE = 'type.ankama.com/jvv';

// Relances, au cas ou le premier jxy se perde ou arrive trop tot.
//
// ELLES NE COUTENT RIEN QUAND LA PREMIERE TRAME SUFFIT: le tour se termine
// ~40 ms plus tard, la fin de notre tour les annule, et aucune n'atteint son
// echeance. Une trame part en plus seulement si le tour dure encore, c'est-a-
// dire si le premier essai a echoue. C'est l'inverse des relances precedentes,
// armees a l'aveugle sur le compteur de manche: celles-la partaient toutes.
const RELANCES_MS = [400, 1000, 2000];

// La requete est CONSTANTE et vide. On la construit une fois pour toutes.
const TRAME_PASSE = encodeRaw([
  { no: 1, wire: WIRE.LEN, kind: 'message', value: [
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
  // Les relances en attente, par compte. Elles n'ont de sens que pendant NOTRE
  // tour: des qu'il se termine, elles ne peuvent plus rien passer.
  const minuteurs = new Map();   // pid -> Set de timeouts annulables

  function programmer(pid, fn, delai) {
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
  // declencheur — repris tel quel dans le compte rendu: sans lui, l'ordre des
  //               lignes de journal est le seul indice, et il ne suffit pas.
  function emettre(pid, etatArme, declencheur) {
    // Coupe-circuit immediat: si l'interrupteur a ete eteint pendant le delai,
    // ou le compte desactive, l'envoi programme s'annule silencieusement. Ce
    // n'est pas un refus a signaler, c'est une annulation demandee.
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

    // La fin de NOTRE tour: il n'y a plus rien a passer, et toute relance en
    // attente est desormais sans objet. C'est ce qui rend les relances
    // gratuites dans le cas nominal.
    if (frame.type === TYPE_FIN_TOUR) {
      const etat = superviseur.comptes.get(pid);
      if (etat !== null && etat.characterId !== null && etat.characterId !== undefined
        && personnageAnnonce(frame) === etat.characterId) annuler(pid);
      return;
    }

    if (frame.type !== TYPE_MON_TOUR) return;

    // jyj arrive une fois par tour, et seulement pour NOUS: on peut dire a
    // chaque fois pourquoi rien ne part, sans noyer le journal.
    const dire = (raison) => onCompteRendu({ pid, ok: false, raison });

    if (!reglages.actif) { dire('notre tour : interrupteur general eteint'); return; }
    const etat = superviseur.comptes.get(pid);
    if (etat === null) { dire('notre tour : compte inconnu du superviseur'); return; }
    if (!etat.passeTour) { dire('notre tour : passe-tour eteint pour ce compte'); return; }

    // Le characterId n'est plus exige. Il ne sert qu'a reconnaitre la fin de
    // notre tour, donc a arreter les relances: sans lui elles iront a leur
    // terme, ce qui coute quelques trames ignorees, pas un tour perdu.
    const delai = Math.max(0, Number(reglages.delaiMs) || 0);
    if (delai === 0) emettre(pid, etat, TYPE_MON_TOUR);
    else programmer(pid, () => emettre(pid, etat, TYPE_MON_TOUR), delai);

    for (const t of RELANCES_MS) {
      programmer(pid, () => emettre(pid, etat, `${TYPE_MON_TOUR} relance ${t}`), delai + t);
    }
  };
}

module.exports = {
  creerPasseur, TRAME_PASSE, TYPE_MON_TOUR, TYPE_FIN_TOUR, CHAMP_PERSONNAGE,
};
