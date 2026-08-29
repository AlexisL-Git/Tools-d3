# Rejoindre le songe du maître — design

**Date :** 2026-08-29
**État :** validé par l'utilisateur, prêt pour le plan d'implémentation

## Le besoin

Quand l'utilisateur lance un Songe, ses mules doivent le rejoindre toutes seules — et
**seulement** sur son invitation à lui, jamais sur celle d'un inconnu.

Demande initiale, en deux morceaux : (1) que les mules entrent dans la zone de lancement
avec le maître, (2) qu'elles acceptent l'invitation aux Songes des seuls comptes liés au
launcher Ankama.

## Ce que la mesure a établi

Session du 29/08 à 20:23, deux clients attachés, capture complète
(`OMNI_JOURNAL=complet` + `OMNI_CAPTURE=1`). Maître `26708`, mule `7544` :

```
1085134ms [26708] --> iwo { 1=20743 2=539616 }   le maître entre dans la zone
1085133ms [7544]  rejeu iwo refuse : manque skillInstanceUid pour l'élément 539616
                                                  LA MULE N'ENTRE PAS

1088169ms [26708] --> ixf { 1={…} }               le maître lance le songe
1088203ms [26708] <-- jru { 2=237897728 }         il arrive dans le songe
1088203ms [7544]  <-- iyd { 1=<2o> 2=-300 }       l'invitation arrive chez la mule

1097980ms [7544]  --> ixk { 1=1 }                 acceptation, à la main
1098010ms [7544]  <-- jru { 2=237897728 }         LA MULE ARRIVE DANS LE MÊME SONGE
```

Quatre faits en découlent :

1. **La mule n'est jamais entrée dans la zone** et a quand même rejoint le songe. Le
   premier morceau de la demande est donc **sans objet**.
2. **L'acceptation est `ixk { 1=1 }`** — un seul champ, valeur constante. Rien à recopier,
   rien à reconstruire : le cas de `TRAME_PASSE` et de l'acceptation d'échange.
3. **L'invitation `iyd` arrive 34 ms après le `ixf` du maître.** Cet enchaînement est ce
   qui porte le filtre (voir plus bas).
4. La mule atterrit sur **la même carte que le maître** (`237897728`), sans que rien
   d'autre ne soit envoyé.

## Ce qui est écarté, et pourquoi

**Faire entrer les mules dans la zone.** Mesuré inutile : l'acceptation les téléporte.
Le `iwo` refusé (la mule n'a pas appris son propre `skillInstanceUid` pour l'élément
539616) reste un défaut réel, mais il ne concerne pas cette fonction.

**Envoyer la touche T aux clients.** Proposé par l'utilisateur, écarté après vérification.
L'agent d'OMNI (`src/il2cpp/connectAgent.js`) sait mettre une fenêtre au premier plan et
**lire** l'état des boutons de souris ; il ne sait pas **émettre** d'entrée clavier. Sous
Unity, une touche postée à une fenêtre en arrière-plan est ignorée : il faudrait mettre
chaque client au premier plan à tour de rôle, ce qui vole le focus de l'utilisateur.
Ce que la touche T produit est une trame — `ixk { 1=1 }` — et l'envoyer directement est
plus simple, instantané, et fonctionne fenêtre minimisée. L'utilisateur a validé ce
changement de couche.

**Décoder l'intérieur de `iyd`.** Le champ 1 fait 2 octets, trop peu pour un identifiant
de personnage (celui du maître vaut `676438999334`). L'invitation ne semble donc pas
nommer l'invitant. Le filtre retenu n'en a pas besoin : on ne décode pas ce qu'on
n'utilise pas.

## Le filtre : « pas d'inconnus », sans lire qui invite

Une invitation destinée à une mule est **toujours** précédée, de quelques dizaines de
millisecondes, du `ixf` d'un client piloté par OMNI. Celle d'un inconnu ne l'est jamais.

**Règle :** une invitation n'est acceptée que si un client piloté par OMNI a émis `ixf`
depuis moins de `FENETRE_SONGE` millisecondes.

C'est le même esprit que `src/invitation.js` et `src/echange.js`, qui n'acceptent que ce
qui vient d'un autre client de l'application. La différence est que le lien passe ici par
le **temps** plutôt que par un identifiant présent dans la trame.

## Architecture

**Un module, `src/songes.js`**, sans dépendance à Electron, Frida ni au système — testable
avec un double du superviseur, comme `invitation.js`, `echange.js` et `passeur.js`.

```
creerAccepteurSonge({ superviseur, reglages, onCompteRendu, delai, alea, planifier })
  -> onTrame({ pid, dir, frame })
```

Constantes du module :

| nom | valeur | rôle |
|---|---|---|
| `TYPE_LANCEMENT` | `'ixf'` | requête sortante : un de nos clients lance un songe |
| `TYPE_INVITATION` | `'iyd'` | événement entrant : l'invitation reçue par la mule |
| `URL_ACCEPTATION` | `type.ankama.com/ixk` | la requête d'acceptation |
| `TRAME_ACCEPTATION` | constante | `ixk { 1: 1 }`, construite une fois par `encodeRaw` |
| `TYPE_ACCEPTATION` | `'ixk'` | requête sortante : un de nos clients rejoint (ou accepte) un songe |
| `FENETRE_SONGE` | 2 000 ms | durée de validité d'un `ixf`/`ixk` pour autoriser une acceptation |
| `DELAI_REACTION` | 150–600 ms, **redéfini** dans `songes.js` | délai de réaction humaine |

`FENETRE_SONGE` valait 10 000 ms, large devant les 34 ms mesurés. **Révisée à 2 000 ms**
(décision utilisateur du 29/08, après la première mesure en jeu) : le songe est une
activité de **groupe** — si un autre joueur lance son propre songe peu après le nôtre, la
trame d'acceptation `ixk { 1: 1 }` ne désigne aucune invitation en particulier et
accepterait la sienne à la place. 2 000 ms laisse encore 60 fois la marge mesurée tout en
réduisant d'autant ce risque de collision.

`DELAI_REACTION` n'est **pas** réutilisé de `echange.js` : `songes.js` le redéfinit
localement, à l'identique (150–600 ms), pour ne pas dépendre d'un autre module de
politique.

## Flux

1. `ixf` **ou `ixk`** sortant d'un client piloté → on note l'instant, pour n'importe lequel
   de nos clients : c'est l'application qui pilote, la notion de maître n'entre pas ici.
   **`ixk` arme aussi** (ajout du 29/08, décision utilisateur) : REJOINDRE le songe d'un
   autre ne passe pas par `ixf` — seul celui qui LANCE l'émet — donc sans cette entrée, les
   mules d'un utilisateur qui rejoint (plutôt que lance) un songe refuseraient toujours de
   le suivre. Pas de risque de boucle : les trames qu'OMNI injecte via
   `superviseur.emettre()` sont écrites directement sur la socket amont et ne repassent pas
   par l'écoute qui alimente `onTrame`.
2. `iyd` entrant sur un client :
   - réglage éteint → **refus explicite** `songe ignoré : interrupteur éteint`. Corrigé
     après relecture : `src/echange.js` rend bien un refus dans ce cas, et la règle du
     projet est qu'aucun chemin ne mène au silence ;
   - compte inconnu du superviseur → **refus**, `songe ignoré : compte inconnu du
     superviseur` ;
   - aucun `ixf`/`ixk` récent → **refus**, compte rendu `songe refusé : aucun lancement de
     songe par nos clients` (le code dit bien *refusé*, pas *ignoré* : c'est une décision
     active, pas un silence) ;
   - sinon → on planifie l'envoi de `TRAME_ACCEPTATION` après un tirage dans `DELAI_REACTION`.
3. À l'échéance, on relit l'état : réglage toujours actif, client toujours présent, et
   **identité de l'objet d'état inchangée** — même garde que `src/echange.js` et
   `src/passeur.js`, parce que Windows peut réattribuer un pid à un autre client Dofus
   entre l'armement et l'échéance.
4. `superviseur.emettre(pid, trame)`, puis compte rendu.

## Erreurs et silences

Aucun chemin ne mène au silence, sauf le réglage éteint. Un refus est toujours rendu par
`onCompteRendu` avec sa raison, affichée sur la ligne du compte dans le panneau et
journalisée sous `OMNI_JOURNAL=complet`. C'est le mode d'échec le plus coûteux du projet
— une chose qui « ne fait rien » sans que rien ne le relie à sa cause — et il s'est déjà
présenté quatre fois.

**Le compte rendu passe par la Map `messages`** (`desktop/main.js`), pas seulement par
`journal()` — qui ne s'écrit que sous `OMNI_JOURNAL=complet`, donc jamais en usage normal.
Sur refus, `messages.set(pid, raison)` ; sur succès, `messages.delete(pid)`. C'est cette Map
qui s'affiche sur la ligne du compte dans le panneau ; les deux canaux sont complémentaires.
Elle est partagée avec le duplicateur (rejeu) : un refus de songe peut donc écraser
brièvement un refus de rejeu affiché sur la même ligne, accepté parce que les songes sont
rares.

## Interface

**Pas d'interrupteur propre.** Corrigé après relecture du code : `desktop/main.js:246-252`
documente la suppression délibérée des interrupteurs par fonction — « ils formaient un
second niveau que rien ne reliait aux cases par compte, et une case cochée sous un général
éteint ne faisait rien sans que ça se voie ». Un interrupteur **unique** (`appliquerActif`)
pilote déjà les quatre autres politiques ; celle-ci le suit.

Concrètement : un réglage `reglagesSonge = { actif: false }` posé avant la fenêtre, mis à
jour par `appliquerActif`, et la politique composée dans `superviseur.onTrame` via
`composer()`. Aucune case par compte : l'utilisateur veut que **toutes** ses mules
rejoignent, pas les choisir une par une.

## Tests

Dans `test/songes.test.js`, avec le double de superviseur des tests existants :

1. une invitation précédée d'un `ixf` de nos clients est acceptée ;
2. une invitation **sans** `ixf` récent est refusée, avec sa raison ;
3. une invitation dont le `ixf` date de plus de `FENETRE_SONGE` est refusée ;
4. réglage éteint : rien n'est émis, aucun compte rendu ;
5. la trame émise est bien `ixk { 1: 1 }`, vérifiée octet pour octet ;
6. le délai tiré tombe dans `DELAI_REACTION` ;
7. le client fermé entre l'armement et l'échéance ne reçoit rien ;
8. un pid réattribué à un autre client entre l'armement et l'échéance ne reçoit rien.

## Risques ouverts

**`iyd` est supposée être l'invitation.** C'est le seul événement nouveau reçu par la mule
avant qu'elle accepte, mais l'hypothèse n'a pas été vérifiée en la provoquant deux fois.
Le premier essai en jeu tranchera : si aucune acceptation ne part, c'est que le
déclencheur est ailleurs.

**Collision improbable.** Si l'utilisateur lance un songe dans la même fenêtre de
`FENETRE_SONGE` qu'un inconnu invitant une de ses mules, la mule pourrait accepter la
mauvaise invitation. Accepté en connaissance de cause.

**`ixk` émis sans invitation en attente** est sans effet : le serveur ignore. Le coût d'un
faux positif est donc nul côté jeu.

## Vérification

Comme pour l'achat au marchand : la preuve est **en jeu**, pas dans les tests. Lancer un
songe avec la capture active et vérifier que chaque mule émet `ixk` puis reçoit
`jru { 2=<carte du songe> }` — l'arrivée, côté serveur, sur la carte du maître.
