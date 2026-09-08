'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

// L'acceptation automatique des invitations de groupe, et elle seule.
//
// LES TRAMES. Mesurees le 20/08 sur deux clients, puis REMESUREES le 08/09 au
// soir sur quatre apres le patch 3.6.11.12. Le detail et les octets bruts sont
// dans docs/superpowers/specs/2026-08-20-trames-invitation-groupe.md et
// docs/superpowers/specs/2026-09-08-invitation-remappage.md.
//
//   in  event   ikb { 1: invitant, 2: 1, 3: nom, 5: 8, 6: idGroupe, 7: nous }
//   out request ikg { 1: idGroupe }
//
// LA TRAME N'EST PAS CONSTANTE, contrairement au passe-tour: l'identifiant de
// groupe a valu 35949, 36074, 36380 puis 6687 sur quatre mesures. L'acceptation
// recopie le champ 6 de l'invitation dans son champ 1; une invitation qui ne
// porte pas ce champ est refusee plutot qu'acceptee a l'aveugle.
//
// L'INVITANT ET LE DESTINATAIRE ONT ECHANGE LEURS CHAMPS AU PATCH: l'invitant
// est passe du 2 au 1, et nous du 1 au 7. Ce qui suit vaut donc toujours, mais
// sur d'autres numeros — c'est pour cela que CHAMP_INVITANT est une constante
// et non un litteral seme dans le code.
//
// LE CHAMP QUI NOUS DESIGNE N'EST PAS UN INVITANT. Un filtre bati dessus
// comparerait notre propre identifiant, le trouverait toujours, et accepterait
// TOUTES les invitations, inconnus compris, en passant l'essai en jeu sans
// broncher. Trois preuves independantes dans le spec du 20/08, et la mesure du
// 08/09 le reconfirme: les trois `ikb` portent le meme champ 1 — le maitre —
// et un champ 7 different, celui de la mule qui la recoit.
//
// LE FILTRE. Une invitation n'est acceptee que si l'invitant est un AUTRE
// client pilote par l'application. Les characterId sont appris du trafic de
// chaque client, donc connus sans configuration.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur, comme le passeur.

// REMAPPE LE 08/09 AU SOIR, APRES LE PATCH 3.6.11.12. `ijz` et `ijx` ne
// designaient plus rien depuis le patch: la garde `frame.type !==
// TYPE_INVITATION` sortait a chaque trame, rien n'etait jamais emis, et comme
// le compte rendu est en aval de cette garde, PAS UNE LIGNE DE JOURNAL ne le
// disait. Le panneau se rouvrait, l'acceptation se faisait a la main. Le meme
// silence que hdv, echange, passeur et compte le matin du 08/09 —
// invitation.js et songes.js etaient les deux modules restes hors campagne.
//
// LA MESURE: un maitre et trois mules, invitation puis acceptation manuelle
// des trois (journal-invitation.log). Trois `ikb` entrants, un par mule, et
// les trois `ikg` sortants qui suivent au clic — 7,3 s, 9,2 s et 11,8 s plus
// tard, le temps de la main humaine.
//
//   ijz -> ikb   invitation      entrante, kind 2, TOUS LES CHAMPS PERMUTES
//   ijx -> ikg   acceptation     sortante, kind 1, champ 1 inchange
//
// LE NOM SEUL N'AURAIT PAS SUFFI, ET C'EST LE PIEGE DE CE REMAPPAGE. Les six
// champs ont permute:
//
//   role                    avant   apres
//   l invitant                2   ->   1
//   la constante 1            6   ->   2
//   le nom de l invitant      7   ->   3
//   la constante 8            3   ->   5
//   l identifiant de groupe   5   ->   6
//   le destinataire, nous     1   ->   7
//
// Un remappage qui n'aurait touche que le nom aurait lu l'invitant au champ 2
// — qui porte desormais la constante 1, jamais egale a un characterId, donc
// toutes les invitations refusees — et le groupe au champ 5, qui porte la
// constante 8: une acceptation partie sur le groupe « 8 ». C'est exactement ce
// que l'echange a paye le matin meme.
const TYPE_INVITATION = 'ikb';
const CHAMP_INVITANT = 1;
const CHAMP_GROUPE = 6;
const URL_ACCEPTATION = 'type.ankama.com/ikg';

// Vide: les deux noms ci-dessus sont ceux du protocole d'aujourd'hui. Cette
// liste est le rappel de ce qui reste a remesurer apres un patch, et le test
// qui la garde interdit de l'oublier. Voir PERIMES dans src/protocol/omni.js.
const PERIMES = [];

// Meme enveloppe que TRAME_PASSE, a ceci pres que Any.value n'est pas vide:
// il porte l'identifiant du groupe.
//
// KIND 1, ET C'EST UNE MESURE. Le patch 3.6.11.12 a echange les numeros de
// l'enveloppe: 63 requetes sortantes du 08/09 partent toutes en kind 1, les
// 244 events entrants en kind 2 (cf. src/codec/rawProto.js). Emise en kind 2,
// l'acceptation serait un EVENEMENT, et le serveur n'y repondrait pas. C'est
// le meme defaut que le remappage de l'echange a nomme « celui qui aurait
// fait le plus de degats »: la fonction agit, et agit a cote.
function construireAcceptation(idGroupe) {
  return encodeRaw([
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: URL_ACCEPTATION },
        { no: 2, wire: WIRE.LEN, kind: 'message', value: [
          { no: 1, wire: WIRE.VARINT, value: idGroupe },
        ] },
      ] },
      // uid = -1, comme toutes les requetes observees.
      { no: 2, wire: WIRE.VARINT, value: -1n },
    ] },
  ]);
}

const champ = (frame, no) => (frame.payload || []).find((f) => f.no === no) || null;

// superviseur   — porte emettre(pid, octets), comptes.get(pid) et comptes.tous
// reglages      — { actif }, RELU a chaque trame pour que l'interrupteur
//                 general prenne effet aussitot
// onCompteRendu — recoit ce qui a ete emis, ou refuse et pourquoi
// masquer       — (pid, brute) appele pour l'invitation REELLEMENT acceptee,
//                 afin qu'elle n'atteigne jamais le client: sans cela son
//                 panneau reste affiche pour toujours. Le pourquoi est
//                 demontre dans src/masque.js. Inerte par defaut, comme
//                 partout ailleurs ici: ne rien fournir ne change rien.
function creerAccepteur({ superviseur, reglages, onCompteRendu = () => {}, masquer = () => {} }) {
  return function onTrame({ pid, dir, frame, brute }) {
    if (dir !== 'in' || frame === null || frame === undefined) return;
    if (frame.type !== TYPE_INVITATION) return;

    // Une invitation est un evenement rare: dire pourquoi on ne l'accepte pas
    // ne coute rien et repond a la seule question que l'utilisateur se pose.
    const refus = (raison) => onCompteRendu({ pid, ok: false, raison });

    if (!reglages.actif) return refus('invitation ignoree : interrupteur general eteint');
    const etat = superviseur.comptes.get(pid);
    if (etat === null || etat === undefined) return refus('invitation ignoree : compte inconnu du superviseur');
    if (!etat.accepteInvitation) return refus('invitation ignoree : acceptation eteinte pour ce compte');

    const invitant = champ(frame, CHAMP_INVITANT);
    if (invitant === null) return refus('invitation refusee : aucun invitant dans la trame');

    // Un AUTRE de nos clients: notre propre identifiant designe le
    // destinataire, pas un invitant.
    const notres = superviseur.comptes.tous
      .filter((e) => e.pid !== pid && e.characterId !== null && e.characterId !== undefined)
      .map((e) => e.characterId);
    if (!notres.some((id) => id === invitant.value)) {
      return refus(`invitation refusee : invitant ${invitant.value} inconnu de l'application`);
    }

    const groupe = champ(frame, CHAMP_GROUPE);
    if (groupe === null) return refus('invitation refusee : aucun identifiant de groupe dans la trame');

    const res = superviseur.emettre(pid, construireAcceptation(groupe.value));
    // Masquee SEULEMENT si l'acceptation est partie. Si elle a echoue, le
    // panneau doit rester: il porte alors la seule invitation encore
    // acceptable, a la main.
    if (res.ok) masquer(pid, brute);
    onCompteRendu({ pid, ok: res.ok, raison: res.raison, octets: res.octets, groupe: groupe.value });
  };
}

module.exports = {
  creerAccepteur, construireAcceptation, TYPE_INVITATION, CHAMP_INVITANT, CHAMP_GROUPE,
  PERIMES,
};
