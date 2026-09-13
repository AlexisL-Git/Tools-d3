# Le reessai d'ouverture de dialogue — plan d'implementation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quand le serveur refuse l'ouverture d'un dialogue chez une mule
(`imq`), OMNI renvoie le meme clic jusqu'a cinq fois, 800 ms d'ecart, au lieu
d'abandonner au premier refus.

**Architecture:** tout tient dans `src/file-dialogue.js`. Un rang d'essai par
mule (`essais`) et l'etape d'ouverture retenue (`ouverture`); la branche `imq`
de `onTrame()` replanifie l'etape au lieu d'appeler `echec()`. Le reessai
repasse par `emettre()`, ce qui lui fait heriter sans une ligne de plus de
« ouvrir ferme d'abord », du garde-combat et de la relecture des cases cochees.

**Tech Stack:** Node.js sans dependance, `node:test`, horloge et planificateur
injectes (aucun test ne dort).

## Global Constraints

- Spec de reference: `docs/superpowers/specs/2026-09-13-zaapi-reessai-design.md`
- Six essais AU TOTAL (un envoi + cinq reessais), 800 ms d'ecart.
- `src/file-dialogue.js` ne depend ni d'Electron, ni de Frida, ni du reseau.
  Cela ne change pas: tout ce qui est ajoute passe par une dependance injectee.
- Commentaires et messages en francais SANS ACCENTS, comme le reste du fichier.
- Le minuteur de reessai va dans `e.minuteurEtape` — celui que `annulerEnVol()`
  annule deja. Aucune modification de `src/garde-combat.js`.
- La branche de travail est `fix/dialogue-zaapi`.

---

### Task 1: Le rang d'essai et le reessai

**Files:**
- Modify: `src/file-dialogue.js` (constantes en tete, `etatDe`, `echec`,
  `emettre`, `annulerEnVol`, branche `TYPE_REFUS_OUVERTURE` de `onTrame`)
- Test: `test/file-dialogue.test.js`

**Interfaces:**
- Consomme: rien d'autre que ce que le fichier a deja.
- Produit: deux constantes exportees, `ESSAIS_OUVERTURE = 6` et
  `DELAI_REESSAI_MS = 800`, que les tests importent. `emettre(pid, etape,
  estReessai = false)` — troisieme argument interne au module, non exporte.

- [ ] **Step 1: Ajouter le helper de refus dans le fichier de test**

Juste sous `const ferme = () => ...` (vers la ligne 55) :

```js
const refus = () => ({ kind: 'event', type: 'imq', payload: [] });
```

Et completer l'import en tete du fichier de test :

```js
const {
  creerFileDialogue, TRAME_FERMETURE, TYPE_QUESTION, CHAMP_QUESTION,
  ESSAIS_OUVERTURE, DELAI_REESSAI_MS,
} = require('../src/file-dialogue');
```

- [ ] **Step 2: Ecrire le premier test qui echoue**

A la fin de `test/file-dialogue.test.js` :

```js
// LE REFUS N'EST PAS UNE FIN. Mesure du 13/09, journal-bug-0909.log, mule 9276
// et zaapi -20004: la MEME trame `imp`, refusee a 115267 ms et acceptee a
// 122324 ms — identiques octet pour octet. Seule la position avait change: la
// mule marchait (`jpt` a 119740 et 121356 ms).
test('un refus fait repartir la meme ouverture 800 ms plus tard', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  const premier = sup.emis.filter((e) => e.octets[0] === 0x11).length;
  assert.strictEqual(premier, 1, 'le premier clic est parti');

  file.onTrame({ pid: 2, dir: 'in', frame: refus() });
  h.avancer(DELAI_REESSAI_MS - 1);
  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x11).length, premier,
    'rien ne repart avant le delai',
  );

  h.avancer(1);
  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x11).length, premier + 1,
    'le MEME clic repart, pas un autre',
  );
});
```

- [ ] **Step 3: Lancer le test et verifier qu'il echoue**

Run: `node --test test/file-dialogue.test.js`
Expected: FAIL — `ESSAIS_OUVERTURE` et `DELAI_REESSAI_MS` sont `undefined`,
donc `h.avancer(DELAI_REESSAI_MS - 1)` avance de `NaN` et le compte reste a 1
au lieu de 2 sur la derniere assertion.

- [ ] **Step 4: Ajouter les deux constantes**

Dans `src/file-dialogue.js`, juste apres `DELAI_ATTENTE_MS` (vers la ligne 71) :

```js
// LE REESSAI D'OUVERTURE. Mesure du 13/09 (journal-bug-0909.log, mule 9276,
// zaapi -20004): la MEME trame `imp` est refusee a 115267 ms et acceptee a
// 122324 ms, identique octet pour octet. Entre les deux, la mule a marche
// (`jpt` a 119740 et 121356 ms). Le refus porte donc sur une POSITION, pas sur
// le contenu de la trame — meme condition que celle qui a ecarte `jpp` et
// `jrh` le 28/08.
//
// On renvoie le meme clic, et c'est le suivi de groupe DU JEU qui amene la
// mule a portee. OMNI ne fabrique aucun deplacement: l'utilisateur a ecarte
// cette piste le 03/09, et de nouveau le 13/09.
//
// SIX ESSAIS AU TOTAL, donc cinq reessais: 4 s, plus le delai humain du
// premier envoi. Au-dela, une mule qui n'est pas arrivee est bloquee ailleurs,
// et insister n'y changerait rien.
const ESSAIS_OUVERTURE = 6;
const DELAI_REESSAI_MS = 800;
```

Et les exporter, en completant le `module.exports` en bas du fichier :

```js
module.exports = {
  creerFileDialogue, DELAI_ETAPE, DELAI_ATTENTE_MS, TRAME_FERMETURE,
  ESSAIS_OUVERTURE, DELAI_REESSAI_MS,
  TYPE_OUVERTURE, TYPE_REPONSE, TYPE_FERMETURE,
  TYPE_QUESTION, TYPE_REFUS_OUVERTURE, TYPE_FERME, CHAMP_QUESTION,
};
```

- [ ] **Step 5: Ajouter les deux champs d'etat**

Dans `etatDe()`, completer l'objet cree :

```js
      e = {
        etapes: [], enVol: false, attend: null, minuteur: null,
        minuteurEtape: null, question: null, ouvert: false, notre: false,
        ouverture: null, essais: 0,
      };
```

- [ ] **Step 6: Retenir l'etape d'ouverture et son rang dans `emettre()`**

Changer la signature :

```js
  function emettre(pid, etape, estReessai = false) {
```

Puis, juste apres la ligne
`if (etape.type === TYPE_OUVERTURE && e.ouvert) fermer(pid, e, true);`
et AVANT l'appel a `superviseur.emettre(...)` :

```js
    // LE RANG DE L'ESSAI, remis a 1 pour une ouverture NEUVE seulement. Un
    // reessai repasse par ici: sans `estReessai`, le compteur repartirait de 1
    // a chaque tour et la mule insisterait sans fin.
    if (etape.type === TYPE_OUVERTURE) {
      e.ouverture = etape;
      if (!estReessai) e.essais = 1;
    }
```

- [ ] **Step 7: Remplacer l'abandon par le reessai dans la branche `imq`**

Remplacer :

```js
    if (frame.type === TYPE_REFUS_OUVERTURE) {
      echec(pid, 'la mule n a pas pu ouvrir le dialogue');
      return;
    }
```

par :

```js
    if (frame.type === TYPE_REFUS_OUVERTURE) {
      // ON RENVOIE LE MEME CLIC. Voir ESSAIS_OUVERTURE en tete: le refus porte
      // sur la position de la mule, pas sur la trame.
      //
      // Le reessai repasse par emettre(), donc par « ouvrir ferme d'abord »:
      // il couvre du meme coup l'AUTRE sens de `imq` — un dialogue qui traine,
      // mesure le 09/09 — sans avoir a distinguer les deux causes, ce que
      // `imq {}` ne permet pas: il est vide.
      if (e.attend !== null && e.attend.type === TYPE_OUVERTURE
          && e.ouverture !== null && e.essais < ESSAIS_OUVERTURE) {
        const aRenvoyer = e.ouverture;
        e.essais += 1;
        leverAttente(e);
        // OCCUPEE jusqu'a l'echeance: sans ca, avancer() tirerait l'etape
        // suivante entre deux essais et la reponse partirait avant la question.
        e.enVol = true;
        e.minuteurEtape = planifier(
          () => emettre(pid, aRenvoyer, true), DELAI_REESSAI_MS,
        );
        return;
      }
      echec(pid, `la mule n a pas pu ouvrir le dialogue (${e.essais} essai(s), trop loin ?)`);
      return;
    }
```

- [ ] **Step 8: Lancer le test et verifier qu'il passe**

Run: `node --test test/file-dialogue.test.js`
Expected: le nouveau test PASSE. **Le test existant `imq: la mule n a pas pu
ouvrir, on vide la file` (ligne 135) ECHOUE**, et c'est attendu : il n'envoie
qu'un seul refus et attend l'abandon immediat. Il est reecrit a la Task 2.

- [ ] **Step 9: Remettre le compteur a zero aux trois sorties**

Trois endroits, pour qu'un reessai ne survive pas a ce qui l'annule.

Dans `echec()`, apres `leverAttente(e);` :

```js
    e.ouverture = null;
    e.essais = 0;
```

Dans la branche `TYPE_QUESTION` de `onTrame()`, juste apres `e.question = valeur;` :

```js
      // La question est arrivee: plus rien a reessayer.
      e.ouverture = null;
      e.essais = 0;
```

Dans `annulerEnVol()`, a l'interieur de la boucle, apres `e.etapes.length = 0;` :

```js
      // CE QUI N'EST PAS PARTI NE PARTIRA PAS, le reessai compris: sans ces
      // deux lignes, le minuteur annule laisserait une ouverture prete a
      // repartir au refus suivant.
      e.ouverture = null;
      e.essais = 0;
```

- [ ] **Step 10: Ecrire le test « la question arrete les reessais »**

```js
// LA QUESTION ARRETE TOUT. Au troisieme essai le panneau s'ouvre: la file doit
// avancer normalement et ne plus jamais renvoyer le clic.
test('la question recue en cours de reessai arrete les reessais', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(DELAI_PLANCHER_MS);

  file.onTrame({ pid: 2, dir: 'in', frame: refus() });
  h.avancer(DELAI_REESSAI_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: refus() });
  h.avancer(DELAI_REESSAI_MS);
  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x11).length, 3,
    'trois clics: l envoi et deux reessais',
  );

  // Le panneau s'ouvre.
  file.onTrame({ pid: 2, dir: 'in', frame: question(47058) });
  h.avancer(10000);

  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x11).length, 3,
    'plus aucun clic apres la question',
  );
  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x22).length, 1,
    'et la file a repris sa marche: la reponse est partie',
  );
});
```

- [ ] **Step 11: Lancer et verifier que ce test passe**

Run: `node --test test/file-dialogue.test.js`
Expected: PASS pour ce test (l'ancien test `imq` echoue toujours, cf. Step 8).

- [ ] **Step 12: Commit**

```bash
git add src/file-dialogue.js test/file-dialogue.test.js
git commit -m "feat(dialogue): un refus d ouverture fait renvoyer le meme clic"
```

---

### Task 2: L'abandon compte ses essais, et le reessai obeit au garde

**Files:**
- Modify: `test/file-dialogue.test.js` (reecrit le test de la ligne 135, en
  ajoute trois)
- Test: `test/file-dialogue.test.js`

**Interfaces:**
- Consomme: `ESSAIS_OUVERTURE`, `DELAI_REESSAI_MS` et le helper `refus()` de la
  Task 1.
- Produit: rien de nouveau. Ces tests prouvent que le reessai n'a contourne
  aucune securite existante.

- [ ] **Step 1: Reecrire le test de la ligne 135**

Remplacer entierement le test `imq: la mule n a pas pu ouvrir, on vide la file`
par celui-ci — meme intention, au nouveau compte :

```js
// SIX REFUS, PUIS L'ABANDON. Le compte rendu porte le nombre d'essais: un
// abandon muet au premier refus est ce qui a fait perdre une soiree le 13/09.
test('imq: apres six essais on vide la file, et on dit combien', () => {
  const sup = faux([2]);
  const h = horloge();
  const rendus = [];
  const file = creer(sup, h, (r) => rendus.push(r));

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(DELAI_PLANCHER_MS);

  for (let i = 0; i < ESSAIS_OUVERTURE; i += 1) {
    file.onTrame({ pid: 2, dir: 'in', frame: refus() });
    h.avancer(DELAI_REESSAI_MS);
  }
  h.avancer(10000);

  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x11).length, ESSAIS_OUVERTURE,
    'six clics en tout, pas un septieme',
  );
  assert.deepStrictEqual(
    rendus.map((r) => r.raison),
    ['la mule n a pas pu ouvrir le dialogue (6 essai(s), trop loin ?)'],
    'un seul compte rendu, et il dit le nombre',
  );
  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x22).length, 0,
    'la reponse ne part pas: la file est videe',
  );
});
```

- [ ] **Step 2: Lancer et verifier que tout le fichier passe**

Run: `node --test test/file-dialogue.test.js`
Expected: PASS partout, 0 echec.

- [ ] **Step 3: Ecrire les trois tests de securite**

```js
// LE GARDE-COMBAT ANNULE UN REESSAI EN ATTENTE. Le minuteur du reessai est
// range dans `minuteurEtape`, celui que le garde annule deja: si ce n'etait
// pas le cas, la mule rejouerait son clic APRES l'entree en combat du maitre.
test('le garde annule un reessai en attente', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: refus() });

  const avant = sup.emis.filter((e) => e.octets[0] === 0x11).length;
  assert.strictEqual(file.annulerEnVol(1), 1, 'le reessai compte pour une annulation');
  h.avancer(10000);

  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x11).length, avant,
    'le clic ne repart pas',
  );
});

// UNE MULE DECOCHEE PENDANT LES REESSAIS N'EST PLUS FRAPPEE. La case est relue
// A L'ECHEANCE, pas a l'empilage — meme garde que pour une etape ordinaire.
test('une mule decochee pendant les reessais ne recoit plus rien', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: refus() });

  const avant = sup.emis.length;
  sup.etats.get(2).exclu = true;
  h.avancer(10000);

  assert.strictEqual(sup.emis.length, avant, 'plus une seule ecriture');
});

// LE REESSAI REFAIT « OUVRIR FERME D'ABORD ». C'est ce qui lui fait couvrir
// l'autre sens de `imq` — un dialogue qui traine (mesure du 09/09) — sans
// avoir a distinguer les deux causes du refus.
test('le reessai fait place nette avant de renvoyer le clic', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  const base = fermetures(sup).length;

  // Le serveur refuse: la file croit sa fenetre ouverte (demander vaut ouvrir).
  file.onTrame({ pid: 2, dir: 'in', frame: refus() });
  h.avancer(DELAI_REESSAI_MS);

  assert.strictEqual(fermetures(sup).length, base + 1, 'une fermeture avant le second clic');
  const premier = sup.emis.findIndex((e) => e.octets[0] === 0x11);
  const dernier = sup.emis.map((e) => e.octets[0]).lastIndexOf(0x11);
  const fermeture = sup.emis.findIndex(
    (e) => e.octets.toString('hex') === TRAME_FERMETURE.toString('hex'),
  );
  assert.ok(
    premier < fermeture && fermeture < dernier,
    'la fermeture tombe ENTRE les deux clics',
  );
});
```

- [ ] **Step 4: Lancer les trois tests**

Run: `node --test test/file-dialogue.test.js`
Expected: PASS. **Ces trois-la peuvent passer du premier coup, et c'est le
but** : ils prouvent que la Task 1 n'a contourne aucune securite. Si l'un
echoue, c'est un vrai defaut du reessai — a corriger dans
`src/file-dialogue.js`, jamais dans le test.

- [ ] **Step 5: Commit**

```bash
git add test/file-dialogue.test.js
git commit -m "test(dialogue): l abandon compte ses essais, le reessai obeit au garde"
```

---

### Task 3: La ligne de journal perdue

**Files:**
- Modify: `src/file-dialogue.js` (parametre injecte `onJournal`, appele dans
  `emettre()`)
- Modify: `desktop/main.js:1471-1477` (le branchement de `creerFileDialogue`)
- Test: `test/file-dialogue.test.js`

**Interfaces:**
- Consomme: `ESSAIS_OUVERTURE` (Task 1) pour le rang affiche.
- Produit: `creerFileDialogue({ ..., onJournal })`, ou `onJournal` est
  `(pid, ligne) => void`, par defaut `() => {}`. Lignes ecrites :
  `rejeu imp ecrit (essai 2/6)` pour une ouverture,
  `rejeu inh ecrit` pour les autres types,
  `rejeu imp refuse : <raison>` si la socket refuse l'ecriture.

- [ ] **Step 1: Ecrire le test qui echoue**

```js
// LA LIGNE QUI MANQUAIT AU JOURNAL. Le 09/09, la spec de la file montrait
// encore « 1059598 [8328] rejeu imp ecrit (+358 ms) ». Dans la session du
// 13/09, AUCUN `rejeu` pour imp, inh ou kiy: la file emet par
// superviseur.emettre(), qui ne journalise pas — contrairement a rejouer().
// C'est ce trou qui a coute le diagnostic du zaapi.
test('la file ecrit au journal ce qu elle rejoue, et le rang de l essai', () => {
  const sup = faux([2]);
  const h = horloge();
  const lignes = [];
  const file = creerFileDialogue({
    superviseur: sup, alea: () => 0, planifier: h.planifier,
    annuler: h.annuler, maintenant: h.maintenant,
    onJournal: (pid, ligne) => lignes.push([pid, ligne]),
  });

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  assert.deepStrictEqual(lignes, [[2, 'rejeu imp ecrit (essai 1/6)']]);

  file.onTrame({ pid: 2, dir: 'in', frame: refus() });
  h.avancer(DELAI_REESSAI_MS);
  assert.deepStrictEqual(lignes[1], [2, 'rejeu imp ecrit (essai 2/6)']);

  // Une reponse ne porte pas de rang: il n'y a rien a reessayer derriere elle.
  file.onTrame({ pid: 2, dir: 'in', frame: question(47058) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(DELAI_PLANCHER_MS);
  assert.deepStrictEqual(lignes.at(-1), [2, 'rejeu inh ecrit']);
});
```

- [ ] **Step 2: Lancer et verifier l'echec**

Run: `node --test test/file-dialogue.test.js`
Expected: FAIL — `lignes` est vide, le premier `deepStrictEqual` echoue.

- [ ] **Step 3: Ajouter le parametre et l'appel**

Dans la signature de `creerFileDialogue`, ajouter `onJournal` :

```js
function creerFileDialogue({
  superviseur, onCompteRendu = () => {}, onJournal = () => {}, delai = DELAI_ETAPE,
  alea = Math.random, planifier = setTimeout, annuler = clearTimeout,
  maintenant = () => Date.now(),
}) {
```

Dans `emettre()`, remplacer la ligne `superviseur.emettre(pid, etape.brute);` par :

```js
    const rendu = superviseur.emettre(pid, etape.brute);

    // LA LIGNE QUI MANQUAIT. La file ecrit par superviseur.emettre(), qui ne
    // journalise pas — contrairement a rejouer(). Le 09/09 on lisait encore
    // « rejeu imp ecrit (+358 ms) » dans le journal; le 13/09 plus rien pour
    // imp, inh ni kiy, et ce trou a coute une soiree de diagnostic: on ne
    // voyait pas si le clic partait. La capture ne les voit pas non plus —
    // une trame injectee est ecrite sur la socket amont sans repasser par le
    // reassembleur.
    const rang = etape.type === TYPE_OUVERTURE
      ? ` (essai ${e.essais}/${ESSAIS_OUVERTURE})` : '';
    if (rendu !== null && rendu !== undefined && rendu.ok === false) {
      onJournal(pid, `rejeu ${etape.type} refuse : ${rendu.raison}`);
    } else onJournal(pid, `rejeu ${etape.type} ecrit${rang}`);
```

- [ ] **Step 4: Lancer et verifier que tout passe**

Run: `node --test test/file-dialogue.test.js`
Expected: PASS, 0 echec.

- [ ] **Step 5: Brancher le journal dans desktop/main.js**

A `desktop/main.js:1471`, completer l'appel :

```js
  const fileDialogue = creerFileDialogue({
    superviseur,
    // Chaque rejeu se date, comme ceux de superviseur.rejouer(). Sous
    // OMNI_JOURNAL=complet seulement, comme tout ce que journal() ecrit.
    onJournal: (pid, ligne) => journal(pid, ligne),
    onCompteRendu: ({ pid, raison }) => {
      journal(pid, `dialogue : ${raison}`);
      messages.set(pid, `dialogue : ${raison}`);
    },
  });
```

- [ ] **Step 6: Lancer la suite complete**

Run: `npm test`
Expected: `fail 0`. Le compte de tests passe d'environ 1533 a 1539 (six
nouveaux, un reecrit).

- [ ] **Step 7: Commit**

```bash
git add src/file-dialogue.js test/file-dialogue.test.js desktop/main.js
git commit -m "feat(dialogue): la file date ses rejeux au journal, avec le rang de l essai"
```

---

### Task 4: La recette en jeu

**Files:** aucun. C'est une mesure, pas du code.

**Interfaces:**
- Consomme: les trois taches precedentes, sur `fix/dialogue-zaapi`.

- [ ] **Step 1: Verifier que le mode mesure charge bien le code modifie**

Run: `grep -n "OMNI_DEV\|omni_project" "C:/Users/Utilisateur/Desktop/OMNI-mesure.bat"`
Expected: le .bat charge `F:\omni_project\desktop\main.js` — donc la recette
porte sur les fichiers modifies, pas sur la version installee.

- [ ] **Step 2: Sauvegarder le journal precedent**

Le .bat remet `journal-bug-0909.log` a zero a chaque lancement. Copier l'ancien
AVANT de lancer, sinon les preuves du 13/09 sont perdues :

```bash
cp /f/omni_project/journal-bug-0909.log /f/omni_project/journal-bug-0909.sauv-0913-reessai.log
```

- [ ] **Step 3: Le test, avec la mule LOIN du zaapi**

Demander a l'utilisateur de lancer `OMNI-mesure.bat`, puis :

1. **mule volontairement loin** du zaapi, puis cliquer le zaapi sur le maitre.
   Attendu: le panneau des destinations s'ouvre AUSSI chez la mule, dans les
   5 s, pendant qu'elle arrive.
2. **choisir une destination** sur le maitre. Attendu: la mule voyage avec lui.
3. **parler a un PNJ a la main sur une mule**, plusieurs fois de suite.
   Attendu: la fenetre ne se referme plus toute seule (le correctif du 13/09
   au soir, deja dans cette branche).

- [ ] **Step 4: Lire le journal et compter les essais**

```bash
grep -nE "rejeu imp|dialogue :" /f/omni_project/journal-bug-0909.log | tail -30
```

Attendu: des lignes `rejeu imp ecrit (essai 2/6)`, puis un `inn` et un `imw`
dans la capture pour la mule. Si on lit `la mule n a pas pu ouvrir le dialogue
(6 essai(s), trop loin ?)`, c'est que 5 s n'ont pas suffi — le rapporter a
l'utilisateur AVANT de changer le reglage : le nombre d'essais est son choix.

- [ ] **Step 5: Pousser la branche**

```bash
git push -u origin fix/dialogue-zaapi
```

---

## Ce qui n'est PAS dans ce plan

Les deux correctifs du 13/09 au soir — le garde-combat rendu a la file, et la
fenetre qui se refermait sur un dialogue ouvert a la main — sont deja dans
l'arbre de travail de cette branche, non committes, et testes (1511 tests,
0 echec). Ils attendent la recette en jeu de la Task 4. Leur commit est une
decision de l'utilisateur, pas une etape de ce plan.
