'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// LES CLASSES DU PANNEAU DES PEPITES NE DOIVENT ENTRER EN COLLISION AVEC
// AUCUNE AUTRE. Ce test est le frere de pda-archi-panneau.test.js, et il
// existe pour la meme raison: le 2026-09-04, une classe nommee `case` a
// heriter d'un `display: grid` pose ailleurs, et les coches d'un archimonstre
// se sont empilees verticalement. Le balisage etait juste, le code aussi, et
// rien dans le projet ne pouvait le dire -- ni les tests, ni le navigateur.
//
// Assertion sur le SOURCE: le chemin concerne demanderait un vrai navigateur.

const html = fs.readFileSync(
  path.join(__dirname, '..', 'desktop', 'index.html'), 'utf8',
);

const bloc = html.match(/const PEP = \{([\s\S]*?)\};/);
const classes = bloc === null
  ? []
  : [...bloc[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('le panneau declare ses classes en un seul endroit', () => {
  assert.notStrictEqual(bloc, null, 'la table PEP est introuvable dans index.html');
  assert.ok(classes.length >= 5, `seulement ${classes.length} classes trouvees`);
});

// LE PREFIXE EST LA GARDE.
test('toutes les classes du panneau sont prefixees pep-', () => {
  assert.deepStrictEqual(classes.filter((c) => !c.startsWith('pep-')), []);
});

// Un prefixe ne sert a rien si le reste de la feuille de style s'en sert
// aussi: la seconde moitie de la garde.
test('aucune regle hors du panneau ne definit une classe pep-', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const regles = [...style.matchAll(/\.(pep-[a-z0-9-]+)/g)].map((m) => m[1]);
  const inconnues = regles.filter(
    (c) => !classes.includes(c)
      && !['pep-corps', 'pep-pied', 'pep-cherche', 'pep-table'].includes(c),
  );
  assert.deepStrictEqual(inconnues, []);
});

// LE PANNEAU N'EMPRUNTE PAS LES CLASSES DE L'AUTRE. Elles appartiennent au
// tableau des archimonstres, dont le test interdit qu'une regle etrangere en
// definisse -- et une reprise silencieuse ferait dependre notre mise en page
// de la sienne.
test('le panneau des pepites n emprunte aucune classe arc-', () => {
  // Repere par id, pas par classe: le conteneur porte class="vue-archi",
  // partagee avec #vueEcartes et #vueRythme -- ce n'est pas une classe du
  // panneau archimonstres a eviter, c'est le conteneur commun des panneaux
  // qui vivent dans la fenetre. Voir le commentaire CSS de .pep-corps.
  const debut = html.indexOf('id="vuePepites"');
  assert.notStrictEqual(debut, -1, 'le panneau des pepites est introuvable');
  const fin = html.indexOf('</div>', html.indexOf('id="pepPied"'));
  const markup = html.slice(debut, fin);
  assert.deepStrictEqual([...markup.matchAll(/class="(arc-[a-z0-9- ]+)"/g)].map((m) => m[1]), []);
});

// Les identifiants que le script va chercher par getElementById. Une faute de
// frappe ici rend un panneau muet, et c'est exactement le genre de panne que
// rien ne signale.
test('les identifiants attendus par le script existent dans le balisage', () => {
  for (const id of ['vuePepites', 'pepCorps', 'pepPied', 'pepChercheTexte', 'pepFermer']) {
    assert.ok(html.includes(`id="${id}"`), `id="${id}" manque`);
  }
});

// LE PANNEAU S'OUVRE VRAIMENT, et ce bloc est le seul qui execute son code.
//
// Le frere de ce fichier (test/pda-archi-panneau.test.js) porte la lecon en
// toutes lettres: « UN CLIC QUI NE FAIT RIEN EST LE PIRE DES ECHECS DE CE
// PROJET, et celui-ci s'est produit deux fois sur ce seul panneau. » Avant ce
// bloc, aucun test n'executait ouvrirPepites(), dessinerPepites(),
// parPepite() ou kamas() -- seule la recette sur le banc les avait vus une
// fois, et aucune regression future ne les aurait vus a nouveau.
//
// Le DOM de facade ne simule que ce que ce chemin touche, meme regle que le
// panneau voisin: il n'a pas vocation a grandir.
const vm = require('node:vm');

function noeud() {
  return {
    textContent: '', innerHTML: '', hidden: true, disabled: false, title: '', value: '',
    dataset: {}, style: {}, children: [], ecouteurs: [],
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener(t, f) { if (t === 'click') this.ecouteurs.push(f); },
    setAttribute() {},
    append(...k) { this.children.push(...k); },
    appendChild(k) { this.children.push(k); },
    querySelectorAll: () => [], querySelector: () => null,
    clic() { return Promise.all(this.ecouteurs.map((f) => f({ stopPropagation() {} }))); },
  };
}

// Un classement plausible, avec un peu de chaque: une ligne montee, une
// stable et suspecte, une sortie. Ni chercher() ni classer() ne sont
// executes ici -- c'est deja fait par test/pepites-classement.test.js --
// cette table simule juste ce que desktop/main.js rendrait.
const CLASSEMENT_FACTICE = {
  lignes: [
    {
      gid: 312, nom: 'Fer', taux: 0.003, prixMoyen: 15, coutParPepite: 5000,
      suspect: false, etat: 'montee', deltaRang: 1, deltaCout: -200,
    },
    {
      gid: 303, nom: 'Bois de Frêne', taux: 0.003, prixMoyen: 5, coutParPepite: 1666.67,
      suspect: true, etat: 'stable', deltaRang: 0, deltaCout: 0,
    },
  ],
  sorties: [
    {
      gid: 384, nom: 'Laine de Bouftou', taux: 0.0075, prixMoyen: 25000, coutParPepite: 3333333,
      suspect: false, etat: 'sortie', deltaRang: null, deltaCout: null,
    },
  ],
  quand: 1000000, prixQuand: 900000, perso: 'Kroufi', jeu: '3.6.11.15', raison: null,
};

// Ouvre le panneau dans un contexte vm frais, et rend les noeuds pour qu'on
// puisse regarder ce qui s'y est ecrit. `recherche` peut etre un tableau (la
// meme reponse a chaque appel) ou une fonction `(texte) => resultat`, pour
// simuler des reponses differentes selon la frappe -- necessaire au test de
// course plus bas.
async function ouvrirLePanneau({
  echoue = false, classement = CLASSEMENT_FACTICE, recherche = [],
} = {}) {
  const appels = { table: 0, recherche: 0, args: [] };
  const parId = new Map();
  const document = {
    getElementById: (id) => {
      if (!parId.has(id)) parId.set(id, noeud());
      return parId.get(id);
    },
    createElement: () => noeud(),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
    body: noeud(),
  };
  const contexte = {
    document,
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    window: {
      addEventListener() {},
      app: {
        surEtat() {},
        surPdaArchiAlerte() {},
        surAmbiance() {},
        // Stubs neutres: le script en depend au chargement (archi partage le
        // meme <script> que les pepites), mais aucun test ici ne les exerce.
        tableauArchi: async () => ({ titre: '', lignes: [] }),
        archiRelire: async () => ({ ok: true, demandes: 0, total: 0 }),
        tableauPepites: async () => {
          appels.table += 1;
          if (echoue) throw new Error('le service a refusé');
          return classement;
        },
        chercherPepite: async (texte) => {
          appels.recherche += 1;
          appels.args.push(texte);
          return typeof recherche === 'function' ? recherche(texte) : recherche;
        },
      },
    },
  };
  contexte.window.document = document;
  vm.createContext(contexte);
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  vm.runInContext(
    `${script}\n;globalThis.__ouvrirPepites = ouvrirPepites;`
    + `globalThis.__kamas = kamas; globalThis.__parPepite = parPepite;`,
    contexte,
  );
  await contexte.__ouvrirPepites();
  // `contexte`, PAS globalThis: vm.createContext(contexte) fait de cet objet
  // le global DU SANDBOX. `globalThis.__parPepite = ...` execute a
  // l'interieur du script ecrit donc sur `contexte`, jamais sur le
  // globalThis reel de ce process -- une confusion facile a faire, et qui
  // rendrait ces deux fonctions silencieusement introuvables au test.
  return { parId, appels, ouvrir: contexte.__ouvrirPepites, contexte };
}

test('un clic sur le bouton ouvre le panneau et dessine le classement', async () => {
  const { parId } = await ouvrirLePanneau();
  assert.strictEqual(parId.get('vuePepites').hidden, false);
  const corps = parId.get('pepCorps').innerHTML;
  assert.ok(corps.includes('Fer'), 'le classement doit nommer les objets');
  assert.ok(corps.includes('Bois de Frêne'));
  const pied = parId.get('pepPied').textContent;
  assert.match(pied, /Kroufi/);
  assert.match(pied, /3\.6\.11\.15/);
  assert.match(pied, /1 objet\(s\) sorti\(s\)/, 'le pied doit compter les sorties');
});

// UN CLIC QUI NE FAIT RIEN EST LE PIRE DES ECHECS DE CE PROJET. Meme filet
// que ouvrirArchi, verifie ici pour la premiere fois par execution.
test('une ouverture qui echoue s ouvre quand meme et le dit', async () => {
  const { parId } = await ouvrirLePanneau({ echoue: true });
  assert.strictEqual(parId.get('vuePepites').hidden, false);
  assert.match(parId.get('pepCorps').innerHTML, /n’a pas pu être construit/);
  assert.match(parId.get('pepCorps').innerHTML, /le service a refusé/);
});

// Ronde de correction, constat M7: la recherche ne doit pas survivre a une
// fermeture-reouverture, sous peine de montrer un champ rempli au-dessus
// d'un classement qui, lui, ne tient plus compte de ce texte.
test('rouvrir le panneau vide le champ de recherche', async () => {
  const { parId, ouvrir } = await ouvrirLePanneau();
  const champ = parId.get('pepChercheTexte');
  champ.value = 'frene';
  await ouvrir();
  assert.strictEqual(champ.value, '');
});

// Ronde de correction, constat M8: un echec d'ouverture encode sa raison
// dans pepTable.raison (voir ouvrirPepites() dans desktop/index.html); tant
// que la recherche est sous deux caracteres, dessinerPepites() doit
// continuer a montrer CETTE raison plutot que de la remplacer par un
// panneau blanc.
test('une recherche effacee apres un echec redessine l erreur, pas un panneau blanc', async () => {
  const { parId } = await ouvrirLePanneau({ echoue: true });
  const champ = parId.get('pepChercheTexte');
  champ.value = 'a';
  await champ.oninput();
  assert.match(parId.get('pepCorps').innerHTML, /n’a pas pu être construit/,
    'sous deux caracteres, le message d erreur doit rester visible');
});

// ECHAP VIDE AVANT DE FERMER, meme verrou que
// test/pda-archi-panneau.test.js ("ECHAP VIDE AVANT DE FERMER") sur le
// panneau jumeau.
test('echap vide la recherche et ne ferme pas le panneau', async () => {
  const { parId } = await ouvrirLePanneau({ recherche: [] });
  const champ = parId.get('pepChercheTexte');
  champ.value = 'frene';
  await champ.oninput();
  const garde = champ.onkeydown({ key: 'Escape', stopPropagation() {} });
  await garde;
  assert.strictEqual(champ.value, '');
  assert.strictEqual(parId.get('vuePepites').hidden, false, 'le panneau reste ouvert');
  const corps = parId.get('pepCorps').innerHTML;
  assert.ok(corps.includes('Fer'), 'le classement complet doit revenir');
});

// LA COURSE DE LA RECHERCHE. clearTimeout() annule le MINUTEUR, pas une
// promesse deja en vol: une reponse a une frappe plus ancienne peut revenir
// APRES celle d'une frappe plus recente. Simule ici en retardant la reponse
// de la premiere recherche jusqu'apres celle de la seconde.
test('une reponse perimee n ecrase pas un resultat plus recent', async () => {
  let resterminer;
  const recherche = (texte) => {
    if (texte === 'an') {
      return new Promise((resolve) => { resterminer = resolve; });
    }
    return [{
      gid: 2, nom: 'Frais', taux: 1, prixMoyen: 2, coutParPepite: 2, suspect: false,
    }];
  };
  const { parId } = await ouvrirLePanneau({ recherche });
  const champ = parId.get('pepChercheTexte');

  champ.value = 'an';
  const p1 = champ.oninput();
  // Laisse le temps au debat de 150 ms de sonner et d'entrer dans
  // chercherPepite('an'), qui reste EN VOL tant que resterminer n'est pas
  // appele -- exactement l'etat "reponse pas encore arrivee" du scenario reel.
  await new Promise((r) => { setTimeout(r, 220); });

  champ.value = 'anc';
  const p2 = champ.oninput();
  await p2;
  assert.ok(parId.get('pepCorps').innerHTML.includes('Frais'), 'la recherche fraiche doit s afficher');

  // LA REPONSE PERIMEE ARRIVE MAINTENANT, APRES LA FRAICHE.
  resterminer([{
    gid: 1, nom: 'Périmé', taux: 1, prixMoyen: 1, coutParPepite: 1, suspect: false,
  }]);
  await p1;

  const corps = parId.get('pepCorps').innerHTML;
  assert.ok(corps.includes('Frais'), 'la reponse fraiche doit rester affichee');
  assert.ok(!corps.includes('Périmé'), 'la reponse perimee ne doit pas ecraser la fraiche');
});

// parPepite() ET kamas() SUR LEURS CAS LIMITES. Exposees sur `contexte`
// (le sandbox, pas le globalThis reel -- voir le commentaire de
// ouvrirLePanneau()) par globalThis.__parPepite / __kamas.
test('parPepite et kamas sur leurs cas limites', async () => {
  const { contexte } = await ouvrirLePanneau();
  // Taux >= 1: le nombre s'ecrit a l'unite.
  assert.strictEqual(contexte.__parPepite(2.5), `${(2.5).toLocaleString('fr-FR')} /u`);
  // Taux tres petit: on montre combien d'unites font une pepite, arrondi au
  // dessus -- jamais en dessous, sous peine de promettre une pepite qu'on
  // n'a pas encore payee.
  assert.strictEqual(contexte.__parPepite(0.01), `${Math.ceil(1 / 0.01).toLocaleString('fr-FR')} u`);
  // Valeur nulle ou fausse: un tiret, jamais une division par zero muette.
  assert.strictEqual(contexte.__parPepite(0), '—');
  assert.strictEqual(contexte.__parPepite(null), '—');
  assert.strictEqual(contexte.__parPepite(undefined), '—');

  assert.strictEqual(contexte.__kamas(null), '—');
  assert.strictEqual(contexte.__kamas(undefined), '—');
  assert.strictEqual(contexte.__kamas(1234567), Math.round(1234567).toLocaleString('fr-FR'));
  // Arrondi, pas tronque: 1666.67 doit s afficher comme 1667.
  assert.strictEqual(contexte.__kamas(1666.67), Math.round(1666.67).toLocaleString('fr-FR'));
});
