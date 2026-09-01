# Les trames de l'hôtel de vente

> **CORRECTION du 2026-09-01, même jour.** La section « L'inventaire ne transite
> JAMAIS » de ce document **est fausse**. L'inventaire transite, et il se
> demande : `itr` rend `ivx`, une liste de piles avec GID, quantité et UID.
> Les `ivx` avaient été vues et écartées ici comme des faux positifs, sur une
> coïncidence de comptage. Voir `2026-09-01-trames-mise-en-vente.md`, qui
> l'établit trame par trame. Tout le reste de ce document tient.

**Date de mesure :** 2026-09-01, un seul client derrière notre proxy, hôtel de
vente **ressources**.

Mesuré avec `OMNI_CAPTURE=1` (la capture complète, déjà permanente) plus un
dumpeur d'octets temporaire allumé par `OMNI_CAPTURE_OCTETS=1`, tous deux posés
par `outils/lancer-mesure-hdv.vbs`. **Ces deux ajouts sont jetables** — à retirer
une fois traités les points de la section « ce qui n'a pas été mesuré », qui
sont les seuls à pouvoir encore en avoir besoin.

Une seule passe a suffi, là où l'échange en avait demandé deux. L'HDV est calme
— quelques dizaines de trames par minute hors combat — donc les octets de
chaque trame ont pu être journalisés dès la découverte, sans noyer le fichier.

Tous les décodages ci-dessous ont été **vérifiés avec `decodeFrameRaw` du
dépôt**, pas lus à l'œil.

## Les conditions de la mesure

| | |
|---|---|
| pid | 12236 |
| client | Dofus 3, binaire Unity `6000.3.16f1` — la version du jeu n'a pas été relevée |
| journal | `journal-hdv.log`, session `2026-09-01T08:36:45Z` |
| borne du dump | 2048 octets pendant la mesure ; portée ensuite à 262144 |

**La borne à 2048 a coûté une trame** : `kby` fait 8908 octets et n'a été lu
qu'à hauteur de 2146. Sa forme d'élément est connue, son contenu complet non.
C'est la seule lacune de méthode de cette mesure.

## Les objets de la mesure

| GID | nom | catégorie | prix moyen (`kcq.4`) |
|---|---|---:|---:|
| 20967 | Légende animale de Bakushana | 219 | 827 440 |
| 13731 | Pierre médicinale | 51 | 32 |
| 15169 | Moustache précieuse | 54 | 34 |
| 11309 | — | 47 | 356 |
| 13941 | — | 53 | 505 |
| 32688 | — | 175 | 27 970 |
| 32689 | — | 175 | 90 500 |

La catégorie apparaît à `kbt.1` et à `kgp.6`, toujours la même pour un GID
donné.

## La séquence

```
out request iwo { 1=6190  2=515300 }            parler au PNJ de l'HDV
in  event   kdw { 1={…} }                       ses options de dialogue
out request iov { 1=5  2=73400322  3=-1 }       choisir « vente »
in  event   khd { 3=11 }                        l'HDV s'ouvre
in  event   kby { 1={…} × N }                   NOS LOTS EN VENTE, 8908 o

out request keh { 1=ancienGID }                 se désabonner du précédent
out request keh { 1=GID  2=1 }                  s'abonner aux prix d'un GID
out request kbz { 1=GID }                       demander les stats
in  event   kbt { 1=catégorie  2=GID }          accusé du désabonnement
in  event   kbt { 1=catégorie  2=GID  3={…} }   les stats
in  event   kcq { 3=GID  4=prixMoyen  5={…} }   le prix moyen
in  event   kgp { 2=[p1,p10,p100,p1000] … }     POUSSÉE À CHAQUE MOUVEMENT

out request kge { 1=prixDuLot  2=UIDpile  3=quantité }    METTRE EN VENTE
out request kch { 1=UIDlot  2=prixDuLot  3=quantité }     METTRE À JOUR LE PRIX
out request kcr { 1=-quantité  2=UIDlot }                 RETIRER

in  event   kes { 1={UIDlot,GID,quantité}  2=prix  4=2419200 }   le lot posé
in  event   ken { 1=UIDlot }                                     le lot disparu
```

## `kgp` — le tableau des prix du marché

**C'est la trame centrale de la fonction.** Le champ 2 est un `bytes` qui
contient des **varints packés : exactement quatre valeurs, une par taille de
lot — 1, 10, 100, 1000.**

```
in event kgp { 2=[77, 271, 2991, 38996]  3=67103  5=15169  6=54 }

0a2c 0a2a 0a13 "type.ankama.com/kgp"
               1213 1208 4d8f02af17d4b002  189f8c04  28c176  3036
                       └── 77, 271, 2991, 38996
```

| champ | contenu |
|---|---|
| **2** | **les quatre prix minimum du marché**, packés, dans l'ordre lot 1 / 10 / 100 / 1000. Un **0** signifie « aucun lot de cette taille en vente » |
| 3 | une clé de marché par GID — 96946 pour 20967, 58099 pour 13731, 67103 pour 15169. Rôle non déterminé |
| 5 | le GID |
| 6 | la catégorie |

### La preuve, geste par geste

Sur la Pierre médicinale (GID 13731), quatre gestes consécutifs :

| geste | `kgp.2` |
|---|---|
| pose d'un lot de **100** à 1222 | [19, 190, **1222**, 18000] |
| pose d'un lot de **10** à 122 | [19, **122**, 1222, 18000] |
| retrait du lot de **100** | [19, 122, **2700**, 18000] |
| retrait du lot de **10** | [19, **190**, 2700, 18000] |

Chaque case bouge **quand et seulement quand** on touche à ce lot-là, et
remonte au prix du concurrent dès qu'on retire le nôtre. Confirmé une seconde
fois sur la Moustache précieuse : la case « lot 100 » passe de 2991 à 2990 au
reprix, les trois autres ne bougent pas.

### Ce tableau inclut NOS PROPRES lots

C'est le piège de conception de cette fonction, et il est prouvé par le tableau
ci-dessus : après la pose à 1222, le minimum du marché en lot de 100 **était
notre lot**. Un bot qui sous-cote le minimum sans regarder à qui il appartient
se sous-coterait lui-même d'un cran à chaque passe, jusqu'à zéro.

`kby` donne nos lots avec leur prix, `kgp` donne le minimum. La règle qui évite
le piège s'écrit avec ces deux-là et rien de plus : **si le minimum d'une taille
est déjà un de nos prix sur ce GID, on est le moins cher — ne rien émettre.**

## `kge` — mettre en vente

```
out request kge { 1=2991  2=64867218  3=100 }

122e 0a21 0a13 "type.ankama.com/kge"
               120a 08af17 109297f71e 1864
          10 ffffffffffffffffff01              uid = -1
```

| champ | contenu |
|---|---|
| **1** | **le prix DU LOT**, pas le prix à l'unité |
| **2** | **l'UID de la pile en inventaire** dont le lot est tiré |
| **3** | **la quantité du lot** — 1, 10, 100 ou 1000 |

**Le champ 2 est l'UID de la pile, pas le GID.** Prouvé par deux poses
consécutives sur la même pile de Pierre médicinale : `kge { 1=1222, 2=64867220,
3=100 }` puis `kge { 1=122, 2=64867220, 3=10 }`. **Même valeur au champ 2, deux
quantités différentes** — un seul exemple aurait laissé les deux champs
confondus.

**Le prix est celui du lot entier.** 1222 pour 100 unités et 122 pour 10 de la
même ressource : 12,22 kamas l'unité dans les deux cas.

## `kch` — mettre à jour le prix

```
out request kch { 1=1768695  2=2990  3=100 }

122d 0a20 0a13 "type.ankama.com/kch"
               1209 08f7f96b 10ae17 1864
          10 ffffffffffffffffff01              uid = -1
```

| champ | contenu |
|---|---|
| **1** | **l'UID du lot en vente** — celui rendu par `kes`, PAS l'UID de la pile |
| **2** | le nouveau prix du lot |
| **3** | la quantité du lot |

**Le champ 3 est bien la quantité.** La première mesure portait sur un lot de 1
et donnait `3=1` : indécidable entre une quantité et un drapeau. La seconde,
sur un lot de 100, donne `3=100`. Deux valeurs distinctes, ambiguïté levée.

**Une mise à jour est un retrait suivi d'une repose.** Le serveur répond `ken {
1=1768695 }` — l'ancien lot disparaît — puis `kes` avec un **UID neuf**
(1768822), même GID, même quantité, prix nouveau. **Conséquence directe : le bot
ne peut pas conserver sa liste d'UID d'une passe à l'autre, il doit la relire.**

## `kcr` — retirer un lot, et c'est un message déjà connu

```
out request kcr { 1=-100  2=1766754 }

1233 0a26 0a13 "type.ankama.com/kcr"
               120f 089cffffffffffffffff01 10e2ea6b
          10 ffffffffffffffffff01              uid = -1
```

| champ | contenu |
|---|---|
| **1** | **la quantité, NÉGATIVE** |
| **2** | l'UID du lot en vente |

`kcr` est déjà documenté dans `2026-08-22-trames-echange.md` : *« `kcr { 1:
quantité, 2: idObjet }`, dépôt (quantité < 0 = retrait) »*. **Le même message
sert au dépôt en échange et au retrait de l'HDV.**

**Mais le champ 2 ne désigne pas la même chose** : une pile d'inventaire en
échange, un lot en vente ici. Deux espaces d'identifiants pour un même numéro de
champ — de quoi produire une confusion coûteuse si un jour les deux modules
partagent du code.

## `kes` et `ken` — le lot posé, le lot disparu

```
in event kes { 1={ 1=1768822  3=15169  4=100 }  2=2990  4=2419200 }
in event ken { 1=1768695 }
```

| `kes` | contenu |
|---|---|
| 1.1 | **l'UID du lot en vente** — celui qu'attendent `kch` et `kcr` |
| 1.3 | le GID |
| 1.4 | la quantité du lot |
| 2 | le prix du lot |
| 4 | **2 419 200 secondes, soit exactement 28 jours** — la durée de mise en vente |

`ken { 1=UID }` dit qu'un lot a quitté la vente. Il arrive aussi **pour les lots
des autres joueurs** tant qu'on est abonné au GID : plusieurs dizaines observées
sans qu'on ait rien fait.

## `kby` — nos lots en vente

Émise une fois, à l'ouverture de l'HDV. **8908 octets, dont 2146 seulement ont
été lus.** Huit éléments décodés, tous de la même forme :

```
élément { 2={ 1=UID  3=GID  4=quantité }  3=prix  4=duréeRestante }
```

| élément | UID | GID | quantité | prix | durée restante |
|---|---:|---:|---:|---:|---:|
| 0 | 1 736 662 | 19236 | 1 | 692 | 2 413 852 |
| 1 | 1 159 908 | 22211 | **10** | 4 798 | 2 348 132 |
| 2 | 1 739 203 | 16168 | 1 | 683 | 2 414 478 |
| 3 | 1 742 692 | 11309 | **100** | 133 996 | 2 415 276 |
| 4 | 1 739 248 | 13738 | 1 | 694 | 2 414 496 |
| 5 | 1 739 016 | 8075 | 1 | 487 | 2 414 425 |
| 6 | 1 738 335 | 9278 | 1 | 1 993 | 2 414 242 |
| 7 | 1 738 872 | 8735 | 1 | 1 181 | 2 414 382 |

L'élément 1 se distingue nettement : UID bien plus bas (1,16 M contre 1,74 M) et
durée restante inférieure de plus de 18 heures aux autres. Les UID sont donc
**croissants dans le temps**, ce qui recoupe le renouvellement d'UID observé au
reprix.

**C'est bien notre liste de ventes**, pas un catalogue : la forme d'élément est
celle de `kes` au numéro de champ près, et le champ 4 vaut 28 jours **moins
quelques heures** — du temps restant, pas une date.

**Non mesuré : le nombre réel d'éléments.** Les huit lus font 21 à 22 octets
chacun, tag et longueur compris, ce qui placerait le total entre 400 et 450
lots. C'est beaucoup, et cette estimation n'est qu'une division : le compte
exact demande une nouvelle capture avec la borne relevée.

## `ivj` — l'inventaire qui bouge

Émise après chaque `kge`, et c'est elle qui relie l'HDV à l'inventaire.

```
in event ivj { 2={ 1=186  2=2 }  3={ 2=64867220  3=186 } }
```

| champ | contenu |
|---|---|
| **3.2** | **l'UID de la pile** — exactement le champ 2 de `kge` |
| **3.3** | **la nouvelle quantité** de cette pile |
| 2.1 | la même quantité, en doublon |
| 2.2 | 2, constant sur les deux mesures |

Preuve : la pile de Pierre médicinale passe à **186** après la vente d'un lot de
100, puis à **176** après celle d'un lot de 10. Elle en contenait donc 286.

**C'est un DELTA, pas un inventaire.** `ivj` n'annonce que les piles qui
changent. Elle donne le vocabulaire — un UID de pile se lit là — mais pas
l'inventaire de départ.

`iun { 1=podsUtilisés  3=podsMax }` l'accompagne : 2124/18039 après les ventes,
2624 puis 2674 après les retraits.

## `ivi` — tous les prix moyens du serveur, au login

La plus grosse trame de la session : **89 765 octets, 9861 paires**, envoyée une
fois à la connexion.

```
in event ivi { 2={ 1=GID  2=prixMoyen } × 9861 }
```

Les cinq GID mesurés au HDV s'y retrouvent **chacun exactement une fois**, avec
la valeur que `kcq.4` a rendue plus tard :

| GID | `ivi` | `kcq.4` |
|---|---:|---:|
| 13731 Pierre médicinale | 32 | 32 |
| 15169 Moustache précieuse | 34 | 34 |
| 20967 Légende de Bakushana | 827 440 | 827 440 |
| 11309 | 356 | 356 |
| 13941 | 505 | 505 |

**Cinq sur cinq.** `ivi` est donc la table complète des prix moyens, tout le
catalogue d'un coup.

**Conséquence pour la conception :** le prix moyen d'une ressource est connu
**sans rien demander**, dès la connexion. Le garde-fou de `prix.js` — refuser un
prix déduit qui s'écarte de plus de 100 % du moyen — n'a donc besoin d'aucun
aller-retour. `kcq` reste utile pour la fraîcheur, pas pour l'existence de la
donnée.

## ~~L'inventaire ne transite JAMAIS, et c'est prouvé~~ — FAUX, voir la correction en tête

**Le contenu de l'inventaire, de la banque et du havre-sac n'est envoyé sur
aucun canal.** Ce n'est pas une lacune de mesure, c'est un résultat.

Ce qui a été éliminé, sur quatre captures :

* Recherche des UID de pile `64867220` et `64867218` sur les **54 666 trames**
  de la session longue : ils n'apparaissent **que** dans les `kge` que nous
  avons émis et les `ivj` qui les confirment. Jamais ailleurs.
* Recherche des GID connus : aucun, sauf dans `kby` pour ce qui est en vente.
* Décodage de **toutes** les trames en forme de liste, et d'un exemple de
  **chaque** type de la session : rien ne porte les 753 lots annoncés par
  l'interface. La seule trame de la bonne forme, `lwt`, contient 4 objets.
* Comptage brut, trame par trame, des entiers dans la plage des UID de pile :
  les seuls pics sont des `ivx`, et leur compte égale exactement leur nombre de
  cases de carte — des faux positifs.
* Les trames rejetées par `decodeFrameRaw` ont été journalisées : 4 en tout,
  de 10 à 1164 octets, toutes du protocole de connexion.
* Les connexions **hors du port 5555** ont été journalisées : 17 canaux, tous
  en TLS vers des CDN, **aucun n'atteignant 64 Ko**.

Le client détient donc son inventaire sans le recevoir — cache local, ou canal
chiffré hors de portée. **`ivj` reste la seule source d'UID de pile, et elle
n'annonce que ce qui bouge.**

**Conséquence pour la conception : `kge` n'est pas pilotable par lecture du
réseau.** Le bouton « mettre en vente » ne peut pas énumérer le stock. Le bouton
« mettre à jour », lui, n'en a pas besoin : `kby` lui donne les 376 lots.

## `keh` et `kbz` — l'abonnement aux prix

Cliquer sur une ressource, c'est s'abonner à son marché.

```
out request keh { 1=ancienGID }        se DÉSABONNER — pas de champ 2
out request keh { 1=nouveauGID  2=1 }  s'ABONNER
out request kbz { 1=nouveauGID }       demander les stats
in  event   kbt { 1=cat  2=ancienGID }         accusé, SANS champ 3
in  event   kbt { 1=cat  2=nouveauGID  3={…} } les stats, AVEC champ 3
```

Le champ 2 de `keh` distingue les deux gestes ; sa présence vaut abonnement,
son absence désabonnement. Même logique que le champ 3 de `kgt` dans l'échange :
**le zéro protobuf ne s'écrit pas.**

Tant qu'on est abonné, **le serveur pousse un `kgp` à chaque mouvement du marché
sur ce GID**, sans qu'on demande rien. Le bot devra se désabonner en fin de
passe, sinon il laisse un flux ouvert.

`kbt.3` porte les mêmes quatre prix packés que `kgp.2`, au champ 6 d'un message
imbriqué. `kcq.4` porte le **prix moyen à l'unité** — l'équivalent du « prix
moyen » de krm35.

## La banque et le havre-sac : aucune trame

**Afficher le contenu de la banque et du havre-sac depuis l'HDV ne produit
strictement rien sur le réseau.** Vérifié sans filtre : entre le relevé de prix
et la fin de la session, seules des trames de mouvement et d'entité circulent.
Les gros paquets de cette période sont des `ivx` de changement de carte.

L'option d'affichage était déjà active et les objets déjà visibles ; les
masquer puis les réafficher n'a rien émis. **Le client détient donc déjà ce
contenu**, et le bot pourra le lire sans rien demander — ce qui valide
l'hypothèse « pas d'aller-retour banque » du cadrage.

**Mais l'endroit où ce contenu arrive n'a pas été identifié.** Il est
vraisemblablement dans le flot du login, dont les plus gros paquets (89 746,
31 971, 20 381 octets) ont tous été tronqués à 2048. **C'est le point à mesurer
en premier si la conception a besoin du stock.**

## Ce qui n'a pas été mesuré

* **Le contenu complet de `kby`** et son nombre d'éléments — tronqué à 2146/8908.
* **L'inventaire, la banque et le havre-sac** — cherché puis écarté, voir la
  section qui lui est consacrée. Ce n'est plus un point à mesurer : c'est une
  contrainte de conception.
* **Le contenu des 17 canaux TLS.** Aucun n'atteint 64 Ko, mais 753 lots
  compressés en tiendraient dans quelques kilo-octets. Les lire demanderait de
  casser le TLS, ce qui sort du cadre de ce projet.
* **Le plafond de lots en vente** : jamais atteint pendant la mesure, donc le
  refus du serveur quand il l'est reste inconnu.
* **La taxe de dépôt** : aucune trame ne l'a exposée, et les kamas n'ont pas été
  suivis.
* **Les autres catégories d'HDV** (consommables, runes, équipements) : seul
  l'HDV ressources a été ouvert. `khd { 3=11 }` porte vraisemblablement le type
  d'HDV, mais avec une seule valeur observée c'est une déduction.
* **`iov { 1=5  2=73400322  3=-1 }`**, le choix « vente » dans le dialogue du
  PNJ : mesuré une seule fois, sur un seul PNJ. Rien ne dit que 73400322 est
  stable d'un HDV à l'autre.
* **`kgp.3`** (96946, 58099, 67103) : constant par GID, mais son rôle est inconnu.
* **La vente effective d'un lot par un acheteur** — jamais observée.

## Conséquences pour la conception

1. **« Mettre à jour » est entièrement couvert, « mettre en vente » ne l'est
   pas.** Les deux requêtes sont mesurées et comprises, mais `kge` exige un UID
   de pile d'inventaire, et l'inventaire ne transite sur aucun canal. Le
   séquenceur de mise à jour se conçoit et se teste dès maintenant ; celui de
   mise en vente n'a pas de source de stock.
2. **Les trames sont VARIABLES**, contrairement à tout ce qu'OMNI émet
   aujourd'hui : `TRAME_PASSE`, `TRAME_ACCEPTATION` et `TRAME_VALIDATION` sont
   figées une fois pour toutes. Ici il faut construire une requête par lot.
3. **Le prix se lit dans `kgp.2` / `kbt.3.6`**, quatre valeurs, une par taille.
   Un 0 veut dire « pas de concurrent à cette taille » — et non « gratuit ».
4. **Ne jamais sous-coter sans vérifier à qui appartient le minimum.** Prouvé
   ci-dessus.
5. **Relire les UID à chaque passe** : une mise à jour les renouvelle.
6. **Se désabonner en fin de passe**, sinon le serveur continue de pousser.
7. **Un lot posé vit 28 jours.** Rien à gérer côté bot, mais c'est ce qui borne
   l'intérêt d'une repasse.
8. **Le prix moyen ne se demande pas.** `ivi` livre les 9861 prix moyens au
   login. Le garde-fou anti-extrapolation s'applique donc à toute ressource,
   sans aller-retour.
