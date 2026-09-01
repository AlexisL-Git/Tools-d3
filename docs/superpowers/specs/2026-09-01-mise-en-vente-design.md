# Mettre en vente en hôtel de vente

**Date :** 2026-09-01
**Statut :** conception validée, non implémentée.
**Trames :** `2026-09-01-trames-mise-en-vente.md`, mesuré le même jour.
**Complète :** `2026-09-01-maj-prix-hdv-design.md`, dont cette fonction est le
pendant — l'une pose, l'autre repose.

## Le besoin

Un compte accumule du stock qu'il ne vend jamais, faute de temps : 829 piles de
ressources sur le compte de mesure, dont 814 en banque. Les mettre en vente à la
main, pile par pile et lot par lot, est un geste que personne ne fait deux fois.

**Un bouton par ligne de compte.** On clique, le compte parcourt son stock et
pose des lots au prix du marché, **en commençant par les plus gros lots en
valeur**, jusqu'à ce que l'hôtel de vente refuse — plus de place, ou plus de
kamas pour la taxe de dépôt.

Le personnage doit **déjà être devant l'hôtel de vente** et avoir ouvert son
panneau de vente au moins une fois dans la session. OMNI ne déplace personne.

## Ce qui rend la fonction possible

Quatre trames mesurées.

* **`itr { 2=<rangements>, 3=1 }` → `ivx`** — la liste des piles, une par
  élément, `{GID, quantité, UIDpile}`. Rangement 2 = banque, 3 = inventaire.
  **Le client l'émet lui-même en ouvrant le panneau de vente**, ce qui suffit :
  OMNI n'a rien à demander.
* **`kgp.2`** — les quatre prix minimum du marché pour un GID, packés dans
  l'ordre des tailles **1 / 10 / 100 / 1000**. Un `0` signifie « aucun
  concurrent à cette taille ».
* **`kge { 1=prixDuLot, 2=UIDpile, 3=quantité }`** — la mise en vente. Elle
  accepte une pile de banque comme une pile d'inventaire, sans retrait
  préalable. Prouvé par deux ventes réelles, une de chaque origine.
* **`ivj` et `ium`** — la confirmation. `ivj` quand la pile est entamée et rend
  sa quantité restante, `ium` quand elle est vidée.

Plus **`ivi`**, les 9861 prix moyens du catalogue, livrés au login.

## Le stock : ce qu'on retient, ce qu'on écarte

`ivx` mélange tout ce que le panneau de vente affiche. On n'en garde que le
vendable en hôtel de vente **ressources**, et le tri se fait sur un signal
présent dans la trame : **le champ `5.2`, les lignes de caractéristiques**.

| | piles | avec `5.2` | quantité médiane |
|---|---:|---:|---:|
| banque | 814 | **0** | 57 |
| inventaire | 219 | **204** | 1 |

Un objet qui porte des lignes de stats est un **équipement** — pièce unique,
quantité 1, et il relève d'un autre hôtel de vente. Un objet qui n'en porte pas
est une **ressource fongible**. Sur le compte de mesure il reste **829 piles**.

**On ne se sert donc pas d'une table GID → catégorie**, qu'on n'a pas : la
catégorie n'arrive que dans `kbt.1`, un GID à la fois, et interroger 1096 objets
pour savoir lesquels sont vendables serait exactement le flot que le rythme
cherche à éviter.

## Le découpage en lots

Chaque pile est découpée **du plus gros lot au plus petit**, gloutonnement :

```
pile de 286   ->  100, 100, 10, 10, 10, 10, 10, 10, 10, 10, 1, 1, 1, 1, 1, 1
pile de 1660  ->  1000, 100, 100, 100, 100, 100, 100, 10, 10, 10, 10, 10, 10
```

Sur le compte de mesure : **7013 lots candidats**, dont 11 de 1000, 382 de 100,
2999 de 10 et 3621 de 1.

## La règle de prix

`src/hdv/prix.js` porte **deux règles**, et elles restent dans le même fichier :
c'est le seul endroit du projet où une décision coûte des kamas.

`decider()` — reposer un lot existant — **ne change pas**. La fonction « mettre
à jour les prix » est livrée et validée en jeu ; on n'y touche pas.

`deciderPose()` — poser un lot neuf — partage l'extrapolation et diffère sur
deux points :

Les cas sont **ordonnés**, et le premier qui s'applique gagne :

| # | situation | `decider` (reposer) | `deciderPose` (poser) |
|---|---|---|---|
| 1 | minimum ≤ 1 | `null` | `null` |
| 2 | le minimum du créneau est déjà le nôtre | `null`, ne rien émettre | **le même prix**, on s'aligne |
| 3 | minimum > 1, chez un concurrent | minimum − 1 | minimum − 1 |
| 4 | créneau vide, un voisin servi | extrapolation + garde-fou | identique |
| 5 | créneau vide, aucun voisin servi | `null` | **prix moyen × taille** |

**L'ordre des cas 1 et 2 est inversé par rapport au code actuel, et ce n'est pas
cosmétique.** Dans `decider`, les deux rendent `null` : leur ordre est
indifférent, et le fichier teste « est-ce le nôtre » en premier. Dans
`deciderPose`, le cas 2 rend un prix — si notre propre lot est à 1 kama, tester
le cas 2 d'abord nous ferait **poser à 1 kama**. Le garde-fou du cas 1 doit donc
passer avant. `decider` n'est pas modifiée pour autant : on ne touche pas à du
code livré pour une inversion sans effet chez lui.

### Pourquoi on s'aligne au lieu de sous-coter

C'est la différence qui fait exister la fonction. Dès qu'on a posé le premier
lot de 100, **le minimum des 100 est le nôtre**. Le cas 1 de `decider` ferait
sauter tous les lots suivants du paquet, et la fonction poserait un seul lot par
objet et par taille, en silence.

On pose donc au même prix. C'est ce qu'un vendeur fait à la main, ça n'érode
rien, et les lots partent au même tarif. Sous-coter d'un kama à chaque lot
serait l'auto-sous-cotation que `decider` interdit expressément — bornée ici par
la taille de la pile plutôt qu'infinie, mais bornée n'est pas gratuite : une
pile de 1660 en lots de 1 descendrait de 16 crans.

### Pourquoi on extrapole avant de retomber sur le prix moyen

Le voisin immédiat est du **marché vivant** ; le prix moyen d'`ivi` est une
moyenne serveur livrée au login, qui peut avoir vieilli. Sur un créneau de 100
vide avec le créneau de 10 à 122, l'extrapolation donne 1220 et le prix moyen
1200 — l'écart est petit ici, il ne l'est pas sur un objet dont le cours a bougé.

Le garde-fou reste **moyen/2 – moyen×2, dans les deux sens** : au-dessus le lot
ne part pas, en dessous on brûle la marchandise. Il ne sert qu'à refuser une
extrapolation absurde. Si **aucun** créneau n'est servi, il n'y a rien à
extrapoler et on pose au prix moyen plutôt que de ne rien poser.

## L'ordre de la passe

**Par valeur de lot décroissante, sur les 7013 candidats.** La valeur d'un lot
est `prix moyen unitaire × taille`.

Ce n'est pas un ordre de confort : **la passe n'ira jamais au bout.** Le plafond
de lots de l'hôtel de vente l'arrêtera après quelques centaines — le `kby` du
compte de mesure en portait 228. L'ordre ne décide donc pas de la séquence, il
décide de **ce qui sera vendu et ce qui ne le sera pas**.

Mesuré sur le stock réel, à nombre d'emplacements égal :

| emplacements | valeur posée, ordre **valeur** | ordre par objet | rapport |
|---:|---:|---:|---:|
| 100 | 6 136 312 | 2 651 871 | **2,3×** |
| 300 | 8 430 137 | 6 176 515 | **1,4×** |
| 1000 | 11 612 598 | 8 615 860 | 1,3× |

Grouper par objet pour économiser des visites poserait 1,4 à 2,3 fois moins de
valeur, pour douze minutes gagnées sur une passe qui n'ira pas au bout. Le
calcul est sans appel.

Les 300 premiers lots par valeur : 11 lots de 1000, 168 de 100, 107 de 10 et
seulement 14 de 1, répartis sur **154 objets** — environ deux lots par visite.

### Les paquets

Deux lots de même GID **et** de même taille ont la même valeur : le tri les
place côte à côte. Une visite d'objet traite donc naturellement un **paquet** de
lots identiques. Sur le stock de mesure, 7013 lots forment **1655 paquets**, de
taille médiane **4**.

Un objet peut être revisité plus tard pour ses lots plus petits, et on se
réabonne alors. C'est le prix de l'ordre par valeur, et il est payé.

## Architecture

| module | nature | rôle |
|---|---|---|
| `src/hdv/prix.js` | **pure** | `decider` inchangée, `deciderPose` ajoutée |
| `src/hdv/stock.js` | **pure, neuf** | des piles aux lots candidats, triés |
| `src/hdv/trames.js` | pure | construit `kge`, lit `ivx`, `ivj`, `ium` |
| `src/hdv/vente.js` | politique, neuf | le séquenceur |
| `src/hdv/reprix.js` | — | **non touché** |

`stock.js` est le module sans équivalent :

```
candidats({ piles, prixMoyens }) -> [{ uidPile, gid, taille, valeur }]
```

Il écarte les piles à lignes de stats, découpe les quantités, attache la valeur
et trie. Aucune trame, aucun réseau : il se teste sur la fixture et sur des
piles inventées.

`trames.js` gagne `trameMettreEnVente({ prix, uidPile, taille })`,
`lireStock(trame)` pour `ivx`, `lirePileMaj` pour `ivj` et `lirePileDisparue`
pour `ium`. `lireLotPose` existe déjà pour `kes` — **on ne s'en sert pas ici**,
voir plus bas.

### `ivi` est mémorisé deux fois, et c'est délibéré

`reprix.js` mémorise déjà les prix moyens ; `vente.js` les mémorise de son côté.
C'est une trame, une fois par session, une `Map`. Extraire un `catalogue.js`
partagé obligerait à modifier un fichier livré et validé pour zéro gain
fonctionnel. Si un troisième client apparaît, on extraira à ce moment-là.

## Le séquenceur

`vente.js` se compose dans `composer()` comme `creerReprix` et rend
`{ onTrame, lancer(pid), arreter(pid) }` — un bouton n'est pas une trame.

### Une écoute permanente

Active en continu, elle mémorise par pid la dernière `ivx` et les prix moyens
d'`ivi`. Même raison que chez `reprix.js` : `ivx` arrive **quand le joueur ouvre
son panneau de vente**, pas quand il clique sur le bouton. Un module qui ne se
réveillerait qu'au clic aurait déjà raté la trame qui dit ce qu'on possède.

### Une passe

```
repos      ──(bouton)──> prepare      candidats(), tri, groupage en paquets
prepare    ───────────-> abonne       keh{gid,2=1} + kbz{gid}
abonne     ──(kbt)────-> decide       les quatre prix arrivent
decide     ───────────-> rafale       deciderPose() UNE FOIS pour le paquet
rafale     ──(ivj|ium)-> rafale       lot suivant du paquet
rafale     ──(fini)───-> desabonne    keh{gid}, sans champ 2
desabonne  ───────────> abonne        paquet suivant, ou fin
```

### La confirmation n'est PAS `kes`

Le journal de mesure porte **2 `kge` et 102 `kes`**. Les cent autres sont des
reposts de concurrents, reçus parce qu'on est abonné à leur GID — c'est-à-dire
précisément sur les objets qu'on vend.

**La confirmation sûre est `ivj` ou `ium`, sur l'UID de pile qu'on a émis.** Ces
deux trames ne concernent que nos propres piles.

### La liste se corrige sur les réponses, pas sur notre soustraction

Le découpage est fait au départ, mais si `ivj` annonce un reste plus bas que
prévu — le joueur a bougé un objet, ou vendu à la main — **c'est `ivj` qui a
raison**, et on recalcule les lots restants de cette pile. Faire confiance à
notre arithmétique ferait émettre un `kge` sur une quantité qu'on n'a plus.

### Un paquet ne relit pas le marché entre chaque lot

La règle « un lot par `kgp` » de `reprix.js` existe pour empêcher
l'auto-sous-cotation. `deciderPose` **s'aligne** au lieu de sous-coter : à
l'intérieur d'un paquet, tous les lots partent au même prix, donc il n'y a plus
rien à empêcher. On décide une fois, on pose N fois.

On relit le marché en **changeant de taille ou d'objet**, là où la règle garde
tout son sens.

Si un concurrent passe sous notre prix pendant la rafale, nos derniers lots sont
un cran trop haut — et c'est exactement ce que « mettre à jour les prix »
rattrape. Les deux fonctions se complètent au lieu de se dupliquer.

## Le rythme

Trois échelles, et la première vient d'une observation de jeu : poser quatre
lots identiques, c'est **taper Entrée quatre fois**, pas ressaisir un prix
quatre fois.

| entre | délai | geste |
|---|---|---|
| deux lots d'un même paquet | **90–260 ms** | Entrée, Entrée, Entrée |
| deux objets | **900–2600 ms** | chercher, lire, saisir, valider |
| toutes les 20–30 visites | pause de **2–7 s** | lever les yeux |

Les deux dernières valeurs sont reprises telles quelles de `reprix.js`, où elles
ont été **corrigées après essai en jeu** : la première version tenait 150–600 ms
et s'était fait signaler d'un « ça met en vente un peu trop vite ».

**C'est là qu'est le risque de cette fonction.** La rafale fait remonter la
cadence moyenne :

| rythme | 300 lots | tout (7013) |
|---|---|---|
| rafale + objet à 900–2600 ms | 5 min 43 s — **0,88/s** | 69 min — 1,70/s |
| rafale + objet à 400–1400 ms | 3 min 21 s — 1,50/s | 45 min — **2,57/s** |
| sans rafale | 9 min 12 s — 0,54/s | 209 min — 0,56/s |

La deuxième ligne ramène la moyenne à la cadence même qui avait paru trop vive.
**On garde donc le délai d'objet long** : la rafale achète le réalisme du geste,
le changement d'objet le rachète en temps. La signature n'est pas la même qu'un
tir uniforme — quatre lots en une demi-seconde puis deux secondes de rien — mais
la moyenne, elle, se surveille.

`rythme()` et `rythmeRafale()` sont des fonctions pures : le hasard entre par
argument, donc les bornes et le réarmement du compteur se testent sans piloter
d'horloge.

## Ce qui peut mal tourner

| échec | réaction |
|---|---|
| un `kge` sans `ivj` ni `ium` en 4 s | **arrêt de la passe**, motif affiché |
| `kbt` jamais reçu pour un objet | on abandonne **cet objet**, pas la passe |
| pas d'`ivx` mémorisée | bouton désactivé, raison affichée |
| le client disparaît en cours de passe | garde d'**identité d'état de compte**, pas le pid — Windows les recycle |
| `superviseur.emettre` refuse | arrêt, message sur la ligne |
| plus de candidats | fin normale |

**Le premier cas mérite sa justification.** On ne sait distinguer ni « plafond
de lots atteint », ni « plus de kamas pour la taxe », ni un simple hoquet — et
on n'a pas à le faire : les trois demandent la même chose. On s'arrête au
**premier** `kge` non confirmé, pas au deuxième. Se tromper coûte un reclic ;
continuer à tort coûte des centaines d'émissions inutiles dont on ignore l'effet
côté serveur.

**C'est aussi ce qui rend inutile la mesure du plafond et de la taxe**, les deux
inconnues que la mesure a laissées ouvertes. La fonction se conçoit sans elles.

## L'IHM

L'entrée « Mettre en vente » **existe déjà** dans le menu de ligne et répond
qu'elle n'est pas encore réalisée. Elle devient active.

Elle est **désactivée tant qu'aucune `ivx` n'est mémorisée** pour ce compte,
avec la raison affichée : *« ouvre l'hôtel de vente une fois pour que je voie
ton stock »*. Le mécanisme est celui de la carte `messages` de `main.js`, déjà
en place pour « mettre à jour les prix ».

Pendant la passe, la ligne affiche `47 lots posés — objet 12 sur 828`. **Pas de
dénominateur en lots :** 7013 serait un chiffre faux, la passe s'arrêtera bien
avant.

À la fin, quatre nombres et un motif : **posés**, **sautés** (`deciderPose` a
rendu `null`), **échoués**, **objets abandonnés**, et la raison de l'arrêt.

`arreter(pid)` reste disponible — couper une passe en cours est le filet du
premier essai en jeu.

## Tests

* **`prix.js`** — `deciderPose` exhaustive, avec le cas neuf figé sur des
  chiffres mesurés : marché `[19, 190, 1222, 18000]`, notre lot déjà à 1222 →
  **1222**, pas `null`. C'est le test qui distingue les deux règles, et il doit
  échouer si l'on appelle `decider` par erreur. Plus le test d'ordre des cas :
  marché `[1, 0, 0, 0]` avec notre propre lot de 1 déjà à 1 → **`null`**, jamais
  `1`. Sans lui, l'inversion des cas 1 et 2 passe inaperçue.
* **`stock.js`** — sur `test/fixtures/hdv-ivx-inventaire.hex` : 219 piles, 204
  écartées pour lignes de stats, 15 retenues. Plus le découpage, sur des
  quantités choisies : 286 → `100, 100, 10×8, 1×6` ; 1660 → `1000, 100×6,
  10×6` ; 9 → `1×9` ; 0 → rien.
* **`trames.js`** — un `kge` construit doit reproduire **exactement** les octets
  des deux `kge` mesurés, comme `echange.test.js` fige `TRAME_ACCEPTATION`. Et
  `lireStock` doit rendre 814 piles sur `hdv-iwb.hex`, 219 sur
  `hdv-ivx-inventaire.hex`.
* **`vente.js`** — nourri de trames avec un double du superviseur, comme
  `passeur.test.js`. Cas à verrouiller : un paquet de quatre lots ne relit
  **pas** `kgp` entre chaque ; deux paquets de tailles différentes le relisent ;
  un `kge` non confirmé arrête la passe ; un `kbt` absent n'abandonne que son
  objet ; un `ivj` qui contredit notre soustraction fait recalculer la pile.

## Ordre de réalisation

1. `deciderPose` dans `prix.js` et ses tests — la règle avant tout le reste.
2. `stock.js` et ses tests, sur la fixture.
3. `trames.js` : `trameMettreEnVente`, `lireStock`, `lirePileMaj`,
   `lirePileDisparue`, figés sur les octets mesurés.
4. `vente.js`, écoute permanente d'abord (mémoriser `ivx` et `ivi`), passe
   ensuite.
5. Le câblage `main.js` et l'activation de l'entrée de menu existante.

## Ce qui est écarté

* **Les équipements et les autres catégories d'hôtel de vente.** Ressources
  seulement. Le champ `5.2` les sépare sans qu'on ait à demander de catégorie.
* **Toute périodicité.** Pas de minuterie, pas de passe de fond. Un bouton.
* **Plusieurs comptes à la fois.** Une passe, un compte, celui de la ligne.
* **Émettre notre propre `itr`.** Le client l'émet déjà en ouvrant le panneau, et
  les quatre `itr` mesurés l'ont tous été dans ce contexte. Rien ne dit que le
  serveur accepte un `itr` isolé, et rien ne dit qu'il ressemble à quelque chose
  de normal. On n'achèterait que la fraîcheur d'un stock déjà frais.
* **Mesurer le plafond de lots et la taxe de dépôt.** L'arrêt réactif les rend
  inutiles.
* **Un prix plancher par ressource.** Le garde-fou à 100 % du prix moyen couvre
  déjà le bradage par extrapolation.
