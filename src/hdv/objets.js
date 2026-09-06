'use strict';
const TABLE = require('./objets.json');

// Le nom francais de chaque objet du jeu, par gid.
//
// Fabrication: outils/faire-objets.js, qui ne tourne jamais ici.
// Fonction pure: ni Electron, ni Frida, ni reseau, ni disque.
//
// POURQUOI ELLE EXISTE. Aucune trame ne porte de nom d'objet — `ivi` ne donne
// que des prix — et le tableau des lots ecartes affichait donc des gids nus.
// « gid 13731, six lots vises a 7 000 001 » ne se relit pas: on ne sait meme
// pas de quelle marchandise on parle. C'est « Pierre Medicinale ».
//
// 764 Ko POUR 21 748 OBJETS, ET C'EST LE COUT ASSUME. Restreinte aux seules
// ressources la table tiendrait en une centaine de Ko, mais ce qui atterrit
// dans les lots n'est pas « une ressource » au sens du jeu: c'est « un objet
// sans lignes d'effets », le tri de stock.js. Les deux definitions coincident
// aujourd'hui; le jour ou elles divergeront, une table restreinte afficherait
// un gid nu precisement quand on vient chercher un nom.
const OBJETS = TABLE;

// LA TABLE VIENT D'UN JSON.parse, donc elle herite d'Object.prototype: un gid
// nomme `toString` en sortirait une fonction. `hasOwnProperty` par appel est le
// prix a payer pour que la table reste un objet nu, cent fois plus leger a
// charger qu'une Map de 21 748 entrees construite a chaque demarrage.
//
// NULL, ET JAMAIS LA CHAINE VIDE. L'appelant retombe sur le gid, qui est ce
// qu'on recopie dans le jeu pour aller verifier; du blanc ne se recopie pas.
function nomDe(gid) {
  if (gid === null || gid === undefined) return null;
  const cle = String(gid);
  return Object.prototype.hasOwnProperty.call(OBJETS, cle) ? OBJETS[cle] : null;
}

module.exports = { nomDe, OBJETS };
