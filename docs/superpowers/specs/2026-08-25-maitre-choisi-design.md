# Maître choisi, et non plus subi

**Date :** 2026-08-25
**Statut :** conçu et validé, non implémenté.

## Le besoin

Le maître est aujourd'hui le dernier client Dofus à avoir eu le focus. Chaque
agent sonde `GetForegroundWindow()` toutes les 250 ms et signale son passage au
premier plan ; le superviseur écrit alors `this.maitre = pid`, et ne l'annule
jamais.

Conséquence : cliquer sur un alt pour une vente à l'HDV en fait le maître, et ce
sont **ses** actions qui partent chez tous les autres, leader compris. Le
déclencheur de la réplication n'est pas décidé, il est hérité d'un geste de
fenêtre sans rapport avec l'intention.

Le spec du 22/08 avait déjà buté sur cette fragilité, à propos du filtre de
l'acceptation d'échange : « le maître est le client qui a le focus : si le focus
bouge entre la proposition et l'arrivée de la trame, l'échange serait refusé sans
raison visible ». Il l'avait contournée. Ce document la supprime.

## Périmètre

**Dedans :** choisir explicitement quel compte est maître, retenir ce choix
d'une session à l'autre, et rendre visible le cas où il n'y a pas de maître.

**Dehors :** tout le reste de l'interface. Le duplicateur, le passe-tour, les
deux accepteurs et le no-anim ne changent pas d'un caractère.

## Décisions prises

### Le focus disparaît complètement

Pas de mode automatique conservé en repli, pas d'interrupteur auto/manuel. Il y a
un maître explicitement choisi, ou il n'y en a pas.

`reportFocus` passe à `false` dans `superviseur.js`, et la branche `premierPlan`
du gestionnaire de messages est retirée. La boucle `setInterval` de 250 ms qui
tournait **à l'intérieur de chaque process Dofus** disparaît avec elle : c'est du
code en moins injecté dans le jeu, pas seulement une fonction débranchée.

### Le choix est mémorisé, et son absence ne réplique rien

`favoris.json` gagne une clé `maitre`, valant un identifiant de compte ou `null`.
Même nature que les cinq réglages qui l'entourent : que des identifiants
numériques, rien qui pose problème si le fichier est partagé.

Si le compte épinglé n'est pas lancé, ou n'est pas intercepté, **il n'y a pas de
maître et rien ne se réplique**. Pas de repli sur un autre compte : un maître que
l'utilisateur n'a pas choisi est exactement ce que ce changement existe pour
supprimer. L'en-tête le dit explicitement, sans quoi l'absence de réplication
serait indiscernable d'une panne.

### L'éligibilité exige le trafic prouvé, pas l'attache

Un compte ne peut être maître que si une trame de son flux a été décodée, donc
s'il est dans `avecTrafic`, et non s'il est seulement `pilotable`.

La raison est directe : un maître doit **émettre** des trames, sinon il n'y a
rien à répliquer. Exclure la fenêtre d'attente ne coûte donc rien, puisque avant
la première trame il n'y a par construction aucune action à dupliquer. C'est le
même raisonnement que celui qui a fait choisir la trame décodée plutôt que
l'attache réussie comme preuve d'interception, le 22/08.

### Le badge devient un bouton, et l'alerte prime

Le badge de droite, aujourd'hui purement informatif, porte le geste :

| Situation | Ce qu'on voit à droite |
|---|---|
| Éligible, maître | bouton actif, `MAÎTRE` |
| Éligible, pas maître | bouton `définir maître` |
| Non éligible | pas de bouton, l'alerte à sa place |

Un compte non éligible n'a **pas** de bouton. C'est honnête plutôt que
décoratif : ce client ne peut pas être maître, et lui proposer le geste serait
une promesse fausse, du même ordre que les interrupteurs désactivés hors
interception.

Une ligne sans identifiant de compte, celle d'un client dont la ligne de commande
ne porte pas de `-logFile` exploitable, n'est pas éligible non plus. Le choix est
mémorisé **par identifiant de compte** : un client qui n'en a pas ne peut pas être
retenu d'une session à l'autre, et un maître qui ne survivrait pas au
redémarrage serait le contraire de ce qui est demandé ici. Même règle que les cinq
interrupteurs, qui se gardent déjà par `l.id !== null`.

Cela règle au passage une contradiction observée le 25/08 : une ligne affichait
le badge rassurant « suit » pendant qu'un message dessous annonçait que la
réplication était impossible. L'état et le bouton ne peuvent plus se contredire
puisqu'ils occupent la même place.

La preuve de trafic, qui quitte le badge, revient sous forme d'une pastille avant
le nom : pleine quand une trame est passée, creuse sinon.

### Recliquer le bouton du maître le désépingle

Sans cela, revenir à « aucun maître » serait impossible une fois un compte
choisi. Le geste est réversible par le même geste.

## Architecture

**Nouveau fichier.** `src/comptes/maitre.js`, une fonction pure :

```js
resoudreMaitre({ epingle, clients, intercepte }) -> pid | null
```

Rend le pid du client dont l'`idCompte` vaut l'épinglé et qui a prouvé son
trafic ; `null` sinon. Ni Electron, ni Frida, ni disque, exactement comme
`construireVue`. La règle d'éligibilité est la seule logique réelle de ce
changement : elle vit dans un module testable plutôt que dans les 488 lignes de
`desktop/main.js`.

**Modifiés.**

- `src/comptes/favoris.js` : `maitre()` et `reglerMaitre(id)`, pris en compte par
  `charger()` et `_ecrire()`.
- `src/comptes/vue.js` : un champ `eligibleMaitre` par ligne.
- `src/superviseur.js` : `reportFocus: false`, branche `premierPlan` retirée.
- `desktop/main.js` : `superviseur.maitre` recalculé à chaque tick de
  `envoyerEtat()`, au même endroit que la resynchronisation des quatre
  interrupteurs depuis `favoris.json` ; nouvel IPC `definirMaitre`.
- `desktop/preload.js` : quatorzième canal.
- `desktop/index.html` : bouton, pastille, message d'en-tête.

## Le piège vérifié

Quand `maitre` vaut `null`, `comptes.esclaves(null)` rend **tous** les comptes,
puisque aucun pid n'est égal à `null`. Rejouer sur cette liste enverrait l'action
d'un compte à tous les autres, sans maître désigné.

Rien ne part, parce que le duplicateur teste `estMaitre` avant d'appeler
`rejouer()`, et que `client.pid === null` est toujours faux. La sûreté tient donc
à un enchaînement non évident, dans deux fichiers différents. Un test le fige
explicitement plutôt que de le laisser reposer sur une lecture attentive.

## Tests

- `test/comptes-maitre.test.js` : épinglé absent de la liste, épinglé présent
  mais sans trafic, épinglé intercepté, plusieurs clients, `epingle` à `null`.
- `test/comptes-favoris.test.js` : persistance de `maitre`, valeur non entière
  rejetée, fichier corrompu, désépinglage.
- `test/comptes-vue.test.js` : `eligibleMaitre` sur les six états de ligne.
- `test/duplication.test.js` : maître `null`, aucune émission chez personne.

## Ce qui n'est pas touché

`src/duplicateur.js`, `src/passeur.js`, `src/invitation.js`, `src/echange.js`,
`src/noanim.js` et `comptes.esclaves()`. Le duplicateur lit `estMaitre` tel que le
superviseur le lui fournit ; d'où cette valeur provient ne le regarde pas.
