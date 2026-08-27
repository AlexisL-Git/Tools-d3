# Boutons de souris comme raccourcis

**Date :** 2026-08-27
**Statut :** conception validée, non implémentée.

## Le besoin

Assigner un bouton de souris là où on assigne aujourd'hui une touche : dans la
colonne « touche » de chaque compte, et sur les deux raccourcis de navigation
« précédent » / « suivant » en pied de fenêtre. Basculer de personnage d'un coup
de pouce, sans lâcher la souris ni chercher une touche en combat.

## Pourquoi ce n'est pas une ligne de code

Les raccourcis passent par `globalShortcut` d'Electron (`desktop/main.js:757`),
qui ne connaît **que le clavier**. Aucun bouton de souris n'est représentable
dans un accélérateur Electron. Passer `Souris4` à `globalShortcut.register()`
échouerait — silencieusement, puisque `register` rend `false` au lieu de lever.

Il faut donc un second chemin, parallèle à celui du clavier, de la capture dans
l'interface jusqu'à l'exécution de l'action.

## Décisions prises

| question | choix | raison |
|---|---|---|
| Où les boutons agissent | sur les clients **Dofus** et sur la fenêtre **d'OMNI** | l'agent Frida est déjà injecté dans chaque client : aucune dépendance nouvelle |
| Quels boutons | M4, M5, **clic molette** | M4/M5 sont libres dans Dofus ; la molette est acceptée en connaissance de cause |
| Combinaisons | oui : `Ctrl+M4`, `Maj+M5`… (affichage ; stocké `CommandOrControl+Souris4`) | trois boutons seuls ne feraient que trois raccourcis |
| Molette haut/bas | **non** | Dofus l'utilise pour le zoom et elle tourne par accident |
| Clic gauche / droit | **non** | il faut pouvoir cliquer sur la case pour armer la saisie |

**La limite acceptée :** si une troisième fenêtre a le focus — le navigateur,
l'explorateur — le bouton ne fait rien. Une touche clavier, elle, marche
partout. Faire autrement demanderait un *hook* système bas niveau, donc un
module natif compilé en C, à empaqueter dans les 480 Mo et à recompiler à
chaque mise à jour d'Electron. Le coût est sans commune mesure avec le gain.

**Le bouton n'est pas confisqué à Dofus.** C'est l'inverse du clavier, où le
raccourci global vole la touche au jeu tant qu'OMNI tourne. Ici on observe
l'état du bouton, on ne l'intercepte pas : le jeu le reçoit aussi. Sans
conséquence pour M4 et M5, que Dofus n'utilise pas ; à signaler pour la molette.

## Ce qu'on stocke

Aucun changement de format ni de fichier. Les raccourcis sont déjà des chaînes
d'accélérateur dans le fichier de réglages, et trois noms s'y ajoutent :

```
Souris4          le bouton latéral arrière   (DOM button 3, VK_XBUTTON1 0x05)
Souris5          le bouton latéral avant     (DOM button 4, VK_XBUTTON2 0x06)
SourisMilieu     le clic molette             (DOM button 1, VK_MBUTTON   0x04)
```

Combinables comme le reste, et **dans le même ordre** que les accélérateurs
clavier existants : `CommandOrControl`, puis `Alt`, puis `Shift`, puis le
bouton. `CommandOrControl+Souris4` est donc une chaîne valide.

L'ordre n'est pas cosmétique : la chaîne fabriquée à la capture doit être
identique, caractère pour caractère, à celle fabriquée à la réception. Sinon la
recherche dans la table échoue et le raccourci ne fait rien, sans erreur.

## Architecture

### `src/comptes/raccourcis.js` — étendu, pas un fichier de plus

Le module qui traduit déjà entre frappe, accélérateur Electron et libellé
affiché. C'est là que la souris appartient : un second fichier au même sujet
laisserait deux endroits où chercher la réponse à « comment s'écrit un
raccourci ». Il reste pur — ni Electron, ni Frida, ni disque.

```
depuisBouton({ button, ctrlKey, altKey, shiftKey })  -> 'CommandOrControl+Souris4'
                                                        ou null
estSouris(accelerateur)                              -> booleen
```

`depuisBouton` est le jumeau exact de `depuisFrappe` : mêmes noms de champs
que l'objet `MouseEvent` du navigateur, même ordre de modificateurs, et `null`
pour tout bouton non assignable (gauche, droit, inconnu). C'est **la même
fonction** qui sert à la capture dans l'interface et à la réception depuis
l'agent : c'est ce qui garantit que les deux chaînes coïncident.

`estSouris` est ce qui permet à `poserRaccourcis()` de trier.

`estUtilisable` doit changer. Elle classe aujourd'hui tout accélérateur d'une
seule partie comme risqué, sauf les touches de fonction : `Souris4` serait donc
signalé à tort. Elle rendra `{ risque: false }` pour M4 et M5, et pour la
molette un risque au texte **différent** de celui du clavier — le clic n'est
pas confisqué, il est partagé.

### La duplication dans `index.html` est imposée

Le renderer tourne avec `sandbox: true` (`desktop/main.js:611`), et un preload
en bac à sable ne peut charger que les modules d'Electron. `index.html` porte
donc sa propre copie de cette traduction, et il faut l'y étendre aussi. Ce
n'est pas un oubli à corriger : c'est la frontière de confiance.

### `src/il2cpp/connectAgent.js` — un bloc de plus

Sur le modèle exact du bloc `reportFocus` déjà présent (ligne 210) : mêmes
`NativeFunction` sur `user32.dll`, même `setInterval`, même `send`.

- **Période : 30 ms.** Un clic dure 80 à 150 ms ; à 250 ms on en raterait.
- **Front montant seulement** : on retient l'état précédent de chaque bouton et
  on ne signale que relâché → pressé. Sans ça, un bouton maintenu enverrait 33
  messages par seconde.
- **Seulement si ce client est au premier plan.** Le bloc fait sa propre
  vérification (`GetForegroundWindow` + `GetWindowThreadProcessId`) plutôt que
  de dépendre de `reportFocus`, qui est éteint. Sans cette garde, les cinq
  clients verraient le même appui et la bascule partirait cinq fois.
- **Allumé et éteint sur commande**, par le canal `recv` déjà utilisé pour
  `premierPlan`. Le superviseur poste `{ type: 'souris', actif }` à chaque
  client. La boucle ne tourne donc que si au moins un bouton est assigné.

Ce dernier point répond au commentaire du fichier, qui explique pourquoi une
boucle de 250 ms a été retirée de l'intérieur de chaque client : elle répondait
à une question qu'on ne posait plus. Celle-ci est plus rapide, mais elle ne
tourne que quand elle sert.

Le message remonté porte l'état brut, pas une chaîne :

```
send({ souris: { button: 4, ctrlKey: false, altKey: false, shiftKey: true } })
```

Les noms de champs sont ceux d'un `MouseEvent` du navigateur, pour que la même
fonction accepte les deux sources sans adaptateur. La mise en forme reste dans
`src/comptes/raccourcis.js`, où elle se teste.

### `src/superviseur.js`

- un rappel `onSouris` dans les options, symétrique de `onTrame` ;
- `_recevoirMessageAgent` route `p.souris` vers lui ;
- une méthode `reglerSouris(actif)` qui poste la commande à tous les clients,
  et l'applique aussi aux clients attachés **après** l'appel.

### `desktop/main.js`

`poserRaccourcis()` trie au lieu de tout envoyer à `globalShortcut` :

```
pour chaque accelerateur enregistre
    estAccelerateurSouris ?  -> table souris (Map accelerateur -> action)
                             -> sinon globalShortcut.register, inchange
puis superviseur.reglerSouris(table.size > 0)
```

La table est reconstruite en entier à chaque changement, comme les raccourcis
clavier le sont déjà : au plus dix entrées, et un différentiel faux laisserait
un bouton fantôme actif jusqu'à la fermeture.

`onSouris` fabrique la chaîne avec `depuisBouton`, cherche dans la table, et
exécute. Une entrée absente ne fait rien — ce n'est pas une erreur, c'est un
bouton non assigné.

Un canal IPC de plus (`boutonSouris`) reçoit la même chose depuis l'interface,
pour le cas où c'est la fenêtre d'OMNI qui a le focus. Même table, même action.

### `desktop/index.html`

- **Capture** : un écouteur `mousedown` à côté de l'écouteur `keydown`, actif
  seulement quand une saisie est armée. Boutons 0 et 2 ignorés.
  `preventDefault()` sur les boutons 3 et 4, sinon la fenêtre navigue en
  arrière ou en avant.
- **Affichage** : `M4`, `M5`, `Molette` dans la table `AFFICHAGE`.
- **Avertissement** : `estRisquee()` teste aujourd'hui « une seule partie et
  pas une touche de fonction », ce qui classerait `Souris4` comme risquée à
  tort. Elle doit écarter les accélérateurs souris. Seule la molette reçoit une
  infobulle, et son texte diffère de celui du clavier : le clic n'est pas
  confisqué, il est **partagé** avec Dofus.
- **Hors saisie** : un `mousedown` sur M4, M5 ou molette part par IPC vers la
  table de `main.js`, pour que le raccourci marche aussi depuis OMNI.

### `desktop/preload.js`

Le canal `boutonSouris` exposé au renderer, comme les autres.

## Ce qui peut mal tourner

| cas | traitement |
|---|---|
| L'agent lève dans la boucle | `try/catch` autour du corps, comme le bloc `reportFocus` : une exception non capturée dans le process du jeu est bien pire qu'un bouton muet |
| Deux comptes sur le même bouton | le dernier posé gagne, comme pour le clavier — la table est une `Map` |
| Un bouton assigné puis le compte retiré | la table est refaite en entier à chaque changement |
| Bouton maintenu | front montant seulement |
| Aucun client Dofus au premier plan | rien ne remonte : c'est la limite acceptée |

## Tests

Sans jeu ni interface :

- `src/comptes/raccourcis.js` : les trois boutons rendent la bonne chaîne ;
  gauche, droit et un bouton inconnu rendent `null` ; l'ordre des
  modificateurs est le même que celui du clavier ; `estSouris` distingue
  `CommandOrControl+Souris4` de `CommandOrControl+A` ; `estUtilisable` ne
  signale plus M4 et M5, et signale la molette avec son propre texte.
- `poserRaccourcis` : un accélérateur souris ne part jamais chez
  `globalShortcut`, un accélérateur clavier y va toujours, et un mélange des
  deux se répartit correctement.
- `superviseur` : `p.souris` atteint `onSouris` avec le pid ; `reglerSouris`
  poste à tous les clients.
- Les raccourcis clavier existants ne changent pas de comportement.

## Ordre de réalisation

| | |
|---|---|
| 1 | `src/comptes/raccourcis.js` étendu, et ses tests |
| 2 | Le bloc souris de l'agent, et son allumage par le superviseur |
| 3 | Le tri dans `poserRaccourcis` et la table d'actions |
| 4 | La capture et l'affichage dans l'interface |
| 5 | Essai en conditions réelles, sur deux clients |

## Ce qui est écarté

- La molette haut/bas comme raccourci.
- Le clic gauche et le clic droit.
- Un bouton différent par client : le raccourci désigne un compte, comme au
  clavier, et c'est le compte qui décide de la fenêtre.
- Le fonctionnement depuis une fenêtre tierce, qui demanderait un module natif.
