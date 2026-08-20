'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

// Le passe-tour automatique, et lui seul.
//
// Deux messages, mesures le 20/08 sur un combat a deux personnages dont l'un
// etait pilote par l'autopasse de krm35:
//
//   entrant  jxh { 2: characterId }   debut du tour de CE personnage
//   sortant  jti { 1: 1, 2: 12 }      passer le tour
//
// jxh est DIFFUSE a tous les clients du combat, et porte l'identifiant du
// personnage concerne (-1 pour les monstres). Le filtre sur characterId est
// donc obligatoire: sans lui, chaque compte passerait le tour d'un autre.
//
// Ne pas confondre avec jxz, le compteur de tours du combat, identique pour
// tout le monde. Une premiere version de ce module s'appuyait dessus; un
// combat a deux personnages l'a demontree fausse.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur.

const TYPE_DEBUT_TOUR = 'jxh';
const CHAMP_PERSONNAGE = 2;
const URL_PASSE = 'type.ankama.com/jti';

// La requete est CONSTANTE: ni identifiant, ni numero de tour. On la construit
// une fois pour toutes. Le code 12 est celui de l'autopasse mesuree; l'effet
// est verifiable, le compteur de tours s'incremente 100 ms plus tard.
const CHARGE_PASSE = encodeRaw([
  { no: 1, wire: WIRE.VARINT, value: 1n },
  { no: 2, wire: WIRE.VARINT, value: 12n },
]);

const TRAME_PASSE = encodeRaw([
  { no: 2, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'string', value: URL_PASSE },
      { no: 2, wire: WIRE.LEN, kind: 'bytes', value: CHARGE_PASSE },
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
  // Un minuteur en attente par compte. Toute nouvelle annonce annule celle en
  // cours: c'est le garde-fou. Sans lui, une trame en retard passerait le tour
  // d'un AUTRE personnage — la seule erreur de ce projet qui coute quelque
  // chose en jeu.
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
    // a signaler, c'est une annulation demandee par l'utilisateur. Le
    // characterId et le personnage annonce ne sont PAS revalides ici: ils ont
    // ete verifies a l'armement et ne peuvent pas changer entre-temps.
    if (!reglages.actif) return;
    const etat = superviseur.comptes.get(pid);
    // On compare l'IDENTITE de l'objet, pas seulement le pid: si le compte a
    // ete retire pendant le delai et que Windows a reattribue le meme pid a un
    // nouveau client Dofus, comptes.get(pid) rend un AUTRE etat. Un minuteur
    // perime emettrait alors sur ce client a un instant arbitraire, hors de
    // tout combat annonce.
    if (etat === null || etat !== etatArme || !etat.passeTour) return;

    const res = superviseur.emettre(pid, TRAME_PASSE);
    onCompteRendu({ pid, ok: res.ok, raison: res.raison, octets: res.octets });
  }

  return function onTrame({ pid, dir, frame }) {
    if (dir !== 'in' || frame === null) return;
    if (frame.kind !== 'event' || frame.type !== TYPE_DEBUT_TOUR) return;

    // Toute annonce de tour annule l'attente en cours, y compris celle qui
    // concerne un autre personnage: elle signifie que notre tour est termine.
    annuler(pid);

    if (!reglages.actif) return;
    const etat = superviseur.comptes.get(pid);
    if (etat === null || !etat.passeTour) return;

    if (etat.characterId === null || etat.characterId === undefined) {
      onCompteRendu({ pid, ok: false, raison: 'characterId inconnu' });
      return;
    }
    // Le filtre qui evite de passer le tour d'un autre combattant.
    if (personnageAnnonce(frame) !== etat.characterId) return;

    const delai = Math.max(0, Number(reglages.delaiMs) || 0);
    if (delai === 0) { emettre(pid, etat); return; }
    minuteurs.set(pid, setTimeout(() => emettre(pid, etat), delai));
  };
}

module.exports = { creerPasseur, TRAME_PASSE, TYPE_DEBUT_TOUR };
