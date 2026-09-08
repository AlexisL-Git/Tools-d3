'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  creerAccepteur, construireAcceptation, TYPE_INVITATION, PERIMES,
  CHAMP_INVITANT, CHAMP_GROUPE,
} = require('../src/invitation');
const { decodeFrameRaw } = require('../src/codec/rawProto');

const MOI = 665809125670n;
const AMI = 677057659174n;
const ETRANGER = 123456789012n;

// Un identifiant de groupe quelconque pour les trames synthetiques. Les octets
// REELS, eux, sont plus bas: IKB_REEL et IKG_REEL, mesures le 08/09 au soir.
//
// Les octets du 20/08 ont ete retires plutot que rafraichis: leur nom `ijx` est
// mort avec le patch, et une fixture reconstruite autour d'un nom mort ne
// prouve rien que « l'acceptation construite est celle que le client a emise »
// ne prouve mieux, sur des octets que le jeu a vraiment produits.
const GROUPE = 36380n;

function fauxSuperviseur(comptes = [[1, MOI], [2, AMI]]) {
  const emis = [];
  const etats = new Map(comptes.map(([pid, id]) => [pid, {
    pid, accepteInvitation: true, characterId: id,
  }]));
  return {
    emis,
    etats,
    comptes: { get: (pid) => etats.get(pid) || null, get tous() { return [...etats.values()]; } },
    emettre: (pid, octets) => { emis.push({ pid, octets }); return { ok: true, octets: octets.length }; },
  };
}

// LES HELPERS SE CONSTRUISENT SUR LES CONSTANTES EXPORTEES, jamais sur des
// numeros ecrits ici: c'est ce qui leur a permis de suivre le remappage du
// 08/09 sans retouche, comme ceux du passe-tour. Seul CHAMP_NOUS reste
// litteral, parce que le module ne le lit pas — il n'a donc pas de constante.
//
// Le champ qui nous designe est au 7 depuis le patch 3.6.11.12; il etait au 1.
const CHAMP_NOUS = 7;
const invitation = (invitant, groupe = GROUPE) => ({
  kind: 'event', type: TYPE_INVITATION,
  payload: [
    { no: CHAMP_NOUS, value: MOI },
    { no: CHAMP_INVITANT, value: invitant },
    { no: CHAMP_GROUPE, value: groupe },
  ],
});
const invitationSansGroupe = (invitant) => ({
  kind: 'event', type: TYPE_INVITATION,
  payload: [{ no: CHAMP_NOUS, value: MOI }, { no: CHAMP_INVITANT, value: invitant }],
});
const evenement = (frame, pid = 1) => ({ pid, dir: 'in', frame, brute: Buffer.alloc(0) });

function accepteur(sup, reglages = { actif: true }, rendu = []) {
  return creerAccepteur({ superviseur: sup, reglages, onCompteRendu: (r) => rendu.push(r) });
}

test('l acceptation construite se relit', () => {
  assert.notStrictEqual(decodeFrameRaw(construireAcceptation(GROUPE)), null);
});

test('une invitation venue d un de nos comptes est acceptee', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(invitation(AMI)));
  assert.strictEqual(sup.emis.length, 1);
  assert.strictEqual(sup.emis[0].pid, 1);
});

// Le coeur de la fonction: sans ce filtre, n'importe qui en jeu peut faire
// rejoindre son groupe a un compte dont l'interrupteur est actif.
test('une invitation venue d un tiers est refusee, et le dit', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(invitation(ETRANGER)));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(rendu[0].ok, false);
  assert.match(rendu[0].raison, /invitant/);
});

// Notre propre characterId n'est pas un invitant valable: il designe le
// destinataire, pas un autre client. C'est exactement ce que le champ 1 porte.
test('une invitation portant notre propre identifiant est refusee', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(invitation(MOI)));
  assert.strictEqual(sup.emis.length, 0);
});

test('l interrupteur general eteint bloque et le dit', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: false }, rendu)(evenement(invitation(AMI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /interrupteur/);
});

test('un compte inconnu du superviseur bloque et le dit', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(invitation(AMI), 99));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /inconnu/);
});

test('un compte dont l interrupteur est eteint bloque et le dit', () => {
  const sup = fauxSuperviseur();
  sup.etats.get(1).accepteInvitation = false;
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(invitation(AMI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /eteint/);
});

// Une trame sortante porte les memes types: le client emet lui-meme
// l'acceptation quand l'utilisateur clique. La rejouer serait un doublon.
test('une trame sortante ne declenche rien', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)({ pid: 1, dir: 'out', frame: invitation(AMI), brute: Buffer.alloc(0) });
  assert.strictEqual(sup.emis.length, 0);
});

test('un autre type de trame ne declenche rien', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement({ kind: 'event', type: 'jxz', payload: [] }));
  assert.strictEqual(sup.emis.length, 0);
});

// Un client ferme entre l'invitation et l'acceptation.
test('un echec d emission est signale sans exception', () => {
  const sup = fauxSuperviseur();
  sup.emettre = () => ({ ok: false, raison: 'pas de socket amont' });
  const rendu = [];
  assert.doesNotThrow(() => accepteur(sup, { actif: true }, rendu)(evenement(invitation(AMI))));
  assert.strictEqual(rendu[0].ok, false);
  assert.match(rendu[0].raison, /socket amont/);
});

test('deux comptes sont independants', () => {
  const sup = fauxSuperviseur();
  const a = accepteur(sup);
  a(evenement(invitation(AMI), 1));
  a(evenement(invitation(MOI), 2));
  assert.deepStrictEqual(sup.emis.map((e) => e.pid).sort(), [1, 2]);
});

// L'acceptation N'EST PAS constante: l'identifiant de groupe a valu 35949,
// 36074 puis 36380 sur trois mesures. Une trame figee n'accepterait que le
// groupe du jour de la mesure.
test('l identifiant de groupe de l invitation est recopie dans l acceptation', () => {
  const sup = fauxSuperviseur();
  accepteur(sup)(evenement(invitation(AMI, 4242n)));
  const f = decodeFrameRaw(sup.emis[0].octets);
  assert.strictEqual(f.type, 'ikg');
  const c = f.payload.find((x) => x.no === 1);
  assert.strictEqual(c.value, 4242n);
});

// Accepter a l'aveugle une invitation dont on n'a pas l'identifiant enverrait
// une trame a moitie traduite; c'est ce que peutRejouer() refuse deja ailleurs.
test('une invitation sans identifiant de groupe est refusee, pas acceptee a l aveugle', () => {
  const sup = fauxSuperviseur();
  const rendu = [];
  accepteur(sup, { actif: true }, rendu)(evenement(invitationSansGroupe(AMI)));
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /identifiant/);
});

// LE PANNEAU D'INVITATION. Voir src/masque.js: il ne peut pas etre ferme par
// le reseau, seulement empeche de s'ouvrir. L'accepteur est le seul a savoir
// quelle trame a ete acceptee -- et c'est lui, jamais un filtre recopie
// ailleurs, qui designe ce qui doit etre masque au client.
const BRUTE = Buffer.from('0a37 0a35 0a13'.replace(/ /g, ''), 'hex');
const evenementBrut = (frame, brute, pid = 1) => ({ pid, dir: 'in', frame, brute });

test('l invitation acceptee est marquee, pour ne jamais atteindre le client', () => {
  const sup = fauxSuperviseur();
  const masquees = [];
  creerAccepteur({
    superviseur: sup, reglages: { actif: true },
    masquer: (pid, brute) => masquees.push({ pid, brute }),
  })(evenementBrut(invitation(AMI), BRUTE));
  assert.strictEqual(sup.emis.length, 1);
  assert.strictEqual(masquees.length, 1);
  assert.strictEqual(masquees[0].pid, 1);
  assert.ok(masquees[0].brute.equals(BRUTE));
});

// Une invitation qu'on n'accepte pas doit rester VISIBLE: la masquer
// ferait disparaitre en silence l'invitation d'un vrai ami.
test('une invitation refusee n est jamais marquee', () => {
  const sup = fauxSuperviseur();
  const masquees = [];
  const a = creerAccepteur({
    superviseur: sup, reglages: { actif: true },
    masquer: (pid, brute) => masquees.push({ pid, brute }),
  });
  a(evenementBrut(invitation(ETRANGER), BRUTE));
  a(evenementBrut(invitationSansGroupe(AMI), BRUTE));
  assert.strictEqual(sup.emis.length, 0);
  assert.strictEqual(masquees.length, 0);
});

// --- L'ENVELOPPE APRES LE PATCH 3.6.11.12 ---------------------------------
//
// Mesure du 08/09 (cf. src/codec/rawProto.js): 63 requetes sortantes, TOUTES
// en kind 1; 244 events entrants, tous en kind 2. Avant le patch c'etait
// l'inverse, et `construireAcceptation` porte encore ce numero d'aout.
//
// UNE ACCEPTATION EMISE EN KIND 2 EST UN EVENEMENT, PAS UNE REQUETE: le
// serveur n'y repond pas. C'est le defaut que le remappage de l'echange a
// nomme « celui qui aurait fait le plus de degats » -- la fonction agit, et
// agit a cote. echange.js et passeur.js portent le 1 depuis le 08/09;
// invitation.js est reste dehors.
test('l acceptation part dans l enveloppe des requetes du patch 3.6.11.12', () => {
  const f = decodeFrameRaw(construireAcceptation(GROUPE));
  assert.strictEqual(f.kind, 'request', 'une acceptation est une requete, pas un evenement');
});

// --- CE QUI RESTE A REMESURER, ET QUI DOIT SE VOIR -------------------------
//
// Les quinze tests ci-dessus passaient VERTS le 08/09 au soir alors que la
// fonction etait morte en jeu: ils confrontent le module a lui-meme, avec
// `TYPE_INVITATION` des deux cotes. C'est exactement la lecon du remappage du
// replicate — « les tests precedents passaient sur une table morte ».
//
// Ce test-ci ne peut pas mentir de la meme facon: il nomme les octets.
//
// La liste a porte `ijz` et `ijx` entre le patch et la remesure du soir. Elle
// est vide parce que les deux noms ont ete remesures — pas parce que personne
// n'y a pense. Au prochain patch, y remettre ce qui n'a pas pu etre mesure:
// c'est le seul endroit ou une fonction eteinte se declare, et une suite verte
// ne doit jamais pretendre qu'elle marche.
test('aucun nom ne reste à remesurer', () => {
  assert.deepStrictEqual(PERIMES, [], 'un nom non remesuré doit être déclaré ici');
  assert.ok(!PERIMES.includes(TYPE_INVITATION));
  assert.ok(!PERIMES.includes(decodeFrameRaw(construireAcceptation(GROUPE)).type));
});

// Le pendant du precedent: le jour ou la remesure aura eu lieu, ces deux noms
// ne doivent plus apparaitre NULLE PART dans le module. Un remappage a moitie
// fait — le type ecoute change, l'URL emise oubliee — enverrait une
// acceptation que le serveur ignore, et le panneau resterait ouvert sans que
// rien ne le dise. C'est precisement ce qui est arrive a l'echange le 08/09.
test('les deux noms se remappent ensemble, jamais l un sans l autre', () => {
  const emis = decodeFrameRaw(construireAcceptation(GROUPE)).type;
  const restants = [TYPE_INVITATION, emis].filter((n) => PERIMES.includes(n));
  assert.ok(
    restants.length === 0 || restants.length === 2,
    `remappage à moitié fait : écouté ${TYPE_INVITATION}, émis ${emis}, périmés ${PERIMES.join(' ')}`,
  );
});

// --- LA MESURE DU 08/09 AU SOIR, QUATRE COMPTES ---------------------------
//
// Le geste manquait a toutes les captures du 08/09: il a ete fait le soir, sur
// journal-invitation.log. Un maitre invite ses trois mules, chacune accepte a
// la main — l'acceptation automatique etait morte, c'est ce qu'on repare.
//
// LE NOM A CHANGE, ET LA STRUCTURE AUSSI: les six champs ont PERMUTE. Un
// remappage qui n'aurait touche que le nom aurait lu l'invitant au champ 2, qui
// porte desormais la constante 1, et le groupe au champ 5, qui porte la
// constante 8. Toutes les invitations auraient ete refusees — et si la garde
// avait laisse passer, l'acceptation serait partie sur le groupe « 8 ».
//
//   role                avant   apres
//   l invitant            2   ->   1
//   la constante 1        6   ->   2
//   le nom de l invitant  7   ->   3
//   la constante 8        3   ->   5
//   l identifiant groupe  5   ->   6
//   le destinataire, nous 1   ->   7
//
// Octets d'origine, sans retouche. `ikb` recu par le pid 6556 a 33799 ms, et
// le `ikg` que ce meme client a emis 11 820 ms plus tard, au clic.
const IKB_REEL = '12431a410a13747970652e616e6b616d612e636f6d2f696b62122a08a682f488da13'
  + '1001 1a134c616e63652d5472756974652d556c74696d65 2808 309f34 38a682e888da13'.replace(/ /g, '');
const IKG_REEL = '0a270a1a0a13747970652e616e6b616d612e636f6d2f696b671203089f3410ffffffffffffffffff01';
const GROUPE_REEL = 6687n;
const MAITRE = 677012898086n;      // Lance-Truite-Ultime, l invitant
const MULE = 677012701478n;        // le destinataire, pid 6556

// L'INVITATION ARRIVE EN KIND 2, L'ACCEPTATION PART EN KIND 1. Les octets le
// disent tout seuls: `12 43 …` d'un cote, `0a 27 …` de l'autre. C'est la
// mesure du 08/09 sur l'enveloppe, confirmee ici par le client lui-meme.
test('l invitation mesurée est un événement, l acceptation une requête', () => {
  assert.strictEqual(decodeFrameRaw(Buffer.from(IKB_REEL, 'hex')).kind, 'event');
  assert.strictEqual(decodeFrameRaw(Buffer.from(IKG_REEL, 'hex')).kind, 'request');
});

test('les champs de l invitation mesurée sont lus aux bons numéros', () => {
  const f = decodeFrameRaw(Buffer.from(IKB_REEL, 'hex'));
  assert.strictEqual(f.type, TYPE_INVITATION);
  const c = (no) => f.payload.find((x) => x.no === no).value;
  assert.strictEqual(c(CHAMP_INVITANT), MAITRE, 'l invitant');
  assert.strictEqual(c(CHAMP_GROUPE), GROUPE_REEL, 'l identifiant de groupe');
  assert.strictEqual(c(7), MULE, 'le destinataire reste au champ 7');
});

// L'ACCEPTATION RECONSTRUITE EST CELLE DU CLIENT, OCTET POUR OCTET. C'est la
// verification qui manquait a l'echange: une trame qu'on croit juste parce
// qu'elle se decode, et qui part quand meme a cote.
test('l acceptation construite est celle que le client a émise', () => {
  assert.strictEqual(construireAcceptation(GROUPE_REEL).toString('hex'), IKG_REEL);
});

// De bout en bout sur les octets captes: la mule recoit l'invitation de son
// maitre et emet exactement ce que l'utilisateur a du cliquer a la main.
test('l invitation mesurée est acceptée toute seule', () => {
  const sup = fauxSuperviseur([[6556, MULE], [9440, MAITRE]]);
  const rendu = [];
  const brute = Buffer.from(IKB_REEL, 'hex');
  accepteur(sup, { actif: true }, rendu)({
    pid: 6556, dir: 'in', frame: decodeFrameRaw(brute), brute,
  });
  assert.strictEqual(sup.emis.length, 1, rendu[0] && rendu[0].raison);
  assert.strictEqual(sup.emis[0].octets.toString('hex'), IKG_REEL);
  assert.strictEqual(rendu[0].groupe, GROUPE_REEL);
});

// Le filtre tient sur la trame reelle: le maitre n'est plus des notres.
test('l invitation mesurée venue d un inconnu est refusée', () => {
  const sup = fauxSuperviseur([[6556, MULE], [9440, 999999999999n]]);
  const rendu = [];
  const brute = Buffer.from(IKB_REEL, 'hex');
  accepteur(sup, { actif: true }, rendu)({
    pid: 6556, dir: 'in', frame: decodeFrameRaw(brute), brute,
  });
  assert.strictEqual(sup.emis.length, 0);
  assert.match(rendu[0].raison, /invitant/);
});
