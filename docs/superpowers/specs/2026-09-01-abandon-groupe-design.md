# Quand le maître abandonne, les mules du même combat abandonnent aussi

**Date :** 2026-09-01
**Statut :** conception validée, **mesurée le 2026-09-01**, non implémentée.

> **MISE À JOUR APRÈS MESURE — le critère a changé.** Le point d'arrêt prévu
> plus bas s'est déclenché : **`ieb` n'existe pas** sur une attaque ordinaire,
> il n'y a donc aucun identifiant de combat à y lire. L'utilisateur a arbitré le
> 2026-09-01 : le critère devient **la liste des combattants (`kmk`)**, qui dit
> directement « le maître combat avec moi » au lieu de faire comparer deux
> numéros. Les mesures et les lignes de journal réelles sont dans
> `docs/superpowers/specs/2026-09-01-trames-abandon.md`. Les sections
> « Ce qu'il faut mesurer » et « Le critère » ci-dessous sont conservées telles
> qu'elles ont été écrites avant la mesure — elles disent d'où l'on vient ; la
> section « Le critère, après mesure » fait foi.

## Le besoin

Le maître et ses mules sont dans un même combat — donjon, groupe de monstres
ordinaire. Le combat tourne mal. Le maître abandonne, **et les mules restent
dedans** : il faut abandonner à la main sur chaque client.

Ce que l'utilisateur veut : le maître abandonne, tout le monde abandonne.

**Et surtout ce qu'il ne veut pas :** que cela morde sur les **combats de
quête**. C'est la même exigence que celle qui a produit `src/garde-combat.js`
le 28/08 — un combat de quête est solo, le maître doit y rester seul, et la
réplication ne doit pas s'en mêler.

Les deux phases sont demandées : l'abandon en plein combat **et** le fait de
quitter pendant le placement.

## Ce qu'on sait déjà, et qui est mesuré

Du travail du 28/08 (`docs/superpowers/specs/2026-08-28-garde-combat-design.md`) :

- **`ieb` entrant annonce l'entrée en combat.** Sur 58 changements de carte du
  journal du 28/08, six seulement en portent un, et ce sont exactement les
  entrées en combat.
- **Deux combats distincts portent deux identifiants distincts** : `-20147`
  chez le maître, `-20148` chez l'esclave, le jour où chacun lançait le sien.

C'est tout. **Aucune trame de combat n'est répertoriée dans
`src/protocol/omni.js`** : la table ne contient que des interactions
(déplacement, dialogue, élément interactif, achat marchand). La trame
d'abandon n'a jamais été vue.

## Ce qu'il faut mesurer AVANT d'écrire une ligne de code

Session de capture, `OMNI_CAPTURE=1` + `OMNI_JOURNAL=complet` lancés par
`outils/lancer-dev.vbs`. Le journal est **réécrit à chaque lancement** : le
sauvegarder avant de relancer.

1. **La trame sortante d'abandon en plein combat.** Son type, ses champs.
2. **La trame sortante de « quitter » pendant le placement.** Rien ne dit que
   c'est le même type que la précédente.
3. **LA MESURE DÉCISIVE — l'identifiant de combat dans `ieb`.** Relever le
   `ieb` du maître **et** celui d'une mule **dans le même combat**, et vérifier
   qu'ils portent **le même identifiant, au même numéro de champ**.
4. Si c'est gratuit dans la même capture : la trame qui annonce la fin d'un
   combat, pour oublier l'identifiant plutôt que le laisser traîner.

**Point d'arrêt.** Si la mesure 3 montre que les deux `ieb` ne portent pas le
même identifiant, **le critère de ce spec s'effondre** et rien de ce qui suit
ne tient. Dans ce cas : arrêter, revenir vers l'utilisateur, ne pas improviser
un autre critère.

## Le critère : « le même combat que le maître »

Un esclave n'abandonne **que** si son identifiant de combat est celui du
maître.

```
maitre  <-- ieb { combat: 20147 }   -> on retient 20147 pour le pid maitre
esclave <-- ieb { combat: 20147 }   -> meme combat : il abandonnera
esclave <-- ieb { combat: 20148 }   -> autre combat : on ne touche a rien
esclave    (aucun ieb)              -> pas en combat : rien
```

**Pourquoi celui-là et pas un autre.** Il ne demande jamais de deviner la
*nature* d'un combat. Un combat de quête est solo : aucune mule ne partage
l'identifiant du maître, donc rien ne part — non pas parce qu'on l'a reconnu
comme un combat de quête, mais parce que le fait mesuré dit qu'elles n'y sont
pas. Le cas de la quête n'est même pas un cas particulier du code.

**Écarté :** réutiliser la liste des actions apprises par `garde-combat.js`
pour marquer un combat comme « de quête ». Un donjon dont l'entrée passe par un
dialogue apprendrait la même sorte de clé et bloquerait l'abandon à tort.

**Écarté :** répliquer sans condition en comptant sur le refus du serveur pour
les mules hors combat. Une mule engagée dans son propre combat abandonnerait
avec le maître.

## Le critère, après mesure — la liste des combattants

**C'est cette section qui fait foi.** Elle remplace la précédente.

Au démarrage d'un combat, chaque client reçoit **une** trame `kmk` portant la
liste complète des combattants, **identique chez le maître et chez la mule** :

```
kmk { 2={1=428 2=7 3=-1}              type 7 = monstre
      …
      2={1=274 2=3 3=676438999334}    cellule, orientation, characterId
      2={1=217 2=3 3=677048221990} }
```

Un client retient l'ensemble des identifiants (champ 3) de sa dernière `kmk`
**de combat**. **Une mule abandonne avec le maître si cet ensemble contient le
`characterId` du maître.**

Une `kmk` est une liste **de combat** si elle porte au moins un identifiant
**négatif** — un monstre. Sinon c'est une liste d'acteurs de carte : elle est
ignorée et ne remplace rien.

> **Corrigé le 2026-09-01 après un premier essai en jeu raté.** Le champ 2
> avait été pris pour un type d'acteur, avec « `3` = joueur ». C'était une
> coïncidence d'orientation : les monstres du combat mesuré regardaient tous
> dans la même direction. Le champ 2 est l'orientation, le champ 1 la cellule,
> et ce qui distingue un joueur d'un monstre est le **signe** du champ 3.
> Détail et contre-preuve dans `2026-09-01-trames-abandon.md`.

**Pourquoi c'est mieux que le numéro de combat.** Le numéro existe bien
(`kau { 5=198 }`, reçu par les deux), mais il est aussi diffusé à qui *voit* un
combat depuis sa carte — mesuré session 1, `93471 ms`, les deux clients
reçoivent `kau { 5=90 }` en arrivant sur une carte sans être en combat. La
`kmk`, elle, ne se reçoit que si on y est.

**Le combat de quête reste couvert sans cas particulier :** le maître y est
seul, sa `kmk` ne nomme que lui, la mule n'en reçoit aucune. Rien ne part.

**L'état périmé reste sans danger, pour une raison nouvelle :** l'ensemble d'un
client est **remplacé** à chaque `kmk` de combat. Un combat neuf écrase le
précédent, sans qu'on ait besoin de savoir quand le combat d'avant s'est
terminé — ce que la mesure n'a pas livré.

## Le module : `src/abandon-combat.js`

Module pur — ni Electron, ni Frida, ni système — testé avec un double du
superviseur, comme `src/invitation.js` et `src/passeur.js`.

**Ce qu'il tient :** une table `pid → identifiant de combat`, remplie sur
chaque `ieb` **entrant**, chez **tous** les clients, maître compris.

**Ce qu'il fait,** sur une trame d'abandon (ou de sortie de placement)
**sortante du maître**, replicate armé :

1. lire l'identifiant de combat du maître dans la table ; s'il n'y en a pas,
   ne rien faire ;
2. pour chaque esclave dont l'identifiant **égale** celui du maître :
   ré-émettre la trame par `superviseur.emettre(pid, brute)` ;
3. rendre compte **par compte** — « abandon répliqué » ou la raison du refus ;
4. oublier les identifiants consommés.

**Isolation :** chaque esclave dans son propre essai, comme les étapes de
`garde-combat.js`. Une exception sur une mule ne doit pas priver les suivantes
de leur abandon.

**Le compte rendu passe par la Map `messages`, jamais par `journal()`.** Piège
payé le 29/08 sur les songes : `journal()` ne s'écrit pas sans
`OMNI_JOURNAL=complet`, une politique qui n'y parle que serait muette en usage
normal. L'abandon groupé est exactement le genre d'événement que l'utilisateur
doit voir sur la ligne du compte.

**Verbatim ou reconstruit :** à décider sur la mesure 1. Si la trame ne porte
que l'identifiant du combat, elle se ré-émet telle quelle — c'est le même
combat, par construction du critère. Si elle porte un identifiant propre au
compte, il faudra le substituer, et cela ressort dans le plan.

## L'interrupteur : celui du replicate, et rien d'autre

Actif quand le replicate est armé, inerte quand il est coupé. Aucune colonne
nouvelle dans la fenêtre, rien dans `favoris.json`.

C'est déjà la règle de `garde-combat.js` : *OMNI ne répare que ce qu'il a
causé*. Ici, OMNI ne fait suivre l'abandon que dans un combat où les mules sont
entrées à sa suite.

## Ce qu'on ne touche pas

**`src/protocol/omni.js`.** La table rejoue un type vers *tous* les esclaves,
sans condition d'état ; le filtre « même combat » n'y a pas sa place. Et
`src/duplicateur.js` sort sur `!estMaitre` : il ne voit rien du trafic des
mules, donc il ne peut pas tenir la table des identifiants. **La trame
d'abandon n'entre pas dans la table des messages répliqués.**

**`src/garde-combat.js`.** Il sort lui aussi sur `!estMaitre`. Il reste tel
quel ; le nouveau module vit à côté.

## L'état périmé, et pourquoi il est sans danger

Rien ne garantit qu'on voie la fin d'un combat — la mesure 4 est un bonus, pas
une condition. Un identifiant peut donc traîner dans la table après la fin du
combat.

Cela ne peut faire que **rater** un abandon, jamais en déclencher un à tort :
le maître entré dans un nouveau combat a un identifiant neuf, une mule restée
sur l'ancien ne l'égale pas, elle ne reçoit rien. Deux combats différents
n'ont jamais porté le même identifiant (mesuré : -20147 / -20148).

## Tests

Unitaires, avec un double du superviseur :

- maître et esclave dans le même combat -> la trame part chez l'esclave ;
- esclave dans un autre combat -> rien ;
- esclave sans `ieb` -> rien ;
- replicate coupé (`superviseur.arme` faux) -> rien ;
- maître sans combat connu -> rien ;
- une exception sur une mule n'empêche pas les autres d'abandonner ;
- un second abandon sur le même combat ne renvoie rien (identifiants
  consommés) ;
- le compte rendu arrive bien par la Map `messages`.

## Vérification en jeu — obligatoire

Deux fois le 26/08, et encore le 28/08, le défaut n'est apparu **qu'en lançant
l'application**. Ni les tests ni la relecture ne l'auraient montré.

1. **Donjon ou groupe de monstres, maître + au moins une mule.** Le maître
   abandonne : la mule sort du combat. Relevé attendu dans le journal —
   l'abandon du maître, puis la sortie de la mule, avec l'écart.
2. **Combat de quête solo.** Le maître abandonne : **les mules ne bougent
   pas**. C'est le test qui compte, celui qui dit que la demande est respectée.
3. **Phase de placement**, si la trame mesurée en 2 diffère de celle mesurée
   en 1 : même paire d'essais.
