# Empêcher la duplication de lancer un combat chez les esclaves

**Date :** 2026-08-28
**Statut :** conception validée, non implémentée.

## Le besoin

Quand une quête propose un combat solo et que le maître accepte, **tous les
esclaves lancent le leur en même temps**. Ils n'entrent pas dans le combat du
maître — chacun démarre le sien, mesuré : identifiants de combat distincts,
`-20147` chez le maître, `-20148` chez l'esclave.

## La cause, mesurée

La duplication rejoue fidèlement `ioy` (`NpcDialogReplyRequest`), et **au moment
de l'envoi, rien ne distingue une réponse qui déclenche un combat d'une réponse
ordinaire** : c'est un numéro dans un arbre de dialogue. Ce n'est pas un défaut
de code, c'est la fidélité du rejeu.

Capture du 2026-08-28, deux clients, maître `15204`, esclave `6328` :

```
1080033   maitre    --> ioy { 1=25088 }         l'action
1080063   maitre    <-- ieb ...                 +30 ms : il est en combat
1080144   esclave   <-- ieb ...                 +111 ms : il entre dans le sien
```

Un dialogue est une **suite** de réponses : le maître a envoyé `25091`, puis
`25089`, puis `25088` — seule la dernière a lancé le combat.

## Ce qui rend la correction possible

Le rejeu part **16 à 80 ms** après l'action du maître (`ETALEMENT_REJEU`), et le
serveur annonce le combat au maître en **30 ms**. La fenêtre existe : un rejeu
retardé peut être annulé avant d'être écrit.

Deux mécanismes se complètent, et c'est voulu :

- le **délai + annulation** attrape la première occurrence, celle qu'on n'a
  jamais vue ;
- l'**apprentissage** la rend définitive pour les suivantes, sans dépendre du
  timing.

## Le signal : `ieb`

Sur 58 changements de carte du journal, **6 seulement portent un `ieb`** — et ce
sont exactement les entrées en combat. Tous les autres messages de la rafale
d'entrée (`iom`, `kld`, `kml`, `kmp`, `kub`, `lqn`) apparaissent aussi sur des
changements de carte ordinaires. `ieb` est le seul discriminant.

```
ieb { 1: 1642, 2: 9828 }    champ 2 incremente d'un combat a l'autre
```

**Ce qui n'est pas établi**, et doit l'être en conditions réelles : que `ieb`
couvre toutes les façons d'entrer en combat, et qu'il ne se déclenche jamais
ailleurs. Huit occurrences, une session, un type de quête. Aucun combat du
journal n'a été joué jusqu'au premier tour, donc `ieb` n'a pas pu être ancré sur
un marqueur déjà connu (`jzc`, établi le 27/08 pour le passe-tour).

Le 27/08, deux conclusions tirées trop vite d'une corrélation ont coûté une
demi-journée sur le passe-tour. Le contraste 6/58 est bien plus net que ce qui
avait égaré alors, mais il reste une mesure, pas une preuve.

## Ce qui se passe sur un `ieb` du maître

Trois actions, dans cet ordre :

1. **Annuler** tous les rejeux encore en attente, chez tous les esclaves, quel
   qu'en soit le type. Un rejeu déjà écrit ne se rattrape pas ; un rejeu en
   attente, si.
2. **Retenir** comme dangereuse la dernière trame d'un type sensible **émise
   par le maître** — pas celle qui a été rejouée, celle qu'il a envoyée —
   **si et seulement si** elle date de moins de 2 secondes. Un monstre agressif
   qui saute sur le maître trois secondes après un dialogue anodin
   n'empoisonnera pas la liste.
3. **Fermer le dialogue** des esclaves à qui un `iov` ou un `ioy` a été rejoué
   dans les 30 dernières secondes, en leur envoyant `kla`
   (`DialogLeaveRequest`) — sans paramètre, déjà dans la liste de duplication.

Le point 3 répond à une conséquence directe du point 1 : les réponses
précédentes de l'enchaînement ont été rejouées plusieurs secondes plus tôt et ne
sont pas annulables. Les esclaves ont donc une fenêtre de dialogue ouverte, et
le maître, parti en combat, n'enverra jamais le message qui la ferme.

**Non mesuré :** l'effet d'un `kla` envoyé à un client qui n'a aucun dialogue
ouvert. Probablement ignoré. C'est pourquoi l'envoi est restreint aux esclaves
ayant réellement reçu un rejeu de dialogue récent, au lieu d'être diffusé à tous.

## Le délai

Seuls les trois types qui peuvent déclencher un combat sont retardés :

| type | nom | ce qu'il fait |
|---|---|---|
| `iov` | `NpcGenericActionRequest` | parler au PNJ |
| `ioy` | `NpcDialogReplyRequest` | choisir une réponse |
| `iwo` | `InteractiveUseRequest` | utiliser un élément de la carte |

Les cinq autres types rejoués — téléportation, changement de carte, information
de carte, havre-sac, sortie de donjon — gardent le comportement actuel. Les
ralentir ne protégerait de rien.

**Plancher de 250 ms** avant l'écriture du premier esclave, contre 16 ms
aujourd'hui. Le signal a été mesuré à 30 ms ; le facteur 8 couvre la gigue
réseau. L'étalement entre esclaves reste ce qu'il est et s'ajoute au plancher.

## Ce qu'OMNI retient

Une clé par action, construite depuis les champs qui l'identifient :

```
ioy:25088              la reponse de dialogue        (champ 1)
iov:153356294:-20000   le PNJ, sur sa carte          (champs 2 et 3)
iwo:489565             l'element interactif          (champ 2)
```

Une action dont la clé figure dans la liste **n'est pas rejouée du tout** — ni
retardée, ni tentée. Le refus est signalé sur la ligne du compte, comme tout
refus de rejeu.

La liste vit dans le fichier de réglages, avec le reste. Un bouton du pied la
vide en une fois. Elle n'est pas consultable à l'écran : ce sont des numéros,
ils n'apprendraient rien à personne.

## Architecture

### `src/garde-combat.js` — nouveau, pur

Jumeau de `src/passeur.js` : ni Electron, ni Frida, ni disque.

```
TYPES_SENSIBLES                       -> ['iov', 'ioy', 'iwo']
TYPE_ENTREE_COMBAT                    -> 'ieb'
DELAI_PLANCHER_MS                     -> 250
FENETRE_APPRENTISSAGE_MS              -> 2000
FENETRE_DIALOGUE_MS                   -> 30000

cleDe(type, frame)                    -> 'ioy:25088' ou null
estSensible(type)                     -> booleen
TRAME_FERMER_DIALOGUE                 -> les octets d'un kla, construits une fois
```

`TRAME_FERMER_DIALOGUE` vit ici et pas dans l'application, pour la meme raison
que `TRAME_PASSE` vit dans `src/passeur.js` : c'est une trame constante et vide,
elle se construit une fois avec `encodeRaw` et se teste en la relisant avec
`decodeFrameRaw`. `kla` ne porte aucun champ (`src/protocol/omni.js`), donc rien
n'y depend de l'esclave destinataire.

`cleDe` rend `null` pour un type non sensible ou un champ manquant : une clé
partielle vaudrait mieux que rien, et c'est faux — elle bloquerait la mauvaise
action.

### `src/superviseur.js`

Les rejeux différés passent par `_emettreApres`, qui **ne mémorise pas ses
minuteurs** : rien n'est annulable aujourd'hui. C'est exactement le manque
qu'avait le passe-tour avant le 27/08.

- les minuteurs sont retenus par pid ;
- `annulerRejeux()` les annule tous et rend le nombre annulé ;
- un minuteur qui arrive à échéance se retire de lui-même.

### `src/duplicateur.js`

La politique, comme aujourd'hui :

- une action dont la clé est apprise n'est pas rejouée, et le compte rendu dit
  pourquoi ;
- une action sensible est rejouée avec le plancher de 250 ms ;
- le reste ne change pas.

### `desktop/main.js`

Branche le garde sur le flux entrant du maître, tient la liste apprise via
`Favoris`, et expose le bouton d'oubli. C'est aussi lui qui envoie les `kla`,
par `superviseur.emettre(pid, TRAME_FERMER_DIALOGUE)` — la meme voie que le
passe-tour, deja gardee contre une socket fermee.

### `src/comptes/favoris.js`

Une clé de plus dans le fichier, `combats` : un tableau de chaînes. Mêmes gardes
que les autres — une valeur inattendue est ignorée, pas une erreur.

## Ce qui peut mal tourner

| cas | traitement |
|---|---|
| `ieb` n'est pas le bon message | le délai ne protège plus, l'apprentissage n'apprend rien. À vérifier en combat réel — c'est le risque principal |
| `ieb` se déclenche hors combat | des rejeux annulés à tort : le maître avance, les esclaves non. Visible, réparable en refaisant l'action |
| Le maître entre en combat sans action rejouée | rien à annuler, rien à retenir (la fenêtre de 2 s n'est pas ouverte) |
| Apprentissage faux malgré la fenêtre | le bouton d'oubli vide la liste |
| Un esclave sans socket au moment du `kla` | même garde que tout envoi : refus journalisé, pas d'exception |

## Tests

Sans jeu ni interface :

- `garde-combat` : les trois formes de clé ; `null` pour un type non sensible et
  pour un champ manquant ; la fenêtre de 2 s retient et écarte au bon moment ;
  `TRAME_FERMER_DIALOGUE` se relit en un `kla` sans charge utile.
- `superviseur` : un rejeu différé s'annule ; un rejeu déjà écrit ne s'annule
  pas ; `annulerRejeux` rend le compte ; un minuteur échu ne reste pas en
  mémoire.
- `duplicateur` : une clé apprise refuse le rejeu et le dit ; un type sensible
  reçoit le plancher ; un type ordinaire garde son étalement.
- `favoris` : la liste survit à un rechargement, se vide, et un fichier ancien
  sans la clé se lit sans erreur.
- Les tests existants du duplicateur et du superviseur restent verts.

## Ordre de réalisation

| | |
|---|---|
| 1 | `src/garde-combat.js` et ses tests |
| 2 | L'annulation des rejeux différés dans le superviseur |
| 3 | La politique dans le duplicateur |
| 4 | La liste dans les réglages, et le bouton d'oubli |
| 5 | Le branchement dans l'application, et l'envoi des `kla` |
| 6 | Essai en conditions réelles, sur la même quête |

## Ce qui est écarté

- Distinguer une agression d'un combat choisi.
- Une liste consultable ou modifiable entrée par entrée.
- Retarder les cinq autres types rejoués.
- Rattraper un rejeu déjà écrit : c'est impossible, et c'est précisément
  pourquoi le délai existe.
