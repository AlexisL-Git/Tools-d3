'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Module = require('node:module');

// Format d'un .jsc:
//   [4 octets]  longueur de la source enveloppee, en petit-boutiste
//   [32 octets] sha256 des donnees mises en cache
//   [reste]     les donnees mises en cache par V8
//
// L'empreinte n'est PAS une protection contre quelqu'un qui modifie le
// fichier — il lui suffirait de la recalculer. Elle protege contre un fichier
// ABIME: mesure faite, un cache altere ne se fait pas rejeter proprement par
// V8, il tue le processus (« Fatal error: unreachable code »). Un octet
// retourne sur le disque ferait donc mourir l'application sans un mot.
//
// Le cache n'est pas portable: il ne se recharge que dans le meme V8 que celui
// qui l'a produit. D'ou la compilation avec l'Electron du paquet
// (outils/compiler-bytecode.js), et jamais avec node.
const TAILLE_ENTETE = 4 + 32;

function installer(extensions = Module._extensions) {
  extensions['.jsc'] = function (module, chemin) {
    const brut = fs.readFileSync(chemin);
    if (brut.length <= TAILLE_ENTETE) throw new Error('bytecode tronque: ' + chemin);
    const longueur = brut.readUInt32LE(0);
    const empreinteAttendue = brut.subarray(4, TAILLE_ENTETE);
    const cachedData = brut.subarray(TAILLE_ENTETE);
    const obtenue = crypto.createHash('sha256').update(cachedData).digest();
    if (!obtenue.equals(empreinteAttendue)) {
      throw new Error('bytecode abime, refuse avant de le donner a V8: ' + chemin);
    }
    // V8 verifie la LONGUEUR de la source avant d'accepter un cache. On lui
    // rend une source de meme longueur, faite d'espaces: le code execute vient
    // du cache, jamais de ce remplissage.
    const script = new vm.Script(' '.repeat(longueur), { cachedData, filename: chemin });
    if (script.cachedDataRejected) {
      throw new Error('bytecode refuse par V8 (compile par un autre moteur ?): ' + chemin);
    }
    const fabrique = script.runInThisContext();
    fabrique.call(
      module.exports,
      module.exports,
      module.require.bind(module),
      module,
      chemin,
      path.dirname(chemin),
    );
  };
  return extensions;
}

installer();

module.exports = { installer, TAILLE_ENTETE };
