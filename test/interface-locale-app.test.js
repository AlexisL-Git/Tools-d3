'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerFauxApp } = require('../outils/faux-app');
const { fabriquerEtat } = require('../outils/faux-etat');

// Chaque canal expose par preload.js doit exister ici sous le MEME nom. Le
// piege est ecrit en tete de desktop/preload.js: un canal manquant ne casse
// rien au chargement, il se voit comme un bouton qui « ne fait rien ». Ce test
// lit le vrai preload.js pour que la liste ne puisse pas deriver.
const fs = require('node:fs');
const path = require('node:path');

test('le shim expose tous les canaux de preload.js', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'preload.js'), 'utf8');
  const bloc = source.slice(source.indexOf('exposeInMainWorld'));
  const canaux = [...bloc.matchAll(/^\s{2}([a-zA-Z]\w*):/gm)].map((m) => m[1]);
  assert.ok(canaux.length > 20, `liste de canaux suspecte : ${canaux.length}`);
  const app = creerFauxApp(fabriquerEtat());
  for (const nom of canaux) {
    assert.strictEqual(typeof app[nom], 'function', `canal absent du shim : ${nom}`);
  }
});

test('surEtat recoit l etat initial tout de suite', () => {
  const app = creerFauxApp(fabriquerEtat());
  let recu = null;
  app.surEtat((e) => { recu = e; });
  assert.ok(recu !== null, 'aucun etat emis');
  assert.strictEqual(recu.version, 'dev');
});

// C'est CE test qui dit que le banc est interactif: cocher laisse coche.
test('basculerPasseTourCompte coche la case et reemet l etat', () => {
  const app = creerFauxApp(fabriquerEtat());
  const recus = [];
  app.surEtat((e) => recus.push(e));
  app.basculerPasseTourCompte(1, true);
  const ligne = recus[recus.length - 1].lignes.find((l) => l.id === 1);
  assert.strictEqual(ligne.passeTour, true);
  assert.strictEqual(recus.length, 2, 'l etat doit etre reemis apres l ordre');
});

test('les quatre autres cases par compte se basculent aussi', () => {
  const app = creerFauxApp(fabriquerEtat());
  app.surEtat(() => {});
  app.basculerInvitationCompte(3, true);
  app.basculerNoAnimCompte(3, true);
  app.basculerEchangeCompte(3, true);
  // exclureCompte est l'inversee de « suit le meneur »: exclu vaut true.
  app.exclureCompte(3, true);
  const l = app.__etat().lignes.find((x) => x.id === 3);
  assert.deepStrictEqual(
    { invitation: l.invitation, noAnim: l.noAnim, echange: l.echange, exclu: l.exclu },
    { invitation: true, noAnim: true, echange: true, exclu: true },
  );
});

test('definirMaitre deplace le maitre sur une seule ligne', () => {
  const app = creerFauxApp(fabriquerEtat());
  app.surEtat(() => {});
  app.definirMaitre(2);
  const lignes = app.__etat().lignes;
  const maitres = lignes.filter((l) => l.estMaitre);
  assert.strictEqual(maitres.length, 1);
  assert.strictEqual(maitres[0].id, 2);
  assert.strictEqual(app.__etat().sansMaitre, false);
});

// Le losange du titre de colonne lit les cinq cases: si l'action groupee ne
// touchait qu'une partie des lignes, il resterait « partiel » pour toujours.
//
// Les CINQ VRAIS NOMS sont ceux que desktop/index.html:2196 envoie via
// b.dataset.colonne ('repl' | 'tour' | 'groupe' | 'anim' | 'echange'), jamais
// le nom du champ de ligne -- c'est exactement la confusion qui rendait
// quatre des cinq titres inertes et 'repl' inversee.
test('basculerColonne bascule les cinq vraies colonnes, aller-retour compris', () => {
  const COLS = [
    { nom: 'repl', champ: 'exclu', inverse: true },
    { nom: 'tour', champ: 'passeTour', inverse: false },
    { nom: 'groupe', champ: 'invitation', inverse: false },
    { nom: 'anim', champ: 'noAnim', inverse: false },
    { nom: 'echange', champ: 'echange', inverse: false },
  ];
  for (const { nom, champ, inverse } of COLS) {
    const app = creerFauxApp(fabriquerEtat());
    app.surEtat(() => {});
    const ids = app.__etat().lignes.filter((l) => l.id !== null).map((l) => l.id);
    const affiche = (l) => (inverse ? !l[champ] : Boolean(l[champ]));

    app.basculerColonne(nom, ids);
    for (const l of app.__etat().lignes) {
      if (l.id === null) continue;
      assert.strictEqual(affiche(l), true, `colonne ${nom}, ligne ${l.id} pas cochee`);
    }
    // Cas 'repl' explicite: cocher la colonne (= « suit le meneur ») doit
    // ecrire exclu = false, pas un champ parasite nomme 'repl'.
    if (inverse) {
      for (const l of app.__etat().lignes) {
        if (l.id !== null) assert.strictEqual(l.exclu, false, `repl coche: exclu doit etre false`);
      }
    }

    // L'aller-retour: tout-coche puis re-bascule doit rendre tout-decoche.
    app.basculerColonne(nom, ids);
    for (const l of app.__etat().lignes) {
      if (l.id === null) continue;
      assert.strictEqual(affiche(l), false, `colonne ${nom}, ligne ${l.id} pas decochee apres re-bascule`);
    }
  }
});

// desktop/main.js:1999 fait `if (!parNom.has(nom)) return;`: le shim doit
// suivre la meme regle plutot que d'ecrire un champ au nom de la colonne.
test('basculerColonne sur un nom inconnu ne modifie rien et le journalise', () => {
  const dits = [];
  const app = creerFauxApp(fabriquerEtat(), { journal: (m) => dits.push(m) });
  app.surEtat(() => {});
  const avant = JSON.stringify(app.__etat().lignes);
  app.basculerColonne('nimportequoi', [1, 2, 3]);
  assert.strictEqual(JSON.stringify(app.__etat().lignes), avant, 'un nom inconnu ne doit rien ecrire');
  assert.strictEqual(dits.length, 1);
  assert.ok(dits[0].includes('nimportequoi'));
});

test('reglerDelai et reglerTouche ecrivent dans l etat', () => {
  const app = creerFauxApp(fabriquerEtat());
  app.surEtat(() => {});
  app.reglerDelai(3);
  app.reglerTouche(2, 'F7');
  assert.strictEqual(app.__etat().delai, 3);
  assert.strictEqual(app.__etat().lignes.find((l) => l.id === 2).touche, 'F7');
});

// Partiels par construction: le panneau envoie le champ qui vient de bouger,
// pas les cinq. Un champ absent doit garder sa valeur.
test('reglerHdvRythme et reglerHdvGarde sont partiels', () => {
  const app = creerFauxApp(fabriquerEtat());
  app.surEtat(() => {});
  const avant = app.__etat().hdvRythme.pause;
  app.reglerHdvRythme({ lot: 1.6 });
  app.reglerHdvGarde({ facteur: 3 });
  assert.strictEqual(app.__etat().hdvRythme.lot, 1.6);
  assert.strictEqual(app.__etat().hdvRythme.pause, avant, 'un champ absent doit rester');
  assert.strictEqual(app.__etat().hdvGarde.facteur, 3);
});

test('basculerOverlay bascule overlayOuvert', () => {
  const app = creerFauxApp(fabriquerEtat());
  app.surEtat(() => {});
  app.basculerOverlay();
  assert.strictEqual(app.__etat().overlayOuvert, true);
  app.basculerOverlay();
  assert.strictEqual(app.__etat().overlayOuvert, false);
});

test('fermerUnClient retire la ligne du client, fermerTousLesClients les retire toutes', () => {
  const app = creerFauxApp(fabriquerEtat());
  app.surEtat(() => {});
  app.fermerUnClient(3);
  assert.strictEqual(app.__etat().lignes.find((l) => l.id === 3).pid, null);
  app.fermerTousLesClients();
  assert.ok(app.__etat().lignes.every((l) => l.pid === null), 'un client survit');
});

test('les lectures passent par fetch', async () => {
  const appels = [];
  const faux = async (url) => {
    appels.push(url);
    return { ok: true, json: async () => ({ titre: 'Archimonstres', lignes: [] }) };
  };
  const app = creerFauxApp(fabriquerEtat(), { fetch: faux });
  const table = await app.tableauArchi('archi');
  assert.strictEqual(table.titre, 'Archimonstres');
  assert.ok(appels[0].includes('/faux/tableau-archi'), `url inattendue : ${appels[0]}`);
  await app.devlog();
  assert.ok(appels[1].includes('/faux/devlog'), `url inattendue : ${appels[1]}`);
});

test('etatMajGit rend un depot a jour sans reseau', async () => {
  const app = creerFauxApp(fabriquerEtat());
  const r = await app.etatMajGit();
  assert.strictEqual(r.etat, 'a-jour');
});

// Le filet contre le piege de preload.js, vu de l'autre cote: un canal ajoute
// a la page mais pas au shim doit se dire, pas se taire.
test('un canal inconnu est journalise, pas silencieux', () => {
  const dits = [];
  const app = creerFauxApp(fabriquerEtat(), { journal: (m) => dits.push(m) });
  app.__inconnu('canalQuiNExistePas', [1, 2]);
  assert.strictEqual(dits.length, 1);
  assert.ok(dits[0].includes('canalQuiNExistePas'));
});

// basculerVersCompte part a CHAQUE clic sur le nom d'une ligne -- le geste le
// plus frequent du panneau. Le journaliser comme « canal inconnu » remplirait
// la console en usage normal et detruirait la valeur du garde-fou. Ces deux
// canaux sont CONNUS, juste sans effet sur le banc: ils doivent utiliser un
// message different de celui de __inconnu.
test('basculerVersCompte et boutonSouris ne se journalisent pas comme canal inconnu', () => {
  const dits = [];
  const app = creerFauxApp(fabriquerEtat(), { journal: (m) => dits.push(m) });
  app.basculerVersCompte(1);
  app.boutonSouris('gauche');
  assert.strictEqual(dits.length, 2);
  for (const m of dits) {
    assert.ok(!m.includes('canal inconnu'), `message ambigu avec canal inconnu : ${m}`);
    assert.ok(m.includes('sans effet sur le banc'), `message inattendu : ${m}`);
  }
});
