# Le prix réel des pépites — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le prix moyen par le vrai prix du marché dans le classement des pépites, en lançant une passe de lecture à chaque ouverture d'un étal d'hôtel de vente.

**Architecture:** La minuterie de 12 heures disparaît. Un module neuf, `src/pepites/marche.js`, frère de `src/hdv/reprix.js`, tarife les 50 objets du tableau un par un — abonnement, lecture, désabonnement — au rythme validé en jeu le 01/09. Le classeur accepte désormais deux sources de prix, et chaque ligne dit de laquelle elle vient.

**Tech Stack:** Node ≥ 18 sans dépendance nouvelle, `node --test` + `node:assert`, Electron pour le câblage.

**Conception :** `docs/superpowers/specs/2026-09-11-pepites-prix-marche-design.md`. À lire avant la tâche 1.

## Global Constraints

- **Aucune dépendance npm nouvelle.**
- **`'use strict';` en tête de chaque fichier `.js`.**
- **Les commentaires de code s'écrivent sans accents** (`src/hdv/objets.js`, `vente.js`, `tableau.js` : tous). Les chaînes affichées à l'utilisateur et les `.md` gardent leurs accents.
- **Les commentaires disent POURQUOI, pas QUOI.**
- **Tests :** `node --test` avec `node:test` et `node:assert`, fichiers dans `test/`. Aucun framework ajouté.
- **`node --test test/` sans nom de fichier échoue sur cette installation Windows.** Utiliser `node --test test/<fichier>`, ou `npm test` pour la suite complète.
- **Deux échecs préexistants et sans rapport** : `test/hdv-reprix.test.js`, `test/hdv-vente.test.js` et `test/framing.test.js` flanchent parfois sous la charge de `npm test` et passent toujours en isolation. Ne pas les imputer à ce travail, ne pas les corriger.
- **Aucun nom de trame en dur hors de `src/hdv/trames.js`.** Le jeu renomme ses messages à chaque grosse mise à jour — 148 sur 150 le 8 septembre. On passe par les fonctions de `trames.js`. Seule exception autorisée : `'isb'`, la liste de l'étal, que `garde-hdv.js` et `vente.js` citent déjà.
- **Signature d'écoute :** `onTrame({ pid, dir, frame })`, garde `dir !== 'in'` en première ligne, comme `src/hdv/vente.js:481`.
- **Garde d'identité du client :** `superviseur.comptes.get(pid) === passe.etatArme`, jamais une comparaison de pid seule. Windows recycle les pid.
- **50 objets par passe.**

---

### Task 1: Le spike — trois mesures devant un étal

**Files:**
- Create: `docs/superpowers/specs/2026-09-11-trames-etal.md`

**Interfaces:**
- Consumes: rien.
- Produces: trois réponses que les tâches 3 et 4 utilisent — la trame qui porte la catégorie de l'étal et ses valeurs, ce que répond un abonnement hors catégorie, et la trame de fermeture de l'étal si elle existe.

> **Cette tâche demande une session de jeu.** Elle ne peut pas être faite par un agent seul : il faut un humain devant un hôtel de vente. L'agent prépare, analyse et rédige ; l'humain joue.

- [ ] **Step 1: Demander la capture**

Aucune instrumentation à poser : `src/superviseur.js` journalise déjà toute trame dans les deux sens sous `OMNI_CAPTURE=1`.

Demander à Jibef de lancer :

```powershell
$env:OMNI_CAPTURE = '1'
$env:OMNI_DEV = 'C:\Users\Utilisateur\mm'
.\desktop\dist\OMNI-win32-x64\OMNI.exe
```

Puis, avec **un seul** personnage connecté, dans cet ordre exact :

1. ouvrir l'**hôtel de vente ressources**, attendre trois secondes, le **fermer** ;
2. ouvrir l'**hôtel de vente items** (équipements), attendre trois secondes, le fermer ;
3. ouvrir l'**hôtel de vente consommables**, attendre trois secondes, le fermer ;
4. rouvrir celui des ressources, et y **rechercher un objet quelconque** pour provoquer un abonnement du client lui-même.

Noter l'heure de chaque geste : le journal est horodaté en millisecondes depuis le lancement, et c'est ce qui permet de recoller les trames aux gestes.

- [ ] **Step 2: Localiser les trois ouvertures dans le journal**

Le journal est `journal-bug-0909.log` à la racine du dépôt (le nom ne bouge pas, c'est le fichier de capture courant).

```bash
grep -n "isb" journal-bug-0909.log | head -20
```

`isb` est la liste de l'étal, et elle seule prouve qu'on a ouvert un hôtel de vente — `src/garde-hdv.js:39` le documente, mesure du 09/09 : elle arrive 32 ms après le clic `iva`.

Relever le numéro de ligne des trois `isb`.

- [ ] **Step 3: Répondre à la question 1 — la catégorie**

Pour chacune des trois ouvertures, lister les trames entrantes des 200 lignes qui suivent, et chercher celle qui diffère d'un étal à l'autre :

```bash
sed -n '<ligne_isb>,+200p' journal-bug-0909.log | grep -oE "<-- (event|response) [a-z]{3}" | sort | uniq -c | sort -rn
```

Faire les trois, comparer les trois listes. Une trame présente dans les trois avec une **valeur de champ différente** est la candidate : c'est l'héritière de l'ancien `khd { 3=11 }`, où 11 désignait les ressources.

Écrire dans le document de mesure : le nom du jour de cette trame, le numéro du champ qui porte la catégorie, et les trois valeurs observées. Si aucune trame ne se distingue, l'écrire aussi — c'est une réponse, et la tâche 3 a un repli pour ce cas.

- [ ] **Step 4: Répondre à la question 2 — l'abonnement hors catégorie**

Chercher les abonnements émis par le client lui-même au geste 4 :

```bash
grep -n "\-\-> .* kde" journal-bug-0909.log | head -10
```

Relever le gid abonné et la réponse qui suit (`jzn`, lue par `lireStatsPrix`). Puis vérifier dans `src/hdv/objets.json` à quelle catégorie appartient ce gid.

Ce que le client fait de lui-même ne prouve pas ce qui arriverait hors catégorie. **Si la capture ne contient aucun abonnement hors catégorie, l'écrire franchement** et marquer la question comme non tranchée : la tâche 3 tente alors tous les gids et compte les silences, ce qui est le repli prévu par la conception.

- [ ] **Step 5: Répondre à la question 3 — la fermeture**

Chercher, après chaque `isb`, ce qui accompagne la fermeture de l'étal — en s'appuyant sur les heures notées au geste :

```bash
sed -n '<ligne_isb>,+400p' journal-bug-0909.log | grep -E "<-- |--> " | tail -40
```

Une trame qui revient aux trois fermetures et nulle part ailleurs est la candidate.

Si aucune ne se dégage, l'écrire. Le repli est l'épuisement par les délais : un étal fermé cesse de répondre, chaque gid tombe en silence, la passe s'épuise. Lent mais sûr.

- [ ] **Step 6: Écrire le document de mesure**

Créer `docs/superpowers/specs/2026-09-11-trames-etal.md` sur le modèle de `docs/superpowers/specs/2026-09-01-trames-hdv.md` : un tableau des trames observées, leurs champs, les valeurs mesurées, et **ce qui n'a pas pu être mesuré, dit explicitement**.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-09-11-trames-etal.md
git commit -m "docs(pepites): les trames de l etal, mesurees sur les trois categories"
```

---

### Task 2: Le classement à deux sources, et tous ses consommateurs

**Files:**
- Modify: `src/pepites/classement.js`
- Modify: `src/hdv/prix.js` (exporter `voisinServi`)
- Modify: `desktop/main.js` (le mapping des noms dans le handler `tableauPepites`)
- Modify: `desktop/index.html` (les deux tableaux : classement et recherche)
- Modify: `outils/faux-etat.js` (le faux classement du banc)
- Test: `test/pepites-classement.test.js`, `test/pepites-panneau.test.js`, `test/interface-locale-*.test.js`

**Interfaces:**
- Consumes: `tauxDe(gid)` de `src/pepites/taux.js`, `nomDe(gid)` de `src/hdv/objets.js`.
- Produces:
  - `classer({ prixMoyens, prixMarche = null, limite = 50 }) -> ligne[]`
  - `ligne = { gid, taux, prix, source, quand, coutParPepite, suspect }` où `source` vaut `'marche'` ou `'moyen'`, et `quand` est l'horodatage de la lecture de marché ou `null`.
  - `prixMarche` est une `Map` gid → `{ prix, quand }`.
  - `chercher({ texte, prixMoyens, prixMarche = null, limite = 20 })` rend la même forme, plus `nom`.
  - `voisinServi(marche, i)` exporté depuis `src/hdv/prix.js`.

> **LE RENOMMAGE ET SES CONSOMMATEURS TIENNENT DANS UN SEUL COMMIT, ET C'EST DELIBERE.** Le champ `prixMoyen` devient `prix` ; quatre endroits le lisent. Les séparer en deux tâches laisserait l'arbre rouge entre les deux — l'erreur exacte commise sur le plan précédent, où les tâches 6 et 7 ont dû être réunies après coup parce qu'un test du dépôt interdisait l'état intermédiaire.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `test/pepites-classement.test.js` :

```js
const MEDICINALE = 0.07114285714285715;

// LE PRIX REEL PRIME SUR LA MOYENNE, toujours: c'est le sens meme de la
// fonctionnalite. Une moyenne qui gagnerait sur un prix mesure ferait mentir
// la colonne qui annonce la source.
test('un prix de marche remplace le prix moyen du meme objet', () => {
  const l = classer({
    prixMoyens: new Map([[303, 12]]),
    prixMarche: new Map([[303, { prix: 4, quand: 1000 }]]),
  });
  assert.strictEqual(l[0].prix, 4);
  assert.strictEqual(l[0].source, 'marche');
  assert.strictEqual(l[0].quand, 1000);
  assert.strictEqual(l[0].coutParPepite, 4 / 0.003000000026077032);
});

test('sans prix de marche, la ligne vient de la moyenne et le dit', () => {
  const l = classer({ prixMoyens: new Map([[303, 12]]) });
  assert.strictEqual(l[0].source, 'moyen');
  assert.strictEqual(l[0].prix, 12);
  assert.strictEqual(l[0].quand, null);
});

// UNE TABLE DE MARCHE VIDE NE CHANGE RIEN. C'est l'etat avant la premiere
// passe, et c'est le cas le plus frequent.
test('une table de marche vide rend exactement le classement d avant', () => {
  const avant = classer({ prixMoyens: new Map([[303, 12], [13731, 19]]) });
  const apres = classer({ prixMoyens: new Map([[303, 12], [13731, 19]]), prixMarche: new Map() });
  assert.deepStrictEqual(apres, avant);
});

// UN PRIX DE MARCHE EXISTE SANS MOYENNE. Environ 39 % des objets recyclables
// n'ont aucun prix dans ivi (mesure du 11/09): pour ceux-la, la passe de
// marche est la SEULE source, et les ecarter reviendrait a perdre ce qu'on
// vient d'aller chercher.
test('un objet sans prix moyen entre au classement s il a un prix de marche', () => {
  const l = classer({
    prixMoyens: new Map(),
    prixMarche: new Map([[303, { prix: 4, quand: 1000 }]]),
  });
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].gid, 303);
  assert.strictEqual(l[0].source, 'marche');
});

// LE DOUTE NE PORTE QUE SUR LES MOYENNES. Un prix de marche a 3 kamas n'est
// pas douteux, il est vrai: c'est le prix auquel on peut acheter, maintenant.
test('un prix de marche bas n est jamais marque suspect', () => {
  const l = classer({
    prixMoyens: new Map(),
    prixMarche: new Map([[303, { prix: 2, quand: 1000 }]]),
  });
  assert.strictEqual(l[0].suspect, false);
});

test('un prix moyen bas reste marque suspect', () => {
  const l = classer({ prixMoyens: new Map([[303, 2]]) });
  assert.strictEqual(l[0].suspect, true);
});

test('un prix de marche nul ou negatif retombe sur la moyenne', () => {
  const l = classer({
    prixMoyens: new Map([[303, 12]]),
    prixMarche: new Map([[303, { prix: 0, quand: 1000 }]]),
  });
  assert.strictEqual(l[0].source, 'moyen');
  assert.strictEqual(l[0].prix, 12);
});

test('la recherche porte elle aussi la source', () => {
  const r = chercher({
    texte: 'Bois de Frene',
    prixMoyens: new Map([[303, 12]]),
    prixMarche: new Map([[303, { prix: 4, quand: 1000 }]]),
  });
  const l = r.find((x) => x.gid === 303);
  assert.strictEqual(l.source, 'marche');
  assert.strictEqual(l.prix, 4);
});
```

Et dans `test/hdv-prix.test.js`, verrouiller l'export neuf :

```js
// voisinServi EST EXPORTE POUR marche.js, qui doit deduire un prix unitaire
// quand le creneau de taille 1 est vide. Dupliquer cette recherche ailleurs
// dupliquerait une regle subtile -- « a distance egale, on prend le plus
// petit » -- qui ne se devine pas en la relisant.
test('voisinServi trouve le creneau servi le plus proche', () => {
  const { voisinServi } = require('../src/hdv/prix');
  // creneaux 1 / 10 / 100 / 1000
  assert.strictEqual(voisinServi([0, 190, 1222, 18000], 0), 1);
  assert.strictEqual(voisinServi([19, 0, 1222, 18000], 1), 0);
  // A DISTANCE EGALE, LE PLUS PETIT: un creneau de petite taille est plus
  // liquide, donc son prix unitaire est mieux etabli.
  assert.strictEqual(voisinServi([19, 0, 1222, 0], 1), 0);
  assert.strictEqual(voisinServi([0, 0, 0, 0], 0), -1);
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

```bash
node --test test/pepites-classement.test.js test/hdv-prix.test.js
```

Attendu : ÉCHEC — `l[0].prix` vaut `undefined`, et `voisinServi is not a function`.

- [ ] **Step 3: Exporter `voisinServi`**

Dans `src/hdv/prix.js`, remplacer la ligne d'export par :

```js
module.exports = {
  decider, deciderPose, voisinServi, TAILLES, FACTEUR, GARDE_DEFAUT, MOTIFS_GARDE_FOU,
};
```

- [ ] **Step 4: Réécrire `classer()`**

Dans `src/pepites/classement.js`, remplacer le corps de `classer` par :

```js
// `prixMoyens` est la Map rendue par lirePrixMoyens() de src/hdv/trames.js.
// `prixMarche` est une Map gid -> { prix, quand }, remplie par marche.js quand
// une passe a tourne devant un etal. Elle vaut null tant qu'aucune passe n'a eu
// lieu, ce qui est l'etat au lancement.
//
// LE PRIX REEL PRIME, TOUJOURS. C'est le sens de la fonctionnalite, et la
// colonne des prix annonce la source de chaque ligne: une moyenne qui
// l'emporterait sur une mesure ferait mentir cette annonce.
function classer({ prixMoyens, prixMarche = null, limite = LIMITE }) {
  const lignes = [];
  const gids = new Set();
  if (prixMoyens !== null && prixMoyens !== undefined) for (const g of prixMoyens.keys()) gids.add(g);
  // LES GIDS DU MARCHE ENTRENT AUSSI, et pas seulement ceux d'ivi: environ
  // 39 % des objets recyclables n'ont aucun prix moyen (mesure du 11/09).
  // Pour ceux-la la passe de marche est la seule source, et les ignorer
  // reviendrait a jeter ce qu'on vient d'aller chercher devant l'etal.
  if (prixMarche !== null && prixMarche !== undefined) for (const g of prixMarche.keys()) gids.add(g);
  for (const gid of gids) {
    const taux = tauxDe(gid);
    if (taux === null) continue;
    const ligne = prixEtSource(gid, prixMoyens, prixMarche);
    if (ligne === null) continue;
    lignes.push({
      gid,
      taux,
      prix: ligne.prix,
      source: ligne.source,
      quand: ligne.quand,
      coutParPepite: ligne.prix / taux,
      // LE DOUTE NE PORTE QUE SUR LES MOYENNES. Un prix de marche a 3 kamas
      // n'est pas douteux, il est vrai: c'est le prix auquel on peut acheter.
      suspect: ligne.source === 'moyen' && ligne.prix <= PRIX_SUSPECT,
    });
  }
  lignes.sort((a, b) => (a.coutParPepite - b.coutParPepite)
    || (b.taux - a.taux)
    || (a.gid - b.gid));
  return lignes.slice(0, limite);
}
```

Et ajouter, juste au-dessus de `classer` :

```js
// Le prix retenu pour un gid, et d'ou il vient. Rend null quand aucune des
// deux sources ne donne de prix utilisable -- ce qui est le cas de la majorite
// du catalogue.
//
// UN PRIX DE MARCHE A ZERO N'EST PAS UN PRIX. Le zero des quatre creneaux veut
// dire « aucune offre a cette taille », jamais « gratuit »: la regle est celle
// de src/hdv/prix.js, et la confondre ferait sortir l'objet en tete du
// classement a cout nul.
function prixEtSource(gid, prixMoyens, prixMarche) {
  const reel = prixMarche === null || prixMarche === undefined ? undefined : prixMarche.get(gid);
  if (reel !== null && reel !== undefined && typeof reel.prix === 'number' && reel.prix > 0) {
    return { prix: reel.prix, source: 'marche', quand: reel.quand === undefined ? null : reel.quand };
  }
  const moyen = prixMoyens === null || prixMoyens === undefined ? undefined : prixMoyens.get(gid);
  if (typeof moyen === 'number' && moyen > 0) return { prix: moyen, source: 'moyen', quand: null };
  return null;
}
```

- [ ] **Step 5: Réécrire `chercher()`**

Dans le même fichier, remplacer le corps de la boucle de `chercher` pour qu'il utilise `prixEtSource`, et ajouter `prixMarche` à sa signature :

```js
function chercher({ texte, prixMoyens, prixMarche = null, limite = LIMITE_RECHERCHE }) {
  const q = sansAccent(texte === null || texte === undefined ? '' : texte).trim();
  if (q.length < 2) return [];
  const out = [];
  for (const cle of Object.keys(TAUX)) {
    const nom = nomDe(cle);
    if (nom === null || !sansAccent(nom).includes(q)) continue;
    const gid = Number(cle);
    const taux = tauxDe(gid);
    if (taux === null) continue;
    const p = prixEtSource(gid, prixMoyens, prixMarche);
    out.push({
      gid,
      nom,
      taux,
      prix: p === null ? null : p.prix,
      source: p === null ? null : p.source,
      quand: p === null ? null : p.quand,
      coutParPepite: p === null ? null : p.prix / taux,
      suspect: p !== null && p.source === 'moyen' && p.prix <= PRIX_SUSPECT,
    });
  }
  // LES SANS-PRIX EN DERNIER, et pas melanges: ils n'ont pas de cout, donc
  // aucune place legitime dans un tri par cout. Les mettre en tete ferait
  // passer « on ne sait pas » pour « c'est le meilleur ».
  out.sort((a, b) => {
    if (a.coutParPepite === null && b.coutParPepite === null) return a.gid - b.gid;
    if (a.coutParPepite === null) return 1;
    if (b.coutParPepite === null) return -1;
    return (a.coutParPepite - b.coutParPepite) || (b.taux - a.taux) || (a.gid - b.gid);
  });
  return out.slice(0, limite);
}
```

- [ ] **Step 6: Migrer les quatre consommateurs**

**`desktop/main.js`**, handler `tableauPepites` : le mapping des noms ne change pas de forme, mais vérifier qu'il n'y a aucune référence à `prixMoyen`. Chercher :

```bash
grep -n "prixMoyen" desktop/main.js desktop/index.html outils/faux-etat.js outils/faux-app.js
```

Chaque occurrence devient `prix`, **et il faut aussi porter `source`** jusqu'au rendu.

**`desktop/index.html`**, les deux tableaux. Dans `dessinerPepites()`, la cellule du prix devient :

```js
      + '<td>' + cellulePrix(l) + '</td>'
```

et dans `dessinerRecherche()` :

```js
        + '<td>' + (l.prix === null ? 'prix inconnu' : cellulePrix(l)) + '</td>'
```

avec, à côté de `kamas()` :

```js
  // LA COLONNE DIT D'OU VIENT LE CHIFFRE, et ce n'est pas decoratif. Deux
  // lignes voisines peuvent venir de deux sources, et les laisser se
  // ressembler ferait pire que le « pas clair » signale le 11/09: le mensonge
  // porterait sur la NATURE du chiffre, pas sur sa mise en page.
  function cellulePrix(l) {
    if (l.prix === null || l.prix === undefined) return '—';
    if (l.source !== 'marche') return kamas(l.prix);
    const h = new Date(l.quand).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return kamas(l.prix) + ' <span class="' + PEP.marche + '" title="Prix relevé à l’hôtel de vente à '
      + h + '">marché</span>';
  }
```

Ajouter `marche: 'pep-marche'` à la table `PEP`, et la règle de style à côté des autres `.pep-` :

```css
.pep-marche { color: #6fcf82; font-size: 10px; margin-left: 6px; }
```

**`outils/faux-etat.js`** : le faux classement du banc doit produire la forme neuve, et **au moins une ligne de chaque source**, sans quoi le banc ne montrerait jamais la distinction qu'on vient d'ajouter.

- [ ] **Step 7: Mettre à jour les tests des consommateurs**

`test/pepites-panneau.test.js` et les tests du banc assertent la forme des lignes. Les faire suivre, et **ajouter au harnais `vm` du panneau** un test qui vérifie que deux lignes de sources différentes ne se dessinent pas pareil :

```js
test('une ligne de marche et une ligne de moyenne ne se dessinent pas pareil', async () => {
  const { contexte, document } = await ouvrirLePanneau({
    lignes: [
      { gid: 303, nom: 'Bois de Frêne', taux: 0.003, prix: 4, source: 'marche', quand: 1757580000000, coutParPepite: 1333, suspect: false, etat: 'stable', deltaRang: 0, deltaCout: 0 },
      { gid: 13731, nom: 'Pierre Médicinale', taux: 0.0711, prix: 19, source: 'moyen', quand: null, coutParPepite: 267, suspect: false, etat: 'stable', deltaRang: 0, deltaCout: 0 },
    ],
  });
  contexte.dessinerPepites();
  const html = document.getElementById('pepCorps').innerHTML;
  assert.ok(html.includes('pep-marche'), 'la ligne de marche doit porter son marqueur');
  assert.strictEqual((html.match(/pep-marche/g) || []).length, 1,
    'la ligne de moyenne ne doit pas le porter');
});
```

- [ ] **Step 8: Lancer la suite**

```bash
node --test test/pepites-classement.test.js test/hdv-prix.test.js test/pepites-panneau.test.js test/interface-locale-app.test.js test/interface-locale-etat.test.js test/interface-locale-serveur.test.js
npm test
```

Attendu : 0 échec, hors les trois flakes connus.

- [ ] **Step 9: Commit**

```bash
git add src/pepites/classement.js src/hdv/prix.js desktop/main.js desktop/index.html outils/faux-etat.js test/
git commit -m "feat(pepites): le classement accepte deux sources de prix, et chaque ligne dit la sienne"
```

---

### Task 3: `marche.js`, la passe

**Files:**
- Create: `src/pepites/marche.js`
- Test: `test/pepites-marche.test.js`

**Interfaces:**
- Consumes: `trameAbonner(gid)`, `trameDesabonner(gid)`, `trameStats(gid)`, `lireStatsPrix(frame)`, `TAILLES` de `src/hdv/trames.js` ; `voisinServi(marche, i)` de `src/hdv/prix.js` ; `rythmeObjet(hasard, reglage)` et `DELAI_REPONSE` de `src/hdv/reprix.js`.
- Produces: `creerMarche({ superviseur, candidats, reglages, onPrix, onAvancement, onFin }) -> { onTrame, enCours }`, plus `prixUnitaire(quatre)` et `OUVERTURE_ETAL`.
  - `candidats()` est une fonction sans argument qui rend le tableau des gids à tarifer, dans l'ordre du classement.
  - `onPrix({ pid, gid, prix, quand })` est appelé pour chaque prix lu.
  - `onAvancement({ pid, fait, total })` à chaque objet traité.
  - `onFin({ pid, bilan })` où `bilan = { tarifes, sansOffre, echecs, raison }`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `test/pepites-marche.test.js` :

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerMarche, prixUnitaire, OUVERTURE_ETAL } = require('../src/pepites/marche');

// Un double du superviseur, sur le modele de test/hdv-reprix.test.js: il
// memorise ce qu'on lui demande d'emettre et rend un etat de compte stable,
// dont l'IDENTITE sert de garde.
function fauxSuperviseur() {
  const etats = new Map();
  const envois = [];
  return {
    envois,
    comptes: { get: (pid) => etats.get(pid) || null },
    poser: (pid) => { const e = { pid }; etats.set(pid, e); return e; },
    retirer: (pid) => etats.delete(pid),
    emettre: (pid, trame) => { envois.push({ pid, trame }); return { ok: true, octets: 1 }; },
  };
}

// L'ouverture d'un etal. marche.js ne regarde que le type, donc un objet nu
// suffit -- c'est la seule fixture de ce fichier qui ne vient pas d'octets.
function trameEtal() { return { type: OUVERTURE_ETAL, payload: [] }; }

// LES REPONSES DE STATISTIQUES VIENNENT D'OCTETS, PAS D'OBJETS FABRIQUES, et
// c'est la lecon du 11/09: sur la tache precedente, une fixture construite a la
// main posait `kind: 'varint'` la ou le decodeur attend `wire`, si bien que la
// lecture rendait une table VIDE sans lever la moindre exception. Plusieurs
// tests passaient alors pour la mauvaise raison.
//
// Les quatre prix sont un champ PACKE, lu via `f.raw` par quatrePrix(): aucune
// construction a la main ne peut le reproduire de tete. Les hex ci-dessous ont
// ete produits puis VERIFIES en passant par lireStatsPrix(), et chacun rend
// exactement ce que son commentaire annonce. Meme demarche que
// test/hdv-trames.test.js, dont toutes les valeurs sont mesurees.
const { decodeFrameRaw } = require('../src/codec/rawProto');
const frame = (hex) => decodeFrameRaw(Buffer.from(hex, 'hex'));

// gid 303, prix [19, 190, 1222, 18000] -- creneau de taille 1 servi.
const JZN_303_SERVI = '12331a310a13747970652e616e6b616d612e636f6d2f6a7a6e121a08af02121310af02186828d9f104320813be01c609d08c011868';
// gid 303, prix [0, 190, 1222, 18000] -- taille 1 vide, a deduire du voisin.
const JZN_303_TAILLE1_VIDE = '12331a310a13747970652e616e6b616d612e636f6d2f6a7a6e121a08af02121310af02186828d9f104320800be01c609d08c011868';
// gid 303, prix [0, 0, 0, 0] -- personne n'en vend.
const JZN_303_VIDE = '122f1a2d0a13747970652e616e6b616d612e636f6d2f6a7a6e121608af02120f10af02186828d9f1043204000000001868';
// gid 13731, prix [25, 250, 2400, 23000].
const JZN_13731_SERVI = '12331a310a13747970652e616e6b616d612e636f6d2f6a7a6e121a08a36b121310a36b186828d9f104320819fa01e012d8b3011868';

// Verrou sur les fixtures elles-memes: si une seule cesse de se decoder, on
// veut le savoir ici et pas au milieu d'un test de sequencement.
test('les fixtures de statistiques se decodent bien', () => {
  const { lireStatsPrix } = require('../src/hdv/trames');
  assert.deepStrictEqual(lireStatsPrix(frame(JZN_303_SERVI)).prix, [19, 190, 1222, 18000]);
  assert.deepStrictEqual(lireStatsPrix(frame(JZN_303_TAILLE1_VIDE)).prix, [0, 190, 1222, 18000]);
  assert.deepStrictEqual(lireStatsPrix(frame(JZN_303_VIDE)).prix, [0, 0, 0, 0]);
  assert.strictEqual(lireStatsPrix(frame(JZN_13731_SERVI)).gid, 13731);
});

function creer(gids, extra = {}) {
  const sup = fauxSuperviseur();
  const prix = [];
  const fins = [];
  const avance = [];
  const m = creerMarche({
    superviseur: sup,
    candidats: () => gids,
    // Delais explicites: ils court-circuitent le rythme et rendent les tests
    // synchrones, comme le fait test/hdv-reprix.test.js.
    reglages: { delaiObjetMs: 0, delaiReponseMs: 50 },
    onPrix: (p) => prix.push(p),
    onAvancement: (a) => avance.push(a),
    onFin: (f) => fins.push(f),
    ...extra,
  });
  return { m, sup, prix, fins, avance };
}

// --- prixUnitaire() ---------------------------------------------------

// LE ZERO N'EST PAS UN PRIX, c'est « aucune offre a cette taille ». La regle
// est celle de src/hdv/prix.js, et la confondre ferait sortir l'objet en tete
// du classement a cout nul.
test('le prix unitaire vient du creneau de taille 1 quand il est servi', () => {
  assert.strictEqual(prixUnitaire([19, 190, 1222, 18000]), 19);
});

test('un creneau de taille 1 vide se deduit du voisin servi le plus proche', () => {
  // 190 kamas le lot de 10 -> 19 l'unite.
  assert.strictEqual(prixUnitaire([0, 190, 1222, 18000]), 19);
});

test('un marche entierement vide ne rend pas de prix', () => {
  assert.strictEqual(prixUnitaire([0, 0, 0, 0]), null);
  assert.strictEqual(prixUnitaire(null), null);
});

// --- la passe ---------------------------------------------------------

test('l ouverture d un etal demarre la passe et abonne le premier gid', () => {
  const { m, sup } = creer([303, 13731]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  assert.ok(sup.envois.length >= 1, 'au moins l abonnement du premier gid');
  assert.strictEqual(m.enCours(7), true);
});

// LE GARDE DE SENS, EN PREMIERE LIGNE, comme vente.js:481.
test('une trame sortante ne demarre rien', () => {
  const { m, sup } = creer([303]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'out', frame: trameEtal() });
  assert.deepStrictEqual(sup.envois, []);
});

test('un prix lu est rendu a l appelant', async () => {
  const { m, sup, prix } = creer([303]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  m.onTrame({ pid: 7, dir: 'in', frame: frame(JZN_303_SERVI) });
  assert.strictEqual(prix.length, 1);
  assert.strictEqual(prix[0].gid, 303);
  assert.strictEqual(prix[0].prix, 19);
  assert.strictEqual(typeof prix[0].quand, 'number');
});

// UN SEUL GID EN VOL A LA FOIS, meme raison que dans reprix.js: une reponse
// doit porter sur le marche qu'on vient de demander, pas sur un chiffre
// memorise d'un objet precedent.
test('une reponse qui porte sur un autre gid est ignoree', () => {
  const { m, sup, prix } = creer([303, 13731]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  m.onTrame({ pid: 7, dir: 'in', frame: frame(JZN_13731_SERVI) });
  assert.deepStrictEqual(prix, []);
});

// LA GARDE D'IDENTITE, pas une comparaison de pid: Windows recycle les pid, et
// un client relance pendant la passe ne doit pas heriter de la passe du
// precedent (passeur.js:120).
test('un client qui disparait arrete la passe', () => {
  const { m, sup, fins } = creer([303, 13731]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  sup.retirer(7);
  m.onTrame({ pid: 7, dir: 'in', frame: frame(JZN_303_SERVI) });
  assert.strictEqual(m.enCours(7), false);
  assert.strictEqual(fins.length, 1);
});

// DEUX PASSES CONCURRENTES DOUBLERAIENT LE DEBIT D'EMISSIONS.
test('une seconde ouverture pendant une passe ne demarre rien', () => {
  const { m, sup } = creer([303, 13731]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  const avant = sup.envois.length;
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  assert.strictEqual(sup.envois.length, avant);
});

test('sans candidats, la passe ne demarre pas', () => {
  const { m, sup } = creer([]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  assert.deepStrictEqual(sup.envois, []);
  assert.strictEqual(m.enCours(7), false);
});

// UN MARCHE VIDE N'EST PAS UN ECHEC: l'objet existe, personne n'en vend. Le
// bilan les compte a part, parce que les deux appellent des reactions
// differentes -- l'un se reessaie, l'autre non.
test('un marche vide compte comme sans offre, pas comme un echec', async () => {
  const { m, sup, prix, fins } = creer([303]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  m.onTrame({ pid: 7, dir: 'in', frame: frame(JZN_303_VIDE) });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepStrictEqual(prix, []);
  assert.strictEqual(fins[0].bilan.sansOffre, 1);
  assert.strictEqual(fins[0].bilan.echecs, 0);
});

// UNE REPONSE QUI N'ARRIVE PAS N'ABANDONNE QUE SON GID, pas la passe: regle
// reprise de reprix.js, ou elle a ete posee pour la meme raison.
test('une reponse absente n abandonne que son gid', async () => {
  const { m, sup, fins } = creer([303, 13731]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  await new Promise((r) => setTimeout(r, 80));
  m.onTrame({ pid: 7, dir: 'in', frame: frame(JZN_13731_SERVI) });
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(fins[0].bilan.echecs, 1);
  assert.strictEqual(fins[0].bilan.tarifes, 1);
});

test('l avancement est rendu objet par objet', async () => {
  const { m, sup, avance } = creer([303, 13731]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  m.onTrame({ pid: 7, dir: 'in', frame: frame(JZN_303_SERVI) });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(avance[0].fait, 1);
  assert.strictEqual(avance[0].total, 2);
});

// ON SE DESABONNE. Tant qu'on est abonne, le serveur pousse un prix a chaque
// mouvement du marche sur ce gid. Sans desabonnement, la passe laisse derriere
// elle cinquante flux ouverts.
test('chaque gid traite est desabonne', async () => {
  const { m, sup } = creer([303]);
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  m.onTrame({ pid: 7, dir: 'in', frame: frame(JZN_303_SERVI) });
  await new Promise((r) => setTimeout(r, 10));
  const { trameDesabonner } = require('../src/hdv/trames');
  const attendu = JSON.stringify(trameDesabonner(303));
  assert.ok(sup.envois.some((e) => JSON.stringify(e.trame) === attendu),
    'un desabonnement doit avoir ete emis pour 303');
});

test('un refus d emission arrete la passe et le dit', () => {
  const sup = fauxSuperviseur();
  sup.emettre = () => ({ ok: false, raison: 'pas de socket amont' });
  const fins = [];
  const m = creerMarche({
    superviseur: sup,
    candidats: () => [303],
    reglages: { delaiObjetMs: 0, delaiReponseMs: 50 },
    onFin: (f) => fins.push(f),
  });
  sup.poser(7);
  m.onTrame({ pid: 7, dir: 'in', frame: trameEtal() });
  assert.strictEqual(fins.length, 1);
  assert.strictEqual(fins[0].bilan.raison, 'pas de socket amont');
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

```bash
node --test test/pepites-marche.test.js
```

Attendu : ÉCHEC, `Cannot find module '../src/pepites/marche'`.

- [ ] **Step 3: Écrire le module**

Créer `src/pepites/marche.js` :

```js
'use strict';
const {
  trameAbonner, trameDesabonner, trameStats, lireStatsPrix, TAILLES,
} = require('../hdv/trames');
const { voisinServi } = require('../hdv/prix');
const { rythmeObjet, DELAI_REPONSE } = require('../hdv/reprix');

// Le vrai prix du marche des objets du classement des pepites, lu a
// l'ouverture d'un etal.
//
// Conception: docs/superpowers/specs/2026-09-11-pepites-prix-marche-design.md.
//
// C'EST LE FRERE DE reprix.js, et il en reprend la forme eprouvee: un gid a la
// fois, abonnement, lecture, desabonnement, au rythme valide en jeu le 01/09.
//
// CE QU'IL N'A PAS, ET QUE reprix.js A: la boucle de relecture apres emission.
// reprix.js relit les prix apres chaque mise a jour de lot parce qu'il MODIFIE
// le marche. Ici on ne fait que lire: aucune de nos emissions ne change un
// prix, donc il n'y a rien a relire.
//
// CE MODULE EMET, ET C'EST UNE PREMIERE DANS LE PROJET sur un geste qui n'est
// pas un clic dans OMNI. reprix.js et vente.js emettent sur un bouton; la
// passe part ici sur l'ouverture d'un etal. Trois choses la bornent: elle ne
// demarre que sur `isb`, elle ne touche que les candidats qu'on lui donne, et
// elle reprend le rythme deja juge acceptable en jeu.

// La liste de l'etal. SEUL l'hotel de vente la fait redescendre -- le clic est
// un `iva`, le meme message qu'un zaap ou une porte (garde-hdv.js:39, mesure
// du 09/09: elle arrive 32 ms apres le clic).
//
// C'est le seul nom de trame cite en dur ici, et il l'est deja dans
// garde-hdv.js et vente.js.
const OUVERTURE_ETAL = 'isb';

// Le prix a l'unite, tire des quatre creneaux 1 / 10 / 100 / 1000.
//
// LE ZERO N'EST PAS UN PRIX, c'est « aucune offre a cette taille ». On deduit
// alors du creneau servi le plus proche, ramene a l'unite: voisinServi() de
// prix.js porte cette recherche, y compris sa regle subtile « a distance
// egale, on prend le plus petit », parce qu'un creneau de petite taille est
// plus liquide et son prix unitaire mieux etabli.
function prixUnitaire(quatre) {
  if (!Array.isArray(quatre)) return null;
  const direct = Number(quatre[0]);
  if (direct > 0) return direct;
  const i = voisinServi(quatre, 0);
  if (i === -1) return null;
  const u = Math.floor(Number(quatre[i]) / TAILLES[i]);
  return u > 0 ? u : null;
}

function creerMarche({
  superviseur,
  candidats,
  reglages = {},
  onPrix = () => {},
  onAvancement = () => {},
  onFin = () => {},
}) {
  const passes = new Map();

  const delaiObjet = () => (Number.isFinite(reglages.delaiObjetMs)
    ? reglages.delaiObjetMs
    : rythmeObjet(Math.random, reglages.rythme));
  const delaiReponse = () => (Number.isFinite(reglages.delaiReponseMs)
    ? reglages.delaiReponseMs
    : DELAI_REPONSE);

  // ON COMPARE L'IDENTITE DE L'ETAT, PAS LE PID. Windows recycle les pid: un
  // client relance pendant la passe rendrait le meme numero et heriterait de
  // la passe du precedent (passeur.js:120).
  const memeClient = (pid, passe) => superviseur.comptes.get(pid) === passe.etatArme;

  function terminer(pid, raison) {
    const passe = passes.get(pid);
    if (passe === undefined) return;
    if (passe.minuteur !== null) clearTimeout(passe.minuteur);
    passes.delete(pid);
    onFin({ pid, bilan: { ...passe.bilan, raison: raison === undefined ? null : raison } });
  }

  function emettre(pid, passe, trame) {
    const r = superviseur.emettre(pid, trame);
    if (r === null || r === undefined || r.ok !== true) {
      terminer(pid, r && r.raison ? r.raison : 'emission refusee');
      return false;
    }
    return true;
  }

  function suivant(pid) {
    const passe = passes.get(pid);
    if (passe === undefined) return;
    if (!memeClient(pid, passe)) { terminer(pid, 'le client a disparu'); return; }
    if (passe.reste.length === 0) { terminer(pid); return; }
    passe.gid = passe.reste.shift();
    if (!emettre(pid, passe, trameAbonner(passe.gid))) return;
    if (!emettre(pid, passe, trameStats(passe.gid))) return;
    // LE DELAI MAXIMAL PAR ETAPE N'ABANDONNE QUE CE GID, pas la passe: regle
    // de reprix.js. Un etal ferme cesse de repondre, et c'est aussi par ce
    // chemin que la passe s'epuise proprement.
    passe.minuteur = setTimeout(() => {
      passe.bilan.echecs += 1;
      finirObjet(pid);
    }, delaiReponse());
    if (passe.minuteur.unref) passe.minuteur.unref();
  }

  function finirObjet(pid) {
    const passe = passes.get(pid);
    if (passe === undefined) return;
    if (passe.minuteur !== null) { clearTimeout(passe.minuteur); passe.minuteur = null; }
    // ON SE DESABONNE. Tant qu'on l'est, le serveur POUSSE un prix a chaque
    // mouvement du marche sur ce gid: sans cela la passe laisse derriere elle
    // autant de flux ouverts que d'objets visites.
    if (passe.gid !== null) emettre(pid, passe, trameDesabonner(passe.gid));
    passe.gid = null;
    passe.bilan.faits += 1;
    onAvancement({ pid, fait: passe.bilan.faits, total: passe.total });
    if (!passes.has(pid)) return;
    const t = setTimeout(() => suivant(pid), delaiObjet());
    if (t.unref) t.unref();
  }

  function demarrer(pid) {
    // DEUX PASSES CONCURRENTES DOUBLERAIENT LE DEBIT D'EMISSIONS. Une seconde
    // ouverture d'etal pendant une passe est donc ignoree, pas mise en file.
    if (passes.has(pid)) return;
    const etatArme = superviseur.comptes.get(pid);
    if (etatArme === null || etatArme === undefined) return;
    const gids = (typeof candidats === 'function' ? candidats() : []) || [];
    if (gids.length === 0) return;
    passes.set(pid, {
      etatArme,
      reste: [...gids],
      total: gids.length,
      gid: null,
      minuteur: null,
      bilan: { tarifes: 0, sansOffre: 0, echecs: 0, faits: 0 },
    });
    suivant(pid);
  }

  function onTrame({ pid, dir, frame }) {
    if (frame === null || frame === undefined || dir !== 'in') return;
    if (frame.type === OUVERTURE_ETAL) { demarrer(pid); return; }
    const passe = passes.get(pid);
    if (passe === undefined || passe.gid === null) return;
    if (!memeClient(pid, passe)) { terminer(pid, 'le client a disparu'); return; }
    const stats = lireStatsPrix(frame);
    if (stats === null || stats.gid !== passe.gid) return;
    const prix = prixUnitaire(stats.prix);
    // UN MARCHE VIDE N'EST PAS UN ECHEC: l'objet existe, personne n'en vend.
    // Les deux appellent des reactions differentes, donc le bilan les separe.
    if (prix === null) passe.bilan.sansOffre += 1;
    else { passe.bilan.tarifes += 1; onPrix({ pid, gid: stats.gid, prix, quand: Date.now() }); }
    finirObjet(pid);
  }

  const enCours = (pid) => passes.has(pid);

  return { onTrame, enCours };
}

module.exports = { creerMarche, prixUnitaire, OUVERTURE_ETAL };
```

- [ ] **Step 4: Lancer le test pour le voir passer**

```bash
node --test test/pepites-marche.test.js
```

Attendu : 14 tests, tous PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pepites/marche.js test/pepites-marche.test.js
git commit -m "feat(pepites): la passe de marche, un gid a la fois, au rythme du reprix"
```

---

### Task 4: Le câblage, la fin de la minuterie, et l'IHM

**Files:**
- Modify: `src/pepites/pepites.js` (retrait de la minuterie)
- Modify: `test/pepites.test.js`
- Modify: `desktop/main.js` (création de `marche`, écoute, avancement)
- Modify: `desktop/index.html` (avancement dans le panneau)
- Modify: `outils/faux-app.js` (le banc doit connaître l'avancement)

**Interfaces:**
- Consumes: `creerMarche({...})` de la tâche 3, `classer({ prixMoyens, prixMarche })` de la tâche 2.
- Produces: rien pour les tâches suivantes — c'est la dernière tâche de code.

- [ ] **Step 1: Retirer la minuterie de `pepites.js`**

Supprimer `PERIODE_MS`, `demarrer`, `arreter`, les arguments `periodeMs`, `poserMinuteur`, `oterMinuteur`, **et la garde `prixQuand`** posée en correction le 11/09 — elle n'existait que pour empêcher le battement de rejouer une passe identique, et le battement disparaît.

`creerPepites` garde `{ onTrame, passer, etat, prixMoyens }` et gagne une table de prix de marché :

```js
  // Les prix releves devant l'etal, par gid. VIDEE A CHAQUE ivi NEUVE: une ivi
  // veut dire nouvelle connexion, et un prix de marche vieux d'une session
  // n'est plus un prix de marche -- il vaut moins que la moyenne, qui au moins
  // s'annonce comme une moyenne.
  const prixMarche = new Map();

  function noterPrixMarche(gid, prix, quand) {
    prixMarche.set(gid, { prix, quand });
  }
```

Et `passer()` appelle `classer({ prixMoyens: table.prixMoyens, prixMarche })`.

Dans `onTrame`, à la réception d'une `ivi` neuve : `prixMarche.clear();` avant de mémoriser la table.

Exporter `noterPrixMarche` et `candidats` :

```js
  // Les gids du dernier classement, dans l'ordre. C'est ce que la passe de
  // marche va tarifer -- et c'est pourquoi elle n'a pas besoin de connaitre le
  // classeur: elle recoit une liste.
  function candidats() {
    const d = historique.dernier();
    return d === null ? [] : d.lignes.map((l) => l.gid);
  }
```

- [ ] **Step 2: Mettre à jour `test/pepites.test.js`**

Supprimer les tests de minuterie (`la periode vaut douze heures`, `la minuterie declenche une passe`, `une ivi ne rearme pas la minuterie`, `un battement sans ivi neuve n ecrit rien de plus`, `une ivi entre l armement et le battement`) et le double `poserMinuteur`/`oterMinuteur`. Ajouter :

```js
test('un prix de marche note change le classement a la passe suivante', () => {
  const { p, passes } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 100]]) });
  const avant = passes[0].passe.lignes[0].coutParPepite;
  p.noterPrixMarche(303, 10, 1000);
  p.passer();
  const apres = passes[1].passe.lignes[0].coutParPepite;
  assert.ok(apres < avant, 'un prix dix fois moindre doit baisser le cout');
  assert.strictEqual(passes[1].passe.lignes[0].source, 'marche');
});

// UN PRIX DE MARCHE VIEUX D'UNE SESSION N'EST PLUS UN PRIX DE MARCHE.
test('une ivi neuve vide les prix de marche', () => {
  const { p, passes } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 100]]) });
  p.noterPrixMarche(303, 10, 1000);
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 100]]) });
  assert.strictEqual(passes[passes.length - 1].passe.lignes[0].source, 'moyen');
});

test('les candidats sont les gids du dernier classement, dans l ordre', () => {
  const { p } = creer();
  p.onTrame({ pid: 7, dir: 'in', frame: trameIvi([[303, 100], [13731, 19]]) });
  assert.deepStrictEqual(p.candidats(), [13731, 303]);
});
```

- [ ] **Step 3: Câbler dans `desktop/main.js`**

Ajouter l'import à côté des autres imports pépites :

```js
const { creerMarche } = require('../src/pepites/marche');
```

Déclarer `let marche = null;` à côté de `let pepites = null;`.

Là où `pepites.demarrer()` était appelé, le remplacer par la création de la passe :

```js
  // LA PASSE PART A L'OUVERTURE D'UN ETAL, et c'est la premiere fois que ce
  // projet emet sur un geste qui n'est pas un clic dans OMNI. Voir la section
  // « Ce que ca change dans la nature du projet » de la conception.
  marche = creerMarche({
    superviseur,
    candidats: () => pepites.candidats(),
    reglages: { rythme: favoris.hdvRythme() },
    onPrix: ({ gid, prix, quand }) => pepites.noterPrixMarche(gid, prix, quand),
    onAvancement: ({ pid, fait, total }) => {
      if (fenetre !== null) fenetre.webContents.send('pepitesAvancement', { pid, fait, total });
    },
    onFin: ({ pid, bilan }) => {
      const b = bilan;
      journal(pid, `pepites marche : ${b.tarifes} tarifes, ${b.sansOffre} sans offre, `
        + `${b.echecs} echecs${b.raison ? ` — ${b.raison}` : ''}`);
      // LE CLASSEMENT SE REFAIT A LA FIN, une seule fois: le refaire a chaque
      // prix recalculerait cinquante fois pour cinquante lignes.
      pepites.passer();
      if (fenetre !== null) fenetre.webContents.send('pepitesAvancement', { pid, fait: 0, total: 0 });
    },
  });
```

Ajouter `marche.onTrame` au `composer(...)`, à côté de `pepites.onTrame` :

```js
    // Sans porte, comme pepites.onTrame: la passe ne lit que des prix publics
    // et ne change rien dans le jeu.
    marche.onTrame,
```

Retirer l'appel à `pepites.arreter()` de `window-all-closed` : la fonction n'existe plus.

- [ ] **Step 4: Ouvrir le canal d'avancement**

Dans `desktop/preload.js`, à côté de `tableauPepites` :

```js
  surPepitesAvancement: (cb) => ipcRenderer.on('pepitesAvancement', (_e, a) => cb(a)),
```

- [ ] **Step 5: Afficher l'avancement**

Dans `desktop/index.html`, à côté de `ouvrirPepites` :

```js
  // L'AVANCEMENT S'AFFICHE MEME PANNEAU FERME, dans le pied, parce que la
  // passe part toute seule: si elle ne se voyait que panneau ouvert, cinquante
  // emissions partiraient sans que rien ne l'annonce.
  window.app.surPepitesAvancement(({ fait, total }) => {
    const el = document.getElementById('pepAvance');
    if (el === null) return;
    el.textContent = total > 0 ? `prix du marché : ${fait} / ${total}` : '';
    el.hidden = total === 0;
    if (total > 0 || fait === 0) ouvrirPepites();
  });
```

Poser l'élément dans le balisage du panneau, entre la tête et la recherche :

```html
  <div class="pep-avance" id="pepAvance" hidden></div>
```

Ajouter `avance: 'pep-avance'` à la table `PEP`, et la règle :

```css
.pep-avance { padding: 4px 15px; font-size: 11px; opacity: .75; }
```

**Attention :** l'appel à `ouvrirPepites()` dans l'écouteur rouvre le panneau à chaque avancement, ce qui rechargerait le tableau cinquante fois. Le remplacer par un simple rafraîchissement quand le panneau est déjà ouvert :

```js
  window.app.surPepitesAvancement(({ fait, total }) => {
    const el = document.getElementById('pepAvance');
    if (el === null) return;
    el.textContent = total > 0 ? `prix du marché : ${fait} / ${total}` : '';
    el.hidden = total === 0;
    // Le tableau ne se recharge qu'a la FIN de la passe, quand main.js a
    // reclasse: total === 0 est le signal de fin.
    if (total === 0 && !document.getElementById('vuePepites').hidden) ouvrirPepites();
  });
```

- [ ] **Step 6: Donner le canal au banc**

Dans `outils/faux-app.js`, ajouter `surPepitesAvancement` à la liste des canaux — `test/interface-locale-app.test.js` exige que le shim expose **tous** les canaux de `preload.js`, et sans lui la suite passe au rouge :

```js
    surPepitesAvancement: (cb) => { abonnesAvancement.push(cb); },
```

avec `const abonnesAvancement = [];` près des autres abonnés, et un déclencheur de banc sur le modèle du bouton d'ambiance pour pouvoir voir l'avancement à l'écran.

- [ ] **Step 7: Vérifier**

```bash
node --test test/pepites.test.js test/pepites-marche.test.js test/pepites-classement.test.js test/pepites-panneau.test.js test/pont-ipc.test.js test/interface-locale-app.test.js
npm test
node --check desktop/main.js && node --check desktop/preload.js
```

Attendu : 0 échec hors les trois flakes connus.

- [ ] **Step 8: Commit**

```bash
git add src/pepites/pepites.js desktop/main.js desktop/preload.js desktop/index.html outils/faux-app.js test/
git commit -m "feat(pepites): la passe part a l ouverture d un etal, la minuterie disparait"
```

---

### Task 5: La recette

**Files:** aucun.

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: la validation.

> **Cette tâche revient au contrôleur, pas à un agent d'implémentation.** Elle demande le banc localhost et, pour la seconde moitié, une session de jeu.

- [ ] **Step 1: Le banc**

```bash
npm run banc     # ou OMNI_PORT=8799 node outils/interface-locale.js si le port est pris
```

Vérifier de ses yeux, sur `http://localhost:8787` :

1. le tableau porte des lignes des deux sources, et **elles ne se ressemblent pas** — le marqueur « marché » n'apparaît que sur les lignes tarifées ;
2. l'avancement s'affiche et disparaît ;
3. la recherche répond toujours, et un objet sans prix dit « prix inconnu » ;
4. Échap vide le champ puis ferme.

**Montrer l'écran.** Pas un diff, pas un compte rendu.

- [ ] **Step 2: En jeu**

```powershell
$env:OMNI_DEV = 'C:\Users\Utilisateur\mm'
.\desktop\dist\OMNI-win32-x64\OMNI.exe
```

Se connecter, ouvrir un hôtel de vente ressources, et vérifier :

1. l'avancement monte de 1 à 50 ;
2. les prix affichés changent, et portent le marqueur « marché » ;
3. le classement se réordonne à la fin ;
4. la cadence ne paraît pas trop vive — c'est le jugement qui a corrigé `reprix.js` le 01/09, et lui seul tranche.

Si la cadence gêne, les bornes se règlent dans le panneau de rythme HDV, déjà existant : la passe reprend `favoris.hdvRythme()`.

---

## Auto-relecture du plan

**Couverture de la spec.** Le spike → tâche 1 ; le classement à deux sources et le renommage → tâche 2 ; `marche.js`, ses trois garde-fous, l'absence de boucle de relecture, le prix unitaire déduit → tâche 3 ; la disparition de la minuterie, le câblage sans porte, l'avancement → tâche 4 ; la recette → tâche 5.

**Quatre manques trouvés et corrigés à la relecture :**

1. **`classer()` n'admettait que les gids d'`ivi`.** Or 39 % des objets recyclables n'ont pas de prix moyen : la passe de marché est leur seule source, et les ignorer aurait jeté ce qu'on venait de chercher devant l'étal. L'union des deux tables est explicite à l'étape 4 de la tâche 2.
2. **L'écouteur d'avancement rouvrait le panneau à chaque objet**, soit cinquante rechargements du tableau par passe. Corrigé dans la même étape, avec la raison écrite.
3. **`outils/faux-app.js` aurait fait passer la suite au rouge** en manquant le canal `surPepitesAvancement` — exactement la panne rencontrée sur le plan précédent entre les tâches 6 et 7. L'étape 6 de la tâche 4 la prévient.

4. **Les fixtures de statistiques étaient fabriquées à la main**, et elles étaient fausses : les quatre prix sont un champ **packé** que `quatrePrix()` lit via `f.raw`, ce qu'aucun objet construit de tête ne reproduit. `lireStatsPrix()` aurait rendu `null` en silence et plusieurs tests seraient passés pour la mauvaise raison — la panne exacte rencontrée sur le plan précédent. Les quatre hex du plan ont été **produits puis vérifiés** en les faisant passer par `lireStatsPrix()`, et le fichier de test s'ouvre désormais sur un verrou qui les revérifie.

**Un piège évité par construction :** le renommage de `prixMoyen` en `prix` et la migration de ses quatre consommateurs tiennent dans un seul commit. Les séparer aurait laissé l'arbre rouge entre deux tâches, l'erreur que le plan précédent a payée.
