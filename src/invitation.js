'use strict';
const { encodeRaw, WIRE } = require('./codec/rawProto');

// L'acceptation automatique des invitations de groupe, et elle seule.
//
// LES TRAMES. Mesurees le 20/08 sur deux clients attaches, invitation depuis A
// puis acceptation a la main sur B, dans les deux sens. Le detail et les octets
// bruts sont dans docs/superpowers/specs/2026-08-20-trames-invitation-groupe.md.
//
// REMESUREES LE 08/09 APRES LE PATCH 3.6.11.12, meme protocole a deux clients,
// journal-groupe.log. Le patch a renomme les deux messages ET RENUMEROTE LEURS
// CHAMPS -- ce second point n'etait pas prevu, l'appariement structurel de
// src/dev/appariement.js reposant sur l'idee que la structure, elle, tient.
// Elle n'a pas tenu ici, et c'est pourquoi `ijz` n'a rendu AUCUN candidat: son
// empreinte d'avant portait le champ 3 en varint et le 7 en longueur, celle
// d'apres les porte dans l'autre sens.
//
//   in  event   ikb { 1: invitant, 2: 1, 3: nom, 5: 8, 6: idGroupe, 7: nous }
//   out request ikg { 1: idGroupe }
//
// LES OCTETS SONT DANS test/fixtures/invitation-ikb.hex et -ikg.hex, tels que
// captures. Les tests les rejouent: c'est la seule preuve qui ne vieillit pas.
//
// LA TRAME N'EST PAS CONSTANTE, contrairement au passe-tour: l'identifiant de
// groupe a valu 35949, 36074, 36380 avant le patch et 7028 apres. L'acceptation
// recopie le champ 6 de l'invitation dans son champ 1; une invitation qui ne
// porte pas ce champ est refusee plutot qu'acceptee a l'aveugle.
//
// L'INVITANT EST AU CHAMP 1 DEPUIS LE PATCH, ET C'ETAIT LE CHAMP 2 AVANT.
// L'ANCIEN COMMENTAIRE DISAIT L'INVERSE, ET IL AVAIT RAISON EN SON TEMPS: c'est
// le piege exact qu'il decrivait, passe de l'autre cote. Un filtre reste sur le
// champ 2 comparerait desormais la constante 1 a nos identifiants, ne la
// trouverait jamais, et refuserait TOUTES les invitations en silence.
//
// LA PREUVE TIENT EN DEUX JOURNAUX, deux sessions, les MEMES personnages:
//
//   03/09  ijz { 1=666951024934  2=676438999334 ... }   1 = nous,     2 = invitant
//   08/09  ikb { 1=676438999334  ... 7=666951024934 }   1 = invitant, 7 = nous
//
// 676438999334 est celui qui invite dans les deux, 666951024934 celui qui recoit.
// Les deux roles ont echange leurs champs; rien d'autre n'a bouge.
//
// LE FILTRE. Une invitation n'est acceptee que si l'invitant est un AUTRE
// client pilote par l'application. Les characterId sont appris du trafic de
// chaque client, donc connus sans configuration.
//
// Ce module ne depend ni d'Electron, ni de Frida, ni du systeme: il se teste
// avec un double du superviseur, comme le passeur.

const TYPE_INVITATION = 'ikb';
const CHAMP_INVITANT = 1;
const CHAMP_GROUPE = 6;
const URL_ACCEPTATION = 'type.ankama.com/ikg';

// Meme enveloppe que TRAME_PASSE, a ceci pres que Any.value n'est pas vide:
// il porte l'identifiant du groupe.
//
// L'ENVELOPPE EST EN CHAMP 1 DEPUIS LE PATCH, elle etait en champ 2 avant.
// C'est la correction qu'Alexis a passee partout ailleurs le 08/09; ce module
// et src/songes.js sont les deux qu'elle n'avait pas atteints. Une requete
// batie sur l'ancien numero ne differe que par son PREMIER OCTET -- 12 au lieu
// de 0a -- et le serveur l'ignore sans rien dire.
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
};
