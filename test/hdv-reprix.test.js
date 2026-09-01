'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { encodeVarint, decodeFrameRaw, WIRE } = require('../src/codec/rawProto');
const { creerReprix } = require('../src/hdv/reprix');

// Les lecteurs de trames sont eprouves sur les VRAIS octets dans
// hdv-trames.test.js. Ici on fabrique des trames de la forme que le decodeur
// produit, pour piloter l'automate: c'est le sequencage qu'on teste, pas le
// decodage.
const packer = (valeurs) => Buffer.concat(valeurs.map((n) => encodeVarint(n)));
const vi = (no, valeur) => ({ no, wire: WIRE.VARINT, value: BigInt(valeur) });
const msg = (no, value) => ({ no, wire: WIRE.LEN, kind: 'message', value });
const octets = (no, buf) => ({ no, wire: WIRE.LEN, kind: 'bytes', value: buf, raw: buf });

const objet = (uid, gid, taille) => msg(2, [vi(1, uid), vi(3, gid), vi(4, taille)]);

const kby = (lots) => ({
  kind: 'event', type: 'kby',
  payload: lots.map((l) => msg(1, [objet(l.uid, l.gid, l.taille), vi(3, l.prix), vi(4, 2419200)])),
});
const ivi = (paires) => ({
  kind: 'event', type: 'ivi',
  payload: paires.map(([gid, prix]) => msg(2, [vi(1, gid), vi(2, prix)])),
});
const kbt = (gid, prix) => ({
  kind: 'event', type: 'kbt',
  payload: [vi(1, 51), vi(2, gid), msg(3, [octets(6, packer(prix))])],
});
const kgp = (gid, prix) => ({
  kind: 'event', type: 'kgp',
  payload: [octets(2, packer(prix)), vi(5, gid), vi(6, 51)],
});
const kes = (uid, gid, taille, prix) => ({
  kind: 'event', type: 'kes',
  payload: [msg(1, [vi(1, uid), vi(3, gid), vi(4, taille)]), vi(2, prix), vi(4, 2419200)],
});
const ken = (uid) => ({ kind: 'event', type: 'ken', payload: [vi(1, uid)] });

function fauxSuperviseur(pid = 1) {
  const emis = [];
  const etats = new Map([[pid, { pid }]]);
  return {
    emis,
    etats,
    refuser: false,
    comptes: { get: (p) => etats.get(p) || null },
    emettre(p, buf) {
      if (this.refuser) return { ok: false, raison: 'pas de socket amont' };
      emis.push({ pid: p, frame: decodeFrameRaw(buf) });
      return { ok: true, octets: buf.length };
    },
  };
}

// Delais a zero: l'automate avance alors de facon synchrone, et chaque
// assertion porte sur un etat stable. Les minuteurs ont leur propre test.
const REGLAGES = { delaiMs: 0, delaiObjetMs: 0, delaiReponseMs: 0 };

function monter(pid = 1) {
  const sup = fauxSuperviseur(pid);
  const rendu = [];
  const r = creerReprix({ superviseur: sup, reglages: REGLAGES, onCompteRendu: (x) => rendu.push(x) });
  const dire = (frame) => r.onTrame({ pid, dir: 'in', frame, brute: Buffer.alloc(0) });
  return { sup, rendu, r, dire, types: () => sup.emis.map((e) => e.frame.type) };
}

const champ = (frame, no) => (frame.payload || []).find((f) => f.no === no);

// --- L'ecoute permanente -------------------------------------------------

// kby n'arrive QU'A l'ouverture de l'hotel de vente. Un module qui ne se
// reveillerait qu'au clic aurait deja rate la seule trame qui dit ce qu'on vend.
test('sans kby memorisee, la passe refuse et dit pourquoi', () => {
  const { r, rendu } = monter();
  r.lancer(1);
  assert.strictEqual(rendu.length, 1);
  assert.strictEqual(rendu[0].ok, false);
  assert.match(rendu[0].raison, /hotel de vente/i);
});

test('kby memorisee hors passe, puis la passe s en sert', () => {
  const { r, dire, types } = monter();
  dire(kby([{ uid: 10, gid: 13731, taille: 100, prix: 3000 }]));
  r.lancer(1);
  assert.deepStrictEqual(types(), ['keh', 'kbz']);
});

// --- La decision ---------------------------------------------------------

test('sur kbt, elle sous-cote d un cran', () => {
  const { r, dire, sup, types } = monter();
  dire(kby([{ uid: 10, gid: 13731, taille: 100, prix: 3000 }]));
  dire(ivi([[13731, 32]]));
  r.lancer(1);
  dire(kbt(13731, [19, 190, 2700, 18000]));
  assert.deepStrictEqual(types(), ['keh', 'kbz', 'kch']);
  const kch = sup.emis[2].frame;
  assert.strictEqual(Number(champ(kch, 1).value), 10);
  assert.strictEqual(Number(champ(kch, 2).value), 2699);
  assert.strictEqual(Number(champ(kch, 3).value), 100);
});

// LE PIEGE MESURE: apres notre pose, le minimum du creneau EST notre lot.
test('quand le minimum est a nous, rien n est emis', () => {
  const { r, dire, types, rendu } = monter();
  dire(kby([{ uid: 10, gid: 13731, taille: 100, prix: 1222 }]));
  dire(ivi([[13731, 32]]));
  r.lancer(1);
  dire(kbt(13731, [19, 190, 1222, 18000]));
  assert.deepStrictEqual(types(), ['keh', 'kbz', 'keh']);
  const fin = rendu.find((x) => x.fini);
  assert.strictEqual(fin.bilan.laisses, 1);
  assert.strictEqual(fin.bilan.maj, 0);
});

// LE TEST LE PLUS IMPORTANT DU FICHIER.
//
// Chaque kch fait pousser un kgp par le serveur, avec notre nouveau prix
// dedans. Deux lots du meme gid decides sur la meme lecture du marche se
// sous-coteraient l'un l'autre. L'automate doit donc ATTENDRE le kgp.
test('deux lots du meme gid ne sont jamais decides sur la meme lecture', () => {
  const { r, dire, sup, types } = monter();
  dire(kby([
    { uid: 10, gid: 13731, taille: 100, prix: 5000 },
    { uid: 11, gid: 13731, taille: 10, prix: 500 },
  ]));
  dire(ivi([[13731, 32]]));
  r.lancer(1);
  dire(kbt(13731, [19, 190, 2700, 18000]));

  // Un seul kch: le second lot attend que le marche soit rafraichi.
  assert.deepStrictEqual(types(), ['keh', 'kbz', 'kch']);

  // La confirmation seule ne suffit pas — elle ne dit rien du marche.
  dire(ken(10));
  dire(kes(99, 13731, 100, 2699));
  assert.deepStrictEqual(types(), ['keh', 'kbz', 'kch']);

  // C'est le kgp qui autorise le lot suivant.
  dire(kgp(13731, [19, 190, 2699, 18000]));
  assert.deepStrictEqual(types(), ['keh', 'kbz', 'kch', 'kch']);
  assert.strictEqual(Number(champ(sup.emis[3].frame, 1).value), 11);
  assert.strictEqual(Number(champ(sup.emis[3].frame, 2).value), 189);
});

// Une mise a jour est un retrait suivi d'une repose: l'uid change. Sans cette
// mise a jour, une seconde passe emettrait des kch sur des uid morts.
test('kes remplace l uid du lot dans la liste memorisee', () => {
  const { r, dire, sup } = monter();
  dire(kby([{ uid: 10, gid: 13731, taille: 100, prix: 5000 }]));
  dire(ivi([[13731, 32]]));
  r.lancer(1);
  dire(kbt(13731, [19, 190, 2700, 18000]));
  dire(ken(10));
  dire(kes(99, 13731, 100, 2699));
  assert.deepStrictEqual(r.lotsConnus(1), [{ uid: 99, gid: 13731, taille: 100, prix: 2699, duree: 2419200 }]);
  sup.emis.length = 0;
});

// --- Le parcours des gid -------------------------------------------------

test('elle se desabonne du gid termine avant de s abonner au suivant', () => {
  const { r, dire, sup } = monter();
  dire(kby([
    { uid: 10, gid: 13731, taille: 100, prix: 1222 },
    { uid: 20, gid: 15169, taille: 100, prix: 2991 },
  ]));
  dire(ivi([[13731, 32], [15169, 34]]));
  r.lancer(1);
  dire(kbt(13731, [19, 190, 1222, 18000]));   // le minimum est a nous: rien a emettre
  const suite = sup.emis.map((e) => ({ t: e.frame.type, gid: Number(champ(e.frame, 1).value) }));
  assert.deepStrictEqual(suite, [
    { t: 'keh', gid: 13731 },   // abonnement
    { t: 'kbz', gid: 13731 },
    { t: 'keh', gid: 13731 },   // desabonnement, sans champ 2
    { t: 'keh', gid: 15169 },   // gid suivant
    { t: 'kbz', gid: 15169 },
  ]);
  assert.strictEqual(champ(sup.emis[2].frame, 2), undefined, 'le desabonnement n a pas de champ 2');
  assert.notStrictEqual(champ(sup.emis[0].frame, 2), undefined, 'l abonnement a un champ 2');
});

test('la passe se termine en se desabonnant, et rend son bilan', () => {
  const { r, dire, rendu, types } = monter();
  dire(kby([{ uid: 10, gid: 13731, taille: 100, prix: 5000 }]));
  dire(ivi([[13731, 32]]));
  r.lancer(1);
  dire(kbt(13731, [19, 190, 2700, 18000]));
  dire(ken(10));
  dire(kes(99, 13731, 100, 2699));
  dire(kgp(13731, [19, 190, 2699, 18000]));
  assert.deepStrictEqual(types(), ['keh', 'kbz', 'kch', 'keh']);
  const fin = rendu.find((x) => x.fini);
  assert.deepStrictEqual(fin.bilan, { total: 1, maj: 1, laisses: 0, echecs: 0 });
});

// --- Ce qui ne doit pas la perturber -------------------------------------

test('un kbt portant un autre gid ne decide rien', () => {
  const { r, dire, types } = monter();
  dire(kby([{ uid: 10, gid: 13731, taille: 100, prix: 5000 }]));
  r.lancer(1);
  dire(kbt(99999, [19, 190, 2700, 18000]));
  assert.deepStrictEqual(types(), ['keh', 'kbz']);
});

// ken arrive AUSSI pour les lots des autres joueurs tant qu'on est abonne:
// plusieurs dizaines observees sans qu'on ait rien fait.
test('un ken portant l uid d un autre joueur ne compte pas', () => {
  const { r, dire, types } = monter();
  dire(kby([{ uid: 10, gid: 13731, taille: 100, prix: 5000 }]));
  dire(ivi([[13731, 32]]));
  r.lancer(1);
  dire(kbt(13731, [19, 190, 2700, 18000]));
  dire(ken(1234567));
  dire(kes(999, 99999, 1, 5));
  assert.deepStrictEqual(types(), ['keh', 'kbz', 'kch']);
});

// --- Les arrets ----------------------------------------------------------

// Windows recycle les pid: c'est l'IDENTITE de l'objet d'etat qui compte, pas
// le numero. Meme garde que passeur.js.
test('un client remplace pendant la passe l arrete', () => {
  const { r, dire, sup, rendu } = monter();
  dire(kby([{ uid: 10, gid: 13731, taille: 100, prix: 5000 }]));
  dire(ivi([[13731, 32]]));
  r.lancer(1);
  sup.etats.set(1, { pid: 1 });   // meme pid, AUTRE objet
  dire(kbt(13731, [19, 190, 2700, 18000]));
  assert.deepStrictEqual(sup.emis.map((e) => e.frame.type), ['keh', 'kbz']);
  assert.ok(rendu.some((x) => x.fini && /client/i.test(x.raison || '')));
});

test('un envoi refuse arrete la passe', () => {
  const { r, dire, sup, rendu } = monter();
  dire(kby([{ uid: 10, gid: 13731, taille: 100, prix: 5000 }]));
  sup.refuser = true;
  r.lancer(1);
  assert.ok(rendu.some((x) => x.fini && /socket/i.test(x.raison || '')));
});

test('deux passes sur le meme compte ne se chevauchent pas', () => {
  const { r, dire, rendu } = monter();
  dire(kby([{ uid: 10, gid: 13731, taille: 100, prix: 5000 }]));
  r.lancer(1);
  r.lancer(1);
  assert.ok(rendu.some((x) => x.ok === false && /tourne/i.test(x.raison)));
});

test('arreter coupe la passe et se desabonne', () => {
  const { r, dire, types } = monter();
  dire(kby([{ uid: 10, gid: 13731, taille: 100, prix: 5000 }]));
  r.lancer(1);
  r.arreter(1);
  assert.deepStrictEqual(types(), ['keh', 'kbz', 'keh']);
});

// --- Le minuteur ---------------------------------------------------------

// Si kbt n'arrive jamais, on abandonne CE gid et on passe au suivant. Une passe
// pendue ressemblerait a une passe qui travaille.
test('un kbt qui n arrive jamais abandonne son gid, pas la passe', async () => {
  const sup = fauxSuperviseur(1);
  const rendu = [];
  const r = creerReprix({
    superviseur: sup,
    reglages: { delaiMs: 0, delaiObjetMs: 0, delaiReponseMs: 15 },
    onCompteRendu: (x) => rendu.push(x),
  });
  const dire = (f) => r.onTrame({ pid: 1, dir: 'in', frame: f, brute: Buffer.alloc(0) });
  dire(kby([
    { uid: 10, gid: 13731, taille: 100, prix: 5000 },
    { uid: 20, gid: 15169, taille: 100, prix: 2991 },
  ]));
  dire(ivi([[13731, 32], [15169, 34]]));
  r.lancer(1);
  await new Promise((res) => setTimeout(res, 60));
  const fin = rendu.find((x) => x.fini);
  assert.ok(fin, 'la passe se termine d elle-meme');
  assert.strictEqual(fin.bilan.echecs, 2, 'les deux gid ont ete abandonnes');
  assert.strictEqual(fin.bilan.maj, 0);
});

// --- Le rythme -----------------------------------------------------------
//
// 150 a 600 ms faisaient 2,5 lots par seconde: personne ne clique, ne lit un
// prix et n'en saisit un autre a cette vitesse. Signale en jeu le 01/09.
//
// Un intervalle regulier, meme ralenti, reste reconnaissable: c'est une
// signature. Le rythme melange donc deux choses — un intervalle large entre
// chaque lot, et une PAUSE franche tous les vingt a trente lots, comme
// quelqu'un qui leve les yeux de sa fenetre.
const { rythme, DELAI_MIN, DELAI_MAX, PAUSE_MIN, PAUSE_MAX } = require('../src/hdv/reprix');

test('le delai ordinaire reste dans ses bornes', () => {
  assert.strictEqual(rythme(5, () => 0).ms, DELAI_MIN);
  assert.strictEqual(rythme(5, () => 0.9999).ms, DELAI_MAX);
});

test('un lot ordinaire ne fait que decrementer le compteur', () => {
  assert.strictEqual(rythme(5, () => 0).compteur, 4);
});

// Quand le compteur retombe a zero, la pause s'ajoute au delai ordinaire.
test('la pause s ajoute, et rearme le compteur', () => {
  const bas = rythme(1, () => 0);
  assert.strictEqual(bas.ms, DELAI_MIN + PAUSE_MIN);
  assert.ok(bas.compteur >= 20, 'le compteur est rearme');

  const haut = rythme(1, () => 0.9999);
  assert.strictEqual(haut.ms, DELAI_MAX + PAUSE_MAX);
});

// Le seuil doit etre franchi UNE fois, pas a chaque lot ensuite: un compteur
// qui resterait a zero ferait pauser tout le reste de la passe.
test('apres une pause, les lots suivants reprennent le rythme ordinaire', () => {
  let c = rythme(1, () => 0).compteur;
  const suivant = rythme(c, () => 0);
  assert.strictEqual(suivant.ms, DELAI_MIN, 'pas de pause deux fois de suite');
});

test('le rythme est nettement plus lent qu un geste reflexe', () => {
  assert.ok(DELAI_MIN >= 800, `DELAI_MIN=${DELAI_MIN} est encore trop court`);
});

// --- Le rythme entre objets ---------------------------------------------
//
// Seuls les kch etaient rythmes. Le passage d'un objet au suivant ne l'etait
// PAS: desabonnement, abonnement et demande de stats partaient d'affilee, puis
// on enchainait des la reponse. Sur une passe ou rien n'a besoin d'etre change,
// cela faisait 108 objets x 3 trames en quelques secondes — le motif meme qu'on
// venait de corriger sur les kch, en plus visible puisque rien ne le ralentit.
//
// Consulter un objet est un geste plus court que reprendre un prix: le delai
// est donc plus court que celui des kch, mais zero n'est pas defendable.
const { rythmeObjet, DELAI_OBJET_MIN, DELAI_OBJET_MAX } = require('../src/hdv/reprix');

test('le delai entre objets reste dans ses bornes', () => {
  assert.strictEqual(rythmeObjet(() => 0), DELAI_OBJET_MIN);
  assert.strictEqual(rythmeObjet(() => 0.9999), DELAI_OBJET_MAX);
});

test('consulter un objet va plus vite que reprendre un prix', () => {
  assert.ok(DELAI_OBJET_MAX < DELAI_MAX, 'le delai objet doit rester sous celui des kch');
  assert.ok(DELAI_OBJET_MIN >= 300, `DELAI_OBJET_MIN=${DELAI_OBJET_MIN} est trop court`);
});

// La verification qui compte: le second objet ne doit PAS partir dans la foulee
// du premier. Une constante bien nommee ne prouve pas qu'elle est appliquee.
test('le second objet attend, il ne suit pas le premier dans la foulee', async () => {
  const sup = fauxSuperviseur(1);
  const r = creerReprix({
    superviseur: sup,
    reglages: { delaiMs: 0, delaiObjetMs: 40, delaiReponseMs: 0 },
    onCompteRendu: () => {},
  });
  const dire = (f) => r.onTrame({ pid: 1, dir: 'in', frame: f, brute: Buffer.alloc(0) });
  dire(kby([
    { uid: 10, gid: 13731, taille: 100, prix: 1222 },
    { uid: 20, gid: 15169, taille: 100, prix: 2991 },
  ]));
  dire(ivi([[13731, 32], [15169, 34]]));
  r.lancer(1);

  // Rien n'est encore parti: meme le PREMIER objet attend son tour.
  assert.deepStrictEqual(sup.emis.map((e) => e.frame.type), []);
  await new Promise((res) => setTimeout(res, 70));
  assert.deepStrictEqual(sup.emis.map((e) => e.frame.type), ['keh', 'kbz']);

  // Le minimum est a nous: aucun kch, donc l'objet se termine tout de suite.
  // Le desabonnement part, mais l'abonnement suivant doit ATTENDRE.
  dire(kbt(13731, [19, 190, 1222, 18000]));
  assert.deepStrictEqual(sup.emis.map((e) => e.frame.type), ['keh', 'kbz', 'keh']);
  await new Promise((res) => setTimeout(res, 70));
  assert.deepStrictEqual(sup.emis.map((e) => e.frame.type), ['keh', 'kbz', 'keh', 'keh', 'kbz']);
});
