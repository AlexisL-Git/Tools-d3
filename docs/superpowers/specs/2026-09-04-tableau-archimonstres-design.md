# Le tableau des archimonstres, conception

2026-09-04. Deuxième morceau de l'outil de chasse, après la pierre d'âme
équipée toute seule (`2026-09-03-pda-archi-design.md`).

## Le besoin

Savoir, d'un coup d'œil, quels archimonstres sont déjà capturés et lesquels
manquent — sur tous les personnages à la fois, sans ouvrir chaque inventaire
l'un après l'autre.

OMNI affiche un tableau : une ligne par archimonstre, une colonne par
personnage connecté, une croix là où la pierre pleine est en inventaire.

## Ce qui est décidé

Quatre choix de Jibef, le 2026-09-04 :

1. **« Avoir » veut dire « la pierre pleine est là, maintenant. »** Pas
   d'historique, pas de mémoire des captures passées : une pierre vendue vide
   sa case. C'est ce qui permet de n'écrire aucun fichier d'état.
2. **L'inventaire seul, pas la banque.** `ivx` arrive tout seul à la connexion ;
   `iwb` n'arrive que si le joueur ouvre le panneau du banquier, et un tableau
   à moitié lu ment plus qu'il n'informe.
3. **Tous les personnages en colonnes**, une seule vue. Le bouton d'un
   personnage ouvre cette vue avec sa colonne surlignée — il n'ouvre pas un
   tableau qui lui serait propre.
4. **La liste de référence vient de DofusDB**, figée dans le dépôt, **sans
   l'Archipel de Vulkania**.

## Ce qui est déjà acquis, sans aucune mesure

**L'inventaire est déjà lu, en permanence, personnage par personnage.**
`src/pda-archi/pda-archi.js` écoute `ivx` depuis le 03/09 et tient à jour une
copie des piles par `pid`, avec `iua` (pile neuve), `ivj` (pile entamée) et
`ium` (pile disparue). Le tableau n'a donc **aucune trame à émettre** : ni
requête, ni rythme à étaler, ni risque de flot. C'est ce qui rend la fonction
petite.

**La liste des archimonstres est un simple filtre.** Mesuré le 04/09 sur
l'API DofusDB :

| ce qu'on demande | ce qu'on obtient |
|---|---|
| `monsters?isMiniBoss=true` | **306** monstres |
| leur `race` | **78 pour les 306, sans exception** |
| `soulCaptureForbidden` | faux pour les 306 |
| `hideInBestiary` | faux pour les 306 |
| moins ceux de Vulkania | **286** |

Les noms ne laissent aucun doute : `Larvonika l'Instrument`, `Piradain le
Pingre`, `Ratéhaifaim le Professeur`. Niveaux de 1 à 181, médiane 54. Réduite
à `{id, nom, niveau}`, la table pèse **16 Ko** — elle tient dans le dépôt sans
discussion, et OMNI ne fera plus jamais d'appel réseau.

**La correction du 03/09.** La spec de la chasse notait, en hors-sujet : « aucun
drapeau de DofusDB ne les distingue, `isMiniBoss` désigne les mini-boss de
donjon ». **C'est faux, et c'est mesuré.** Dans les données du jeu,
« mini-boss » EST le nom interne de l'archimonstre : un monstre ordinaire porte
un `correspondingMiniBossId` qui pointe vers le sien — `Larve Bleue` (31) →
`Larvonika l'Instrument` (2574). La liste montée à la main qu'annonçait cette
note n'est pas nécessaire.

**286, une fois Vulkania retirée.** Le drapeau seul en donne 306, mais vingt
d'entre eux vivent dans l'Archipel de Vulkania — une île **saisonnière**, dont
les archimonstres ne sont capturables que pendant l'événement. Les compter
ferait vingt lignes définitivement vides onze mois sur douze. Signalé par
Jibef le 04/09, puis vérifié :

    zone 50, « Archipel de Vulkania » -> 13 sous-zones
    306 archimonstres - 20 qui y vivent = 286

Les vingt portent les identifiants **3178 à 3197**, contigus, et tous le même
préfixe : `Krokette la Croustillante`, `Kroktail la Désaltérante`,
`Krokrane la Distordue`. Niveaux 20, 50, 100 et 150, cinq par palier.

**La règle d'exclusion est la zone, pas la plage d'identifiants.** 3178-3197
n'est qu'un contrôle : c'est `subareas` ∈ zone 50 qui décide, sinon le premier
archimonstre ajouté par Ankama dans cet intervalle casserait le filtre en
silence. Le compte de 286 est figé dans le test — le jour où le jeu en ajoute
un vrai, le test tombe et c'est ce qu'on veut.

## La mesure : c'est oui

Faite le 04/09, consignée dans `2026-09-04-trames-ame-pleine.md`. Une seule
`ivx` à la connexion, 674 piles, **143 âmes lisibles**.

**Le critère de lecture est l'effet 4058.** Un effet d'`ivx` a la forme
`{ 6 = { paramètres }, 11 = numéro de l'effet }`, et l'âme capturée est
l'effet 4058, premier paramètre :

    effet : 6={ 1=2272 2=5 } 11=4058     ->  Pichakoté le Dégoutant

**C'est l'effet qui sert de critère, pas le gid**, et c'est le seul point où la
conception a changé : chaque âme est un objet différent — 143 âmes, 143 gids
distincts, de 6716 à 34274 — tandis que l'effet, lui, est le même pour toutes.
Le gid 7010 qu'annonçait le commentaire de `pierres.js` n'existe pas : aucune
pile ne le porte, sur 674.

**Une âme, une pile.** Les 143 piles portent une âme chacune, en quantité 1.
`lireAmes` rend quand même une liste : la trame autorise plusieurs effets, et
supposer l'inverse coûterait cher le jour où c'est faux.

**Une pierre capture aussi les boss.** Trois des 143 âmes ne sont pas des
archimonstres : `Mansot Royal`, `Bouftou Royal`, `Mob l'Éponge`. Le tableau ne
peut donc pas traiter « âme hors table » comme une anomalie — c'est le cas
normal. Elles se comptent à part, en une ligne sous le tableau.

**140 des 286 sont là**, 146 manquent, aucune de Vulkania.

## L'architecture

Trois pièces, dans l'ordre des dépendances.

### `src/pda-archi/archimonstres.json`

Les 286, figés depuis DofusDB : `{ id, nom, niveau }`. Aucun appel réseau dans
OMNI. Un outil de fabrication séparé (`outils/faire-archimonstres.js`) permet
de le régénérer quand le jeu en ajoute ; c'est lui qui porte le filtre
`isMiniBoss` et le retrait de la zone 50, et il ne tourne jamais en production.

### `src/pda-archi/collection.js`

Module pur : ni Electron, ni Frida, ni disque, ni réseau — testable avec des
trames figées, exactement comme `src/hdv/stock.js`.

**Il ne garde que les âmes.** Décoder et conserver les effets des 674 piles
d'un inventaire coûterait de la mémoire pour rien : le module ne retient que
les piles portant un effet 4058, et d'elles ne retient que les identifiants de
monstres.

    lireAmes(frame)  ->  [ { uid, monstres: [id, ...] } ]

alimente une `Map pid -> Map(uid -> [id])`, tenue par les mêmes quatre trames
que la chasse : `ivx` remplace tout, `iua` ajoute une pile, `ium` en retire
une, `ivj` ne change que des quantités et ne concerne donc pas la collection.

**Le tableau est vivant, pas une photo** : une pierre qui se remplit pendant la
chasse arrive en `iua` et coche sa case sans qu'on ait rien à demander.

    etat()  ->  Map(pid -> Set(idMonstre))

### Le panneau

Une colonne **« Archi »** dans la liste des personnages, à côté de « HDV ».
Chaque ligne porte un bouton avec son compte (`140`), et le clic ouvre la vue
superposée, à la manière de « Quoi de neuf » :

    ARCHIMONSTRES                      Jibef  Mule1  Mule2
    ------------------------------------------------------
    Larvonika l'Instrument      16       X      .      .
    Ribibi le Cher              34       .      X      X
    Ratlbol l'Aigri             52       .      .      .
    ------------------------------------------------------
    filtre : ( ) tous  (•) manquants  ( ) possédés
    286 archimonstres     possédés : 140     manquants : 146
    + 3 âmes de boss, hors tableau

**Un inventaire pas encore lu affiche `—`, jamais `0`.** Un trou dans ce qu'on
sait n'est pas un zéro, et c'est la leçon la plus chère du 03/09 : un silence
qui ressemble à une réponse fait perdre une soirée. Même règle que « OMNI avant
les clients » : un client déjà connecté n'a jamais envoyé son `ivx`.

### Pas de nouveau droit verrouillable

`src/droits/liste.js` verrouille des **actions** — ce qu'OMNI émet vers le jeu.
Le tableau n'émet rien : il lit et il affiche. L'y ajouter obligerait à toucher
`serveur-maj/lib/fonctions.js` et le test qui compare les deux listes, pour un
tableau. Décision réversible : si Jibef veut le verrouiller plus tard, c'est
deux lignes et un test.

## Les tests

- `lireAmes` sur les 28 octets réels de la mesure, figés dans le test.
- Une pile portant deux effets 4058 rend deux identifiants — cas non observé,
  couvert quand même.
- Une âme de boss ne devient pas une ligne du tableau, et n'est pas perdue.
- `iua` coche, `ium` décoche, `ivx` remplace tout.
- Un personnage jamais lu n'est pas un personnage à zéro.
- `archimonstres.json` : 286 entrées, identifiants uniques, et aucun de la
  plage 3178-3197 — le contrôle de Vulkania.

## Hors sujet, volontairement

- **La banque.** Choix 2 ci-dessus.
- **L'historique des captures.** Choix 1 ci-dessus.
- **Regrouper par zone.** Les `subareas` sont dans les données DofusDB — les
  286 en ont toutes une, c'est d'ailleurs ce qui permet d'écarter Vulkania —
  mais trier par niveau suffit pour commencer.
- **Échanger ou vendre les âmes**, et la capture elle-même.
- **Les vingt archimonstres de Vulkania.** Ils ne sont pas dans le fichier.
  Conséquence assumée : une âme de Vulkania en inventaire s'afficherait en
  ligne supplémentaire sous son seul numéro, faute de nom. Si cela arrive
  vraiment, les remettre dans le fichier avec un drapeau `vulkania`, hors
  décompte, est un changement d'une ligne.

## Risques

**L'identifiant n'est pas dans la trame.** Le seul vrai risque, et la mesure
le lève ou le confirme en une soirée. S'il n'y est pas, la fonction s'arrête là
plutôt que d'aller demander chaque pierre au serveur, un aller-retour par
objet — exactement le flot que l'hôtel de vente a appris à éviter.

**Une âme hors table.** Ce risque est levé, et retourné : la mesure montre que
le cas normal est l'âme de **boss**, pas l'archimonstre oublié. Le compte à
part sous le tableau le couvre. Resterait un archimonstre absent de DofusDB —
il tomberait dans la même ligne, visible, jamais silencieux.

**Le paquet à refabriquer.** Aucun : la fonction est du code applicatif, elle
se met à jour toute seule chez les amis.
