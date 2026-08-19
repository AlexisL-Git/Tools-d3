# Application de bureau pour piloter le Replicate

**Date :** 2026-08-19
**Statut :** phase 1 conçue et validée, non implémentée. Phases 2 à 4 esquissées.

## Le besoin

Une application lancée par un raccourci, qui montre les comptes du launcher
Ankama, permet d'en marquer certains en favoris et de lancer ceux-là, et porte
un interrupteur Replicate — général, avec une case par compte pour en exclure.
De 1 à 8 clients simultanés.

Le moteur existe déjà : `src/superviseur.js` et le CLI `src/cli/mm.js`,
validés en jeu le 19/08. Cette conception n'ajoute qu'une interface et
l'identification des comptes.

## Objectif final et découpage

L'objectif retenu est le remplacement complet de Zaap : lancer depuis
l'application les comptes mis en favoris, comme le fait krm35. Le projet est
trop gros pour une seule spécification ; il est découpé en quatre phases, dont
chacune est utilisable seule.

| phase | contenu | ce qu'elle apporte |
|---|---|---|
| **1** | app Electron, liste des comptes, favoris, boutons Replicate | utilisable immédiatement, lancement manuel depuis Zaap |
| **2** | service Thrift local (les cinq méthodes que le jeu appelle) | savoir répondre au jeu à la place de Zaap |
| **3** | déchiffrement du `keydata`, authentification Ankama | obtenir un jeton de session par compte |
| **4** | orchestration du lancement | le bouton « lancer mes favoris » |

**Cette spécification couvre la phase 1.** Les phases 2 à 4 auront chacune la
leur.

L'ordre suit ce qu'on sait. La phase 2 est entièrement mesurée : le dialogue
complet a été capturé (voir plus bas). La phase 3 est la seule dont rien n'est
connu. Si elle se révèle être un mur, l'utilisateur dispose quand même d'une
application qui fonctionne et d'un service local complet.

### Exigence de sécurité, valable pour toutes les phases

Les identifiants déchiffrés en phase 3 **ne quittent jamais la mémoire vive** :
jamais écrits sur disque, jamais journalisés, jamais commités, et sans autre
destination réseau que les serveurs d'authentification d'Ankama.

Hors périmètre de la phase 1 : réglages persistants au-delà des favoris et des
cases cochées, thème, fenêtre sans cadre.

## Deux découvertes qui rendent la chose simple

**Les comptes se lisent en clair.** `%APPDATA%\zaap\Settings` est un JSON
contenant `USER_ACCOUNTS` : un tableau d'entrées avec `id`, `login`,
`nickname`, `nicknameWithTag`, `tag`, `avatar`, `isMain`. Aucun mot de passe,
aucun jeton. **Le dossier `keydata`, qui contient les identifiants chiffrés,
n'est jamais lu.**

**Chaque client déclare son compte.** La ligne de commande d'un `Dofus.exe`
porte `-logFile "…\dofus-dofus3\dofus.10612457.log"`, et `10612457` est
exactement le champ `id` d'un compte de `USER_ACCOUNTS` — vérifié. Relier une
fenêtre à un compte ne demande donc ni heuristique ni saisie manuelle.

## Le protocole local de Zaap, mesuré

Acquis pour la phase 2, relevé le 19/08 en écoutant le launcher pendant le
lancement d'un client.

Le service sur `127.0.0.1:26116` est de l'**Apache Thrift, protocole binaire,
transport non encadré** — les messages commencent directement par l'en-tête
`80 01 00 01`, sans préfixe de longueur. Une première sonde avait ajouté ce
préfixe : Zaap lisait alors une longueur d'un milliard et attendait la suite,
sans jamais répondre.

Méthodes du service, lues dans `app.asar` :

```
connect          settings_get / settings_set     userInfo_get
auth_getGameToken     updater_isUpdateAvailable
release_restartOnExit / release_exitAndRepair    zaapVersion_get
```

Séquence que le jeu déroule au démarrage :

```
connect(gameName="dofus", releaseName="dofus3", hash="0ebb4596-…")  →  écho du hash
settings_get(…)
userInfo_get(…)
auth_getGameToken(hash)                                             →  jeton "ee103aff-…"
updater_isUpdateAvailable(…)
```

**Il n'existe aucune méthode « lancer un jeu ».** Le `hash` est fabriqué par
Zaap au moment où il lance un client, puis transmis à celui-ci par `--hash` sur
la ligne de commande. Une application tierce ne peut donc pas obtenir de jeton
en partant de rien : c'est ce qui impose le remplacement complet plutôt qu'un
simple dialogue avec le Zaap existant.

## Architecture

Trois modules purs, plus une coquille Electron. Le moteur existant est réutilisé
tel quel.

| module | rôle | dépend de |
|---|---|---|
| `src/comptes/zaap.js` | lit `USER_ACCOUNTS` du `Settings` de Zaap | rien |
| `src/comptes/clients.js` | énumère les process Dofus, extrait l'id de compte | rien |
| `src/comptes/vue.js` | croise les deux, produit l'état affichable | les deux |
| `desktop/main.js` | possède le `Superviseur`, expose l'IPC | tout |
| `desktop/renderer.html` | la liste et les interrupteurs | l'IPC seul |

Les trois modules `src/comptes/` ne connaissent ni Electron ni Frida : ce sont
des fonctions de données, testables sans jeu ni interface.

### Modification du code existant

Une seule : un drapeau `exclu` par `EtatCompte`, que `Comptes.esclaves()`
filtre. Le reste du superviseur est inchangé.

## Les quatre états d'un compte

```
hors ligne              le compte existe dans Zaap, aucun client ne tourne
en jeu, intercepté      un client tourne et passe par notre proxy
en jeu, NON intercepté  un client tourne mais s'est connecté avant l'app
erreur                  attache impossible, port occupé, agent en échec
```

Le troisième état est le plus important. Un client déjà connecté au serveur de
jeu ne peut pas être récupéré : sa session est établie hors du proxy.
L'interface l'affiche comme tel, avec « relance ce client », au lieu de le
présenter comme normal et de laisser l'utilisateur constater que rien ne suit.

## Flux de données

Toutes les 500 ms, `clients.js` énumère les process et `vue.js` les croise avec
les comptes lus au démarrage. L'état complet part vers le renderer.

Le renderer n'a **aucun** accès au réseau, aux process ni au système de
fichiers. Il reçoit un état et émet deux ordres :

```
basculerReplicate(actif)        arme ou désarme le superviseur
exclureCompte(idCompte, exclu)  coche ou décoche une ligne
marquerFavori(idCompte, favori) étoile ou retire l'étoile
```

Le preload n'expose que ces trois fonctions et l'abonnement à l'état.

## Interface

Une fenêtre, une liste. Les dix comptes sont affichés, y compris hors ligne.

```
┌──────────────────────────────────────────────────────────────┐
│  Replicate  [ ● ACTIF ]                    4 comptes en jeu  │
├──────────────────────────────────────────────────────────────┤
│ ★ ☑  BrokenLegs    Spoony — Pandawa        maître            │
│ ★ ☑  squeezie      Swaggman — Cra          suit              │
│ ☆ ☐  yoplait       Ozamiz — Iop            exclu             │
│ ★ ⚠  HamMed        Lisala — Eni            non intercepté    │
│ ☆    sbwoufeuw     —                       hors ligne        │
└──────────────────────────────────────────────────────────────┘
```

Deux marques par ligne, qui ne servent pas à la même chose :

- **★ favori** — le compte fait partie de ceux à lancer. Sans effet en phase 1,
  où le lancement reste manuel, mais la sélection est enregistrée dès
  maintenant : c'est elle que la phase 4 utilisera.
- **☑ suit** — le compte participe au Replicate. Décoché, il reste en jeu sans
  reproduire les actions du maître.

Le maître se met à jour seul, selon la fenêtre au premier plan — les agents le
signalent déjà. Le nom du personnage vient du titre de la fenêtre.

Les favoris sont conservés entre deux lancements, dans un fichier de réglages
de l'application. Ils ne contiennent que des identifiants de compte, jamais
d'identifiant de connexion.

## Gestion des erreurs

Chaque panne rencontrée le 19/08 devient un état lisible plutôt qu'un silence :

| cause | ce que l'interface montre |
|---|---|
| client connecté avant l'app | « non intercepté — relance ce client » |
| `frida.attach` échoue | « attache impossible » + le message |
| port du proxy occupé | ne peut plus arriver : port 0, attribué par le système |
| esclave ne connaît pas la carte | « fais sortir et revenir ce personnage » |
| `Settings` de Zaap illisible | liste vide + « launcher Ankama introuvable » |

C'est la leçon la plus chère de la journée : trois des quatre pannes
d'intégration se manifestaient par une absence de trafic, indiscernable d'une
absence d'activité.

## Tests

Testés pour de bon, sans jeu ni interface :

- `zaap.js` — lecture d'un `Settings` d'exemple, y compris absent ou corrompu
- `clients.js` — extraction de l'id depuis une ligne de commande réelle, et
  comportement sur une ligne sans `-logFile`
- `vue.js` — les quatre états, un compte sans client, un client sans compte
  connu, huit comptes simultanés
- `Comptes.esclaves()` — l'exclusion retire bien un compte des rejeux
- les favoris — enregistrés, relus au démarrage, et ne contenant que des
  identifiants de compte

La coquille Electron n'est pas testée automatiquement, comme les agents Frida
du dépôt : elle se vérifie en la lançant.

Les 110 tests actuels restent verts.

## Risques connus

- **`electron-builder` échoue sur cette machine** : son archive winCodeSign
  contient des liens symboliques macOS refusés sans le mode développeur
  Windows, et il la ré-extrait à chaque essai. Utiliser `@electron/packager`.
- **`npm install` ne lance pas les postinstall** ici : le binaire Electron peut
  manquer, `node node_modules/electron/install.js` le règle.
- **Le format du `Settings` de Zaap peut changer** à une mise à jour du
  launcher. La lecture doit échouer proprement, pas planter l'application.
