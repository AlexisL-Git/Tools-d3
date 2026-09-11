'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerMarche, prixUnitaire, OUVERTURE_ETAL } = require('../src/pepites/marche');

// Un double du superviseur, sur le modele de test/hdv-reprix.test.js: il
// memorise ce qu'on lui demande d'emettre et rend un etat de compte stable,
// dont l'IDENTITE sert de garde.
function fauxSuperviseur() {
  const etats = new Map();
  const envois = [];
  return {
    envois,
    comptes: { get: (pid) => etats.get(pid) || null },
    poser: (pid) => { const e = { pid }; etats.set(pid, e); return e; },
    retirer: (pid) => etats.delete(pid),
    emettre: (pid, trame) => { envois.push({ pid, trame }); return { ok: true, octets: 1 }; },
  };
}

// L'ouverture d'un etal. marche.js ne regarde que le type, donc un objet nu
// suffit -- c'est la seule fixture de ce fichier qui ne vient pas d'octets.
function trameEtal() { return { type: OUVERTURE_ETAL, payload: [] }; }

// LES REPONSES DE STATISTIQUES VIENNENT D'OCTETS, PAS D'OBJETS FABRIQUES, et
// c'est la lecon du 11/09: sur la tache precedente, une fixture construite a la
// main posait `kind: 'varint'` la ou le decodeur attend `wire`, si bien que la
// lecture rendait une table VIDE sans lever la moindre exception. Plusieurs
// tests passaient alors pour la mauvaise raison.
//
// Les quatre prix sont un champ PACKE, lu via `f.raw` par quatrePrix(): aucune
// construction a la main ne peut le reproduire de tete. Les hex ci-dessous ont
// ete produits puis VERIFIES en passant par lireStatsPrix(), et chacun rend
// exactement ce que son commentaire annonce. Meme demarche que
// test/hdv-trames.test.js, dont toutes les valeurs sont mesurees.
const { decodeFrameRaw } = require('../src/codec/rawProto');
const frame = (hex) => decodeFrameRaw(Buffer.from(hex, 'hex'));

// gid 303, prix [19, 190, 1222, 18000] -- creneau de taille 1 servi.
const JZN_303_SERVI = '12331a310a13747970652e616e6b616d612e636f6d2f6a7a6e121a08af02121310af02186828d9f104320813be01c609d08c011868';
// gid 303, prix [0, 190, 1222, 18000] -- taille 1 vide, a deduire du voisin.
const JZN_303_TAILLE1_VIDE = '12331a310a13747970652e616e6b616d612e636f6d2f6a7a6e121a08af02121310af02186828d9f104320800be01c609d08c011868';
// gid 303, prix [0, 0, 0, 0] -- personne n'en vend.
const JZN_303_VIDE = '122f1a2d0a13747970652e616e6b616d612e636f6d2f6a7a6e121608af02120f10af02186828d9f1043204000000001868';
// gid 13731, prix [25, 250, 2400, 23000].
const JZN_13731_SERVI = '12331a310a13747970652e616e6b616d612e636f6d2f6a7a6e121a08a36b121310a36b186828d9f104320819fa01e012d8b3011868';

// Verrou sur les fixtures elles-memes: si une seule cesse de se decoder, on
// veut le savoir ici et pas au milieu d'un test de sequencement.
test('les fixtures de statistiques se decodent bien', () => {
  const { lireStatsPrix } = require('../src/hdv/trames');
  assert.deepStrictEqual(lireStatsPrix(frame(JZN_303_SERVI)).prix, [19, 190, 1222, 18000]);
  assert.deepStrictEqual(lireStatsPrix(frame(JZN_303_TAILLE1_VIDE)).prix, [0, 190, 1222, 18000]);
  assert.deepStrictEqual(lireStatsPrix(frame(JZN_303_VIDE)).prix, [0, 0, 0, 0]);
  assert.strictEqual(lireStatsPrix(frame(JZN_13731_SERVI)).gid, 13731);
});

function creer(gids, extra = {}) {
  const sup = fauxSuperviseur();
  const prix = [];
  const fins = [];
  const avance = [];
  const m = creerMarche({
    superviseur: sup,
    candidats: () => gids,
    // Delais explicites: ils court-circuitent le rythme et rendent les tests
    // synchrones, comme le fait test/hdv-reprix.test.js.
    reglages: { delaiObjetMs: 0, delaiReponseMs: 50 },
    onPrix: (p) => prix.push(p),
    onAvancement: (a) => avance.push(a),
    onFin: (f) => fins.push(f),
    ...extra,
  });
  return { m, sup, prix, fins, avance };
}

// --- prixUnitaire() ---------------------------------------------------

// LE ZERO N'EST PAS UN PRIX, c'est « aucune offre a cette taille ». La regle
// est celle de src/hdv/prix.js, et la confondre ferait sortir l'objet en tete
// du classement a cout nul.
test('le prix unitaire vient du creneau de taille 1 quand il est servi', () => {
  assert.strictEqual(prixUnitaire([19, 190, 1222, 18000]), 19);
});

test('un creneau de taille 1 vide se deduit du voisin servi le plus proche', () => {
  // 190 kamas le lot de 10 -> 19 l'unite.
  assert.strictEqual(prixUnitaire([0, 190, 1222, 18000]), 19);
});

test('un marche entierement vide ne rend pas de prix', () => {
  assert.strictEqual(prixUnitaire([0, 0, 0, 0]), null);
  assert.strictEqual(prixUnitaire(null), null);
});

// --- la passe ---------------------------------------------------------

test('l ouverture d un etal demarre la passe et abonne le premier gid', () => {
  const { m, sup } = creer([303, 13731]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  assert.ok(sup.envois.length >= 1, 'au moins l abonnement du premier gid');
  assert.strictEqual(m.enCours(7), true);
});

// LE GARDE DE SENS, EN PREMIERE LIGNE, comme vente.js:481.
test('une trame sortante ne demarre rien', () => {
  const { m, sup } = creer([303]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'out', frame: trameEtal() });
  assert.deepStrictEqual(sup.envois, []);
});

test('un prix lu est rendu a l appelant', async () => {
  const { m, sup, prix } = creer([303]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  m.onTrame({ pid: 7, dir: 'in', frame: frame(JZN_303_SERVI) });
  assert.strictEqual(prix.length, 1);
  assert.strictEqual(prix[0].gid, 303);
  assert.strictEqual(prix[0].prix, 19);
  assert.strictEqual(typeof prix[0].quand, 'number');
});

// UN SEUL GID EN VOL A LA FOIS, meme raison que dans reprix.js: une reponse
// doit porter sur le marche qu'on vient de demander, pas sur un chiffre
// memorise d'un objet precedent.
test('une reponse qui porte sur un autre gid est ignoree', () => {
  const { m, sup, prix } = creer([303, 13731]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  m.onTrame({ pid: 7, dir: 'in', frame: frame(JZN_13731_SERVI) });
  assert.deepStrictEqual(prix, []);
});

// LA GARDE D'IDENTITE, pas une comparaison de pid: Windows recycle les pid, et
// un client relance pendant la passe ne doit pas heriter de la passe du
// precedent (passeur.js:120).
test('un client qui disparait arrete la passe', () => {
  const { m, sup, fins } = creer([303, 13731]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  sup.retirer(7);
  m.onTrame({ pid: 7, dir: 'in', frame: frame(JZN_303_SERVI) });
  assert.strictEqual(m.enCours(7), false);
  assert.strictEqual(fins.length, 1);
});

// DEUX PASSES CONCURRENTES DOUBLERAIENT LE DEBIT D'EMISSIONS.
test('une seconde ouverture pendant une passe ne demarre rien', () => {
  const { m, sup } = creer([303, 13731]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  const avant = sup.envois.length;
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  assert.strictEqual(sup.envois.length, avant);
});

test('sans candidats, la passe ne demarre pas', () => {
  const { m, sup } = creer([]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  assert.deepStrictEqual(sup.envois, []);
  assert.strictEqual(m.enCours(7), false);
});

// UN MARCHE VIDE N'EST PAS UN ECHEC: l'objet existe, personne n'en vend. Le
// bilan les compte a part, parce que les deux appellent des reactions
// differentes -- l'un se reessaie, l'autre non.
test('un marche vide compte comme sans offre, pas comme un echec', async () => {
  const { m, sup, prix, fins } = creer([303]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  m.onTrame({ pid: 7, dir: 'in', frame: frame(JZN_303_VIDE) });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepStrictEqual(prix, []);
  assert.strictEqual(fins[0].bilan.sansOffre, 1);
  assert.strictEqual(fins[0].bilan.echecs, 0);
});

// UNE REPONSE QUI N'ARRIVE PAS N'ABANDONNE QUE SON GID, pas la passe: regle
// reprise de reprix.js, ou elle a ete posee pour la meme raison.
test('une reponse absente n abandonne que son gid', async () => {
  const { m, sup, fins } = creer([303, 13731]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  await new Promise((r) => setTimeout(r, 80));
  m.onTrame({ pid: 7, dir: 'in', frame: frame(JZN_13731_SERVI) });
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(fins[0].bilan.echecs, 1);
  assert.strictEqual(fins[0].bilan.tarifes, 1);
});

test('l avancement est rendu objet par objet', async () => {
  const { m, sup, avance } = creer([303, 13731]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  m.onTrame({ pid: 7, dir: 'in', frame: frame(JZN_303_SERVI) });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(avance[0].fait, 1);
  assert.strictEqual(avance[0].total, 2);
});

// ON SE DESABONNE. Tant qu'on est abonne, le serveur pousse un prix a chaque
// mouvement du marche sur ce gid. Sans desabonnement, la passe laisse derriere
// elle cinquante flux ouverts.
test('chaque gid traite est desabonne', async () => {
  const { m, sup } = creer([303]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  m.onTrame({ pid: 7, dir: 'in', frame: frame(JZN_303_SERVI) });
  await new Promise((r) => setTimeout(r, 10));
  const { trameDesabonner } = require('../src/hdv/trames');
  const attendu = JSON.stringify(trameDesabonner(303));
  assert.ok(sup.envois.some((e) => JSON.stringify(e.trame) === attendu),
    'un desabonnement doit avoir ete emis pour 303');
});

test('un refus d emission arrete la passe et le dit', () => {
  const sup = fauxSuperviseur();
  sup.emettre = () => ({ ok: false, raison: 'pas de socket amont' });
  const fins = [];
  const m = creerMarche({
    superviseur: sup,
    candidats: () => [303],
    reglages: { delaiObjetMs: 0, delaiReponseMs: 50 },
    onFin: (f) => fins.push(f),
  });
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  assert.strictEqual(fins.length, 1);
  assert.strictEqual(fins[0].bilan.raison, 'pas de socket amont');
});
