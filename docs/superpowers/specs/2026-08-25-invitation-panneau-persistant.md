# Le panneau d'invitation reste ouvert après une acceptation automatique

**Date :** 2026-08-25
**Statut :** constat établi par la mesure. **Non résolu, reporté volontairement.**
Aucune conception n'est engagée ici.

## Le symptôme

Une invitation de groupe envoyée depuis le maître vers trois autres clients. Les
trois acceptent automatiquement, et **le panneau d'invitation reste affiché** sur
chacun d'eux.

## Ce qui est prouvé

**L'acceptation fonctionne.** Les personnages rejoignent bien le groupe,
confirmé en jeu. Le serveur reçoit donc notre `ijx`, le valide et l'applique.

Le journal détaillé, sur la séquence mesurée :

```
64873ms [1208]  invitation : acceptee (groupe 2558)
67040ms [25028] invitation : acceptee (groupe 2558)
70650ms [21304] invitation : acceptee (groupe 2558)
```

Trois invités, trois acceptations, même identifiant de groupe. Le quatrième pid
est l'invitant, qui n'a rien à accepter.

Deux hypothèses ont été écartées par la mesure avant d'arriver là :

- **Une socket amont périmée.** `Get-NetTCPConnection` donne 3 connexions par
  client vers son proxy, mais **une seule** vers le port de jeu 5555. Comme
  `_recevoir` ne retient que celle du port du jeu, `client.amont` désigne bien
  l'unique socket vivante. L'écriture part au bon endroit.
- **Un filtre qui refuse.** Le journal aurait rendu un refus nommé. Il rend une
  acceptation.

## La cause

Le client ne sait pas qu'il a accepté.

Dans le fonctionnement normal, c'est le clic de l'utilisateur qui ferme le
panneau, localement, au moment où le client émet lui-même l'acceptation. Nous
injectons la réponse directement sur la socket : le client ne la voit jamais
passer, son état interne reste « invitation en attente », et il continue
d'afficher le panneau.

**Ce n'est pas un défaut d'implémentation, c'est une conséquence structurelle de
l'interception réseau.** Tout ce qui est piloté par l'interface du jeu plutôt que
par le flux échappe à OMNI.

## Portée probable

Le même symptôme est attendu sur **l'acceptation d'échange**, qui injecte de la
même façon. Non vérifié à ce jour.

## Ce que coûterait une correction

Le proxy sait déjà transformer le flux descendant, c'est la machinerie du
no-anim : injecter une trame **vers le client** est donc architecturalement
possible. Reste à savoir laquelle ferme le panneau, ce qui ne se devine pas.

La mesure à faire, dans l'esprit de celle du 20/08 :

1. instrumentation temporaire journalisant les types de trames entrantes chez un
   invité ;
2. une invitation acceptée **à la main**, relever ce qui arrive ;
3. une invitation acceptée **par OMNI**, relever ce qui arrive ;
4. comparer les deux listes.

**Un type présent seulement dans le cas manuel** est la trame cherchée, et on
l'injecte vers le client.

**Deux listes identiques** signifient que la fermeture est purement locale au
client, et alors **aucune injection ne la refermera**. Ce cas est possible et il
n'aurait pas de solution propre. C'est la raison principale du report : le
travail peut se terminer sur une impasse, pour un défaut cosmétique.
