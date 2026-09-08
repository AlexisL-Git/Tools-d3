'use strict';
const { decodeRaw } = require('../codec/rawProto');

// Les ames capturees, lues dans l inventaire. Fonctions pures: ni trame emise,
// ni reseau, ni disque.
//
// Conception: docs/superpowers/specs/2026-09-04-tableau-archimonstres-design.md.
// Mesure:     docs/superpowers/specs/2026-09-04-trames-ame-pleine.md.
//
// LE CRITERE EST L EFFET, JAMAIS LE GID. Mesure du 04/09: les 143 ames d un
// inventaire portent 143 gids DIFFERENTS, de 6716 a 34274 -- chaque ame est
// son propre objet, `Pichakote le Degoutant` est le gid 34005. Un critere par
// gid demanderait donc la table des 286 gids, qui n existe pas et qui changerait
// a chaque ajout du jeu. L effet, lui, est le meme pour toutes.
//
// LE GID 7010 N EXISTE PAS, contrairement a ce qu annoncait le commentaire de
// pierres.js: aucune des 674 piles mesurees ne le porte.
const EFFET_AME = 4058;

// UN CHAMP LEN EST AMBIGU PAR CONSTRUCTION, et rawProto.js le rappelle: une
// chaine, un sous-message et une suite d octets sont indiscernables sans
// schema, donc le decodeur DEVINE. On le redecode nous-memes plutot que de
// croire le kind -- meme precaution que src/pda-archi/trames.js, et le meme
// piege evite.
//
// ELLE SERT DEUX FOIS ICI, et la seconde compte: decodeFrameRaw s arrete a la
// profondeur 6, or un effet est au septieme niveau. Sans ce redecodage, les
// parametres de l effet reviendraient en octets bruts.
function sousMessage(f) {
  if (f === null || f === undefined) return null;
  if (Array.isArray(f.value)) return f.value;
  const brut = Buffer.isBuffer(f.raw) ? f.raw : (Buffer.isBuffer(f.value) ? f.value : null);
  if (brut === null) return null;
  try {
    const d = decodeRaw(brut);
    return d.length > 0 ? d : null;
  } catch (e) { return null; }
}

const champ = (payload, no) => (payload || []).find((f) => f.no === no) || null;
const tous = (payload, no) => (payload || []).filter((f) => f.no === no);

function entier(payload, no) {
  const f = champ(payload, no);
  if (f === null || f.wire !== 0) return null;
  return Number(f.value);
}

// Un effet d une pile a la meme forme partout:
//
//   { 6 = { les parametres }, 11 = le numero de l effet }
//
// REMESURE LE 08/09, patch 3.6.11.12: l effet porte son numero au CHAMP 1 et
// ses parametres au CHAMP 4, et dans ces parametres l identifiant du monstre
// est passe du champ 1 au CHAMP 3 — le grade, lui, reste a 5.
//
//   effet : 1=4058 4={ 1=5 3=2272 }   ->  Pichakote le Degoutant
//
// La valeur 2272 se relit a l identique dans la capture du 08/09: c est la
// meme creature que celle relevee en aout, ce qui verrouille la lecture.
//
// L ame capturee est l effet 4058, dont le PREMIER PARAMETRE est l identifiant
// du monstre. Le second vaut 5 sur les 143 ames mesurees -- un grade, sans
// doute; il ne sert a rien ici.
//
//   effet : 6={ 1=2272 2=5 } 11=4058   ->  Pichakote le Degoutant
//
// Verification croisee de la meme lecture: l effet 705 des pierres VIDES rend
// 50, 100, 150 et 190, exactement la table des plafonds de pierres.js, etablie
// ailleurs et autrement.
function monstreDe(effet) {
  const c = sousMessage(effet);
  if (c === null || entier(c, 1) !== EFFET_AME) return null;
  return entier(sousMessage(champ(c, 4)), 3);
}

// Les ames d une pile, telle qu elle apparait dans ivx. La forme est celle que
// lit deja src/hdv/trames.js:
//
//   { 1: <position>, 5: { 1: gid, 2: <effets>…, 3: quantite, 4: uid } }
//
// UNE LISTE, MEME SI LA MESURE N EN A JAMAIS VU DEUX. Les 143 piles portent une
// ame chacune, en quantite 1; mais la trame autorise plusieurs effets sur une
// pile, et supposer l inverse couterait cher le jour ou c est faux.
// LE RANGEMENT D OU VIENT LA PILE, champ 5 du detail: { 1: page, 2: rangement }.
//
// Il n apparait QUE dans la reponse a `itr`, jamais dans l `ivx` de connexion --
// et c est ce qui rend le rafraichissement honnete. Mesure du 04/09, en croisant
// les uid de la reponse avec ceux de la connexion:
//
//   rangement 1  474 piles, toutes deja vues a la connexion  -> l inventaire
//   rangement 2  518 piles                                   -> la banque
//   rangement 3   64 piles                                   -> un troisieme
//   absent        16 piles, toutes deja vues                 -> l equipement porte
//
// 474 + 16 = 490, exactement le contenu de la connexion. En ne gardant que le
// rangement 1 et les piles sans rangement, un rafraichissement voit EXACTEMENT
// le meme perimetre qu une reconnexion: les comptes ne sautent pas, et la
// banque -- hors perimetre par decision de Jibef -- n entre pas par cette porte.
const INVENTAIRE = 1;

function estAPortee(detail) {
  const rangement = sousMessage(champ(detail, 4));
  if (rangement === null) return true;
  const no = entier(rangement, 2);
  return no === null || no === INVENTAIRE;
}

function amesDe(el) {
  const e = sousMessage(el);
  const detail = sousMessage(champ(e, 5));
  if (detail === null) return null;
  if (!estAPortee(detail)) return null;
  const uid = entier(detail, 1);
  if (uid === null) return null;
  const monstres = tous(detail, 3).map(monstreDe).filter((m) => m !== null);
  if (monstres.length === 0) return null;
  return { uid, monstres };
}

// ivx { 3: [ pile ] } — l inventaire, livre a la connexion sans rien demander.
// iua { 3: pile } — UNE pile neuve, meme forme et meme numero de champ.
//
// LES DEUX SE LISENT PAREIL, et c est ce qui rend le tableau VIVANT plutot
// qu une photo prise a la connexion: une pierre qui se remplit pendant la
// chasse arrive en `iua`, et coche sa case sans qu on ait rien a demander.
//
// LA BANQUE EST HORS PERIMETRE, decision de Jibef le 04/09: `iwb` n arrive que
// si le joueur ouvre le panneau du banquier, et un tableau a moitie lu ment
// plus qu il n informe.
function lireAmes(frame) {
  if (!frame || (frame.type !== 'isb' && frame.type !== 'isa')) return [];
  const out = [];
  for (const el of tous(frame.payload, 2)) {
    const ames = amesDe(el);
    if (ames !== null) out.push(ames);
  }
  return out;
}

// La collection, personnage par personnage.
//
// ELLE NE GARDE QUE LES AMES. Decoder et conserver les effets des 674 piles
// d un inventaire couterait de la memoire pour rien: on ne retient que les
// piles portant un effet 4058, et d elles que les identifiants de monstres.
//
// ELLE N EMET RIEN. Aucune trame, aucun ordre, aucun aller-retour: `ivx` tombe
// seule a la connexion. C est ce qui rend cette fonction petite, et ce qui la
// distingue de l hotel de vente, ou le flot lui-meme est le risque.
//
// Ce module se teste avec des trames figees, comme src/hdv/stock.js: ni
// Electron, ni Frida, ni systeme.
function creerCollection() {
  // pid -> Map(uid de la pile -> [identifiants de monstres])
  //
  // LA CLE EST L UID, PAS LE MONSTRE, parce que c est l uid que `ium` nomme
  // quand une ame quitte l inventaire. Une collection indexee par monstre ne
  // saurait pas quoi decocher.
  const parCompte = new Map();

  function onTrame({ pid, dir, frame }) {
    // Une trame SORTANTE porte les memes octets mais raconte ce qu on a
    // demande, pas ce que le serveur a repondu. Meme garde que pda-archi.js.
    if (frame === null || frame === undefined || dir !== 'in') return;

    if (frame.type === 'isb') {
      // L INVENTAIRE REMPLACE TOUT: une ame vendue entre deux connexions ne
      // doit pas survivre. Mais une trame qui ne rend AUCUNE pile n efface
      // rien -- c est le signe qu on ne l a pas comprise, pas celui d un
      // inventaire vide. Meme precaution que pda-archi.js sur les stocks.
      if (tous(frame.payload, 2).length === 0) return;
      const piles = new Map();
      for (const a of lireAmes(frame)) piles.set(a.uid, a.monstres);
      parCompte.set(pid, piles);
      return;
    }

    if (frame.type === 'isa') {
      // UNE PIERRE QUI SE REMPLIT PENDANT LA CHASSE, et c est ce qui rend le
      // tableau vivant. Sur un personnage dont l inventaire n a jamais ete lu,
      // elle ouvre quand meme sa colonne: une ame vue est une ame vue.
      const ames = lireAmes(frame);
      if (ames.length === 0) return;
      const piles = parCompte.get(pid) || new Map();
      for (const a of ames) piles.set(a.uid, a.monstres);
      parCompte.set(pid, piles);
      return;
    }

    if (frame.type === 'irz') {
      // ium { 1: uid } — la pile a disparu, quelle qu en soit la cause: vendue,
      // donnee, posee au sol. Elle quitte le tableau.
      const piles = parCompte.get(pid);
      if (piles === undefined) return;
      const uid = entier(frame.payload, 1);
      if (uid !== null) piles.delete(uid);
    }
  }

  // Un client qui se ferme ne laisse pas sa colonne derriere lui.
  const oublier = (pid) => { parCompte.delete(pid); };

  // UN PERSONNAGE ABSENT N EST PAS UN PERSONNAGE A ZERO. Le panneau affiche
  // `—` pour le premier et `0` pour le second, et les confondre ferait passer
  // un inventaire pas encore lu pour une collection vide.
  function etat() {
    const out = new Map();
    for (const [pid, piles] of parCompte) {
      const ids = new Set();
      for (const monstres of piles.values()) for (const id of monstres) ids.add(id);
      out.set(pid, ids);
    }
    return out;
  }

  return { onTrame, oublier, etat };
}

module.exports = { EFFET_AME, lireAmes, creerCollection };
