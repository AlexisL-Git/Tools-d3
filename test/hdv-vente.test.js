'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFrameRaw, encodeRaw, WIRE } = require('../src/codec/rawProto');
const { creerVente } = require('../src/hdv/vente');

const fixture = (nom) => decodeFrameRaw(
  Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures', nom), 'utf8').trim(), 'hex'),
);

// Un double du superviseur, comme dans passeur.test.js: il retient ce qu'on lui
// demande d'emettre au lieu d'ouvrir une socket.
function doubleSuperviseur(pid = 42, etat = { nom: 'compte' }) {
  return {
    comptes: new Map([[pid, etat]]),
    envois: [],
    emettre(p, octets) { this.envois.push({ pid: p, octets }); return { ok: true }; },
  };
}

// Une trame ivi fabriquee: la vraie fait 90 Ko et 9861 paires, on n'en a pas
// besoin pour verifier que la table est retenue.
function trameIvi(paires) {
  return decodeFrameRaw(encodeRaw([
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: 'type.ankama.com/ivi' },
        { no: 2, wire: WIRE.LEN, kind: 'message', value: paires.map(([gid, prix]) => ({
          no: 2, wire: WIRE.LEN, kind: 'message', value: [
            { no: 1, wire: WIRE.VARINT, value: BigInt(gid) },
            { no: 2, wire: WIRE.VARINT, value: BigInt(prix) },
          ],
        })) },
      ] },
    ] },
  ]));
}

// Les trames que le serveur renvoie. Fabriquees, parce qu'on a besoin de faire
// varier les prix; leur FORME est celle des trames mesurees, et les lecteurs
// sont figes sur les vraies dans hdv-trames.test.js.
function evenement(type, champs) {
  return decodeFrameRaw(encodeRaw([
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: `type.ankama.com/${type}` },
        ...(champs.length ? [{ no: 2, wire: WIRE.LEN, kind: 'message', value: champs }] : []),
      ] },
    ] },
  ]));
}
const vint = (no, val) => ({ no, wire: WIRE.VARINT, value: BigInt(val) });
const packes = (prix) => {
  const octets = [];
  for (const p of prix) {
    let v = BigInt(p);
    do { const o = Number(v & 0x7fn); v >>= 7n; octets.push(v > 0n ? o | 0x80 : o); } while (v > 0n);
  }
  return Buffer.from(octets);
};

// jzn AVEC son sous-message: la reponse a kbk. Sans lui ce serait l'accuse du
// desabonnement precedent, et lireStatsPrix rend null dessus. Le sous-message
// est passe du champ 3 au CHAMP 2 au patch 3.6.11.12, le gid du 2 au 1 et la
// categorie du 1 au 3; le champ 6 des prix, lui, n'a pas bouge.
const trameKbt = (gid, prix) => evenement('jzn', [
  vint(1, gid),
  { no: 2, wire: WIRE.LEN, kind: 'message', value: [
    { no: 6, wire: WIRE.LEN, kind: 'bytes', value: packes(prix), raw: packes(prix) },
  ] },
  vint(3, 51),
]);
// kgp -> kef: les prix passent du champ 2 au 4, le gid du 5 au 1, la categorie
// du 6 au 3.
const trameKgp = (gid, prix) => evenement('kef', [
  vint(1, gid), vint(3, 51),
  { no: 4, wire: WIRE.LEN, kind: 'bytes', value: packes(prix), raw: packes(prix) },
]);
const trameIvj = (uid, qte) => evenement('ivj', [
  { no: 3, wire: WIRE.LEN, kind: 'message', value: [vint(2, uid), vint(3, qte)] },
]);
const trameIum = (uid) => evenement('ium', [vint(1, uid)]);

// Une pile unique, pour piloter une passe courte et lisible.
function venteAvecPile({ gid = 13731, qte = 200, moyen = 32, garde } = {}) {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 0, delaiRafaleMs: 0, delaiReponseMs: 0, garde },
    onCompteRendu: (r) => rendus.push(r),
  });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[gid, moyen]]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: evenement('iwb', [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      vint(1, 63),
      { no: 5, wire: WIRE.LEN, kind: 'message', value: [vint(1, gid), vint(3, qte), vint(4, 84496683)] },
    ] },
  ]) });
  return { superviseur, vente, rendus };
}
const typesEmis = (superviseur) => superviseur.envois.map(
  (e) => decodeFrameRaw(e.octets).type,
);

test('l ecoute retient les piles fongibles d une ivx', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-ivx-inventaire.hex') });
  // 219 piles mesurees, dont 204 a effets ecartees.
  assert.strictEqual(vente.pilesConnues(42), 15);
});

test('l ecoute retient aussi la banque, et remplace la liste precedente', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-ivx-inventaire.hex') });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-iwb.hex') });
  // 814 piles mesurees en banque, dont 57 a effets ecartees.
  assert.strictEqual(vente.pilesConnues(42), 757);
});

// UNE TRAME QUI NE REND AUCUNE PILE N'EFFACE PAS CE QU'ON SAIT. ivx n'a ete
// observee que comme une liste de stock, mais un decodage a vide ecraserait la
// liste utile — et le bouton deviendrait inerte sans raison visible.
test('une ivx sans pile lisible n efface pas la liste memorisee', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-iwb.hex') });
  const vide = decodeFrameRaw(encodeRaw([
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 1, wire: WIRE.LEN, kind: 'message', value: [
        { no: 1, wire: WIRE.LEN, kind: 'string', value: 'type.ankama.com/ivx' },
        { no: 2, wire: WIRE.LEN, kind: 'message', value: [{ no: 1, wire: WIRE.VARINT, value: 7n }] },
      ] },
    ] },
  ]));
  vente.onTrame({ pid: 42, dir: 'in', frame: vide });
  assert.strictEqual(vente.pilesConnues(42), 757);
});

test('l ecoute ignore le sens sortant', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur });
  vente.onTrame({ pid: 42, dir: 'out', frame: fixture('hdv-iwb.hex') });
  assert.strictEqual(vente.pilesConnues(42), 0);
});

test('lancer refuse tant qu aucun stock n est memorise', () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({ superviseur, onCompteRendu: (r) => rendus.push(r) });
  vente.lancer(42);
  assert.strictEqual(rendus.length, 1);
  assert.strictEqual(rendus[0].ok, false);
  assert.match(rendus[0].raison, /ouvre l hotel de vente/);
  assert.strictEqual(superviseur.envois.length, 0);
});

test('lancer refuse sur un compte qui n est pas pilote', () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({ superviseur, onCompteRendu: (r) => rendus.push(r) });
  vente.onTrame({ pid: 99, dir: 'in', frame: fixture('hdv-iwb.hex') });
  vente.lancer(99);
  assert.strictEqual(rendus[0].ok, false);
  assert.match(rendus[0].raison, /pilote/);
});

test('l ecoute retient les prix moyens d ivi', () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({ superviseur, reglages: { delaiObjetMs: 0, delaiRafaleMs: 0, delaiReponseMs: 0 } });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32], [8437, 39]]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: fixture('hdv-iwb.hex') });
  vente.lancer(42);
  // La passe a demarre: le premier envoi est un abonnement.
  assert.ok(superviseur.envois.length > 0);
  // ET C'EST BIEN LA TABLE D'IVI QUI A DECIDE DE L'ORDRE. Sans elle tous les
  // lots vaudraient zero et le tri retomberait sur le gid 1731; avec elle, le
  // lot le plus cher est le gid 8437. Une assertion sur le seul nombre
  // d'envois ne prouverait rien: la passe demarre dans les deux cas.
  const abonnement = decodeFrameRaw(superviseur.envois[0].octets);
  assert.strictEqual(abonnement.type, 'kde');
  // Un champ absent doit ECHOUER comme une assertion, pas lever un TypeError:
  // « undefined n'est pas 8437 » nomme l'attendu, « cannot read .value » non.
  const valeur = (no) => {
    const f = (abonnement.payload || []).find((x) => x.no === no);
    return f === undefined ? null : Number(f.value);
  };
  // Le gid est passe du champ 1 au CHAMP 2 au patch 3.6.11.12, et le drapeau
  // en sens inverse.
  assert.strictEqual(valeur(2), 8437);
  // Le drapeau distingue l'abonnement du DESABONNEMENT, qui est le meme
  // message sans lui. Sans cette assertion, confondre les deux passerait.
  assert.strictEqual(valeur(1), 1);
  vente.arreter(42);
});

// --- La passe ------------------------------------------------------------

test('la passe s abonne, lit le marche, puis pose', () => {
  const { superviseur, vente } = venteAvecPile({ qte: 100 });
  vente.lancer(42);
  assert.deepStrictEqual(typesEmis(superviseur), ['kde', 'kbk']);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  assert.deepStrictEqual(typesEmis(superviseur), ['kde', 'kbk', 'kcr']);
  const kge = decodeFrameRaw(superviseur.envois[2].octets);
  assert.strictEqual(kge.type, 'kcr');
});

// LA RAFALE NE RELIT PAS LE MARCHE. deciderPose s'aligne au lieu de
// sous-coter, donc tous les lots d'un paquet partent au meme prix: il n'y a
// rien a proteger entre deux. Relire ferait perdre le geste sans rien gagner.
test('un paquet de quatre lots part sans relire kgp entre chaque', () => {
  const { superviseur, vente } = venteAvecPile({ qte: 400 });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  // Quatre lots de 100, confirmes un a un par ivj, sans aucun kgp.
  for (const reste of [300, 200, 100, 0]) {
    vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, reste) });
  }
  const kge = superviseur.envois.filter((e) => decodeFrameRaw(e.octets).type === 'kcr');
  assert.strictEqual(kge.length, 4);
});

test('tous les lots d un paquet partent au meme prix', () => {
  const { superviseur, vente } = venteAvecPile({ qte: 300 });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  for (const reste of [200, 100, 0]) {
    vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, reste) });
  }
  const prix = superviseur.envois
    .map((e) => decodeFrameRaw(e.octets))
    .filter((f) => f.type === 'kcr')
    // Le prix est au champ 2 depuis le patch: le champ 1 porte la taille.
    .map((f) => f.payload.find((c) => c.no === 2).value);
  assert.deepStrictEqual(prix.map(Number), [4999, 4999, 4999]);
});

// LE PRIX DU PAQUET EST ARRETE UNE FOIS, ET kgp NE LE REDECIDE PAS. Le serveur
// pousse un kgp a chaque mouvement du marche tant qu'on est abonne — nos
// propres poses en declenchent. Redecider dessus ferait suivre un concurrent
// au milieu d'un geste qui est cense partir a un seul prix.
test('un kgp ouvre le paquet mais ne le redecide pas', () => {
  const { superviseur, vente } = venteAvecPile({ qte: 200 });
  vente.lancer(42);
  // Pas de kbt ici: c'est le kgp pousse a l'abonnement qui ouvre le paquet.
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKgp(13731, [19, 190, 5000, 0]) });
  // Le marche s'effondre entre les deux lots; le paquet garde son prix.
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKgp(13731, [19, 190, 3000, 0]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, 100) });
  const prix = superviseur.envois
    .map((e) => decodeFrameRaw(e.octets))
    .filter((f) => f.type === 'kcr')
    .map((f) => Number(f.payload.find((c) => c.no === 2).value));
  assert.deepStrictEqual(prix, [4999, 4999]);
});

// LE PREMIER LOT D'UN PAQUET NE PAIE PAS LA RAFALE. Le delai d'objet vient
// deja d'etre servi par paquetSuivant, et kbt d'arriver: payer la rafale
// par-dessus compterait deux fois le meme geste. Il faut un delaiRafaleMs non
// nul pour que le test puisse distinguer les deux — a zero les deux chemins
// se ressemblent.
test('le premier lot d un paquet ne paie pas le delai de rafale', async () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 0, delaiRafaleMs: 50, delaiReponseMs: 0 },
    onCompteRendu: () => {},
  });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32]]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: evenement('iwb', [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      vint(1, 63),
      { no: 5, wire: WIRE.LEN, kind: 'message', value: [vint(1, 13731), vint(3, 200), vint(4, 84496683)] },
    ] },
  ]) });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  // Le premier lot part TOUT DE SUITE, sans attendre la rafale.
  assert.strictEqual(typesEmis(superviseur).filter((t) => t === 'kcr').length, 1);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, 100) });
  // Le second lot, lui, paie la rafale: il n'est pas encore parti.
  assert.strictEqual(typesEmis(superviseur).filter((t) => t === 'kcr').length, 1);
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(typesEmis(superviseur).filter((t) => t === 'kcr').length, 2);
});

// LA PREMIERE VISITE D'UNE PASSE NE PAIE PAS LE DELAI D'OBJET, pour la meme
// raison que le premier lot ne paie pas la rafale: le delai espace DEUX
// objets, et au depart il n'y a pas d'objet precedent. Le geste qui vient
// d'avoir lieu, c'est le clic. Mesure avant correction: 1,4 a 2,6 s de silence
// entre le clic et le premier keh, signale en jeu comme « une grande attente
// au tout debut ». Il faut un delaiObjetMs non nul pour que le test distingue
// les deux chemins — a zero ils se ressemblent.
test('la premiere visite d une passe ne paie pas le delai d objet', async () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 50, delaiRafaleMs: 0, delaiReponseMs: 0 },
  });
  const pile = (gid, qte, uid) => ({
    no: 1, wire: WIRE.LEN, kind: 'message', value: [
      vint(1, 63),
      { no: 5, wire: WIRE.LEN, kind: 'message', value: [vint(1, gid), vint(3, qte), vint(4, uid)] },
    ] });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32], [8437, 39]]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: evenement('iwb', [pile(13731, 100, 1), pile(8437, 100, 2)]) });

  vente.lancer(42);
  // Le premier objet s'ouvre TOUT DE SUITE: rien ne le precede.
  assert.deepStrictEqual(typesEmis(superviseur), ['kde', 'kbk']);

  // Le second, lui, paie: le desabonnement du premier part sans attendre, mais
  // l'abonnement du suivant est differe.
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(8437, [19, 190, 5000, 0]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(2, 0) });
  assert.deepStrictEqual(typesEmis(superviseur), ['kde', 'kbk', 'kcr', 'kde']);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepStrictEqual(typesEmis(superviseur), ['kde', 'kbk', 'kcr', 'kde', 'kde', 'kbk']);
  vente.arreter(42);
});

// L'ARRET SUR REFUS. On ne sait distinguer ni le plafond de lots, ni le manque
// de kamas, ni un hoquet — et on n'a pas a le faire: les trois demandent la
// meme chose. On s'arrete au PREMIER kge non confirme.
test('un kge sans ivj ni ium arrete la passe', async () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 0, delaiRafaleMs: 0, delaiReponseMs: 5 },
    onCompteRendu: (r) => rendus.push(r),
  });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32]]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: evenement('iwb', [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      vint(1, 63),
      { no: 5, wire: WIRE.LEN, kind: 'message', value: [vint(1, 13731), vint(3, 300), vint(4, 84496683)] },
    ] },
  ]) });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  await new Promise((r) => setTimeout(r, 30));
  const fin = rendus.find((r) => r.fini);
  assert.ok(fin, 'la passe se termine');
  assert.match(fin.raison, /refus/);
  assert.strictEqual(fin.bilan.poses, 0);
  assert.strictEqual(fin.bilan.echecs, 1);
});

test('ium confirme aussi bien qu ivj', () => {
  const { vente, rendus } = venteAvecPile({ qte: 100 });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIum(84496683) });
  const fin = rendus.find((r) => r.fini);
  assert.ok(fin, 'la passe se termine');
  assert.strictEqual(fin.bilan.poses, 1);
});

// ivj FAIT AUTORITE SUR NOTRE SOUSTRACTION. Si le joueur a bouge un objet
// entre-temps, notre decoupage est perime: emettre un kge sur une quantite
// qu'on n'a plus est exactement ce qu'il faut eviter.
test('un ivj plus bas que prevu abandonne les lots devenus impossibles', () => {
  const { superviseur, vente, rendus } = venteAvecPile({ qte: 300 });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  // On attendait 200 apres le premier lot de 100; le serveur dit 50.
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, 50) });
  const kge = superviseur.envois.filter((e) => decodeFrameRaw(e.octets).type === 'kcr');
  assert.strictEqual(kge.length, 1, 'les deux lots de 100 restants sont abandonnes');
  const fin = rendus.find((r) => r.fini);
  assert.strictEqual(fin.bilan.poses, 1);
  assert.strictEqual(fin.bilan.sautes, 2);
});

test('un kbt qui n arrive jamais n abandonne que son objet', async () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 0, delaiRafaleMs: 0, delaiReponseMs: 5 },
    onCompteRendu: (r) => rendus.push(r),
  });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32], [8437, 39]]) });
  const pile = (gid, qte, uid) => ({
    no: 1, wire: WIRE.LEN, kind: 'message', value: [
      vint(1, 63),
      { no: 5, wire: WIRE.LEN, kind: 'message', value: [vint(1, gid), vint(3, qte), vint(4, uid)] },
    ] });
  vente.onTrame({ pid: 42, dir: 'in', frame: evenement('iwb', [pile(13731, 100, 1), pile(8437, 100, 2)]) });
  vente.lancer(42);
  await new Promise((r) => setTimeout(r, 30));
  const fin = rendus.find((r) => r.fini);
  assert.ok(fin, 'la passe se termine');
  assert.strictEqual(fin.bilan.objetsAbandonnes, 2);
  assert.strictEqual(fin.raison, null, 'ce n est pas un arret, c est une fin normale');
});

test('un client qui disparait arrete la passe', () => {
  const { superviseur, vente, rendus } = venteAvecPile({ qte: 100 });
  vente.lancer(42);
  superviseur.comptes.set(42, { nom: 'un autre client sous le meme pid' });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  const fin = rendus.find((r) => r.fini);
  assert.ok(fin, 'la passe se termine');
  assert.match(fin.raison, /disparu/);
});

// LA GARDE D'IDENTITE VAUT AUSSI POUR LES MINUTEURS. Ici personne n envoie de
// kbt: c est l attente qui expire, jusqu a delaiReponseMs apres l abonnement —
// largement de quoi laisser un autre client reprendre le pid sous Windows.
// paquetSuivant emettrait un trameDesabonner des sa premiere ligne: sans la
// garde, ce desabonnement partirait dans la session du nouveau client.
test('un client qui disparait pendant l attente de kbt n envoie rien au suivant', async () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 0, delaiRafaleMs: 0, delaiReponseMs: 20 },
    onCompteRendu: (r) => rendus.push(r),
  });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32]]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: evenement('iwb', [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      vint(1, 63),
      { no: 5, wire: WIRE.LEN, kind: 'message', value: [vint(1, 13731), vint(3, 100), vint(4, 84496683)] },
    ] },
  ]) });
  vente.lancer(42);
  const kehAvant = typesEmis(superviseur).filter((t) => t === 'kde').length;
  // Le client meurt et un autre reprend le meme pid, avant que kbt ne reponde.
  superviseur.comptes.set(42, { nom: 'un autre client sous le meme pid' });
  await new Promise((r) => setTimeout(r, 40));
  const kehApres = typesEmis(superviseur).filter((t) => t === 'kde').length;
  assert.strictEqual(kehApres, kehAvant, 'aucun desabonnement n est parti dans la session du nouveau client');
  const fin = rendus.find((r) => r.fini);
  assert.ok(fin, 'la passe se termine');
  assert.match(fin.raison, /disparu/);
});

// MEME GARDE, MEME RAISON, SUR L'AUTRE MINUTEUR: l'attente de confirmation
// dans poserSuivant. terminer() se desabonne quand il croit repondre a un
// refus du serveur; sans la garde, ce desabonnement partirait dans la
// session du client qui a repris le pid.
test('un client qui disparait pendant l attente de confirmation n envoie rien au suivant', async () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 0, delaiRafaleMs: 0, delaiReponseMs: 20 },
    onCompteRendu: (r) => rendus.push(r),
  });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32]]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: evenement('iwb', [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      vint(1, 63),
      { no: 5, wire: WIRE.LEN, kind: 'message', value: [vint(1, 13731), vint(3, 100), vint(4, 84496683)] },
    ] },
  ]) });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  // Le kge est deja parti (delaiRafaleMs: 0); on attend maintenant ivj ou ium.
  const kehAvant = typesEmis(superviseur).filter((t) => t === 'kde').length;
  // Le client meurt et un autre reprend le meme pid, avant que la pose ne
  // soit confirmee.
  superviseur.comptes.set(42, { nom: 'un autre client sous le meme pid' });
  await new Promise((r) => setTimeout(r, 40));
  const kehApres = typesEmis(superviseur).filter((t) => t === 'kde').length;
  assert.strictEqual(kehApres, kehAvant, 'aucun desabonnement n est parti dans la session du nouveau client');
  const fin = rendus.find((r) => r.fini);
  assert.ok(fin, 'la passe se termine');
  assert.match(fin.raison, /disparu/);
  // La garde intercepte AVANT le compte des echecs: ce n'est pas un refus du
  // serveur, c'est une disparition de client.
  assert.strictEqual(fin.bilan.echecs, 0);
});

test('la passe se desabonne en partant', () => {
  const { superviseur, vente } = venteAvecPile({ qte: 100 });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, 0) });
  assert.strictEqual(typesEmis(superviseur).filter((t) => t === 'kde').length, 2);
});

// LA COURSE ENTRE LA CONFIRMATION ET L'ENVOI. attentePile ne doit s'armer
// qu'APRES l'envoi reel du kge, jamais avant: sinon un ivj errant sur la
// meme pile, pendant le delai de rafale, se fait passer pour la confirmation
// d'un lot qui n'est jamais parti — confirmer() annule alors le minuteur
// d'envoi, et le lot compte comme pose sans que son kge soit sorti.
test('un ivj errant pendant la rafale ne compte pas un lot non envoye', async () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 0, delaiRafaleMs: 50, delaiReponseMs: 0 },
    onCompteRendu: (r) => rendus.push(r),
  });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32]]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: evenement('iwb', [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      vint(1, 63),
      { no: 5, wire: WIRE.LEN, kind: 'message', value: [vint(1, 13731), vint(3, 200), vint(4, 84496683)] },
    ] },
  ]) });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  // Le premier lot du paquet ne paie pas la rafale: il est deja parti.
  assert.strictEqual(typesEmis(superviseur).filter((t) => t === 'kcr').length, 1);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, 100) });
  // Le second lot est maintenant dans son delai de rafale de 50 ms: son kge
  // n'est pas encore parti.
  assert.strictEqual(typesEmis(superviseur).filter((t) => t === 'kcr').length, 1);
  // Un ivj errant sur la meme pile arrive PENDANT ce delai — une vente faite
  // a la main par le joueur, precisement devant son hotel de vente. Il ne
  // doit rien confirmer: aucun kge ne le justifie encore.
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, 50) });
  // L'ASSERTION PORTE SUR LE NOMBRE DE POSES, PAS SUR CELUI DES COMPTES
  // RENDUS. Compter les rendus etait un raccourci tant qu'un seul d'entre eux
  // portait `poses`; l'avancement en porte un aussi depuis qu'il affiche
  // « X poses — Y restants ». La grandeur elle-meme ne se prete pas a
  // l'ambiguite.
  const dernier = rendus.filter((r) => r.poses !== undefined).pop();
  assert.strictEqual(dernier.poses, 1, 'le lot errant ne compte pas comme pose');
  await new Promise((r) => setTimeout(r, 80));
  // Le delai de rafale n'a pas ete annule a tort: le second kge finit par
  // partir de lui-meme.
  assert.strictEqual(typesEmis(superviseur).filter((t) => t === 'kcr').length, 2);
});

// --- Les fonctions de rythme ---------------------------------------------

test('rythmeRafale reste dans ses bornes', () => {
  const { rythmeRafale, DELAI_RAFALE_MIN, DELAI_RAFALE_MAX } = require('../src/hdv/vente');
  assert.strictEqual(rythmeRafale(() => 0), DELAI_RAFALE_MIN);
  assert.strictEqual(rythmeRafale(() => 0.999999), DELAI_RAFALE_MAX);
});

test('rythmeVisite ajoute la pause et rearme le compteur', () => {
  const { rythmeVisite, DELAI_OBJET_MIN, PAUSE_MIN, DELAI_OBJET_MAX, PAUSE_MAX } = require('../src/hdv/vente');
  const sansPause = rythmeVisite(5, () => 0);
  assert.strictEqual(sansPause.ms, DELAI_OBJET_MIN);
  assert.strictEqual(sansPause.compteur, 4);
  const avecPause = rythmeVisite(1, () => 0);
  assert.strictEqual(avecPause.ms, DELAI_OBJET_MIN + PAUSE_MIN);
  assert.ok(avecPause.compteur >= 20, 'le compteur est rearme, sinon toutes les visites suivantes pauseraient');
  const haut = rythmeVisite(1, () => 0.999999);
  assert.strictEqual(haut.ms, DELAI_OBJET_MAX + PAUSE_MAX);
});

// --- L'avancement --------------------------------------------------------

// LE COMPTE RENDU N'ETAIT EMIS QU'APRES UNE POSE CONFIRMEE. Un stock ou les
// piles ont fondu, ou dont les prix sont indecidables, faisait donc une passe
// entierement muette: l'affichage restait fige sur le message du clic sans que
// rien ne dise si elle travaillait.
//
// Le lancement annonce le nombre de lots, et c'est le seul compte rendu marque
// `debut`: l'IHM s'en sert pour rafraichir tout de suite, une fois par passe.
test('le lancement annonce le nombre de lots a mettre en vente', () => {
  const { vente, rendus } = venteAvecPile({ qte: 200 });
  vente.lancer(42);
  // 200 unites font deux lots de 100.
  assert.deepStrictEqual(rendus[0], { pid: 42, debut: true, restant: 2, total: 2 });
});

// Le restant tombe a zero quand la passe va au bout, et il ne remonte jamais.
test('le restant decroit a chaque lot qui quitte la file', () => {
  const { vente, rendus } = venteAvecPile({ qte: 300 });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  for (const reste of [200, 100, 0]) {
    vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, reste) });
  }
  const vus = rendus.filter((r) => r.restant !== undefined).map((r) => r.restant);
  assert.deepStrictEqual([...new Set(vus)], [3, 2, 1, 0]);
  const fin = rendus.find((r) => r.fini);
  assert.strictEqual(fin.bilan.poses, 3);
});

// LE CAS QUE LES BILANS RATENT, et ici il est franc: a l'expiration d'un kbt,
// vente.js compte `objetsAbandonnes += 1` et vide la file. Les LOTS de ce
// paquet ne sont comptes nulle part — ni poses, ni sautes, ni echecs. Un
// restant deduit de `total - (poses + sautes + echecs)` resterait donc bloque
// a 2 pour toujours. Il se decremente la ou les lots QUITTENT la file.
test('les lots d un objet abandonne sortent du decompte', async () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 0, delaiRafaleMs: 0, delaiReponseMs: 5 },
    onCompteRendu: (r) => rendus.push(r),
  });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32], [8437, 39]]) });
  const pile = (gid, qte, uid) => ({
    no: 1, wire: WIRE.LEN, kind: 'message', value: [
      vint(1, 63),
      { no: 5, wire: WIRE.LEN, kind: 'message', value: [vint(1, gid), vint(3, qte), vint(4, uid)] },
    ] });
  vente.onTrame({ pid: 42, dir: 'in', frame: evenement('iwb', [pile(13731, 100, 1), pile(8437, 100, 2)]) });
  vente.lancer(42);
  assert.strictEqual(rendus[0].total, 2, 'un lot de 100 par pile');
  await new Promise((r) => setTimeout(r, 30));

  const vus = rendus.filter((r) => r.restant !== undefined);
  assert.strictEqual(vus[vus.length - 1].restant, 0,
    'les deux objets abandonnes ont rendu leurs lots au decompte');
  const fin = rendus.find((r) => r.fini);
  assert.strictEqual(fin.bilan.objetsAbandonnes, 2);
});

// --- LE TABLEAU DES ECARTES ---------------------------------------------
//
// Le bilan ne comptait que des lots « sautes », sans jamais dire pourquoi. Six
// lots partis a 7 000 002 kamas le 05/09 n'auraient rien coute si la passe
// avait su le dire — d'ou ce tableau, groupe par (gid, taille, motif) et non
// par lot: 6495 lots de mesure font 1530 paquets, une ligne par lot serait
// illisible autant qu'inutile.
test('un marche delirant ecarte le paquet, et le bilan dit pourquoi', () => {
  const { vente, rendus } = venteAvecPile({ qte: 60, moyen: 152 });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [0, 7000002, 0, 0]) });
  const fin = rendus.find((r) => r.fini);
  assert.strictEqual(fin.bilan.poses, 0);
  assert.strictEqual(fin.bilan.sautes, 6);
  // LE NOM FAIT PARTIE DU BILAN, pose par noterEcart: c'est « six lots de
  // Pierre Medicinale a 7 000 001 » que le tableau doit pouvoir afficher, pas
  // « six lots de 13731 ».
  assert.deepStrictEqual(fin.bilan.ecartes, [{
    gid: 13731, nom: 'Pierre Médicinale', taille: 10, lots: 6, motif: 'trop-haut', vise: 7000001, borne: 7600, moyenUnitaire: 152,
  }]);
});

// --- LES FACTEURS DE RYTHME REGLABLES ------------------------------------
//
// Le meme jeu de reglages qu'en face, et RELATIF pour la meme raison: la
// rafale part de 90-260 et le delai d'objet de 900-2600, quand reprix.js part
// de 900-2600 et 400-1400. Un facteur commun applique a des bases differentes
// ralentit les deux fonctions sans rien ecraser; des millisecondes communes
// auraient efface l'une des deux mesures faites en jeu.
const {
  AVANT_PAUSE_MIN, AVANT_PAUSE_MAX, compteurInitial,
} = require('../src/hdv/vente');

// LE FACTEUR « LOT » TOMBE SUR LA RAFALE, et c'est le bon etage: poser quatre
// lots identiques, c'est taper Entree quatre fois. C'est le geste que reprix.js
// appelle « d'un lot au suivant », a une echelle de temps pres.
test('le facteur lot etire les bornes de la rafale', () => {
  const { rythmeRafale, DELAI_RAFALE_MIN, DELAI_RAFALE_MAX } = require('../src/hdv/vente');
  assert.strictEqual(rythmeRafale(() => 0, { lot: 2 }), DELAI_RAFALE_MIN * 2);
  assert.strictEqual(rythmeRafale(() => 0.999999, { lot: 2 }), DELAI_RAFALE_MAX * 2);
});

test('le facteur objet etire le delai d une visite a la suivante', () => {
  const { rythmeVisite, DELAI_OBJET_MIN, DELAI_OBJET_MAX } = require('../src/hdv/vente');
  assert.strictEqual(rythmeVisite(5, () => 0, { objet: 2 }).ms, DELAI_OBJET_MIN * 2);
  assert.strictEqual(rythmeVisite(5, () => 0.999999, { objet: 2 }).ms, DELAI_OBJET_MAX * 2);
});

test('le facteur pause n etire que la pause, pas le delai de visite', () => {
  const { rythmeVisite, DELAI_OBJET_MIN, PAUSE_MIN } = require('../src/hdv/vente');
  assert.strictEqual(rythmeVisite(1, () => 0, { pause: 2 }).ms, DELAI_OBJET_MIN + PAUSE_MIN * 2);
});

// ICI LE COMPTEUR SE COMPTE EN VISITES D'OBJET, pas en lots comme en face: la
// rafale est le geste atomique, on ne la coupe pas en son milieu. Le reglage,
// lui, est le meme des deux cotes.
test('le facteur de frequence des pauses divise le compteur rearme', () => {
  const { rythmeVisite } = require('../src/hdv/vente');
  assert.strictEqual(rythmeVisite(1, () => 0, { frequencePause: 2 }).compteur,
    Math.round(AVANT_PAUSE_MIN / 2));
  assert.strictEqual(rythmeVisite(1, () => 0.999999, { frequencePause: 2 }).compteur,
    Math.round(AVANT_PAUSE_MAX / 2));
});

test('le compteur rearme ne descend jamais sous une visite', () => {
  const { rythmeVisite } = require('../src/hdv/vente');
  const r = rythmeVisite(1, () => 0, { frequencePause: 1000 });
  assert.ok(r.compteur >= 1, `compteur=${r.compteur} ferait pauser chaque visite`);
});

test('un reglage absent ou aberrant laisse le rythme d origine', () => {
  const { rythmeVisite, DELAI_OBJET_MIN } = require('../src/hdv/vente');
  assert.strictEqual(rythmeVisite(5, () => 0).ms, DELAI_OBJET_MIN);
  assert.strictEqual(rythmeVisite(5, () => 0, {}).ms, DELAI_OBJET_MIN);
  assert.strictEqual(rythmeVisite(5, () => 0, { objet: 'vite' }).ms, DELAI_OBJET_MIN);
});

test('le compteur initial d une passe honore la frequence des pauses', () => {
  assert.strictEqual(compteurInitial(() => 0), AVANT_PAUSE_MIN);
  assert.strictEqual(compteurInitial(() => 0.999999), AVANT_PAUSE_MAX);
  assert.strictEqual(compteurInitial(() => 0, { frequencePause: 2 }),
    Math.round(AVANT_PAUSE_MIN / 2));
});

// Meme regle qu'en face: l'expiration vit dans le sac de rythme mais n'est pas
// un facteur, parce que c'est de la robustesse et non du realisme.
test('l expiration de reponse se regle depuis le sac de rythme', async () => {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 0, delaiRafaleMs: 0, rythme: { reponseMs: 5 } },
    onCompteRendu: (r) => rendus.push(r),
  });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32]]) });
  const pile = (gid, qte, uid) => ({
    no: 1, wire: WIRE.LEN, kind: 'message', value: [
      vint(1, 63),
      { no: 5, wire: WIRE.LEN, kind: 'message', value: [vint(1, gid), vint(3, qte), vint(4, uid)] },
    ] });
  vente.onTrame({ pid: 42, dir: 'in', frame: evenement('iwb', [pile(13731, 100, 1)]) });
  vente.lancer(42);
  await new Promise((r) => setTimeout(r, 30));
  const fin = rendus.find((r) => r.fini);
  assert.ok(fin, 'sans reglage lu, l attente resterait a 4000 ms et rien n aurait expire');
  assert.strictEqual(fin.bilan.objetsAbandonnes, 1);
});

// LE MEME MAILLON QU'EN FACE, verifie de la meme facon: `reglages.rythme`
// arrive-t-il jusqu'au tirage? Une rupture ici laisserait le panneau bouger, le
// fichier s'ecrire, et les passes garder leur ancien rythme sans un mot.
//
// A x4 la rafale tient 360 a 1040 ms. A 300 ms le second lot n'est donc PAS
// parti, alors qu'au rythme d'origine (90 a 260) il le serait deja: les deux
// fenetres ne se touchent pas. Et il finit par partir, ce qui distingue un
// delai applique d'une passe simplement bloquee.
test('le facteur de rythme atteint vraiment le tirage de la rafale', async () => {
  const superviseur = doubleSuperviseur();
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 0, delaiReponseMs: 0, rythme: { lot: 4 } },
  });
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvi([[13731, 32]]) });
  vente.onTrame({ pid: 42, dir: 'in', frame: evenement('iwb', [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      vint(1, 63),
      { no: 5, wire: WIRE.LEN, kind: 'message', value: [vint(1, 13731), vint(3, 200), vint(4, 84496683)] },
    ] },
  ]) });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  const poses = () => superviseur.envois
    .filter((e) => decodeFrameRaw(e.octets).type === 'kcr').length;
  assert.strictEqual(poses(), 1, 'le premier lot du paquet ne paie pas la rafale');

  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, 100) });
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(poses(), 1,
    'a x4 la rafale dure 360 ms au moins; au rythme d origine le lot serait deja parti');

  await new Promise((r) => setTimeout(r, 900));
  assert.strictEqual(poses(), 2, 'le lot part bien, la passe n est pas bloquee');
  vente.arreter(42);
});

// --- LES GARDE-FOUS REGLES DEPUIS OMNI -----------------------------------
//
// Le facteur et le plafond traversent la passe comme le rythme: relus a chaque
// decision plutot que figes au lancement. Ce qui compte ici n'est pas la regle
// -- elle est testee chez prix.js -- mais le fait qu'elle ARRIVE jusqu'au lot.

test('le plafond regle ecarte un paquet que le facteur laissait passer', () => {
  // Moyen a 300 000 l'unite: le facteur 5 autorise 15 000 000 pour un lot de
  // 10. Seul un plafond peut arreter un marche a 1,2 million.
  const { vente, rendus } = venteAvecPile({
    qte: 10, moyen: 300000, garde: { plafond: 1000000 },
  });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [0, 1200001, 0, 0]) });
  const fin = rendus.find((r) => r.fini);
  assert.strictEqual(fin.bilan.poses, 0);
  assert.deepStrictEqual(fin.bilan.ecartes, [{
    gid: 13731,
    nom: 'Pierre Médicinale',
    taille: 10,
    lots: 1,
    motif: 'au-dessus-du-plafond',
    vise: 1200000,
    borne: 1000000,
    moyenUnitaire: 300000,
  }]);
});

// LE TEMOIN DU CONTRAIRE. Sans plafond, le meme marche fait EMETTRE: la passe
// ne finit donc pas -- elle attend la confirmation du serveur -- et c'est la
// trame `kge` qu'on regarde, pas un bilan qui n'existe pas encore.
test('sans plafond, le meme paquet part', () => {
  const { superviseur, vente } = venteAvecPile({ qte: 10, moyen: 300000 });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [0, 1200001, 0, 0]) });
  assert.deepStrictEqual(typesEmis(superviseur), ['kde', 'kbk', 'kcr']);
});

test('le facteur regle resserre la mise en vente', () => {
  const { vente, rendus } = venteAvecPile({
    qte: 10, moyen: 152, garde: { facteur: 1.5 },
  });
  vente.lancer(42);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [0, 3001, 0, 0]) });
  const fin = rendus.find((r) => r.fini);
  assert.strictEqual(fin.bilan.ecartes.length, 1);
  assert.strictEqual(fin.bilan.ecartes[0].motif, 'trop-haut');
  assert.strictEqual(fin.bilan.ecartes[0].borne, 2280);
});
