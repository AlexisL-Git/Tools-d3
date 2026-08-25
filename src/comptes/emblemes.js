'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Les emblemes de classe, et eux seuls.
//
// LE PROBLEME. La classe d'un personnage est lue dans le titre de sa fenetre
// (src/comptes/clients.js), mais son embleme est un asset d'Ankama. Trois
// facons de l'obtenir, et une seule tient:
//
//   1. l'embarquer dans le paquet -> c'est de la REDISTRIBUTION d'art Ankama,
//      dans une archive de 480 Mo envoyee a des amis;
//   2. l'extraire du jeu installe -> Dofus 3 est en Unity, les assets sont
//      dans des bundles, et l'extraction casse a chaque patch;
//   3. le telecharger une fois et le mettre en cache SUR LA MACHINE de chacun.
//
// La troisieme est retenue. Rien ne part dans le paquet, chaque machine
// constitue son propre cache, et l'ami qui n'a jamais eu de reseau garde une
// interface parfaitement utilisable: l'abreviation de la classe tient la place.
//
// DEUX HOTES. api.dofusdb.fr et api.beta.dofusdb.fr servent exactement les
// memes images: verifie le 2026-08-25, memes 19 classes, memes identifiants,
// memes chemins. Le second n'est pas un fournisseur different, c'est une
// seconde chance en cas d'incident sur le premier.
//
// Ce module ne depend ni d'Electron ni de Frida: `chercher` et la racine du
// cache sont injectes, il se teste sans reseau et sans disque partage.

const HOTES = [
  'https://api.dofusdb.fr',
  'https://api.beta.dofusdb.fr',
];

// Nom francais tel qu'il apparait dans le titre de la fenetre -> identifiant de
// classe chez DofusDB. Releve le 2026-08-25 sur /breeds: 19 classes, et
// l'identifiant 19 n'existe pas (Forgelance porte le 20).
const CLASSES = {
  'Féca': 1,
  'Osamodas': 2,
  'Enutrof': 3,
  'Sram': 4,
  'Xélor': 5,
  'Ecaflip': 6,
  'Eniripsa': 7,
  'Iop': 8,
  'Crâ': 9,
  'Sadida': 10,
  'Sacrieur': 11,
  'Pandawa': 12,
  'Roublard': 13,
  'Zobal': 14,
  'Steamer': 15,
  'Eliotrope': 16,
  'Huppermage': 17,
  'Ouginak': 18,
  'Forgelance': 20,
};

// Les accents comptent: le titre rend « Crâ » et « Xélor » tels quels. On
// normalise en NFC parce que la meme chaine peut arriver decomposee selon la
// source, et on coupe les blancs qu'un launcher tiers pourrait laisser.
function idDeClasse(nom) {
  if (typeof nom !== 'string') return null;
  const propre = nom.normalize('NFC').trim();
  return Object.prototype.hasOwnProperty.call(CLASSES, propre) ? CLASSES[propre] : null;
}

// racine   — le dossier de cache, un fichier par classe.
// chercher — fetch, injecte pour les tests.
// journal  — recoit les incidents; muet par defaut, un embleme manquant n'est
//            pas une panne.
function creerEmblemes({ racine, chercher = globalThis.fetch, journal = () => {} } = {}) {
  const enMemoire = new Map();   // id -> data URI
  const enCours = new Map();     // id -> promesse, pour ne pas lancer deux fois

  const fichierDe = (id) => path.join(racine, `symbol_${id}.png`);
  const uriDe = (octets) => `data:image/png;base64,${octets.toString('base64')}`;

  function depuisLeDisque(id) {
    try {
      return fs.readFileSync(fichierDe(id));
    } catch (e) {
      return null;
    }
  }

  async function depuisLeReseau(id) {
    for (const hote of HOTES) {
      const url = `${hote}/img/breeds/symbol_${id}.png`;
      try {
        const r = await chercher(url);
        if (!r.ok) { journal(`embleme ${id}: ${hote} rend ${r.status}`); continue; }
        const octets = Buffer.from(await r.arrayBuffer());
        if (octets.length === 0) { journal(`embleme ${id}: ${hote} rend un corps vide`); continue; }
        return octets;
      } catch (e) {
        journal(`embleme ${id}: ${hote} injoignable (${e.message})`);
      }
    }
    return null;
  }

  // Rend l'embleme s'il est deja la, null sinon. JAMAIS d'attente: cette
  // fonction est appelee a chaque construction de l'etat affiche.
  function pour(classe) {
    const id = idDeClasse(classe);
    if (id === null) return null;
    return enMemoire.get(id) || null;
  }

  // Met l'embleme en cache s'il ne l'est pas. Ne leve jamais: un embleme
  // absent laisse l'interface retomber sur l'abreviation, ce qui est un defaut
  // d'agrement, pas une panne.
  async function assurer(classe) {
    const id = idDeClasse(classe);
    if (id === null || enMemoire.has(id)) return;
    if (enCours.has(id)) return enCours.get(id);

    const travail = (async () => {
      const surDisque = depuisLeDisque(id);
      if (surDisque !== null) { enMemoire.set(id, uriDe(surDisque)); return; }

      const octets = await depuisLeReseau(id);
      if (octets === null) return;

      enMemoire.set(id, uriDe(octets));
      // L'ecriture du cache est un CONFORT: si elle echoue, l'embleme reste
      // affiche pour cette session et sera retelecharge au prochain lancement.
      try {
        fs.mkdirSync(racine, { recursive: true });
        fs.writeFileSync(fichierDe(id), octets);
      } catch (e) {
        journal(`embleme ${id}: cache non ecrit (${e.message})`);
      }
    })();

    enCours.set(id, travail);
    try { await travail; } finally { enCours.delete(id); }
  }

  return { pour, assurer };
}

module.exports = { CLASSES, HOTES, idDeClasse, creerEmblemes };
