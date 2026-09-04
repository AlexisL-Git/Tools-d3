# Les trames d'une âme pleine

2026-09-04, `journal-archi.log`, mesure faite avec
`outils\lancer-mesure-archi.vbs`. Elle répond à la seule question qui bloquait
`2026-09-04-tableau-archimonstres-design.md`.

## Le résultat : oui

**L'identifiant du monstre capturé est dans l'inventaire.** Une seule `ivx`, à
la connexion, 16 319 octets, **674 piles** — et 143 d'entre elles portent une
âme, nommée sans ambiguïté.

Aucune trame n'a été émise pour l'obtenir : `ivx` tombe seule, sans ouvrir le
moindre panneau. Le tableau des archimonstres n'a donc rien à demander au
serveur, ni au premier affichage ni jamais.

## L'effet 4058, et c'est tout

Une pile d'`ivx` porte ses effets au champ 2 de son détail. Un effet a la même
forme partout :

    { 6 = { les paramètres }, 11 = le numéro de l'effet }

**Le champ 11 est le numéro de l'effet, et le champ 6 ses paramètres.** L'âme
capturée est l'effet **4058**, dont le premier paramètre est l'identifiant du
monstre :

    effet : 6={ 1=2272 2=5 } 11=4058     ->  Pichakoté le Dégoutant

Sur les 143 âmes mesurées, le second paramètre vaut **5 sans exception** — un
grade, sans doute ; il n'est pas utilisé.

### Ce que la même lecture confirme au passage

Les pierres **vides** portent l'effet **705**, et son premier paramètre est le
plafond de capture :

| gid | pierre | effet 705, paramètre 1 |
|---|---|---|
| 9686 | Petite | 50 |
| 9687 | Moyenne | 100 |
| 9688 | Grande | 150 |
| 9689 | Énorme | 190 |

C'est **exactement la table de `src/pda-archi/pierres.js`**, établie le 03/09
depuis les données hors ligne. Deux sources indépendantes, le même résultat :
la lecture des effets est juste. Le plafond serait donc lisible dans la trame,
si on voulait un jour se passer de la table figée — ce n'est pas nécessaire
aujourd'hui.

## Ce qui était faux, et qu'il faut corriger

**Le gid 7010 n'existe pas.** Le commentaire de `pierres.js` annonce qu'une
pierre pleine « n'est pas le même objet, c'est le gid 7010 ». Il a été écrit le
03/09 sans qu'une pierre pleine ait jamais été observée. La mesure ne trouve
**aucune** pile de gid 7010, sur 674.

**Chaque âme est son propre objet.** Les 143 âmes portent 143 gids distincts,
de 6716 à 34274 : `Pichakoté le Dégoutant` est le gid 34005,
`Kwakolak le Chocolaté` le gid 33896. Un gid par archimonstre.

Ce n'est **pas une régression pour la chasse** : `choisir()` purge l'emplacement
en comparant le gid de l'occupant à celui qu'elle veut poser, sans jamais
nommer 7010. Le raisonnement tenait, seul son exemple était inventé.

## Le décompte

| ce qu'on lit | combien |
|---|---|
| piles dans l'inventaire | 674 |
| effets 4058 | 143 |
| piles portant plus d'une âme | **0** |
| quantité de ces piles | 1, toujours |
| position | 63, l'inventaire |
| **archimonstres** de la liste de référence | **140** |
| identifiants hors liste | 3 |

**Une âme, une pile.** L'hypothèse de conception « une pierre pleine peut
contenir plusieurs âmes » est démentie : les 143 piles portent une âme chacune,
en quantité 1. Le décodage rend quand même une liste — la trame autorise
plusieurs effets, et supposer l'inverse coûterait cher le jour où c'est faux.

**Les trois hors liste sont des boss, pas des archimonstres :**

| id | nom | ce que dit DofusDB |
|---|---|---|
| 2848 | Mansot Royal | `isBoss`, race 83 |
| 147 | Bouftou Royal | `isBoss`, race 9 |
| 928 | Mob l'Éponge | `isBoss`, race 69 |

Une pierre d'âme capture aussi les boss. Le tableau ne peut donc pas traiter
« âme inconnue de la table » comme « archimonstre absent de DofusDB », ce que
la conception supposait : c'est le cas **normal**, pas une anomalie. Elles
seront comptées à part, en une ligne sous le tableau, plutôt que d'être
inventées en lignes fantômes ou passées sous silence.

**Sur les 286, 140 sont là et 146 manquent.** Aucune âme de Vulkania.

## Les octets, pour le test

Une pile d'âme pleine, telle qu'elle arrive dans `ivx` au champ 3 — 28 octets,
`Pichakoté le Dégoutant` :

    083f2a1808d58902120a320508e011100558da1f180120d7c5929401

    08 3f                 1 = 63           position: inventaire
    2a 18                 5 = { 24 octets }  le detail
       08 d5 89 02          1 = 34005      gid, propre a cette ame
       12 0a                2 = { 10 o }   un effet
          32 05               6 = { 5 o }  les parametres
             08 e0 11           1 = 2272   IDENTIFIANT DU MONSTRE
             10 05              2 = 5      grade, inutilise
          58 da 1f            11 = 4058    l effet « ame capturee »
       18 01                3 = 1          quantite
       20 d7 c5 92 94 01    4 = 310682327  uid

## Ce que la conception doit changer

1. **Le critère de lecture est l'effet 4058**, pas un gid. C'est plus sûr : le
   gid change à chaque archimonstre, l'effet non.
2. **Pas de gid 7010** dans le décodage, ni nulle part ailleurs.
3. **Les âmes de boss sont normales.** Comptées à part, pas en lignes fantômes.
4. Le commentaire de `pierres.js` sur le gid 7010 est à corriger.
