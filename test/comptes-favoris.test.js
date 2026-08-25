'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Favoris } = require('../src/comptes/favoris');

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
  // dedie plus bas pour le contenu complet.
  assert.deepStrictEqual(Object.keys(contenu).sort(), ['actif', 'delai', 'echange', 'favoris', 'invitation', 'maitre', 'nav', 'noAnim', 'ordre', 'passeTour', 'touches']);
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
  assert.deepStrictEqual(Object.keys(contenu).sort(), ['actif', 'delai', 'echange', 'favoris', 'invitation', 'maitre', 'nav', 'noAnim', 'ordre', 'passeTour', 'touches']);
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

// Un raccourci par compte, plus les deux touches de navigation. Le fichier ne
// porte que des chaines courtes et des identifiants: rien de sensible.
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

// Les deux touches de navigation ont un defaut utilisable: Ctrl plus les
// fleches n'entre pas en conflit avec le jeu.
test('la navigation a des touches par défaut', (t) => {
  const f = new Favoris(fichierTemporaire(t)).charger();
  assert.deepStrictEqual(f.touchesNav(), {
    precedent: 'CommandOrControl+Left',
    suivant: 'CommandOrControl+Right',
  });
});

test('les touches de navigation se règlent et survivent', (t) => {
  const chemin = fichierTemporaire(t);
  new Favoris(chemin).charger().reglerToucheNav('suivant', 'F12');
  const nav = new Favoris(chemin).charger().touchesNav();
  assert.strictEqual(nav.suivant, 'F12');
  assert.strictEqual(nav.precedent, 'CommandOrControl+Left');
});

test('un nom de navigation inconnu est ignoré', (t) => {
  const f = new Favoris(fichierTemporaire(t)).charger();
  f.reglerToucheNav('milieu', 'F5');
  assert.strictEqual(f.touchesNav().milieu, undefined);
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
  assert.strictEqual(f.touchesNav().suivant, 'CommandOrControl+Right');
  assert.strictEqual(f.estFavori(3), true);
});
