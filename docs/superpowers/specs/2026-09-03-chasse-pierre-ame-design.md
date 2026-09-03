# La pierre d'âme équipée toute seule, conception

2026-09-03. Premier morceau de l'outil de chasse à l'archimonstre dans OMNI.

## Le besoin

Pendant une chasse, chaque personnage doit porter une pierre d'âme dont le
niveau couvre celui de l'archimonstre. Aujourd'hui c'est quatre fois le même
geste à la main, sur quatre clients, avant chaque combat, et une pierre oubliée
coûte la capture.

OMNI équipe la bonne pierre sur tous les personnages connectés, chacun depuis
son propre inventaire.

## Ce qui est déjà acquis, sans aucune mesure

**La table des pierres**, tirée des données hors ligne (`objets.json`,
21 736 objets). Les pierres d'âme vides portent le `typeId` 83, mais leur champ
niveau N'EST PAS le plafond de capture :

| gid | nom | niveau de l objet | plafond REEL |
|---|---|---|---|
| 9686 | Petite pierre d ame | 20 | 50 |
| 9687 | Moyenne pierre d ame | 50 | 100 |
| 9688 | Grande pierre d ame | 100 | 150 |
| 9689 | Enorme pierre d ame | 150 | 190 |
| 9690 | Gigantesque pierre d ame | 190 | 1000 |

**LE PLAFOND N EST PAS LE NIVEAU DE L OBJET**, il est decale d un cran au-dessus,
et il se lit dans l effet 705 de l objet, troisieme parametre. Confondre les deux
faisait equiper une Enorme sur un monstre de 124. Erreur du 03/09, rapportee deux
fois en jeu par Jibef avant d etre comprise.

La Gigantesque couvrant 1000, la Gargantuesque (9718) ne sert jamais.

**La lecture de l'inventaire.** `lirePile` dans `src/hdv/trames.js` décode déjà
les piles de `ivx` et `iwb` et rend `{ uid, gid, qte, avecEffets }`. Retrouver
la pierre revient à chercher un gid dans cette liste.

Une pile porte aussi un **champ 1 = position**, que `lirePile` jette
aujourd'hui. C'est l'emplacement d'équipement : le garder suffit à savoir si
une pierre est déjà portée, sans rien mesurer de plus.

**La détection de l'entrée en combat.** `src/abandon-combat.js` lit `kmk` et
reconnaît un combat contre des monstres à la présence d'au moins un identifiant
négatif au champ 3 de la liste des combattants. Le déclencheur existe déjà.

**Le changement d'équipement est possible en phase de préparation**, vérifié en
jeu par Jibef le 2026-09-03. C'est le fait qui décide de toute la conception :
inutile de lire les groupes de monstres sur la carte avant l'attaque, inutile
de savoir reconnaître un archimonstre. Le combat est déjà celui de l'archi,
puisque c'est toi qui l'as lancé.

## La conception

**Le déclencheur tient en DEUX trames, et cette séparation a été apprise en
jeu le 2026-09-03.**

`kmu` dit **quoi** équiper : un groupe quitte la carte, on en connaît le
niveau. Mais elle n'est reçue que par les clients présents sur la carte à cet
instant. Mesuré : sur trois clients, un seul l'a eue, les deux autres étaient
encore en chemin.

`kmk`, la liste des combattants, dit **quand**, pour chaque personnage
séparément : elle n'arrive qu'une fois le client réellement dans le combat.
**Une mule encore en déplacement ne peut rien équiper, le jeu refuse.** On
l'attend donc au lieu de tirer trop tôt.

Chaque client est servi pour lui-même, depuis son propre inventaire. On se
greffe là où `abandon-combat.js` reconnaît déjà le
combat.

**La décision est une fonction pure.** Niveau max des monstres du combat en
entrée, gid de la pierre en sortie : la plus petite dont le niveau couvre le
maximum observé. Au-delà de 1000, elle ne rend rien et OMNI ne touche à rien,
ce qui ne peut pas arriver en jeu.
Elle se teste en dix cas sans lancer le jeu, comme `lots.js` du shopping.

**L'action.** Retrouver la pile du bon gid dans l'inventaire, envoyer la trame
d'équipement, attendre la confirmation avant de considérer le personnage prêt.
Si la bonne pierre est déjà en position d'équipement, ne rien envoyer. Un ordre
à la fois, comme partout ailleurs dans OMNI.

**Un interrupteur, éteint par défaut.** C'est le garde-fou principal. Une
pierre d'âme capture aussi les monstres ordinaires : sans interrupteur, OMNI
équiperait une pierre à chaque combat et remplirait des Énormes pierres avec
des Bouftous. Tu l'allumes en partant chasser, tu l'éteins en rentrant.

Il devient la **dixième fonction verrouillable** dans `src/droits/`, à côté de
la vente d'Alexis.

**Jamais de remplacement par la tranche du dessus.** Une pierre plus grande
capture bien un monstre plus faible, la règle du jeu est « inférieur ou égal ».
Mais elle vaut plus cher que ce que la capture rapporte : mettre une Énorme sur
un archi de niveau 90 n’est pas rentable. Décision de Jibef le 2026-09-03. À
défaut de la bonne tranche, OMNI n’équipe rien et le signale.

**Le personnage sans pierre est signalé, pas bloquant.** Une ligne dans le
panneau nomme le personnage et la pierre qui manque. Les autres personnages
sont équipés quand même. La phase de préparation laisse le temps de voir le
message et de quitter le combat.

**Une alerte sonore accompagne ce signalement.** Pendant la préparation, on
regarde le jeu, pas le panneau d'OMNI. Un bip synthétisé dans la fenêtre, sans
fichier audio : rien à embarquer, et surtout rien à ajouter dans
`FICHIERS_DESKTOP` de `outils/faire-etape.js`, oubli silencieux qui a failli
coûter l'overlay. Deux notes basses répétées, distinctes des sons de Dofus. Le
son part une seule fois par combat, même si plusieurs personnages sont en
défaut.

## Les modules

    src/chasse/pierres.js    fonction pure : niveau max -> gid de pierre
    src/chasse/trames.js     construire la trame d'équipement, lire ce qui revient
    src/chasse/chasse.js     branché sur le flux : déclencheur, ordres, état

Même découpage que `src/hdv/` : ce qui décide est pur et testable sans le jeu,
ce qui agit est branché sur le flux.

Retouches ailleurs :

- `src/hdv/trames.js` : `lirePile` garde le champ 1 (position)
- `src/droits/` : la dixième fonction
- `desktop/` : l'interrupteur, la ligne d'alerte, le bip

## Ce que la séance du 2026-09-03 a donné

Journal `journal-chasse1.log`, un client, `OMNI_CAPTURE_OCTETS=1`. **Les deux
inconnues sont levées, et la troisième question a sa réponse.**

### La trame d'équipement

    --> request iuk { 1=<quantité> 2=<uid de la pile> 3=<position> }

**La position 31 est l'emplacement de la pierre d'âme. La position 63 est
l'inventaire**, c'est-à-dire « pas équipé ». Les trois gestes mesurés :

    71004ms --> iuk { 1=89 2=233526404 3=31 }   équiper la Petite pierre
            <-- ivq { 1=233525940 2=63 }        la Moyenne repart en inventaire
            <-- ivq { 1=233526404 2=31 }        la Petite prend la place

    77161ms --> iuk { 1=1  2=233526404 3=63 }   en ressortir une seule
            <-- iua { 3={1=63 5={1=9686 3=1 4=233545693}} }   pile neuve
            <-- ivj { 3={2=233526404 3=88} }                 l'ancienne décroît

    79492ms --> iuk { 1=88 2=233526404 3=63 }   sortir le reste
            <-- ivj { 3={2=233545693 3=89} }    les deux piles fusionnent
            <-- ium { 1=233526404 }             l'ancienne disparaît

Trois choses à retenir.

**Le serveur déséquipe tout seul.** Poser une pierre en 31 renvoie celle qui
s'y trouvait en 63, sans qu'on ait rien à demander. Un seul ordre suffit.

**La confirmation dépend de ce qu'on déplace.** Une pile entière DÉPLACÉE donne
`ivq { 1=uid, 2=nouvelle position }`. Une seule pierre prise dans une pile ne
donne AUCUN `ivq` : le serveur crée une pile neuve déjà à l'emplacement, et
c'est `iua` qui fait foi. Les deux comptent, mesuré le 03/09 à 14h40.

**L'uid d'une pierre change.** Sortir une partie d'une pile crée une pile
neuve, la fusion en détruit une. L'uid doit donc être relu dans l'inventaire au
moment d'agir, jamais mémorisé d'un combat sur l'autre.

Le client déplace **la pile entière** quand il équipe, pas une unité.
**OMNI ne l’imite pas** : il n’en envoie qu’une. Décision de Jibef le
2026-09-03, après le premier essai en jeu. Il n’y a aucune raison de poser
89 pierres sur le personnage pour en remplir une, et une seule suffit pour le
combat suivant sans avoir à déséquiper.

**Ce choix se paie sur la confirmation.** Sortir une unité d’une pile en crée
une neuve, avec un uid neuf : l’uid qui revient dans `ivq` n’est donc pas celui
qu’on a envoyé. La confirmation se reconnaît à la POSITION, pas à l’uid.

### Les niveaux des monstres

`jss` est la liste des acteurs de la carte. Chaque groupe de monstres y porte,
sous `2.1.4.2`, une entrée par monstre :

    { 1 = identifiant du monstre, 2 = NIVEAU, 4 = grade }

**Le niveau est donné directement dans la trame.** Aucune donnée de référence
n'est nécessaire, ni DofusDB, ni fichier de monstres.

Vérifié sur les deux groupes de la carte de mesure, croisé avec DofusDB, exact
au niveau près :

| groupe | monstres lus | ce que dit DofusDB |
|---|---|---|
| -20000 | 65 niveau 46 grade 1, deux fois | Black Wabbit, grade 1 = 46 |
| -20001 | 68 niveau 44 grade 2, 72 niveau 40 grade 1, 96 niveau 43 | Black Tiwabbit 44, Tiwabbit Kiafin 40, Tiwabbit 43 |

Le groupe attaqué se nomme des deux côtés : `hqa { 1=-20000 }` en sortie au
moment de l'attaque, `kmu { 2=-20000 }` en entrée au démarrage du combat. C'est
la clé qui relie le combat à la bonne entrée de `jss`.

### L'inventaire arrive tout seul

`ivx` tombe **à la connexion**, sans que le joueur ouvre quoi que ce soit :
471 piles dans la mesure, avec leur position. Le commentaire de `vente.js` qui
dit le contraire est trop restrictif, il décrira ce que la vente observe.

L'inventaire de mesure portait, en pierres vides : 89 Petites, 47 Moyennes,
40 Grandes, 11 Énormes, aucune Gigantesque. La Moyenne était déjà en
position 31 à la connexion, donc **une pierre est en général déjà équipée** et
le cas nominal est un remplacement, pas une pose.

### La fenêtre de temps

Combat lancé à 63,5 s, fin de la phase de préparation à 82,0 s : **plus de
18 secondes**, et l'ordre d'équipement a été confirmé en 40 ms. Le risque de
manquer la fenêtre, même sur quatre clients, n'existe pas.

## Hors sujet, volontairement

- **Reconnaître un archimonstre.** Plus nécessaire depuis que le déclencheur
  est le combat. À noter pour plus tard : aucun drapeau de DofusDB ne les
  distingue, `isMiniBoss` désigne les mini-boss de donjon. Il faudrait une
  liste montée à la main, ou un signe dans la trame.
- **La Gargantuesque pierre d'âme.**
- **La capture elle-même**, les âmes pleines, l'échange des âmes : ce sont les
  morceaux suivants de l'outil de chasse.
- **Tout déplacement.** Jibef fait les trajets, même règle que le shopping.

## Risques

**Un groupe qui apparaît après `jss`.** La liste des acteurs arrive à
l'arrivée sur la carte. Un groupe qui se déplace ou qui naît ensuite passe par
une autre trame, non identifiée. Si le groupe attaqué est inconnu, OMNI ne
touche à rien et le dit, plutôt que d'équiper au hasard.

**Aucune Gigantesque en stock.** Sans elle, un archi entre 151 et 190 ne peut
pas être capturé. Le signalement et l'alerte sonore couvrent exactement ce cas.
