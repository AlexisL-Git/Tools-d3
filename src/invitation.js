'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

// L'acceptation automatique des invitations de groupe, et elle seule.
//
// LES TRAMES. Mesurees le 20/08 sur deux clients attaches, invitation depuis A
// puis acceptation a la main sur B, dans les deux sens. Le detail et les octets
// bruts sont dans docs/superpowers/specs/2026-08-20-trames-invitation-groupe.md.
//
//   in  event   ijz { 1: nous, 2: invitant, 3: 8, 5: idGroupe, 6: 1, 7: nom }
//   out request ijx { 1: idGroupe }
//
// LA TRAME N'EST PAS CONSTANTE, contrairement au passe-tour: l'identifiant de
// groupe a valu 35949, 36074 puis 36380 sur trois mesures. L'acceptation
// recopie le champ 5 de l'invitation dans son champ 1; une invitation qui ne
// porte pas ce champ est refusee plutot qu'acceptee a l'aveugle.
//
// L'INVITANT EST AU CHAMP 2, PAS AU CHAMP 1. L'ordre des champs suggerait
// l'inverse, et le champ 1 porte en fait le destinataire — nous. Un filtre bati
// dessus aurait compare notre propre identifiant, l'aurait toujours trouve, et
// aurait accepte TOUTES les invitations, inconnus compris, en passant l'essai
// en jeu sans broncher. Trois preuves independantes dans le spec.
//
// LE FILTRE. Une invitation n'est acceptee que si l'invitant est un AUTRE
// client pilote par l'application. Les characterId sont appris du trafic de
// chaque client, donc connus sans configuration.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur, comme le passeur.

const TYPE_INVITATION = 'ijz';
const CHAMP_INVITANT = 2;
const CHAMP_GROUPE = 5;
const URL_ACCEPTATION = 'type.ankama.com/ijx';

// Meme enveloppe que TRAME_PASSE, a ceci pres que Any.value n'est pas vide:
// il porte l'identifiant du groupe.
function construireAcceptation(idGroupe) {
  return encodeRaw([
    { no: 2, wire: WIRE.LEN, kind: 'message', value: [
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
};
