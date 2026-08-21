# Acceptation automatique des invitations de groupe

**Date :** 2026-08-20
**Statut :** implémenté et validé en jeu le 2026-08-21. B accepte seul
l'invitation de A quand son interrupteur est coché, et l'ignore quand il ne
l'est pas — vérifié dans le jeu, pas seulement au journal.

**Les deux trames, mesurées** (détail et octets bruts dans
`2026-08-20-trames-invitation-groupe.md`) :

```
in  event   ijz { 1: nous, 2: invitant, 3: 8, 5: idGroupe, 6: 1, 7: nom }
out request ijx { 1: idGroupe }
```

L'acceptation **n'est pas constante** : elle recopie l'identifiant de groupe du
champ 5 de l'invitation. `src/invitation.js` la construit trame par trame.
L'invitant est au **champ 2** ; le champ 1 porte le destinataire, c'est-à-dire
nous — un filtre bâti dessus aurait accepté toutes les invitations, inconnus
compris, en passant l'essai en jeu sans broncher.

## Le besoin

Inviter un de ses personnages dans son groupe, depuis un autre de ses comptes,
et qu'il accepte sans qu'on ait à basculer sur sa fenêtre. C'est une des
fonctions du launcher de krm35.

Le geste réel : depuis le client A, on invite le personnage B ; le client B
reçoit une invitation ; aujourd'hui il faut aller cliquer « accepter » sur B.
Après cette fonction, B accepte seul.

## Périmètre

Les invitations de **groupe**, et elles seules. Guilde, alliance, échange et
défi sont hors périmètre : ce sont d'autres messages, d'autres conséquences en
jeu, et rien ne dit que le même filtre convienne.

## Ce qui déclenche l'acceptation

**Seules les invitations émises par un compte que l'application pilote.**

L'application connaît le `characterId` de chaque client attaché — il est appris
dès la connexion sur la requête sortante `kvw`, champ 1
(`src/protocol/compte.js`). L'accepteur compare l'invitant à ces
identifiants-là. Une invitation venue de n'importe qui d'autre est refusée, et
le refus est journalisé avec sa raison.

Ce filtre a été préféré à deux autres :

- **tout accepter** — le plus simple, aucune identification nécessaire, mais
  n'importe quel joueur peut alors faire rejoindre son groupe à un compte dont
  l'interrupteur est actif ;
- **n'accepter que du maître** — plus strict encore, mais cassé dès qu'on
  invite depuis un autre client que celui marqué maître, ce qui arrive.

**Hypothèse à vérifier à la mesure :** que la trame d'invitation porte de quoi
identifier l'invitant. Si elle ne porte qu'un nom de personnage plutôt qu'un
`characterId`, le filtre compare au nom, connu par la liste des comptes
(`src/comptes/clients.js`). Si elle ne porte rien d'exploitable, la fonction
n'est pas livrable telle quelle et la question du filtre est rouverte — ce
n'est pas un détail d'implémentation, c'est la condition de la fonction.

## Étape 1 — la mesure, avant toute politique

Les types de messages sont obfusqués sur trois lettres (`jxy`, `jxz`, `jss`…)
et aucune liste à jour n'existe : les 1414 `.proto` de `.cache\game\` sont
périmés face au client 3.6.10.10. Les deux trames doivent donc être mesurées.

**Instrumentation temporaire** dans `desktop/main.js` : journaliser, par
client, tout type de trame **jamais vu jusque-là**, dans les deux sens, avec
ses champs décodés. Un événement rare ressort du bruit sans avoir à tout
journaliser — c'est la propriété qui manquait aux sessions précédentes, où
trente lignes par manche noyaient l'information.

**Protocole de mesure :** deux clients attachés, l'app lancée **avant** eux.
Inviter B depuis A, accepter à la main sur B. Deux types neufs apparaissent :

- l'**invitation**, entrante chez B ;
- l'**acceptation**, sortante de B.

Recommencer une seconde fois : ce qui varie entre les deux mesures est un
identifiant, ce qui ne varie pas est constant. C'est la méthode qui a livré
`jxy` (deux clics sur « Passer », octets identiques, donc trame constante).

Les octets sont ensuite verrouillés par un test, comme
`test/passeur.test.js` le fait pour `TRAME_PASSE`.

## Architecture

`src/invitation.js`, jumeau de `src/passeur.js` :

```js
creerAccepteur({ superviseur, reglages, onCompteRendu }) → onTrame({ pid, dir, frame })
```

Ne dépend ni d'Electron, ni de Frida, ni du système : il se teste avec un
double du superviseur, comme le passeur.

Il est composé dans `superviseur.onTrame` par `composer()`, aux côtés du
Replicate et du passe-tour. `src/passeur.js` n'est pas touché : il vient d'être
validé en combat réel.

**Enchaînement, sur une trame entrante du type invitation :**

1. gardes — interrupteur général `reglages.actif`, compte connu du superviseur,
   `etat.accepteInvitation` ;
2. filtre — l'invitant est-il l'un de nos clients ? La liste vient de
   `superviseur.comptes.tous`, en excluant le pid destinataire ;
3. construction de la trame d'acceptation, puis `superviseur.emettre(pid, octets)` ;
4. compte rendu, toujours.

**Point de branchement, tranché par la mesure.** Si l'acceptation ne porte
aucun champ, c'est une constante construite une fois pour toutes, comme
`TRAME_PASSE`. Si elle porte un identifiant (de groupe, ou d'invitation), il
est recopié depuis l'invitation. Les deux cas passent par la même signature,
puisque le module reçoit la trame d'invitation.

**Aucun chemin ne mène au silence.** C'est le mode d'échec le plus coûteux du
projet — il s'est présenté quatre fois, toujours sous la forme d'un silence
indiscernable d'une absence d'activité. Chaque refus produit un compte rendu
portant sa raison, remonté au journal et à la vue.

## État et persistance

`EtatCompte.accepteInvitation`, booléen, faux par défaut, jumeau de
`passeTour` : indépendant de `exclu` et de `passeTour`. Un compte peut accepter
les invitations sans suivre le maître, et l'inverse.

Dans `favoris.json`, une liste `invitation` de plus, à côté de `favoris` et
`passeTour` : que des identifiants numériques de compte. Rien qui pose problème
si le fichier est partagé. `Favoris` gagne `invitationActive(id)` et
`marquerInvitation(id, actif)`, sur le modèle exact de `marquerPasseTour`.

Le réglage survit au redémarrage de l'application comme à celui d'un client :
un compte relancé retrouve son interrupteur.

## Interface

- **Bouton global `GROUPE`** dans l'en-tête, à côté de `PASSE-TOUR`, même
  bascule verte quand il est actif. Coupe-circuit immédiat.
- **Un interrupteur par ligne**, icône deux personnes : SVG au trait,
  `currentColor`, sans fichier ni dépendance, à la même facture que
  `ICONE_REPLICATE` et `ICONE_PASSE`.
- Désactivé quand `l.suivi` est faux, comme les deux autres — un interrupteur
  actionnable sur un client injoignable est une promesse fausse.

Deux ordres IPC de plus, chacun validé côté `main.js` :
`basculerInvitation(actif)` et `basculerInvitationCompte(idCompte, actif)`.
Le préambule de `desktop/preload.js` annonce le nombre d'ordres exposés : il
passe de six à huit, et le commentaire doit suivre.

## Erreurs

| situation | conduite |
|---|---|
| invitant inconnu de l'app | refus journalisé, avec le nom ou l'identifiant vu |
| compte inconnu du superviseur | refus journalisé |
| interrupteur éteint (général ou compte) | refus journalisé, une ligne par invitation |
| socket amont fermée | `emettre` rend `{ ok: false, raison }`, remonté à la vue |
| exception dans la politique | attrapée par `composer`, signalée à `onErreur` |

## Tests

`test/invitation.test.js`, double du superviseur comme `test/passeur.test.js` :

- les octets exacts de la trame d'acceptation, verrouillés sur la mesure ;
- une invitation d'un de nos comptes déclenche une acceptation ;
- une invitation d'un tiers ne déclenche rien, et le dit ;
- chaque garde bloque et le dit : interrupteur général, compte inconnu,
  interrupteur du compte ;
- deux comptes sont indépendants ;
- un échec d'émission est signalé sans exception ;
- si la mesure révèle un identifiant à recopier : il est bien repris de
  l'invitation, et une invitation qui ne le porte pas est refusée plutôt
  qu'acceptée à l'aveugle.

## Critère de réussite

Deux clients attachés, l'interrupteur `GROUPE` actif sur B. On invite B depuis
A : B rejoint le groupe sans qu'on touche à sa fenêtre. Vérifié en jeu, pas
seulement au journal — la leçon du passe-tour est qu'un journal vert et un
effet en jeu sont deux choses distinctes.
