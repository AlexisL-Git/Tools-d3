'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { lireCaptures, candidats } = require('../src/dev/appariement');

// Retrouve, apres un patch Dofus, les nouveaux noms des messages dont OMNI
// depend. Voir src/dev/appariement.js pour le pourquoi, et la section 5.2 de
// docs/superpowers/specs/2026-08-17-launcher-multi-compte-dofus3-design.md.
//
//   node outils/apparier-protocole.js journal-dev.log
//
// Le journal doit venir d'un lanceur de MESURE (lancer-mesure-hdv.vbs ou
// equivalent): sans OMNI_CAPTURE_OCTETS=1 il n'y a pas d'octets a relire, donc
// pas de structure, donc rien a apparier.

// Les empreintes de reference viennent des trames MESUREES avant le patch,
// figees dans test/echange.test.js, test/invitation.test.js et
// test/passeur.test.js, et des structures documentees dans src/echange.js et
// src/invitation.js.
//
// RESOLUS le 08/09, gardes pour verifier qu'ils tiennent au patch suivant:
//   kfz -> jyv   kgt -> kcb   kgi -> kaq   kep -> kcs   kvw -> kth
//   ijz -> ikb   ijx -> ikg   (le soir, sur journal-invitation.log)
//
// UNE EMPREINTE VIDE NE TRANCHE RIEN. jyj et jxy ne portent aucun champ, et
// c'est l'empreinte la plus repandue du flux — la session du 08/09 rendait 17
// candidats pour kgi. Pour ceux-la, l'outil degrossit et la CHRONOLOGIE decide:
// jyj suit de 2 a 39 ms un jzc portant l'identifiant de ce client (mesure du
// 27/08), et jxy part au moment ou l'on clique « Passer ».
const CATALOGUE = [
  // --- Passe-tour, RESOLU le 08/09 ------------------------------------------
  //
  // jyj -> juu, jxy -> jvv, jxh -> jvn (champ 2 -> 1), jzc -> jxl. Le bloc
  // reste, avec les empreintes d'AVANT le patch: il sert de temoin au patch
  // suivant, pas de piste ouverte. Ne pas relire ses candidats comme une
  // question encore posee — c'etait le cas jusqu'au 08/09 au soir.
  { cle: 'jzc  debut de tour d un combattant', sens: 'entrant', empreinte: '1:varint,7:varint,8:varint' },
  { cle: 'jxh  fin de tour d un combattant',   sens: 'entrant', empreinte: '2:varint' },
  { cle: 'jyj  c est NOTRE tour',              sens: 'entrant', empreinte: '(vide)' },
  { cle: 'jxy  passer le tour',                sens: 'sortant', empreinte: '(vide)' },
  // --- Invitation de groupe, RESOLUE le 08/09 au soir -----------------------
  //
  // ijz -> ikb, ijx -> ikg. Les empreintes ci-dessous sont celles d'APRES le
  // patch, et elles portent la lecon de ce remappage: L'EMPREINTE SEULE N'A PAS
  // TROUVE `ikb`. Les six champs ont permute — la chaine est passee du 7 au 3 —
  // donc l'empreinte d'avant (`…,7:len`) ne correspondait a aucune trame reelle,
  // et l'outil a repondu « aucun candidat » sur une capture qui contenait
  // pourtant trois invitations.
  //
  // CE QUI L'A TROUVEE: la CORRELATION DE VALEURS. Un seul entrant de toute la
  // session porte DEUX characterId connus a son premier niveau — appris des
  // trames `kth` de chaque client — et c'est `ikb`. Ses trois occurrences
  // portent le meme champ 1 (le maitre) et un champ 7 different, egal a chaque
  // fois au characterId du client qui la recoit: l'invitant et le destinataire,
  // sans ambiguite possible.
  //
  // `ikg` etait bien dans les candidats rendus pour `ijx`, noye parmi dix. La
  // CHRONOLOGIE l'a tranche: trois occurrences, chacune 7,3 s, 9,2 s et 11,8 s
  // apres l'invitation du meme client, portant exactement son identifiant de
  // groupe. Une empreinte `1:varint` ne tranche jamais seule.
  { cle: 'ikb  invitation de groupe',     sens: 'entrant', empreinte: '1:varint,2:varint,3:len,5:varint,6:varint,7:varint' },
  { cle: 'ikg  acceptation d invitation', sens: 'sortant', empreinte: '1:varint' },
  // --- Songe, jamais capture non plus ---------------------------------------
  //
  // Meme cause, meme silence: songes.js est l'autre module reste hors de la
  // campagne du 08/09, et ses trois noms sont perimes comme ceux ci-dessus.
  // Les empreintes viennent du spec du 29/08. Elles sont ici parce que le
  // songe se mesure dans la MEME session que l'invitation, pour rien de plus.
  { cle: 'ixf  lancement d un songe',     sens: 'sortant', empreinte: '1:message' },
  { cle: 'iyd  invitation au songe',      sens: 'entrant', empreinte: '1:len,2:varint' },
  { cle: 'ixk  acceptation du songe',     sens: 'sortant', empreinte: '1:varint' },
];

const fichier = process.argv[2] || 'journal-dev.log';
if (!fs.existsSync(fichier)) {
  console.error(`journal introuvable: ${path.resolve(fichier)}`);
  process.exit(1);
}

const trames = lireCaptures(fs.readFileSync(fichier, 'utf8'));
const entrants = trames.filter((t) => t.sens === 'entrant').length;

console.log(`${fichier}: ${trames.length} trames avec octets (${entrants} entrantes, ${trames.length - entrants} sortantes)`);
if (trames.length === 0) {
  console.log('\nAucune trame relisible. Le journal a-t-il ete produit avec OMNI_CAPTURE_OCTETS=1 ?');
  process.exit(0);
}

// Le bruit de fond aide a juger: un nom vu partout n'est pas le geste qu'on
// cherche, meme si son empreinte colle.
const total = new Map();
for (const t of trames) total.set(t.nom, (total.get(t.nom) || 0) + 1);

for (const r of candidats(CATALOGUE, trames)) {
  console.log(`\n--- ${r.cle}   [${r.sens}, ${r.empreinte}]`);
  if (r.propositions.length === 0) {
    console.log('    aucun candidat — le geste a-t-il ete fait pendant la mesure ?');
    continue;
  }
  for (const p of r.propositions) {
    console.log(`    ${p.nom}   vu ${p.vus}x ici, ${total.get(p.nom)}x dans tout le journal   a ${p.instants.slice(0, 6).join(', ')} ms`);
  }
}
