# Savoir, en mode dev, que le depot a bouge

2026-09-02. Conception validee avec l'utilisateur.

## Le manque

En mode developpement, OMNI charge le code du depot tel quel : ni cle demandee,
ni interrogation du service, ni mise a jour. `amorceur/principal.js` sort avant
meme de construire son canal reseau :

    if (process.env.OMNI_DEV) {
      journal(`mode developpement: ${process.env.OMNI_DEV}`);
      chargerDepotLocal(process.env.OMNI_DEV);
      return;                      // creerCanal() est plus bas, jamais atteint
    }

C'est voulu, et ca ne change pas. La contrepartie est qu'il n'existe AUCUN
signal quand `origin/master` a avance : on developpe sur du code en retard sans
le savoir, et on ne s'en apercoit qu'au `git pull` suivant, fait de memoire.

Le mode ami a son canal pour ca : manifeste, paquet, `version_vue`. Le mode dev
n'a rien. C'est ce trou qu'on bouche, et lui seul.

## Ce qu'on ajoute

Un indicateur dans le pied de page, colle au numero de version, la ou on clique
deja pour les notes de version. Un bouton apparait quand il y a du retard.

Hors mode developpement : RIEN. Les deux canaux IPC ne sont pas enregistres, le
pied de page est identique a aujourd'hui. La raison est technique et non une
question de discretion : un ami n'a pas le depot, il n'y a rien a comparer chez
lui. Chez Draxus, qui developpe avec `OMNI_DEV` comme tout le monde ici, le
bouton marche a l'identique.

## Trois etats, jamais confondus

| Etat | Ce qu'on sait | Ce qu'on affiche |
|---|---|---|
| `a-jour` | `HEAD` == `@{upstream}` | `dev · a jour` |
| `en-retard` | n commits d'ecart | `dev · 3 commits de retard` + bouton |
| `inconnu` | git absent, pas un depot, reseau coupe | `dev · maj non verifiee` |

Le troisieme n'est JAMAIS rendu comme le premier. C'est exactement la distinction
que `amorceur/canal.js` tient entre `injoignable` et `refuse`, et que
`src/droits/veille.js` tient entre un incident reseau et un 404 : dire « a jour »
quand on ne sait pas, c'est mentir sur le seul fait que l'indicateur existe pour
donner. La raison de l'echec voyage dans `raison` et se lit en survol.

## Le module

`src/dev/maj-git.js`. Ni Electron, ni `fs`, ni reseau en direct : la commande est
injectee, comme `chercher` l'est dans `veille.js`. C'est ce qui le rend testable
sans depot reel et sans connexion.

    etatDepot({ racine, executer })
      -> { etat, retard, locale, distante, branche, propre, raison }

    mettreAJour({ racine, executer })
      -> { etat, relancable, raison }

Les commandes, toutes passees a `execFile` avec un TABLEAU d'arguments, jamais a
un shell :

    git rev-parse --git-dir                    est-ce un depot
    git fetch --quiet                          lecture seule, ne touche pas l'arbre
    git rev-list --count HEAD..@{upstream}     le retard
    git rev-parse --short HEAD                 le repere local
    git rev-parse --short @{upstream}          le repere distant
    git status --porcelain                     l'arbre est-il propre
    git pull --ff-only                         la mise a jour

`@{upstream}` plutot que `origin/master` en dur : la branche de travail change
(`feat/overlay`, `feat/maj-git-dev`), et l'indicateur doit suivre celle sur
laquelle on est, pas une branche supposee.

## Quand ca verifie

Un `git fetch` au lancement, une seule fois, APRES l'ouverture de la fenetre.
Jamais avant : un depot injoignable ne doit pas retarder l'affichage d'une
seconde. Meme regle que la remontee d'etat de l'amorceur, qui ne bloque pas le
chargement.

Un clic sur l'indicateur relance la verification.

Pas de sondage periodique. Le besoin est de savoir en s'installant, pas a la
minute pres : la veille des droits sonde toutes les 60 s parce qu'un droit
retire doit s'appliquer tout de suite, un commit de retard non.

## Ce que fait le bouton

`git pull --ff-only`, jamais de merge. Trois issues, et elles se disent toutes :

- **reussi, `package.json` inchange** : `app.relaunch()` puis `app.exit()`. OMNI
  repart sur le nouveau code, ce qui est le seul moyen de le charger : le code
  versionne est lu au demarrage.
- **reussi, `package.json` a change** : on l'affiche et on NE RELANCE PAS.
  Relancer sans `npm install` donnerait un ecran mort sur un module introuvable,
  exactement la panne du 29/08 qui a fait refuser la 0.2.6 (`Cannot find module
  'frida'`). Le message dit quoi taper.
- **refuse** : le message de git s'affiche dans le pied de page et l'arbre de
  travail n'a pas bouge. `--ff-only` est le garde-fou : devant des commits
  locaux ou une divergence, il refuse au lieu de fusionner.

## Ce qu'on ne fait pas

- **Pas de `npm install` automatique.** Installer des dependances sans que
  personne regarde n'est pas un geste qu'on rattrape d'un clic.
- **Pas de sondage periodique.** Voir plus haut.
- **Aucune ecriture d'histoire.** Ni commit, ni push, ni stash. OMNI lit le
  depot et l'avance en avance rapide, il n'ecrit rien dedans.

## Tests

`src/dev/maj-git.js` se teste sans reseau et sans depot : `executer` rend ce
qu'on veut, comme `chercher` dans `test/droits-veille.test.js`.

1. a jour
2. en retard de n commits
3. le dossier n'est pas un depot
4. git absent de la machine (`ENOENT`)
5. `fetch` en echec reseau : etat `inconnu`, JAMAIS `a-jour`
6. `pull --ff-only` refuse : le message de git remonte tel quel
7. `package.json` touche par le pull : `relancable` vaut `false`

Et une garde cote `desktop/main.js` : sans `OMNI_DEV`, les deux canaux ne sont
pas enregistres. Meme forme que la garde des droits, et pour la meme raison :
une fonction qui n'a rien a faire ici ne doit pas exister ici.

## Ce que ca coute au depot

Cinq fichiers, dont deux neufs :

    src/dev/maj-git.js          le module
    test/dev-maj-git.test.js    les sept cas
    desktop/main.js             deux ipcMain.handle sous garde OMNI_DEV
    desktop/preload.js          deux canaux, documentes comme les quinze autres
    desktop/index.html          l'indicateur et le bouton dans le pied de page
