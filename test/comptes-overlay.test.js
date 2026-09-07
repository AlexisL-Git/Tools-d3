'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { pourOverlay, etatTour } = require('../src/comptes/overlay');

// Une ligne de vue, reduite a ce que l'overlay regarde. Les defauts sont ceux
// d'un compte qui tourne et dont le trafic est prouve.
const L = (extra = {}) => ({
  id: 1, nickname: 'compte 1', personnage: 'Truc', classe: 'Sacrieur',
  pid: 4242, embleme: 'data:image/png;base64,xx', touche: 'F2',
  etat: 'intercepte', estMaitre: false, suivi: true, pilotable: true,
  eligibleMaitre: true, message: null, ...extra,
});

// --- qui apparait ----------------------------------------------------------

// La decision du 2026-08-29: l'overlay ne montre QUE les comptes en jeu. Un
// compte sans client n'a pas de fenetre vers laquelle basculer, son picto ne
// commanderait rien.
test('un compte hors ligne n apparaît pas', () => {
  const r = pourOverlay([L({ id: 1 }), L({ id: 2, pid: null, etat: 'hors-ligne' })]);
  assert.deepStrictEqual(r.map((p) => p.id), [1]);
});

test('un pid indéfini vaut un compte hors ligne', () => {
  assert.deepStrictEqual(pourOverlay([L({ pid: undefined })]), []);
});

test('sans aucun compte en jeu, la liste est vide', () => {
  assert.deepStrictEqual(pourOverlay([]), []);
});

// L'ordre vient de src/comptes/ordre.js, applique en amont par main.js.
// L'overlay ne rejoue pas ce calcul, il le respecte.
test('l ordre reçu est conservé', () => {
  const r = pourOverlay([L({ id: 3 }), L({ id: 1 }), L({ id: 2 })]);
  assert.deepStrictEqual(r.map((p) => p.id), [3, 1, 2]);
});

// --- la pastille d'etat ----------------------------------------------------

test('un client dont le trafic est prouvé porte la pastille « suit »', () => {
  assert.strictEqual(pourOverlay([L({ suivi: true })])[0].pastille, 'suit');
});

// Le faux positif du 22/08: attache reussie n'est pas trafic observe. La
// fenetre d'attente a sa propre pastille pour ne pas crier trop tot.
test('un client attaché sans trame encore porte « attente »', () => {
  const p = pourOverlay([L({ suivi: false, etat: 'en-attente' })])[0];
  assert.strictEqual(p.pastille, 'attente');
});

test('un client en erreur porte « souci »', () => {
  const p = pourOverlay([L({ suivi: false, etat: 'erreur', pilotable: false })])[0];
  assert.strictEqual(p.pastille, 'souci');
});

// Un client lance avant OMNI: sa session est hors du proxy, il ne suivra
// jamais. C'est exactement ce que l'overlay doit rendre visible sans ouvrir le
// panneau.
test('un client non intercepté porte « souci »', () => {
  const p = pourOverlay([L({ suivi: false, etat: 'non-intercepte' })])[0];
  assert.strictEqual(p.pastille, 'souci');
});

// L'erreur prime: une ligne qui se dirait suivie tout en etant en erreur ne
// doit pas afficher de cyan rassurant.
test('l erreur prime sur le suivi', () => {
  const p = pourOverlay([L({ suivi: true, etat: 'erreur' })])[0];
  assert.strictEqual(p.pastille, 'souci');
});

// Un client qui tourne sans compte connu de Zaap reste parfaitement pilotable.
test('un client inconnu de la liste mais dont le trafic passe porte « suit »', () => {
  const p = pourOverlay([L({ id: null, etat: 'inconnu', suivi: true })])[0];
  assert.strictEqual(p.pastille, 'suit');
});

// --- qui commande ----------------------------------------------------------

test('le maître est marqué comme tel, les autres non', () => {
  const r = pourOverlay([L({ id: 1, estMaitre: true }), L({ id: 2 })]);
  assert.strictEqual(r[0].commande, true);
  assert.strictEqual(r[1].commande, false);
});

// Le clic droit donne la commande. Il ne doit etre propose que sur un compte
// qui a le droit de la prendre: identifiant connu, pas d'erreur, trafic
// prouve. C'est vue.js qui tranche, l'overlay obeit.
test('le clic droit n est offert qu à un compte éligible', () => {
  const r = pourOverlay([L({ id: 1, eligibleMaitre: true }), L({ id: 2, eligibleMaitre: false })]);
  assert.strictEqual(r[0].peutCommander, true);
  assert.strictEqual(r[1].peutCommander, false);
});

// --- le clic gauche --------------------------------------------------------

// basculerVersCompte() prend un IDENTIFIANT DE COMPTE. Une ligne sans
// identifiant s'affiche quand meme — elle occupe une fenetre bien reelle —
// mais son picto ne peut pas porter l'ordre.
test('un client sans identifiant de compte s affiche sans être cliquable', () => {
  const p = pourOverlay([L({ id: null, nickname: 'client 4242' })])[0];
  assert.strictEqual(p.cliquable, false);
  assert.strictEqual(p.pid, 4242);
});

test('un compte identifié est cliquable', () => {
  assert.strictEqual(pourOverlay([L({ id: 7 })])[0].cliquable, true);
});

// --- ce qui est recopie tel quel -------------------------------------------

test('embleme, touche, classe et personnage sont repris tels quels', () => {
  const p = pourOverlay([L({ embleme: 'data:x', touche: 'F5', classe: 'Crâ', personnage: 'Bob' })])[0];
  assert.strictEqual(p.embleme, 'data:x');
  assert.strictEqual(p.touche, 'F5');
  assert.strictEqual(p.classe, 'Crâ');
  assert.strictEqual(p.personnage, 'Bob');
});

// Un embleme pas encore telecharge vaut null, et l'interface retombe sur
// l'abreviation de classe. Ce n'est pas une panne, l'overlay ne doit pas lever.
test('un emblème absent ne fait pas lever, l abréviation prend la place', () => {
  const p = pourOverlay([L({ embleme: null, classe: 'Eliotrope' })])[0];
  assert.strictEqual(p.embleme, null);
  assert.strictEqual(p.abrege, 'ELI');
});

test('sans classe connue, l abrégé retombe sur un tiret', () => {
  const p = pourOverlay([L({ embleme: null, classe: null })])[0];
  assert.strictEqual(p.abrege, '—');
});

// L'infobulle doit dire QUI on va viser, sans ouvrir le panneau. Le nom du
// personnage s'il est connu, le libelle du compte sinon.
test('le titre porte le personnage, ou le compte à défaut', () => {
  assert.strictEqual(pourOverlay([L({ personnage: 'Bob' })])[0].titre, 'Bob');
  assert.strictEqual(pourOverlay([L({ personnage: null, nickname: 'compte 9' })])[0].titre, 'compte 9');
});

// --- la liste rendue est autonome ------------------------------------------

// L'overlay traverse une frontiere IPC: ce qu'il rend doit etre serialisable
// et ne rien partager avec la vue du panneau, sinon une modification d'un cote
// se verrait de l'autre sans passer par un envoi d'etat.
test('les pictos ne partagent aucun objet avec les lignes reçues', () => {
  const lignes = [L()];
  const p = pourOverlay(lignes)[0];
  p.commande = true;
  assert.strictEqual(lignes[0].estMaitre, false);
});

// --- où on est, en ce moment -----------------------------------------------
//
// « Sur quelle fenetre on est » n'est PAS « qui commande ». Confondre les deux
// est exactement ce qui faisait partir les actions d'un alt chez toute
// l'equipe des qu'on cliquait sa fenetre. Ici on ne fait que le montrer, et le
// maitre garde son marquage a lui.

test('le client au premier plan est marqué « ici »', () => {
  const r = pourOverlay([L({ id: 1, pid: 4001 }), L({ id: 2, pid: 4002 })], 4002);
  assert.strictEqual(r[0].ici, false);
  assert.strictEqual(r[1].ici, true);
});

// Sans surveillance du premier plan, ou quand la fenetre active n'est aucun
// client Dofus (le panneau OMNI, un navigateur), personne n'est marque.
test('sans premier plan connu, aucun picto n est marqué', () => {
  const r = pourOverlay([L({ id: 1, pid: 4001 }), L({ id: 2, pid: 4002 })], null);
  assert.deepStrictEqual(r.map((p) => p.ici), [false, false]);
});

test('un premier plan qui ne correspond à aucun client ne marque personne', () => {
  const r = pourOverlay([L({ id: 1, pid: 4001 })], 9999);
  assert.strictEqual(r[0].ici, false);
});

test('l argument omis vaut aucun premier plan', () => {
  assert.strictEqual(pourOverlay([L()])[0].ici, false);
});

// Le maitre peut etre celui devant lequel on est, ou pas: les deux marquages
// sont independants et doivent pouvoir coexister sur le meme picto.
test('être au premier plan et commander sont deux marquages distincts', () => {
  const r = pourOverlay([L({ id: 1, pid: 4001, estMaitre: true }), L({ id: 2, pid: 4002 })], 4002);
  assert.strictEqual(r[0].commande, true);
  assert.strictEqual(r[0].ici, false);
  assert.strictEqual(r[1].commande, false);
  assert.strictEqual(r[1].ici, true);
});

test('le maître peut être aussi celui devant lequel on est', () => {
  const p = pourOverlay([L({ id: 1, pid: 4001, estMaitre: true })], 4001)[0];
  assert.strictEqual(p.commande, true);
  assert.strictEqual(p.ici, true);
});

// --- le passe-tour, meneur et mules separes --------------------------------
//
// Le bouton coupe en deux de la barre flottante. Deux etats d'ensemble, pas un:
// en combat les mules passent leur tour toutes seules pendant que le meneur
// joue a la main, et on doit pouvoir toucher l'un sans l'autre.

test('le meneur et les mules sont comptés séparément', () => {
  const r = etatTour([
    L({ id: 1, pid: 4001, estMaitre: true, passeTour: true }),
    L({ id: 2, pid: 4002, passeTour: false }),
    L({ id: 3, pid: 4003, passeTour: false }),
  ]);
  assert.deepStrictEqual(r, { meneur: 'actif', mules: 'aucun' });
});

test('le passe-tour du meneur ne compte pas dans celui des mules', () => {
  const r = etatTour([
    L({ id: 1, pid: 4001, estMaitre: true, passeTour: false }),
    L({ id: 2, pid: 4002, passeTour: true }),
    L({ id: 3, pid: 4003, passeTour: true }),
  ]);
  assert.deepStrictEqual(r, { meneur: 'eteint', mules: 'tous' });
});

test('une partie des mules seulement donne « partiel »', () => {
  const r = etatTour([
    L({ id: 1, pid: 4001, estMaitre: true, passeTour: true }),
    L({ id: 2, pid: 4002, passeTour: true }),
    L({ id: 3, pid: 4003, passeTour: false }),
  ]);
  assert.deepStrictEqual(r, { meneur: 'actif', mules: 'partiel' });
});

// LE TROISIEME CAS DU MENEUR, et c'est pour lui que la fonction existe plutot
// qu'un simple etatColonne(). Sans 'absent', la moitie gauche du bouton
// afficherait « le meneur ne passe pas son tour » alors qu'il n'y a AUCUN
// meneur en jeu: un losange creux qui ment, et un clic qui ne peut rien faire.
test('sans meneur en jeu, la moitié meneur est « absent » et non « éteint »', () => {
  const r = etatTour([L({ id: 2, pid: 4002, passeTour: true })]);
  assert.deepStrictEqual(r, { meneur: 'absent', mules: 'tous' });
});

test('sans aucun compte en jeu, le meneur est absent et les mules « aucun »', () => {
  assert.deepStrictEqual(etatTour([]), { meneur: 'absent', mules: 'aucun' });
});

test('un meneur seul en jeu laisse les mules à « aucun »', () => {
  const r = etatTour([L({ id: 1, pid: 4001, estMaitre: true, passeTour: true })]);
  assert.deepStrictEqual(r, { meneur: 'actif', mules: 'aucun' });
});

// MEME ENSEMBLE QUE LES PICTOS. Le losange decrit ce que la barre montre et ce
// que le clic touche — les deux tas de basculerTourGroupe sont eux aussi tires
// des comptes en jeu. Compter un compte hors ligne afficherait « partiel » sur
// une equipe entierement alignee, sans rien a cliquer pour la corriger.
test('un compte hors ligne ne compte dans aucun des deux tas', () => {
  const r = etatTour([
    L({ id: 1, pid: 4001, estMaitre: true, passeTour: true }),
    L({ id: 2, pid: 4002, passeTour: true }),
    L({ id: 3, pid: null, etat: 'hors-ligne', passeTour: false }),
  ]);
  assert.deepStrictEqual(r, { meneur: 'actif', mules: 'tous' });
});

// Un meneur epingle mais pas lance: superviseur.maitre est null, donc aucune
// ligne ne porte estMaitre. C'est le meme cas qu'« absent ».
test('un meneur hors ligne ne tient pas la moitié meneur', () => {
  const r = etatTour([
    L({ id: 1, pid: null, etat: 'hors-ligne', estMaitre: true, passeTour: true }),
    L({ id: 2, pid: 4002, passeTour: false }),
  ]);
  assert.deepStrictEqual(r, { meneur: 'absent', mules: 'aucun' });
});

// Meme garde que pertinentes() dans colonnes.js: sans identifiant de compte,
// rien ne peut etre enregistre dans le fichier de reglages.
test('un client sans identifiant de compte ne compte pas', () => {
  const r = etatTour([
    L({ id: null, pid: 4001, passeTour: false }),
    L({ id: 2, pid: 4002, passeTour: true }),
  ]);
  assert.deepStrictEqual(r, { meneur: 'absent', mules: 'tous' });
});

// La liste n'est pas modifiee: elle repart aussi vers pourOverlay().
test('les lignes reçues ne sont pas modifiées', () => {
  const lignes = [L({ id: 1, pid: 4001, estMaitre: true, passeTour: true })];
  const copie = JSON.parse(JSON.stringify(lignes));
  etatTour(lignes);
  assert.deepStrictEqual(lignes, copie);
});

test('une liste absente ne fait pas tomber le calcul', () => {
  assert.deepStrictEqual(etatTour(undefined), { meneur: 'absent', mules: 'aucun' });
  assert.deepStrictEqual(etatTour(null), { meneur: 'absent', mules: 'aucun' });
});
