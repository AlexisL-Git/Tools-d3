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

// kbt AVEC champ 3: la reponse a kbz. Sans champ 3 ce serait l'accuse du
// desabonnement precedent, et lireStatsPrix rend null dessus.
const trameKbt = (gid, prix) => evenement('kbt', [
  vint(1, 51), vint(2, gid),
  { no: 3, wire: WIRE.LEN, kind: 'message', value: [
    { no: 6, wire: WIRE.LEN, kind: 'bytes', value: packes(prix), raw: packes(prix) },
  ] },
]);
const trameKgp = (gid, prix) => evenement('kgp', [
  { no: 2, wire: WIRE.LEN, kind: 'bytes', value: packes(prix), raw: packes(prix) },
  vint(5, gid), vint(6, 51),
]);
const trameIvj = (uid, qte) => evenement('ivj', [
  { no: 3, wire: WIRE.LEN, kind: 'message', value: [vint(2, uid), vint(3, qte)] },
]);
const trameIum = (uid) => evenement('ium', [vint(1, uid)]);

// Une pile unique, pour piloter une passe courte et lisible.
function venteAvecPile({ gid = 13731, qte = 200, moyen = 32 } = {}) {
  const superviseur = doubleSuperviseur();
  const rendus = [];
  const vente = creerVente({
    superviseur,
    reglages: { delaiObjetMs: 0, delaiRafaleMs: 0, delaiReponseMs: 0 },
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
  assert.strictEqual(abonnement.type, 'keh');
  // Un champ absent doit ECHOUER comme une assertion, pas lever un TypeError:
  // « undefined n'est pas 8437 » nomme l'attendu, « cannot read .value » non.
  const valeur = (no) => {
    const f = (abonnement.payload || []).find((x) => x.no === no);
    return f === undefined ? null : Number(f.value);
  };
  assert.strictEqual(valeur(1), 8437);
  // Le champ 2 distingue l'abonnement du DESABONNEMENT, qui est le meme
  // message sans lui. Sans cette assertion, confondre les deux passerait.
  assert.strictEqual(valeur(2), 1);
  vente.arreter(42);
});

// --- La passe ------------------------------------------------------------

test('la passe s abonne, lit le marche, puis pose', () => {
  const { superviseur, vente } = venteAvecPile({ qte: 100 });
  vente.lancer(42);
  assert.deepStrictEqual(typesEmis(superviseur), ['keh', 'kbz']);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameKbt(13731, [19, 190, 5000, 0]) });
  assert.deepStrictEqual(typesEmis(superviseur), ['keh', 'kbz', 'kge']);
  const kge = decodeFrameRaw(superviseur.envois[2].octets);
  assert.strictEqual(kge.type, 'kge');
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
  const kge = superviseur.envois.filter((e) => decodeFrameRaw(e.octets).type === 'kge');
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
    .filter((f) => f.type === 'kge')
    .map((f) => f.payload.find((c) => c.no === 1).value);
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
    .filter((f) => f.type === 'kge')
    .map((f) => Number(f.payload.find((c) => c.no === 1).value));
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
  assert.strictEqual(typesEmis(superviseur).filter((t) => t === 'kge').length, 1);
  vente.onTrame({ pid: 42, dir: 'in', frame: trameIvj(84496683, 100) });
  // Le second lot, lui, paie la rafale: il n'est pas encore parti.
  assert.strictEqual(typesEmis(superviseur).filter((t) => t === 'kge').length, 1);
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(typesEmis(superviseur).filter((t) => t === 'kge').length, 2);
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
  const kge = superviseur.envois.filter((e) => decodeFrameRaw(e.octets).type === 'kge');
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
  const kehAvant = typesEmis(superviseur).filter((t) => t === 'keh').length;
  // Le client meurt et un autre reprend le meme pid, avant que kbt ne reponde.
  superviseur.comptes.set(42, { nom: 'un autre client sous le meme pid' });
  await new Promise((r) => setTimeout(r, 40));
  const kehApres = typesEmis(superviseur).filter((t) => t === 'keh').length;
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
  const kehAvant = typesEmis(superviseur).filter((t) => t === 'keh').length;
  // Le client meurt et un autre reprend le meme pid, avant que la pose ne
  // soit confirmee.
  superviseur.comptes.set(42, { nom: 'un autre client sous le meme pid' });
  await new Promise((r) => setTimeout(r, 40));
  const kehApres = typesEmis(superviseur).filter((t) => t === 'keh').length;
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
  assert.strictEqual(typesEmis(superviseur).filter((t) => t === 'keh').length, 2);
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
