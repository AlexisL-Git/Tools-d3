'use strict';
const { TYPE_LANCEMENT, TYPE_ACCEPTATION } = require('./songes');

// Savoir si un client est EN CE MOMENT dans un songe, et rien d'autre.
//
// POURQUOI CE MODULE EXISTE. Dans un songe, un PNJ donne un boost. Seul le
// maitre doit le prendre — decision de l'utilisateur du 08/09. Or le dialogue
// se rejoue comme le reste: les mules ouvriraient la meme fenetre, choisiraient
// la meme reponse, et prendraient le boost aussi.
//
// LA REGLE EST « PAR LE SONGE », PAS « PAR LA REPONSE ». Bloquer le seul choix
// mesure — `inh { 1 = 81584 }` — tenait en une ligne, et a ete ecarte:
//
//   - cet identifiant n'a ete mesure QU'UNE FOIS. S'il change, la regle cesse
//     de s'appliquer EN SILENCE et les mules reprennent le boost.
//   - les mules ouvriraient quand meme la fenetre du PNJ et la laisseraient
//     OUVERTE: c'est le serveur qui referme, et seulement pour qui a repondu
//     (`kja { 1 = 1 }`, mesure a 255547 ms). Un dialogue reste ouvert peut
//     faire refuser le suivant, donc casser les PNJ des mules APRES le songe.
//
// L'utilisateur a confirme le 08/09 qu'il n'y a AUCUN AUTRE PNJ dans un songe.
// Couper tout dialogue tant qu'on y est ne prive donc de rien.
//
// COMMENT ON SAIT QU'ON Y EST. Mesure du 08/09, journal-dialogue.log:
//
//   241419ms [28800] --> ixm { 1={1=1} }      le maitre lance le songe
//   241484ms [28800] <-- jpw { 1=237781005 }  il y arrive, 65 ms plus tard
//   242059ms [22436] <-- jpw { 1=237781005 }  la mule l'y rejoint
//   253611ms [28800] --> imp { 1=237781005 2=3 3=-20000 }   le dialogue s'y tient
//
// La carte du songe n'est PAS une constante — 237897728 le 29/08, 237781005 le
// 08/09. Elle s'apprend: c'est celle ou l'on arrive juste apres avoir emis un
// lancement ou une acceptation.
//
// ON EN SORT PAR LA MEME PORTE QU'ON Y ENTRE: une arrivee sur une AUTRE carte.
// Il n'y a donc aucun message de sortie a connaitre, et aucune symetrie a
// maintenir — c'est ce qui rend ce suivi si court.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du reseau: il se teste en
// lui donnant des trames et une horloge.

// L'arrivee sur une carte. Le message s'appelait `jru` et portait la carte en
// champ 2; depuis le patch 3.6.11.12 il s'appelle `jpw` et la porte en 1.
const TYPE_ARRIVEE = 'jpw';
const CHAMP_CARTE = 1;

// 65 ms mesures entre le lancement et l'arrivee. Meme fenetre que
// FENETRE_SONGE dans src/songes.js, et pour la meme raison: 30 fois la marge,
// assez large pour un hoquet, assez etroite pour qu'un lancement REFUSE ne
// laisse pas la prochaine carte — celle d'un simple deplacement, des minutes
// plus tard — se faire prendre pour un songe.
const FENETRE_ARRIVEE = 2000;

const champ = (frame, no) => (frame.payload || []).find((f) => f.no === no) || null;

// maintenant — injectee pour que la fenetre se teste sans dormir.
function creerSuiviSonge({ maintenant = () => Date.now() } = {}) {
  // pid -> la carte du songe ou ce client se trouve. ABSENT VEUT DIRE DEHORS:
  // il n'y a pas de second etat a tenir en accord avec celui-ci.
  const carteSonge = new Map();
  // pid -> instant du dernier lancement ou acceptation SORTANT de ce client.
  const attente = new Map();

  function onTrame({ pid, dir, frame }) {
    if (frame === null || frame === undefined) return;

    // Le lancement et l'acceptation ARMENT, par client. Contrairement a
    // l'accepteur de src/songes.js, dont la fenetre est commune a tous les
    // clients, celle-ci est PERSONNELLE: on cherche la carte de CE client, et
    // le songe d'un autre ne dit rien de la sienne.
    //
    // Une acceptation INJECTEE par OMNI ne passe pas ici — elle est ecrite
    // directement sur la socket amont. Une mule n'arme donc jamais, et c'est
    // sans consequence: seul l'etat du MAITRE decide d'un rejeu.
    if (dir === 'out' && frame.kind === 'request'
        && (frame.type === TYPE_LANCEMENT || frame.type === TYPE_ACCEPTATION)) {
      attente.set(pid, maintenant());
      return;
    }

    if (dir !== 'in' || frame.type !== TYPE_ARRIVEE) return;
    const c = champ(frame, CHAMP_CARTE);
    if (c === null) return;

    const arme = attente.get(pid);
    if (arme !== undefined) {
      attente.delete(pid);
      // Dans la fenetre, cette arrivee EST le songe.
      if (maintenant() - arme <= FENETRE_ARRIVEE) { carteSonge.set(pid, c.value); return; }
      // Hors fenetre, l'arrivee n'a rien a voir avec le lancement: on oublie
      // l'armement sans rien conclure, plutot que de baptiser songe une carte
      // atteinte a pied. La suite du traitement s'applique quand meme.
    }

    // Une arrivee sur la carte ou l'on est deja ne fait pas sortir du songe:
    // le serveur peut la renvoyer sans qu'on ait bouge.
    if (carteSonge.get(pid) === c.value) return;

    carteSonge.delete(pid);
  }

  function dansUnSonge(pid) {
    return carteSonge.has(pid);
  }

  return { onTrame, dansUnSonge };
}

module.exports = {
  creerSuiviSonge, TYPE_ARRIVEE, CHAMP_CARTE, FENETRE_ARRIVEE,
};
