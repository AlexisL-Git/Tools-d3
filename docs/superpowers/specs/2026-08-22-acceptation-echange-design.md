# Acceptation automatique de l'échange

**Date :** 2026-08-22
**Statut :** conçu et validé, non implémenté. **La mesure des trames est un préalable, pas une étape parmi d'autres.**

## Le besoin

Le maître lance un échange à un esclave. L'esclave accepte seul, puis attend
que le maître valide pour valider à son tour. Aujourd'hui il faut cliquer deux
fois sur la fenêtre de chaque esclave, ce qui annule l'intérêt du multicompte
dès qu'on transfère quoi que ce soit à plus d'un personnage.

Cinquième fonction de l'application, après le Replicate, le passe-tour,
l'acceptation d'invitation de groupe et le no-anim.

## Ce qu'on ne sait pas

**Aucune trame d'échange n'a jamais été mesurée.** Le spec d'invitation du
20/08 avait écarté l'échange explicitement : « d'autres messages, d'autres
conséquences en jeu, et rien ne dit que le même filtre convienne ». Cette
phrase reste vraie ; ce document ne la contredit pas, il organise sa levée.

On ignore donc :

- le type de la proposition entrante et de l'acceptation sortante ;
- quel champ porte le proposant ;
- **s'il existe un événement « l'autre a validé »** ;
- comment un échange se termine.

Rien de tout cela ne se devine. Les 1414 `.proto` de `.cache\game\` sont
périmés face au client 3.6.10.10 et inutilisables. La seule source est le
trafic réel.

## Périmètre

**Dedans :** accepter la proposition d'échange venue d'un autre de nos
clients, puis émettre la validation en réaction à celle du partenaire.

**Dehors :** déposer des objets ou des kamas, choisir quoi échanger, les
échanges avec un PNJ ou un étal, l'ouverture d'un échange (c'est toi qui le
lances, depuis le maître). L'esclave ne dépose jamais rien de lui-même : par
construction, cette fonction ne peut que faire **recevoir** un esclave.

## Décisions prises

### La validation du maître est le signal « c'est bon »

L'esclave valide dès que le partenaire a validé, sans délai ni condition sur
le contenu. Il n'y a pas de cas d'accident à protéger : rien ne part tant que
l'utilisateur n'a pas coché sur le maître, et c'est lui qui décide du moment.
Si le contenu change après validation, Dofus remet les deux coches à zéro et
la séquence recommence d'elle-même — aucun état à maintenir de notre côté pour
ce cas.

### Le filtre : un autre de nos clients, pas seulement le maître

Le proposant doit être un **autre** client piloté par l'application, reconnu
par son `characterId` appris du trafic. Même règle que l'acceptation
d'invitation de groupe.

Filtrer sur le seul maître aurait été plus proche de la formulation d'origine,
mais le maître est le client qui a le focus : si le focus bouge entre la
proposition et l'arrivée de la trame, l'échange serait refusé sans raison
visible. Le filtre retenu couvre en prime un échange esclave↔esclave.

**Sans filtre du tout, la fonction serait un vol en un clic** : n'importe quel
joueur ouvrant un échange avec un esclave le verrait valider dès qu'il coche.

### Cinquième interrupteur, fenêtre élargie

Un bouton `ÉCHANGE` dans l'en-tête et une case par compte, comme les quatre
autres fonctions. La fenêtre passe de 720 à **820 px** de large : l'en-tête est
déjà plein avec quatre boutons, le délai et le résumé.

## La mesure, préalable

Deux passes, avec l'instrumentation retirée en `49d5889` — la restaurer, c'est
inverser ce commit.

**Passe 1, découverte.** `typesInedits()` seul : premier exemplaire de chaque
`sens + type`, par client. Un échange complet mené à la main donne la liste des
types candidats.

**Passe 2, octets.** `octetsDesTrames()` restreint aux types repérés, **avec
une modification : journaliser chaque occurrence, pas seulement la première.**
La validation est un événement qui se répète, et c'est sa répétition qu'on veut
observer.

### Les quatre questions auxquelles la séance doit répondre

1. Quel type porte la proposition reçue par l'esclave, et quel champ porte le
   proposant ?
2. Quel type porte l'acceptation sortante, et que doit-elle recopier de la
   proposition ?
3. **Existe-t-il un événement « l'autre a validé » ?** C'est la question qui
   décide de la forme du module.
4. Que se passe-t-il quand le contenu change après validation ?

### Le protocole d'essai

**Trois passages minimum, dans les deux sens.** Ce n'est pas une précaution de
style : le projet a payé deux fois en deux jours la règle tirée d'un seul
échantillon (le champ 1 de `ijz`, puis la case recopiée du champ `7.6` d'un
`jwe` — vraie sur un échantillon, fausse sur quinze).

**Le piège nommé.** Pour l'invitation de groupe, l'ordre des champs suggérait
que le champ 1 portait l'invitant ; il portait le destinataire. Un filtre bâti
dessus aurait comparé notre propre identifiant, l'aurait toujours trouvé, et
aurait accepté **toutes** les invitations — en passant l'essai en jeu sans
broncher. L'échange a le même piège symétrique. La preuve se fait en croisant
les deux sens : **le champ qui bascule quand on inverse les rôles est le
proposant.**

**Quatrième passage, recommandé :** un échange proposé par un joueur tiers. Les
trois premiers trouvent toujours le filtre satisfait et ne le testent donc pas.

**Conditions matérielles :** deux clients lancés **après** l'application — un
client déjà connecté est irrattrapable — et sur la même carte.

**Livrable :** `docs/superpowers/specs/2026-08-22-trames-echange.md`, sur le
modèle de `2026-08-20-trames-invitation-groupe.md` : séquence, tableau des
champs, octets bruts complets, et les preuves du champ « proposant ».

## Architecture

`src/echange.js`, calqué sur `src/invitation.js` : traduction pure, sans
Electron ni Frida ni système, testé avec un double du superviseur. Une
politique `onTrame` composée dans `superviseur.onTrame` à côté des quatre
autres.

Deux réactions, un seul filtre :

```
in  <proposition> d'un autre de nos clients  →  out <acceptation>
in  <l'autre a validé>                        →  out <validation>
```

### La forme dépend de la réponse à la question 3

**Cas favorable — l'événement de validation porte l'identifiant du
partenaire.** Le module est sans état : deux traductions pures, le même filtre
appliqué deux fois. Il ressemble alors trait pour trait à `invitation.js`.
**C'est le cas pour lequel on conçoit.**

**Cas défavorable — il ne le porte pas.** Il faut retenir par client « échange
en cours accepté avec X », posé à l'acceptation et effacé à la fermeture de
l'échange. Un état par compte, pas une machine à états. Il exige alors d'avoir
mesuré **comment un échange se termine** : sans quoi l'état fuit, et un échange
ultérieur avec un inconnu hérite de l'autorisation. C'est la collision d'état
déjà corrigée dans le no-anim, où `conn.id` repartait à 1 pour chaque compte.

L'écart entre les deux formes est d'une vingtaine de lignes et d'un test de
non-fuite. Il ne justifie pas d'attendre pour concevoir le reste.

### Ce qu'on ne généralise pas

`creerAccepteur` (groupe) et le nouveau module partagent visiblement leur
filtre. On ne les fusionne pas maintenant : le groupe a un flux en un temps,
l'échange en deux, et on ne saura ce qui est réellement commun qu'une fois les
deux écrits. L'extraction se fera le jour où elle se voit, sur une dizaine de
lignes.

## Branchement

Reproduit les quatre existants à l'identique.

| couche | ajout |
|---|---|
| `src/protocol/compte.js` | `this.accepteEchange = false` |
| `src/comptes/favoris.js` | `marquerEchange` / `echangeActif` |
| `src/comptes/vue.js` | ensemble `echange` → champ de ligne |
| `desktop/main.js` | `reglagesEchange`, resynchro par tick, 2 IPC |
| `desktop/preload.js` | `basculerEchange`, `basculerEchangeCompte` |
| `desktop/index.html` | 5ᵉ bouton, 5ᵉ case, icône, fenêtre à 820 px |

### Trois pièges de ce chemin, déjà payés

1. **La case par compte codée en dur à faux dans les lignes de repli de
   `vue.js`.** Rencontré **trois fois** — passe-tour, invitation, no-anim. La
   case s'affiche éteinte alors que la fonction agit, donc impossible à
   débrayer. Toutes les lignes passent par ce repli si `lireComptes()` échoue.
2. **L'interrupteur général recalculé à chaque tick depuis les cases par
   compte.** Le bouton `ANIM` ne commandait rien : `envoyerEtat()` écrasait son
   drapeau. L'interrupteur général doit être mis à jour par l'IPC seul.
3. **La resynchronisation depuis `favoris.json`** dans `envoyerEtat()` et dans
   `balayerProcess()` doit couvrir le nouveau champ, sinon un compte relancé
   repart à faux.

## Gestion d'erreur

Tout refus est explicite et remonte sur la ligne du compte, comme pour
l'invitation : « interrupteur éteint », « acceptation éteinte pour ce compte »,
« proposant inconnu de l'application », « pas de socket amont ». Un échange est
un événement rare ; dire pourquoi on ne l'accepte pas ne coûte rien et répond à
la seule question que l'utilisateur se posera.

Une politique qui lève doit se voir : `composer()` route déjà les exceptions
vers `onErreur`, et aucun chemin ne mène au silence.

## Tests

`test/echange.test.js`, sur le modèle de `test/invitation.test.js` :

- les octets de l'acceptation et de la validation, **vérifiés à l'octet près
  contre la mesure** ;
- le filtre accepte un autre de nos clients, dans les deux sens ;
- le filtre refuse un proposant inconnu ;
- refus quand l'interrupteur général est éteint, quand la case du compte est
  éteinte, quand le compte est inconnu du superviseur, quand la trame ne porte
  pas le champ attendu ;
- la validation ne part que sur l'événement du partenaire, jamais sur
  l'acceptation seule ;
- si l'état s'avère nécessaire : deux échanges successifs, le second avec un
  inconnu, pour prouver que l'autorisation ne fuit pas.

Les trames de test se construisent avec `encodeRaw` : une trame protobuf
tronquée à la main ne se décode pas, et le test croit alors vérifier « autre
type de trame » alors qu'il vérifie « trame indécodable ».

Rappel de codec : `decodeRaw` **devine** le type d'un champ LEN. Lire les
octets bruts via le champ `raw`, jamais se fier au `kind`.

## Critères de réussite

1. Le maître lance un échange à un esclave : la fenêtre s'ouvre des deux côtés
   sans aucun clic sur l'esclave.
2. Le maître valide : l'esclave valide dans la foulée, l'échange se conclut.
3. Le maître modifie le contenu après validation, puis revalide : la séquence
   recommence et se conclut.
4. Un joueur tiers ouvre un échange avec un esclave : rien n'est accepté, et la
   ligne du compte dit pourquoi.
5. Interrupteur général éteint, ou case du compte décochée : rien ne part.
6. La suite de tests passe et imprime son total.
