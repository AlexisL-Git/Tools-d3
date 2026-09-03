'use strict';
const { encodeRaw, decodeRaw, WIRE } = require('../codec/rawProto');

// Les trames de la chasse: ce qu'on emet, ce qu'on lit.
//
// Mesure du 2026-09-03, journal-chasse1.log, conception dans
// docs/superpowers/specs/2026-09-03-pda-archi-design.md. La requete
// construite ici reproduit celle que le jeu emet quand on equipe a la main.
//
// Fonctions pures: ni Electron, ni Frida, ni reseau.

// La meme enveloppe que src/hdv/trames.js: request { content: Any{ type_url,
// value }, uid: -1 }.
const v = (no, valeur) => ({ no, wire: WIRE.VARINT, value: BigInt(valeur) });

function requete(type, champs) {
  const contenu = [{ no: 1, wire: WIRE.LEN, kind: 'string', value: `type.ankama.com/${type}` }];
  if (champs.length > 0) contenu.push({ no: 2, wire: WIRE.LEN, kind: 'message', value: champs });
  return encodeRaw([
    { no: 2, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: contenu },
      // uid = -1, comme toutes les requetes observees depuis le 20/08.
      { no: 2, wire: WIRE.VARINT, value: -1n },
    ] },
  ]);
}

// --- Ce qu'on emet -------------------------------------------------------

// iuk { 1: quantite, 2: uid de la pile, 3: position }
//
// LE CLIENT DEPLACE LA PILE ENTIERE quand il equipe, pas une unite: mesure du
// 03/09, une pile de 89 s'equipe en un seul ordre a 89.
//
// LE SERVEUR DESEQUIPE TOUT SEUL. Poser une pile en 31 renvoie en 63 celle qui
// s'y trouvait, sans qu'on ait rien a demander: un ordre suffit.
function trameEquiper({ uid, qte, position }) {
  return requete('iuk', [v(1, qte), v(2, uid), v(3, position)]);
}

// --- Ce qu'on lit --------------------------------------------------------

const champ = (payload, no) => (payload || []).find((f) => f.no === no) || null;
const tous = (payload, no) => (payload || []).filter((f) => f.no === no);

function entier(payload, no) {
  const f = champ(payload, no);
  if (f === null || f.wire !== WIRE.VARINT) return null;
  return Number(f.value);
}

// UN CHAMP LEN EST AMBIGU PAR CONSTRUCTION, et rawProto.js le rappelle: une
// chaine, un sous-message et une suite d'octets sont indiscernables sans
// schema, donc le decodeur DEVINE. Un sous-message peut tres bien revenir en
// 'bytes'. On le redecode alors nous-memes plutot que de croire le kind, qui
// est exactement le piege ayant fait refuser a tort des chemins de deplacement.
function sousMessage(f) {
  if (f === null || f === undefined) return null;
  if (Array.isArray(f.value)) return f.value;
  if (Buffer.isBuffer(f.value)) {
    try {
      const d = decodeRaw(f.value);
      return d.length > 0 ? d : null;
    } catch (e) { return null; }
  }
  return null;
}

// ivq { 1: uid, 2: nouvelle position } est la confirmation d'un deplacement,
// rendue en 40 ms a la mesure. C'est elle qu'on attend, pas un delai.
function lirePosition(frame) {
  if (!frame || frame.type !== 'ivq') return null;
  const uid = entier(frame.payload, 1);
  const pos = entier(frame.payload, 2);
  if (uid === null || pos === null) return null;
  return { uid, pos };
}

// kmu { 2: identifiant d'un acteur } dit qu'un acteur QUITTE LA CARTE. Un
// groupe de monstres attaque la quitte, donc c'est bien le signal du combat.
//
// MAIS ELLE NE PARLE PAS QUE DE COMBAT, et c'est la lecon du 03/09 au soir:
// chaque joueur qui s'en va en produit une aussi. La premiere mesure avait
// donne `kmu { 2=-20000 }` juste au demarrage du combat, et on en avait
// conclu trop vite qu'elle nommait le groupe attaque. Sur une carte frequentee,
// elle tombe des dizaines de fois pour rien.
//
// LE SIGNE FAIT LE TRI, et lui seul: un groupe de monstres porte un
// identifiant NEGATIF, un joueur porte le sien, grand et positif. Meme critere
// que src/abandon-combat.js pour distinguer un monstre d'un joueur.
//
// Verifie le 03/09: les DEUX clients recoivent le meme `kmu { 2=-20004 }` a
// 6 ms d'intervalle. La trame sortante `hqa`, elle, n'est emise que par le
// maitre: elle n'aurait pas convenu.
function lireGroupeAttaque(frame) {
  if (!frame || frame.type !== 'kmu') return null;
  const id = entier(frame.payload, 2);
  if (id === null || id >= 0) return null;
  return id;
}

// jss, la liste des acteurs de la carte:
//
//   5 (repete) = un acteur
//     3 = son identifiant, NEGATIF pour un groupe de monstres
//     2.1.4 = les infos de groupe, absentes chez un joueur
//       2 = le bloc des monstres, un sous-message chacun:
//           { 1: identifiant du monstre, 2: NIVEAU, 4: grade }
//
// LE NIVEAU EST DANS LA TRAME. Aucune donnee de reference n'est necessaire, ni
// fichier de monstres ni DofusDB: verifie le 03/09 contre DofusDB sur quatre
// monstres, exact au niveau pres.
//
// LE BLOC MELANGE DEUX NUMEROS DE CHAMP: le 2 est la creature qui mene le
// groupe, le 1 les autres, repete. On ne fait pas la difference, la regle ne
// demandant que le maximum, donc on lit toutes les entrees du bloc.
function lireGroupes(frame) {
  const groupes = new Map();
  if (!frame || frame.type !== 'jss') return groupes;
  for (const acteur of tous(frame.payload, 5)) {
    const a = sousMessage(acteur);
    if (a === null) continue;
    const id = entier(a, 3);
    // UN IDENTIFIANT POSITIF EST UN JOUEUR, et il n'a pas d'infos de groupe.
    if (id === null || id >= 0) continue;
    const bloc = sousMessage(champ(
      sousMessage(champ(sousMessage(champ(sousMessage(champ(a, 2)), 1)), 4)), 2,
    ));
    if (bloc === null) continue;
    let niveauMax = 0;
    let monstres = 0;
    for (const f of bloc) {
      const m = sousMessage(f);
      const niveau = entier(m, 2);
      if (entier(m, 1) === null || niveau === null) continue;
      monstres += 1;
      if (niveau > niveauMax) niveauMax = niveau;
    }
    if (monstres > 0) groupes.set(id, { niveauMax, monstres });
  }
  return groupes;
}

module.exports = { trameEquiper, lirePosition, lireGroupeAttaque, lireGroupes };
