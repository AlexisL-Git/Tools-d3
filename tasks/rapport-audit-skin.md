# Rapport — audit du skin d'OMNI

Fait sur le code source des maquettes, sans navigateur.

---

## Comment ce rapport a été fait, et ce qu'il ne peut pas dire

Aucun navigateur n'était disponible sur cette machine, et aucun serveur n'a été
lancé. Tout ce qui suit vient de la lecture des fichiers : `labo-omni/app.html`
(788 lignes, tout le CSS dans son `<head>`), `labo-omni/index.html`,
`labo-omni/identite.html`, `labo-omni/clair.html`, `labo-omni/icone.html`,
`labo-omni/couleurs.html`, `labo-omni/oeil.html`, `labo-omni/ecran.html`,
`desktop/index.html` (2702 lignes, le skin en production) — plus les deux images
de `labo-omni/refs/`, que j'ai regardées et qui se sont révélées décisives (§0).

**Ce que ça permet de dire avec certitude** : les valeurs de couleur et leurs
rapports de contraste (calculés, pas estimés), l'échelle typographique exacte,
les tailles de grille, quelles classes existent et lesquelles ne sont jamais
employées, quelle information apparaît sur quel écran, ce que la production sait
faire et que la refonte ne montre pas.

**Ce que ça ne permet pas de dire** : à quoi ressemble vraiment un écran monté.
Chaque fois qu'une conclusion demanderait de voir la page pour être sûre, c'est
écrit noir sur blanc dans le texte, avec le calcul qui la fonde. Les hauteurs
que je calcule (§4) sont des additions de valeurs CSS : elles donnent le bon
ordre de grandeur, pas le pixel exact.

Une note de méthode sur les contrastes : tous les chiffres du type `4,41:1` sont
des rapports de luminance WCAG calculés à partir des hexadécimaux du fichier.
Je ne les invoque pas comme une norme d'accessibilité — OMNI a un seul
utilisateur. Je les invoque parce que **le rapport de luminance est exactement ce
qui prédit si on voit une chose du coin de l'œil**. La vision périphérique est
quasiment aveugle à la teinte et très sensible à la luminance. Pour un poste de
pilotage sur second écran, c'est la seule mesure qui compte.

---

## 0. D'où viennent les briques — et pourquoi ça explique la moitié des défauts

`labo-omni/refs/` contient deux captures de référence. Je les ai ouvertes, et
elles éclairent le reste du rapport : **`ref3-management-dashboard.png` est la
source directe d'`app.html`**, brique par brique.

Ce qui a été repris de cette référence, à l'identique :

| Dans la référence | Dans `app.html` |
|---|---|
| Un rail sombre à gauche, icônes seules, **avatar rond en bas** | `.rail` (l. 63) et **`.moi`** (l. 74) |
| Un titre en très gros bas-de-casse, avec des **pastilles jaunes posées sur des pictos décoratifs** | `.titre h1` + **`.marqueur`** (l. 94-95) |
| Trois tuiles : grand chiffre / dénominateur en petit / **barres-segments pleines et pointillées** / menu `⋯` | `.tuile` + `.grand` + `.segments` + `.plus` (l. 100-118) |
| Une tuile **jaune acide**, une tuile **noire** | `.tuile.acide`, `.tuile.noire` (l. 101-102) |
| Fond vert-gris très clair, cartes blanc cassé, rayons ~22 px | `--fond` `#E7EBE4`, `--carte` `#F6F7F3` (l. 27) |
| Une rangée de capsules de filtre, la sélectionnée en noir plein | `.grp` / `.grp button.on` (l. 140-142) |

Et `ref2-creso.png` apporte le reste du vocabulaire : le rail coloré, la paire de
capsules « Top Gainers / Top Losers », et une liste de valeurs avec des
pourcentages **en gain et en perte** — ce qui explique très probablement les règles
orphelines `.gain` / `.perte` (l. 215-222) qui traînent dans le fichier sans aucun
écran pour les porter (§5.2 G).

**Pourquoi ça compte.** Une bonne partie des défauts relevés plus bas ne sont pas
des erreurs de goût : ce sont des **emprunts dont la sémantique n'a pas suivi**.

- Dans la référence, la **pastille jaune du titre** surligne un picto décoratif —
  elle ne veut rien dire. Dans OMNI, on lui a demandé de dire « ce qui mène et ce
  qui tourne » tout en continuant à l'appliquer mécaniquement à la dernière
  proposition de chaque titre. D'où « **deux à rattraper** » et « **en pause** » en
  jaune (§1.3).
- Dans la référence, la **tuile noire** est un encart publicitaire (« Take You
  Automation to the Next Level / Upgrade »). Dans OMNI, la même brique — carte
  noire, texte, bouton clair — a été chargée du métier « ce qui réclame ton
  attention ». La forme n'a jamais été dessinée pour ça (§1.4).
- Dans la référence, **les trois tuiles SONT le contenu** du tableau de bord : il
  n'y a rien d'autre en dessous. Dans OMNI, elles ont été posées **au-dessus d'une
  grille qui dit déjà tout**, d'où les cinq répétitions du même fait sur Ma flotte
  (§3).
- Dans la référence, l'**avatar** du rail identifie l'utilisateur d'un produit
  multi-comptes. OMNI a **un seul utilisateur**. `.moi` (l. 74) est donc un carré
  décoratif sans fonction — ce n'est pas un oubli d'explication, c'est un emprunt
  qui n'avait rien à faire là (§6.5.4).
- **La référence est en clair uniquement.** Le thème sombre d'`app.html` n'a pas été
  dessiné : il a été **déduit** en inversant des jetons. C'est exactement pourquoi
  tout ce qui casse, casse en sombre (§1.1 et §1.2) — le jaune sur crème à 1,34:1,
  le meneur et l'alarme à 1,08:1.

Ce n'est pas un reproche sur la méthode : partir d'une référence forte est ce qui a
donné à la maquette son allure, et l'allure est bonne. **Mais le travail de
traduction n'a été fait qu'à moitié.** Les formes ont été importées, les métiers
sont restés au vestiaire. La suite de ce rapport est, pour l'essentiel, la liste
des endroits où il faut finir cette traduction.

---

## 1. La règle de couleur tient-elle ?

La règle est écrite en toutes lettres à la ligne 787 d'`app.html` :

> *le jaune pour ce qui mène et ce qui tourne, le noir pour ce qui réclame ton
> attention, le clair pour tout ce qui va bien.*

**Réponse courte : non, et pas d'un peu. Elle est trahie par une douzaine
d'éléments, mais surtout elle est structurellement impossible à tenir telle
qu'elle est écrite, parce que les deux thèmes la cassent chacun d'un côté
différent.**

### 1.1 Le problème de fond : la règle se retourne d'un thème à l'autre

C'est le résultat le plus important du rapport. Voici les rapports de luminance
mesurés entre les trois états d'une carte de personnage (`.perso`, `.perso.mene`,
`.perso.probleme`, lignes 175-178) :

| | Thème clair | Thème sombre |
|---|---|---|
| Le meneur (jaune) vs une carte normale | **1,13:1** | 13,30:1 |
| Le personnage en panne (inversé) vs une carte normale | 16,54:1 | 14,35:1 |
| **Le meneur vs le personnage en panne** | 14,60:1 | **1,08:1** |
| Le jaune `--acide` vs le fond de page `--fond` | **1,01:1** | 14,76:1 |

Ce qu'il faut lire là-dedans :

- **En thème clair, le jaune est invisible en luminance.** `--acide` (`#E2F27C`,
  l. 31) et `--fond` (`#E7EBE4`, l. 27) ont un rapport de **1,01:1** — c'est-à-dire
  strictement la même clarté. Le jaune ne se distingue du papier que par sa
  teinte. En vision périphérique, sur un second écran, entre deux combats, **la
  carte du meneur ne saute pas aux yeux : elle disparaît**. « Le jaune pour ce
  qui mène » ne mène rien du tout dans la moitié claire de l'app.
- **En thème sombre, le jaune et le noir deviennent le même signal.** En sombre,
  `--encre` bascule à `#EFF2EC` (l. 40) — la carte « problème » devient un bloc
  crème. Le meneur est un bloc jaune. Entre les deux : **1,08:1**. Les deux états
  les plus opposés du produit — *celui qui commande* et *celui qui est cassé* —
  sont deux pavés clairs de luminance identique sur une grille sombre. Du coin de
  l'œil, on ne peut pas les distinguer.

Autrement dit : le thème clair sait crier l'alarme et pas le commandement ; le
thème sombre sait crier les deux mais ne sait plus dire lequel des deux c'est.
**Aucun des deux thèmes ne délivre les deux signaux de la règle.**

J'ai vérifié s'il suffisait de foncer le jaune côté clair. Il faut descendre à
`#7E9426` pour atteindre seulement 2,83:1 contre le fond — un olive qui n'est
plus la marque. **La conclusion est forcée : en thème clair, le jaune ne peut pas
porter de signal de luminance, quoi qu'on fasse.** Il faut donc arrêter de lui
demander de le faire.

### 1.2 Le bug qui va avec : `--acide-sur-contre` en thème sombre

`--acide-sur-contre` (l. 31 et 43) a été conçu comme « le jaune qu'on pose sur la
surface inversée ». En clair, la surface inversée est noire, le jeton vaut
`#E2F27C`, tout va bien. En sombre, la surface inversée devient **crème**
(`#EFF2EC`) mais le jeton vaut toujours un vert-jaune (`#C9DC5C`). Résultat :
**1,34:1**. Sept règles CSS produisent, en thème sombre, un élément quasiment
invisible sur son propre fond :

| Ligne | Élément | Contraste en sombre |
|---|---|---|
| 118 | `.tuile.noire .segments i` — les barres de la jauge dans la tuile inversée | 1,34:1 |
| 123 | `.tuile.noire .bt-clair` — le bouton « Régler les deux » / « Reprendre la course » | 1,34:1 |
| 199 | `.perso.probleme .pips i` — les cinq pastilles de la carte en panne | 1,34:1 |
| 204 | `.perso.probleme .capsule span` — la barre de progression de la carte en panne | 1,34:1 |
| 206 | `.bt-mini` — les boutons « Réveiller » et « Lancer » | 1,34:1 |
| 267 | `.inter.on::after` — **le bouton de l'interrupteur allumé** | 1,34:1 |
| 283 | `.note .pip` — les puces du journal des versions | 1,34:1 |
| 238 | `.regle.large .grp button.on` — la capsule sélectionnée de la règle de prix | 1,15:1 (sur `#DDE2D8`) |

Le plus gênant est la ligne 267 : en thème sombre, **le curseur de l'interrupteur
allumé n'est plus visible sur sa piste**. Il reste 33 interrupteurs allumés sur
l'écran Raccourcis dont on ne verra plus que la piste. Et les lignes 206 / 123 :
les deux seuls boutons d'action des cartes en panne deviennent des rectangles
sans silhouette.

**Ce n'est pas un réglage de valeur, c'est une erreur de conception du jeton.**
`--acide-sur-contre` doit valoir `#C9DC5C` en clair (posé sur du noir) et
`#16181A` — l'encre — en sombre (posé sur du crème). Le jaune n'a pas sa place
sur une surface claire, jamais.

### 1.3 Le jaune sur des choses qui ne mènent rien et ne tournent pas

Élément par élément, avec la ligne.

| Ligne | Élément | Ce que dit le jaune | Ce que c'est vraiment |
|---|---|---|---|
| 348 | `.marqueur` « **deux à rattraper** » (Ma flotte) | ça mène ou ça tourne | deux personnages cassés — l'exact contraire |
| 417 | `.marqueur` « **en pause** » (Courses) | ça tourne | ça s'est **arrêté** |
| 587 | `.marqueur` « **108 à trouver** » (Archimonstres) | ça mène ou ça tourne | un manque |
| 711 | `.marqueur` « **0.3.6** » (Réglages) | ça mène ou ça tourne | un numéro de version |
| 494, 645 | `.marqueur` sur un bout de phrase (« et ce qu'OMNI pose avec », « et ce que chacun suit ») | — | pure décoration typographique |
| 427 | `.tuile.acide` « Dépensé 1,24 M / 2 M de plafond » | ça tourne | une consommation de budget qui approche son plafond : plutôt une alerte |
| 506 | `.tuile.acide` « Total mis en vente 17 lots » | ça tourne | un décompte figé |
| 604 | `.tuile.acide` « Boss 31 / 51 » | ça tourne | un décompte figé |
| 278 | `.droit` — **onze pastilles jaunes** sur Réglages | ça mène | la liste statique des droits de la clé |
| 283 | `.note .pip` — une puce jaune par entrée du journal | ça tourne | un historique |
| 519-541 | `.capsule em` sur des lignes à `width:100%` (Pierre médicinale, Poudre de perlinpimpin) | ça tourne | c'est **fini**, plus rien ne tourne |

Le cas de `.marqueur` (l. 95) est le plus net et le plus facile à corriger : c'est
un procédé typographique appliqué mécaniquement à la dernière proposition de
**chacun des six titres**, sans aucun filtre de sens. Trois fois sur six, la
chose surlignée en « couleur de ce qui va bien et qui tourne » est précisément
un problème.

Les onze `.droit` jaunes de Réglages (l. 725-728) font de l'écran le plus statique
de l'app **le plus saturé de jaune des six**.

### 1.4 Le noir sur des choses qui ne réclament rien

Le noir a un problème plus profond que le jaune : dans le fichier, il ne s'appelle
pas « alerte », il s'appelle **`--encre`**. C'est le jeton du texte. On lui demande
donc d'être à la fois la couleur de tout ce qui est écrit et la couleur de ce qui
alarme. **Un jeton ne peut pas faire ces deux métiers.** Toutes les violations qui
suivent découlent de là :

| Ligne | Élément | Combien | Ce que ça devrait dire |
|---|---|---|---|
| 116 | `.tuile .segments i` — chaque segment rempli de chaque jauge | jusqu'à 7 par tuile, sur 8 tuiles | l'avancement normal |
| 196 | `.pips i` — les pastilles des cartes | jusqu'à 40 sur Ma flotte | des fonctions armées, donc « tout va bien » |
| 165 | `.capsule span` — le remplissage de toute barre de progression | 8 occurrences | ça tourne (ce serait plutôt du jaune) |
| 78 | `.armer` « **OMNI est armé** » | la pastille la plus foncée de la barre du haut | tout est normal — c'est l'état de repos du produit |
| 141 | `.grp button.on` — la capsule de filtre sélectionnée | 3 sur Archimonstres (l. 592-594), 4 sur Hôtel | un choix de filtre |
| 135 | `.bt-noir` « Modifier la liste » (l. 578) | 1 | une action neutre |
| 231 | `.regle.large` — la grande carte de règle de prix | ~40 % de l'écran Hôtel | la carte qu'on **règle**, pas une alarme |
| 273 | `.bloc-r.noir` « Quoi de neuf » (l. 716) | **~55 % de la surface de l'écran Réglages** | un journal de versions |
| 259 | `.archi.manquant` — un archimonstre manquant | **10 tuiles noires sur 20 visibles** (l. 618-627) | l'état normal d'une collection qu'on complète |
| 267 | `.inter.on` — la piste de l'interrupteur allumé | 33 sur Raccourcis | une fonction armée |

Le pire est Archimonstres. Le filtre par défaut est « Manquants » (l. 594), donc
la grille n'affiche **que** des manquants, donc la moitié des tuiles visibles sont
noires — plus trois capsules de filtre noires, plus la tuile `.tuile.noire`
« Dofus Ocre » qui, elle, porte la seule vraie action de l'écran. **Le noir qui
appelle est noyé au milieu de treize noirs qui n'appellent pas.**

Le deuxième pire est Réglages : la plus grande surface noire de toute
l'application est un changelog.

### 1.5 Et là où la règle est bien tenue

Pour être juste : `.perso.probleme` (l. 178) et `.tuile.noire` (l. 102) tiennent la
règle parfaitement, `.pastille-etat.pleine` « Il commande » (l. 172) tient le jaune
parfaitement, la pupille jaune du logo (l. 69) et le point jaune de « OMNI est
armé » (l. 79) aussi. **Cinq éléments sur une trentaine.** Le principe est juste ;
c'est son application qui est mécanique.

Deux commentaires du fichier sont, eux, exactement dans le vrai et méritent d'être
gardés tels quels dans la planche d'identité : lignes 15-22 (« `--encre` ne veut
pas dire noir, il veut dire LE CONTRAIRE DU FOND ») et lignes 213-215 (« un gain
c'est la normale, il reste discret ; une perte est l'exception »). L'intention est
bonne — c'est le nombre de jetons qui est insuffisant pour la porter.

### 1.6 Une contradiction factuelle entre deux écrans

Ce n'est pas de la couleur, mais c'est la règle prise en flagrant délit sur des
données.

Sur **Ma flotte**, la tuile « Courses 14 / 20 lots » est jaune (l. 358) — donc
« ça tourne ». Au même instant, dans la même maquette :

- l'écran **Courses** titre « La course est **en pause** » (l. 417) ;
- sa tuile inversée dit « En pause · Le sac de Bricoline est plein » (l. 432) ;
- et sur Ma flotte, la carte de Bricoline (l. 405) dit « Course en pause · sac
  plein, 14 lots sur 20 » — **sur une carte blanche, donc « tout va bien »**.

Le même fait est donc simultanément : quelque chose qui tourne (tuile jaune),
quelque chose qui va bien (carte blanche), et quelque chose qui réclame de
l'attention (tuile inversée avec bouton). Trois traitements pour un fait.

**Ce qu'il faut décider** : un sac plein qui arrête une course est-il un problème ?
Ma réponse : oui — c'est exactement le genre de chose qu'on veut voir du coin de
l'œil, parce qu'elle ne se débloquera jamais toute seule. Donc la carte de
Bricoline doit passer en surface inversée comme Kwakoun et Tacatak, et la tuile
« Courses » de Ma flotte ne doit pas être jaune tant que la course est arrêtée.

### 1.7 La règle elle-même est-elle bonne ? — verdict et remplacement

Le principe « une seule couleur, et une surface qui s'inverse » est bon, et il faut
le garder. **La formulation, elle, est fausse sur deux points** : elle attribue au
jaune un rôle de signal fort qu'il ne peut pas tenir en thème clair (§1.1), et elle
attribue au noir un rôle d'alarme alors que le noir est le jeton du texte (§1.4).

Ce que je propose à la place — trois décisions, toutes exprimables dans la maquette :

**Décision A — Le jaune n'est autorisé que sur une surface plus foncée que lui.**
Une seule phrase, vérifiable au coup d'œil par le développeur. Elle interdit
d'elle-même le `.marqueur` en thème clair, les `.tuile.acide` en clair, les onze
`.droit` en clair et `.perso.mene` en clair. Elle autorise le jaune partout où il
marche déjà : le rail (foncé dans les deux thèmes par construction, l. 33 et 45 —
14,60:1 en clair, 14,76:1 en sombre), la pupille du logo, le point de « armé », la
tête des barres de progression, les capsules « on » posées sur du foncé.

**Décision B — Le meneur se signale par une forme, pas par un aplat.**
Puisque le jaune ne peut pas être fort en clair et qu'un aplat clair en sombre se
confond avec l'alarme, on retire l'aplat : la carte du meneur reste une carte
normale et gagne **un liseré jaune de 4 px sur son bord gauche + son jeton de
classe en jaune + la mention « Il mène »**. La forme survit aux deux thèmes.
Bénéfice collatéral : ça libère la surface inversée pour être **le seul** bloc
inversé de la grille, donc l'alarme redevient lisible instantanément dans les deux
thèmes. Et ça rétablit la règle n° 3 déjà validée dans `identite.html` (l. 413) :
« **La forme avant la couleur** — plein contre creux, fermé contre pointillé. Un
daltonien doit lire l'écran aussi bien que toi — et toi aussi, du coin de l'œil. »
Cette règle a été écrite par vous, validée, et la refonte l'a perdue en route.

**Décision C — Séparer `--encre` (le texte) de `--alarme` (la surface qui appelle).**
Même valeur de couleur au départ, deux noms. Tout ce qui est structurel — segments
de jauge (l. 116), pips (l. 196), remplissage de capsule (l. 165), pistes
d'interrupteur (l. 266), capsules de filtre actives (l. 141), `.bt-noir` (l. 135),
`.archi.manquant` (l. 259), `.bloc-r.noir` (l. 273), `.regle.large` (l. 231) —
passe sur des jetons neutres. Ne gardent `--alarme` que : `.perso.probleme`,
`.tuile.noire`, et la pastille d'un personnage injoignable. **Sur Ma flotte, on
doit pouvoir compter les blocs inversés à la volée : leur nombre est le nombre de
choses à faire.**

Reformulation de la règle, à mettre en tête de la planche d'identité :

> **Le fond clair, c'est ce qui va bien. Une carte qui s'inverse, c'est une chose
> à faire — et il n'y en a jamais d'autre. Le jaune, c'est OMNI : il ne se pose
> que sur du foncé, il marque ce qui mène et ce qui tourne, il n'alerte de rien.**

---

## 2. L'architecture des six écrans

### 2.0 La découverte qui commande tout le reste

**Les cinq pastilles `.pips` de chaque carte de Ma flotte SONT les cinq
interrupteurs de l'écran Raccourcis.** Je l'ai vérifié personnage par personnage :

| Personnage | `.pips` sur Ma flotte (l. 372-411) | Interrupteurs sur Raccourcis (l. 655-706) |
|---|---|---|
| Vahlkyr | 4 pleins, 1 creux | on, on, on, on, off |
| Noméa | 4 pleins, 1 creux | on, on, on, on, off |
| Ptit-Bras | 3 pleins, 2 creux | on, on, on, off, off |
| Sombrelle | 5 pleins | on ×5 |
| Ourseline | 4 pleins, 1 creux | on, on, on, on, off |
| Kwakoun | 2 pleins, 3 creux | on, on, off, off, off |
| Bricoline | 5 pleins | on ×5 |
| Tacatak | 5 creux | off ×5 |

Concordance parfaite, huit fois sur huit. **Deux écrans sur six affichent la même
donnée dans deux encodages différents, et rien nulle part ne le dit.** Sur Ma
flotte, ce sont quarante points sans la moindre légende — le mot « réplication »
n'y apparaît pas une seule fois. Sur Raccourcis, rien ne dit que les points de
l'autre écran sont ces interrupteurs-là.

Deux conséquences immédiates :

1. **Alexis ne peut pas le deviner.** Il implémentera les pips comme « autre
   chose » (un niveau, une santé, une progression) et les deux écrans divergeront
   dès la première version. C'est le manque de spécification le plus coûteux du
   dossier.
2. **La fusion des deux écrans est déjà faite à 90 %, sans que personne l'ait
   décidé.** Il ne reste qu'à rendre les pips cliquables.

### 2.1 Écran par écran : qu'est-ce qui n'existe QUE là ?

**1 · Ma flotte** (l. 346-412)
*Unique* : la phrase d'état par personnage (`.dit`, « Il mène », « Relève les prix
— 412 objets sur 664 », « resté à l'écran de sélection ») ; la barre de progression
par personnage (`.capsule`, l. 393 et 407) ; les actions de rattrapage
(« Réveiller », « Lancer », l. 400 et 410).
*Pas unique* : les trois tuiles du haut (l. 351-368) sont **intégralement
déductibles de la grille qui est juste en dessous**. « En jeu 6 / 8 » = comptez les
cartes. « Courses 14 / 20 lots » = c'est écrit sur la carte de Bricoline, l. 405.
« À faire : deux clients ne répondent pas » = ce sont les deux cartes inversées,
l. 397 et 408. Et le même fait est encore répété deux fois au-dessus, dans le h1
(l. 348) et dans le paragraphe (l. 349). **Le même fait, cinq fois, sur un seul
écran.**

**2 · Courses** (l. 415-489)
*Unique et irremplaçable* : la liste de courses (objet / voulu / acheté / prix max /
avancement / payé, l. 440-478) ; le plafond de dépense (l. 427) ; l'état du sac
« Bricoline · sac 986 / 1 000 pods » (l. 484) ; les trois actions du bas (l. 480-483).
*Pas unique* : la tuile « Lots achetés 14 / 20 » (l. 422) redit la tuile jaune de
Ma flotte ; la tuile « En pause » (l. 432) redit le h1 (l. 417) qui redit le
paragraphe (l. 418).

**3 · Hôtel de vente** (l. 492-582)
*Unique* : les six règles de prix, et surtout le bloc `.exemple` (l. 531-535) qui
montre la règle appliquée à un objet réel — c'est la meilleure idée de la maquette,
et le commentaire l. 227-230 dit exactement pourquoi. Les deux chiffres du haut
(17 lots posés, 408 600 k) sont uniques aussi.
*Le problème n'est pas la redite, c'est le titre* : l'écran s'appelle « Hôtel de
vente » et ne contient **aucune vente**. On n'y voit pas ce qui est en ligne, ni ce
qui est parti, ni ce qui a été écarté, ni quel personnage est en train de faire une
passe — alors que Ma flotte affiche « Sombrelle · Relève les prix · 412 objets sur
664 » (l. 391). L'état est montré ailleurs, la commande n'existe nulle part.

**4 · Archimonstres** (l. 585-640)
*Unique* : la collection elle-même. Aucune redite. C'est le seul des six écrans
dont le contenu ne se retrouve nulle part ailleurs.
*Mais* : la colonne `.aq` (l. 260) affiche le mot « manquant » sur les dix tuiles
manquantes (l. 618-627) — alors que le filtre actif est « Manquants » (l. 594) et
que la tuile est déjà inversée. **Ce mot porte zéro information et occupe la seule
ligne libre de la tuile.** Il devrait porter la zone où trouver la bête (les tuiles
possédées, elles, portent bien quelque chose d'utile : le nom du personnage qui a
l'âme).

**5 · Raccourcis** (l. 643-706)
*Unique* : les cinq interrupteurs par personnage (redondants avec les pips, §2.0) ;
l'action « Désigner » qui change de meneur (l. 664 etc.) ; l'assignation des touches
F1-F8.
*Pas unique* : les huit lignes redisent nom, classe, compte et état des huit cartes
de Ma flotte. Les pastilles « Pas entré » / « Pas lancé » (l. 690, 705) redisent les
deux cartes inversées de Ma flotte.

**6 · Réglages** (l. 709-750)
*Unique* : la version, le journal, les droits de la clé, les réglages machine.
Aucune redite. Écran justifié.

### 2.2 Six écrans est-il le bon compte ?

**Non. Il en faut cinq, et ce n'est pas une question de principe : c'est le geste
de jeu qui le dit.**

Quelqu'un qui joue à huit comptes et jette un œil à l'écran fait toujours la même
chose : *il regarde qui décroche, et il le rattrape.* Aujourd'hui ce geste unique
est coupé en deux écrans. On voit le problème sur **Ma flotte** (« Kwakoun est
resté à l'écran de sélection ») et on répare sur **Raccourcis** (rarmer ses
interrupteurs, le redésigner meneur). Entre les deux, un clic dans le rail, un
changement de mise en page complète, et il faut retrouver la bonne ligne parmi
huit après avoir mémorisé la bonne carte parmi huit. **C'est le seul moment où
l'outil oblige à faire un aller-retour, et c'est exactement le moment où
l'utilisateur est en combat.**

**Proposition — fusionner Ma flotte et Raccourcis en un seul écran « Ma flotte ».**

Concrètement, dans la maquette :

- La grille 4 × 2 de cartes reste, avec ses phrases d'état — c'est elle qu'on
  regarde en jouant, et une grille se lit du coin de l'œil bien mieux qu'un
  tableau de huit lignes.
- Les cinq `.pips` deviennent cliquables et gagnent leur légende : au-dessus de la
  grille, une ligne unique de cinq mots (`Réplication · Passe-tour · Invitations ·
  Sans anim. · Échanges`) alignée sur la position des cinq points dans la carte,
  et chaque mot est lui-même le bouton « armer partout » (c'est exactement le
  `.tete-colonne` de la production, `desktop/index.html:682-690`, qui existe déjà
  et qui a déjà son indicateur trois-états).
- Le `.touche` (l. 187), aujourd'hui la plus petite chose de la carte, prend le
  style `.cabochon` (l. 268) — 11,5 px, gras, pleine encre.
- Le bouton « Désigner » n'apparaît pas sur les huit cartes : il apparaît au
  survol de la carte, ou sur la carte du meneur sous forme d'un « changer ».
- L'assignation de touche (choisir une autre touche que F3, mettre M4 ou la
  molette) part dans **Réglages**, dans un bloc « Touches ». On l'y règle une fois
  par an ; elle n'a rien à faire sur un écran regardé en jouant.

**Gain mesurable** : le rail passe de six à cinq boutons ; l'aller-retour
disparaît ; on récupère 456 px de hauteur (les huit lignes de 52 px + l'en-tête de
40 px, l. 151-153) que l'ancien écran Raccourcis consommait pour redire ce que la
grille disait déjà.

**Les autres écrans, je les garde tels quels**, avec une correction de périmètre
sur l'un d'eux :

- **Courses** garde son écran. La liste de courses est un objet à part entière,
  avec ses six colonnes et ses actions propres. Rien à fusionner.
- **Hôtel de vente** garde son écran mais doit s'appeler ce qu'il est, ou devenir
  ce que son nom promet. Deux options, à trancher : soit on le renomme **« Prix »**
  et il reste un écran de règles pures ; soit il gagne, sous les règles, une bande
  de huit lignes « personnage · ce qu'il fait en HDV · lancer / arrêter » — ce que
  la production a déjà (`desktop/index.html:2347-2361`, un bouton HDV par ligne
  avec son menu et son état « en cours »). **Je recommande la seconde** : c'est la
  seule fonction d'OMNI qui tourne longtemps (« environ trois minutes par
  personnage », l. 573) sans qu'on puisse la voir ni l'arrêter.
- **Archimonstres** garde son écran. On le consulte, on ne le pilote pas.
- **Réglages** garde son écran, et récupère l'assignation des touches et le choix
  de thème (§6).

### 2.3 Faut-il ajouter un écran ?

**Non — mais il manque une surface qui n'est pas un écran.** Trois choses n'ont
aujourd'hui aucun endroit où aller :

1. **Un message global.** La production réserve deux bandeaux en haut de la
   fenêtre (`desktop/index.html:846-847`, `#erreur` et `#sansmaitre`, avec
   `flex:none` l. 84 pour qu'ils poussent le contenu au lieu de le recouvrir). La
   refonte n'a rien. Où s'affiche « OMNI a perdu le lien avec le client de
   Sombrelle » ? Proposition : une bande de hauteur nulle entre `.haut` (l. 330) et
   `.vue`, qui grandit à 34 px, en surface inversée, et qui **pousse** l'écran vers
   le bas. Jamais en superposition : un message qui recouvre une donnée sur un
   écran de pilotage est pire que pas de message.
2. **L'overlay.** La production pose une barre de pictos par-dessus le jeu
   (`desktop/overlay.html`, 462 lignes ; le bouton `#boverlay` l. 1056). La refonte
   n'en parle nulle part — le mot « overlay » apparaît 14 fois dans la production
   et **0 fois** dans `app.html`. C'est la seule partie d'OMNI que l'utilisateur
   voit *pendant* qu'il joue, donc la plus importante pour un outil de vision
   périphérique, et elle n'est pas dans la refonte.
3. **L'icône comme cadran.** `labo-omni/icone.html` porte l'idée (reprise dans
   `labo-omni/index.html`) : « c'est l'œil qui s'ouvre et se ferme selon ta
   flotte ». Rien dans `app.html` ne s'y raccroche. Or c'est **la seule chose
   qu'OMNI peut dire à quelqu'un qui a la fenêtre réduite**. À spécifier : les
   quatre barres du logo = quatre paires de personnages ? huit états ? Et que fait
   l'icône de la barre des tâches quand un personnage décroche ?

---

## 3. La hiérarchie visuelle

Méthode : je classe ce que l'œil prend en premier par **surface × écart de
luminance avec son fond**, calculé depuis les valeurs CSS. C'est l'approximation
la plus fiable qu'on puisse faire sans voir la page ; l'ordre des deux ou trois
premiers éléments est fiable, le classement fin des suivants demanderait un rendu.
Je donne les surfaces en pixels carrés déduites de la grille (fenêtre 1097 × 720,
`padding:14px`, rail 62 px, `gap:14px` → **colonne de contenu de 993 px**).

### Ma flotte

| Rang | Ce que l'œil prend | Surface | Écart | Est-ce la bonne chose ? |
|---|---|---|---|---|
| 1 | Les 3 blocs inversés : `.tuile.noire` (l. 363, ~363 × 135) + les 2 `.perso.probleme` (l. 397, 408, ~240 × 194 chacune) | ~145 000 px² | 16,5:1 en clair | **Oui pour les deux cartes. Non pour la tuile** : elle redit exactement ce que les deux cartes disent. |
| 2 | En sombre : la carte jaune du meneur, indistinguable des deux précédentes | ~46 500 px² | 1,08:1 vs le rang 1 | **Non** — §1.1 |
| 3 | Le h1 34 px + sa pastille jaune (l. 348) | — | — | C'est la seule phrase qui dit ce qui se passe, et elle arrive après deux masses. |
| 4 | La tuile jaune « Courses » (l. 358) | ~40 000 px² | **1,01:1 en clair** | **Non** — invisible en clair, et elle annonce « ça tourne » pour une course en pause (§1.6). |

**Ce qui cloche** : les trois premières places de la hiérarchie sont occupées par
**trois formulations du même fait**. Le tiers supérieur de l'écran (titre + tuiles
= ~218 px sur 692, soit 31 % de la hauteur) ne fait que paraphraser la grille.

**Ce que je change, précisément** :
1. **Supprimer les trois tuiles** de Ma flotte (l. 351-369). Elles ne portent
   aucune donnée absente de la grille.
2. **Ramener le bloc titre à deux lignes maximum** : h1 (l. 348) à 28 px au lieu de
   34, et le paragraphe (l. 349) réduit à la seule chose que la grille ne dit pas
   — *« Les six autres suivent Vahlkyr depuis 41 minutes »*. La durée de session
   n'est nulle part ailleurs.
3. Les ~200 px récupérés vont à la grille : chaque carte passe de ~194 à ~294 px
   de haut, ce qui laisse la place aux cinq interrupteurs légendés (§2.2) sur les
   huit cartes, pas seulement aux deux cassées.
4. Rendre la carte de Bricoline inversée (§1.6) : le nombre de blocs inversés
   devient exactement le nombre de choses à faire.

### Courses

| Rang | Ce que l'œil prend | Est-ce la bonne chose ? |
|---|---|---|
| 1 | Le tableau : 6 lignes × 52 px + en-tête 40 px = **352 px de haut sur 993 de large**, soit ~350 000 px² | **Non.** C'est de la référence, pas de l'action. |
| 2 | La `.tuile.noire` « En pause » et son bouton **Reprendre la course** (l. 432-436, ~363 × 135) | **Oui** — mais elle est troisième en ordre de lecture (en haut à droite) et son bouton fait 32 px de haut (`.bt-clair`, l. 122), la plus petite cible d'action de l'écran. |
| 3 | Le h1 (l. 417) | — |

**Ce que je change** :
1. **Le bloc « En pause / Reprendre la course » passe en pleine largeur, juste sous
   le titre**, à la place des trois tuiles. C'est la seule chose à faire sur cet
   écran ; elle doit être la première chose lue et la plus grosse cible.
2. Son bouton passe à 40 px de haut et devient **jaune** (`.bt-jaune`, l. 134 — une
   classe qui existe déjà et qui n'est utilisée nulle part) : reprendre une course,
   c'est remettre en marche, donc c'est du jaune, et il est posé sur la surface
   inversée donc il respecte la décision A du §1.7.
3. Les deux tuiles chiffrées (Lots achetés, Dépensé) descendent en une bande fine
   sous le tableau, à côté de « Bricoline · sac 986 / 1 000 pods » (l. 484) — ce sont
   trois jauges de même nature, elles se lisent mieux ensemble.
4. La colonne « Avancement » fait 174 px de large calculés pour une `.capsule` de
   88 px fixes (l. 164) : **86 px de vide par ligne**. Soit la capsule s'étire à la
   largeur de la colonne, soit la colonne se resserre à 100 px et les 74 px vont à
   la colonne « Objet » qui en a besoin (§4).

### Hôtel de vente

| Rang | Ce que l'œil prend | Est-ce la bonne chose ? |
|---|---|---|
| 1 | La `.regle.large` inversée (l. 521-536), pleine largeur du panneau | **Oui.** C'est le réglage qu'on vient changer, et l'exemple chiffré dedans est la meilleure idée de la maquette. |
| 2 | La tuile jaune « Total mis en vente » (l. 506), en **haut à gauche**, donc premier en ordre de lecture | **Non.** Un décompte n'est pas le sujet de l'écran, et il occupe le point le plus fort de la page. |
| 3 | Les cinq petites cartes de règles | Oui. |

**Ce que je change** :
1. Les deux tuiles chiffrées quittent le haut : elles deviennent une ligne de
   texte dans le sous-titre du h1 — *« 17 lots en ligne sur 30 emplacements,
   408 600 k posés, dernière passe il y a 40 min »*. On gagne ~129 px, et le
   `.reglages-prix` cesse de défiler (§4).
2. `.exemple` (l. 244-249) est illisible **dans les deux thèmes** : en clair,
   `--contre-creux` `#25282B` dans une carte `--encre` `#16181A` → **1,20:1** ; en
   sombre, `#DDE2D8` dans `#EFF2EC` → **1,17:1**. La boîte n'a aucun bord visible,
   elle flotte. Lui donner un filet de 1 px en `--contre-trait` (`#333739` en clair,
   `#C6CDC0` en sombre, déjà définis l. 29 et 41) : le bord devient visible sans
   ajouter de couleur.
3. La carte « Quand relire les prix » (l. 570-577) porte la seule information à
   conséquence opérationnelle de l'écran (« trois minutes par personnage ») et
   c'est la dernière, en bas, probablement sous la ligne de flottaison (§4). La
   remonter juste sous la grande carte.

### Archimonstres

| Rang | Ce que l'œil prend | Est-ce la bonne chose ? |
|---|---|---|
| 1 | **Dix tuiles inversées** dans la grille (l. 618-627) — ~184 × 62 chacune, ~114 000 px² | **Non.** Un archimonstre manquant est l'état normal de la collection : il y en a 108. |
| 2 | Trois capsules de filtre noires (l. 592-594) | **Non.** Un filtre sélectionné n'alerte de rien. |
| 3 | La `.tuile.noire` « Dofus Ocre » et son bouton « Relire les inventaires » (l. 609-612) | **Oui, et c'est la seule action de l'écran** — perdue au milieu de treize autres noirs. |

**C'est la pire hiérarchie des six écrans.** Ce que je change :
1. **Inverser l'encodage de la collection** : un archimonstre **possédé** est une
   tuile pleine (`--carte-creuse`, contour plein), un **manquant** est une tuile
   creuse — fond transparent, filet 1 px en pointillé `--trait-fort`, nom en
   `--encre-douce`. C'est exactement la brique `.droit.non` qui existe déjà à la
   ligne 279 (`background:transparent;border:1px dashed var(--trait);`). Zéro
   couleur nouvelle, et ça applique la règle « la forme avant la couleur » de
   `identite.html:413`.
2. Les capsules de filtre actives passent d'`--encre` à `--carte` sur fond
   `--carte-creuse` (un creux au lieu d'un aplat noir) — décision C du §1.7.
3. Après ça, la `.tuile.noire` « Dofus Ocre » est **le seul bloc inversé de
   l'écran**. Elle est trouvée instantanément.
4. Le mot « manquant » (l. 618-627) cède la place à la zone où trouver la bête.

### Raccourcis (avant fusion)

| Rang | Ce que l'œil prend | Est-ce la bonne chose ? |
|---|---|---|
| 1 | Le champ de **33 interrupteurs allumés** noirs (34 × 20 chacun) sur 40 | Neutre — ça dit « tout est armé », ce qui est vrai. |
| 2 | La pastille jaune « Il commande » (l. 662) | Oui. |
| 3 | ... | |
| dernier | Les pastilles `.pastille-etat.creux` « Pas entré » et « Pas lancé » (l. 690, 705) : fond transparent, filet à **1,29:1**, texte à **4,41:1** | **Non, et c'est grave.** |

**Les deux seules lignes qui réclament quelque chose sont les deux éléments les
plus discrets de l'écran.** C'est l'inverse exact de la règle annoncée.

**Ce que je change** : `.pastille-etat.creux` prend la surface inversée (fond
`--encre`, texte `--carte`), et la ligne entière du personnage injoignable passe à
45 % d'opacité — c'est ce que fait la production (`.rang.hors-ligne{opacity:.4}`,
`desktop/index.html:702`) et ça sépare visuellement « éteint parce que cassé » de
« éteint parce que tu l'as voulu ».

Autre correction : les cinq interrupteurs sont posés dans des colonnes de ~95 px
(`repeat(5,1fr)` sur 641 px répartis, l. 649) sans `justify-self`, donc **collés à
gauche de leur colonne** alors que la colonne fait presque trois fois leur largeur.
Les libellés d'en-tête sont eux aussi à gauche. Résultat : cinq colonnes lâches où
il faut compter pour savoir laquelle est laquelle. Mettre `justify-self:center` sur
`.inter` et `text-align:center` sur les cinq libellés — c'est ce que fait la
production (`.entete .c{text-align:center}`, `desktop/index.html:679`).

### Réglages

| Rang | Ce que l'œil prend | Est-ce la bonne chose ? |
|---|---|---|
| 1 | `.bloc-r.noir` « Quoi de neuf » (l. 716) : 1,25fr d'une grille 1,25fr/1fr sur toute la hauteur, soit **~540 × 530 = 286 000 px²** — la plus grande surface inversée de toute l'application | **Non.** C'est un journal de versions. Rien sur cet écran ne réclame quoi que ce soit. |
| 2 | Onze pastilles jaunes `.droit` (l. 725-728) | **Non.** Une liste statique de droits. |
| 3 | Le h1 « OMNI **0.3.6** » | — |

**Ce que je change** :
1. « Quoi de neuf » devient une carte normale (`.bloc-r` sans `.noir`).
2. Les droits perdent le jaune : accordé = pastille `--carte-creuse` avec le texte
   en pleine encre ; non accordé = la brique creuse pointillée `.droit.non` qui
   existe déjà (l. 279). La différence acquis/manquant se lit alors par la forme,
   comme partout ailleurs après les corrections précédentes.
3. **Le seul élément de cet écran qui mérite d'appeler** n'est pas dessiné du
   tout : une mise à jour disponible. La production le fait (`.qdn-maj.retard`,
   `desktop/index.html:149`, plus le numéro de version qui passe en couleur d'état
   dans la barre de titre, l. 123). À dessiner : un bandeau en surface inversée en
   tête de « Quoi de neuf », avec le numéro et un bouton.

---

## 4. Densité et lisibilité en usage réel

Rappel du cadre : 1097 × 720 px, sur un second écran, regardé du coin de l'œil
entre deux combats. La question n'est pas « est-ce joli » mais **« qu'est-ce qui se
lit sans tourner la tête »**.

### 4.1 Le verdict global : ce n'est pas trop dense, c'est mal réparti

J'ai fait le budget vertical de Ma flotte à partir des valeurs CSS. Hauteur utile :
720 − 28 de `padding` = **692 px**.

| Zone | Hauteur | Part |
|---|---|---|
| `.haut` (barre du haut, l. 76) | 36 px | 5 % |
| `.titre` (h1 34 px + paragraphe sur ~2 lignes) | ~83 px | 12 % |
| `.tuiles` (l. 351) | ~135 px | 20 % |
| `gap` × 3 (l. 75, 92) | 39 px | 6 % |
| `.flotte` (la grille) | **~399 px** | **58 %** |

Dans ces 399 px, la grille est `1fr 1fr` (l. 175) donc chaque rangée fait ~194 px.
Le contenu réel d'une carte fait : 25 (padding) + 32 (`.jeton`) + ~45 (le bloc
`.dit`) + ~39 (`.pied`) = **~141 px**. Comme `.pied` a `margin-top:auto` (l. 194),
la différence part en **~53 px de vide au milieu de chacune des huit cartes**.

Donc : **~424 px de vide dans la grille** (8 × 53), pendant que 218 px du haut de
l'écran servent à répéter cinq fois le même fait (§3). Ce n'est pas un problème de
densité, c'est un problème d'allocation. *Ceci est une addition de valeurs CSS ;
il faudrait voir la page pour confirmer l'ampleur exacte du vide, mais son
existence, elle, découle directement de `flex:1` sur `.flotte` + `margin-top:auto`
sur `.pied`.*

Deux autres écrans ont le problème inverse ou symétrique :

- **Raccourcis** : 8 lignes × 52 px + en-tête 40 px = 456 px dans un `.panneau` qui
  en fait ~547. **91 px de panneau vide en permanence**, et par construction — il
  n'y aura jamais neuf personnages. Proposition : lignes à 60 px (au lieu de 52,
  l. 153) → 520 px, le panneau est plein et chaque ligne respire.
- **Hôtel de vente** : `.reglages-prix` (l. 225) contient une carte pleine largeur
  (~190 px) + deux rangées de cartes (~124 px chacune) + les gaps + 20 de padding
  ≈ **474 px**, dans un panneau qui en fait ~405. **Il manque ~70 px : la grille
  défile, et c'est la carte « Quand relire les prix » qui passe sous la ligne.**
  Le `overflow:auto` de la ligne 226 le confirme comme intentionnel, mais un écran
  de réglages qu'on doit faire défiler pour voir le dernier réglage est un écran
  qui a une carte de trop ou un titre de trop. Supprimer les deux tuiles du haut
  (§3) libère ~129 px et fait tenir la grille entière. *Estimation : à confirmer
  au rendu, l'incertitude porte sur le nombre de lignes des `.dit-r`.*

### 4.2 L'échelle typographique n'existe pas

J'ai relevé **quatorze tailles de texte distinctes** entre 10,5 px et 34 px :

`34` (h1, l. 94) · `31` (`.grand`, l. 110) · `17` (`.bloc-r h3`, l. 271) · `16`
(`.perso .nom` l. 183, `.pas` l. 240) · `15` (`.regle h4`, l. 234) · `14,5`
(`.perso-mini .n`, l. 162) · `13,5` (`.ligne` l. 153, `.titre p` l. 96, `.archi .an`
l. 259) · `13` (`.armer` l. 78, `.quoi` l. 108, `.exemple` l. 246, `.rangee-r`
l. 285) · `12,5` (**seize règles différentes**) · `12` (`.droit` l. 278,
`.rangee-r .doux` l. 287) · `11,5` (`.dit span` l. 191, `.cabochon` l. 268,
`.entete` l. 151, `.bt-mini` l. 206) · `11` (`.compte` l. 184, `.aq` l. 260) ·
`10,5` (`.jeton` l. 160, `.touche` l. 187, `.exemple .et` l. 249).

Ce n'est pas une échelle, c'est un continuum. Deux conséquences concrètes :

- **34 et 31 sont à trois pixels l'un de l'autre.** Le titre de l'écran et le
  chiffre d'une tuile se lisent donc comme le même niveau alors qu'ils ne disent
  pas du tout la même chose. Un des deux doit bouger : je propose `.grand` à 26 px.
- **12,5 px porte seize rôles différents** — un texte d'explication, un libellé de
  bouton, une valeur de tableau, une note de journal. Aucun de ces rôles ne se
  distingue d'un autre par la taille.

**Échelle proposée, six pas, à mettre dans la planche d'identité** :

| Pas | Taille | Emploi | Ce qui s'y range aujourd'hui |
|---|---|---|---|
| Titre d'écran | **28 / Outfit 700 / −0,028em** | le h1, un par écran | 34 |
| Grand chiffre | **26 / Outfit 700 / −0,03em / tabulaire** | `.grand`, `.pas b` | 31, 16 |
| Titre de bloc | **17 / Outfit 700** | `.bloc-r h3`, `.regle h4` | 17, 15 |
| Nom | **15 / Outfit 600** | `.perso .nom`, `.perso-mini .n`, `.archi .an` | 16, 14,5, 13,5 |
| Corps | **13 / Jakarta 400-600** | tout le texte courant, valeurs de tableau, boutons | 13,5, 13, 12,5 |
| Mention | **11,5 / Jakarta 500-700** | libellés d'en-tête, sous-lignes, `.touche`, `.jeton` | 12, 11,5, 11, 10,5 |

**Rien en dessous de 11,5 px.** Justification directe : à cette distance et en
vision périphérique, 10,5 px en gris moyen n'est pas du texte, c'est une texture.

### 4.3 Les zones où l'on ne distingue plus rien

**(a) Le gris de texte secondaire est sous le seuil.** `--encre-douce` `#6E756C`
(l. 28) donne **4,41:1** sur `--carte`, **4,10:1** sur `--carte-creuse` et
**3,93:1** sur `--fond`. Il porte : le paragraphe explicatif sous chaque h1
(l. 96 — la phrase qui dit ce qui se passe), les en-têtes de colonnes (l. 151),
tous les `.doux`, `.dit-r`, `.compte`, `.aq`. **Proposition chiffrée** :
`--encre-douce: #5C6360` → 5,73:1 / 5,32:1 / 5,10:1. En sombre, `#8E958C` (l. 40)
tombe à 4,65:1 sur `--carte-creuse` ; `#9AA298` donne 6,17:1 / 5,44:1.

**(b) `.bt-vide` est un bouton invisible.** Ligne 137 : fond transparent, filet
1 px `--trait` (**1,29:1** sur `--carte`), texte `--encre-douce` (**4,41:1**). C'est
la seule apparence des boutons **« Désigner »** (7 fois sur Raccourcis, l. 664 etc.),
**« Changer le plafond »** et **« Choisir qui fait les courses »** (l. 481-482), et
**« Ouvrir »** le dossier (l. 745). Un bouton dont toute l'existence visuelle tient
dans un filet à 1,29:1 n'est pas un bouton. **Proposition** : filet 1 px en
`--trait-fort` (`#B9BFB4` clair, `#3B4348` sombre, déjà définis l. 29/41) **et**
texte en `--encre` plein (16,54:1) au lieu d'`--encre-douce`. Le libellé porte alors
le bouton, le filet ne fait que le délimiter.

**(c) Les mêmes filets partout.** `--trait` à 1,29:1 en clair et 1,29:1 en sombre
sert de séparation d'en-tête de tableau (l. 151), de bordure de `.bt-vide` (l. 137),
de bord de `.rond-r` (l. 241) et des boutons de fenêtre (l. 82). Les trois boutons
ronds de réglage `−` / `+` (l. 241) et les deux boutons de fenêtre (réduire /
fermer, l. 340-341) sont donc des cercles de 28 et 34 px dont le contour est à la
limite du perceptible. Mêmes remplacements qu'en (b).

**(d) La touche de raccourci, la plus petite chose de la carte.** `.perso .touche`
(l. 187) : **10,5 px**, en `--encre-douce` (4,41:1), sur `--carte-creuse`. C'est la
donnée la plus opératoire de la carte — *quelle touche presser pour sauter sur ce
personnage* — et c'est le plus petit texte de l'écran. Sur l'autre écran, la même
donnée est un `.cabochon` (l. 268) : 11,5 px, gras 700, en `--encre` pleine.
**La même donnée, deux traitements, et l'écran le plus regardé reçoit le plus
faible.** Proposition : `.perso .touche` adopte exactement `.cabochon`.

**(e) Quarante points sans légende.** Les `.pips` (l. 195-200) sur Ma flotte :
9 px de diamètre, plein ou creux, jusqu'à 40 sur l'écran. Ils encodent les cinq
fonctions armées (§2.0) et **aucun texte de la maquette ne le dit**. Un creux et un
plein à 9 px se distinguent mal du coin de l'œil, et ce d'autant plus que l'état
creux est un `box-shadow: inset 0 0 0 1.5px var(--trait-fort)` (l. 197) —
`--trait-fort` étant à **1,75:1** sur `--carte`. Donc en clair, un pip éteint est
quasiment un trou blanc. Proposition : pips à 11 px, contour du creux en
`--encre-douce` corrigé (5,73:1), légende de cinq mots au-dessus de la grille (§2.2).

**(f) Le champ des interrupteurs sur Raccourcis.** 40 pastilles identiques de
34 × 20 dans une grille 5 × 8, sans aucun séparateur vertical (`.ligne` n'a qu'une
bordure basse, l. 153) et avec les pastilles collées à gauche de colonnes de 95 px
(§3). Pour répondre à « est-ce que les Échanges d'Ourseline sont armés ? », il faut
compter cinq colonnes et cinq lignes. Propositions cumulables : centrer les
pastilles ; ramener les colonnes à leur largeur utile (~60 px) et rendre les
120 px récupérés à la colonne Personnage ; remettre l'indicateur trois-états dans
l'en-tête (`.jauge` de la production, `desktop/index.html:694-703` : plein / moitié /
creux selon que tous, certains ou aucun l'ont).

**(g) Aucun chiffre n'est tabulaire.** `font-variant-numeric: tabular-nums`
n'apparaît **pas une seule fois** dans `app.html`, contre **14 fois** dans
`desktop/index.html`. Sur des colonnes de chiffres qui se rafraîchissent en direct
(« 412 objets sur 664 », « 1,24 M », les colonnes Payé / Prix max), les glyphes de
largeur variable font **danser les colonnes à chaque mise à jour**. Sur un écran
regardé en vision périphérique, un mouvement est précisément ce qui attire l'œil —
donc l'écran attirera l'attention pour un changement de chiffre sans importance.
À appliquer sur `.grand`, `.d`, `.pas b`, `.exemple b`, `.capsule`, `.aq`, `.compte`.

**(h) Quatre formats d'argent dans une seule maquette.** `1,24 M` (l. 428),
`408 600 k` (l. 511), `1 600 k` (l. 519), `304 000 k` (l. 521), `17 800 k` (l. 533).
Un utilisateur qui compare « 1,24 M » et « 408 600 k » doit convertir de tête.
C'est une décision de design, elle n'est pas prise, et Alexis ne peut pas la
prendre à votre place. **Proposition** : `k` en dessous de 1 000 000, `M` avec deux
décimales au-dessus, espace fine insécable comme séparateur de milliers, toujours
en chiffres tabulaires. Et **jamais deux unités différentes dans une même colonne**.

### 4.4 Ce qui, à l'inverse, tient très bien

Pour être honnête sur les deux sens : la maquette est **globalement au bon niveau
de densité**. Rien n'est tassé, les rayons (20-22 px sur les cartes) donnent des
blocs franchement séparés, les hauteurs de ligne (1,45 sur le corps, 1,04 sur les
titres) sont justes, et le texte de tous les écrans est écrit — pas étiqueté. Les
phrases d'état (« resté à l'écran de sélection », « sac plein, 14 lots sur 20 »,
« Le sac de Bricoline est plein. OMNI n'a rien abandonné ») sont exactement ce
qu'il faut pour un outil qu'on consulte d'un coup d'œil : **elles disent l'état ET
sa cause**, ce qui évite d'avoir à cliquer pour comprendre. C'est la règle n° 4
d'`identite.html` (l. 415, « L'écran dit ce qui se passe ») et c'est la seule des
quatre que la refonte a intégralement tenue.

---

## 5. La cohérence du système, et ce que doit contenir la nouvelle planche d'identité

### 5.1 L'écart actuel entre `identite.html` et `app.html`

L'écart n'est pas un décalage, c'est une rupture totale. `identite.html` décrit un
autre produit :

| | `identite.html` | `app.html` |
|---|---|---|
| Palette | 4 couleurs : volt `#7C5CFF`, braise `#FF8A3D`, jade `#2FE0A8`, rouge `#FF4D6D` (l. 18-21, 32-36) | 1 couleur : acide `#E2F27C` (l. 31) |
| Fond | nuit `#0A0B12`, sombre uniquement | deux thèmes, clair par défaut |
| Polices | **Anybody + Public Sans** (l. 7) | **Outfit + Plus Jakarta Sans** (l. 7) |
| Forme signature | « le coin coupé, toujours du même côté, 14 px » (l. 411) | aucun `clip-path` nulle part — tout est en `border-radius` de 11 à 22 px |
| Symbole | trois propositions : couronne / oméga / relais (l. 213, 235, 260) | les quatre barres de l'œil (l. 298-305), qui n'apparaissent que dans `icone.html` |

**Une seule des quatre règles d'`identite.html` survit** (l. 415, « L'écran dit ce
qui se passe »). Les trois autres sont mortes ou trahies :
- *« Le coin coupé, toujours du même côté »* → abandonné pour des coins arrondis.
- *« Une couleur, un métier »* → il n'y a plus qu'une couleur.
- *« La forme avant la couleur »* → **trahie**, et c'est celle qu'il fallait garder
  (§1.7, §3).

À noter pour le classement du labo : `labo-omni/clair.html` n'est **pas** un
orphelin de l'ancienne passe. Il porte exactement la palette et les polices
d'`app.html` (`--acide:#E2F27C`, Outfit + Jakarta) : c'est l'ancêtre direct de la
maquette actuelle, en clair seulement. `couleurs.html` et `oeil.html` portent, eux,
Anybody + Public Sans : ce sont des pièces de la passe rejetée (l'un choisit le
nombre de couleurs, l'autre le symbole) et ils doivent aller au cimetière avec
`a-rangee`, `b-plein-jour` et `c-huit-couleurs`.

### 5.2 Ce que la nouvelle planche doit contenir

Voici le contenu exact, prêt à être mis en page. C'est le premier document
qu'Alexis lira ; tout ce qui n'y est pas, il l'inventera.

#### A. La règle, en une phrase

> **Le fond clair, c'est ce qui va bien. Une carte qui s'inverse, c'est une chose
> à faire — et il n'y en a jamais d'autre. Le jaune, c'est OMNI : il ne se pose
> que sur du foncé, il marque ce qui mène et ce qui tourne, il n'alerte de rien.**

Plus les deux garde-fous vérifiables :
1. **Le jaune ne se pose jamais sur une surface plus claire que lui.**
2. **Le nombre de blocs inversés à l'écran = le nombre de choses à faire.**

#### B. Les couleurs et leur métier

Les valeurs actuelles sont bonnes dans l'ensemble ; quatre changent (marqués **▲**),
deux se scindent (marqués **✂**).

| Jeton | Clair | Sombre | Métier — une phrase, jamais deux |
|---|---|---|---|
| `--fond` | `#E7EBE4` | `#14171A` | Le papier de la fenêtre. |
| `--carte` | `#F6F7F3` | `#1D2124` | Une carte, un panneau. Tout ce qui va bien. |
| `--carte-creuse` | `#EDEFE9` | `#262B2F` | Un creux **dans** une carte : jeton, capsule vide, survol de ligne. |
| `--encre` ✂ | `#16181A` | `#EFF2EC` | **Le texte, et rien d'autre.** |
| `--alarme` ✂ | `#16181A` | `#EFF2EC` | **La surface d'une chose à faire.** Même valeur que `--encre`, autre métier : sépare-les, sinon tout ce qui est écrit devient une alarme (§1.4). |
| `--sur-alarme` | `#F6F7F3` | `#1D2124` | Le texte posé sur `--alarme`. |
| `--encre-douce` ▲ | `#5C6360` *(était `#6E756C`)* | `#9AA298` *(était `#8E958C`)* | Le texte secondaire. 5,73:1 au lieu de 4,41:1 (§4.3a). |
| `--trait` | `#D8DCD3` | `#2E3438` | Une séparation **à l'intérieur** d'un bloc. Jamais le contour d'un bouton. |
| `--trait-fort` | `#B9BFB4` | `#3B4348` | Le contour d'un bouton creux, le pointillé d'un état vide. |
| `--acide` | `#E2F27C` | `#E2F27C` | **La marque.** Ne bouge dans aucun thème. Ne se pose que sur du foncé. |
| `--sur-acide` | `#16181A` | `#16181A` | Le texte posé sur le jaune. Ne bouge pas non plus. |
| `--acide-sur-alarme` ▲ | `#C9DC5C` | **`#16181A`** *(était `#C9DC5C`)* | Ce qui marque un accent **sur** la surface d'alarme. Corrige les huit règles cassées du §1.2. |
| `--olive` ▲ | `#5C6644` | `#5C6644` | Le texte secondaire posé sur le jaune (5,01:1). **Aujourd'hui écrit en dur cinq fois** dans le fichier (l. 111, 190, et en style inline l. 359, 428, 507) : à nommer, sinon Alexis inventera sa propre valeur. |
| `--rail` | `#16181A` | `#0B0D0F` | Le rail. **Toujours la colonne la plus foncée, dans les deux thèmes.** C'est ce qui rend le jaune du bouton actif valable partout (14,60:1 / 14,76:1). |
| `--rail-icone` ▲ | `#7C837A` | `#7C837A` | Les icônes du rail au repos. Écrit en dur l. 71. |

À déclarer explicitement dans la planche, parce que le commentaire l. 15-22 le dit
déjà très bien et qu'il ne doit pas se perdre :

> `--encre` ne veut pas dire « noir » : il veut dire **le contraire du fond**. En
> clair il est noir, en sombre il est crème. C'est ce seul basculement qui retourne
> toute l'app.

**Trois valeurs restent à écrire en dur et doivent être nommées** : le dégradé de
`.rail .moi` (`linear-gradient(150deg,#5B6E4A,#2C3826)`, l. 74 — et il faut d'abord
décider ce qu'est cet élément, §6), les blancs du rail (`#F6F7F3` l. 68, `#E7EBE4`
l. 72), et `--olive` ci-dessus.

#### C. Les lettres

- **Outfit** — titres, noms, grands chiffres. Graisses 600 et 700 uniquement.
- **Plus Jakarta Sans** — tout le reste. Graisses 400, 500, 600, 700.
- **Les deux doivent être embarquées en `.woff2` dans l'application, pas appelées
  chez Google.** `app.html` les charge depuis `fonts.googleapis.com` (l. 5-7). La
  production a résolu ça et a écrit pourquoi : *« Polices EMBARQUEES, jamais
  appelees en ligne: OMNI doit demarrer sans reseau »* (`desktop/index.html:5-6`,
  avec `desktop/polices/` et son `LISEZMOI.md` de licences). **Sans ça, OMNI lancé
  hors ligne s'affiche en Segoe UI**, et toute la mise en page bouge. C'est une
  décision de design (quelles graisses on embarque, quel poids de fichier on
  accepte) autant qu'un point technique : deux familles × 4 graisses = 8 fichiers,
  ou bien deux variables.

L'échelle : celle du §4.2, six pas, rien en dessous de 11,5 px, avec pour chaque pas
la police, la graisse, l'interlettrage et la liste des emplois.

#### D. Les rayons

Huit valeurs différentes aujourd'hui : `999`, `22` (×4), `20` (×2), `18`, `14` (×2),
`13`, `12`, `11`, plus `50%`. **Cinq suffisent**, et ils doivent porter un sens :

| Rayon | Ce qui le porte |
|---|---|
| `999px` | Tout ce qui est une capsule : bouton, pastille, jauge, interrupteur, filtre. |
| `22px` | Un bloc de premier niveau : fenêtre, `.panneau`, `.tuile`, `.bloc-r`, `.rail`. *(absorbe le 20 de `.rail` et `.perso`)* |
| `14px` | Un bloc **dans** un bloc : `.regle`, `.exemple`, `.archi`. *(absorbe le 18)* |
| `11px` | Un petit objet carré : `.jeton`, bouton du rail, `.moi`. *(absorbe le 13 et le 12)* |
| `50%` | Un rond véritable : `.rond` d'une tuile, `.rond-r`, les boutons de fenêtre. |

#### E. Les espacements

Il n'y a aucune trame : `gap` prend **douze valeurs** dans le fichier — 4, 5, 6, 7,
8, 9, 10, 11, 12, 13, 14, 18 — c'est-à-dire à peu près chaque entier de 4 à 14.
Les `padding` sont dans le même état (`15px 18px 14px`, `13px 15px 12px`,
`12px 15px 13px`, `20px 22px`…). **Trame proposée : 4 · 8 · 12 · 16 · 20 · 24.**
Correspondances : les gaps de 4 et 5 → 4 ; 6, 7, 8, 9 → 8 ; 10, 11, 12, 13, 14 → 12 ;
18 → 16 ou 20. Le padding des cartes se cale sur `16px` horizontal / `12px` vertical.

#### F. Les briques, avec leurs états

C'est la partie que la planche actuelle fait déjà (`identite.html`, section 5) et
qu'il faut refaire pour les briques d'`app.html`. Chaque brique doit être montrée
**avec tous ses états** — c'est ça qui manque (§6). La liste :

1. **La carte de personnage** — normale / meneur (liseré) / à rattraper (inversée) /
   injoignable (45 % d'opacité) / survol / focus clavier.
2. **La tuile de chiffre** (`.tuile`) — normale / jaune / inversée / vide (pas
   encore de donnée) / en cours de calcul.
3. **La capsule de progression** (`.capsule`) — 0 % / en cours / 100 % / indéterminée.
4. **Les pips** — plein / creux / désactivé, avec leur légende.
5. **L'interrupteur** (`.inter`) — on / off / désactivé / focus, dans les deux thèmes.
6. **Le groupe de filtres** (`.grp`) — au repos / sélectionné / survol / focus.
7. **Les quatre boutons** : plein foncé (`.bt-noir`), plein jaune (`.bt-jaune` —
   **existe l. 134 et n'est utilisé nulle part**), creux (`.bt-vide`, à corriger
   §4.3b), mini (`.bt-mini`). Chacun : repos / survol / pressé / désactivé / occupé.
8. **La pastille d'état** (`.pastille-etat`) — pleine / creuse / alarme.
9. **La ligne de tableau** (`.ligne`) — repos / survol / sélectionnée / atténuée.
10. **Le jeton de classe** (`.jeton`) — et la décision : abréviation à trois lettres
    ou emblème de classe ? La production dit que l'abréviation est **provisoire**
    (`desktop/index.html:715-717` : *« La plaque en losange accueillera l'embleme de
    classe. En attendant elle porte l'abreviation »*). La refonte reprend
    l'abréviation sans dire que c'est provisoire — donc elle sera livrée telle
    quelle.
11. **Le titre d'écran** — avec la règle d'emploi du `.marqueur` (§1.3) : il ne
    surligne que ce qui mène ou ce qui tourne, ou bien on le supprime.
12. **Le bandeau de message global** — qui n'existe pas encore (§2.3).

#### G. Le nettoyage à faire dans le fichier lui-même

Quatre blocs de CSS d'`app.html` décrivent des briques qui n'existent sur aucun
écran. Il faut trancher : ce sont soit des écrans supprimés dont il reste la trace,
soit des briques prévues qu'on a oublié de poser.

| Lignes | Classe | Emplois dans le HTML |
|---|---|---|
| 134 | `.bt-jaune` | **0** |
| 208-210 | `.pied-panneau` (un pied de tableau avec un total) | **0** |
| 215-222 | `.gain` / `.perte` | **0** |

Le cas `.perte` est parlant : le commentaire l. 212-214 décrit avec soin une vue de
**gains et pertes** (« Un gain, c'est la normale : il reste discret. Une perte est
l'exception, donc elle prend la pastille qui tranche »), et cette vue n'existe nulle
part dans les six écrans. **Soit un écran « ce qui s'est vendu » a disparu en route
et il faut décider s'il revient, soit ces 12 lignes doivent partir.** Vu qu'OMNI
met en vente et remet à prix, savoir ce qui est parti et pour combien est
probablement la question la plus fréquente de l'utilisateur — et elle n'a
aujourd'hui aucune réponse dans la refonte (§7).

---

## 6. Ce qui manque pour implémenter

La maquette montre un seul instant : huit personnages connus, six en jeu, une
course entamée, des données partout. Tout le reste est à inventer. Voici la liste,
avec pour chacun **où ça apparaîtrait** et **ce que je propose**. C'est la partie
que je recommande de trancher avant de livrer.

### 6.1 Les états d'interaction — absents à 90 %

| Manque | Constat | Où | Proposition |
|---|---|---|---|
| **Focus clavier** | `:focus-visible` : **0 occurrence** dans `app.html`. La production en a une (`desktop/index.html:85`). Tous les contrôles sont des `<button>` avec `border:0`. | Les 6 boutons du rail, les 40 interrupteurs, les 12 capsules de filtre, les 8 boutons ronds `−`/`+`, tous les `.bt-*`. | Une règle unique : `:focus-visible{outline:2px solid var(--acide);outline-offset:2px;box-shadow:0 0 0 4px var(--alarme)}` — le jaune se voit sur le foncé, le halo foncé se voit sur le clair, donc le repère survit aux deux thèmes **et** au fait d'être posé sur du jaune. |
| **Survol** | 7 règles `:hover` seulement (production : 27). | Manque sur : `.inter` (40), `.grp button` (12), `.tuile .plus`, `.archi`, `.perso`, `.bt-clair`, `.bt-mini`, `.bt-noir`, `.cabochon`, `.droit`. | Deux recettes, pas plus : **sur une surface**, le fond monte d'un cran (`--carte` → `--carte-creuse`) ; **sur une capsule creuse**, le filet et le texte passent en `--encre`. |
| **Pressé** | 0 occurrence. | Tous les boutons. | `:active` → l'élément descend de 1 px (`transform:translateY(1px)`). Sur un outil piloté au clic rapide, c'est le seul accusé de réception immédiat. |
| **Désactivé** | 0 occurrence. La production en a trois (`.case:disabled`, `.tete-colonne:disabled`, `.hdv:disabled`). | Les 5 interrupteurs d'un personnage non lancé (Tacatak, l. 705) sont dessinés simplement *éteints* — donc **indiscernables de « tu les as éteints exprès »**. Idem « Désigner » sur un personnage injoignable. | Désactivé = 35 % d'opacité + `cursor:not-allowed` + piste creuse sans bouton. Et **la règle qui va avec, à écrire** : on ne peut pas désigner meneur un personnage qui n'est pas en jeu (la maquette l'applique déjà, l. 690 et 705, mais ne le dit nulle part). |
| **Occupé** | 0 occurrence. | « Relire les inventaires » (l. 611), « Réveiller » (l. 400), « Lancer » (l. 410), « Reprendre la course » (l. 436), et surtout une passe de prix qui dure **« environ trois minutes par personnage »** (l. 573). | Un bouton qui lance un travail long **devient sur place la capsule de progression** (`.capsule`, la brique existe l. 164) avec son compte : *« 3 / 8 inventaires »*. Pas de spinner : OMNI connaît toujours le total, donc il peut toujours donner une fraction. |

### 6.2 Les états vides — aucun n'est dessiné

| Situation | Où ça casse | Proposition |
|---|---|---|
| **Aucun client Dofus lancé** — le cas le plus fréquent : c'est l'état d'OMNI au démarrage de la machine | Toute la grille `.flotte` (l. 370), les trois tuiles, le h1, le tableau Raccourcis. **Rien n'est prévu.** | La production a exactement le bon texte, à reprendre mot pour mot (`desktop/index.html:849-852`) : *« **Aucun client Dofus détecté** — Lance tes clients maintenant : OMNI doit tourner AVANT eux pour pouvoir les suivre. »* Il lui manque une forme : je propose la grille 4 × 2 dessinée **en huit emplacements creux** (filet pointillé `--trait-fort`, la brique `.droit.non` l. 279), avec ce message au centre. On voit ainsi immédiatement que l'outil attend huit personnages. |
| **Un seul personnage au lieu de huit** | `.flotte` est figée en `repeat(4,1fr)` × `1fr 1fr` (l. 175) : une carte seule occupe 240 × 194 px en haut à gauche et laisse **~750 × 400 px de vide**. | À décider, et c'est une vraie décision : (a) les emplacements vides restent dessinés en creux — cohérent avec l'état ci-dessus, et ça dit « il t'en manque sept » ; (b) la grille s'adapte (`repeat(auto-fit,minmax(230px,1fr))`, plafonnée à 4 colonnes) et les cartes grossissent. **Je recommande (a)** : pour un joueur à huit comptes, un emplacement vide *est* une information. |
| **Liste de courses à zéro** (aucune liste configurée) | Le `.panneau` de Courses (l. 438) : un en-tête de 40 px au-dessus de 300 px de vide. | Le panneau porte le message et **le bouton « Modifier la liste » monte dedans** — la seule action possible devient le seul élément visible. Les tuiles chiffrées affichent `—`, pas `0` : zéro lot acheté sur zéro prévu n'a pas de sens. |
| **Archimonstres avant la première lecture d'inventaire** | Le h1 dirait « 0 archimonstres sur 286 », la grille serait vide. | Le h1 devient *« Aucun inventaire lu pour l'instant »*, et la tuile inversée « Relire les inventaires » monte en pleine largeur. |
| **Clé expirée / aucun droit** | Les 12 pastilles `.droit` (l. 725-728) passeraient toutes en `.droit.non`. Le reste de l'app ne dit rien. | Que devient un écran dont la fonction n'est pas autorisée ? Aujourd'hui « courses » est marqué non accordé (l. 728) **et l'écran Courses est quand même dans le rail, plein de données**. À trancher : le bouton du rail est grisé, ou l'écran s'affiche avec un bandeau. |
| **Journal des versions vide** (première installation) | `.notes` (l. 719-724). | Une ligne : *« C'est ta première version. »* |

### 6.3 Erreurs et messages

Il n'existe **aucune surface de message** dans `app.html` (§2.3). La production en
réserve deux, en `flex:none` pour qu'elles poussent le contenu au lieu de le
recouvrir (`desktop/index.html:84`, `846-847`). Questions sans réponse dans la
maquette :

- Où s'affiche « OMNI a perdu le lien avec le client de Sombrelle » ?
- Où s'affiche un refus (« cette touche est déjà prise par F3 ») ?
- Où s'affiche « aucun meneur désigné » — un état qui a sa propre bannière en
  production (`#sansmaitre`) et qui bloque toute la fonction principale ?
- Que devient l'écran quand OMNI est **au repos** ? Le bouton `.armer` (l. 332) n'a
  qu'un seul état dessiné : *« OMNI est armé »*, pastille foncée, point jaune. La
  production dessine les deux (`actif` / `au repos`, `desktop/index.html:809`,
  `2580-2582`) avec un témoin **de forme différente** — losange creux au repos,
  plein et halo quand armé (`desktop/index.html:197-204`). **L'état global le plus
  important du produit n'a pas d'état « éteint » dans la maquette.**

**Proposition** : une bande entre `.haut` (l. 330) et `.vue`, hauteur 0 par défaut,
34 px quand elle porte un message, en surface `--alarme`, qui **pousse** l'écran.
Trois tons possibles seulement : information (carte normale + filet), à faire
(surface inversée), et rien. Et pour `.armer` : dessiner les deux états, en
différenciant par la forme (point plein / anneau creux) autant que par la couleur.

### 6.4 Texte trop long, chiffres qui débordent

Mesures faites depuis la grille CSS (largeur de contenu 993 px).

| Endroit | Budget calculé | Risque | Proposition |
|---|---|---|---|
| `.perso .nom` (l. 183) | carte de 240 px − 30 de padding − 32 (jeton) − 10 − ~30 (touche) − 10 = **~128 px** pour du 16 px Outfit 600, soit **~13 caractères** | Un nom de personnage Dofus va jusqu'à 20 caractères. **La majorité des noms réels seront coupés.** Il y a bien `text-overflow:ellipsis`, donc pas de casse — mais on perd le nom, qui est la clé d'identification de la carte. | Nom à 15 px (§4.2) + supprimer `.compte` de la carte (l. 184 : « jibef-1 » — l'utilisateur reconnaît ses comptes par le nom du personnage, et le compte reste sur Réglages). Ça libère la ligne entière : le nom peut passer sur deux lignes ou occuper toute la largeur. |
| `.panneau .ligne .doux` (l. 157) | `white-space:nowrap` **sans** `overflow:hidden` ni `text-overflow` | **Le texte déborde dans la colonne voisine sans être coupé.** « Eniripsa · jibef-2 » tient dans les ~122 px disponibles ; un nom de compte plus long passera par-dessus la colonne « Touche ». C'est le seul endroit du fichier où le garde-fou manque — `.perso-mini .n` juste au-dessus (l. 162) l'a. | Ajouter `overflow:hidden;text-overflow:ellipsis` et `min-width:0` sur la cellule parente. |
| `.perso .compte` (l. 184) | aucune règle de débordement du tout | idem | idem, ou suppression (ci-dessus). |
| `.archi .an` (l. 259) | cellule de ~184 px − 26 de padding = **~158 px** pour du 13,5 px | L'auteur de la maquette a **déjà abrégé à la main** : « Craqueleur Légend. » (l. 621). C'est le signe que le budget est juste. | Soit la grille passe de 5 à 4 colonnes (~236 px par tuile), soit le nom peut occuper deux lignes. **Et dans tous les cas : `title` avec le nom complet sur tout élément tronqué** — nulle part dans la maquette un texte coupé ne porte son texte entier. |
| `.tuile .quoi` (l. 108) et `.regle h4` (l. 234) | aucune règle | « Total mis en vente » tient ; un libellé plus long casserait la mise en page de la tuile. | Une règle générale, à écrire une fois dans la planche : **tout libellé sur une ligne porte `min-width:0; overflow:hidden; text-overflow:ellipsis`, et tout élément tronqué porte son texte complet en `title`.** |
| Les grands chiffres (`.grand`, l. 110) | 31 px Outfit dans une tuile de ~298 px | « 408 600 » tient. « 12 408 600 » ? Et si le plafond est à 999 M ? | Taille de police qui descend d'un pas au-delà de 9 caractères, ou format abrégé imposé (§4.3h). |
| Tous les chiffres | **0 `tabular-nums`** dans le fichier | Colonnes qui dansent à chaque rafraîchissement (§4.3g) | `font-variant-numeric:tabular-nums` sur `.grand`, `.d`, `.pas b`, `.exemple b`, `.aq`, `.compte`. |

### 6.5 Ce qui n'est pas dessiné du tout et qu'il faudra bien dessiner

1. **L'assignation d'une touche.** La maquette montre F1…F8 comme des pastilles
   fixes (l. 663 etc.). Rien ne dit comment on en change, à quoi ressemble une
   touche **non assignée**, ni que la production accepte aussi les boutons de
   souris — M4, M5, molette (`desktop/index.html:1120-1122`). Trois états à
   dessiner : assignée / non assignée / en cours de capture (« appuie sur une
   touche… », avec Échap pour annuler).
2. **Le changement de meneur.** Sept boutons « Désigner » (l. 664 etc.). Que se
   passe-t-il au clic — bascule immédiate, ou confirmation ? Et l'ancien meneur ?
   À dessiner : l'état transitoire, ne serait-ce qu'une seconde.
3. **Le menu `⋯`.** Le caractère `⋯` (l. 353 etc.) apparaît sur **les onze tuiles**
   et n'ouvre rien de spécifié. C'est en plus un caractère typographique, pas une
   icône : son rendu variera selon la police disponible. Soit on spécifie le menu,
   soit **on le supprime** — je recommande la suppression : une affordance sans
   libellé sur une tuile de statistique n'apporte rien.
4. **`.rail .moi`** (l. 74) : un carré de 36 px avec un dégradé vert, en bas du
   rail, sans libellé, sans `title`, jamais expliqué. Sur un produit **mono-
   utilisateur**, il ne peut pas s'agir d'un avatar de compte. À trancher : ou bien
   c'est l'œil-cadran d'`icone.html` (et là il devient très utile : il dit l'état de
   la flotte depuis n'importe quel écran), ou bien il faut le supprimer.
5. **Les barres de défilement.** Quatre zones défilent (`overflow:auto` l. 152, 226,
   256, 280) et aucune n'a de style. Sous Windows/Electron, la barre par défaut est
   une bande grise de 17 px qui viendra se poser sur `--carte` et jurera dans les
   deux thèmes. À dessiner : largeur 8 px, pouce en `--trait-fort`, piste
   transparente.
6. **Le thème : valeur par défaut et persistance.** Le bouton de bascule (l. 334)
   occupe une place permanente dans la barre du haut de **tous les écrans** pour un
   choix qu'on fait une fois. Non spécifié : quel thème au premier lancement, et
   est-ce que ça suit Windows ? **Proposition** : suivre le thème du système par
   défaut, déplacer le réglage dans **Réglages › La machine** (l. 740) à côté de
   « Démarrer avec Windows », et récupérer la place dans la barre du haut.
7. **La zone de déplacement de la fenêtre.** La fenêtre n'a pas de cadre système
   (les boutons réduire/fermer sont dessinés, l. 340-341). Rien dans la maquette ne
   dit **quelle bande déplace la fenêtre**. C'est une décision de design, pas
   seulement technique : il faut désigner `.haut` comme poignée, et savoir que
   chaque bouton qui s'y trouve devra être exclu — la production porte un
   avertissement explicite sur ce point précis, après le bug
   (`desktop/index.html:108-111` : *« sans cette ligne, Windows avale le clic comme
   un deplacement de fenetre et le bouton ne fait RIEN, sans le moindre message »*).
8. **Ce que dit OMNI quand on ne le regarde pas.** C'est un outil de second écran :
   la moitié du temps, la fenêtre est réduite ou masquée par le jeu. Rien n'est
   spécifié pour ce moment-là — ni l'icône de la barre des tâches, ni un son, ni
   l'overlay. `labo-omni/icone.html` porte l'idée de l'œil qui s'ouvre et se ferme
   selon la flotte ; `desktop/sons/` existe en production. **À décider : quel
   événement mérite de déranger quelqu'un qui est en combat ?** Ma réponse : un
   seul — un personnage qui décroche. Et il se signale par l'icône, pas par un son.
9. **Les six icônes du rail** n'ont que des `title` (l. 307-323). Sous Windows, une
   infobulle met ~500 ms à apparaître. Pour un utilisateur unique qui les aura
   apprises en un jour, c'est acceptable — mais l'écran actif se signale uniquement
   par un aplat jaune (l. 72), donc **par la couleur seule**, ce qui contredit la
   règle « la forme avant la couleur ». Ajouter un repère de forme : un trait de
   3 px sur le bord gauche du rail, à hauteur du bouton actif.

### 6.6 Le tableau des manques, trié

| Priorité | Manque | Pourquoi c'est là |
|---|---|---|
| 1 | La légende des `.pips` et leur identité avec les interrupteurs (§2.0) | Sans ça, deux écrans divergeront dès la première version. |
| 2 | L'état « aucun client détecté » | C'est l'état d'OMNI à chaque démarrage de la machine. |
| 3 | L'état « au repos » du bouton `.armer` | L'état global principal n'a pas de face éteinte. |
| 4 | Le correctif `--acide-sur-contre` en sombre (§1.2) | Huit règles produisent de l'invisible. |
| 5 | Focus, survol, pressé, désactivé, occupé | Cinq états × toutes les briques. |
| 6 | Le format des nombres et `tabular-nums` | Quatre formats d'argent coexistent. |
| 7 | Débordements et `title` sur le tronqué | Les noms réels sont plus longs que ceux de la maquette. |
| 8 | La surface de message global | Aucune erreur n'a d'endroit où aller. |
| 9 | Les polices embarquées | Hors ligne, toute la mise en page bouge. |
| 10 | Barres de défilement, thème par défaut, zone de déplacement, `⋯`, `.moi` | Petits, mais chacun sera inventé si on ne le dit pas. |

---

## 7. L'écart avec l'existant

### 7.1 Ce que la refonte règle vraiment

Ce ne sont pas que des habits. Quatre défauts réels de `desktop/index.html` sont
corrigés :

1. **Tout tenait dans un seul écran, et le reste dans des panneaux qui recouvrent.**
   La production a une liste unique de **douze colonnes** (`desktop/index.html:669`)
   et trois vues — Archimonstres, Lots écartés, Réglage HDV — qui s'affichent en
   `position:absolute; inset:38px 0 0 0` (l. 131-134, 322-327), donc **par-dessus
   la flotte**. Consulter ses archimonstres masque l'état de ses huit personnages.
   Pour un outil de surveillance, c'est un défaut sérieux, et le rail de la refonte
   le règle : chaque chose a son écran, et on sait toujours où on est.
2. **Les capitales partout.** 15 `text-transform:uppercase` en production, **0**
   dans la refonte. En production, les en-têtes de colonne (10,5 px, `letter-spacing
   .12em`), les verdicts, le bouton de commande, l'état d'OMNI, les titres de
   section sont tous en capitales espacées. Les capitales suppriment la silhouette
   du mot, qui est précisément ce qu'on lit en vision périphérique. La refonte
   revient au bas-de-casse. **C'est un vrai gain sur l'usage visé.**
3. **Aucune vue d'ensemble.** En production, pour savoir combien de personnages sont
   en jeu, il faut lire huit lignes. La grille 4 × 2 de la refonte répond d'un coup
   d'œil. Le passage de la ligne à la carte est le bon geste pour cet usage.
4. **Un seul thème.** La production est verrouillée en sombre (`color-scheme:dark`,
   l. 55). Pour quelqu'un qui garde cet écran ouvert des heures, à toute heure,
   avoir les deux est un progrès réel — à condition que la règle de couleur survive
   au basculement, ce qui n'est pas le cas aujourd'hui (§1.1).

Et une cinquième chose, que la refonte apporte et que la production n'a pas :
**`.exemple`** (l. 531-535), la règle de prix montrée appliquée à un objet réel
(« La pierre médicinale par 100 est à 17 800 k sur le marché. Tu la poseras à
17 444 k, soit 356 k de moins »). C'est la meilleure idée de toute la maquette, et
le commentaire qui l'accompagne (l. 227-230) dit exactement pourquoi : *« Une règle
qu'on ne voit pas s'appliquer sur un vrai objet ne se règle pas de tête. »* À
généraliser : le plafond de dépense des courses et le prix plancher mériteraient le
même traitement.

### 7.2 Ce que la refonte a perdu en route

C'est la question que le brief pose, et la réponse est : **beaucoup, et pas des
détails**.

#### (a) Le meneur était signalé par une forme — la refonte l'a remplacé par un aplat

Production, `desktop/index.html:706-712` :

```
.rang.commande { background: linear-gradient(90deg, rgba(255,159,28,.09), transparent 55%); }
.rang.commande::before { … left:0; width:3px; background: var(--commande); }
```

Le commentaire dit : *« Le rang qui commande porte un lisere d'or : on marque sans
repeindre. »* Plus un cerclage sur la plaque de classe (l. 727). **La refonte a
remplacé « on marque sans repeindre » par un repeint intégral de la carte en jaune**
— exactement ce qui produit les 1,13:1 en clair et les 1,08:1 en sombre du §1.1. Ma
proposition du §1.7 (liseré jaune de 4 px) n'est donc pas une invention : c'est le
retour d'une solution qui était déjà là et qui marchait.

#### (b) L'encodage redondant, décidé exprès, documenté, et abandonné

Production, `desktop/index.html:1068-1076` :

> *« Trois familles d'anomalie, trois formes. La couleur ne fait que renforcer :
> huit à dix pour cent des hommes sont daltoniens, et l'ancien panneau encodait
> "armé" en vert et "alerte" en rouge-brun, sans second signal. »*

Et l. 47-51 : *« Rien ici ne repose de toute façon sur la seule couleur : la case est
un losange PLEIN quand elle est armée et CREUX sinon, le commandement porte en plus
un liseré, un cerclage et un dégradé, et chaque anomalie est écrite en toutes
lettres. »*

Dans la refonte, l'état du meneur, l'état « à rattraper », les capsules de filtre
actives, les archimonstres manquants et les droits accordés sont **encodés par la
couleur seule**. C'est aussi le point qui contredit la règle n° 3 déjà validée dans
`identite.html` (l. 414). Trois documents du dépôt disent la même chose et la
maquette fait l'inverse.

#### (c) Les en-têtes de colonnes qui arment tout le monde d'un coup

Production, `desktop/index.html:681-703` : chaque titre de colonne est un
**`<button class="tete-colonne">`** qui coche ou décoche la fonction pour tous les
comptes, et il porte un indicateur **trois états** (`.jauge` : plein si tous, moitié
si certains, creux si aucun).

Refonte, l. 649-651 : les mêmes titres sont des `<span>`. La fonction est décrite en
prose dans le paragraphe au-dessus (« clique sur un titre de colonne pour l'armer
partout d'un coup », l. 646) mais **rien dans le dessin ne le montre**, et
l'indicateur trois-états a disparu. On perd à la fois l'affordance et l'information
« combien de comptes ont cette fonction ».

#### (d) La raison écrite de chaque anomalie

Production : `.verdict` (l. 776-786) + `.motif` (l. 791-794), une ligne de texte en
couleur d'alerte sous le rang, qui **dit pourquoi**. Plus `.motif.cliquable`
(l. 650-651) : quand il y a quelque chose à ouvrir, le texte devient cliquable **et
le montre** (pointillé souligné), avec ce commentaire : *« un texte qui reagit au
clic sans le montrer ne sera jamais clique »*.

La refonte a bien gardé les phrases d'état (`.dit`, l. 190) — c'est la partie sauvée.
Ce qu'elle a perdu, c'est le lien : sur Ma flotte, on lit « resté à l'écran de
sélection » et le bouton dit « Réveiller ». On ne sait pas ce que « Réveiller » fait,
ni où ça mène.

#### (e) L'état vide, écrit et déjà validé

`desktop/index.html:849-852`, le texte exact, avec en plus un commentaire qui
raconte le bug qu'il a corrigé (l. 655-663). La refonte n'a rien (§6.2).

#### (f) La commande par personnage en hôtel de vente

Production : un bouton **HDV** par ligne, ouvrant un menu à deux entrées — mise à
jour des prix / mise en vente — avec un état « en cours » (`.hdv.tourne`, l. 307 ;
construction l. 2347-2361). Plus une colonne **Archi** par ligne, et un bouton
**Ôter** (l. 277).

Refonte : l'écran Hôtel de vente est **uniquement global**. On ne peut ni lancer ni
arrêter une passe sur un personnage donné — alors que Ma flotte affiche
« Sombrelle · Relève les prix · 412 objets sur 664 » (l. 391). **L'état est montré,
la commande a disparu.**

#### (g) L'écran « Lots écartés »

Production : une vue entière (`#vueEcartes`, l. 959-967) listant ce que les
garde-fous de prix ont refusé de poser, avec pour chaque lot son prix, la borne
franchie et **le motif en clair** (`.eca-motif`, `.eca-borne`, l. 641-646). Le
commentaire d'ouverture du panneau de réglages (l. 984-987) explique pourquoi ça
compte : *« Six lots partis à 7 000 002 le 05/09 pour une marchandise à 1520 »*.

Rien dans la refonte. **C'est la trace d'un incident réel qui a coûté des kamas, et
la surface qui permet de le voir a disparu.**

#### (h) Les garde-fous de prix eux-mêmes

Production, `#vueRythme` (l. 977-1046), deux sections dans un ordre choisi et
justifié (*« les garde-fous passent avant le rythme, et l'ordre est un choix : le
rythme decide de la discretion, les garde-fous decident de KAMAS »*) :
- **Écart maximum** (curseur ×1,5 à ×20 par rapport au prix moyen) ;
- **Prix plafond** en kamas absolus, avec trois raccourcis (Aucun / 1 M / 3 M) ;
- **Rythme des passes** : trois profils (Prudent / Normal / Rapide) qui *multiplient*
  les délais mesurés, plus un réglage fin dépliable, plus l'expiration de réponse.

La refonte a un « Prix plancher −15 % » (l. 538-543) et un « Quand relire les prix »
(l. 570-577). Le plafond absolu, l'écart maximum, les profils de rythme et
l'expiration ont disparu — et le mot « plafond » est réemployé pour tout autre
chose (le plafond de **dépense** des courses, l. 427). **Deux notions différentes
portent le même mot dans la même application.**

#### (i) Le reste de la barre du bas

`desktop/index.html:1048-1058` : le champ **Délai** du passe-tour, le bouton
**Équiper PdA** (la pierre d'âme, avec son témoin d'état), le bouton **Overlay**, et
**Fermer les clients** — une action destructive avec son propre style (`.coupe`).
Aucun des quatre n'a d'équivalent dans la refonte. Le commentaire l. 1050-1053 dit
même que l'emplacement de l'un d'eux a été *« choisi par Jibef le 03/09 sur le labo,
apres avoir compare quatre positions »*. **Cette décision a été prise, testée, et
elle est en train d'être perdue.**

#### (j) L'aide à la mise à jour

Production : le numéro de version dans la barre de titre passe en couleur d'état
quand une mise à jour existe (`.version-lien.retard`, l. 124-125), et le panneau
« Quoi de neuf » porte en tête le seul bloc actionnable (`.qdn-maj.retard`, l. 149,
avec le commentaire : *« c'est la seule chose du panneau sur laquelle on peut AGIR,
elle passe devant ce qui ne fait que se lire »*). La refonte affiche le journal, pas
la mise à jour (§3, Réglages).

#### (k) Les garde-fous d'interface

- `:focus-visible` : 1 en production, **0** dans la refonte.
- `font-variant-numeric: tabular-nums` : 14 en production, **0**.
- Polices embarquées hors ligne : oui en production, **non** (Google Fonts).
- `[hidden]{display:none!important}` avec le commentaire du bug qu'il corrige
  (l. 68-71) : la refonte n'utilise pas `hidden`, elle utilise `.actif`, donc le
  piège reviendra sous une autre forme.
- `-webkit-app-region` (drag / no-drag) : 5 occurrences en production avec un
  avertissement en majuscules (l. 108-111), **0** dans la refonte.

### 7.3 Le jugement

**La refonte n'est pas un simple rhabillage : elle corrige des défauts réels
d'architecture** (le rail contre les panneaux qui recouvrent, la grille contre la
liste, la fin des capitales). C'est un vrai progrès, et il faut le garder.

**Mais elle est partie d'une page blanche au lieu de partir de l'existant**, et elle
a donc reperdu, sans les discuter, une quinzaine de décisions qui avaient été
prises, écrites et parfois payées par un bug ou par des kamas. Le plus dur à
retrouver, ce ne sont pas les écrans manquants (§7.2 f, g, h, i) : c'est la
**discipline** que la production s'était donnée — un signal ne repose jamais sur la
seule couleur, chaque contraste est mesuré et noté dans le fichier, chaque décision
d'emplacement porte sa raison en commentaire.

`app.html` commente ses **intentions** (et bien, l. 9-22, 125-126, 212-214, 227-230,
498-504) ; `desktop/index.html` commente ses **contraintes et ses accidents**. La
planche d'identité doit reprendre les secondes, sinon Alexis les redécouvrira une
par une.

---

## 8. Le plan

Classé par **gain net décroissant** (gain de l'usage réel, moins le coût en travail
de maquette). Le coût est exprimé en travail sur `app.html` et sur la nouvelle
planche d'identité, pas en travail d'Alexis.

### AVANT DE LIVRER À ALEXIS

Ces onze points ne peuvent pas être tranchés par le développeur. S'ils partent
non décidés, ils reviendront comme des questions, ou pire, comme des inventions.

| # | Ce qu'on fait | Gain | Coût |
|---|---|---|---|
| **1** | **Écrire la légende des `.pips` et acter qu'ils sont les cinq interrupteurs** (§2.0). Une ligne de cinq mots au-dessus de la grille de Ma flotte, et une phrase dans la planche. | Énorme. C'est le seul manque qui garantit une divergence entre deux écrans dès la v1. | Une heure. |
| **2** | **Sortir le meneur de l'aplat jaune** : liseré de 4 px, jeton jaune, mention « Il mène » (§1.7 décision B). | Énorme. Répare d'un coup les 1,13:1 du thème clair et les 1,08:1 du thème sombre, et rend la surface inversée à sa seule fonction. | Une demi-journée : la carte, plus la reprise des 6 règles `.perso.mene` (l. 129-132, 177, 180, 186, 189, 198, 202). |
| **3** | **Séparer `--encre` de `--alarme`** et faire passer les neuf familles d'éléments structurels sur des jetons neutres (§1.7 décision C, §1.4). | Énorme. C'est ce qui fait qu'« un bloc inversé = une chose à faire » devient vrai et comptable. | Une journée : c'est du travail de jeton, mais il touche Archimonstres (l. 259), Réglages (l. 273), les segments (l. 116), les pips (l. 196), les capsules (l. 165), les filtres (l. 141), les interrupteurs (l. 266). |
| **4** | **Corriger `--acide-sur-contre` en thème sombre** : `#16181A` au lieu de `#C9DC5C` (§1.2). | Fort pour un coût dérisoire. Huit règles cessent de produire de l'invisible, dont le curseur des interrupteurs. | Une ligne. |
| **5** | **Fusionner Ma flotte et Raccourcis** (§2.2), et renvoyer l'assignation des touches dans Réglages. | Fort. Supprime le seul aller-retour imposé pendant le jeu, libère un bouton du rail et 456 px de hauteur. | Deux jours : c'est la seule vraie refonte d'écran du lot. |
| **6** | **Décider la règle d'emploi du `.marqueur`**, et la faire respecter aux six titres (§1.3). Aujourd'hui il surligne « deux à rattraper », « en pause » et « 108 à trouver ». | Fort. Trois titres sur six disent le contraire de la règle. | Deux heures. |
| **7** | **Décider ce que devient l'écran « Hôtel de vente »** : renommé « Prix », ou augmenté d'une bande de commande par personnage (§2.2). Et trancher le sort des garde-fous et du rythme (§7.2 h). | Fort. C'est le seul écran dont le nom ne correspond pas au contenu, et la seule fonction longue d'OMNI qui n'est ni visible ni arrêtable. | Une journée si on ajoute la bande. |
| **8** | **Dessiner l'état « aucun client Dofus détecté »** (§6.2) et l'état « au repos » du bouton `.armer` (§6.3). | Fort. C'est ce qu'on voit à chaque démarrage de la machine, et ce n'est dessiné nulle part. | Une demi-journée. |
| **9** | **Fixer le format des nombres** — un seul format d'argent, chiffres tabulaires partout (§4.3g, §4.3h). | Fort. Quatre formats coexistent, et les colonnes danseront à chaque rafraîchissement. | Deux heures. |
| **10** | **Trancher le sort de `.gain` / `.perte` / `.pied-panneau`** (§5.2 G) : est-ce qu'un écran « ce qui s'est vendu » revient, ou est-ce que ces règles partent ? | Fort. Pour un outil qui met en vente et remet à prix, « qu'est-ce qui est parti, et pour combien » est probablement la question la plus fréquente — et elle n'a aucune réponse. | La décision : dix minutes. L'écran, s'il revient : deux jours. |
| **11** | **Refaire `identite.html`** avec le contenu du §5.2, et **retirer du labo** `couleurs.html` et `oeil.html` (passe rejetée), tout en reclassant `clair.html` comme l'ancêtre de la maquette et non comme un orphelin (§5.1). | Fort. C'est le premier document qu'Alexis lira, et il décrit aujourd'hui un autre produit. | Deux jours, mais tout le contenu est déjà écrit dans ce rapport. |

### JUSTE APRÈS, DANS LA MÊME LIVRAISON SI POSSIBLE

| # | Ce qu'on fait | Gain | Coût |
|---|---|---|---|
| 12 | **Les cinq états d'interaction** — focus, survol, pressé, désactivé, occupé — dessinés sur chacune des douze briques (§5.2 F, §6.1). | Fort mais diffus. Sans ça, Alexis inventera douze fois. | Deux jours de planche. C'est la plus grosse ligne du lot, et c'est aussi celle qui économise le plus de va-et-vient ensuite. |
| 13 | **Régler `--encre-douce` (5,73:1) et `.bt-vide`** (§4.3a, §4.3b). Sept boutons « Désigner » cessent d'être invisibles. | Fort pour un coût nul. | Trois lignes. |
| 14 | **Nettoyer les redites de Ma flotte, Courses et Hôtel** : supprimer les trois tuiles de Ma flotte, remonter le bloc « Reprendre la course », descendre les deux chiffres de l'Hôtel dans le sous-titre (§3). | Fort. Rend ~200 px à la grille, fait tenir les réglages de prix sans défilement. | Une journée. |
| 15 | **Inverser l'encodage des archimonstres** (possédé plein / manquant creux) et remplacer le mot « manquant » par la zone (§3). | Fort sur l'écran le moins hiérarchisé des six. | Une demi-journée. |
| 16 | **Ramener l'échelle typographique à six pas** (§4.2). | Moyen-fort, mais c'est un prérequis de la planche : sans échelle, aucune brique n'est spécifiable. | Une journée. |
| 17 | **Débordements** : `ellipsis` sur `.doux` et `.compte`, `title` sur tout texte tronqué, budget du nom de personnage revu (§6.4). | Moyen-fort. Les noms réels sont plus longs que ceux de la maquette. | Une demi-journée. |
| 18 | **Le bandeau de message global** (§2.3, §6.3). | Moyen-fort. Aucune erreur n'a d'endroit où aller. | Une demi-journée. |
| 19 | **Les polices embarquées** : choisir les graisses, vérifier les licences, remplacer l'appel Google (§5.2 C). | Moyen-fort. Hors ligne, toute la mise en page bouge. | Deux heures + la vérification de licence. |

### LA PASSE SUIVANTE

| # | Ce qu'on fait | Gain | Coût |
|---|---|---|---|
| 20 | Trame d'espacement 4·8·12·16·20·24 et cinq rayons (§5.2 D, E). | Moyen. Invisible à l'œil nu, mais c'est ce qui empêche la maquette de se déliter à la dixième modification. | Une journée. |
| 21 | Les états vides restants : liste de courses vide, archimonstres avant lecture, clé sans droits, journal vide (§6.2). | Moyen. Rares, mais chacun est une page blanche s'il n'est pas dessiné. | Une journée. |
| 22 | L'assignation de touche : assignée / non assignée / en cours de capture, boutons de souris compris (§6.5.1). | Moyen. Une fois installé, on n'y revient plus — mais le jour où on y revient, rien n'est prévu. | Une demi-journée. |
| 23 | Barres de défilement, thème par défaut suivant Windows et déplacé dans Réglages, zone de déplacement de la fenêtre, sort du `⋯` et de `.rail .moi` (§6.5). | Moyen, et très bon marché. | Une demi-journée pour l'ensemble. |
| 24 | Centrer les interrupteurs, resserrer leurs colonnes, remettre l'indicateur trois-états dans les en-têtes (§4.3f, §7.2 c). | Moyen. Absorbé par le point 5 si la fusion se fait. | Deux heures. |
| 25 | Reprendre l'idée de l'`.exemple` pour le plafond de dépense et le prix plancher (§7.1). | Moyen. La meilleure idée de la maquette, appliquée une seule fois sur trois occasions. | Une demi-journée. |
| 26 | Spécifier l'overlay et l'icône-cadran (§2.3, §6.5.8). | Potentiellement le plus fort de tous **en usage réel** — c'est la seule chose qu'OMNI montre pendant qu'on joue — mais c'est un chantier neuf et il ne doit pas retarder la livraison des six écrans. | Une semaine. |
| 27 | Repère de forme sur le bouton actif du rail (§6.5.9). | Faible mais cohérent avec la règle « la forme avant la couleur ». | Une heure. |

### L'ordre que je suivrais

**1 → 4 → 3 → 2** d'abord : ce sont les quatre décisions de couleur, et elles se
tiennent l'une l'autre. Rien ne sert de redessiner un écran avant de savoir ce que
veulent dire le jaune et l'inversé.
Puis **6, 9, 13** — trois corrections rapides qui découlent directement des
précédentes.
Puis **5** (la fusion) et **14, 15** (les redites), qui redessinent les écrans une
seule fois, avec les bons jetons.
Puis **11 et 12** : la planche, écrite en dernier, quand tout est décidé — c'est
ce qui part chez Alexis.
Le reste ensuite.

---

## Ce que je n'ai pas pu vérifier

Par honnêteté, la liste de ce sur quoi je peux me tromper :

1. **Je n'ai vu aucune page rendue.** Tout est déduit du CSS. Les rapports de
   contraste, les valeurs, les tailles et les emplois de classes sont exacts —
   ce sont des chiffres lus dans le fichier. En revanche, **l'effet perçu** d'une
   couleur ou d'une hiérarchie mériterait une confirmation à l'œil. La direction
   de mes conclusions du §1 est certaine (1,01:1 et 1,08:1 ne se discutent pas) ;
   leur ressenti exact, non.
2. **Les hauteurs et largeurs du §4 sont des additions de valeurs CSS**, sans
   mesure de texte réelle. Les ~53 px de vide par carte, les ~91 px de panneau vide
   sur Raccourcis, le débordement de ~70 px des réglages de prix : l'ordre de
   grandeur est bon, le pixel exact non. Le nombre de lignes que prennent les
   paragraphes (`.titre p`, `.dit-r`, `.txt`) est la principale source d'erreur.
3. **Le nombre de caractères qui tiennent dans un espace** (nom de personnage,
   nom d'archimonstre) est estimé à partir d'une largeur moyenne de glyphe, pas
   mesuré dans Outfit et Plus Jakarta Sans. La conclusion « les noms longs seront
   coupés » tient ; le seuil exact (13 caractères ?) est à vérifier.
4. **Je n'ai pas vu de vrais noms de personnages ni de vraies données.** Le pied de
   page de `labo-omni/index.html` dit que les noms sont inventés. Les longueurs
   réelles peuvent changer les conclusions du §6.4 dans un sens comme dans l'autre.
5. **Je n'ai pas audité le code de l'application**, conformément au brief. Ce que je
   dis de `desktop/index.html` porte uniquement sur ce que l'écran montre et sur les
   commentaires de conception qu'il contient. Il est possible que certaines
   fonctions que je dis « perdues » (l'overlay, les garde-fous, les lots écartés)
   soient prévues ailleurs dans le plan de la refonte, dans un document que je n'ai
   pas eu.
6. **Un doute de calendrier, à lever avec vous.** Le titre du dernier commit du
   dépôt annonce le retrait de l'interrupteur unique, alors que ce contrôle est
   encore présent et câblé dans `desktop/index.html` (l. 809, 2087-2089, 2580-2582)
   et qu'il a son équivalent dans la maquette (`.armer`, l. 332). **Si ce contrôle
   disparaît, la barre du haut de la refonte n'a plus grand-chose à porter** — et il
   faut le savoir avant de dessiner l'état « au repos » demandé au point 8.
7. **Les deux captures de `labo-omni/refs/` sont des maquettes commerciales sans
   texte explicatif.** Le rapprochement que je fais au §0 entre `ref3` et `app.html`
   repose sur la coïncidence, brique par brique, de sept éléments — c'est massif,
   mais c'est une déduction. Si `ref3` n'était en fait qu'une inspiration parmi
   d'autres, les conclusions du §0 sur *l'intention* tomberaient. **Les défauts
   qu'elles expliquent, eux, restent mesurés dans le fichier et ne dépendent pas de
   cette lecture.**
