# Le coût de la pépite, et les 50 meilleurs objets à recycler

**Date :** 2026-09-11
**Statut :** conception validée, non implémentée.
**Branche :** `feat/opti-pepite`.

## Le besoin

Recycler au prisme d'alliance transforme des objets en pépites. Chaque objet a
son taux, et ces taux vont de 0,0025 à 8 000 pépites l'unité — quatre décades
d'écart. Savoir lequel acheter pour obtenir une pépite au meilleur prix ne se
fait pas de tête sur 4 049 objets.

Deux choses, donc :

1. **Dire le coût en kamas d'une pépite** pour n'importe quel objet recyclable.
2. **Tenir à jour, toutes les 12 heures, les 50 meilleurs** au sens de ce coût.

## Ce qui est décidé

Six choix de Jibef, le 2026-09-11 :

1. **Le classement se calcule sur `ivi` seule**, les prix moyens reçus au login.
   Pas de lecture du marché réel : elle coûterait un personnage planté devant
   l'hôtel de vente et des centaines d'émissions à chaque passe.
2. **Le critère est le coût par pépite**, du moins cher au plus cher. Pas de
   score composite, pas de pondération par le volume.
3. **La minuterie de 12 h existe, et l'historique est conservé.**
4. **La fenêtre porte une recherche libre** sur tout le catalogue recyclable et
   **une colonne de variation** depuis la passe précédente. Pas de croisement
   avec l'inventaire.
5. **Rien n'est écarté du classement.** Un prix douteux est marqué, jamais caché.
6. **La valeur affichée est brute**, sans réglage du bonus de prisme.

## Ce qui est mesuré, et comment

### Le taux vit dans les données du jeu, pas dans une formule

Mesuré le 2026-09-11 sur les 21 776 objets de DofusDB :

| question | réponse |
|---|---|
| objets avec un taux > 0 | **4 049** |
| taux minimum | 0,0025 (Sac de Bois de Frêne) |
| taux médian | 0,125 |
| taux maximum | 8 000 (Amulette Ementaire Deluxe) |
| poids de `{gid: taux}` en JSON | **99 Ko** |

**Ce n'est pas une formule.** Sur les 513 groupes `(niveau, typeId)` comptant
au moins deux objets, **395 portent des taux différents** — le taux est une
donnée par objet. C'est le premier test qu'il fallait passer : une formule
aurait voulu dire que DofusDB calculait, donc qu'il pouvait calculer avec une
règle périmée.

### DofusDB est un miroir exact du client installé

Le champ ne suffisait pas ; il fallait la valeur. Le bundle du jeu a donc été
ouvert :

```
Dofus_Data\StreamingAssets\Content\Data\data_assets_itemsdataroot.asset.bundle
```

**UnityFS version 8, Unity 6000.3.16f1, un seul bloc en LZMA** — 588 Ko
compressés pour 16 242 588 octets. L'arbre de types y nomme `recyclingNuggets`
sur `ItemData` et `WeaponData`, exactement entre `visibilityCriterion` et
`favoriteRecyclingSubareas`, dans le même ordre que le JSON de DofusDB. Les
valeurs vivent dans le registre de références managées : `objectsById` ne porte
que des `rid`, et `references.RefIds` les résout — 66 374 entrées, dont 21 776
portent un `id` et un `recyclingNuggets`.

Comparaison des deux sources, objet par objet :

| | jeu | DofusDB |
|---|---|---|
| objets portant le champ | 21 776 | 21 776 |
| taux > 0 | 4 049 | 4 049 |
| valeurs identiques à 1e-9 | **21 776 / 21 776** | |
| écarts | **0** | |

**Une suspicion levée.** La Pierre Médicinale affiche `0.07114285714285715`,
qui n'est pas un artefact de `float32` — on pouvait croire à un calcul de
DofusDB. Le client porte la même valeur au bit près. Elle est authentique.

### Les taux bougent d'une version du jeu à l'autre

L'installation beta présente sur la machine de développement porte 21 654
objets contre 21 776 en live, **22 taux divergents**, 176 objets qu'elle seule
a et 298 qui lui manquent. Les deux installations sont sur des branches
différentes, et ce n'est pas une prévision de refonte : c'est la preuve que la
table figée peut se démoder.

D'où la conséquence portée par `taux.json` : **elle dit contre quelle version
du jeu elle a été vérifiée.**

### Ce qui n'est pas mesuré

**Combien des 4 049 objets recyclables ont un prix dans `ivi`.** Le dépôt ne
contient aucune capture d'`ivi` réelle, seulement des doubles de test. `ivi`
porte 9 861 paires, le catalogue recyclable en compte 4 049 : l'intersection
est quelque part entre les deux, et seule la première passe en jeu la dira.
Elle est journalisée pour cette raison.

## La règle

`classement.js`, fonction pure, deux entrées :

```
classer({ prixMoyens, limite = 50 }) -> [ ligne ]

ligne = { gid, taux, prixMoyen, coutParPepite, suspect }
```

`prixMoyens` est la `Map` rendue par `lirePrixMoyens()` de `src/hdv/trames.js`,
telle quelle — le classeur ne connaît pas les trames, et c'est ce qui le rend
testable sans double.

```
coutParPepite(gid) = prixMoyenUnitaire(gid) ÷ tauxDe(gid)
```

Entre au classement tout gid ayant **à la fois** un taux > 0 et un prix dans
`ivi`. Tri croissant sur le coût.

| départage | raison |
|---|---|
| à coût égal, le **taux le plus élevé** d'abord | même dépense, moins d'unités à trimballer |
| à taux égal, le **gid croissant** | le tri doit être total, sinon le test n'est pas déterministe |

On garde **50 lignes**.

### Le doute est un marqueur, jamais un filtre

`ivi` est une moyenne glissante du serveur. Sur un objet que plus personne ne
vend, elle reste figée sur une vieille transaction — et un objet à « 1 kama de
moyenne » sortirait premier tout en étant introuvable.

Une ligne dont le prix moyen unitaire vaut **10 kamas ou moins** est marquée
« prix suspect » et **reste à sa place**. Le seuil est arbitraire, et cette
spec le dit franchement ; ce qui le rend acceptable, c'est qu'il n'écarte rien.

**Un garde-fou par comparaison a été cherché, et abandonné.** Le champ `price`
de DofusDB — le prix de base de l'objet — aurait servi d'ancrage pour repérer
une moyenne aberrante. Il vaut **0 pour le Bois de Frêne et 1 pour la Pierre
Médicinale**, qui se négocie à 19 kamas l'unité (`2026-09-01-trames-hdv.md`).
Il ne mesure rien d'exploitable. Le seuil fruste est ce qui reste, et il est
honnête parce qu'il ne décide rien.

Un gid recyclable **absent d'`ivi`** n'a pas de coût calculable. Il n'entre pas
au classement, et la recherche libre répond « prix inconnu » plutôt que de
rendre un chiffre inventé.

### Le bonus de prisme n'entre pas dans le calcul

Le rendement réel au prisme est `taux × quantité × bonus d'alliance`. C'est un
multiplicateur **uniforme** : il ne change pas l'ordre du classement, seulement
le chiffre absolu. La valeur affichée est donc la valeur brute, et aucun
réglage n'est proposé — un champ à remplir avant le premier usage est un
réglage qu'on oublie, et qui ment ensuite.

### `ivi` est propre à un serveur

On garde la table la plus fraîche reçue, quel que soit le pid, et la fenêtre
affiche de quel personnage et de quand elle vient. **Limite connue :** deux
comptes sur deux serveurs différents donneraient le classement du dernier
connecté. Une fusion n'aurait aucun sens — les prix moyens de deux serveurs ne
se moyennent pas — et prétendre le contraire serait pire que la limite.

## Architecture

Six fichiers. Deux seulement portent de la logique, et ces deux-là sont purs :
`taux.js` et `classement.js`.

| fichier | nature | rôle |
|---|---|---|
| `src/pepites/taux.json` | table figée | `{gid: taux}`, 4 049 entrées, 99 Ko, plus la version du jeu vérifiée |
| `src/pepites/taux.js` | **pure** | `tauxDe(gid)` → nombre ou `null` |
| `src/pepites/classement.js` | **pure** | la règle de tri, et `comparer()` de deux passes |
| `src/pepites/historique.js` | disque seul | lit et écrit `pepites.json` dans `userData` |
| `src/pepites/pepites.js` | politique | mémorise `ivi`, tient la minuterie, appelle le classeur |
| `outils/faire-pepites.js` | hors production | fabrique `taux.json` depuis DofusDB |

`classement.js` porte la seule décision qui peut coûter des kamas — un tri
écrit à l'envers ferait acheter le pire objet en croyant prendre le meilleur.
Il est seul, pur, et se teste exhaustivement. C'est la raison d'être de
`src/hdv/stock.js` et de `src/pda-archi/tableau.js` : une règle qui vit dans du
HTML n'a pas de test.

`taux.js` rend `null` et jamais `0` pour un gid inconnu, pour la raison écrite
dans `objets.js` : `0` est un taux valide qu'on confondrait avec l'absence, et
une division par une absence doit éclater au grand jour.

`pepites.js` ressemble à `reprix.js` et `vente.js` par sa forme — une écoute
permanente plus un déclencheur — mais **il n'émet aucune trame**. Il lui manque
donc tout le reste : pas de séquenceur, pas de rythme, pas de délai de réponse,
pas de garde d'identité de client. C'est aussi ce qui rend la périodicité
inoffensive, alors que `2026-09-01-maj-prix-hdv-design.md` l'écartait
explicitement : ce qui était refusé là-bas, c'est une passe de fond **qui
émet**.

### `taux.json` se fabrique, et se vérifie

`faire-pepites.js` interroge DofusDB en JavaScript, même API et même pagination
à 50 que `faire-objets.js`, et n'a aucune dépendance nouvelle.

**La vérification contre le bundle du jeu reste un geste de développement, pas
une étape du tool.** Elle demande du LZMA et un parcours de références
managées ; l'outiller en JavaScript coûterait bien plus que ce qu'il rapporte
pour une donnée qui bouge à chaque version du jeu, pas à chaque lancement. La
méthode est consignée ici, elle se rejoue quand un doute apparaît.

## La minuterie et l'historique

Le classement se refait **à chaque `ivi` neuve** et **toutes les 12 heures**.

La minuterie part au démarrage d'OMNI et bat toutes les 12 heures. **Une passe
déclenchée par une `ivi` neuve ne la réarme pas** : les deux déclencheurs sont
indépendants, et lier l'un à l'autre ferait qu'une session de jeu régulière
repousserait indéfiniment le battement. **Pas de
rattrapage** des passes manquées pendant que l'application était fermée : une
passe ratée n'est pas rejouée, elle est remplacée par la suivante, et
l'horodatage affiché dit la vérité. Rattraper produirait deux passes identiques
à la file, puisque la table de prix, elle, n'a pas changé entre-temps.

Chaque passe est ajoutée à `pepites.json` dans `userData`, à côté de
`favoris.json`. **On garde les 30 dernières** — quinze jours à deux passes par
jour. Sans plafond le fichier grossirait sans fin pour une donnée que personne
ne relira.

`comparer(precedent, courant)` vit dans `classement.js` et rend, par ligne, un
des cinq états : `entree`, `montee`, `stable`, `descente`, `sortie`, plus
l'écart de coût par pépite. La comparaison porte sur **la passe précédente**,
pas sur une moyenne : on veut voir ce qui vient de bouger.

## L'IHM

Une fenêtre **Pépites**, sur le patron du tableau des archimonstres.

* le classement des 50, une ligne par objet : nom, taux, prix moyen unitaire,
  coût par pépite, variation ;
* une **barre de recherche** qui rend le taux et le coût par pépite de
  n'importe lequel des 4 049 objets recyclables ;
* un en-tête qui porte la provenance : « prix du 11/09 à 04:12, vus par
  *NomDuPerso* ».

L'en-tête n'est pas décoratif. Un tableau sans date laisse croire qu'il est
frais, et c'est précisément ce qui peut arriver ici : si aucun compte ne s'est
reconnecté, la passe de 12 h rend le même classement qu'avant.

## Ce qui peut mal tourner

| échec | réaction |
|---|---|
| aucune `ivi` reçue | la fenêtre s'ouvre et dit « connecte un personnage une fois pour que je voie les prix » |
| `taux.json` absent ou illisible | échec au démarrage, journalisé. Pas de classement vide silencieux |
| `pepites.json` corrompu | on repart d'un historique vide en le journalisant ; un historique perdu ne vaut pas un blocage |
| un gid sans nom dans `objets.json` | on affiche le gid nu, comme le tableau des écartés |
| un taux à 0 ou absent pour un gid d'`ivi` | l'objet n'entre pas au classement, sans bruit : ce n'est pas une anomalie, c'est la majorité du catalogue |

## Tests

* **`classement.js`** — exhaustif, sans double : l'ordre du tri, les deux
  départages, le marqueur de prix suspect à 10 kamas et à 11, le gid sans prix
  qui n'entre pas, le gid sans taux qui n'entre pas, la coupe à 50. Puis
  `comparer()` dans ses cinq états, dont `sortie` — celui qu'on oublie, parce
  qu'il porte sur une ligne absente du classement courant.
* **`taux.js`** — sur le patron d'`hdv-objets.test.js`, dont le gid nommé
  `toString` qui doit rendre `null` et non une fonction.
* **`historique.js`** — le plafond de 30, le fichier corrompu, le fichier
  absent au premier lancement.
* **`pepites.js`** — avec un double : une `ivi` neuve déclenche un classement,
  la minuterie aussi, deux `ivi` de pids différents gardent la plus fraîche, et
  une passe sans `ivi` ne produit pas un classement vide mais rien du tout.

## La recette

**La fonction n'est finie que quand la fenêtre tourne sur le banc d'essai
localhost et que l'écran est montré.** Pas un diff, pas un compte rendu :
l'écran. Le banc existe depuis le 2026-09-10
(`2026-09-10-interface-locale-design.md`), il cadre l'application à 1097×720
sans l'étirer, et c'est là que cette fenêtre se regarde avant d'être validée.

## Ce qui est écarté

* **Le prix réel du marché.** Il demanderait `keh`/`kbz`/`kgp` par gid, donc un
  personnage devant l'hôtel de vente et des centaines d'émissions rythmées à
  chaque passe. `ivi` est gratuite et arrive toute seule.
* **Le croisement avec l'inventaire.** `ivx` est déjà lu en continu par
  `pda-archi`, la colonne « tu l'as déjà » serait bon marché — mais elle change
  la nature de l'écran, qui est une liste de courses.
* **Le réglage du bonus de prisme.** Voir plus haut : uniforme, donc sans effet
  sur le classement.
* **Un score composite prix/volume.** Il demanderait un poids arbitraire et le
  chiffre affiché cesserait d'être un prix lisible.
* **Le seuil de prix comme filtre.** Marqueur seulement.
* **La lecture du bundle Unity en production.** Geste de développement.
* **Le rattrapage des passes manquées.** Il rejouerait le même classement.
