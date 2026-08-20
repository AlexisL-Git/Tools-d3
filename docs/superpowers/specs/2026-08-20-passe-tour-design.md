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

## Ce qui manque, et pourquoi on commence par là

Le dépôt ne connaît **rien** du combat. Les neuf types de
`src/protocol/replicate.js` sont tous de l'interaction ou du déplacement.

Deux messages sont nécessaires, aucun n'a jamais été observé :

| sens | rôle |
|---|---|
| entrant | le serveur annonce le début d'un tour, et de quel personnage |
| sortant | la requête émise quand le joueur clique « Passer » |

Ils se trouvent par corrélation, comme le `jss` des zaaps le 19/08 : l'utilisateur
combat et passe des tours à la main pendant que l'application enregistre les deux
sens ; on cherche ensuite le message sortant émis au moment du clic, puis
l'entrant qui le précède et porte un identifiant de personnage.

**L'implémentation ne peut pas commencer avant.** Écrire le module autour de
noms inventés, pour les remplacer ensuite, reviendrait à coder deux fois.

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
trame ENTRANTE, type « début de tour », personnage = celui de ce compte,
passe-tour actif pour ce compte ET en général
    -> armer un minuteur au délai réglé
    -> à l'échéance : émettre la requête de fin de tour sur CE client
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

Trois conditions, toutes vérifiées avant d'écrire quoi que ce soit :

1. le type entrant est reconnu comme une annonce de début de tour ;
2. le `characterId` du compte est connu (appris de `kvw` à la connexion) ;
3. le tour annoncé est bien celui de ce personnage.

Si l'une manque, rien n'est émis et la raison remonte à l'interface — même
principe que `peutRejouer()`.

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

- une annonce de tour d'un autre personnage ne déclenche rien ;
- une seconde annonce annule le minuteur en attente ;
- une fin de combat annule le minuteur en attente ;
- un délai de 0 émet immédiatement ;
- un compte dont l'interrupteur est éteint ne déclenche pas ;
- un compte dont le `characterId` est inconnu ne déclenche pas, et la raison
  est rendue ;
- deux comptes en combat simultané arment deux minuteurs indépendants.

Sur la composition : `src/cli/mm.js` et `desktop/main.js` appellent bien les
deux fabriques, et le comportement du Replicate reste inchangé.

Les 159 tests existants restent verts.

## Ordre de réalisation

| | |
|---|---|
| **1** | Session de mesure : identifier les deux messages par corrélation |
| **2** | Implémentation du `passeur`, des interrupteurs et de la persistance |
| **3** | Essai en conditions réelles, sur un combat |

## Risques connus

- **Le délai augmente le risque.** Chaque dixième de seconde ajouté est un
  moment pendant lequel l'état du combat peut changer. Le garde-fou couvre le
  cas nominal ; un délai long reste déconseillé.
- **L'annonce de début de tour n'a peut-être pas la forme attendue.** Si elle
  ne porte pas d'identifiant de personnage exploitable, il faudra une autre
  source pour savoir de quel tour il s'agit. À trancher sur les mesures, pas
  avant.
- Le passe-tour agit sur un compte qui joue réellement : contrairement au
  Replicate, une erreur a une conséquence en jeu.
