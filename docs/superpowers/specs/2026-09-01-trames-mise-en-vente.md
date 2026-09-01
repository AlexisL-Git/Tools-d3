# Les trames de la mise en vente

**Date de mesure :** 2026-09-01, seconde session du jour, un seul client
derrière notre proxy.
**Fait suite à :** `2026-09-01-trames-hdv.md`, dont elle lève la conclusion
bloquante.

Mesuré avec `outils/lancer-mesure-hdv.vbs`, qui pose `OMNI_CAPTURE=1`,
`OMNI_CAPTURE_OCTETS=1` et la borne de dump à 262 144. **Aucune trame de cette
session n'est tronquée**, ce qui n'était pas le cas de la première mesure.

Tous les décodages ont été vérifiés avec `decodeFrameRaw` du dépôt.

## Les conditions de la mesure

| | |
|---|---|
| pid | 6756 |
| journal | `journal-hdv.log`, session `2026-09-01T14:04:03Z` |
| borne du dump | 262144 — jamais atteinte, la plus grosse trame fait 89 774 o |
| gestes | poser au sol, ramasser, déposer en banque, reprendre, puis deux mises en vente |

La mesure s'est faite à quatre mains : l'utilisateur joue et décrit ses gestes,
la lecture se fait dans le journal.

## Le résultat : le stock vendable, c'est la banque

La première mesure concluait que « mettre en vente » n'avait pas de source de
stock, parce que `kge` exige un UID de pile et que l'inventaire ne transite sur
aucun canal.

**L'inventaire ne transite toujours pas** — revérifié ici sur une capture non
tronquée, avec un UID obtenu dans la session même. Mais la conclusion qu'on en
tirait était trop large : **le contenu de la banque, lui, transite en entier**,
et `kge` accepte une pile de banque directement.

La première mesure notait qu'afficher la banque depuis l'HDV ne produit rien, et
en déduisait que le client la détenait déjà. C'était exact ; ce qui manquait,
c'est **quand** il l'a reçue. Il l'a reçue en ouvrant la banque chez le
banquier, bien avant d'arriver à l'HDV. La mesure regardait le bon endroit au
mauvais moment.

## La séquence

```
out request iov { 1=3  2=<idPNJ>  3=-20000 }         parler au banquier
in  event   ios { 1=48375  2={1=64367 …}  3="814" }  ses options, ET LE PRIX
out request ioy { 1=64367 }                          payer et ouvrir
in  event   kld { 1=1 }                              accusé
in  event   iwb { 1={…} × 814 }                      LE CONTENU DE LA BANQUE

out request kge { 1=prixDuLot  2=UIDpile  3=quantité }         METTRE EN VENTE
in  event   kes { 1={UIDlot,GID,quantité}  2=prix  4=2419200 } le lot posé
in  event   ivj { 3={2=UIDpile  3=quantitéRestante} }          pile entamée
in  event   ium { 1=UIDpile }                                  OU pile vidée
```

## `iwb` — le contenu de la banque

**C'est la trame qui débloque la fonction.** 13 704 octets, émise une fois, à
l'ouverture de la banque.

```
in event iwb { 1={1=63 5={1=2628 3=171 4=84495874}} × 814 }
```

| champ | contenu |
|---|---|
| 1 | un élément par pile, répété |
| 1.1 | **63**, constant sur les 814 éléments — rôle non déterminé |
| 1.5.1 | le **GID** |
| 1.5.3 | la **quantité** de la pile |
| 1.5.4 | l'**UID de la pile** — exactement ce qu'attend `kge` |

Figée dans `test/fixtures/hdv-iwb.hex`.

**Validée contre le jeu :** 814 éléments décodés, 814 objets uniques annoncés
par l'interface. Même contrôle que les 376 lots de `kby`.

Sur le compte de mesure : 814 piles, **814 GID distincts** — la banque fusionne
tout par type d'objet, il n'y a jamais deux piles du même objet. 81 688 unités
au total, médiane 57, maximum 1660.

La distribution décide de ce qui est vendable, puisque `kge` ne pose que des
lots de 1, 10, 100 ou 1000 :

| taille de lot | piles capables |
|---|---|
| 1 | 814 (100 %) |
| 10 | 709 (87 %) |
| 100 | 217 (27 %) |
| 1000 | 11 (1 %) |

**Le lot de 1000 est marginal.** Le terrain réel est le lot de 10, puis le lot
de 100.

## `kge` — mettre en vente, et il accepte les deux origines

La première mesure avait établi la forme de `kge`. Ce qu'elle n'avait pas
mesuré, c'est **d'où** la pile pouvait venir. Deux ventes le tranchent.

### Depuis l'inventaire

```
out request kge { 1=2699  2=84571671  3=100 }
    122e0a210a13747970652e616e6b616d612e636f6d2f6b6765
    120a088b151097eca928186410ffffffffffffffffff01

in  event kes { 1={1=1886584 3=13731 4=100}  2=2699  4=2419200 }
in  event ivj { 2={1=186 2=1}  3={2=84571671  3=186} }
```

La pile passe de 286 à 186. **Son UID ne change pas** — `ivj` rend le même
`84571671`.

### Depuis la banque

```
out request kge { 1=29  2=84496683  3=1 }
    122d0a200a13747970652e616e6b616d612e636f6d2f6b6765
    1209081d10aba2a528180110ffffffffffffffffff01

in  event kes { 1={1=1886653 3=8437 4=1}  2=29  4=2419200 }
in  event ium { 1=84496683 }
```

`84496683` **est un UID de `iwb`**, qui l'annonçait comme `{GID 8437,
quantité 1}` — et le `kes` rend exactement ce GID et cette quantité. La pile ne
contenait qu'un exemplaire : elle est vidée, donc elle disparaît, et c'est `ium`
qui le dit.

**Conséquence : aucun retrait préalable n'est nécessaire.** La chaîne
`kcz` → `itf` → `kge`, qu'on gardait en secours, ne sert pas.

## La confirmation d'une vente n'est PAS `kes`

C'est le piège de cette fonction, et il est mesuré.

Le journal contient **2 `kge`** — les nôtres — et **102 `kes`**. Les cent autres
viennent des reposts d'autres vendeurs, reçus parce qu'on était abonné à leur
GID. Ils arrivent par paires `ken` puis `kes`, la forme d'une mise à jour
de prix décrite dans la première mesure.

Un séquenceur qui prendrait le prochain `kes` venu pour la confirmation de son
propre `kge` se tromperait dès qu'un concurrent bouge — c'est-à-dire tout le
temps, puisque c'est précisément sur les objets qu'on veut vendre qu'on est
abonné.

**La confirmation sûre est `ivj` ou `ium`, sur l'UID de pile qu'on a émis.** Ces
deux trames ne concernent que nos propres piles. Les deux ventes l'ont montré,
une chacune : `ivj` quand la pile est entamée, `ium` quand elle est vidée.

## Les UID de pile : alloués au login, renouvelés à chaque mouvement

Les 814 UID de banque forment un bloc **parfaitement contigu**,
`84495874`…`84496687` — 814 valeurs pour 814 piles, sans trou. Et la pile
d'inventaire manipulée pendant les gestes portait `84495873`, **exactement un en
dessous**.

L'espace d'UID est donc alloué d'un bloc au login, l'inventaire d'abord, la
banque ensuite.

**Il ne faut pas s'en servir.** Déduire un UID d'inventaire par soustraction
mettrait en vente un objet qu'on n'a pas choisi, et un `kge` parti ne se
rattrape pas.

**Chaque mouvement renouvelle l'UID.** Une seule pile, quatre gestes :

| geste | UID |
|---|---|
| au login, en inventaire | 84495873 |
| posée au sol puis ramassée | 84563497 |
| déposée en banque | 84569749 |
| reprise en inventaire | 84571671 |

Les UID de la session du matin (`64867218`, `64867220`) sont **introuvables**
dans cette session. Rien ne se met en cache d'une fois sur l'autre.

**En revanche ils sont stables tant que rien ne bouge.** La banque a été ouverte
deux fois, à 65 s et à 188 s : 814 piles des deux côtés, **814/814 identiques**,
mêmes UID et mêmes quantités.

## Ouvrir la banque coûte des kamas

Le prix est dans le dialogue, en clair :

```
in event ios { 1=48375  2={1=64367 3={1=196}}  2={1=64368}  3="814" }
                                                            └── 1a03 383134
```

`ios.3` est une **chaîne**, `"814"` — et 814 est le nombre de piles. La taxe
d'ouverture vaut le nombre de piles en banque.

**Conséquence directe : `iwb` ne se redemande pas.** On la lit une fois, à
l'ouverture que le joueur fait lui-même, et on tient la liste à jour au fil des
`ivj` et des `ium`, qui sont gratuits. Une fonction qui rouvrirait la banque
pour rafraîchir son stock facturerait le joueur à chaque passe.

## Les gestes d'inventaire, mesurés au passage

Ils ne servent pas à la mise en vente depuis la banque, mais ils sont mesurés et
ils donnent le vocabulaire des mouvements de piles.

```
out request iur { 1={2=UIDpile  3=quantité} }        poser au sol
in  event   ium { 1=UIDpile }                        la pile quitte l'inventaire
in  event   itl { 1={1=GID  4=idSol} }               l'objet apparaît au sol

in  event   iua { 3={1=63 5={GID, qté, UIDpile}} }   ramassé, UID NEUF
in  event   iux { 1=idSol }                          l'objet au sol disparaît

out request kdd { 1=UIDpile }                        déposer en banque
in  event   itv { 1=UIDpile }                        accusé
in  event   iuy { 1={1=63 5={GID, qté, UIDpile}} }   la pile en banque, UID NEUF

out request kcz { 2=UIDpile }                        retirer de la banque
in  event   iwa { 2=UIDpile }                        accusé
in  event   itf { 1={1=63 5={GID, qté, UIDpile}} }   la pile en sac, UID NEUF
```

`kdd` porte l'UID au champ 1, `kcz` au champ 2, et leurs accusés respectent le
même numéro. La forme `{1=63, 5={GID, quantité, UID}}` est **la même que celle
des éléments de `iwb`** : c'est la description d'une pile, partout.

`ium` sert deux fois — une pile posée au sol et une pile vidée par une vente.
C'est la disparition d'une pile, quelle qu'en soit la cause.

## Ce qui n'a pas été mesuré

* **L'inventaire.** Toujours pas de liste, sur aucun canal. Ce n'est plus un
  point à mesurer, c'est une contrainte : la fonction couvrira le stock de
  banque, pas le sac.
* **La taxe de dépôt en HDV.** Les kamas n'ont pas été suivis pendant les deux
  ventes.
* **Le plafond de lots en vente**, et le refus du serveur quand il est atteint.
* **Le refus d'un `kge`.** Les deux ventes ont réussi. On ne sait toujours pas
  ce que répond le serveur quand il refuse.
* **La stabilité de `iov.2`**, l'identifiant du PNJ banquier, mesuré sur un seul
  banquier. Même réserve que pour le PNJ de l'HDV.
* **`iov.3`**, `-20000` chez le banquier contre `-1` à l'HDV. Rôle inconnu.
* **`1=63`**, constant sur les 814 éléments de `iwb` et sur les quatre gestes.
  Vraisemblablement un discriminant de type de pile, jamais vu à une autre
  valeur.
* **Le havre-sac.** Non ouvert pendant cette session.

## Conséquences pour la conception

1. **La source de stock est `iwb`**, mémorisée par une écoute permanente,
   exactement comme `kby` l'est pour la mise à jour des prix. Même mécanisme,
   même condition d'IHM : « ouvre ta banque une fois pour que je voie ton
   stock ».
2. **`kge` se pose directement sur une pile de banque.** Pas de retrait, pas de
   déplacement, pas de second PNJ.
3. **La confirmation se lit dans `ivj` / `ium`, jamais dans `kes`.**
4. **La liste de stock se corrige au fil des réponses.** Une vente partielle
   garde l'UID et annonce la quantité restante ; une pile vidée disparaît.
   Aucune relecture, donc aucune taxe.
5. **Les UID meurent avec la session.** Rien à persister d'un lancement à
   l'autre.
6. **Ne jamais déduire un UID.** Le bloc est contigu, la tentation existe, et
   l'erreur est irréversible.
7. **La décision neuve est le choix de la taille de lot.** `prix.js` sait
   sous-coter un marché existant ; il ne sait pas décider quelle taille poser ni
   combien de lots tirer d'une pile. C'est le cœur de la conception à venir, et
   il n'est pas couvert par l'existant.
