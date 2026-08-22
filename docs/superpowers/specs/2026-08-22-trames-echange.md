# Les trames de l'échange entre joueurs

**Date de mesure :** 2026-08-22, client Dofus 3.6.10.10, deux clients derrière
notre proxy.

Mesuré avec l'instrumentation temporaire de `desktop/main.js` (`typesInedits()`
puis `octetsDesTrames()`, cette dernière journalisant **chaque** occurrence).
Deux passes : une de découverte, une d'octets couvrant **quatre échanges entre
nos deux clients dans les deux sens** plus **un échange avec un joueur tiers**.

## Les comptes de la mesure

| pid | characterId | rôle dans la mesure |
|---|---|---|
| 16240 | 665809125670 | nos clients, les deux sens |
| 29008 | 666951024934 | idem |
| — | 635144700198 | « ernesto », joueur tiers, non piloté |

## La séquence

```
out request keu { 2: cible }                     le proposant lance l'échange
in  event   kfz { 1: proposant, 2: cible, 4: 1 } REÇUE PAR LES DEUX PARTIES
out request kgi { }                              la cible accepte — AUCUN champ
in  event   kbg { 2: …, 6: proposant, 7: cible } la fenêtre s'ouvre, des 2 côtés
out request kcr { 1: quantité, 2: idObjet }      dépôt (quantité < 0 = retrait)
out request kep { 1: 1, 2: 1 }                   « je valide »
in  event   kgt { 3: 1, 4: qui }                 X a coché — REÇUE PAR LES DEUX
in  event   kgt { 4: qui }                       X a DÉcoché (champ 3 absent)
in  event   keq { 1: …, 3: … }                   fin de l'échange
```

## `kfz` — la proposition

```
in event kfz { 1=665809125670  2=666951024934  4=1 }

0a29 0a27 0a13 "type.ankama.com/kfz"
             1210 08a682c4aab013  10a68284cbb413  2001
```

| champ | contenu |
|---|---|
| **1** | **le proposant** |
| 2 | la cible |
| 4 | 1, constant sur les quatre échanges |

**Elle est reçue par les DEUX parties**, pas seulement par la cible. C'est la
différence majeure avec `ijz` (l'invitation de groupe), qui n'arrivait que chez
l'invité.

## `kgi` — l'acceptation, sortante de la cible

```
out request kgi { }

12 22
   0a 15
      0a 13 "type.ankama.com/kgi"      Any.value ABSENT
   10 ffffffffffffffffff01             uid = -1
```

**Aucun champ.** Même forme que `jxy`, le passe-tour : `request { content:
Any{ type_url }, uid: -1 }` avec un `Any.value` vide.

Octets complets, **identiques sur les 4 occurrences mesurées** :

```
12220a150a13747970652e616e6b616d612e636f6d2f6b676910ffffffffffffffffff01
```

## `kep` — la validation, sortante des deux parties

```
out request kep { 1=1  2=1 }

12 28
   0a 1b
      0a 13 "type.ankama.com/kep"
      12 04 08011001                   Any.value = { 1: 1, 2: 1 }
   10 ffffffffffffffffff01             uid = -1
```

Octets complets, **identiques sur les 6 occurrences mesurées**, dans les deux
sens et quel que soit le contenu de l'échange :

```
12280a1b0a13747970652e616e6b616d612e636f6d2f6b657012040801100110ffffffffffffffffff01
```

## `kgt` — « X a coché », et « X a décoché »

C'est la trame centrale de la fonction, et elle dit **deux** choses selon la
présence du champ 3.

```
in event kgt { 3=1  4=665809125670 }        X A COCHÉ
0a22 0a20 0a13 "type.ankama.com/kgt"  1209 1801 20a682c4aab013

in event kgt { 4=665809125670 }             X A DÉCOCHÉ
0a20 0a1e 0a13 "type.ankama.com/kgt"  1207      20a682c4aab013
```

| champ | contenu |
|---|---|
| **3** | **l'état de la coche : 1 = prêt. ABSENT quand la coche retombe** — c'est le zéro protobuf, qui ne s'écrit pas |
| **4** | **qui a coché ou décoché** |

**Ne réagir qu'au champ 3 valant 1.** À la conclusion de chaque échange, le
serveur envoie **deux `kgt` sans champ 3**, une par partie, pour remettre les
coches à zéro — puis `keq`. Les traiter comme des validations ferait émettre un
`kep` sur un échange déjà fermé. Observé aux quatre échanges.

**Une seule `kgt { 3: 1 }` par échange.** Le premier qui coche la déclenche ; la
validation du second conclut l'échange directement (remises à zéro + `keq`) sans
passer par une `kgt { 3: 1 }`. Vérifié aux trois échanges menés à terme.

**Notre propre validation nous revient.** À 160338 ms le pid 16240 émet `kep` ;
à 160368 ms il reçoit `kgt { 3=1, 4=665809125670 }` — son propre identifiant. Le
filtre l'écarte de lui-même, puisqu'il ne retient que les *autres* de nos
clients. Sans ce filtre, un client se répondrait à lui-même.

## Le champ du proposant : champ 1, prouvé par inversion

L'ordre des champs de `kfz` suggère la même lecture que `ijz`… et c'est
l'inverse. **Ici le champ 1 est bien le proposant.**

| échange | qui propose | `kfz` champ 1 | `kfz` champ 2 | qui envoie `kgi` |
|---|---|---|---|---|
| 145623 ms | 16240 (665809…) | **665809125670** | 666951024934 | 29008 |
| 175764 ms | 29008 (666951…) | **666951024934** | 665809125670 | 16240 |
| 195808 ms | 16240 (665809…) | **665809125670** | 666951024934 | 29008 |
| 220039 ms | 16240 (665809…) | **665809125670** | 666951024934 | 29008 |

Le champ 1 **bascule avec le rôle** ; l'acceptation part toujours de celui dont
l'identifiant est au champ 2. Preuve par inversion, sur quatre échanges.

**Conséquence pour le filtre :** comparer le **champ 1** aux `characterId` de
nos *autres* clients. Un filtre bâti sur le champ 2 aurait fait accepter au
proposant **sa propre proposition** — `kfz` étant reçue par les deux parties, le
maître aurait vu au champ 2 l'identifiant de son esclave, l'aurait trouvé dans
la liste, et se serait accepté lui-même.

## L'échange avec un joueur tiers

```
286152ms [16240] out keu { 2=635144700198 }
286182ms [16240] in  kfz { 1=665809125670  2=635144700198  4=1 }
294030ms [16240] in  kbg { … 6=665809125670  7=635144700198 … }
```

**Seul 16240 reçoit la `kfz`** : 29008 n'est pas partie à l'échange et n'en voit
rien. Le champ 1 porte notre propre identifiant, donc le filtre refuse — le
proposant ne s'accepte pas lui-même.

**Limite de cet essai :** c'est *notre* client qui a proposé au tiers. Le cas
symétrique — un tiers proposant à un de nos esclaves — n'a **pas** été mesuré.
La structure de `kfz` étant identique dans les quatre échanges et dans
celui-ci, le filtre le refusera (`1 = ernesto` n'est aucun de nos clients), mais
c'est une déduction, pas une observation.

## Réponses aux quatre questions du spec

1. **Proposition et champ du proposant :** `kfz`, champ 1. Prouvé par inversion.
2. **Acceptation :** `kgi`, sans aucun champ, constante. Rien à recopier de la
   proposition.
3. **Existe-t-il un événement « l'autre a validé » ?** **Oui : `kgt`, et il porte
   l'identifiant du validant au champ 4.** C'est le **cas favorable** du spec :
   le module reste sans état, deux traductions pures et le même filtre appliqué
   deux fois.
4. **Modification du contenu après validation : non mesuré.** L'essai a bien
   comporté des dépôts et des retraits (`kcr` à quantité négative), mais aucune
   validation ne les précédait. **Sans conséquence pour la conception retenue :**
   la règle étant purement réactive — `kgt { 3: 1, 4: partenaire }` → `kep` — une
   remise à zéro suivie d'une nouvelle validation du maître produit simplement
   une nouvelle `kgt { 3: 1 }`, et la séquence se rejoue. Aucun état ne dépend de
   ce qu'on ignore.

## Deux trames sortantes constantes

Ni `kgi` ni `kep` ne recopient quoi que ce soit de l'échange en cours. Toutes
deux se figent comme `TRAME_PASSE`, au lieu de se construire comme
l'acceptation d'invitation. **C'est plus simple que ce que le plan prévoyait**,
qui les faisait dépendre d'une valeur mesurée.

## Un cas à couvrir par test : maître et esclave tous deux armés

`kgt { 3: 1, 4: X }` est reçue par les deux parties. Si l'échange a lieu entre
deux clients pilotés **dont les deux cases sont cochées**, chacun voit dans le
champ 4 l'identifiant de l'autre et validerait. En pratique la mesure montre que
la seconde validation ne produit pas de `kgt { 3: 1 }` — l'échange conclut
directement — donc la boucle ne s'amorce pas. Le comportement doit néanmoins
être verrouillé par un test plutôt que laissé à cette observation.

## Trames voisines, relevées mais hors périmètre

`keu` (proposer un échange), `kbg` (ouverture de la fenêtre), `kcr` (déposer ou
retirer un objet), `keq` (fin de l'échange), `kfb`, `kgt` en remise à zéro.
Aucune n'est émise par cette fonction.
