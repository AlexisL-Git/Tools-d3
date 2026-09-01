# Les trames de l'abandon de combat, mesurées

**Date :** 2026-09-01, deux sessions de capture (`OMNI_CAPTURE=1`).
**Journaux :** `journal-dev.mesure1.log` (capture au premier niveau),
`journal-dev.mesure2.log` (capture à deux niveaux — c'est elle qui a tout montré).

Session 2 : maître pid `26784` (characterId `676438999334`), mule pid `23436`
(characterId `677048221990`). Un combat ordinaire, les deux dedans, le maître
abandonne, la mule reste.

## 1. L'abandon : `kme`, requête sortante et vide

```
 90873ms [26784] cap : --> request kme {  }
 90902ms [23436] cap :  <-- event jzu { 2={3={2=-1}} 2={3={2=677048221990}}
                                        2={3={2=-5}} 2={3={2=-4}}
                                        2={3={2=-3}} 2={3={2=-2}} }
```

29 ms après le `kme` du maître, la mule reçoit la liste des combattants
restants : elle-même et les cinq monstres. **Le maître n'y est plus.** La mule,
elle, continue de jouer ses tours (`jxz` passe à 2, 3, puis 4).

`kme` ne porte **aucun champ**, comme `kla` (fermeture de dialogue). Elle se
ré-émet donc telle quelle : rien dedans n'appartient au compte émetteur.

Trois autres occurrences dans la session 1 confirment le sens — chacune suivie
à +30 ms de `kwl { 1=n }` puis d'une rafale de `jya` (caractéristiques
recalculées) **pour le seul personnage émetteur**, ce qui est exactement ce que
produit une sortie de combat :

```
182407ms [4368  mule]   --> request kme {  }
186336ms [8748  maitre] --> request kme {  }
265716ms [8748  maitre] --> request kme {  }
```

## 2. `ieb` N'EXISTE PAS dans ces sessions

**Zéro occurrence** sur 2305 lignes de la session 1 (deux combats réels) et
993 lignes de la session 2. C'est la trame sur laquelle repose
`src/garde-combat.js`, mesurée le 28/08 sur des **combats de quête**.

Sur une attaque ordinaire, l'entrée en combat passe par tout autre chose :

```
 82810ms [26784] cap : --> request hqa { 1=-20010 }     le maitre attaque le groupe
 82839ms [26784] cap :  <-- event jsn { 1={1={1=437 2=5} 2={…} 3=-20010} }
 82840ms [23436] cap :  <-- event hpy { 1={… 3={3=676438999334 4=1 …}
                                           3={2=1 3=-20010 …} … 6=198} }
```

**Ce que cela ne dit PAS :** que la garde combat est cassée. Elle a été mesurée
sur des combats de quête, qui ne s'ouvrent pas de la même façon. **À vérifier
séparément**, avec un combat de quête sous capture — ce n'est pas l'objet de
ce document, et rien n'a été touché dans `src/garde-combat.js`.

## 3. Le numéro de combat existe — et il ne suffit pas

```
 82840ms [23436] cap :  <-- event kau { 3=1 4=1 5=198 }
 82868ms [26784] cap :  <-- event kau { 3=1 4=1 5=198 }
```

Le champ 5 porte le numéro du combat, **le même chez les deux clients** (198
ici ; 90 et 197 sur d'autres combats de la session 1).

**Écarté comme critère.** Session 1, à `93471 ms`, les deux clients reçoivent
`kau { 3=1 4=1 5=90 }` en **arrivant sur une carte**, sans être dans le moindre
combat : `kau` est diffusé à qui *voit* un combat. Un numéro reçu ne prouve pas
qu'on y participe.

## 4. LE CRITÈRE : la liste des combattants, `kmk`

Au démarrage du combat, **une seule** trame `kmk`, **identique chez les deux
clients** :

```
 87463ms [23436] cap :  <-- event kmk { 2={1=428 2=7 3=-1}
                                        2={1=384 2=7 3=-2}
                                        2={1=383 2=7 3=-3}
                                        2={1=411 2=7 3=-4}
                                        2={1=455 2=7 3=-5}
                                        2={1=274 2=3 3=676438999334}
                                        2={1=217 2=3 3=677048221990} }
 87463ms [26784] cap :  <-- event kmk { … octet pour octet la meme … }
```

Un combattant par entrée répétée au champ 2 :

| champ | sens |
|---|---|
| `1` | apparence / modèle, sans intérêt ici |
| `2` | **le type** : `7` = monstre, `3` = joueur, `1` = acteur de carte (hors combat) |
| `3` | l'identifiant : négatif pour un monstre, **le `characterId`** pour un joueur |

**Une seule `kmk` pour tout le combat** (vérifié : aucune autre entre `87463` et
l'abandon à `90873`), et elle porte la liste complète. Elle se reçoit **parce
qu'on est dans le combat**, pas parce qu'on le voit.

D'où la règle retenue, décidée par l'utilisateur le 2026-09-01 :

> Un client retient l'ensemble des `characterId` des entrées de type `2=3` de sa
> dernière `kmk`. Une mule abandonne avec le maître si cet ensemble contient le
> `characterId` du maître.

Une `kmk` sans aucune entrée de type `3` (liste d'acteurs de carte) est ignorée
et ne remplace rien.

**Le combat de quête est couvert sans cas particulier :** le maître y est seul,
sa `kmk` ne nomme que lui, et la mule n'en reçoit aucune. Rien ne part.

## 5. Ce qui n'a pas été mesuré

- **La fin normale d'un combat** (victoire, défaite). La mule combattait encore
  à la dernière ligne du journal. Aucune trame de fin n'a donc été vue, et
  aucune n'est utilisée : l'ensemble d'un client est **remplacé** à chaque
  nouvelle `kmk` de combat, ce qui suffit — un combat neuf écrase le précédent.
- **La sortie pendant la phase de placement.** L'hypothèse est que c'est la même
  `kme` ; à confirmer lors de la vérification en jeu.
- **`hpy`**, reçue par la mule à l'entrée avec la composition du combat et le
  numéro `6=198`. Non exploitée : `kmk` dit la même chose plus simplement.
