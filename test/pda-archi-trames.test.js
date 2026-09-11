'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeFrameRaw, encodeRaw, WIRE } = require('../src/codec/rawProto');
const { lireStock, lirePile, POSITION_INVENTAIRE } = require('../src/hdv/trames');
const {
  lireGroupes, lireGroupeAttaque, lirePosition, trameEquiper, trameLireInventaire,
  lireEntreeCombat,
} = require('../src/pda-archi/trames');

const fixture = (nom) => decodeFrameRaw(
  Buffer.from(fs.readFileSync(path.join(__dirname, 'fixtures', nom), 'utf8').trim(), 'hex'),
);

// LE SEUL NOM QUE LE REMAPPAGE DU 10/09 N A PAS RETROUVE. `ivq` confirmait un
// deplacement de pile; le patch 3.6.11.12 l a tue comme les autres, mais aucun
// des cinq journaux ne contient le geste qui le ferait apparaitre.
//
// POURQUOI IL MANQUE, et ce n est pas un oubli de mesure: le seul mouvement de
// pierre capture est un desequipement qui FUSIONNE la pierre dans une pile
// existante — le serveur repond alors `isf` (la pile d arrivee passe de 13 a
// 14) puis `irz` (la pile source disparait), et aucune trame ne parle de
// position. Il faudrait deplacer une pile QUI NE FUSIONNE PAS.
//
// CE QUE SON ABSENCE COUTE est borne, et c est pourquoi la chasse repart sans
// lui: la pose d une pierre prise dans une pile cree une pile NEUVE, donc
// arrive en `isa`, qui est le vrai chemin de confirmation depuis le 03/09.
// Reste le suivi d un equipement fait A LA MAIN entre deux combats.
const SKIP_IVQ = 'PDA-archi attend sa mesure: le remplacant de ivq demande un'
  + ' deplacement de pile SANS fusion, qu aucun des cinq journaux ne contient.';

// L'inventaire de connexion du 03/09: 471 piles, 454 rangees, 17 portees.
// UNE SEULE pile n'a pas de champ 1 -- l'amulette, position 0. La lire comme
// 63 la ferait passer pour rangee, et le compte tomberait a 455 et 16.
test('lireStock rend la position, et un champ absent vaut 0 et non 63', { skip: "PDA-archi attend sa mesure: ces deux tests reposent sur l'inventaire du 03/09, qui porte une pierre d'ame EQUIPEE en position 31. Sa fixture est dans la forme d'aout, illisible depuis le patch 3.6.11.12. Une chasse a l'archimonstre les retablira." }, () => {
  const piles = lireStock(fixture('pda-archi-ivx-inventaire.hex'));
  assert.strictEqual(piles.length, 471);
  assert.strictEqual(piles.filter((p) => p.pos === POSITION_INVENTAIRE).length, 454);
  assert.strictEqual(piles.filter((p) => p.pos !== POSITION_INVENTAIRE).length, 17);
  assert.strictEqual(piles.filter((p) => p.pos === 0).length, 1);
});

// La position 31 est l'emplacement de la pierre d'ame, mesure du 03/09.
test('la pierre d ame portee se trouve en position 31', { skip: "PDA-archi attend sa mesure: ces deux tests reposent sur l'inventaire du 03/09, qui porte une pierre d'ame EQUIPEE en position 31. Sa fixture est dans la forme d'aout, illisible depuis le patch 3.6.11.12. Une chasse a l'archimonstre les retablira." }, () => {
  const piles = lireStock(fixture('pda-archi-ivx-inventaire.hex'));
  const portees = piles.filter((p) => p.pos === 31);
  assert.strictEqual(portees.length, 1);
  assert.strictEqual(portees[0].gid, 9687);
  assert.strictEqual(portees[0].uid, 233525940);
  assert.strictEqual(portees[0].qte, 47);
});

// REMESURE LE 08/09, patch 3.6.11.12 (journal-hdv.log a 352240 ms). Le message
// qui annonce les acteurs d'une carte s'appelait `jss`; c'est `jpo`, celui-la
// meme qui porte les elements interactifs, et TOUS les numeros ont bouge:
//
//   jss.5[] = { 3: identifiant, 2.1.4.2: le bloc des monstres }
//             chaque monstre = { 1: identifiant, 2: NIVEAU, 4: grade }
//
//   jpo.9[] = { 2: identifiant, 1.1.4.2: le bloc des monstres }
//             chaque monstre = { 1: grade, 2: identifiant, 3: NIVEAU }
//
// CE QUI IDENTIFIE LES TROIS CHAMPS DU MONSTRE, sur les 1014 entrees des trois
// journaux du 08/09: le champ 1 ne prend QUE les valeurs 1 a 5 — les grades du
// jeu; le champ 3 reste entre 24 et 160, un niveau; le champ 2 monte a 4560 et
// ne peut donc etre ni l'un ni l'autre. Le grade et le niveau montent ensemble
// dans un meme groupe (grade 3 -> 66, 4 -> 68, 5 -> 70), ce qui confirme le sens.
//
// La carte porte trois groupes; la fixture est reduite a eux seuls — les autres
// acteurs du champ 9 sont les JOUEURS presents, pseudos et guildes compris.
test('lireGroupes rend les trois groupes de la carte remesuree', () => {
  const groupes = lireGroupes(fixture('pda-archi-jpo-groupes.hex'));
  assert.strictEqual(groupes.size, 3);
  assert.deepStrictEqual(groupes.get(-20000), { niveauMax: 70, monstres: 2 });
  assert.deepStrictEqual(groupes.get(-20001), { niveauMax: 70, monstres: 4 });
  assert.deepStrictEqual(groupes.get(-20002), { niveauMax: 68, monstres: 5 });
});

test('le joueur n est pas un groupe de monstres', () => {
  const groupes = lireGroupes(fixture('pda-archi-jpo-groupes.hex'));
  for (const id of groupes.keys()) assert.ok(id < 0, `${id} n est pas un monstre`);
});

// kmu { 2 = identifiant du groupe } arrive au demarrage du combat.
test('lireGroupeAttaque lit l identifiant du groupe dans kmu', () => {
  const frame = { type: 'kmu', payload: [{ no: 2, wire: WIRE.VARINT, value: -20000n }] };
  assert.strictEqual(lireGroupeAttaque(frame), -20000);
});

test('lireGroupeAttaque ignore une autre trame et un kmu vide', () => {
  assert.strictEqual(lireGroupeAttaque({ type: 'kmk', payload: [] }), null);
  assert.strictEqual(lireGroupeAttaque({ type: 'kmu', payload: [] }), null);
});

// ivq { 1 = uid, 2 = nouvelle position } confirmait le deplacement en 40 ms.
//
// CE NOM EST MORT DEPUIS LE PATCH 3.6.11.12, et son remplacant n est pas
// trouve. Le test reste, et il est SAUTE plutot que supprime: c est lui qui
// portera la mesure quand elle viendra. Voir l en-tete de lirePosition dans
// src/pda-archi/trames.js pour ce que son absence coute — rien au declenchement
// ni a la pose, tout au suivi d un equipement fait a la main.
test('lirePosition lit la confirmation ivq', { skip: SKIP_IVQ }, () => {
  const frame = { type: 'ivq', payload: [
    { no: 1, wire: WIRE.VARINT, value: 233526404n },
    { no: 2, wire: WIRE.VARINT, value: 31n },
  ] };
  assert.deepStrictEqual(lirePosition(frame), { uid: 233526404, pos: 31 });
});

test('lirePosition rend null sur autre chose', { skip: SKIP_IVQ }, () => {
  assert.strictEqual(lirePosition({ type: 'ivj', payload: [] }), null);
});

// REMESURE LE 10/09: l'ordre d'equipement s'appelait `iuk`, c'est `isz`, et ses
// TROIS CHAMPS ONT PERMUTE. Les octets viennent de journal-invitation.log a
// 29818 ms, un desequipement fait a la main:
//
//   iuk { 1 = quantite, 2 = uid, 3 = position }   avant
//   isz { 1 = position, 2 = uid, 3 = quantite }   apres
//
// CE QUI IDENTIFIE LES CHAMPS, et il n'y a pas d'autre lecture: le 63 du champ 1
// est POSITION_INVENTAIRE, l'emplacement ou l'on range ce qu'on retire; l'uid du
// champ 2 est celui que le `irz` suivant declare disparu, a la milliseconde; et
// l'objet est un gid 9689, une Enorme pierre d'ame, nomme par le `irv` d'apres.
// La pile d'arrivee passe de 13 a 14 (`isf`), donc la quantite deplacee est 1 —
// c'est le champ 3.
//
// L'ENVELOPPE AUSSI ETAIT RESTEE EN CHAMP 2, et c'est le defaut le plus couteux
// des six: une requete batie sur l'ancien numero part dans la boite « event »
// au lieu de « request » — un seul octet de difference, 12 au lieu de 0a — et le
// serveur l'ignore sans rien dire. Le balayage du 08/09 avait corrige tous les
// autres modules; celui-ci lui avait echappe.
test('trameEquiper reproduit les octets mesures de isz', () => {
  const attendu = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'pda-archi-isz-desequiper.hex'), 'utf8',
  ).trim();
  const octets = trameEquiper({ uid: 52798638, qte: 1, position: POSITION_INVENTAIRE });
  assert.strictEqual(octets.toString('hex'), attendu);
});

// L'ENVELOPPE EST CELLE DES REQUETES, pas celle des events: champ 1. Le test
// ci-dessus le figerait deja, mais il le figerait EN SILENCE — un octet perdu
// dans quarante-sept. Celui-ci le nomme.
test('trameEquiper emet une requete, pas un evenement', () => {
  const octets = trameEquiper({ uid: 1, qte: 1, position: 31 });
  assert.strictEqual(decodeFrameRaw(octets).kind, 'request');
});

// kmu dit qu'un ACTEUR QUITTE LA CARTE, pas « un combat commence ». Chaque
// joueur qui s'en va en produit une: sur la seance du 03/09 au soir, des
// dizaines sont tombees avec des identifiants de personnages, et chacune
// faisait dire « groupe inconnu » a la chasse.
test('lireGroupeAttaque ignore un identifiant de joueur, positif', () => {
  const joueur = { type: 'kmu', payload: [{ no: 2, wire: WIRE.VARINT, value: 677158453542n }] };
  assert.strictEqual(lireGroupeAttaque(joueur), null);
});

test('lireGroupeAttaque retient un identifiant de groupe, negatif', () => {
  const groupe = { type: 'kmu', payload: [{ no: 2, wire: WIRE.VARINT, value: -20004n }] };
  assert.strictEqual(lireGroupeAttaque(groupe), -20004);
});

// itr: REDEMANDER L'INVENTAIRE, sans se deconnecter.
//
// Mesuree le 01/09 dans journal-hdv.log, trois fois, emise par le jeu lui-meme
// quand on ouvre un panneau de rangement. Le serveur repond par un `ivx` en
// 38 ms. Les octets sont figes ici: cette requete doit reproduire OCTET POUR
// OCTET celle du jeu, meme regle que toutes les autres de ce depot.
//
//   itr { 2 = <02 03>, 3 = 1 }
//
// Le champ 2 est la liste des rangements demandes. On ne l'interprete pas: on
// le recopie. Ce que la reponse contient a ete mesure separement, et un champ
// de chaque pile dit de quel rangement elle vient.
// REMESURE LE 10/09: `itr` est devenue `iup`, et la constante a change de
// champ — 3 avant, 1 apres. LA LISTE DES RANGEMENTS N'A PAS BOUGE: <02 03>,
// toujours au champ 2. Octets de journal-archi.log a 18846 ms.
//
// CE QUI CONFIRME L'APPARIEMENT est la reponse, pas la forme: le serveur rend
// un `isb` 42 ms apres le premier `iup`, et 70 ms apres le second. Le delai
// mesure au 01/09 pour `itr` etait de 38 ms. Aucun autre sortant de la seance
// n'est suivi d'un inventaire.
test('trameLireInventaire reproduit les octets mesures de iup', () => {
  const attendu = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'pda-archi-iup-inventaire.hex'), 'utf8',
  ).trim();
  assert.strictEqual(trameLireInventaire().toString('hex'), attendu);
});

// isa { 2: une pile } — LA PILE EST AU CHAMP 2, ET IL N Y A PAS DE CHAMP 3.
//
// C est le sixieme defaut du 10/09, et le plus discret des six:
// src/pda-archi/pda-archi.js cherchait la pile au champ 3, le numero d avant le
// patch 3.6.11.12, du temps ou le message s appelait `iua`. Le remappage du
// 08/09 avait corrige la FORME dans les tests sans corriger la LECTURE dans le
// module. `find` rendait undefined, `lirePile` n etait jamais appele, et la
// pose d une pierre n etait plus jamais confirmee — encore un silence.
//
// LA TRAME REELLE NE PORTE QUE LE CHAMP 2, ce qui ne laisse aucune place au
// doute: ce n est pas un champ 3 devenu facultatif, c est un champ 3 qui n a
// jamais existe sous ce nom. Octets de journal-combat.log.
//
// src/pda-archi/collection.js lisait DEJA le champ 2 de la meme trame. Les deux
// modules se contredisaient depuis deux jours sans que rien ne le signale.
test('une pile arrivee se lit au champ 2 de isa, et le champ 3 n existe pas', () => {
  const frame = fixture('pda-archi-isa-pile.hex');
  assert.strictEqual(frame.type, 'isa');
  assert.deepStrictEqual(frame.payload.map((f) => f.no), [2]);
  assert.deepStrictEqual(lirePile(frame.payload.find((f) => f.no === 2)), {
    uid: 25659450, gid: 13365, qte: 1, avecEffets: false, pos: POSITION_INVENTAIRE,
    rangement: null,
  });
});

// REMESURE LE 10/09: l entree en combat s appelait `kae`, c est `jym`, et
// L IDENTIFIANT DU COMBATTANT A CHANGE DE CHAMP — 3 avant, 5 apres. Le combat,
// lui, reste au champ 2.
//
//   kae { 1={2=1 3=-20001 4=1 5=<0o> 6=1} 2=194 }      avant, le 04/09
//   jym { 1={2=<0o> 3=1 5=-20000 7=1 8=1} 2=100 }      apres, le groupe
//   jym { 1={2={2={…}} 5=677012898086 8=1} 2=100 }     apres, un joueur
//
// DEUX JOURNAUX INDEPENDANTS DONNENT LA MEME FORME, et c est ce qui tranche:
// journal-combat.log porte trois `jym`, toutes en combat 100; journal-hdv.log
// en porte douze, toutes en combat 18. Dans chacun un seul combattant est
// NEGATIF — le groupe de monstres — et les autres sont des joueurs, grands et
// positifs. C est trait pour trait le motif que `kae` decrivait: une trame par
// combattant, un identifiant de combat commun, autre au combat suivant.
//
// LA FIXTURE DU JOUEUR NE PORTE NI PSEUDO NI GUILDE. La troisieme `jym` de la
// seance en portait — un nom de personnage et un nom de guilde en clair dans
// le sous-message du champ 2 — et c est celle-la, la plus complete, qui a ete
// ecartee. Meme precaution que sur pda-archi-jpo-groupes.hex.
test('lireEntreeCombat lit le combat et le groupe de monstres', () => {
  assert.deepStrictEqual(
    lireEntreeCombat(fixture('pda-archi-jym-groupe.hex')),
    { idCombat: 100, idActeur: -20000 },
  );
});

// UN JOUEUR PORTE UN IDENTIFIANT GRAND ET POSITIF, et il faut le rendre tel
// quel: c est lui qui dit « ce client est dans ce combat ».
test('lireEntreeCombat rend aussi un combattant joueur', () => {
  assert.deepStrictEqual(
    lireEntreeCombat(fixture('pda-archi-jym-joueur.hex')),
    { idCombat: 100, idActeur: 677012898086 },
  );
});

// LE COMBAT EST COMMUN AUX DEUX TRAMES, et c est toute la conception du module:
// une seule cle pour le groupe qui donne le niveau et pour le joueur qui doit
// equiper. Si les deux fixtures cessaient de s accorder, la chasse retomberait
// dans les fenetres de temps que le 04/09 a supprimees.
test('les deux combattants nomment le MEME combat', () => {
  const groupe = lireEntreeCombat(fixture('pda-archi-jym-groupe.hex'));
  const joueur = lireEntreeCombat(fixture('pda-archi-jym-joueur.hex'));
  assert.strictEqual(groupe.idCombat, joueur.idCombat);
});

test('lireEntreeCombat ignore une autre trame et un jym incomplet', () => {
  assert.strictEqual(lireEntreeCombat({ type: 'kkr', payload: [] }), null);
  assert.strictEqual(lireEntreeCombat({ type: 'jym', payload: [] }), null);
  // Le combat sans combattant, et le combattant sans combat.
  assert.strictEqual(lireEntreeCombat({ type: 'jym', payload: [
    { no: 2, wire: WIRE.VARINT, value: 194n },
  ] }), null);
  assert.strictEqual(lireEntreeCombat({ type: 'jym', payload: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 5, wire: WIRE.VARINT, value: 42n },
    ] },
  ] }), null);
});

// L ANCIEN NOM NE DOIT PLUS RIEN DECLENCHER. Sans cette garde un remappage a
// moitie fait se lirait comme un remappage entier: les deux noms marcheraient,
// et le jour ou `kae` designera autre chose, la chasse equiperait sur une trame
// qui ne parle pas de combat.
test('lireEntreeCombat ne repond plus au nom d avant le patch', () => {
  assert.strictEqual(lireEntreeCombat({ type: 'kae', payload: [
    { no: 1, wire: WIRE.LEN, kind: 'message', value: [
      { no: 5, wire: WIRE.VARINT, value: -20000n },
    ] },
    { no: 2, wire: WIRE.VARINT, value: 100n },
  ] }), null);
});
