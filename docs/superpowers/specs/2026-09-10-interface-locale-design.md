# Interface locale sur localhost — conception

L'interface d'OMNI, servie sur `http://localhost:8787`, ouverte dans un onglet
Simple Browser de VS Code, demarree toute seule a chaque ouverture du projet.
Elle tourne sur un **faux etat**: ni Dofus, ni Frida, ni Electron. On clique,
elle repond.

## Pourquoi

Aujourd'hui, voir un changement de `desktop/index.html` demande de lancer le
binaire package (`OMNI.exe` avec `OMNI_DEV`), donc d'avoir les clients Dofus
ouverts pour que les lignes ne soient pas vides. Travailler la mise en page ou
l'ambiance coute une manipulation complete a chaque essai. Servir la page sur
un port local avec des comptes fictifs ramene ce cout a un `Ctrl+S`.

Ce n'est PAS un mode de fonctionnement d'OMNI. C'est un banc d'essai de
l'interface, et rien du code de production n'est modifie pour lui.

## Ce qui existe deja et qu'on reutilise

- **`src/comptes/vue.js`.** `construireVue()` est une fonction pure — ni
  fichier, ni process, ni reseau — qui croise comptes et clients pour produire
  le tableau `lignes`. C'est elle qui fabriquera le faux etat: la forme des
  lignes ne peut donc pas deriver de la vraie.
- **`src/pda-archi/tableau.js`.** `construire({ quoi, comptes })`, pure elle
  aussi, rend le tableau des archimonstres. Le canal `tableauArchi` du banc
  passe par elle.
- **`desktop/preload.js`.** La liste exhaustive des canaux, avec la note en
  tete qui rappelle qu'un canal manquant se voit comme un bouton qui « ne fait
  rien ». C'est le contrat que le faux `window.app` doit honorer, nom pour nom.
- **`desktop/devlog.json`.** Les notes de version, lues telles quelles.

## Les pieces

### 1. Le serveur — `outils/interface-locale.js`

Un `http.createServer` sans aucune dependance. Racine: `desktop/`.

- `GET /` sert `desktop/index.html` **avec une balise injectee** juste avant le
  premier `<script>` de la page (ligne 1062 aujourd'hui, retrouvee par
  recherche et non par numero):

  ```html
  <script src="/faux-app.js"></script>
  ```

  L'injection se fait a la volee, en memoire. `desktop/index.html` n'est jamais
  reecrit.

- `GET /polices/*.woff2`, `GET /sons/ping.ogg` et le reste du dossier sont
  servis avec leur type MIME. Tout chemin qui, une fois resolu, sort de
  `desktop/` est refuse en 403 — le serveur ecoute sur `127.0.0.1`, mais la
  regle ne coute rien et evite d'y revenir.

- `GET /faux-app.js` sert le shim (piece 3) tel quel, en fichier statique.
  L'etat initial ne voyage pas avec lui: il est serialise dans la balise
  injectee sur `/`, sous `window.__FAUX_ETAT__`, pour que le shim le trouve
  **de facon synchrone** — la page appelle `surEtat` des son analyse, et un
  aller-retour reseau arriverait trop tard.

- `GET /faux/tableau-archi?quoi=...` appelle le vrai
  `src/pda-archi/tableau.js` sur les comptes fictifs et rend son JSON. Le
  navigateur ne peut pas charger un module CommonJS: c'est Node qui calcule,
  la page qui affiche.

- `GET /faux/devlog` rend `desktop/devlog.json`.

- `GET /faux/rechargement` est un flux `text/event-stream` (piece 4).

Le port est `8787`, surchargeable par `OMNI_PORT`. Si le port est pris, le
serveur le dit en clair et sort — pas de saut silencieux vers un autre port,
sinon l'onglet Simple Browser pointe dans le vide sans qu'on comprenne
pourquoi.

### 2. Le faux etat — `outils/faux-etat.js`

Un seul fichier, ecrit pour etre lu et bidouille. Il exporte
`fabriquerEtat()`, qui rend exactement ce que `desktop/main.js` envoie sur le
canal `etat` (ligne 812).

Six comptes fictifs plus un client orphelin, couvrant **les six etats** que
`vue.js` sait produire, parce que ce sont eux qui font vivre la page:

| compte    | etat             | ce qu'il montre |
|-----------|------------------|-----------------|
| Iop       | `intercepte`     | maitre, pilotable, cases actives |
| Cra       | `intercepte`     | mule ordinaire, archi lus |
| Eniripsa  | `en-attente`     | l'attache faite, aucune trame encore |
| Sacrieur  | `non-intercepte` | client lance avant OMNI |
| Feca      | `erreur`         | avec son `message` d'echec d'attache |
| Osamodas  | `hors-ligne`     | le compte existe, aucun client |
| —         | `inconnu`        | un client sans `idCompte`, ajoute en fin de liste |

Les champs que `main.js` pose autour de `construireVue()` sont fournis avec
des valeurs plausibles: `version: 'dev'`, `sansMaitre: false`, `erreurComptes`,
`delai`, `hdvRythme`, `hdvGarde`, `hdvBornes` (repris de `src/hdv/*`),
`avisBascule: null`, `overlayOuvert: false`, `pdaArchi`, `pdaArchiRepli`, et
`droits` = **tous les noms de `src/droits/liste.js`**, pour que rien ne soit
grise sur le banc.

`embleme` vaut `null` partout: la page retombe alors sur l'abreviation de
classe, chemin qu'elle sait deja prendre, et le banc n'a rien a telecharger.

### 3. Le shim — le faux `window.app`

Servi en `/faux-app.js`, il pose `window.app` avec **tous les canaux de
`preload.js`, nom pour nom**. Trois familles:

- **Les trois `sur*`** (`surEtat`, `surAmbiance`, `surPdaArchiAlerte`) gardent
  le rappel. `surEtat` est appele une premiere fois au chargement avec l'etat
  initial. `surAmbiance` est declenche par un bouton discret pose en bas de
  page par le shim, pour entendre `ping.ogg` a la demande plutot que d'attendre
  une minuterie.

- **Les ordres** (`basculerPasseTourCompte`, `definirMaitre`, `exclureCompte`,
  `basculerColonne`, `reglerDelai`, `reglerTouche`, `majPrixHdv`…) mutent
  l'etat garde en memoire dans la page, puis rappellent `surEtat` avec le
  nouvel etat. C'est ce qui rend le banc **interactif**: la case cochee reste
  cochee, le maitre change de ligne, le losange du titre de colonne suit ses
  cinq cases. Le shim ne rejoue aucune regle metier — il applique le champ
  demande, rien de plus.

- **Les lectures** (`tableauArchi`, `devlog`, `etatMajGit`) passent par `fetch`
  vers les routes `/faux/*`. `etatMajGit` rend un objet « a jour » fabrique sur
  place: c'est le seul canal dont l'absence est deja prevue par la page.

Tout appel a un canal que le shim ne connait pas est **journalise en console**
avec son nom et ses arguments, plutot que d'echouer en silence. C'est le filet
contre le piege decrit en tete de `preload.js`: un canal ajoute a la page sans
etre ajoute ici se verrait immediatement.

`fenetreFermer` et `fenetreReduire` ne font rien — un onglet n'a pas de cadre.

### 4. Le rechargement automatique

`fs.watch` sur `desktop/index.html` et `outils/faux-etat.js`. A chaque
changement, le serveur pousse un evenement sur `/faux/rechargement`; le shim,
abonne par `EventSource`, fait `location.reload()`. Debounce de 100 ms, parce
qu'un enregistrement d'editeur declenche souvent deux evenements.

Sans ca, le Simple Browser demande un clic droit puis « Reload » a chaque
essai, et c'est exactement le frottement qu'on cherche a supprimer.

### 5. VS Code — `.vscode/tasks.json`

```jsonc
{
  "version": "2.0.0",
  "tasks": [{
    "label": "OMNI — interface locale",
    "type": "shell",
    "command": "node outils/interface-locale.js",
    "isBackground": true,
    "runOptions": { "runOn": "folderOpen" },
    "presentation": { "panel": "dedicated", "reveal": "silent" }
  }]
}
```

Deux choses a savoir, et elles ne sont pas des defauts a corriger:

- **VS Code demande une fois l'autorisation** des taches automatiques du
  dossier (« Allow Automatic Tasks in Folder »). Tant qu'elle n'est pas
  accordee, rien ne demarre. C'est un garde-fou de VS Code, pas un reglage
  qu'on peut poser dans le depot.
- **L'onglet Simple Browser s'ouvre a la main la premiere fois**
  (`Ctrl+Shift+P`, puis « Simple Browser: Show », puis
  `http://localhost:8787`). VS Code restaure ensuite cet onglet a chaque
  reouverture du dossier. Aucune tache ne peut ouvrir cet onglet elle-meme:
  les taches lancent des processus, elles n'appellent pas de commandes de
  l'editeur.

`.vscode/` entre dans le depot. Il n'y a qu'une machine de developpement, et le
fichier decrit le projet, pas la personne.

## Ce qui n'est PAS fait

- **Aucun etat reel.** Le banc ne parle pas a un OMNI qui tourne. Vouloir cela
  demanderait un pont HTTP dans `desktop/main.js`, donc elargir un fichier de
  2300 lignes qui porte la frontiere de confiance. Ecarte.
- **Aucune regle metier rejouee.** Cocher « passe-tour » sur le banc coche une
  case; ca n'exerce pas `src/passe-tour.js`. Le banc sert le visuel et le
  comportement de la page, pas la logique du produit — celle-ci a ses tests.
- **L'overlay (`desktop/overlay.html`) n'est pas servi.** Il a son propre
  preload, plus etroit, et son propre etat reduit. Ajoutable plus tard sur le
  meme patron si le besoin vient.
- **Rien n'entre dans le paquet.** `outils/` n'est pas emporte par
  `faire-paquet-code.js`, qui prend `desktop/` et `src/`. Le banc ne part pas
  chez les amis.

## Comment on saura que ca marche

1. `node outils/interface-locale.js` imprime son adresse et ne sort pas.
2. `http://localhost:8787` affiche le panneau complet: sept lignes, une par
   etat, emblemes remplaces par les abreviations de classe.
3. Cocher « passe-tour » sur une ligne laisse la case cochee; cliquer le titre
   de la colonne bascule toutes les lignes et le losange change d'aspect.
4. Cliquer une autre ligne en maitre deplace le marqueur de maitre.
5. Ouvrir le tableau des archimonstres affiche des lignes, pas le message
   d'erreur de secours.
6. Modifier une couleur dans `desktop/index.html`, enregistrer: l'onglet se
   recharge seul.
7. La console du navigateur ne montre **aucun** « canal inconnu ».
8. Fermer et rouvrir le dossier dans VS Code: la tache repart, l'onglet
   revient, la page charge.
