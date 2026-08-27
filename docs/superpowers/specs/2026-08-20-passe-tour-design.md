# Passe-tour automatique en combat

**Date :** 2026-08-20
**Statut :** conception validée, non implémentée. Deux messages du protocole
restent à identifier par mesure.

## Correction du 2026-08-27 — le déclencheur est `jyj`, pas `jxh`

**Tout ce qui suit à propos du déclencheur est faux.** Mesuré sur un combat de
groupe à deux clients, journal entrant ET sortant :

| message | sens | rôle réel |
|---|---|---|
| `jzc { 1: characterId, 7: rang, 8: manche }` | entrant | **début** du tour de ce combattant |
| **`jyj { }`** (vide) | entrant | **c'est NOTRE tour** — personnel |
| `jxh { 2: characterId }` | entrant | **fin** du tour de ce combattant |

`jyj` est envoyé au seul client concerné : sur 9 occurrences, chacune suit de
2 à 39 ms un `jzc` portant le characterId de ce client, et les 49 `jzc`
portant l'identifiant d'un autre combattant n'en ont produit aucun. Aucun
orphelin dans un sens ni dans l'autre.

`jxh` est bien une **fin** de tour, et cette fois par causalité et non par
corrélation : un clic réel sur « Passer » à 72526 ms a produit le `jxh` portant
notre characterId à 72560 ms, 34 ms plus tard.

**Le tour ne s'ouvre pas à l'instant du `jxh` précédent** : le serveur l'ouvre
environ 400 ms plus tard. Tous les `jxy` partis à l'instant du `jxh` ont été
ignorés, sans exception. C'est ce décalage, et lui seul, qui a fait échouer le
passe-tour pendant une semaine — visible seulement sur les personnages qui ne
jouent pas en premier, d'où le faux diagnostic « ça marche en solo, pas en
groupe ».

**La leçon de méthode :** `jxh` a été lu tour à tour comme un début et comme
une fin, et les deux lectures expliquaient aussi bien les intervalles observés.
Un journal fait uniquement de trames **entrantes** ne peut pas trancher. Ce qui
tranche est un geste dont on connaît l'effet — un clic manuel — parce que le
serveur, lui, ne se trompe pas sur ce qu'il accepte.

## Le besoin

Sur un compte mené en combat sans devoir agir — une mule — passer le tour
automatiquement dès qu'il commence. Un interrupteur par compte, plus un
interrupteur général, dans l'application déjà livrée.

L'interface reprend deux icônes du launcher de krm35 : l'astérisque à six
branches pour le OMNI, le cercle barré pour le passe-tour.

## Les deux messages, identifiés

Mesurés le 20/08 sur deux combats indépendants, en écoutant le proxy du
launcher de krm35 pendant que son autopasse tournait.

| message | sens | rôle |
|---|---|---|
| **`jxy`** (vide) | sortant | **passer le tour** |
| `jxh { 2: characterId }` | entrant | **fin** du tour de ce personnage |
| `jxz { 2: N }` | entrant | compteur de tours, diffusé à tous |

Établis le 20/08 sur les **octets bruts** d'un combat réel, après trois
conclusions fausses tirées de trames décodées. Le détail suit.

## Trois erreurs, et ce qui les a produites

| affirmé | réalité | cause |
|---|---|---|
| `jti { 2: 12 }` passe le tour | le client l'émet à **chaque** fin de tour, sans effet | corrélation prise pour causalité chez krm35 |
| `jxh` annonce le **début** du tour | il annonce sa **fin** | jamais confronté à la durée réelle des tours |
| un passe-tour mal placé fait perdre son tour à un allié | `jxy` n'a **pas de cible** | risque supposé, jamais vérifié |

La cause commune : toutes ces analyses portaient sur des trames **décodées**,
et le décodeur écarte en silence ce qu'il ne comprend pas. `jxy` n'apparaissait
dans aucun de mes relevés. Il a fallu repartir des octets pour le voir.

## La preuve

Capture intégrale d'un combat, l'utilisateur cliquant « Passer » deux fois :

```
jxy dans toute la capture : 2 occurrences, deux requetes du client

  t+ 73750ms  ->  tour termine 30 ms plus tard, apres 1,5 s
  t+329696ms  ->  tour termine 29 ms plus tard, apres 21,7 s

tous les autres tours : 36,0 s — le chronometre complet, aucun jxy
```

La trame, en entier :

```
12 22  0a 15  0a 13 "type.ankama.com/jxy"  10 ff ff ff ff ff ff ff ff ff 01
= request { content: Any{ type_url: "jxy" }, uid: -1 }
```

**Aucune charge utile.** Rien à préciser pour passer son tour.

## Ce que cela change dans la conception

**Le garde-fou central n'a plus d'objet.** `jxy` ne désigne aucune cible : le
serveur ne peut l'appliquer qu'au tour de l'expéditeur. Il est donc impossible
de faire perdre son tour à un allié. Toute la mécanique d'annulation de
minuteur protégeait contre un risque inexistant.

**Le déclencheur reste à établir.** `jxh { characterId }` marque la **fin** du
tour, donc s'en servir émet toujours trop tard — c'est exactement pourquoi
l'implémentation actuelle n'a aucun effet. Dans les combats mesurés, le tour du
joueur commence juste après `jxz`, mais `jxz` est diffusé une fois par tour de
combat et non par joueur : à valider sur un combat de groupe avant de s'en
servir.

En attendant, une propriété rend l'affaire tolérante : un `jxy` émis hors tour
étant simplement ignoré, un déclencheur imprécis coûte des trames inutiles,
pas une erreur de jeu.

### `jxz` est diffusé, pas personnel — hypothèse démentie

En combat solo, chaque `jxz` était suivi d'une passe : j'en avais conclu que le
serveur n'annonçait que notre propre tour, et que recevoir `jxz` suffisait.

**Un combat à deux personnages a démenti cette conclusion.** Les deux clients
ont reçu `jxz` pour les tours 1 à 5 **aux mêmes instants** :

```
             Spoony      Michtou
jxz {2: 1}   29,0 s      29,0 s
jxz {2: 2}   33,9 s      33,9 s
jxz {2: 3}   39,8 s      39,7 s
jxz {2: 4}   44,3 s      44,2 s
jxz {2: 5}   48,3 s      48,2 s
```

Un dénombrement par charge utile le confirme : sur cette fenêtre, `jxz` a cinq
charges **toutes communes** aux deux comptes, aucune propre à l'un d'eux.

`jxz { 2: N }` est donc le **compteur de tours du combat**, diffusé à tous les
participants. Implémenter « recevoir `jxz` suffit » ferait passer son tour à
chaque compte dès que n'importe quel combattant commence le sien.

La coïncidence en solo s'explique d'elle-même : avec un seul personnage
contrôlé, tout tour annoncé était effectivement le sien.

### Le vrai signal : `jxh { 2: characterId }`

Trouvé sur le même combat à deux, en observant le compte dont l'autopasse de
krm35 était actif. Seize millisecondes avant **chacune** de ses quatre passes :

```
-16 ms   event    jxh { 2: 677057659174 }
  0 ms   request  jti { 1: 1, 2: 12 }
```

`677057659174` est exactement le `characterId` de ce compte — la valeur déjà
identifiée le 19/08 dans `kvw` et dans le champ `fsor` de `HavenBagEnterRequest`.

**`jxh { 2: N }` annonce le début du tour du personnage N.** Il est diffusé aux
deux clients, mais il porte l'identifiant concerné :

```
Spoony reçoit :   12x 665809125670 (lui)   8x 677057659174   7x -1
Michtou reçoit :  12x 665809125670          7x 677057659174   5x -1
```

`-1` correspond aux tours des monstres. Chaque client filtre donc sur **son
propre** `characterId`, que `EtatCompte` apprend déjà de `kvw`.

Le `characterId` que la première version de cette conception avait retiré des
conditions est donc nécessaire. C'était la simplification qui était fausse, pas
la conception d'origine.

### La requête est `jti { 1: 1, 2: 12 }`

C'est ce qu'émet l'autopasse de krm35, et l'effet est vérifiable : le compteur
`jxz` s'incrémente 100 ms plus tard, quatre fois de suite.

```
29,0s  jxz 1
33,8s  jti 12  ->  33,9s  jxz 2
39,7s  jti 12  ->  39,7s  jxz 3
44,1s  jti 12  ->  44,2s  jxz 4
48,2s  jti 12  ->  48,2s  jxz 5
```

**Question laissée ouverte :** en combat solo, c'est `jti { 2: 31 }` qui suivait
chaque tour, jamais `12`. Les deux codes semblent terminer un tour — sans doute
deux chemins d'interface différents. On retient **12**, le seul dont on ait
observé l'effet sur un automate qui fonctionne.

`jti` est un message générique dont le champ 2 est un code d'action : on l'a vu
porter 3, 4, 7, 8, 13 et 16 pour d'autres gestes en combat.

## La seule voie praticable

Réagir à la trame entrante et émettre la requête de fin de tour par notre proxy
— le mécanisme déjà validé du OMNI.

Les deux autres voies sont écartées sur mesure, pas sur intuition :

- **Simuler une touche ou un clic** : Dofus 3 ignore toute entrée injectée, y
  compris par scan code (mesuré le 18/08, `docs/.../2026-08-18-conclusion-interception-dofus3.md`).
- **Appeler le code du jeu par IL2CPP** : possible, mais fragile et inutile
  puisque nous possédons le proxy.

## Architecture

**Un module `src/passeur.js`**, jumeau de `src/duplicateur.js` : une fabrique
qui reçoit le superviseur et un rappel de compte rendu, et rend une fonction
`onTrame`. Ni Electron, ni Frida, ni système — testable seul.

Le superviseur n'accepte aujourd'hui qu'un seul `onTrame`. Les deux fonctions
doivent coexister : `desktop/main.js` et `src/cli/mm.js` composeront les deux
fabriques en une seule fonction, plutôt que d'ajouter un second point d'entrée
au superviseur. Le moteur reste inchangé.

### Règle de déclenchement

```
trame ENTRANTE jxh dont le champ 2 vaut le characterId de CE compte,
passe-tour actif pour ce compte ET en général
    -> armer un minuteur au délai réglé
    -> à l'échéance : émettre jti { 1: 1, 2: 12 } sur CE client
```

### Le garde-fou

La requête de fin de tour ne portera vraisemblablement aucun identifiant de
tour. Un envoi tardif passerait donc le tour **d'un autre personnage**.

Donc : **toute nouvelle annonce de tour, et toute fin de combat, annulent le
minuteur en attente.** Un seul minuteur par compte à la fois ; en armer un
second annule le premier.

C'est la seule fonction du projet dont un échec coûte quelque chose en jeu.
Le OMNI qui rate une action ne fait rien ; un passe-tour qui part au
mauvais moment fait perdre un tour.

### Conditions d'émission

Trois conditions, toutes vérifiées avant d'écrire quoi que ce soit :

1. la trame entrante est un `jxh` ;
2. son champ 2 vaut le `characterId` de ce compte ;
3. le passe-tour est actif pour ce compte et en général.

La deuxième est celle qui empêche de passer le tour d'un autre combattant. Sans
elle — en se contentant de `jxz` — chaque compte passerait dès que n'importe
qui commence son tour.

Le `characterId` est appris de `kvw` à la connexion. Tant qu'il est inconnu,
rien n'est émis et la raison remonte à l'interface.

La requête est **constante** : `jti { 1: 1, 2: 12 }`. Aucun numéro de tour ni
identifiant n'y figure.

## Interface

Chaque ligne de compte porte deux interrupteurs :

```
┌──────────────────────────────────────────────────────────────────┐
│  OMNI ●   Passe-tour ●   délai [0,0 s]     4 comptes en jeu │
├──────────────────────────────────────────────────────────────────┤
│ ★  ◉✳  ◉⊘   BrokenLegs   Spoony — Pandawa       maître           │
│ ★  ◉✳  ◯⊘   squeezie     Swaggman — Cra         suit             │
│ ☆  ◯✳  ◉⊘   yoplait      Ozamiz — Iop           suit             │
│ ★  ◯✳  ◯⊘   HamMed       Lisala — Eni    ⚠ non intercepté        │
│ ☆            sbwoufeuw   —                      hors ligne       │
└──────────────────────────────────────────────────────────────────┘
```

- **Icônes** redessinées en SVG en ligne d'après le launcher de krm35 :
  astérisque à six branches (OMNI), cercle barré (passe-tour). Aucun
  fichier image, aucune dépendance ; la couleur suit le thème.
- **Deux interrupteurs généraux** en en-tête, un par fonction. Un compte
  n'agit que si le général **et** son interrupteur de ligne sont actifs — un
  coupe-circuit immédiat qui ne perd pas les réglages par compte.
- **Délai global**, en secondes avec une décimale, `0` = instantané. Un seul
  réglage pour tous les comptes : aucun cas d'usage ne justifie une colonne de
  plus.
- **Interrupteurs désactivés** sur les lignes non interceptées (hors ligne,
  non intercepté, erreur). Une case qui ne peut rien faire est une promesse
  fausse.

L'exclusion du OMNI, aujourd'hui portée par `EtatCompte.exclu`, devient
l'interrupteur ✳ de la ligne — même champ, nouvelle représentation. Le
passe-tour reçoit son propre champ, symétrique.

Les six autres icônes du launcher de krm35 ne sont pas reprises : elles ne
correspondent à aucune fonction demandée, et dessiner des boutons qui ne
branchent sur rien serait trompeur.

## Persistance

Les interrupteurs par compte suivent le sort des favoris : enregistrés dans le
fichier de réglages de l'application, qui ne contient **que** des identifiants
numériques de compte et des booléens. Ni login, ni jeton.

Le délai global y est également conservé.

## Tests

Sans jeu ni interface, sur `src/passeur.js` :

- une trame entrante d'un autre type ne déclenche rien ;
- une seconde annonce `jxz` annule le minuteur en attente ;
- un délai de 0 émet immédiatement ;
- un compte dont l'interrupteur est éteint ne déclenche pas ;
- l'interrupteur général éteint neutralise tous les comptes ;
- deux comptes en combat simultané arment deux minuteurs indépendants ;
- la trame émise est exactement `jti { 1: 1, 2: 31 }`, encodée puis relue.

Sur la composition : `src/cli/mm.js` et `desktop/main.js` appellent bien les
deux fabriques, et le comportement du OMNI reste inchangé.

Les 159 tests existants restent verts.

## Ordre de réalisation

| | |
|---|---|
| ~~1~~ | ~~Session de mesure~~ — **faite le 20/08**, les deux messages sont identifiés |
| **1** | Implémentation du `passeur`, des interrupteurs et de la persistance |
| **2** | Essai en conditions réelles, sur un combat |

## Risques connus

- **Le délai augmente le risque.** Chaque dixième de seconde ajouté est un
  moment pendant lequel l'état du combat peut changer. Le garde-fou couvre le
  cas nominal ; un délai long reste déconseillé.
- **Deux codes terminent apparemment un tour.** `12` est celui de l'autopasse
  de krm35, mesuré et retenu ; `31` apparaissait en combat solo. La différence
  n'est pas expliquée. Si `12` se révélait refusé dans un contexte particulier,
  `31` est la première chose à essayer.
- **`jti` est un message générique.** Se tromper de code n'échoue pas
  silencieusement : cela déclenche une autre action en combat. C'est une raison
  de plus de n'émettre que sur la condition vérifiée.
- Le passe-tour agit sur un compte qui joue réellement : contrairement au
  OMNI, une erreur a une conséquence en jeu.
