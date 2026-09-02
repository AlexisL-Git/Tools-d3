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
ouvre deja. Il porte l'etat, la branche, les deux empreintes et la commande a
taper, et il est relu a chaque ouverture du panneau : jamais un etat perime.

Dans la barre de titre, UN SEUL signal : le numero passe au cyan quand le depot
a avance. Pas de texte, pas de bouton. La premiere version les y avait mis et
c'etait illisible : la barre porte deja le nom, l'interrupteur, la version et le
nombre de comptes en jeu. Le detail appartient au panneau, la barre ne garde que
l'alerte.

Hors mode developpement : RIEN. Le canal IPC n'est pas enregistre, le
bloc reste cache et le numero ne change pas de couleur. La raison est technique et non une
question de discretion : un ami n'a pas le depot, il n'y a rien a comparer chez
lui. Chez Draxus, qui developpe avec `OMNI_DEV` comme tout le monde ici, le
bloc marche a l'identique.

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

Les commandes, toutes passees a `execFile` avec un TABLEAU d'arguments, jamais a
un shell :

    git rev-parse --git-dir                    est-ce un depot
    git fetch --quiet                          lecture seule, ne touche pas l'arbre
    git rev-list --count HEAD..<ref>           le retard
    git rev-parse --short HEAD                 le repere local
    git rev-parse --short <ref>                le repere distant
    git status --porcelain                     l'arbre est-il propre

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

Le panneau relit l'etat a chaque ouverture. Fermer et rouvrir, c'est reverifier.

Pas de sondage periodique. Le besoin est de savoir en s'installant, pas a la
minute pres : la veille des droits sonde toutes les 60 s parce qu'un droit
retire doit s'appliquer tout de suite, un commit de retard non.

## Pas de bouton de mise a jour

Il a existe, le 2026-09-02, et il est parti le jour meme a la premiere
utilisation reelle. `merge --ff-only` refuse des que le dossier de travail
touche un fichier qui arrive, ce qui est le cas ORDINAIRE en developpement : on
a toujours quelque chose en cours. Le clic ne rendait donc qu'un pave d'erreur
git en anglais, et la premiere lecture qu'on en fait est « ca a plante ».

Dire ou on en est a de la valeur. Agir a la place de qui developpe n'en avait
pas. Le bloc affiche donc le retard, l'etat du dossier de travail, et la
commande a taper -- dans un terminal, ou git peut expliquer ce qui bloque a
quelqu'un qui peut le lire.

## Ce qu'on ne fait pas

- **Pas de sondage periodique.** Voir plus haut.
- **Aucune ecriture d'histoire.** Ni commit, ni push, ni stash, ni avance
  rapide. Ce module LIT le depot, un point c'est tout.

## Tests

Sept cas. `src/dev/maj-git.js` se teste sans reseau et sans depot : `executer`
rend ce qu'on veut, comme `chercher` dans `test/droits-veille.test.js`.

1. a jour
2. en retard de n commits
3. le dossier n'est pas un depot
4. git absent de la machine (`ENOENT`)
5. `fetch` en echec reseau : etat `inconnu`, JAMAIS `a-jour`
6. branche locale sans amont : on se compare a la branche par defaut
7. ni amont ni branche par defaut : `inconnu`, jamais `a-jour`

Et une garde cote `desktop/main.js` : sans `OMNI_DEV`, le canal n'est
pas enregistre. Meme forme que la garde des droits, et pour la meme raison :
une fonction qui n'a rien a faire ici ne doit pas exister ici.

## Ce que ca coute au depot

Cinq fichiers, dont deux neufs :

    src/dev/maj-git.js          le module
    test/dev-maj-git.test.js    les sept cas
    desktop/main.js             un ipcMain.handle sous garde OMNI_DEV
    desktop/preload.js          un canal, documente comme les quinze autres
    desktop/index.html          le bloc du panneau, et le numero en cyan
