'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerPepites } = require('../src/pepites/pepites');
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
  const historique = fauxHistorique();
  const passes = [];
  const p = creerPepites({
    historique,
    onPasse: (r) => passes.push(r),
    maintenant: () => 1000,
    ...extra,
  });
  return { p, historique, passes };
}

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

test('un prix de marche note change le classement a la passe suivante', () => {
  const { p, passes } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 100]]) });
  const avant = passes[0].passe.lignes[0].coutParPepite;
  p.noterPrixMarche(303, 10, 1000);
  p.passer();
  const apres = passes[1].passe.lignes[0].coutParPepite;
  assert.ok(apres < avant, 'un prix dix fois moindre doit baisser le cout');
  assert.strictEqual(passes[1].passe.lignes[0].source, 'marche');
});

// UN PRIX DE MARCHE VIEUX D'UNE SESSION N'EST PLUS UN PRIX DE MARCHE.
test('une ivi neuve vide les prix de marche', () => {
  const { p, passes } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 100]]) });
  p.noterPrixMarche(303, 10, 1000);
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 100]]) });
  assert.strictEqual(passes[passes.length - 1].passe.lignes[0].source, 'moyen');
});

test('les candidats sont les gids du dernier classement, dans l ordre', () => {
  const { p } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 100], [13731, 19]]) });
  assert.deepStrictEqual(p.candidats(), [13731, 303]);
});

test('la variation compare a la passe precedente', () => {
  // Horloge qui avance: deux ivi au meme instant sont censees ne jamais
  // arriver en production. L'horloge qui bouge rend la seconde ivi
  // distinguable de la premiere dans prixQuand, comme en vrai jeu.
  const t = (() => { let n = 0; return () => { n += 1; return n; }; })();
  const { p, passes } = creer({ maintenant: t });
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 12]]) });
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 6]]) });
  assert.strictEqual(passes[0].variation.lignes[0].etat, 'entree');
  assert.strictEqual(passes[1].variation.lignes[0].etat, 'stable');
  assert.ok(passes[1].variation.lignes[0].deltaCout < 0);
});
