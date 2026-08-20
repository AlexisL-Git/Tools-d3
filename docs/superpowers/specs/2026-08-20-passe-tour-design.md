# Passe-tour automatique en combat

**Date :** 2026-08-20
**Statut :** conception validée, non implémentée. Deux messages du protocole
restent à identifier par mesure.

## Le besoin

Sur un compte mené en combat sans devoir agir — une mule — passer le tour
automatiquement dès qu'il commence. Un interrupteur par compte, plus un
interrupteur général, dans l'application déjà livrée.

L'interface reprend deux icônes du launcher de krm35 : l'astérisque à six
branches pour le Replicate, le cercle barré pour le passe-tour.

## Les deux messages, identifiés

Mesurés le 20/08 sur deux combats indépendants, en écoutant le proxy du
launcher de krm35 pendant que son autopasse tournait.

| message | sens | rôle |
|---|---|---|
| `jxz { 2: N }` | entrant | début du tour **N**, compteur incrémenté de 1 en 1 |
| `jti { 1: 1, 2: 31 }` | sortant | **passer le tour** |
| `jyj` (vide) | entrant | acquittement du serveur, 8 ms après |

Corrélation du second combat, cinq tours :

```
64,9s  jxz {2: 2}   ->  65,0s  jti {1:1, 2:31}
68,7s  jxz {2: 3}   ->  68,8s  jti {1:1, 2:31}
72,4s  jxz {2: 4}   ->  72,4s  jti {1:1, 2:31}
76,7s  jxz {2: 5}   ->  76,7s  jti {1:1, 2:31}
```

Le premier combat, quarante tours, donne exactement le même motif.

**`jti` est un message générique dont le champ 2 est un code d'action** — on l'a
vu porter 7, 13, 15 et 16 dans d'autres contextes. `31` est le code du passage
de tour.

### Deux conséquences pour la conception

**Le serveur n'annonce que NOTRE tour.** Chaque `jxz` est suivi d'une passe,
sans exception, sur les deux combats. Les tours des autres combattants ne sont
pas annoncés par ce message. Il n'y a donc **aucun identifiant de personnage à
vérifier** : recevoir `jxz` suffit à savoir que c'est à nous.

C'est plus simple que ce que la conception initiale supposait, et cela retire
une condition d'émission.

**L'écart annonce → passe est de 0 à 100 ms** chez krm35. C'est un temps de
machine, et c'est la signature de son automatisation.

## La seule voie praticable

Réagir à la trame entrante et émettre la requête de fin de tour par notre proxy
— le mécanisme déjà validé du Replicate.

Les deux autres voies sont écartées sur mesure, pas sur intuition :

- **Simuler une touche ou un clic** : Dofus 3 ignore toute entrée injectée, y
  compris par scan code (mesuré le 18/08, `docs/.../2026-08-18-conclusion-interception-dofus3.md`).
- **Appeler le code du jeu par IL2CPP** : possible, mais fragile et inutile
  puisque nous possédons le proxy.

## Architecture

**Un module `src/passeur.js`**, jumeau de `src/replicateur.js` : une fabrique
qui reçoit le superviseur et un rappel de compte rendu, et rend une fonction
`onTrame`. Ni Electron, ni Frida, ni système — testable seul.

Le superviseur n'accepte aujourd'hui qu'un seul `onTrame`. Les deux fonctions
doivent coexister : `desktop/main.js` et `src/cli/mm.js` composeront les deux
fabriques en une seule fonction, plutôt que d'ajouter un second point d'entrée
au superviseur. Le moteur reste inchangé.

### Règle de déclenchement

```
trame ENTRANTE jxz, passe-tour actif pour ce compte ET en général
    -> armer un minuteur au délai réglé
    -> à l'échéance : émettre jti { 1: 1, 2: 31 } sur CE client
```

### Le garde-fou

La requête de fin de tour ne portera vraisemblablement aucun identifiant de
tour. Un envoi tardif passerait donc le tour **d'un autre personnage**.

Donc : **toute nouvelle annonce de tour, et toute fin de combat, annulent le
minuteur en attente.** Un seul minuteur par compte à la fois ; en armer un
second annule le premier.

C'est la seule fonction du projet dont un échec coûte quelque chose en jeu.
Le Replicate qui rate une action ne fait rien ; un passe-tour qui part au
mauvais moment fait perdre un tour.

### Conditions d'émission

Deux conditions, et non trois : la vérification du personnage tombe, puisque le
serveur n'annonce que notre propre tour.

1. la trame entrante est un `jxz` ;
2. le passe-tour est actif pour ce compte et en général.

Le `characterId` n'est pas nécessaire — c'est une simplification acquise par la
mesure, pas une négligence.

Le numéro de tour porté par `jxz` n'est **pas** repris dans la requête : `jti`
est constant, `{ 1: 1, 2: 31 }`, sur les quarante-cinq passes observées. On
émet donc une trame fixe.

## Interface

Chaque ligne de compte porte deux interrupteurs :

```
┌──────────────────────────────────────────────────────────────────┐
│  Replicate ●   Passe-tour ●   délai [0,0 s]     4 comptes en jeu │
├──────────────────────────────────────────────────────────────────┤
│ ★  ◉✳  ◉⊘   BrokenLegs   Spoony — Pandawa       maître           │
│ ★  ◉✳  ◯⊘   squeezie     Swaggman — Cra         suit             │
│ ☆  ◯✳  ◉⊘   yoplait      Ozamiz — Iop           suit             │
│ ★  ◯✳  ◯⊘   HamMed       Lisala — Eni    ⚠ non intercepté        │
│ ☆            sbwoufeuw   —                      hors ligne       │
└──────────────────────────────────────────────────────────────────┘
```

- **Icônes** redessinées en SVG en ligne d'après le launcher de krm35 :
  astérisque à six branches (Replicate), cercle barré (passe-tour). Aucun
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

L'exclusion du Replicate, aujourd'hui portée par `EtatCompte.exclu`, devient
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
deux fabriques, et le comportement du Replicate reste inchangé.

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
- **`jxz` n'a été observé qu'en combat contre un poutch et un monstre isolé.**
  Rien ne garantit encore qu'un combat à plusieurs joueurs, ou en arène, ne
  l'émette pas aussi pour d'autres combattants. Si c'était le cas, la
  condition « recevoir `jxz` suffit » tomberait et il faudrait un critère
  supplémentaire. À vérifier lors du premier combat de groupe.
- Le passe-tour agit sur un compte qui joue réellement : contrairement au
  Replicate, une erreur a une conséquence en jeu.
