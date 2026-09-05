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

// LE CAS SIGNALE EN JEU LE 03/09, et c'est celui d'un stock: huit lots de 10 du
// meme objet, un seul descendu a 19809 et les autres restes a 19814 et 19812.
// Ce n'etait pas un probleme de cadence — la passe les voyait tous, et les
// laissait tous, parce qu'un lot A NOUS touchait deja le minimum du creneau.
//
// La passe doit donc ALIGNER les retardataires sur ce minimum, sans le
// sous-coter: le lot deja au plus bas, lui, ne bouge pas.
test('des lots jumeaux plus chers sont alignes sur notre propre minimum', () => {
  const { r, dire, sup, types, rendu } = monter();
  dire(kby([
    { uid: 10, gid: 13731, taille: 10, prix: 19814 },
    { uid: 11, gid: 13731, taille: 10, prix: 19812 },
    { uid: 12, gid: 13731, taille: 10, prix: 19809 },
  ]));
  dire(ivi([[13731, 1900]]));
  r.lancer(1);
  dire(kbt(13731, [0, 19809, 0, 0]));

  // Le premier retardataire s'aligne, il ne sous-cote pas.
  assert.deepStrictEqual(types(), ['keh', 'kbz', 'kch']);
  assert.strictEqual(Number(champ(sup.emis[2].frame, 1).value), 10);
  assert.strictEqual(Number(champ(sup.emis[2].frame, 2).value), 19809);

  dire(kes(90, 13731, 10, 19809));
  dire(kgp(13731, [0, 19809, 0, 0]));

  // Le second aussi, et toujours au meme prix: aucune erosion d'un lot a l'autre.
  assert.deepStrictEqual(types(), ['keh', 'kbz', 'kch', 'kch']);
  assert.strictEqual(Number(champ(sup.emis[3].frame, 1).value), 11);
  assert.strictEqual(Number(champ(sup.emis[3].frame, 2).value), 19809);

  dire(kes(91, 13731, 10, 19809));
  dire(kgp(13731, [0, 19809, 0, 0]));

  // Le troisieme EST deja le minimum: rien a emettre, la passe se termine.
  assert.deepStrictEqual(types(), ['keh', 'kbz', 'kch', 'kch', 'keh']);
  const fin = rendu.find((x) => x.fini);
  assert.strictEqual(fin.bilan.maj, 2);
  assert.strictEqual(fin.bilan.laisses, 1);
  assert.deepStrictEqual(r.lotsConnus(1).map((l) => l.prix), [19809, 19809, 19809]);
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

// LE PREMIER kch D'UNE PASSE NE PAIE PAS LE DELAI DE LOT, pour la meme raison
// que le premier objet ne paie pas le delai d'objet: ce delai espace DEUX
// envois, et au depart il n'y en a pas eu de precedent. Sans cette regle, le
// clic restait suivi de 0,9 a 2,6 s pendant lesquelles rien ne changeait a
// l'ecran — l'abonnement partait, mais aucun prix ne bougeait. Il faut un
// delaiMs non nul pour que le test distingue les deux chemins.
test('le premier kch d une passe ne paie pas le delai de lot', async () => {
  const sup = fauxSuperviseur(1);
  const r = creerReprix({
    superviseur: sup,
    reglages: { delaiMs: 50, delaiObjetMs: 0, delaiReponseMs: 0 },
    onCompteRendu: () => {},
  });
  const dire = (f) => r.onTrame({ pid: 1, dir: 'in', frame: f, brute: Buffer.alloc(0) });
  dire(kby([
    { uid: 10, gid: 13731, taille: 100, prix: 5000 },
    { uid: 11, gid: 13731, taille: 10, prix: 500 },
  ]));
  dire(ivi([[13731, 32]]));
  r.lancer(1);
  dire(kbt(13731, [19, 190, 2700, 18000]));

  // Le premier lot part TOUT DE SUITE.
  assert.deepStrictEqual(sup.emis.map((e) => e.frame.type), ['keh', 'kbz', 'kch']);

  // Le second, lui, paie: le kgp l'autorise, mais il n'est pas encore parti.
  dire(ken(10));
  dire(kes(99, 13731, 100, 2699));
  dire(kgp(13731, [19, 190, 2699, 18000]));
  assert.deepStrictEqual(sup.emis.map((e) => e.frame.type), ['keh', 'kbz', 'kch']);
  await new Promise((res) => setTimeout(res, 80));
  assert.deepStrictEqual(sup.emis.map((e) => e.frame.type), ['keh', 'kbz', 'kch', 'kch']);
  r.arreter(1);
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
  assert.deepStrictEqual(fin.bilan, { total: 1, maj: 1, laisses: 0, echecs: 0, ecartes: [] });
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

// --- L'avancement --------------------------------------------------------

// LE COMPTEUR MELANGEAIT DEUX ECHELLES. Il rendait `total - file.length`, or
// `file` ne porte que les lots de l'OBJET COURANT: sur 376 lots repartis en
// 108 objets, le premier lot traite affichait deja « 374 / 376 », puis le
// chiffre sautait en arriere a chaque changement d'objet.
//
// Le restant se compte donc pour lui-meme, lot par lot, et il tombe a zero.
test('le restant decroit lot par lot, tous objets confondus', () => {
  const { r, dire, rendu } = monter();
  dire(kby([
    { uid: 10, gid: 13731, taille: 100, prix: 5000 },
    { uid: 20, gid: 15169, taille: 100, prix: 5000 },
    { uid: 21, gid: 15169, taille: 10, prix: 500 },
  ]));
  dire(ivi([[13731, 32], [15169, 34]]));
  r.lancer(1);

  const restants = () => rendu.filter((x) => x.restant !== undefined).map((x) => x.restant);

  // Des le clic, avant toute trame: le nombre de lots a traiter est connu.
  assert.deepStrictEqual(restants(), [3]);

  dire(kbt(13731, [19, 190, 2700, 18000]));
  assert.deepStrictEqual(restants(), [3, 2]);

  // kes fait passer a l'objet suivant: le kgp du 13731 arrive trop tard et est
  // ignore, donc le compteur ne bouge pas tant que le 15169 n'a pas repondu.
  dire(kes(90, 13731, 100, 2699));
  dire(kgp(13731, [19, 190, 2699, 18000]));
  assert.deepStrictEqual(restants(), [3, 2]);

  // Le second objet: son premier lot, puis son second sur le kgp suivant.
  dire(kbt(15169, [19, 190, 2700, 18000]));
  assert.deepStrictEqual(restants(), [3, 2, 1]);

  dire(kes(91, 15169, 100, 2699));
  dire(kgp(15169, [19, 190, 2699, 18000]));
  assert.deepStrictEqual(restants(), [3, 2, 1, 0]);

  // Le dernier lot attend son kgp comme les autres: kes seule remet l'uid, pas
  // la fraicheur du marche.
  dire(kes(92, 15169, 10, 189));
  dire(kgp(15169, [19, 189, 2699, 18000]));
  const fin = rendu.find((x) => x.fini);
  assert.ok(fin, 'la passe se termine');
});

// Le premier compte rendu est emis AU LANCEMENT et se distingue des suivants:
// c'est lui qui autorise l'IHM a rafraichir tout de suite, une fois par passe,
// sans payer un powershell.exe par lot.
test('le lancement annonce le nombre de lots a mettre a jour', () => {
  const { r, dire, rendu } = monter();
  dire(kby([
    { uid: 10, gid: 13731, taille: 100, prix: 5000 },
    { uid: 11, gid: 13731, taille: 10, prix: 500 },
  ]));
  dire(ivi([[13731, 32]]));
  r.lancer(1);
  assert.deepStrictEqual(rendu[0], { pid: 1, debut: true, restant: 2, total: 2 });
});

// LE CAS QUE LES BILANS RATENT. A l'expiration d'un kbt on vide la file du gid
// d'un coup: deduire le restant de `maj + laisses + echecs` marcherait ici par
// chance, mais pas chez vente.js, ou les lots d'un paquet abandonne ne sont
// comptes nulle part. Le restant se decremente donc la ou les lots QUITTENT la
// file, et nulle part ailleurs — sur les deux modules, la meme regle.
test('un objet abandonne ne laisse pas ses lots dans le decompte', async () => {
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
    { uid: 11, gid: 13731, taille: 10, prix: 500 },
    { uid: 20, gid: 15169, taille: 100, prix: 2991 },
  ]));
  dire(ivi([[13731, 32], [15169, 34]]));
  r.lancer(1);
  await new Promise((res) => setTimeout(res, 60));

  const derniers = rendu.filter((x) => x.restant !== undefined);
  assert.strictEqual(derniers[derniers.length - 1].restant, 0,
    'les trois lots des deux objets abandonnes sont sortis du decompte');
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
//
// LE PREMIER, LUI, PART TOUT DE SUITE. Le delai espace DEUX objets, et au
// depart il n'y a pas d'objet precedent: le geste qui vient d'avoir lieu,
// c'est le clic. Meme regle que dans vente.js.
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

  // Le PREMIER objet s'ouvre sans attendre.
  assert.deepStrictEqual(sup.emis.map((e) => e.frame.type), ['keh', 'kbz']);

  // Le minimum est a nous: aucun kch, donc l'objet se termine tout de suite.
  // Le desabonnement part, mais l'abonnement suivant doit ATTENDRE.
  dire(kbt(13731, [19, 190, 1222, 18000]));
  assert.deepStrictEqual(sup.emis.map((e) => e.frame.type), ['keh', 'kbz', 'keh']);
  await new Promise((res) => setTimeout(res, 70));
  assert.deepStrictEqual(sup.emis.map((e) => e.frame.type), ['keh', 'kbz', 'keh', 'keh', 'kbz']);
});

// --- LE TABLEAU DES ECARTES ---------------------------------------------
//
// Le 05/09: un concurrent a 7 000 002 kamas le lot de 10, pour une marchandise
// qui en vaut 152 l'unite. Sous-coter d'un kama un prix delirant donne un prix
// delirant, et le bilan ne comptait alors que des lots « laisses », sans jamais
// distinguer « rien a faire » de « on a refuse d'y aller ».
test('un marche delirant ecarte le lot, et le bilan dit pourquoi', () => {
  const { r, dire, types, rendu } = monter();
  dire(kby([{ uid: 10, gid: 13731, taille: 10, prix: 1520 }]));
  dire(ivi([[13731, 152]]));
  r.lancer(1);
  dire(kbt(13731, [0, 7000002, 0, 0]));
  assert.ok(!types().includes('kch'), 'aucune mise a jour de prix ne doit partir');
  const fin = rendu.find((x) => x.fini);
  assert.deepStrictEqual(fin.bilan.ecartes, [{
    gid: 13731, taille: 10, lots: 1, motif: 'trop-haut', vise: 7000001, borne: 7600, moyenUnitaire: 152,
  }]);
});

// LE TABLEAU NE MONTRE QUE LES ECARTS, et c'est ce qui le rend lisible. Laisser
// un lot deja au meilleur prix est le cas NORMAL d'une passe de mise a jour:
// sur un stock reel il concerne la grande majorite des lots, et les lister
// noierait les trois lignes qui comptent.
test('un lot deja au meilleur prix n entre pas dans le tableau des ecartes', () => {
  const { r, dire, rendu } = monter();
  dire(kby([{ uid: 10, gid: 13731, taille: 100, prix: 1222 }]));
  dire(ivi([[13731, 32]]));
  r.lancer(1);
  dire(kbt(13731, [19, 190, 1222, 18000]));
  const fin = rendu.find((x) => x.fini);
  assert.strictEqual(fin.bilan.laisses, 1);
  assert.deepStrictEqual(fin.bilan.ecartes, []);
});

// Un lot ecarte par le garde-fou n'est pas « deja au meilleur prix »: melanger
// les deux dans le meme compteur rendrait le message du panneau faux.
test('un lot ecarte ne compte pas comme un lot laisse', () => {
  const { r, dire, rendu } = monter();
  dire(kby([{ uid: 10, gid: 13731, taille: 10, prix: 1520 }]));
  dire(ivi([[13731, 152]]));
  r.lancer(1);
  dire(kbt(13731, [0, 7000002, 0, 0]));
  const fin = rendu.find((x) => x.fini);
  assert.strictEqual(fin.bilan.laisses, 0);
});

// --- LES FACTEURS DE RYTHME REGLABLES ------------------------------------
//
// UN SEUL JEU DE REGLAGES PILOTE LES DEUX FONCTIONS HDV, ET IL EST RELATIF.
// Il ne stocke pas des millisecondes mais des FACTEURS appliques aux bornes de
// chaque module. Chacune part donc de SA base, corrigee apres essai en jeu, et
// aucune ne se fait ecraser par l'autre: ici un lot s'espace de 900 a 2600 ms,
// la-bas vente.js y met une rafale de 90 a 260. Des bornes absolues partagees
// auraient force a elire un gagnant, et le perdant retrouvait soit la cadence
// signalee le 01/09, soit une rafale qui n'en est plus une.
//
// Les fonctions restent PURES: le hasard ET les reglages entrent par argument,
// donc tout se teste aux deux bornes sans piloter d'horloge.
const { AVANT_PAUSE_MIN, AVANT_PAUSE_MAX, compteurInitial } = require('../src/hdv/reprix');

test('le facteur lot etire les bornes du delai entre lots', () => {
  assert.strictEqual(rythme(5, () => 0, { lot: 2 }).ms, DELAI_MIN * 2);
  assert.strictEqual(rythme(5, () => 0.9999, { lot: 2 }).ms, DELAI_MAX * 2);
});

// Les facteurs sont INDEPENDANTS: allonger la pause sans ralentir la cadence
// ordinaire est precisement ce qu'un jeu unique absolu ne savait pas faire.
test('le facteur pause n etire que la pause, pas le delai ordinaire', () => {
  assert.strictEqual(rythme(1, () => 0, { pause: 2 }).ms, DELAI_MIN + PAUSE_MIN * 2);
});

// IL DIVISE, IL NE MULTIPLIE PAS. Le compteur dit « combien de lots avant la
// prochaine pause »: l'augmenter rendrait les pauses plus RARES, donc le
// reglage pointerait a l'envers de tous les autres. Exprime en frequence,
// x2 veut dire deux fois plus souvent, et « plus » vaut « plus prudent »
// partout dans le panneau.
test('le facteur de frequence des pauses divise le compteur rearme', () => {
  assert.strictEqual(rythme(1, () => 0, { frequencePause: 2 }).compteur,
    Math.round(AVANT_PAUSE_MIN / 2));
  assert.strictEqual(rythme(1, () => 0.9999, { frequencePause: 2 }).compteur,
    Math.round(AVANT_PAUSE_MAX / 2));
});

// Un compteur nul ferait pauser a CHAQUE lot: c'est la fonction qui doit s'en
// proteger, pas la borne admissible du panneau.
test('le compteur rearme ne descend jamais sous un lot', () => {
  const r = rythme(1, () => 0, { frequencePause: 1000 });
  assert.ok(r.compteur >= 1, `compteur=${r.compteur} ferait pauser chaque lot`);
});

test('un reglage absent ou aberrant laisse le rythme d origine', () => {
  assert.strictEqual(rythme(5, () => 0).ms, DELAI_MIN);
  assert.strictEqual(rythme(5, () => 0, {}).ms, DELAI_MIN);
  assert.strictEqual(rythme(5, () => 0, { lot: 'vite' }).ms, DELAI_MIN);
  assert.strictEqual(rythme(5, () => 0, { lot: null }).ms, DELAI_MIN);
});

test('le facteur objet etire les bornes du delai entre objets', () => {
  assert.strictEqual(rythmeObjet(() => 0, { objet: 2 }), DELAI_OBJET_MIN * 2);
  assert.strictEqual(rythmeObjet(() => 0.9999, { objet: 2 }), DELAI_OBJET_MAX * 2);
});

// LE PREMIER TIRAGE DU COMPTEUR EST HORS DES FONCTIONS DE RYTHME: il se fait a
// la creation de la passe. Sans cette fonction, il ignorerait le reglage et
// seule la DEUXIEME pause l'honorerait — un ecart invisible pendant vingt lots.
test('le compteur initial d une passe honore la frequence des pauses', () => {
  assert.strictEqual(compteurInitial(() => 0), AVANT_PAUSE_MIN);
  assert.strictEqual(compteurInitial(() => 0.9999), AVANT_PAUSE_MAX);
  assert.strictEqual(compteurInitial(() => 0, { frequencePause: 2 }),
    Math.round(AVANT_PAUSE_MIN / 2));
});

// L'EXPIRATION SE REGLE, MAIS PAS PAR UN FACTEUR. Elle ne suit pas les profils:
// c'est une valeur de robustesse, pas de realisme, et un profil « rapide » qui
// raccourcirait l'attente d'une reponse serveur abandonnerait des gid pour rien.
// Elle vit donc dans le meme sac de reglages, en millisecondes absolues.
test('l expiration de reponse se regle depuis le sac de rythme', async () => {
  const sup = fauxSuperviseur(1);
  const rendu = [];
  const r = creerReprix({
    superviseur: sup,
    reglages: { delaiMs: 0, delaiObjetMs: 0, rythme: { reponseMs: 15 } },
    onCompteRendu: (x) => rendu.push(x),
  });
  const dire = (f) => r.onTrame({ pid: 1, dir: 'in', frame: f, brute: Buffer.alloc(0) });
  dire(kby([{ uid: 10, gid: 13731, taille: 100, prix: 5000 }]));
  dire(ivi([[13731, 32]]));
  r.lancer(1);
  await new Promise((res) => setTimeout(res, 60));
  const fin = rendu.find((x) => x.fini);
  assert.ok(fin, 'sans reglage lu, l attente resterait a 4000 ms et rien n aurait expire');
  assert.strictEqual(fin.bilan.echecs, 1);
});

// LE REGLAGE DOIT ATTEINDRE LE TIRAGE, ET RIEN D'AUTRE NE LE PROUVE. Les
// fonctions de rythme sont testees pures, la persistance l'est dans
// comptes-favoris, et pont-ipc verifie que les trois fichiers du bureau
// s'accordent. Il restait ce maillon-la: est-ce que `reglages.rythme` arrive
// jusqu'a l'appel? Une rupture ici ne casse rien -- le panneau bouge, le
// fichier s'ecrit, et les passes gardent leur ancien rythme sans un mot. C'est
// le mode d'echec le plus couteux du projet.
//
// Il se mesure par ou il se voit: le temps. A x0,25 le delai de lot tient 225 a
// 650 ms, donc le second kch EST parti a 750 ms. Au rythme d'origine il
// tiendrait 900 a 2600, donc il ne le serait PAS. Les deux fenetres ne se
// touchent pas: l'assertion ne peut pas passer par hasard.
test('le facteur de rythme atteint vraiment le tirage du delai', async () => {
  const sup = fauxSuperviseur(1);
  const r = creerReprix({
    superviseur: sup,
    reglages: { delaiObjetMs: 0, delaiReponseMs: 0, rythme: { lot: 0.25 } },
    onCompteRendu: () => {},
  });
  const dire = (f) => r.onTrame({ pid: 1, dir: 'in', frame: f, brute: Buffer.alloc(0) });
  dire(kby([
    { uid: 10, gid: 13731, taille: 100, prix: 5000 },
    { uid: 11, gid: 13731, taille: 10, prix: 500 },
  ]));
  dire(ivi([[13731, 32]]));
  r.lancer(1);
  dire(kbt(13731, [19, 190, 2700, 18000]));
  dire(ken(10));
  dire(kes(99, 13731, 100, 2699));
  dire(kgp(13731, [19, 190, 2699, 18000]));
  const kch = () => sup.emis.filter((e) => e.frame.type === 'kch').length;
  assert.strictEqual(kch(), 1, 'le premier lot ne paie pas le delai');
  await new Promise((res) => setTimeout(res, 750));
  assert.strictEqual(kch(), 2,
    'a x0,25 le second lot part avant 650 ms; au rythme d origine il attendrait 900 ms au moins');
  r.arreter(1);
});
