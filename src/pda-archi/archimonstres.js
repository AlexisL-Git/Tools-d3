'use strict';
const TABLE = require('./archimonstres.json');
const ZONES = require('./zones.json');
const OCRE = require('./boss-ocre.json');

// La table des archimonstres: qui existe, comment il s appelle, a quel niveau.
//
// Conception: docs/superpowers/specs/2026-09-04-tableau-archimonstres-design.md.
// Fabrication: outils/faire-archimonstres.js, qui ne tourne jamais ici.
//
// 286, ET LE CHIFFRE EST FIGE DANS LE TEST. Le drapeau `isMiniBoss` des donnees
// du jeu en rend 306, mais vingt vivent dans l Archipel de Vulkania, une ile
// SAISONNIERE: les compter ferait vingt lignes definitivement vides onze mois
// sur douze.
const ARCHIMONSTRES = TABLE;

// LA PLAGE NE SERT QU AU CONTROLE. La regle d exclusion est la ZONE 50, et elle
// vit dans l outil de fabrication; ces deux bornes sont ce que le test verifie
// APRES coup. S en servir pour filtrer casserait le jour ou Ankama ajoute un
// archimonstre ordinaire dans l intervalle.
const VULKANIA = { debut: 3178, fin: 3197 };

// OU CHASSER. Chaque archimonstre porte les identifiants des sous-zones ou il
// se trouve; cette table les nomme et les rattache a leur zone.
//
// ELLE NE DECRIT QUE CE QUI SERT: le jeu compte 562 sous-zones, les
// archimonstres n en citent que 111, reparties sur 16 zones. Embarquer le reste
// ferait porter au paquet des donnees que rien ne lit.
const SOUS_ZONES = ZONES;

// LES 51 BOSS DU DOFUS OCRE, tires des objectifs de la quete 439
// « L'éternelle moisson ». Elle demande les 286 archimonstres ET ces 51 boss:
// deux ensembles disjoints, verifie.
//
// LA QUETE EST LA SOURCE, PAS UN GUIDE. Ses objectifs nomment leur monstre par
// identifiant, ce qui evite l homonymie -- et elle est reelle: « Dragon Cochon »
// existe en id 113 niveau 100 et en id 7863 niveau 212, dont l ame est
// incapturable.
const BOSS = OCRE;

// LES DEUX COLLECTIONS ONT LA MEME FORME, et c est ce qui permet a tableau.js
// et zones.js de les traiter sans savoir laquelle ils croisent.
const COLLECTIONS = new Map([
  ['archi', { titre: 'Archimonstres', entrees: ARCHIMONSTRES }],
  ['boss', { titre: 'Boss du Dofus Ocre', entrees: BOSS }],
]);
for (const c of COLLECTIONS.values()) c.parId = new Map(c.entrees.map((a) => [a.id, a]));

// Une cle inconnue rend les archimonstres: le panneau ne peut pas casser sur
// une faute de frappe, il montre la collection par defaut.
const collection = (quoi) => COLLECTIONS.get(quoi) || COLLECTIONS.get('archi');

const PAR_ID = new Map(ARCHIMONSTRES.map((a) => [a.id, a]));

// UNE PIERRE CAPTURE AUSSI LES BOSS, et c est le cas NORMAL: l inventaire
// mesure le 04/09 portait trois ames de boss sur 143 -- Mansot Royal, Bouftou
// Royal, Mob l Eponge. Sans cette distinction, le tableau les inventerait en
// lignes fantomes, ou les perdrait en silence.
const estArchimonstre = (id) => PAR_ID.has(id);

const nomDe = (id) => {
  const a = PAR_ID.get(id);
  return a === undefined ? null : a.nom;
};

module.exports = {
  ARCHIMONSTRES, BOSS, SOUS_ZONES, VULKANIA, collection, estArchimonstre, nomDe,
};
