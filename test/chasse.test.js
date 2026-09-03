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
// `tous` est un getter chez le vrai (src/protocol/compte.js): il rend la liste
// des etats, chacun portant son pid. La chasse s'en sert pour equiper TOUS les
// clients, pas seulement celui qui a vu le groupe partir.
function doubleSuperviseur(pids = [42]) {
  const etats = new Map(pids.map((p) => [p, { pid: p, nom: 'compte-' + p }]));
  return {
    comptes: {
      get: (p) => etats.get(p),
      get tous() { return [...etats.values()]; },
    },
    envois: [],
    envoisDe(p) { return this.envois.filter((e) => e.pid === p); },
    emettre(p, octets) { this.envois.push({ pid: p, octets }); return { ok: true }; },
  };
}

const kmu = (id) => ({ type: 'kmu', payload: [{ no: 2, wire: WIRE.VARINT, value: BigInt(id) }] });
const ivq = (uid, pos) => ({ type: 'ivq', payload: [
  { no: 1, wire: WIRE.VARINT, value: BigInt(uid) },
  { no: 2, wire: WIRE.VARINT, value: BigInt(pos) },
] });


// LA LISTE DES COMBATTANTS. Au moins un identifiant NEGATIF, sinon c est une
// liste d acteurs de carte et pas un combat: meme critere qu abandon-combat.js.
const kmk = (...ids) => ({ type: 'kmk', payload: ids.map((id) => ({
  no: 2, wire: WIRE.LEN, kind: 'message', value: [
    { no: 3, wire: WIRE.VARINT, value: BigInt(id) },
  ] })) });

// Entrer en combat demande DEUX trames: kmu dit quel groupe, donc quel niveau,
// et kmk dit que CE client y est vraiment. Une mule encore en deplacement ne
// recoit pas la seconde, et le jeu lui refuserait l equipement.
function entrer(chasse, pid, idGroupe = -300) {
  if (idGroupe !== null) chasse.onTrame({ pid, dir: 'in', frame: kmu(idGroupe) });
  chasse.onTrame({ pid, dir: 'in', frame: kmk(-1, -2, 777) });
}

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

// L inventaire mesure porte la Moyenne a l emplacement. Son plafond est 100,
// donc un groupe de niveau 80 la demande: rien a faire.
test('la bonne pierre deja portee n envoie aucun ordre', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(80) });
  entrer(chasse, 42, -300);
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.at(-1).quoi, 'deja');
});

test('un groupe inconnu ne fait rien et le dit', () => {
  const { superviseur, chasse, rendus } = monte();
  entrer(chasse, 42, -99999);
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.at(-1).quoi, 'groupe-inconnu');
});

test('eteinte, la chasse ne fait rien du tout', () => {
  const { superviseur, chasse, rendus } = monte({ actif: false });
  entrer(chasse, 42, -20000);
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.length, 0);
});

test('un niveau 90 fait equiper la Grande pierre et attend la confirmation', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  // Deux ordres: la purge de la Moyenne portee, puis la pose de la Grande.
  assert.strictEqual(superviseur.envois.length, 2);
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
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivq(999999, POSITION_PIERRE) });
  assert.strictEqual(rendus.at(-1).quoi, 'equipe');
  assert.strictEqual(rendus.at(-1).gid, 9688);
});

// Un mouvement vers l'inventaire pendant l'attente n'est pas notre pose: c'est
// la pierre precedente que le serveur renvoie en 63 tout seul.
test('un retour en inventaire pendant l attente ne conclut rien', () => {
  const { chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivq(233525940, 63) });
  assert.strictEqual(rendus.at(-1).quoi, 'envoye');
});

// UNE SEULE PIERRE, PAS LA PILE. Le client en deplace 40 quand on equipe a la
// main; OMNI n'en envoie qu'une. Decision de Jibef le 03/09.
test('l ordre ne porte qu une seule pierre, pas la pile entiere', () => {
  const { superviseur, chasse } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  const attendu = trameEquiper({ uid: 233526391, qte: 1, position: POSITION_PIERRE });
  assert.deepStrictEqual(superviseur.envois[1].octets, attendu);
});

// Le combat suivant ne doit RIEN renvoyer: la pierre posee est en 31, et notre
// copie de l'inventaire le sait sans attendre le prochain ivx.
test('le combat suivant ne reequipe pas la pierre deja posee', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivq(999999, POSITION_PIERRE) });
  // Un AUTRE groupe: le meme serait avale par la garde anti-doublon.
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120, -301) });
  entrer(chasse, 42, -301);
  assert.strictEqual(superviseur.envois.length, 2);
  assert.strictEqual(rendus.at(-1).quoi, 'deja');
});

// Jibef n'a aucune Gigantesque, dont le plafond est 1000: seul un groupe au-dela
// de 190 la demande, et c'est le seul cas de manque qui lui reste.
test('sans la pierre de la tranche, rien n est envoye et le manque est dit', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(200) });
  entrer(chasse, 42, -300);
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.at(-1).quoi, 'manque');
  assert.strictEqual(rendus.at(-1).gid, 9690);
});

test('un niveau au-dela de 190 ne fait rien et le dit', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(2000) });
  entrer(chasse, 42, -300);
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
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(200) });
  entrer(chasse, 42, -300);
  assert.strictEqual(rendus.at(-1).compte, 'compte-42');
  assert.strictEqual(rendus.at(-1).nom, 'Gigantesque pierre d ame');
});

// Eteindre en pleine attente ne doit pas laisser un ordre en suspens qui
// conclurait au rallumage suivant.
test('eteindre oublie l attente en cours', () => {
  const { chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
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
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
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
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  assert.strictEqual(superviseur.envois.length, 0);
  assert.strictEqual(rendus.at(-1).quoi, 'manque');
});

test('une pile neuve devient equipable', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: ium(233526391) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: iua(999001, 9688, 12, 63) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  assert.strictEqual(superviseur.envois.length, 2);
  assert.strictEqual(rendus.at(-1).quoi, 'envoye');
  assert.deepStrictEqual(
    superviseur.envois[1].octets,
    trameEquiper({ uid: 999001, qte: 1, position: POSITION_PIERRE }),
  );
});

test('une quantite mise a jour est suivie', () => {
  const { superviseur, chasse } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivj(233526391, 7) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: iua(999002, 9688, 3, 63) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  // 7 contre 3: la plus grosse pile reste celle d'origine.
  assert.deepStrictEqual(
    superviseur.envois[1].octets,
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
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
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
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  chasse.onTrame({ pid: 42, dir: 'in', frame: ivq(999999, POSITION_PIERRE) });
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(rendus.at(-1).quoi, 'equipe');
});

// --- La purge, demandee par Jibef le 03/09 ---------------------------------

const { POSITION_INVENTAIRE } = require('../src/hdv/trames');

// L'inventaire mesure porte la Moyenne (9687, uid 233525940, 47 unites) a
// l'emplacement. Elle doit en sortir AVANT que la Grande y entre.
test('la purge part avant la pose, et porte la pile entiere', () => {
  const { superviseur, chasse } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  assert.strictEqual(superviseur.envois.length, 2);
  assert.deepStrictEqual(
    superviseur.envois[0].octets,
    trameEquiper({ uid: 233525940, qte: 47, position: POSITION_INVENTAIRE }),
  );
});

// Rien a l'emplacement, rien a purger: un seul ordre.
test('sans rien a l emplacement, aucune purge n est emise', () => {
  const { superviseur, chasse } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: ium(233525940) }); // la Moyenne s en va
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  assert.strictEqual(superviseur.envois.length, 1);
  assert.deepStrictEqual(
    superviseur.envois[0].octets,
    trameEquiper({ uid: 233526391, qte: 1, position: POSITION_PIERRE }),
  );
});

// LE CAS QUI JUSTIFIE LA PURGE. Une pierre qui se remplit pendant le combat
// devient une « Pierre d'ame pleine », gid 7010, et reste a l'emplacement. Elle
// doit en sortir, sinon elle occupe la place sans jamais rien capturer.
test('une pierre pleine restee a l emplacement est purgee', () => {
  const { superviseur, chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: ium(233525940) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: iua(999003, 7010, 1, POSITION_PIERRE) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  assert.strictEqual(superviseur.envois.length, 2);
  assert.deepStrictEqual(
    superviseur.envois[0].octets,
    trameEquiper({ uid: 999003, qte: 1, position: POSITION_INVENTAIRE }),
  );
  assert.strictEqual(rendus.at(-1).quoi, 'envoye');
});

// --- Les deux corrections du 03/09, 14h40 ----------------------------------

// LE SERVEUR NE REPOND PAS PAR ivq QUAND LA PILE SE SCINDE. Il cree une pile
// neuve DEJA a l'emplacement, et n'emet aucun ivq. Mesure du 03/09:
//   iua { 3={1=31 5={1=9689 3=1 4=242186527}} }
// OMNI attendait un ivq qui ne pouvait pas venir et concluait a tort que le
// serveur n'avait rien repondu, sur un ordre qui avait parfaitement marche.
test('une pile neuve a l emplacement confirme la pose', () => {
  const { chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  assert.strictEqual(rendus.at(-1).quoi, 'envoye');
  chasse.onTrame({ pid: 42, dir: 'in', frame: iua(242186527, 9688, 1, POSITION_PIERRE) });
  assert.strictEqual(rendus.at(-1).quoi, 'equipe');
  assert.strictEqual(rendus.at(-1).gid, 9688);
});

test('une pile neuve rangee ailleurs ne confirme rien', () => {
  const { chasse, rendus } = monte();
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  chasse.onTrame({ pid: 42, dir: 'in', frame: iua(242186528, 9688, 1, 63) });
  assert.strictEqual(rendus.at(-1).quoi, 'envoye');
});

// UNE MULE QUI REJOINT LE COMBAT NE VOIT PAS LE GROUPE PARTIR. Mesure du 03/09:
// sur trois clients, un seul a recu le kmu. Le niveau se retient donc une fois,
// et chaque client s equipe quand SA liste de combattants arrive.
test('un seul kmu suffit, chaque client s equipe en rejoignant', () => {
  const superviseur = doubleSuperviseur([42, 43, 44]);
  const rendus = [];
  const chasse = creerChasse({
    superviseur, actif: true, onCompteRendu: (r) => rendus.push(r),
  });
  for (const pid of [42, 43, 44]) {
    chasse.onTrame({ pid, dir: 'in', frame: fixture('chasse-ivx-inventaire.hex') });
  }
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  // Seul le maitre voit le groupe partir.
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  assert.strictEqual(superviseur.envois.length, 0, 'rien avant d etre dans le combat');
  for (const pid of [42, 43, 44]) {
    chasse.onTrame({ pid, dir: 'in', frame: kmk(-1, -2, 777) });
  }
  for (const pid of [42, 43, 44]) {
    assert.strictEqual(superviseur.envoisDe(pid).length, 2, 'pid ' + pid);
  }
  assert.strictEqual(rendus.filter((r) => r.quoi === 'envoye').length, 3);
});

// LE COEUR DE LA DEMANDE DE JIBEF: une mule encore en deplacement ne peut rien
// equiper, le jeu refuse. Elle doit etre servie quand elle ARRIVE, pas quand le
// maitre attaque.
test('une mule en retard est equipee a son arrivee, pas avant', () => {
  const superviseur = doubleSuperviseur([42, 43]);
  const chasse = creerChasse({ superviseur, actif: true });
  for (const pid of [42, 43]) {
    chasse.onTrame({ pid, dir: 'in', frame: fixture('chasse-ivx-inventaire.hex') });
  }
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmk(-1, 777) });
  assert.strictEqual(superviseur.envoisDe(43).length, 0, 'la mule marche encore');
  chasse.onTrame({ pid: 43, dir: 'in', frame: kmk(-1, 777) });
  assert.strictEqual(superviseur.envoisDe(43).length, 2, 'elle est arrivee');
});

// kmk sert AUSSI a lister les acteurs d une carte, ou tout est positif.
test('une liste d acteurs de carte n equipe personne', () => {
  const superviseur = doubleSuperviseur([42]);
  const chasse = creerChasse({ superviseur, actif: true });
  chasse.onTrame({ pid: 42, dir: 'in', frame: fixture('chasse-ivx-inventaire.hex') });
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmu(-300) });
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmk(777, 888) });
  assert.strictEqual(superviseur.envois.length, 0);
});

// Plusieurs kmk tombent pendant un meme combat: un seul ordre par client.
test('une seconde liste de combattants ne rejoue rien', () => {
  const superviseur = doubleSuperviseur([42]);
  const chasse = creerChasse({ superviseur, actif: true });
  chasse.onTrame({ pid: 42, dir: 'in', frame: fixture('chasse-ivx-inventaire.hex') });
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  chasse.onTrame({ pid: 42, dir: 'in', frame: kmk(-1, -2, 777) });
  assert.strictEqual(superviseur.envois.length, 2);
});

// Deux clients sur la carte recoivent le MEME kmu: sans garde, on equiperait
// deux fois de suite.
test('le meme groupe deux fois de suite n equipe qu une fois', () => {
  const superviseur = doubleSuperviseur([42, 43]);
  const rendus = [];
  const chasse = creerChasse({
    superviseur, actif: true, onCompteRendu: (r) => rendus.push(r),
  });
  for (const pid of [42, 43]) {
    chasse.onTrame({ pid, dir: 'in', frame: fixture('chasse-ivx-inventaire.hex') });
  }
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  chasse.onTrame({ pid: 43, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  entrer(chasse, 43, -300);
  assert.strictEqual(superviseur.envois.length, 4); // 2 clients x (purge + pose)
});

// La garde ne doit pas avaler un combat qui suit, sur le meme groupe, plus tard.
test('le meme groupe hors de la fenetre equipe de nouveau', () => {
  const superviseur = doubleSuperviseur([42]);
  let horloge = 0;
  const chasse = creerChasse({
    superviseur, actif: true, reglages: { maintenant: () => horloge },
  });
  chasse.onTrame({ pid: 42, dir: 'in', frame: fixture('chasse-ivx-inventaire.hex') });
  chasse.onTrame({ pid: 42, dir: 'in', frame: jssNiveau(120) });
  entrer(chasse, 42, -300);
  horloge = 6000;
  entrer(chasse, 42, -300);
  assert.strictEqual(superviseur.envois.length, 4);
});
