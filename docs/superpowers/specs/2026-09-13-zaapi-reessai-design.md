# Le reessai d'ouverture: la mule insiste au zaapi

2026-09-13

## Ce que l'utilisateur veut

« Lorsque le maitre clic sur le zaapi, la mule clic dessus aussi pour pouvoir
ouvrir le panneau des destinations. »

Le but final est le voyage de groupe: le panneau ouvert chez la mule, le choix
de destination du maitre (`hiu`, `verbatim`, deja rejoue) l'emmene avec lui.

## Ce qui marche deja, et ce qui manque

Le clic est **deja** recopie: `imp { 2=3 }` est repertorie dans
`src/protocol/omni.js`, `verbatim`, et il part chez chaque mule par la file de
dialogue. Mesure du 13/09, `journal-bug-0909.log`, mule `9276`, zaapi `-20004`:

    122324 [9276] --> imp { 1=217318404 2=3 3=-20004 }   accepte
    122363 [9276] <-- inn { 1=-20004 3=217318404 }
    122364 [9276] <-- imw { 1=47058 3={2=62416} }        le panneau s'ouvre

Le seul cas qui echoue est la **portee**. Quatre refus d'affilee dans la meme
session, sur le meme PNJ:

    115267 [9276] --> imp { 1=217318404 2=3 3=-20004 }
    115333 [9276] <-- imq { }                            refus
    116400, 117184, 118100                               trois fois de plus

**La preuve que c'est la position, et rien d'autre:** la requete de 115267 ms
et celle de 122324 ms sont identiques **octet pour octet**
(`0a360a29…100318dce3feffffffffffff01…`). Entre les deux, la mule a marche —
deux deplacements, `jpt` a 119740 et 121356 ms. Meme trame, position
differente, reponse differente.

C'est la meme condition que celle qui a tue `jpp` et `jrh` le 28/08: « ce n'est
pas un champ a substituer, c'est une POSITION a occuper ».

## La decision, et celle qu'elle revise

Le 03/09, trois pistes avaient ete posees a l'utilisateur pour `iva` (le zaap,
la porte): attendre l'arrivee de la mule, lui fabriquer son deplacement, ou ne
rien faire. Il avait choisi **ne rien faire** — ses persos sont ensemble quand
il voyage.

Le 13/09, pour le zaapi, il choisit **reessayer**: OMNI renvoie le clic, et
c'est le suivi de groupe DU JEU qui amene la mule. La piste « fabriquer le
deplacement » reste ecartee: OMNI n'a ni les cases de la carte ni calcul de
chemin, et n'en veut pas. La piste « attendre l'arrivee » est ecartee aussi,
faute de mesure: on ne sait pas quelle trame dit « je suis arrivee ».

Reglage retenu: **six essais en tout, un toutes les 800 ms**, soit 5 s environ.

## Ce qu'on construit

Tout vit dans `src/file-dialogue.js`, dans la branche `TYPE_REFUS_OUVERTURE` de
`onTrame()` — aujourd'hui un `echec()` sec.

### L'etat ajoute

Deux champs dans l'etat de file d'une mule:

- `ouverture` — l'etape d'ouverture en cours, retenue par `emettre()` pour
  pouvoir la renvoyer telle quelle.
- `essais` — le RANG de l'essai en cours, 1 pour le premier envoi.

`emettre()` prend un troisieme argument, `estReessai`, faux par defaut. C'est
lui qui distingue les deux cas, et il le faut: un reessai repasse par
`emettre()`, qui remettrait sinon le compteur a 1 a chaque tour et tournerait
sans fin.

### Le cycle

1. `emettre()` envoie une ouverture neuve: `ouverture = etape`, `essais = 1`.
2. Un `imq` arrive. Si l'attente en cours porte sur une ouverture **et**
   `essais < 6`: on leve l'attente de 3 s, `essais += 1`, `enVol = true`, et on
   replanifie **la meme etape** dans 800 ms dans `minuteurEtape` — avec
   `estReessai` vrai, donc sans remettre le compteur.
3. Une question (`imw`) arrive: `ouverture = null`, `essais = 0`, la file avance
   comme aujourd'hui.
4. Au sixieme refus — `essais` vaut alors 6, la condition ne passe plus:
   `echec()`, avec le nombre d'essais dans la raison.

Six essais au total, donc **cinq reessais de 800 ms**: 4 s de reessais, plus le
delai humain du premier envoi, soit un peu moins de 5 s.

`enVol = true` pendant l'attente du reessai est ce qui empeche `avancer()` de
tirer l'etape suivante entre deux essais.

### Ce qui se reutilise sans y toucher

- **« Ouvrir ferme d'abord »** (`emettre()`, ligne 227): chaque reessai repasse
  par `emettre()`, donc si le refus venait d'un dialogue qui trainait — l'autre
  sens de `imq`, mesure le 09/09 — la place est faite avant le deuxieme essai.
  On couvre les deux causes du refus **sans les distinguer**, ce qui tombe
  bien: `imq {}` est vide, rien dedans ne dit laquelle.
- **Le garde-combat**: le reessai passe par `emettre()`, donc par le plancher de
  250 ms et par la relecture de `superviseur.arme` / `etat.exclu` A L'ECHEANCE.
  Une mule decochee pendant les 5 s cesse d'etre frappee.
- **`annulerEnVol()`**: le minuteur de reessai est range dans `minuteurEtape`,
  celui que le garde annule deja. Rien a ajouter cote garde.
- **`DELAI_ATTENTE_MS`** (3 s): un refus arrive en ~40 ms, donc toujours avant.
  Chaque reessai rearme l'attente par le chemin normal.

### Portee: tous les PNJ

Le reessai s'applique a toute ouverture refusee, pas au seul zaapi. `imq` est le
meme message pour le marchand, et distinguer l'action 3 obligerait a lire le
champ 2 pour n'en tirer aucun gain.

## Le journal: une ligne perdue a retrouver

Le 09/09 la spec de la file montrait encore `1059598 [8328] rejeu imp ecrit
(+358 ms)`. Dans la session du 13/09 il n'y a **aucune** ligne `rejeu` pour
`imp`, `inh` ou `kiy`: la file emet par son propre chemin et n'ecrit rien. Les
seuls `rejeu` du journal sont `iva`, `hiu` et `kaa`.

C'est ce trou qui a coute du temps ce soir — sans lui, on voyait tout de suite
que le clic partait. La file ecrira donc `rejeu <type> ecrit (+<n> ms)` comme
les autres, et le reessai ajoute son rang: `rejeu imp ecrit (essai 3/6)`.

Le compte rendu d'abandon porte le compte: `la mule n a pas pu ouvrir le
dialogue (6 essais, trop loin ?)`.

## Les tests

Tous avec l'horloge injectee de `test/file-dialogue.test.js`: aucun ne dort,
aucun ne depend de la charge de la machine.

1. un refus fait repartir la MEME ouverture 800 ms plus tard;
2. la question recue au troisieme essai arrete les reessais et fait avancer la
   file;
3. six refus d'affilee: un seul compte rendu, et il porte le nombre d'essais;
4. le garde-combat annule un reessai en attente — rien ne repart;
5. une mule decochee pendant les reessais ne recoit plus rien;
6. le reessai refait « ouvrir ferme d'abord »: la fermeture precede la seconde
   ouverture.

## Ce que ca ne fait pas

Si la mule est bloquee par un decor, restee sur une autre carte, ou que le suivi
de groupe du jeu ne l'amene pas, les six essais echouent et elle ne voyage pas.
OMNI ne la deplace pas. C'est la piste ecartee, pas un defaut oublie.
