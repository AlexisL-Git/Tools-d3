# Les trames d'invitation de groupe

**Date de mesure :** 2026-08-20, client Dofus 3.6.10.10, deux clients derrière notre proxy.

Mesuré avec l'instrumentation temporaire de `desktop/main.js` (`typesInedits()`
puis `octetsDesTrames()`), trois passages : A→B, B→A, puis un dernier pour les
octets bruts.

## Les deux comptes de la mesure

| characterId | personnage |
|---|---|
| 665809125670 | Spoony |
| 666951024934 | Swaggman |

## La séquence

```
out request ime { 1: …, 3: 1 }        l'invitant envoie l'invitation
in  event   ijz { … }                 l'invité la reçoit
out request ijx { 1: idGroupe }       l'invité accepte
in  event   ink { 1: idGroupe, … }    l'invitant voit le groupe à deux
out request inh { 2: idGroupe }       quitter le groupe
in  event   inc { 2: idGroupe, 3: … } l'autre voit le départ, champ 3 = le partant
```

## `ijz` — l'invitation, entrante chez l'invité

```
in event ijz { 1=666951024934  2=665809125670  3=8  5=36380  6=1  7=Spoony }

0a37 0a35 0a13 "type.ankama.com/ijz"
             121e 08a68284cbb413  10a682c4aab013  1808  289c9c02  3001  3a0653706f6f6e79
```

| champ | contenu |
|---|---|
| **1** | **le destinataire — nous** |
| **2** | **l'invitant** |
| 3 | 8, constant sur les trois mesures |
| **5** | **l'identifiant du groupe** |
| 6 | 1, constant sur les trois mesures |
| 7 | le nom du personnage invitant |

## `ijx` — l'acceptation, sortante de l'invité

```
out request ijx { 1=36380 }

12 28
   0a 1b
      0a 13 "type.ankama.com/ijx"
      12 04 089c9c02              Any.value = { 1: 36380 }
   10 ffffffffffffffffff01        uid = -1
```

Soit `request { content: Any{ type_url: "type.ankama.com/ijx", value: {1: idGroupe} }, uid: -1 }`.

Même enveloppe que `jxy` (le passe-tour), à ceci près que `Any.value` n'est pas
vide : il porte l'identifiant du groupe, **recopié du champ 5 de l'invitation**.

Octets complets pour `idGroupe = 36380` :

```
12280a1b0a13747970652e616e6b616d612e636f6d2f696a781204089c9c0210ffffffffffffffffff01
```

## La trame d'acceptation n'est pas constante

L'identifiant de groupe change à chaque groupe : **35949**, puis **36074**,
puis **36380** sur les trois mesures. Une constante figée comme `TRAME_PASSE`
ne conviendrait donc pas : l'acceptation se construit.

## Le champ de l'invitant : champ 2, pas champ 1

C'est la conclusion la plus importante du document, et l'ordre des champs
suggérait l'inverse.

Trois preuves indépendantes :

1. **A→B.** `ijz` reçu par le pid 12916 porte `1=666951024934`. Le même pid a
   ensuite quitté le groupe, et l'autre client a reçu `inc { 3=666951024934 }`
   — le champ 3 de `inc` désigne le partant. Donc 12916 **est**
   666951024934 : le champ 1 de `ijz` désigne son propre destinataire.
2. **B→A.** `ijz` reçu par le pid 27012 porte `1=665809125670`, et le même
   raisonnement sur `inc` donne 27012 = 665809125670. La règle tient dans les
   deux sens.
3. **Interne à une trame.** Dans la troisième mesure, le champ 2 vaut
   665809125670 et le champ 7 dit `Spoony` — or Spoony est 665809125670. Le
   champ 2 et le nom affiché désignent le même personnage : l'invitant.

**Conséquence pour le filtre :** l'accepteur compare le **champ 2** aux
`characterId` de nos *autres* clients. Un filtre bâti sur le champ 1 aurait
comparé notre propre identifiant, l'aurait toujours trouvé dans la liste, et
aurait accepté toutes les invitations — y compris celles d'inconnus. Il aurait
passé l'essai en jeu sans broncher.

## Ce que la mesure autorise

Issue 1 du plan (tâche 1, étape 6) : **l'invitation porte un `characterId`
exploitable**. Le filtre conçu dans le spec est donc réalisable tel quel.

## Trames voisines, relevées mais hors périmètre

`ime` (envoyer une invitation), `ink` (composition du groupe), `inh` (quitter),
`inc` (départ d'un membre), `imf`, `ilc`, `imv`, `ikv`, `ils`, `imy`. Aucune
n'est utilisée par cette fonction.
