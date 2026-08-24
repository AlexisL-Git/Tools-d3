'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

// Le code versionne vit hors du paquet (%APPDATA%\Replicate\versions\<v>\) et
// doit pourtant trouver frida et protobufjs, restes dans le paquet.
//
// MESURE du 2026-08-25: patcher `Module._nodeModulePaths` ne suffit PLUS.
// Node 22+ a reecrit la resolution CJS et ne passe plus par ce point
// d'accroche — l'application est morte sur « Cannot find module 'frida' »
// alors que le supplement etait bien enregistre.
//
// Deux moyens, dans cet ordre:
//   1. une JONCTION versions/<v>/node_modules -> le node_modules du paquet.
//      La resolution standard la trouve toute seule, sans rien patcher. Sous
//      Windows, une jonction de dossier ne demande aucun privilege.
//   2. a defaut (paquet en archive asar, ou jonction refusee), etendre
//      `Module._resolveFilename` en dernier recours: on ne le remplace pas,
//      on rattrape seulement les echecs.
function rendreResolvable({ dossierVersion, dossiers, autoriserJonction = true }) {
  const reels = dossiers.filter((d) => {
    try { return fs.statSync(d).isDirectory(); } catch (e) { return false; }
  });

  if (autoriserJonction && reels.length === 1) {
    const lien = path.join(dossierVersion, 'node_modules');
    try {
      if (!fs.existsSync(lien)) fs.symlinkSync(reels[0], lien, 'junction');
      return { methode: 'jonction', cible: reels[0] };
    } catch (e) {
      // On enchaine sur la solution de repli.
    }
  }

  const origine = Module._resolveFilename;
  Module._resolveFilename = function (demande, parent, estPrincipal, options) {
    try {
      return origine.call(this, demande, parent, estPrincipal, options);
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND' || reels.length === 0) throw e;
      // Deuxieme essai, et un seul: on impose les node_modules du paquet.
      // Si celui-la echoue aussi, l'erreur remonte telle quelle — un module
      // introuvable doit rester introuvable.
      return origine.call(this, demande, parent, estPrincipal, { ...(options || {}), paths: reels });
    }
  };
  return { methode: 'resolution', cibles: reels };
}

module.exports = { rendreResolvable };
