# Le garde combat annule sur la liste des combattants, pas sur `ieb`

**Date :** 2026-09-02
**Défaut corrigé :** le garde coupait les rejeux des mules alors qu'aucun combat
n'avait lieu. Rapporté par Ilan (« 3 rejeux en attente annulés »), reproduit et
mesuré le jour même.

## Le défaut

`src/garde-combat.js` annulait les rejeux en attente sur un `ieb` entrant chez
le maître. `ieb` n'a jamais été identifié : il avait été retenu sur une
corrélation du 28/08 — 6 des 58 changements de carte d'un journal en portaient
un, et c'étaient les 6 entrées en combat de quête.

Le spec de l'époque écrivait le risque en toutes lettres
(`2026-08-28-garde-combat-design.md:55`) :

> **Ce qui n'est pas établi** […] : que `ieb` couvre toutes les façons d'entrer
> en combat, et qu'il ne se déclenche jamais ailleurs. Huit occurrences, une
> session, un type de quête.

Les deux moitiés sont tombées :

- **01/09 :** `ieb` n'existe pas sur une attaque ordinaire
  (`plans/2026-09-01-abandon-groupe.md:35`). C'est ce qui a fait basculer
  l'**apprentissage** vers `kmk`. L'annulation, elle, n'avait pas été touchée.
- **02/09 :** `ieb` arrive **sans aucun combat**.

## Ce qu'est `ieb`, mesuré le 02/09

Deux captures du même compte, la même session, une avec combat et une sans :

| Contexte | Trame |
|---|---|
| Ramassage (`iwo`), **aucun combat** | `ieb { 1=1639 2=9815 }` |
| Combat de quête (`ioy 25088`) | `ieb { 1=1642 2=9828 }` |
| Combat de quête du **28/08**, même étape | `ieb { 1: 1642, 2: 9828 }` |

Les valeurs du 28/08 et du 02/09 sont **identiques sur la même étape de quête**,
à cinq jours d'écart. Ce ne sont donc pas des compteurs qui montent — la note
« champ 2 incrémenté d'un combat à l'autre » du 28/08 était une sur-lecture.
Ce sont des **identifiants de progression de quête**.

`ieb` dit « une étape de quête vient d'avancer ». Cela coïncide parfois avec un
combat, souvent non. Le garde en faisait un signal d'entrée en combat.

**Le dégât :** un `iwo` ou un `ioy` est retenu 250 ms avant d'être rejoué
(`DELAI_PLANCHER_MS`). `ieb` tombe à +29 ms. Toute progression de quête coupait
donc les rejeux en attente de toutes les mules — sur une simple récolte.

## Le signal retenu : `kmk`, la liste des combattants

Mesure du 02/09, capture `journal-dev.log`, combat de quête :

```
4386485 ms  --> request ioy { 1=25088 }                        l'action du maitre
4386514 ms  <-- event   ieb { 1=1642 2=9828 }                  +29 ms  (quete)
4386546 ms  <-- event   kmk { …{3=676990615846} …{3=-1} }      +61 ms  LE SIGNAL
```

**61 ms.** Le premier rejeu d'un type sensible part au plus tôt à
`DELAI_PLANCHER_MS + minMs` = 250 + 16 = **266 ms**
(`superviseur.rejouer()` recule tous les esclaves du plancher puis leur ajoute
l'étalement). La marge est de **plus de 200 ms**, soit un facteur 4.

Le chiffre de 4,6 s relevé le 01/09 (`hqa` à 82810 ms, `kmk` à 87463 ms) vaut
pour une **attaque ordinaire**, qui passe par une phase d'approche et de
placement. Un combat de quête démarre immédiatement. Les deux mesures ne se
contredisent pas : elles portent sur deux façons différentes d'entrer en combat.

`kmk` est déjà en production depuis le 01/09 : `combattantsDe()` de
`src/abandon-combat.js` le reconnaît comme liste **de combat** — et non de
carte — à la présence d'au moins un identifiant négatif, c'est-à-dire un
monstre. Vérifié en jeu deux fois. Le garde réutilise cette fonction telle
quelle : un seul critère, un seul endroit.

Dans la mesure ci-dessus, la première `kmk` de la rafale ne porte que le maître
et serait rendue `null` ; les deux suivantes, **à la même milliseconde**,
portent `3=-1`. Le +61 ms tient.

## Ce qui change

1. **L'annulation** se déclenche sur une `kmk` entrante chez le maître
   reconnue comme liste de combat, au lieu d'un `ieb` entrant.
2. **La fermeture du dialogue des esclaves disparaît.** Demandée par
   l'utilisateur : une mule dont le rejeu a été annulé n'a jamais ouvert le
   dialogue, et celle qui l'a ouvert peut le garder. Partent avec elle
   `TRAME_FERMER_DIALOGUE`, `FENETRE_DIALOGUE_MS`, le suivi `dernierDialogue`
   et le seul appel du garde à `superviseur.emettre()`.
3. **`TYPE_ENTREE_COMBAT` disparaît.** Plus aucun code ne nomme `ieb`.

## Ce qui ne change pas

- **Le plancher de 250 ms** et les trois types sensibles (`iov`, `ioy`, `iwo`).
  La marge mesurée les valide ; les allonger n'apporterait rien.
- **L'apprentissage** — une mule reçoit une `kmk` sans le maître — et la liste
  apprise du duplicateur, qui refuse d'emblée une action connue.
- **`onAnnulation`**, et le message du pied de page. Il devient vrai.
- **`superviseur.annulerRejeux()`**, dont le garde reste le seul appelant.

## Ce que ça vaut

Le garde n'invente plus. Il n'a plus qu'un seul signal, mesuré deux fois en jeu,
partagé avec l'abandon en groupe. Une progression de quête sans combat ne coupe
plus rien.

**Le cas imparfait qui subsiste, accepté :** un monstre qui agresse le maître
pendant les 250 ms d'attente annule un rejeu sans rapport. La mule perd cette
action. C'est rare, sans dégât durable, et c'était déjà le comportement.
