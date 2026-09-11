'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerPepites, PERIODE_MS } = require('../src/pepites/pepites');
const { WIRE } = require('../src/codec/rawProto');

// Un double d'historique: tout en memoire, aucun disque. L'historique reel a
// ses propres tests, ici on ne verifie que le sequencement.
function fauxHistorique() {
  const passes = [];
  return {
    passes,
    lire: () => passes,
    dernier: () => (passes.length === 0 ? null : passes[passes.length - 1]),
    ajouter: (p) => { passes.push(p); return passes; },
  };
}

// La trame ivi telle que le decodeur la rend: type `itn`, une liste d'elements
// dont chacun porte le gid en 3 et le prix moyen en 5. Forme reprise de
// test/hdv-trames.test.js.
//
// CORRIGE PAR RAPPORT AU BRIEF: le brief donnait les champs gid/prix avec
// `kind: 'varint'`. entier() de src/hdv/trames.js ne regarde pas `kind` mais
// `wire` -- `f.wire !== WIRE.VARINT` -- car c'est ce que rend le vrai decodeur
// (voir test/hdv-trames.test.js:161-162, qui construit ses paires avec
// `wire: WIRE.VARINT`). Avec `kind: 'varint'` seul, entier() rend null pour
// chaque champ et lirePrixMoyens ne voit jamais de gid ni de prix -- la table
// resultante est vide et aucun test du brief qui depend d'un prix connu ne
// peut passer. Fixe ici en ajoutant `wire: WIRE.VARINT`.
function trameIvi(paires) {
  return {
    type: 'itn',
    payload: paires.map(([gid, prix]) => ({
      no: 1,
      kind: 'message',
      value: [
        { no: 3, wire: WIRE.VARINT, value: gid },
        { no: 5, wire: WIRE.VARINT, value: prix },
      ],
    })),
  };
}

function creer(extra = {}) {
  const minuteurs = [];
  const historique = fauxHistorique();
  const passes = [];
  const p = creerPepites({
    historique,
    onPasse: (r) => passes.push(r),
    maintenant: () => 1000,
    poserMinuteur: (fn, ms) => { minuteurs.push({ fn, ms }); return minuteurs.length; },
    oterMinuteur: () => {},
    ...extra,
  });
  return { p, historique, passes, minuteurs };
}

test('la periode vaut douze heures', () => {
  assert.strictEqual(PERIODE_MS, 12 * 60 * 60 * 1000);
});

test('une ivi neuve declenche un classement', () => {
  const { p, passes } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 12]]) });
  assert.strictEqual(passes.length, 1);
  assert.strictEqual(passes[0].passe.lignes[0].gid, 303);
  assert.strictEqual(passes[0].passe.pid, 7);
});

// LE GARDE DE SENS, EN PREMIERE LIGNE, comme dans vente.js: une trame qu'on
// EMET ne dit rien des prix du serveur.
test('une trame sortante est ignoree', () => {
  const { p, passes } = creer();
  p.onTrame({ pid: 7, dir: 'out', frame: trameIvi([[303, 12]]) });
  assert.deepStrictEqual(passes, []);
});

test('une trame d un autre type est ignoree', () => {
  const { p, passes } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: { type: 'kby', payload: [] } });
  assert.deepStrictEqual(passes, []);
});

// UNE ivi VIDE N'EFFACE PAS CE QU'ON SAIT: le panneau deviendrait muet sans
// raison visible. Meme regle que vente.js pour les piles.
test('une ivi vide ne remplace pas la table connue', () => {
  const { p, passes } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 12]]) });
  p.onTrame({ pid: 8, dir: 'in', frame: trameIvi([]) });
  assert.strictEqual(passes.length, 1);
  assert.strictEqual(p.etat().pid, 7);
});

test('la table la plus fraiche gagne, quel que soit le pid', () => {
  const { p } = creer({ maintenant: (() => { let t = 0; return () => { t += 1; return t; }; })() });
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 12]]) });
  p.onTrame({ pid: 9, dir: 'in', frame: trameIvi([[303, 20]]) });
  assert.strictEqual(p.etat().pid, 9);
});

// SANS PRIX, RIEN DU TOUT -- et surtout pas un classement vide, qui se lirait
// comme « aucun objet ne vaut le coup ».
test('une passe sans ivi ne produit rien', () => {
  const { p, passes, historique } = creer();
  assert.strictEqual(p.passer(), null);
  assert.deepStrictEqual(passes, []);
  assert.deepStrictEqual(historique.passes, []);
});

test('la minuterie declenche une passe toutes les douze heures', () => {
  const { p, passes, minuteurs } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 12]]) });
  p.demarrer();
  assert.strictEqual(minuteurs.length, 1);
  assert.strictEqual(minuteurs[0].ms, PERIODE_MS);
  minuteurs[0].fn();
  assert.strictEqual(passes.length, 2);
});

// LES DEUX DECLENCHEURS SONT INDEPENDANTS. Si une ivi rearmait la minuterie,
// une session de jeu reguliere repousserait le battement indefiniment.
test('une ivi ne rearme pas la minuterie', () => {
  const { p, minuteurs } = creer();
  p.demarrer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 12]]) });
  assert.strictEqual(minuteurs.length, 1);
});

test('la variation compare a la passe precedente', () => {
  const { p, passes } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 12]]) });
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 6]]) });
  assert.strictEqual(passes[0].variation.lignes[0].etat, 'entree');
  assert.strictEqual(passes[1].variation.lignes[0].etat, 'stable');
  assert.ok(passes[1].variation.lignes[0].deltaCout < 0);
});
