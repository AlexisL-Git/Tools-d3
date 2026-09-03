'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFrameRaw, WIRE } = require('../src/codec/rawProto');
const { creerChasse } = require('../src/chasse/chasse');
const { POSITION_PIERRE } = require('../src/chasse/pierres');
const { trameEquiper } = require('../src/chasse/trames');

const fixture = (nom) => decodeFrameRaw(
  Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures', nom), 'utf8').trim(), 'hex'),
);

// Un double du superviseur, comme dans hdv-vente.test.js: il retient ce qu'on
// lui demande d'emettre au lieu d'ouvrir une socket.
function doubleSuperviseur(pid = 42, etat = { nom: 'Iop' }) {
  return {
    comptes: new Map([[pid, etat]]),
    envois: [],
    emettre(p, octets) { this.envois.push({ pid: p, octets }); return { ok: true }; },
  };
}

const kmu = (id) => ({ type: 'kmu', payload: [{ no: 2, wire: WIRE.VARINT, value: BigInt(id) }] });
const ivq = (uid, pos) => ({ type: 'ivq', payload: [
  { no: 1, wire: WIRE.VARINT, value: BigInt(uid) },
  { no: 2, wire: WIRE.VARINT, value: BigInt(pos) },
] });

// Une carte fabriquee: un groupe qui porte un seul monstre du niveau demande.
function jssNiveau(niveau, idGroupe = -300) {
  const monstre = { no: 1, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.VARINT, value: 65n },
    { no: 2, wire: WIRE.VARINT, value: BigInt(niveau) },
    { no: 4, wire: WIRE.VARINT, value: 1n },
  ] };
  return { type: 'jss', payload: [
    { no: 5, wire: WIRE.LEN, kind: 'message', value: [
      { no: 2, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'message', value: [
          { no: 4, wire: WIRE.LEN, kind: 'message', value: [
            { no: 2, wire: WIRE.LEN, kind: 'message', value: [monstre] },
          ] },
        ] },
      ] },
      { no: 3, wire: WIRE.VARINT, value: BigInt(idGroupe) },
    ] },
  ] };
}

// L'inventaire mesure porte la Moyenne (9687) en position 31, la Grande (9688,
// uid 233526391) et l'Enorme (9689) rangees, et AUCUNE Gigantesque.
function monte({ actif = true } = {}) {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const chasse = creerChasse({
    superviseur, actif, onCompteRendu: (r) => rendus.push(r),
  });
  chasse.onTrame({ pid: 42, dir: 'in', frame: fixture('chasse-ivx-inventaire.hex') });
  chasse.onTrame({ pid: 42, dir: 'in', frame: fixture('chasse-jss-groupes.hex') });
  return { superviseur, chasse, rendus };
}

// Le groupe -20000 de la carte mesuree est de niveau 46, couvert par la Moyenne
// qui est deja portee: rien a faire.
test('la bonne pierre deja portee n envoie aucun ordre', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-20000) });
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.at(-1).quoi, 'deja');
});

test('un groupe inconnu ne fait rien et le dit', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-99999) });
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.at(-1).quoi, 'groupe-inconnu');
});

test('eteinte, la chasse ne fait rien du tout', () => {
  const { superviseur, chasse, rendus } = monte({ actif: false });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-20000) });
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.length, 0);
});

test('un niveau 90 fait equiper la Grande pierre et attend la confirmation', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(90) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  assert.strictEqual(superviseur.envois.length, 1);
  assert.strictEqual(rendus.at(-1).quoi, 'envoye');
  assert.strictEqual(rendus.at(-1).gid, 9688);
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivq(233526391, POSITION_PIERRE) });
  assert.strictEqual(rendus.at(-1).quoi, 'equipe');
  assert.strictEqual(rendus.at(-1).gid, 9688);
});

// LA CONFIRMATION SE RECONNAIT A LA POSITION, PAS A L'UID. Sortir une pierre
// d'une pile en cree une neuve, avec un uid neuf: exiger l'uid envoye laisserait
// l'attente ouverte pour toujours.
test('la confirmation arrive sur un uid neuf et conclut quand meme', () => {
  const { chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(90) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivq(999999, POSITION_PIERRE) });
  assert.strictEqual(rendus.at(-1).quoi, 'equipe');
  assert.strictEqual(rendus.at(-1).gid, 9688);
});

// Un mouvement vers l'inventaire pendant l'attente n'est pas notre pose: c'est
// la pierre precedente que le serveur renvoie en 63 tout seul.
test('un retour en inventaire pendant l attente ne conclut rien', () => {
  const { chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(90) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivq(233525940, 63) });
  assert.strictEqual(rendus.at(-1).quoi, 'envoye');
});

// UNE SEULE PIERRE, PAS LA PILE. Le client en deplace 40 quand on equipe a la
// main; OMNI n'en envoie qu'une. Decision de Jibef le 03/09.
test('l ordre ne porte qu une seule pierre, pas la pile entiere', () => {
  const { superviseur, chasse } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(90) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  const attendu = trameEquiper({ uid: 233526391, qte: 1, position: POSITION_PIERRE });
  assert.deepStrictEqual(superviseur.envois[0].octets, attendu);
});

// Le combat suivant ne doit RIEN renvoyer: la pierre posee est en 31, et notre
// copie de l'inventaire le sait sans attendre le prochain ivx.
test('le combat suivant ne reequipe pas la pierre deja posee', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(90) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivq(999999, POSITION_PIERRE) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  assert.strictEqual(superviseur.envois.length, 1);
  assert.strictEqual(rendus.at(-1).quoi, 'deja');
});

// Jibef n'a aucune Gigantesque: un groupe de niveau 160 doit dire le manque.
test('sans la pierre de la tranche, rien n est envoye et le manque est dit', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(160) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.at(-1).quoi, 'manque');
  assert.strictEqual(rendus.at(-1).gid, 9690);
});

test('un niveau au-dela de 190 ne fait rien et le dit', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(200) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.at(-1).quoi, 'hors-portee');
});

// Une trame SORTANTE ne doit jamais declencher: le client emet lui aussi des
// choses qu'on ne lit qu'en entree.
test('une trame sortante est ignoree', () => {
  const { superviseur, chasse } = monte();
  chasse.onTrame({ pid: 42, dir: 'out', frame: kmu(-20000) });
  assert.strictEqual(superviseur.envois.length, 0);
});

// LE NOM DU COMPTE ET LE NOM DE LA PIERRE SONT DEUX CHOSES. `choisir` rend un
// `nom`, celui de la pierre manquante; le compte s'appelle `compte`.
test('le compte rendu nomme le compte et la pierre separement', () => {
  const { chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(160) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  assert.strictEqual(rendus.at(-1).compte, 'Iop');
  assert.strictEqual(rendus.at(-1).nom, 'Gigantesque pierre d ame');
});

// Eteindre en pleine attente ne doit pas laisser un ordre en suspens qui
// conclurait au rallumage suivant.
test('eteindre oublie l attente en cours', () => {
  const { chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(90) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  chasse.armer(false);
  chasse.armer(true);
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivq(233526391, POSITION_PIERRE) });
  assert.strictEqual(rendus.at(-1).quoi, 'envoye');
});

// LA POSITION SE SUIT MEME ETEINTE. Sans cela, une pierre equipee a la main
// pendant que la chasse dort serait reequipee pour rien au combat suivant.
test('la position se met a jour meme eteinte', () => {
  const { superviseur, chasse, rendus } = monte({ actif: false });
  // La Grande pierre passe en position 31, a la main, chasse eteinte.
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivq(233526391, POSITION_PIERRE) });
  chasse.armer(true);
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(90) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  // Elle est deja la: aucun ordre, et le verdict le dit.
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.at(-1).quoi, 'deja');
  assert.strictEqual(rendus.at(-1).gid, 9688);
});

// --- Les trois corrections du 03/09 au soir --------------------------------

const iua = (uid, gid, qte, pos) => ({ type: 'iua', payload: [
  { no: 3, wire: WIRE.LEN, kind: 'message', value: [
    { no: 1, wire: WIRE.VARINT, value: BigInt(pos) },
    { no: 5, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.VARINT, value: BigInt(gid) },
      { no: 3, wire: WIRE.VARINT, value: BigInt(qte) },
      { no: 4, wire: WIRE.VARINT, value: BigInt(uid) },
    ] },
  ] },
] });
const ium = (uid) => ({ type: 'ium', payload: [{ no: 1, wire: WIRE.VARINT, value: BigInt(uid) }] });
const ivj = (uid, qte) => ({ type: 'ivj', payload: [
  { no: 3, wire: WIRE.LEN, kind: 'message', value: [
    { no: 2, wire: WIRE.VARINT, value: BigInt(uid) },
    { no: 3, wire: WIRE.VARINT, value: BigInt(qte) },
  ] },
] });

// Un joueur qui quitte la carte ne doit plus rien declencher du tout.
test('un depart de joueur ne fait plus dire groupe inconnu', () => {
  const { superviseur, chasse, rendus } = monte();
  const joueur = { type: 'kmu', payload: [{ no: 2, wire: WIRE.VARINT, value: 677158453542n }] };
  chasse.onTrame({ pid: 42, dir: 'in', frame: joueur });
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.length, 0);
});

// LE DEFAUT DU 03/09 AU SOIR. La pierre visee disparait de l'inventaire entre
// la connexion et le combat: sans suivre `ium`, on enverrait un uid mort et le
// serveur ignorerait l'ordre sans un mot.
test('une pile disparue n est plus proposee', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: ium(233526391) }); // la Grande
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(90) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.at(-1).quoi, 'manque');
});

test('une pile neuve devient equipable', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: ium(233526391) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: iua(999001, 9688, 12, 63) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(90) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  assert.strictEqual(superviseur.envois.length, 1);
  assert.strictEqual(rendus.at(-1).quoi, 'envoye');
  assert.deepStrictEqual(
    superviseur.envois[0].octets,
    trameEquiper({ uid: 999001, qte: 1, position: POSITION_PIERRE }),
  );
});

test('une quantite mise a jour est suivie', () => {
  const { superviseur, chasse } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivj(233526391, 7) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: iua(999002, 9688, 3, 63) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(90) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  // 7 contre 3: la plus grosse pile reste celle d'origine.
  assert.deepStrictEqual(
    superviseur.envois[0].octets,
    trameEquiper({ uid: 233526391, qte: 1, position: POSITION_PIERRE }),
  );
});

// LE SILENCE EST UN COMPTE RENDU. Sans ca, un ordre ignore par le serveur ne
// se voit nulle part: c'est ce qui a rendu la seance du 03/09 au soir
// incomprehensible.
test('un ordre sans reponse finit par se dire', async () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const chasse = creerChasse({
    superviseur, actif: true, reglages: { delaiReponseMs: 5 },
    onCompteRendu: (r) => rendus.push(r),
  });
  chasse.onTrame({ pid: 42, dir: 'in', frame: fixture('chasse-ivx-inventaire.hex') });
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(90) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  assert.strictEqual(rendus.at(-1).quoi, 'envoye');
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(rendus.at(-1).quoi, 'sans-reponse');
  assert.strictEqual(rendus.at(-1).gid, 9688);
});

test('une reponse a temps desarme le minuteur', async () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const chasse = creerChasse({
    superviseur, actif: true, reglages: { delaiReponseMs: 5 },
    onCompteRendu: (r) => rendus.push(r),
  });
  chasse.onTrame({ pid: 42, dir: 'in', frame: fixture('chasse-ivx-inventaire.hex') });
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(90) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivq(999999, POSITION_PIERRE) });
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(rendus.at(-1).quoi, 'equipe');
});
