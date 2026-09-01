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
| `1` | la **cellule** occupée sur la carte (0 à 559) |
| `2` | l'**orientation** de l'acteur (0 à 7) |
| `3` | l'identifiant : **négatif** pour un monstre, **le `characterId`** pour un joueur |

> **CORRECTION DU 2026-09-01, APRÈS ESSAI EN JEU.** Ce tableau a d'abord été lu
> de travers, et l'erreur a coûté un premier essai raté. Les champs 1 et 2
> avaient été pris pour « apparence » et « type d'acteur », avec la règle
> « `7` = monstre, `3` = joueur ». **C'était une coïncidence** : dans le combat
> mesuré, les cinq monstres regardaient tous dans la direction 7 et les deux
> joueurs dans la direction 3.
>
> La contre-preuve, deuxième séance, maître `676438999334` et mule
> `677048221990` :
>
> ```
>  40217ms [mule] <-- kmk { 2={1=200 2=7 3=-1} 2={1=203 2=5 3=-2}
>                           2={1=262 2=5 3=-3} 2={1=303 2=5 3=-4}
>                           2={1=204 2=5 3=677048221990} }
>  59422ms [mule] <-- kmk { … 2={1=188 2=1 3=676438999334}
>                             2={1=204 2=5 3=677048221990} }
> ```
>
> Des monstres à `2=7` **et** à `2=5`, la mule à `2=5`, le maître à `2=1`.
> Aucune entrée à `2=3`. Le champ 2 est une orientation, le champ 1 une cellule
> — les deux tiennent dans les bornes qu'on attend d'eux (0-7 et 0-559) sur
> toutes les mesures.
>
> **Ce qui distingue vraiment un joueur d'un monstre : le signe du champ 3.**

**Une seule `kmk` pour tout le combat** (vérifié : aucune autre entre `87463` et
l'abandon à `90873`), et elle porte la liste complète. Elle se reçoit **parce
qu'on est dans le combat**, pas parce qu'on le voit.

D'où la règle retenue, décidée par l'utilisateur le 2026-09-01 :

> Un client retient l'ensemble des identifiants (champ 3) de sa dernière `kmk`
> **de combat**. Une mule abandonne avec le maître si cet ensemble contient le
> `characterId` du maître.

Une `kmk` est reconnue comme liste **de combat** si elle porte au moins un
identifiant **négatif** — un monstre. Sinon elle est ignorée et ne remplace
rien : `kmk` sert aussi à lister les acteurs d'une **carte**, et une telle liste
nomme le maître sans qu'il combatte avec personne.

**Limite assumée :** un combat joueur contre joueur, sans le moindre monstre,
ne déclenchera pas l'abandon groupé. C'est un abandon raté, jamais un abandon
de trop — la direction dans laquelle on préfère se tromper.

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

## 6. Vérification en jeu du 2026-09-01

Session OMNI de `01:05:41Z`, maître pid `10360` (`676438999334`), mule pid
`17788` (`677048221990`), replicate armé.

**Combat ordinaire — ça marche, et l'utilisateur l'a vu à l'écran :**

```
519602ms [17788] abandon : replique chez la mule
519602ms [10360] cap : --> request kme {  }
519632ms [10360] cap :  <-- event jzu { 2={3={2=-2}} 2={3={2=677048221990}}
                                        2={3={2=-1}} }
```

La réplication part **dans la même milliseconde** que l'abandon du maître.

**Le premier essai, lui, avait échoué** — et c'est lui qui a tout appris. Aucune
ligne `abandon :`, parce que le critère reposait sur une coïncidence
d'orientation (voir la correction en section 4). Ni les 16 tests unitaires ni
deux revues de code n'auraient pu la contredire : ils validaient fidèlement une
mauvaise lecture du protocole. **Seul l'essai en jeu pouvait la détruire.**

## 7. Le combat de quête, vérifié en jeu — et `ieb` retrouvé

Essayé le 2026-09-01, même session. **Le cas mesuré est plus dur que celui
attendu** : la mule n'était pas oisive, elle était dans **son propre** combat de
quête, ouvert 6,5 s après celui du maître.

```
745026ms [10360 maitre] <-- kmk { 2={1=469 2=5 3=676438999334} 2={1=327 2=1 3=-1} }
751506ms [17788 mule]   <-- kmk { 2={1=469 2=5 3=677048221990} 2={1=327 2=1 3=-1} }
760433ms [10360 maitre] --> request kme {  }        le maitre abandonne
                                                    AUCUNE ligne « abandon : »
766395ms [17788 mule]   --> request kme {  }        a la main, 6 s plus tard
```

Deux combats, deux listes, **et le maître n'est pas dans celle de la mule**. Le
critère a donc écarté la mule pour la bonne raison : un fait mesuré, pas une
supposition sur la nature du combat. Rien n'est parti.

**`ieb` EXISTE, et la garde combat marche toujours.** Il ne se montre que sur un
combat de quête — ce qui explique son absence des trois sessions précédentes,
toutes des attaques ordinaires :

```
744997ms [10360] garde combat : 1 rejeu(x) annule(s)
744998ms [10360] garde combat : ioy:25088 retenue (+29 ms)
744998ms [10360] cap :  <-- event ieb { 1=1642 2=9828 }
```

Le doute levé : `src/garde-combat.js` a bien son signal. Sa limite connue reste
visible dans le même journal — un rejeu de `ioy` était **déjà parti** à
`744892 ms` avant que la garde n'annule le suivant à `744997 ms`. C'est la
première occurrence qui passe, et c'est précisément ce que l'apprentissage
(`ioy:25088 retenue`) empêche de se reproduire.

**Note sur `ieb { 1=1642 2=9828 }` :** les deux clients reçoivent les **mêmes**
valeurs alors qu'ils sont dans **deux combats différents**. Ce ne sont donc pas
des identifiants de combat, contrairement à ce que supposait la note du 28/08
(« champ 2 incrémenté d'un combat à l'autre ») — `9828` est réapparu tel quel
quatre jours plus tard. Sans conséquence ici : la garde combat ne lit pas ces
champs, elle se contente du type `ieb`.

## 8. Ce qui reste sans preuve

- **La sortie pendant la phase de placement** : jamais essayée, et **l'utilisateur
  a dit le 2026-09-01 qu'il n'en avait pas besoin**. Le cas est donc clos, pas en
  attente : ne pas rouvrir de mesure là-dessus sans qu'il le demande. Si un jour
  il quitte en placement et que les mules ne suivent pas, c'est ici qu'il faudra
  regarder — `TYPES_ABANDON` n'a qu'une entrée, `kme`, et rien ne dit que la
  sortie de placement passe par elle.
- **La fin normale d'un combat** (victoire, défaite) : aucune trame de fin
  mesurée, et aucune utilisée — chaque `kmk` de combat remplace la précédente.
- **Un combat joueur contre joueur**, sans monstre : par construction, l'abandon
  groupé ne s'y déclenchera pas.
