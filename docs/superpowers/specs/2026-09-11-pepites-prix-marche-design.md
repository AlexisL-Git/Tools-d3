# Le prix réel des pépites, pris à l'hôtel de vente

**Date :** 2026-09-11
**Statut :** conception validée, non implémentée.
**Suite de :** `2026-09-11-opti-pepite-design.md`, implémentée le même jour.
**Branche :** `feat/opti-pepite`.

## Le besoin

Le classement des pépites tourne sur `ivi`, les prix moyens que le serveur
livre au login. Essayé en jeu le 11/09 : le premier ratio est juste, mais la
demande tombe tout de suite — « je veux le prix exact auquel il est dans
l'hdv ».

## Ce qui a été mesuré, et qui ferme une porte

### Le prix courant n'arrive pas au login

Le protocole du jeu nomme lui-même le champ que nous lisons :

```proto
message ivi {
  repeated ivg frne = 1;                   // seconde liste, jamais lue
  repeated ivg object_average_price = 2;   // celle qu'OMNI lit
  message ivg { int32 frmz = 1; int64 frna = 2; }
}
```

`object_average_price` : c'est une **moyenne**, et le jeu le dit. Restait la
seconde liste, `frne`, dont le nom n'a jamais été résolu — un candidat
plausible pour un prix courant.

Capture d'une connexion réelle, 11/09, journal `journal-bug-0909.log`, trame
`itn` décodée octet par octet :

| mesure | valeur |
|---|---|
| charge utile annoncée par l'enveloppe | **89 676 octets** |
| coût d'une entrée `{objet, prix}`, mesuré sur 1 106 entrées | **9,027 octets** |
| entrées que cette charge peut contenir | **9 934** |
| entrées qu'OMNI a réellement lues | **9 822** |

Les deux derniers nombres coïncident à 1 % près. **La charge utile est
entièrement occupée par la liste des prix moyens : il ne reste pas de place
pour une seconde liste.** `frne` n'est pas envoyée.

**Le prix courant n'est donc pas atteignable sans aller à l'hôtel de vente.**
Ce n'est pas un choix d'implémentation ; le serveur ne l'envoie pas.

### Six objets recyclables sur dix ont un prix

Même capture, échantillon de 1 106 prix : **280 portent sur un objet
recyclable, soit 25,3 %**. Rapporté aux 9 822 prix reçus, cela fait **environ
2 487 objets recyclables tarifés sur les 4 049 du jeu — 61 %.**

Les 1 562 autres n'ont aucun prix dans ce que le serveur envoie. Ils ne sont
classables sur aucune source, et la recherche libre continue de répondre
« prix inconnu » pour eux.

### L'ouverture d'un étal est déjà reconnue

Acquis du 09/09, `src/garde-hdv.js` :

* le clic sur l'étal est un `iva`, **le même message qu'un zaap ou une porte** ;
* **seul l'hôtel de vente fait redescendre `isb`**, la liste de l'étal, et elle
  arrive **32 ms** après le clic. C'est elle, et elle seule, qui dit « c'était
  l'hôtel de vente ». `garde-hdv.js` et `vente.js` s'en servent tous les deux
  aujourd'hui, donc le nom est à jour.

### Les noms de trames se périment, les fonctions non

La spec de la mise à jour des prix (`2026-09-01`) parle de `keh`, `kgp`, `kbt`
et `khd`. **Aucun de ces quatre noms n'est encore valable.** Dofus renomme ses
messages à chaque grosse mise à jour — 148 noms sur 150 changés le 8 septembre,
d'où la version 0.3.7 qui a dû tout remapper.

Au 11/09, `src/hdv/trames.js` émet et lit ceci :

| geste | fonction de `trames.js` | nom du jour |
|---|---|---|
| s'abonner au marché d'un gid | `trameAbonner(gid)` | `kde { 1=1, 2=gid }` |
| se désabonner | `trameDesabonner(gid)` | `kde { 2=gid }` |
| demander les statistiques de prix | `trameStats(gid)` | `kbk { 2=gid }` |
| lire les quatre prix en réponse | `lireStatsPrix(frame)` | `jzn` |
| lire les prix poussés ensuite | `lirePrixMarche(frame)` | `kef` |

**`marche.js` appelle ces fonctions et ne cite aucun nom de trame en dur.**
C'est ce qui fera qu'une prochaine mise à jour du jeu ne demandera qu'un
remappage dans `trames.js`, et rien ici.

La catégorie de l'étal — l'ancien `khd { 3=11 }` — **n'a pas d'équivalent connu
dans le protocole actuel**. C'est la première question du spike.

## Ce qui est décidé

Trois choix de Jibef, le 2026-09-11 :

1. **La passe se déclenche à l'ouverture d'un hôtel de vente**, et la minuterie
   de 12 heures disparaît.
2. **Elle tarife les 50 objets du tableau**, pas davantage.
3. **Le prix réel remplace le prix moyen ligne par ligne**, et le classement se
   refait au fil de la passe.

## La minuterie ne perd rien en disparaissant

`ivi` n'arrive qu'au login et ne se redemande pas. Le battement de 12 heures
reclassait donc sur une table inchangée — et produisait une passe identique à
la précédente, ce que la revue de branche du 11/09 a relevé comme défaut. Il
avait fallu poser une garde dans `passer()` pour ne rien écrire quand la table
n'avait pas bougé.

**Supprimer la minuterie retire la garde avec elle.** Le classement se refait
désormais sur deux événements qui apportent tous les deux de l'information
neuve : une `ivi` au login, une passe de marché à l'étal.

## Ce que ça change dans la nature du projet

**OMNI se met à émettre automatiquement**, sur un geste du joueur qui n'est pas
un clic sur un bouton d'OMNI. C'est la première fonction du projet dans ce cas :
`reprix.js` et `vente.js` émettent, mais sur un bouton ; `pepites.js`, lui,
n'émettait rien du tout.

C'est un changement assumé, et il est borné par trois choses : la passe ne part
que sur `isb`, elle ne touche que 50 objets, et elle reprend le rythme validé en
jeu le 01/09 pour la mise à jour des prix.

## Architecture

| fichier | nature | rôle |
|---|---|---|
| `src/pepites/marche.js` | **neuf**, politique | la passe : un gid à la fois, abonnement, lecture, désabonnement |
| `src/pepites/pepites.js` | modifié | perd sa minuterie, garde l'écoute d'`ivi` et le classement |
| `src/pepites/classement.js` | modifié | `classer()` accepte des prix réels qui priment sur les moyens |
| `desktop/index.html` | modifié | la colonne dit quel prix elle montre, et la passe affiche son avancement |

`marche.js` est **le frère de `reprix.js`**, dont il reprend la forme éprouvée
et les trois garde-fous :

| garde | raison, reprise de `reprix.js` |
|---|---|
| rythme des émissions | 400 à 1400 ms entre deux objets, plus une pause de 2 à 7 s tous les 20 à 30. Bornes validées en jeu le 01/09 après un premier essai jugé « un peu trop vite » |
| délai maximal par étape | si la réponse de statistiques n'arrive jamais, on abandonne **ce gid**, pas la passe |
| comparaison d'**identité** du compte, pas du pid | `passeur.js:120` : Windows recycle les pid, un client relancé pendant la passe ne doit pas hériter de la passe du précédent |

**Un gid à la fois, et la raison est la même que dans `reprix.js` :** chaque
lecture doit porter sur un marché qu'on vient de demander, pas sur un chiffre
mémorisé d'un objet précédent.

**Ce que `marche.js` n'a pas, et que `reprix.js` a :** la boucle de relecture
après émission. `reprix.js` relit les prix après chaque mise à jour de lot parce qu'il
*modifie* le marché. Ici on ne fait que lire : aucune de nos émissions ne change
un prix, donc rien à relire.

### Le classement sur deux sources

`classer()` reçoit une seconde table, facultative, des prix réels. Pour chaque
gid, **le prix réel prime sur le prix moyen**, et la ligne porte la source :

```
ligne = { gid, taux, prix, source: 'marche' | 'moyen', quand, coutParPepite, suspect }
```

Le tri ne change pas. Ce qui change, c'est que deux lignes voisines peuvent
venir de deux sources, et **la colonne doit le dire**. Une ligne tarifée pour de
vrai et une ligne encore sur moyenne qui se ressembleraient feraient pire que
le « pas clair » signalé le 11/09 : le mensonge porterait sur la nature du
chiffre, pas sur sa mise en page.

**Ce renommage casse quatre consommateurs, et c'est délibéré.** Le champ
`prixMoyen` devient `prix`, et il ne suffit pas de le renommer : ce qui portait
ce nom était toujours une moyenne, et ce ne l'est plus. Quatre endroits lisent
la forme actuelle et doivent suivre — `desktop/index.html` (les deux tableaux,
classement et recherche), `desktop/main.js` (le mapping des noms),
`outils/faux-etat.js` (le faux classement du banc) et les tests de
`classement.js`, du panneau et du banc.

**Garder `prixMoyen` par compatibilité serait le pire choix :** un champ nommé
« moyen » qui contient parfois un prix de marché est exactement le genre de
mensonge silencieux que ce dépôt paie en soirées de débogage.

**Le marqueur de prix suspect ne s'applique qu'aux prix moyens.** Un prix de
marché à 3 kamas n'est pas douteux, il est vrai — c'est le prix auquel on peut
acheter, maintenant.

## Le spike, première étape de la réalisation

Trois questions, toutes mesurables, aucune devinable :

1. **Quelle trame porte la catégorie de l'étal aujourd'hui, et quelles valeurs
   prennent les hôtels de vente ressources, items et consommables ?** L'ancien
   `khd { 3=11 }` a été renommé et n'a pas d'équivalent identifié. Sans cette
   réponse on ne sait pas dans quelle catégorie on se trouve.
2. **Que répond un abonnement à un objet hors de la catégorie de l'étal ?** Un
   prix, rien, ou une erreur. La réponse décide si la passe doit filtrer les 50
   par catégorie, ou tout tenter et compter les silences.
3. **Quelle trame marque la fermeture de l'étal ?** Elle est la condition
   d'arrêt propre de la passe.

**Tant que la question 3 n'est pas tranchée, la passe s'arrête par le délai
maximal par étape** : un étal fermé cesse de répondre, chaque gid tombe en
silence et la passe s'épuise. C'est lent mais sûr, et ce n'est pas un
placeholder : c'est le comportement de repli, qui reste correct si la mesure ne
donne rien.

## L'IHM

* La colonne des prix porte la source de chaque ligne — prix de marché ou prix
  moyen — et l'heure de sa lecture.
* Pendant la passe, le panneau affiche l'avancement : `12 / 50`.
* À la fin, le compte rendu distingue trois nombres : **tarifés**, **sans offre
  au marché** (le `0` des quatre prix, qui ne veut pas dire gratuit), **échoués**.
* Un objet dont le marché est vide garde son prix moyen et le dit.

## Ce qui peut mal tourner

| échec | réaction |
|---|---|
| aucune `ivi` reçue | pas de candidats, la passe ne démarre pas |
| `superviseur.emettre` refuse — pas de socket amont | arrêt, message sur la ligne du compte |
| `lireStatsPrix()` ne rend rien dans le délai | on abandonne **ce gid**, on le journalise, on passe au suivant |
| le client disparaît en cours de passe | garde d'identité, arrêt net |
| l'étal se ferme | arrêt sur la trame de fermeture si le spike la trouve ; sinon épuisement par les délais |
| une seconde ouverture d'étal pendant une passe | la passe en cours continue, la nouvelle est ignorée. Deux passes concurrentes doubleraient le débit d'émissions |

## Tests

* **`marche.js`** — nourri de trames avec un double du superviseur, comme
  `reprix.test.js`. À verrouiller : un seul gid en vol à la fois ; une réponse
  de statistiques absente n'abandonne que son gid ; un client qui disparaît arrête la passe ;
  une seconde ouverture pendant une passe ne démarre rien ; le rythme est une
  fonction pure, le hasard entre par argument.
* **`classement.js`** — le prix réel prime sur le moyen ; une table de prix
  réels vide rend exactement le classement d'avant ; le marqueur de doute ne
  s'applique qu'aux prix moyens ; la source est portée par chaque ligne.
* **`pepites.js`** — la minuterie a disparu : plus de `demarrer`/`arreter`, et
  la garde contre la passe en double n'a plus lieu d'être.
* **Le panneau** — au harnais `vm` de `pepites-panneau.test.js` : deux lignes de
  sources différentes ne se dessinent pas pareil, et l'avancement s'affiche.

## Ce qui est écarté

* **Tarifer plus de 50 objets par visite.** 150 demanderait trois minutes
  devant l'étal, et tout le catalogue recyclable dépasserait le quart d'heure
  d'émissions continues.
* **Garder la minuterie de 12 heures.** Elle reclassait sur une table
  inchangée ; voir plus haut.
* **Un bouton pour déclencher la passe.** Le geste est l'ouverture de l'étal,
  qui a lieu de toute façon quand on vient acheter.
* **Chercher ailleurs dans le protocole un prix courant gratuit.** La mesure
  ci-dessus ferme la question pour le login. Rouvrir ce chantier coûterait
  plusieurs sessions de capture pour confirmer la même réponse.
* **Mémoriser les prix réels d'une session à l'autre.** Un prix de marché vieux
  d'un jour n'est plus un prix de marché : il vaut moins que la moyenne, qui au
  moins s'annonce comme une moyenne.
