# Mettre à jour les prix de ses lots en hôtel de vente

**Date :** 2026-09-01
**Statut :** conception validée, non implémentée.
**Trames :** `2026-09-01-trames-hdv.md`, mesuré le même jour.

## Le besoin

Un compte peut avoir des centaines de lots en vente — 376 sur le compte de
mesure. Chacun se démode : un concurrent passe dessous, et le lot ne part plus.
Les remettre au prix du marché à la main, un par un, est le geste que personne
ne fait.

**Un bouton par ligne de compte.** On clique, le compte parcourt ses lots et
repose chacun un cran sous le meilleur prix du marché. Rien d'automatique, rien
de périodique : c'est un geste, déclenché quand on veut, sur le compte qu'on
veut.

Le personnage doit **déjà être devant l'hôtel de vente** et l'avoir ouvert au
moins une fois dans la session. OMNI ne déplace personne.

## Ce qui rend la fonction possible

Trois trames mesurées, et rien d'autre :

* **`kby`** — nos lots en vente, envoyée à l'ouverture du HDV :
  `{ objet{UID, GID, quantité}, prix, duréeRestante }` par lot. Validée à 376
  éléments contre le compteur affiché en jeu.
* **`kgp.2`** — les quatre prix minimum du marché pour un GID, packés dans
  l'ordre des tailles de lot **1 / 10 / 100 / 1000**. Un `0` signifie « aucun
  concurrent à cette taille ».
* **`kch { 1=UIDduLot, 2=nouveauPrix, 3=quantité }`** — la mise à jour
  elle-même.

Plus une quatrième qui tombe gratuitement :

* **`ivi`** — les 9861 prix moyens du catalogue, livrés au login. Le prix moyen
  d'une ressource est donc connu sans rien demander.

## La règle de prix

`src/hdv/prix.js`, fonction pure, quatre entrées :

```
decider({ marche, nos, taille, moyenUnitaire }) -> prix | null
```

| cas | condition | résultat |
|---|---|---|
| 1 | `marche[taille] > 0` et un de nos lots **du même GID et de cette taille** est déjà à ce prix | `null` |
| 2 | `marche[taille] > 0` | `marche[taille] - 1` |
| 3 | `marche[taille] === 0` et aucune autre taille servie | `null` |
| 4 | `marche[taille] === 0` | `déduit` = prix unitaire du créneau non vide **le plus proche** × taille |
| 5 | cas 4, mais `déduit` hors de `[moyen/2, moyen × 2]` | `null` |

`moyen = moyenUnitaire × taille`, avec `moyenUnitaire` tiré d'`ivi`.

`null` veut dire **ne rien émettre**, jamais « prix zéro ».

### Le piège de l'auto-sous-cotation

C'est la règle la plus importante du fichier, et elle vient d'une mesure, pas
d'une intuition.

`kgp` rend un minimum **sans dire à qui il appartient**, et nos propres lots en
font partie. Mesuré le 01/09 sur la Pierre médicinale :

| geste | `kgp.2` |
|---|---|
| pose d'un lot de 100 à 1222 | [19, 190, **1222**, 18000] |
| retrait de ce lot | [19, 190, **2700**, 18000] |

Après la pose, le minimum en lot de 100 **était notre propre lot**. Un bot qui
sous-cote le minimum sans regarder à qui il est descendrait à 1221 à la passe
suivante, puis 1220, jusqu'à zéro.

Le cas 1 l'empêche. Il coûte parfois un kama — si un concurrent est exactement
à notre prix, on ne sait pas les distinguer et on renonce à le doubler. **C'est
délibéré : renoncer est réversible, brader ne l'est pas.**

### Le créneau vide

`0` n'est pas un prix. On déduit du créneau non vide le plus proche, ramené à
l'unité — les voisins immédiats se ressemblent (19, 19, 27 et 18 kamas l'unité
sur la Pierre médicinale) bien plus que les extrêmes.

La proximité se mesure **en nombre de crans dans l'ordre 1 / 10 / 100 / 1000**,
pas en écart de quantité. **À distance égale, on prend le plus petit** : un
créneau de petite taille est plus liquide, donc son prix unitaire est mieux
établi. Le prix déduit est arrondi à l'entier inférieur, et vaut au minimum 1.

Et on refuse la déduction
si elle s'écarte de plus de 100 % du prix moyen, **dans les deux sens** :
au-dessus le lot ne part pas, en dessous on brûle la marchandise.

## Architecture

Trois modules, dont deux sans aucune dépendance.

| module | nature | rôle |
|---|---|---|
| `src/hdv/prix.js` | **pure** | la règle ci-dessus |
| `src/hdv/trames.js` | pure | construit `kch`/`keh`/`kbz`, lit `kgp`/`kbt`/`kes`/`ken`/`kby` |
| `src/hdv/reprix.js` | politique | le séquenceur |

`prix.js` porte la seule décision qui peut coûter des kamas. Il est seul, pur, et
se teste de façon exhaustive sans double ni jeu. Tout le reste est de la
plomberie.

`reprix.js` se compose dans `composer()` comme `creerPasseur` — le superviseur
n'accepte qu'un `onTrame`, et on n'y touche pas.

**Les trames sont VARIABLES.** C'est la rupture avec tout ce qu'OMNI émet
aujourd'hui : `TRAME_PASSE`, `TRAME_ACCEPTATION` et `TRAME_VALIDATION` sont
figées une fois pour toutes. Ici chaque `kch` porte un UID, un prix et une
quantité différents, donc `trames.js` construit à chaque coup.

## Le séquenceur

Il a **deux rôles distincts**, et c'est ce qui règle le problème de `kby`.

### 1. Une écoute permanente

Active en continu, même quand aucune passe ne tourne. Elle mémorise par pid la
dernière `kby` reçue.

**Sans elle la fonction serait impossible :** `kby` n'arrive qu'à l'ouverture du
HDV. Un séquenceur qui ne se réveillerait qu'au clic aurait déjà raté la seule
trame qui dit ce qu'on vend.

### 2. Une passe

Déclenchée par le bouton. La fabrique rend donc `{ onTrame, lancer(pid),
arreter(pid) }` — un point d'entrée de plus que `creerPasseur`, imposé par le
fait qu'un bouton n'est pas une trame.

```
repos      ──(bouton)──> prepare      groupe les lots mémorisés par GID
prepare    ───────────-> abonne       keh{GID,2=1} puis kbz{GID}
abonne     ──(kbt)────-> decide       les 4 prix arrivent
decide     ───────────-> emet         prix.decider() sur le premier lot
emet       ──(kgp)────-> emet         RELIT les prix, puis le lot suivant
emet       ──(fini)───-> desabonne    keh{GID}, sans champ 2
desabonne  ───────────-> abonne       GID suivant, ou fin
```

**La boucle `emet ──(kgp)──> emet` n'est pas un détail.** Chaque `kch` fait
pousser un `kgp` par le serveur, avec notre nouveau prix dedans. Traiter dix
lots du même GID sur une seule lecture du marché ferait décider les neuf
suivants sur des chiffres périmés — et se sous-coter eux-mêmes. **Un lot par
`kgp`.**

**Les UID se renouvellent.** Une mise à jour est un retrait suivi d'une repose :
le serveur répond `ken` avec l'ancien UID et `kes` avec un UID neuf. Le
séquenceur met donc à jour sa liste au fil de la passe, et ne peut pas la
garder d'une passe à l'autre.

**On se désabonne.** Tant qu'on est abonné à un GID, le serveur pousse un `kgp`
à chaque mouvement du marché. Un `keh { 1=GID }` sans champ 2 ferme le flux.

### Trois garde-fous, tous repris de `passeur.js`

| garde | raison |
|---|---|
| rythme des émissions, **900 à 2600 ms, plus une pause de 2 à 7 s tous les 20 à 30 lots** | voir ci-dessous |
| délai maximal par étape | si `kbt` n'arrive jamais, la passe doit s'arrêter et le dire, pas rester pendue |
| comparaison d'**identité** de l'état de compte, pas du pid | `passeur.js:120` : Windows recycle les pid, un client relancé pendant la passe ne doit pas hériter de la passe du précédent |

### Le rythme, corrigé après le premier essai en jeu

La première version reprenait les 150 à 600 ms de `DELAI_REACTION`. **C'était un
mauvais emprunt**, et l'essai du 01/09 l'a montré tout de suite — « ça met en
vente un peu trop vite ».

`DELAI_REACTION` chiffre une *réaction* : une fenêtre s'ouvre, on la voit, on
vise, on clique. Reprendre un prix est autre chose — lire le marché, décider,
saisir un nombre, valider. À 375 ms de moyenne, la passe tenait **2,5 lots par
seconde** pendant plusieurs minutes d'affilée.

**Élargir l'intervalle ne suffit pas.** Un tirage uniforme, même lent, produit
une cadence d'une régularité qu'aucune main ne tient : la moyenne ne dévie
jamais, et c'est cette stabilité même qui se remarque sur trois cents envois.
Le rythme mêle donc deux choses :

* un intervalle large entre chaque lot — **900 à 2600 ms** ;
* une **pause franche de 2 à 7 secondes tous les 20 à 30 lots**, comme
  quelqu'un qui lève les yeux, vérifie autre chose et revient.

`rythme()` est une fonction pure : le hasard entre par argument, donc les deux
bornes et le réarmement du compteur se testent sans piloter d'horloge.

### Le passage d'un objet au suivant se rythme aussi

Deuxième correction, née d'une question posée après le premier essai : *« si
quelqu'un baisse juste après, ça va pas le remodifier ? »*. En y répondant on
découvre que **seuls les `kch` étaient rythmés**.

Le passage d'un objet au suivant ne l'était pas du tout : désabonnement,
abonnement et demande de statistiques partaient d'affilée, puis on enchaînait
dès la réponse. Sur une passe où rien n'a besoin d'être changé — **le cas le
plus fréquent dès le second passage** — cela donnait 108 objets × 3 trames en
quelques secondes. Le motif même qu'on venait de corriger sur les `kch`, et
sous cette forme plus visible encore, puisque rien ne le ralentissait.

Le geste est plus court — choisir un objet dans une liste et lire ses prix, pas
saisir un nombre et valider — d'où **400 à 1400 ms**, sous le délai des `kch`.
Pendant l'attente, `passe.gid` vaut `null` : les `kbt` et `kgp` qui traînent
encore sont ignorés, ce qui est exactement voulu puisqu'ils portent sur l'objet
qu'on vient de quitter.

### Ce que ça coûte

Sur le compte de mesure, 376 lots répartis en 108 objets :

| cas | durée |
|---|---|
| tous les lots repricés | ~14 min |
| 40 lots repricés | ~3 min |
| rien à changer | **~1,7 min** |

Un lot où l'on est déjà le moins cher ne déclenche aucun envoi, donc aucun
délai : seul le parcours des objets subsiste. **Une seconde passe est donc
courte**, et c'est elle qui rattrape les concurrents passés dessous entre-temps.

## Un lot n'est visité qu'une fois par passe

Une fois un lot traité il ne revient pas dans la file, et un objet terminé est
désabonné — on cesse alors de recevoir ses `kgp`. Un concurrent qui sous-cote
après notre passage ne sera donc pas rattrapé **dans cette passe**.

Nuance : tant qu'on est encore *sur* un objet, chaque `kgp` poussé met à jour le
tableau des prix, donc une baisse concurrente profite aux lots **suivants** du
même objet. Ce sont seulement ceux déjà traités qui ne sont pas revus.

Rattraper le marché en continu demanderait une passe périodique, explicitement
écartée. Relancer la passe est le geste prévu, et il est bon marché.

## L'IHM

**Un bouton HDV par ligne de compte, qui déroule deux entrées :**

| entrée | état |
|---|---|
| **Mettre à jour les prix** | la fonction de cette spec |
| **Mettre en vente** | présente, mais elle répond qu'elle n'existe pas encore |

Les deux figurent dès le départ. « Mettre en vente » ne reste pas muette : elle
dit *pourquoi* elle n'agit pas — l'inventaire ne transite sur aucun canal, la
fonction attend sa propre mesure. C'est la règle que le jalon de la barre du bas
a déjà posée (`6529513`) : **un bouton muet est une promesse fausse.** Un menu
qui cache l'entrée absente serait pire encore, parce qu'on ne saurait même pas
qu'elle est prévue.

« Mettre à jour les prix » est **désactivée tant qu'aucune `kby` n'est mémorisée
pour ce compte**, avec la raison affichée : *« ouvre le HDV une fois pour que je
voie tes lots »*. Le mécanisme existe déjà — la carte `messages` de `main.js`.

Pendant la passe, la ligne affiche l'avancement (`47 / 376 lots`). À la fin, le
compte rendu distingue trois nombres : **remis à jour**, **laissés parce qu'on
était déjà le moins cher**, **échoués**.

### Le jalon de la barre du bas disparaît

Le bouton HDV global posé par `6529513` est un jalon assumé, et il devient
redondant : il ne peut pas désigner « le compte de la ligne », qui est
précisément la cible retenue. Il est retiré en même temps que le menu de ligne
arrive — avec son `ipcMain.handle('avisHdv')`, son entrée de `preload.js` et son
écouteur de `index.html`.

## Ce qui peut mal tourner

| échec | réaction |
|---|---|
| pas de `kby` mémorisée | bouton désactivé, raison affichée |
| `kbt` n'arrive pas dans le délai | on abandonne **ce GID**, pas la passe, et on le journalise |
| le client disparaît en cours de passe | garde d'identité, arrêt net |
| `superviseur.emettre` refuse — pas de socket amont | arrêt, message sur la ligne |
| un `kch` sans `kes` ni `ken` dans le délai | compté comme échec, journalisé, on passe au suivant |

**Un `kch` refusé par le serveur n'a jamais été observé.** On ne sait pas s'il
répond quelque chose ou rien. Le traiter par l'absence de confirmation est le
seul choix sûr tant que ce n'est pas mesuré, et le premier essai en jeu le dira.

**Le plafond de lots n'est pas en cause ici** : une mise à jour retire et repose
un lot qui existait déjà, elle n'en crée pas.

## Tests

* **`prix.js`** — exhaustif, sans double : les cinq cas du tableau, plus le
  piège de l'auto-sous-cotation avec les chiffres réellement mesurés
  (`[19, 190, 1222, 18000]` et notre lot à 1222 → `null`).
* **`trames.js`** — un `kch` construit doit reproduire **exactement** les octets
  de la spec de mesure, comme `echange.test.js` fige `TRAME_ACCEPTATION`. Idem
  pour la lecture : la `kgp` mesurée doit rendre `[19, 190, 1222, 18000]`, et la
  `kby` mesurée ses 376 éléments.
* **`reprix.js`** — nourri de trames avec un double du superviseur, comme
  `passeur.test.js`. Cas à verrouiller : deux lots du même GID ne doivent
  **jamais** être décidés sur la même lecture de `kgp` ; un client qui disparaît
  arrête la passe ; un `kbt` absent n'abandonne que son GID.

## Ordre de réalisation

1. `prix.js` et ses tests — la règle avant tout le reste, elle ne dépend de rien.
2. `trames.js` et ses tests, figés sur les octets mesurés.
3. `reprix.js`, écoute permanente d'abord (mémoriser `kby`), passe ensuite.
4. Le câblage `main.js`, le menu de ligne et ses deux entrées, puis le retrait
   du jalon global de `6529513`.
5. ~~Retrait de l'instrumentation temporaire.~~ **Écarté à l'implémentation.**
   Le dumpeur d'octets de `main.js`, `outils/lancer-mesure-hdv.vbs` et les deux
   journaux de silence de `superviseur.js` sont **gardés** :

   * les deux journaux de silence ne sont pas de l'instrumentation, ce sont des
     corrections. Une trame rejetée par `decodeFrameRaw` et une connexion hors
     du port 5555 ne laissaient **aucune trace** — deux angles morts qui ont
     chacun coûté une session de mesure ce jour-là. Les retirer les rétablirait ;
   * le dumpeur et son lanceur sont exactement ce dont le spike de la mise en
     vente aura besoin, et ils ne coûtent rien : chacun a son propre
     interrupteur, et aucun lanceur ordinaire ne les pose.

   Les commentaires « TEMPORAIRE / à retirer » ont été réécrits en conséquence :
   les laisser aurait été pire que les deux options.

## Ce qui est écarté

* **« Mettre en vente ».** `kge` est mesurée et comprise, mais elle exige un UID
  de pile d'inventaire, et l'inventaire ne transite sur aucun canal — prouvé sur
  54 666 trames. Fonction remise à plus tard, avec son propre spike. **Son
  entrée de menu existe pourtant dès maintenant**, et répond ce qu'elle est : ne
  pas l'afficher cacherait qu'elle est prévue.
* **Toute périodicité.** Pas de minuterie, pas de passe de fond. Un bouton.
* **Plusieurs comptes à la fois.** Une passe, un compte, celui de la ligne.
* **Un prix plancher par ressource** (le `minimalPrice` de krm35). Le garde-fou
  à 100 % du prix moyen couvre déjà le bradage par extrapolation ; un plancher
  saisi à la main est un réglage à remplir avant le premier usage.
* **Les autres catégories d'HDV.** Ressources seulement. `khd { 3=11 }` porte
  vraisemblablement le type, mais une seule valeur a été observée.
* **La liste d'objets cochés de krm35.** Tous nos lots, sans configuration.
