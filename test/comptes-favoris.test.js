'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Favoris, MS_OUBLI } = require('../src/comptes/favoris');

function fichierTemporaire(t) {
  const p = path.join(os.tmpdir(), `favoris-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  t.after(() => { try { fs.unlinkSync(p); } catch (e) {} });
  return p;
}

test('sans fichier, aucun compte n est favori', (t) => {
  const f = new Favoris(fichierTemporaire(t));
  f.charger();
  assert.strictEqual(f.estFavori(10612457), false);
  assert.deepStrictEqual(f.tous(), []);
});

test('un favori marqué survit à un rechargement', (t) => {
  const p = fichierTemporaire(t);
  const a = new Favoris(p);
  a.charger();
  a.marquer(10612457, true);

  const b = new Favoris(p);
  b.charger();
  assert.strictEqual(b.estFavori(10612457), true);
  assert.deepStrictEqual(b.tous(), [10612457]);
});

test('démarquer retire le favori', (t) => {
  const p = fichierTemporaire(t);
  const f = new Favoris(p);
  f.charger();
  f.marquer(1, true);
  f.marquer(2, true);
  f.marquer(1, false);
  assert.deepStrictEqual(f.tous(), [2]);
});

// Le fichier ne doit contenir que des identifiants de compte: aucun login,
// aucun jeton, rien qui puisse fuiter s'il est partage.
test('le fichier enregistré ne contient que des identifiants', (t) => {
  const p = fichierTemporaire(t);
  const f = new Favoris(p);
  f.charger();
  f.marquer(10612457, true);
  const contenu = JSON.parse(fs.readFileSync(p, 'utf8'));
  // Depuis les extensions au passe-tour et a l'invitation, le fichier porte
  // aussi passeTour, invitation et delai (vides/nuls ici): voir le test
  // dedie plus bas pour le contenu complet. `overlay` s'y est ajoute le
  // 2026-08-29: une position d'ecran, un sens et un booleen, rien qui
  // designe une personne.
  assert.deepStrictEqual(Object.keys(contenu).sort(), ['actif', 'combats', 'delai', 'echange', 'favoris', 'invitation', 'maitre', 'noAnim', 'ordre', 'overlay', 'passeTour', 'touches']);
  assert.deepStrictEqual(contenu.favoris, [10612457]);
});

test('un fichier corrompu est ignoré sans exception', (t) => {
  const p = fichierTemporaire(t);
  fs.writeFileSync(p, 'pas du json');
  const f = new Favoris(p);
  f.charger();
  assert.deepStrictEqual(f.tous(), []);
});

// Les interrupteurs par compte suivent le sort des favoris: enregistres, et
// ne contenant QUE des identifiants numeriques et des booleens.
test('le passe-tour par compte est enregistre et relu', (t) => {
  const p = fichierTemporaire(t);
  const a = new Favoris(p);
  a.charger();
  a.marquerPasseTour(10612457, true);

  const b = new Favoris(p);
  b.charger();
  assert.strictEqual(b.passeTourActif(10612457), true);
  assert.strictEqual(b.passeTourActif(999), false);
});

test('le delai global est enregistre et relu', (t) => {
  const p = fichierTemporaire(t);
  const a = new Favoris(p);
  a.charger();
  a.reglerDelai(1.5);

  const b = new Favoris(p);
  b.charger();
  assert.strictEqual(b.delai(), 1.5);
});

test('le delai par defaut est 0', (t) => {
  const f = new Favoris(fichierTemporaire(t));
  f.charger();
  assert.strictEqual(f.delai(), 0);
});

test('le fichier ne contient que des identifiants, booleens et le delai', (t) => {
  const p = fichierTemporaire(t);
  const f = new Favoris(p);
  f.charger();
  f.marquer(10612457, true);
  f.marquerPasseTour(10612457, true);
  f.reglerDelai(0.5);
  const contenu = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.deepStrictEqual(Object.keys(contenu).sort(), ['actif', 'combats', 'delai', 'echange', 'favoris', 'invitation', 'maitre', 'noAnim', 'ordre', 'overlay', 'passeTour', 'touches']);
  assert.deepStrictEqual(contenu.favoris, [10612457]);
  assert.deepStrictEqual(contenu.passeTour, [10612457]);
  assert.deepStrictEqual(contenu.invitation, []);
  assert.deepStrictEqual(contenu.noAnim, []);
  assert.deepStrictEqual(contenu.echange, []);
  assert.strictEqual(contenu.delai, 0.5);
});

test('l invitation se marque, se lit et se relit du fichier', (t) => {
  const p = fichierTemporaire(t);
  const f = new Favoris(p).charger();
  assert.strictEqual(f.invitationActive(12), false);
  f.marquerInvitation(12, true);
  assert.strictEqual(f.invitationActive(12), true);
  assert.deepStrictEqual(new Favoris(p).charger().tousInvitation(), [12]);
});

test('l invitation se demarque', (t) => {
  const p = fichierTemporaire(t);
  const f = new Favoris(p).charger();
  f.marquerInvitation(12, true);
  f.marquerInvitation(12, false);
  assert.deepStrictEqual(new Favoris(p).charger().tousInvitation(), []);
});

// Les trois listes sont independantes: un compte peut accepter les invitations
// sans passer ses tours, et l'inverse.
test('invitation, passe-tour et favoris ne se melangent pas', (t) => {
  const p = fichierTemporaire(t);
  const f = new Favoris(p).charger();
  f.marquerInvitation(12, true);
  const relu = new Favoris(p).charger();
  assert.strictEqual(relu.passeTourActif(12), false);
  assert.strictEqual(relu.estFavori(12), false);
});

// Un fichier ecrit par une version anterieure n'a pas la cle: la lecture doit
// rendre une liste vide, pas faire echouer le demarrage.
test('un fichier sans cle invitation se lit sans erreur', (t) => {
  const p = fichierTemporaire(t);
  fs.writeFileSync(p, JSON.stringify({ delai: 0, favoris: [3], passeTour: [] }), 'utf8');
  const f = new Favoris(p).charger();
  assert.deepStrictEqual(f.tousInvitation(), []);
  assert.strictEqual(f.estFavori(3), true);
});

test('un échec d écriture ne fait pas planter l appelant', (t) => {
  // Le dossier parent visé est en fait un fichier: mkdirSync et
  // writeFileSync échouent tous les deux, de façon fiable sur toutes les
  // plateformes.
  const fauxDossier = path.join(os.tmpdir(), `favoris-parent-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(fauxDossier, 'je suis un fichier, pas un dossier');
  t.after(() => { try { fs.unlinkSync(fauxDossier); } catch (e) {} });

  const p = path.join(fauxDossier, 'favoris.json');
  const f = new Favoris(p);
  f.charger();
  assert.doesNotThrow(() => f.marquer(10612457, true));
  assert.strictEqual(f.estFavori(10612457), true);
  assert.deepStrictEqual(f.tous(), [10612457]);
});

test('le no-anim se marque, se lit et se relit du fichier', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  assert.strictEqual(f.noAnimActif(12), false);
  f.marquerNoAnim(12, true);
  assert.strictEqual(f.noAnimActif(12), true);
  assert.deepStrictEqual(new Favoris(chemin).charger().tousNoAnim(), [12]);
});

test('le no-anim se demarque', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  f.marquerNoAnim(12, true);
  f.marquerNoAnim(12, false);
  assert.deepStrictEqual(new Favoris(chemin).charger().tousNoAnim(), []);
});

// Les quatre listes sont independantes.
test('no-anim, invitation, passe-tour et favoris ne se melangent pas', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  f.marquerNoAnim(12, true);
  const relu = new Favoris(chemin).charger();
  assert.strictEqual(relu.passeTourActif(12), false);
  assert.strictEqual(relu.invitationActive(12), false);
  assert.strictEqual(relu.estFavori(12), false);
});

// Un fichier ecrit par une version anterieure n'a pas la cle: la lecture doit
// rendre une liste vide, pas faire echouer le demarrage.
test('un fichier sans cle noAnim se lit sans erreur', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ delai: 0, favoris: [3], passeTour: [], invitation: [] }), 'utf8');
  const f = new Favoris(chemin).charger();
  assert.deepStrictEqual(f.tousNoAnim(), []);
  assert.strictEqual(f.estFavori(3), true);
});

test('l echange se marque, se lit et survit au rechargement', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  assert.strictEqual(f.echangeActif(42), false);
  f.marquerEchange(42, true);
  assert.strictEqual(f.echangeActif(42), true);
  assert.deepStrictEqual(new Favoris(chemin).charger().tousEchange(), [42]);
});

test('l echange se retire', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  f.marquerEchange(42, true);
  f.marquerEchange(42, false);
  assert.deepStrictEqual(new Favoris(chemin).charger().tousEchange(), []);
});

// Un fichier ecrit par une version anterieure n'a pas la cle: la lecture doit
// rendre une liste vide, pas faire echouer le demarrage.
test('un fichier sans cle echange se lit sans erreur', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ delai: 0, favoris: [3], passeTour: [], invitation: [], noAnim: [] }), 'utf8');
  const f = new Favoris(chemin).charger();
  assert.deepStrictEqual(f.tousEchange(), []);
  assert.strictEqual(f.estFavori(3), true);
});

// Le maitre n'est pas une liste mais UN identifiant, ou aucun: un seul compte
// commande a la fois.
test('sans fichier, aucun maître n est épinglé', (t) => {
  const f = new Favoris(fichierTemporaire(t)).charger();
  assert.strictEqual(f.maitre(), null);
});

test('le maître épinglé survit au rechargement', (t) => {
  const chemin = fichierTemporaire(t);
  new Favoris(chemin).charger().reglerMaitre(10612458);
  assert.strictEqual(new Favoris(chemin).charger().maitre(), 10612458);
});

// Sans quoi revenir a « aucun maitre » serait impossible une fois un compte
// choisi: le geste doit etre reversible par le meme geste.
test('épingler null retire le maître', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  f.reglerMaitre(10612458);
  f.reglerMaitre(null);
  assert.strictEqual(new Favoris(chemin).charger().maitre(), null);
});

// Meme garde que les cinq listes: le fichier ne doit contenir que des
// identifiants numeriques.
test('un maître non entier est refusé', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  f.reglerMaitre('10612458');
  assert.strictEqual(f.maitre(), null);
});

// Un fichier ecrit par une version anterieure n'a pas la cle: la lecture doit
// rendre null, pas faire echouer le demarrage.
test('un fichier sans cle maitre se lit sans erreur', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ delai: 0, favoris: [3], passeTour: [], invitation: [], noAnim: [], echange: [] }), 'utf8');
  const f = new Favoris(chemin).charger();
  assert.strictEqual(f.maitre(), null);
  assert.strictEqual(f.estFavori(3), true);
});

// Ecrire le maitre ne doit pas emporter les cinq reglages voisins: _ecrire()
// reconstruit l'objet complet a chaque appel, et un oubli s'y voit mal.
test('épingler un maître préserve les autres réglages', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  f.marquer(3, true);
  f.marquerPasseTour(4, true);
  f.reglerDelai(1.5);
  f.reglerMaitre(5);

  const relu = new Favoris(chemin).charger();
  assert.strictEqual(relu.maitre(), 5);
  assert.deepStrictEqual(relu.tous(), [3]);
  assert.deepStrictEqual(relu.tousPasseTour(), [4]);
  assert.strictEqual(relu.delai(), 1.5);
});

// --- l interrupteur unique -------------------------------------------------

// Les cinq interrupteurs generaux ont disparu. Le modele avait deux niveaux
// (general ET par compte) sans que rien ne les relie a l ecran, et une case
// cochee sous un general eteint ne faisait rien sans que ca se voie.
//
// Desormais: les cases par compte sont la SEULE verite, le titre de colonne
// est une action groupee, et cet interrupteur-ci suspend tout sans rien
// effacer. Un seul etat general, donc, et il repart eteint.
test('sans fichier, OMNI est au repos', (t) => {
  assert.strictEqual(new Favoris(fichierTemporaire(t)).charger().actif(), false);
});

test('l interrupteur general survit au rechargement', (t) => {
  const chemin = fichierTemporaire(t);
  new Favoris(chemin).charger().reglerActif(true);
  assert.strictEqual(new Favoris(chemin).charger().actif(), true);
});

test('on peut le remettre au repos', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  f.reglerActif(true);
  f.reglerActif(false);
  assert.strictEqual(new Favoris(chemin).charger().actif(), false);
});

// Suspendre ne doit RIEN effacer: c est toute la difference avec decocher.
test('suspendre puis reprendre ne touche pas aux reglages par compte', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  f.marquerPasseTour(42, true);
  f.reglerActif(true);
  f.reglerActif(false);
  const relu = new Favoris(chemin).charger();
  assert.strictEqual(relu.passeTourActif(42), true);
  assert.strictEqual(relu.actif(), false);
});

test('une valeur non booleenne dans le fichier vaut au repos', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ actif: 'oui' }), 'utf8');
  assert.strictEqual(new Favoris(chemin).charger().actif(), false);
});

// --- touches et ordre de l equipe ------------------------------------------

// Un raccourci par compte. Le fichier ne porte que des chaines courtes et
// des identifiants: rien de sensible.
test('sans fichier, aucune touche n est assignée', (t) => {
  const f = new Favoris(fichierTemporaire(t)).charger();
  assert.deepStrictEqual(f.touches(), {});
  assert.strictEqual(f.toucheDe(42), null);
});

test('une touche assignée à un compte survit au rechargement', (t) => {
  const chemin = fichierTemporaire(t);
  new Favoris(chemin).charger().reglerTouche(42, 'F3');
  assert.strictEqual(new Favoris(chemin).charger().toucheDe(42), 'F3');
});

test('assigner null retire la touche', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  f.reglerTouche(42, 'F3');
  f.reglerTouche(42, null);
  assert.deepStrictEqual(new Favoris(chemin).charger().touches(), {});
});

// Une meme touche sur deux comptes rendrait le second inatteignable: la
// derniere assignation gagne, et la precedente est liberee.
test('assigner une touche déjà prise la retire de l autre compte', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  f.reglerTouche(1, 'F3');
  f.reglerTouche(2, 'F3');
  assert.strictEqual(f.toucheDe(1), null);
  assert.strictEqual(f.toucheDe(2), 'F3');
});

test('un identifiant non entier ou une touche non textuelle sont refusés', (t) => {
  const f = new Favoris(fichierTemporaire(t)).charger();
  f.reglerTouche('42', 'F3');
  f.reglerTouche(42, 12);
  assert.deepStrictEqual(f.touches(), {});
});

test('l ordre de l équipe se règle et survit', (t) => {
  const chemin = fichierTemporaire(t);
  new Favoris(chemin).charger().reglerOrdre([7, 3, 5]);
  assert.deepStrictEqual(new Favoris(chemin).charger().ordre(), [7, 3, 5]);
});

test('l ordre ne retient que des entiers, sans doublon', (t) => {
  const f = new Favoris(fichierTemporaire(t)).charger();
  f.reglerOrdre([3, '4', 3, null, 5]);
  assert.deepStrictEqual(f.ordre(), [3, 5]);
});

test('un fichier sans les nouvelles clés se lit sans erreur', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ delai: 0, favoris: [3] }), 'utf8');
  const f = new Favoris(chemin).charger();
  assert.deepStrictEqual(f.touches(), {});
  assert.deepStrictEqual(f.ordre(), []);
  assert.strictEqual(f.estFavori(3), true);
});

// Le fichier de chaque ami porte encore la cle `nav`, laissee par la version
// precedente: c'est exactement ce fichier que la prochaine version va lire.
// charger() doit l'ignorer sans lever et sans toucher aux autres reglages, et
// le premier enregistrement doit la faire disparaitre — _ecrire() reconstruit
// le fichier de zero avec les seules cles qu'elle connait.
test('un fichier avec l ancienne clé nav se lit sans erreur, et nav disparaît à l écriture', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({
    delai: 5, favoris: [3], maitre: 3, nav: { curseur: 3, sens: 1 },
  }), 'utf8');

  const f = new Favoris(chemin).charger();
  assert.strictEqual(f.delai(), 5);
  assert.deepStrictEqual(f.tous(), [3]);
  assert.strictEqual(f.maitre(), 3);

  f.reglerOrdre([3]);
  const relu = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  assert.strictEqual('nav' in relu, false);
  assert.strictEqual(relu.delai, 5);
  assert.deepStrictEqual(relu.favoris, [3]);
  assert.strictEqual(relu.maitre, 3);
});

// --- les actions connues pour lancer un combat -----------------------------

test('sans fichier, aucune action n est connue', (t) => {
  const f = new Favoris(fichierTemporaire(t)).charger();
  assert.deepStrictEqual(f.combats(), []);
});

test('une action apprise survit au rechargement', (t) => {
  const chemin = fichierTemporaire(t);
  new Favoris(chemin).charger().apprendreCombat('ioy:25088');
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), ['ioy:25088']);
});

test('la meme action deux fois ne compte qu une', (t) => {
  const f = new Favoris(fichierTemporaire(t)).charger();
  f.apprendreCombat('ioy:25088');
  f.apprendreCombat('ioy:25088');
  assert.deepStrictEqual(f.combats(), ['ioy:25088']);
});

test('une cle vide ou d un mauvais type est ignoree', (t) => {
  const f = new Favoris(fichierTemporaire(t)).charger();
  f.apprendreCombat('');
  f.apprendreCombat(null);
  f.apprendreCombat(42);
  assert.deepStrictEqual(f.combats(), []);
});

// LE SEUL RECOURS quand OMNI a retenu a tort: la liste est faite de numeros,
// personne ne peut deviner laquelle est fautive.
test('oublier vide la liste et l enregistre', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  f.apprendreCombat('ioy:25088');
  f.oublierCombats();
  assert.deepStrictEqual(f.combats(), []);
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), []);
});

test('une liste d un mauvais type dans le fichier est ignoree', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ combats: 'ioy:1', delai: 3 }), 'utf8');
  const f = new Favoris(chemin).charger();
  assert.deepStrictEqual(f.combats(), []);
  assert.strictEqual(f.delai(), 3);
});

// Ce test verifiait autrefois qu'un melange de chaines et de valeurs
// invalides ne gardait que les chaines. Depuis la migration, TOUTE entree de
// l'ancien format (une chaine) est jetee, valide ou non: voir la migration
// plus bas.
test('les entrees de l ancien format sont toutes ecartees, valides ou non', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ combats: ['ioy:1', 42, null, 'iwo:2'] }), 'utf8');
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), []);
});

// --- l'overlay -------------------------------------------------------------
//
// La petite fenetre flottante retient trois choses: si elle etait ouverte, son
// sens, et ou elle etait posee. Rien d'autre, et rien qui touche aux reglages
// PAR COMPTE: les amis qui passeront a cette version gardent leurs cases.

test('sans fichier, l overlay est fermé, horizontal, sans position', (t) => {
  const f = new Favoris(fichierTemporaire(t));
  f.charger();
  assert.deepStrictEqual(f.overlay(), { ouvert: false, sens: 'horizontal', x: null, y: null });
});

test('un réglage d overlay survit à un rechargement', (t) => {
  const p = fichierTemporaire(t);
  const a = new Favoris(p);
  a.charger();
  a.reglerOverlay({ ouvert: true, sens: 'vertical', x: 803, y: 458 });

  const b = new Favoris(p);
  b.charger();
  assert.deepStrictEqual(b.overlay(), { ouvert: true, sens: 'vertical', x: 803, y: 458 });
});

// Un reglage partiel ne doit pas effacer les autres: la position est ecrite a
// chaque lacher de souris, le sens seulement quand on bascule.
test('un réglage partiel garde ce qui n est pas mentionné', (t) => {
  const p = fichierTemporaire(t);
  const f = new Favoris(p);
  f.charger();
  f.reglerOverlay({ ouvert: true, sens: 'vertical', x: 10, y: 20 });
  f.reglerOverlay({ x: 300, y: 400 });
  assert.deepStrictEqual(f.overlay(), { ouvert: true, sens: 'vertical', x: 300, y: 400 });
});

// Meme discipline que le reste du fichier: on ne retient que ce dont on
// connait la forme, et une valeur douteuse retombe sur le defaut plutot que de
// faire echouer le chargement.
test('un sens inconnu retombe sur horizontal', (t) => {
  const p = fichierTemporaire(t);
  fs.writeFileSync(p, JSON.stringify({ overlay: { sens: 'diagonal', ouvert: true } }), 'utf8');
  const f = new Favoris(p);
  f.charger();
  assert.strictEqual(f.overlay().sens, 'horizontal');
  assert.strictEqual(f.overlay().ouvert, true);
});

test('une position qui n est pas entière est ignorée', (t) => {
  const p = fichierTemporaire(t);
  fs.writeFileSync(p, JSON.stringify({ overlay: { x: 'gauche', y: 12.5 } }), 'utf8');
  const f = new Favoris(p);
  f.charger();
  assert.strictEqual(f.overlay().x, null);
  assert.strictEqual(f.overlay().y, null);
});

test('une clé overlay d un mauvais type est ignorée', (t) => {
  const p = fichierTemporaire(t);
  fs.writeFileSync(p, JSON.stringify({ overlay: 'oui' }), 'utf8');
  const f = new Favoris(p);
  f.charger();
  assert.deepStrictEqual(f.overlay(), { ouvert: false, sens: 'horizontal', x: null, y: null });
});

// Le fichier d'un ami en 0.2.6 n'a pas cette cle. Il ne doit rien perdre.
test('un fichier sans clé overlay garde ses réglages par compte', (t) => {
  const p = fichierTemporaire(t);
  fs.writeFileSync(p, JSON.stringify({
    invitation: [167399627, 165868513], maitre: 167399627, actif: true,
    touches: { 167399627: 'F2' },
  }), 'utf8');
  const f = new Favoris(p);
  f.charger();
  assert.strictEqual(f.invitationActive(167399627), true);
  assert.strictEqual(f.maitre(), 167399627);
  assert.deepStrictEqual(f.overlay(), { ouvert: false, sens: 'horizontal', x: null, y: null });
});

// Ce que rend overlay() ne doit pas etre l'objet interne: le modifier de
// l'exterieur changerait le reglage sans passer par l'ecriture du fichier.
test('overlay() rend une copie', (t) => {
  const f = new Favoris(fichierTemporaire(t));
  f.charger();
  f.overlay().sens = 'vertical';
  assert.strictEqual(f.overlay().sens, 'horizontal');
});

// --- expiration des actions retenues, et migration de l ancienne liste -----

// LA MIGRATION EST LE REMEDE. Les entrees d'avant le 2026-09-01 sont des
// chaines, apprises par une regle qu'on sait fausse: les convertir
// reviendrait a conserver les blocages qu'on veut supprimer.
test('une ancienne liste de chaines est jetee au chargement', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ combats: ['ioy:25088', 'iov:1:2'] }), 'utf8');
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), []);
});

test('une entree jetee est effacee du fichier, pas seulement de la memoire', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ combats: ['ioy:25088'] }), 'utf8');
  new Favoris(chemin).charger();
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(chemin, 'utf8')).combats, []);
});

test('une entree datee de moins de 30 jours est conservee', (t) => {
  const chemin = fichierTemporaire(t);
  const le = Date.now() - (MS_OUBLI - 60000);
  fs.writeFileSync(chemin, JSON.stringify({ combats: [{ cle: 'ioy:25088', le }] }), 'utf8');
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), ['ioy:25088']);
});

test('une entree datee de plus de 30 jours est ecartee', (t) => {
  const chemin = fichierTemporaire(t);
  const le = Date.now() - (MS_OUBLI + 60000);
  fs.writeFileSync(chemin, JSON.stringify({ combats: [{ cle: 'ioy:25088', le }] }), 'utf8');
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), []);
});

test('une entree sans date ou mal formee est ecartee', (t) => {
  const chemin = fichierTemporaire(t);
  fs.writeFileSync(chemin, JSON.stringify({ combats: [
    { cle: 'ioy:1' }, { le: Date.now() }, { cle: '', le: Date.now() },
    { cle: 'ioy:2', le: 'hier' }, null, 42,
  ] }), 'utf8');
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), []);
});

test('une entree apprise survit a un rechargement et reste datee', (t) => {
  const chemin = fichierTemporaire(t);
  new Favoris(chemin).charger().apprendreCombat('ioy:25088');
  const ecrit = JSON.parse(fs.readFileSync(chemin, 'utf8')).combats;
  assert.strictEqual(ecrit.length, 1);
  assert.strictEqual(ecrit[0].cle, 'ioy:25088');
  assert.ok(Number.isFinite(ecrit[0].le), 'l entree porte une date');
  assert.deepStrictEqual(new Favoris(chemin).charger().combats(), ['ioy:25088']);
});

test('apprendre deux fois la meme cle ne fait qu une entree', (t) => {
  const chemin = fichierTemporaire(t);
  const f = new Favoris(chemin).charger();
  f.apprendreCombat('ioy:25088');
  f.apprendreCombat('ioy:25088');
  assert.deepStrictEqual(f.combats(), ['ioy:25088']);
});
