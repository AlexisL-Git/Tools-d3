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

Un bloc en tete du panneau « Quoi de neuf », celui que le numero de version
ouvre deja. Il porte l'etat, les deux empreintes et le bouton, et il est relu a
chaque ouverture du panneau : jamais un etat perime.

Dans la barre de titre, UN SEUL signal : le numero passe au cyan quand le depot
a avance. Pas de texte, pas de bouton. La premiere version les y avait mis et
c'etait illisible : la barre porte deja le nom, l'interrupteur, la version et le
nombre de comptes en jeu. Le detail appartient au panneau, la barre ne garde que
l'alerte.

Hors mode developpement : RIEN. Les deux canaux IPC ne sont pas enregistres, le
bloc reste cache et le numero ne change pas de couleur. La raison est technique et non une
question de discretion : un ami n'a pas le depot, il n'y a rien a comparer chez
lui. Chez Draxus, qui developpe avec `OMNI_DEV` comme tout le monde ici, le
bouton marche a l'identique.

## Trois etats, jamais confondus

| Etat | Ce qu'on sait | Ce qu'on affiche |
|---|---|---|
| `a-jour` | `HEAD` == la reference | « Code a jour » dans le panneau |
| `en-retard` | n commits d'ecart | numero en cyan, et le bloc dans le panneau |
| `inconnu` | git absent, pas un depot, reseau coupe | « Mise a jour non verifiee » + la raison |

Le troisieme n'est JAMAIS rendu comme le premier. C'est exactement la distinction
que `amorceur/canal.js` tient entre `injoignable` et `refuse`, et que
`src/droits/veille.js` tient entre un incident reseau et un 404 : dire « a jour »
quand on ne sait pas, c'est mentir sur le seul fait que l'indicateur existe pour
donner. La raison de l'echec voyage dans `raison` et s'ecrit sous l'etat.

## Le module

`src/dev/maj-git.js`. Ni Electron, ni `fs`, ni reseau en direct : la commande est
injectee, comme `chercher` l'est dans `veille.js`. C'est ce qui le rend testable
sans depot reel et sans connexion.

    etatDepot({ racine, executer })
      -> { etat, retard, locale, distante, branche, propre, reference, raison }

    mettreAJour({ racine, executer })
      -> { etat, relancable, raison }

Les commandes, toutes passees a `execFile` avec un TABLEAU d'arguments, jamais a
un shell :

    git rev-parse --git-dir                    est-ce un depot
    git fetch --quiet                          lecture seule, ne touche pas l'arbre
    git rev-list --count HEAD..<ref>           le retard
    git rev-parse --short HEAD                 le repere local
    git rev-parse --short <ref>                le repere distant
    git status --porcelain                     l'arbre est-il propre
    git merge --ff-only <ref>                  la mise a jour

`@{upstream}` plutot que `origin/master` en dur : la branche de travail change
(`feat/overlay`, `feat/maj-git-dev`), et l'indicateur doit suivre celle sur
laquelle on est, pas une branche supposee. Repli sur `origin/HEAD` quand la
branche n'a pas d'amont : `git checkout -b` n'en pose pas, et sans ce repli
l'indicateur se tairait sur toute branche de travail, c'est-a-dire precisement
quand on developpe.

## Quand ca verifie

Un `git fetch` au lancement, une seule fois, APRES l'ouverture de la fenetre.
Jamais avant : un depot injoignable ne doit pas retarder l'affichage d'une
seconde. Meme regle que la remontee d'etat de l'amorceur, qui ne bloque pas le
chargement.

Le panneau relit l'etat a chaque ouverture, et son bouton reverifie a la demande.

Pas de sondage periodique. Le besoin est de savoir en s'installant, pas a la
minute pres : la veille des droits sonde toutes les 60 s parce qu'un droit
retire doit s'appliquer tout de suite, un commit de retard non.

## Ce que fait le bouton

`git fetch` puis `git merge --ff-only <ref>`, jamais de fusion. Trois issues, et
elles se disent toutes :

- **reussi, `package.json` inchange** : `app.relaunch()` puis `app.exit()`. OMNI
  repart sur le nouveau code, ce qui est le seul moyen de le charger : le code
  versionne est lu au demarrage.
- **reussi, `package.json` a change** : on l'affiche et on NE RELANCE PAS.
  Relancer sans `npm install` donnerait un ecran mort sur un module introuvable,
  exactement la panne du 29/08 qui a fait refuser la 0.2.6 (`Cannot find module
  'frida'`). Le message dit quoi taper.
- **refuse** : le message de git s'affiche dans le bloc du panneau et l'arbre de
  travail n'a pas bouge. `--ff-only` est le garde-fou : devant des commits
  locaux ou une divergence, il refuse au lieu de fusionner.

## Ce qu'on ne fait pas

- **Pas de `npm install` automatique.** Installer des dependances sans que
  personne regarde n'est pas un geste qu'on rattrape d'un clic.
- **Pas de sondage periodique.** Voir plus haut.
- **Aucune ecriture d'histoire.** Ni commit, ni push, ni stash. OMNI lit le
  depot et l'avance en avance rapide, il n'ecrit rien dedans.

## Tests

Dix cas. `src/dev/maj-git.js` se teste sans reseau et sans depot : `executer`
rend ce qu'on veut, comme `chercher` dans `test/droits-veille.test.js`.

1. a jour
2. en retard de n commits
3. le dossier n'est pas un depot
4. git absent de la machine (`ENOENT`)
5. `fetch` en echec reseau : etat `inconnu`, JAMAIS `a-jour`
6. `merge --ff-only` refuse : le message de git remonte tel quel
7. `package.json` touche par le pull : `relancable` vaut `false`
8. le pull ne touche pas les dependances : la relance est autorisee
9. branche locale sans amont : on se compare a la branche par defaut
10. ni amont ni branche par defaut : `inconnu`, jamais `a-jour`

Et une garde cote `desktop/main.js` : sans `OMNI_DEV`, les deux canaux ne sont
pas enregistres. Meme forme que la garde des droits, et pour la meme raison :
une fonction qui n'a rien a faire ici ne doit pas exister ici.

## Ce que ca coute au depot

Cinq fichiers, dont deux neufs :

    src/dev/maj-git.js          le module
    test/dev-maj-git.test.js    les dix cas
    desktop/main.js             deux ipcMain.handle sous garde OMNI_DEV
    desktop/preload.js          deux canaux, documentes comme les quinze autres
    desktop/index.html          le bloc du panneau, et le numero en cyan
