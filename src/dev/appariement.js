'use strict';
const { decodeFrameRaw } = require('../codec/rawProto');

// Appariement structurel d'un patch a l'autre.
//
// A chaque patch Dofus, l'obfuscation IL2CPP REATTRIBUE tous les noms de
// messages. Mesure du 08/09, patch 3.6.11.12: sur 150 noms releves avant et 35
// apres, DEUX coincidaient, et encore par hasard. Les identifiants cables dans
// hdv/, pda-archi/, echange.js et passeur.js ne designaient plus rien, et le
// silence etait total — aucune erreur, juste des fonctions qui n'agissent plus.
//
// Ce que le patch ne change pas, c'est la STRUCTURE: un message garde ses
// numeros de champs, ses types de fil et son arite. On apparie donc sur elle.
//
// Voir docs/superpowers/specs/2026-08-17-launcher-multi-compte-dofus3-design.md
// section 5.2, qui prevoit ce mecanisme.

const TYPES = { 0: 'varint', 1: 'i64', 5: 'i32' };

// `string` et `bytes` sont la MEME chose structurellement: decodeRaw les separe
// sur le contenu — imprimable au-dela de 3 octets — ce qui varie d'une trame a
// l'autre pour un meme message, et apparierait donc au hasard. Seule compte la
// distinction qui, elle, tient: feuille ou sous-message.
function typeDe(champ) {
  if (champ.wire !== 2) return TYPES[champ.wire] || 'wire' + champ.wire;
  return champ.kind === 'message' ? 'message' : 'len';
}

// L'empreinte ne regarde JAMAIS les valeurs: elles varient d'une trame a
// l'autre pour un meme message. Elle retient le numero de champ — pas son rang,
// ijz porte les siens en 2 et 5 — son type de fil, et sa multiplicite, qui
// distingue une liste d'un champ simple.
function empreinte(champs) {
  if (!Array.isArray(champs) || champs.length === 0) return '(vide)';
  const parNo = new Map();
  for (const c of champs) {
    const cle = c.no + ':' + typeDe(c);
    parNo.set(cle, (parNo.get(cle) || 0) + 1);
  }
  return [...parNo.entries()]
    .sort((a, b) => Number(a[0].split(':')[0]) - Number(b[0].split(':')[0]))
    .map(([cle, n]) => (n > 1 ? cle + 'x' + n : cle))
    .join(',');
}

// Le journal ecrit une trame sur DEUX sortes de lignes: l'en-tete `cap :` qui
// la nomme, puis ses octets en continuation, indentes sous elle. On relit les
// OCTETS plutot que le resume de l'en-tete: le resume abrege tout champ
// imbrique en accolades, et c'est justement la structure qu'on vient chercher.
const EN_TETE = /^\s*(\d+)ms \[(\d+)\] cap :\s*(-->|<--) (\w+) (\w+)/;
const OCTETS = /^\s*\d+ms \[\d+\]\s+\d{4}\s+([0-9a-f]+)\s*$/;

function lireCaptures(texte) {
  const lignes = String(texte).split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lignes.length; i++) {
    const e = EN_TETE.exec(lignes[i]);
    if (e === null) continue;
    const hex = [];
    for (let j = i + 1; j < lignes.length; j++) {
      const o = OCTETS.exec(lignes[j]);
      if (o === null) break;
      hex.push(o[1]);
    }
    if (hex.length === 0) continue;
    const brute = Buffer.from(hex.join(''), 'hex');
    const frame = decodeFrameRaw(brute);
    out.push({
      ms: Number(e[1]),
      pid: Number(e[2]),
      sens: e[3] === '-->' ? 'sortant' : 'entrant',
      // Le nom decode fait foi; celui de l'en-tete sert de filet.
      nom: frame !== null && frame.type !== null ? frame.type : e[5],
      empreinte: empreinte(frame === null ? null : frame.payload),
      octets: brute,
    });
  }
  return out;
}


// Pour chaque cle du catalogue, les noms du journal qui pourraient etre elle.
//
// On ne DECIDE pas: on propose. Un payload vide est l'empreinte la plus
// repandue du flux — kgi, jxy et bien d'autres la portent — donc l'appariement
// seul tranche rarement. Il reduit une liste de 35 noms a deux ou trois, que la
// fenetre temporelle du geste departage ensuite. Choisir au hasard entre eux
// serait pire que ne rien proposer: une feature cablee sur le mauvais message
// agit, et agit a cote.
function candidats(catalogue, trames) {
  return catalogue.map((entree) => {
    const parNom = new Map();
    for (const t of trames) {
      if (t.sens !== entree.sens || t.empreinte !== entree.empreinte) continue;
      if (!parNom.has(t.nom)) parNom.set(t.nom, []);
      parNom.get(t.nom).push(t.ms);
    }
    const propositions = [...parNom.entries()]
      .map(([nom, instants]) => ({ nom, vus: instants.length, instants }))
      .sort((a, b) => a.vus - b.vus || a.nom.localeCompare(b.nom));
    return { cle: entree.cle, sens: entree.sens, empreinte: entree.empreinte, propositions };
  });
}

module.exports = { empreinte, typeDe, lireCaptures, candidats };
