# Retrait des raccourcis « précédent » et « suivant »

**Date :** 2026-08-27
**Statut :** conception validée, non implémentée.

## Le besoin

Les deux raccourcis de navigation en pied de fenêtre — « précédent » et
« suivant » — faisaient tourner un curseur dans la liste des clients. Depuis que
chaque compte peut porter sa propre touche **ou son propre bouton de souris**
(voir `2026-08-27-touches-souris-design.md`), ce cycle n'a plus d'usage : on va
directement au compte voulu, d'un coup de pouce, sans compter les crans.

Le retrait vaut **pour tout le monde**, amis compris. C'est une décision prise
en connaissance de cause : précédent/suivant sont aujourd'hui les seuls
raccourcis qui fonctionnent sans aucune configuration, `Ctrl+←` et `Ctrl+→`
étant posés par défaut dès l'installation. Un ami qui n'a jamais ouvert la
colonne « touche » perd donc sa seule façon de changer de fenêtre au clavier.

## Le gain, et il n'est pas symbolique

Ces deux accélérateurs sont enregistrés en **global**. Un raccourci global
confisque la touche à Dofus tant qu'OMNI tourne — c'est écrit dans le commentaire
de `NAV_DEFAUT` (`src/comptes/favoris.js:5-7`) et l'interface le signale déjà pour
les touches nues. Les retirer **rend `Ctrl+←` et `Ctrl+→` au jeu**, pour tous les
utilisateurs, sans que personne ait à faire quoi que ce soit.

## Ce qui disparaît

| quoi | où |
|---|---|
| `deplacer()`, `suivant()`, `precedent()` | `src/comptes/navigation.js` — le fichier **reste**, voir ci-dessous |
| les cas de test portant sur `suivant` / `precedent` | `test/comptes-navigation.test.js` |
| `naviguer()`, `curseurNav`, `poserCurseur()` | `desktop/main.js` |
| l'appel `poserCurseur(pid)` dans `basculerVersCompte` | `desktop/main.js` — il ne nourrissait que le cycle |
| les deux `poser(nav.suivant…)` / `poser(nav.precedent…)` | `desktop/main.js`, dans `poserRaccourcis` |
| `NAV_DEFAUT`, `_nav`, `touchesNav()`, `reglerToucheNav()` | `src/comptes/favoris.js` |
| la clé `nav` du fichier de réglages | écrite par `Favoris._ecrire` |
| le champ `nav` de l'état envoyé à l'interface | `desktop/main.js`, `envoyerEtat` |
| le canal IPC `reglerToucheNav` | `desktop/preload.js` et `desktop/main.js` |
| les deux `<span class="paire">` du pied | `desktop/index.html` |
| les deux boucles `document.querySelectorAll('[data-nav]')` | `desktop/index.html` |
| les cas de test portant sur `nav` | `test/comptes-favoris.test.js` |

## Le module de cycle ne disparait pas — correction

La premiere redaction de cette conception affirmait que `src/comptes/navigation.js`
n'existait que pour precedent/suivant et pouvait etre efface. **C'est faux**, et
la verification l'a montre avant l'implementation : le module exporte trois
choses, et `ordonner(lignes, ordre)` est appele par `desktop/main.js:544` pour
trier les lignes affichees. Rien a voir avec le cycle.

Ce qui part est donc l'interieur du module, pas le module :

- `deplacer()`, et les deux fleches `suivant()` / `precedent()` qui l'habillent ;
- les cas de test qui les couvrent, dans `test/comptes-navigation.test.js`.

`ordonner()` reste, seul, avec les tests qui le couvrent.

**Le fichier est renomme `src/comptes/ordre.js`**, et son test
`test/comptes-ordre.test.js`. C'est la meme decision que pour `ordreNavigation` :
un fichier nomme « navigation » qui ne contient plus que du tri de lignes est
exactement le piege qu'on vient de retirer ailleurs. Le renommage coute un
import et un nom de fichier.

## Ce qui reste, et pourquoi

**`ordreNavigation` reste — son nom ment.** Malgré ce qu'il annonce, il ne sert
pas qu'à la navigation : c'est lui qui porte la liste des pids passée à
`fermerClients()` par `fermerClientsConnus()`, sur le chemin `process.on('exit')`
(`desktop/main.js:173-180`). Ce n'est PAS le bouton « Fermer les clients » du pied,
qui passe par un autre chemin — la confusion entre les deux a déjà produit un
commentaire faux.
Le supprimer casserait une fonction sans rapport. Il est **renommé
`ordreAffiche`** dans le même mouvement : laisser un nom qui désigne une
mécanique disparue est exactement le genre de piège qui coûte une heure au
prochain lecteur.

**`avisNav` et `noterAvis()` restent.** La zone d'avis du pied ne sert pas qu'à
la navigation : `basculerVersCompte` s'en sert pour dire « aucun client lancé
pour ce compte » quand un raccourci **par compte** ne trouve pas sa fenêtre.
C'est le mode d'échec le plus coûteux du projet — une touche qui « ne fait
rien » — et il doit continuer de parler.

**L'avertissement de doublon reste**, et le retrait le rend plus juste : il ne
regardait que `etat.lignes`, jamais `etat.nav`. Un même accélérateur posé sur un
compte **et** sur « suivant » était donc perdu en silence, la navigation gagnant
parce qu'elle était posée en dernier, et rien à l'écran ne le disait. Cette
classe de conflit disparaît avec la navigation.

## Les réglages déjà enregistrés

Chaque `favoris.json` — celui de l'utilisateur comme celui de chaque ami —
contient une clé `nav`. Aucune migration n'est nécessaire :

- le lecteur cesse simplement de la lire ; il ignore déjà toute clé qu'il ne
  connaît pas ;
- le prochain enregistrement écrit l'objet sans elle, et elle disparaît.

Un ami qui reviendrait à une version antérieure retrouverait les valeurs par
défaut, pas une erreur. C'est le comportement voulu.

## Ce qui tient le travail

**`test/pont-ipc.test.js` est le filet principal.** Il vérifie sur le source que
`index.html`, `preload.js` et `main.js` s'accordent sur les canaux IPC, **dans
les deux sens** : un canal exposé que personne n'appelle échoue, un appel sans
gestionnaire échoue. Un retrait fait à moitié — le bouton enlevé mais le canal
laissé, ou l'inverse — sera rouge. Ce test existe précisément parce que ce genre
d'oubli ne se voit qu'au clic de l'utilisateur.

Le reste :

- `test/comptes-favoris.test.js` : retirer les cas `nav`, garder les autres
  intacts.
- `test/comptes-navigation.test.js` : supprimé avec son module.
- La suite complète doit rester verte.

## Ce qui n'est pas fait

- Aucune touche par défaut n'est attribuée en remplacement. Un ami sans
  configuration n'aura aucun raccourci, et c'est assumé : il en pose un en deux
  clics, et il récupère `Ctrl+←`/`Ctrl+→` dans le jeu.
- Le curseur de cycle n'est pas remplacé par autre chose.
- Rien n'est publié pour les amis dans le cadre de ce travail.
