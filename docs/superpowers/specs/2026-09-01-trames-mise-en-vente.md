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

## Le résultat : le stock s'énumère à la demande

La première mesure concluait que « mettre en vente » n'avait pas de source de
stock, parce que `kge` exige un UID de pile et que **l'inventaire ne transiterait
sur aucun canal**.

**Cette conclusion est fausse.** L'inventaire transite, et il se demande :
`itr` rend `ivx`, une liste de piles avec leur GID, leur quantité et leur UID,
pour les rangements qu'on nomme. Voir la section `itr` / `ivx` ci-dessous.

La banque transite elle aussi, par une seconde voie — `iwb`, à l'ouverture chez
le banquier. Elle reste documentée ici parce qu'elle est mesurée et qu'elle
valide le décodage, mais **elle n'est pas nécessaire** : `itr { 2=[2,3] }` rend
la banque et l'inventaire d'un coup, sans taxe.

### Pourquoi la première mesure s'est trompée

Elle avait vu ces trames et les avait écartées explicitement : « les seuls pics
sont des `ivx`, et leur compte égale exactement leur nombre de cases de carte —
des faux positifs ». La coïncidence a tenu : 219 éléments dans la `ivx` du
login, 219 cases sur la carte.

C'est aussi ce qui explique sa note sur la banque affichée depuis l'HDV, qui « ne
produit rien sur le réseau ». Exact, mais pour une autre raison que celle
retenue : le client avait déjà reçu la liste, en réponse à son propre `itr`.

**La leçon de méthode :** un compte d'éléments qui tombe juste n'identifie pas
une trame. Il fallait ouvrir `ivx` et lire ses champs, ce que la borne de dump à
2048 rendait alors impossible — la plus grosse fait 31 977 octets.

## La séquence

```
out request itr { 2=[2,3]  3=1 }                     DEMANDER LE STOCK
in  event   ivx { 3={…} × N }                        LES PILES, GID/QTE/UID

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

## `itr` et `ivx` — demander le stock, et le recevoir

**C'est le couple qui débloque la fonction.** Il se déclenche à la demande, sans
PNJ, sans taxe et sans attendre un geste du joueur.

```
out request itr { 2=<rangements>  3=1 }
    122a0a1d0a13747970652e616e6b616d612e636f6d2f697472
    120612020203180110ffffffffffffffffff01

in  event   ivx { 1=<idVue>  3={1=63 5={1=GID … 3=quantité 4=UIDpile …}} × N }
```

`itr.2` est une **suite d'octets, un par rangement demandé**. Deux valeurs
mesurées, et leur effet est net :

| `itr.2` | éléments rendus | dont de la banque |
|---|---:|---:|
| `03` | 283 | **0** |
| `02 03` | 1096 | **813** |

**Rangement 2 = la banque, rangement 3 = l'inventaire.** Les 283 piles hors
banque sont les mêmes dans les deux réponses ; la seconde y ajoute exactement le
contenu de `iwb`, moins la pile qu'on venait d'en retirer.

Les éléments de `ivx` portent **la même forme de pile que `iwb`** — `{1=63,
5={1=GID, 3=quantité, 4=UID}}` — avec des champs de plus pour les objets à
caractéristiques : `5.2` répété porte les lignes de stats d'un équipement, `5.5`
une position. Un décodeur qui lit `5.1`, `5.3` et `5.4` et ignore le reste lit
les deux trames.

### La preuve

À la connexion, sans aucun `itr`, une `ivx` de 9 179 octets porte **219 piles**,
toutes hors banque. Son UID le plus haut est `84495873` — et c'est exactement la
pile que le joueur a ensuite posée au sol :

```
in  event   ivx { … {1=13731  3=286  4=84495873} … }   au login
out request iur { 1={2=84495873  3=286} }              posée au sol
in  event   itl { 1={1=13731  4=470} }                 GID confirmé
```

GID, quantité et UID concordent sur les trois trames. **`ivx` est bien
l'inventaire.**

Cette trame-là est figée dans `test/fixtures/hdv-ivx-inventaire.hex`, 9 179
octets, 219 piles.

## `iwb` — le contenu de la banque, par l'autre voie

13 704 octets, émise une fois, à l'ouverture de la banque. **Elle n'est pas
nécessaire à la fonction** — `itr { 2=[2,3] }` rend le même contenu sans taxe —
mais elle est mesurée, validée contre le jeu, et c'est elle qui a permis
d'identifier le rangement 2.

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

**Conséquence directe : on ne passe pas par le banquier.** `itr { 2=[2,3] }`
rend le même contenu sans rien coûter ni déplacer personne. Une fonction qui
ouvrirait la banque pour lire son stock facturerait le joueur à chaque passe,
pour une liste qu'elle peut demander gratuitement.

C'est aussi la seule taxe de cette fonction dont on connaisse le montant : celle
du dépôt en HDV n'a pas été mesurée.

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

* **Les autres valeurs de `itr.2`.** Seuls `03` et `02 03` ont été observés.
  Le havre-sac et le coffre de guilde ont vraisemblablement leur numéro, jamais
  vu.
* **Ce que `itr` coûte, s'il coûte quelque chose.** Aucune taxe observée, mais
  les kamas n'ont pas été suivis.
* **Si `itr` est émettable hors du panneau de vente.** Les quatre `itr` mesurés
  ont tous été émis par le client au moment où le joueur ouvrait ou filtrait ce
  panneau. Rien ne dit que le serveur le refuse ailleurs — rien ne dit non plus
  qu'il l'accepte.
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

1. **La source de stock est `itr` / `ivx`, demandée au moment voulu.** Pas
   d'écoute permanente à tenir, pas de « ouvre ta banque une fois » à afficher,
   pas de taxe. C'est plus simple que pour la mise à jour des prix, où `kby`
   n'arrive qu'à l'ouverture de l'HDV et doit être guettée.
2. **`kge` se pose directement sur une pile de banque comme d'inventaire.** Pas
   de retrait, pas de déplacement, pas de second PNJ. Les deux origines sont
   prouvées, une vente chacune.
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
