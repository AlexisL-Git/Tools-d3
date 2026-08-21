# Les trames de déplacement en combat

**Date de mesure :** 2026-08-21, client Dofus 3, en observant le proxy de krm35
(`jklshdj.exe`) par `src/cli/proxy-tap.js`.

Trois captures : no-anim Safe actif (`mesure-simple2.jsonl`, 92 Ko, 1517 trames
entrantes), no-anim éteint (`mesure-eteint.jsonl`, 61 Ko, 1200 trames), et une
première capture inexploitable (mauvais processus, voir les pièges).

## La règle, en une phrase

**`jsj` porte le chemin d'un déplacement ; le no-anim insère, juste avant lui,
une trame `jwe` d'action 4 qui pose l'acteur sur la dernière case du chemin, et
relaie le `jsj` tel quel.**

## `jsj` — le déplacement

```
event jsj { 1: <chemin>, 2: 5, 5: <acteur> }
```

Le champ 1 est de type `bytes` et contient le chemin sous forme de **varints
empaquetés**, une case par varint, de la case de départ à la case d'arrivée.

Exemple relevé, champ 1 = `9d02 8e02 8002 f101` :

| octets | varint | case |
|---|---|---|
| `9d 02` | 285 | départ |
| `8e 02` | 270 | |
| `80 02` | 256 | |
| `f1 01` | 241 | **arrivée** |

Chemins mesurés, no-anim éteint (37 trames porteuses) :

```
acteur -5   : 215 -> 229                  pas [14]
acteur -1   : 357 -> 371                  pas [14]
acteur -1   : 371 -> 356 -> 342           pas [-15 -14]
acteur -2   : 370 -> 355 -> 341 -> 326    pas [-15 -14 -15]
acteur -4   : 243 -> 257 -> 270 -> 284    pas [14 13 14]
acteur -3   : 299 -> 313 -> 298           pas [14 -15]
acteur joueur : 312 -> 325 -> 340 -> 354  pas [13 15 14]
```

Les pas valent toujours ±13, ±14 ou ±15 : c'est le voisinage d'une grille
Dofus. Un chemin fait 2 à 4 cases dans les mesures.

Le champ 5 porte l'acteur : un `characterId` pour un joueur, un petit entier
négatif (-1 à -8) pour un monstre.

## `jwe` action 4 — la pose

La trame que le proxy fabrique :

```
event jwe { 3: <acteur>, 14: 4, 35 { 1: <case>, 2: <acteur> } }
```

Octets exacts pour l'acteur 665809125670 sur la case 217 :

```
0a2f0a2d0a13747970652e616e6b616d612e636f6d2f6a7765121618a682c4aab01370049a020a08d90110a682c4aab013
```

Le champ 14 de `jwe` est un discriminant d'action : il commande le numéro de la
branche `oneof`. L'action 4 utilise la branche 35.

## Vérification de la règle

**48 poses sur 51** tombent sur une case d'arrivée annoncée par un `jsj` du
**même acteur**, dans la capture no-anim actif. Les trois restantes s'expliquent
par la fenêtre de capture : leur `jsj` est antérieur au début de
l'enregistrement.

## La position de l'insertion

Constant sur les six échantillons examinés, dans le flux sortant :

```
… jto  [POSE jwe action 4]  jsj(acteur)  jto …
```

**La pose précède immédiatement le `jsj`**, qui est relayé sans modification.
Le client reçoit donc l'acteur à destination avant l'ordre de déplacement :
l'animation n'a plus de trajet à parcourir.

## Ce que la mesure a infirmé

La conception du 2026-08-21 affirmait que la case était **recopiée du champ
`7.6` d'une trame `jwe` d'action 300**. C'est **faux**, et c'était une
coïncidence sur un unique échantillon (`7.6 = 241` et une pose sur 241, alors
que 241 était en réalité la dernière case d'un `jsj`).

Preuves de l'infirmation :

1. deux actions 300 distinctes portent le **même** `7.6 = 302`, alors que les
   poses voisines valent 258, 244, 243 — une case ne se répète pas ainsi ;
2. la case d'une pose n'apparaît dans **aucune** des 25 trames entrantes
   précédentes, sur six poses testées ;
3. les actions 300 portent toutes `7.7 = { 2: 4195, 3: 21698 }`, et 4195
   apparaît comme identifiant de sort au champ 14 des trames `jxm` : ce sont
   des effets de **sort**, pas des déplacements.

## Les actions 300 retirées : hors périmètre, et volontairement ignorées

Le proxy de krm35 **retire** aussi 15 trames `jwe` d'action 300 dans la capture
mesurée. Ce que ces actions font exactement n'est pas établi, et leur retrait
n'est pas nécessaire pour obtenir l'effet recherché.

**Décision : notre no-anim n'en retire aucune.** Il se contente d'insérer les
poses. C'est ce qui produit la téléportation observée, et ne rien retirer est
conforme à la garantie « au moindre doute, relayer tel quel » : une trame
supprimée à tort est un effet de jeu perdu, une trame ajoutée en trop n'est
qu'une position confirmée.

## Aucune action `jwe` ne porte de chemin

Vérifié exhaustivement sur la capture no-anim éteint. Les 145 trames `jwe`
se répartissent en 13 actions — 300 (43), 129 (40), 102 (21), 100 (10), 98 (9),
514 (7), 97 (6), 103 (3), 406 (2), 99, 96, 50, 51 (1 chacune) — et **aucune**
ne contient de liste de cases. Le déplacement ne passe pas par `jwe`.

Deux actions portent une case isolée et méritent d'être connues, sans être
utilisées ici : l'action 50 (`18 { 1: 369, 3: -1 }`) et l'action 51
(`27 { 1: -1, 2: 325 }`). Ce sont vraisemblablement des téléportations ou des
glissades provoquées par un sort.

## Pièges rencontrés

- **Plusieurs processus `jklshdj.exe` tournent en même temps.** Chercher le
  proxy par son nom donne le mauvais : la première capture a enregistré
  60 secondes de trafic chiffré d'un composant voisin, sans une seule trame de
  jeu. Le bon se trouve en partant des connexions du client Dofus vers
  127.0.0.1 ou ::1, puis en remontant au processus qui écoute ce port.
- **Le port du proxy change à chaque lancement du launcher** — 8103, puis 8104.
  Ne pas le coder en dur.
- **Un alignement par index est trompeur.** Une seule insertion décale tout le
  reste et fait passer 92 trames pour différentes alors qu'une seule l'est.
  Comparer par contenu.
- **Un `indexOf` global pour retrouver une trame dans l'autre flux retombe sur
  la première occurrence** d'une trame répétée : deux poses distinctes se
  voyaient attribuer le même voisinage. Aligner séquentiellement.
- **Un seul échantillon ne fait pas une règle.** La règle `7.6` a tenu sur le
  premier cas et il a fallu quinze trames de plus pour la démolir. Même leçon
  que le champ 1 de `ijz` pour les invitations de groupe.
