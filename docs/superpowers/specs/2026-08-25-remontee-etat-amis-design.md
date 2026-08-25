# Remontee d'etat des amis — conception

Date : 2026-08-25
Etat : concu, non implemente

## Le probleme

Le service de mise a jour sait **envoyer**, il ne sait pas **ecouter**. Deux
angles morts, tous deux du meme motif : une panne qui se manifeste par un
silence, indiscernable du succes.

1. **On publie a l'aveugle.** `amis` ne porte qu'un `derniere_vue`. Apres un
   clic sur `activer`, rien ne dit qui a pris la nouvelle version et qui est
   reste en arriere faute d'avoir relance.
2. **Un plantage chez un ami est invisible.** L'amorceur ecarte tout seul une
   version qui n'a jamais atteint son etat pret (`depot.choisirVersion()`,
   temoin d'essai). L'ami est protege — mais l'information meurt dans son
   `amorceur.log`. On croit avoir publie alors que tout le monde est revenu en
   arriere.

## Ce qu'on construit

Un canal de retour, de l'ami vers le service : **une requete par lancement**,
qui porte la version reellement chargee et les refus en attente. Le panneau
l'affiche, un webhook Discord previent des refus.

## Ce qu'on ne construit PAS

- **Aucun retour arriere automatique.** Le service previent, l'utilisateur
  decide. Chaque ami est deja protege par son propre retour arriere local ;
  un automatisme global deciderait a sa place sur la foi d'une machine
  peut-etre isolee.
- Pas de suppression manuelle des refus : l'alerte s'eteint d'elle-meme quand
  la version fautive n'est plus la version active.
- Pas de deploiement canari (une version pour un seul ami). Sujet distinct.

## Contraintes

- **Rien ne doit jamais empecher un ami de demarrer.** L'appel de retour a un
  delai court, ses echecs sont avales, il n'est jamais reessaye dans la foulee.
  Meme regle que l'etat `injoignable` du canal existant.
- **Garde 404 partout.** Sans cle valide, ou cle revoquee : 404, corps vide.
  Jamais 401 ni 403.
- **Interpolation tag de Neon** pour toute requete SQL. Jamais de
  concatenation.
- **Le panneau n'utilise jamais `innerHTML`** ni de dialogue natif.
- La forme de `/api/manifeste` ne change pas : `{version, sha256, actif,
  message}`. Un ami dont le paquet n'a pas ete refait continue de fonctionner,
  il ne remonte simplement rien.
- Le chemin de l'ami est en **ecriture seule** cote base : jamais de purge ni
  d'agregat pendant son lancement.

## Cote ami

### `amorceur/canal.js` — `signaler(cle, corps)`

POST `/api/etat`, en-tete `x-cle`, delai 2 s, **ne leve jamais**. Rend
`{etat:'ok'}` sur 200, `{etat:'refuse'}` sur 404, `{etat:'injoignable'}` sinon
— les trois memes etats que le reste du canal, pour la meme raison : confondre
« le serveur a dit non » et « le reseau est tombe » revoquerait des amis a la
premiere coupure.

Corps envoye :

```json
{ "version": "0.2.4",
  "refus": [ { "version": "0.2.3", "journal": "…30 dernieres lignes…" } ] }
```

`version` est celle que l'amorceur s'apprete a charger — la vraie, pas celle
d'avant la mise a jour. `refus` est vide dans le cas courant.

### Ou l'appel est fait

Dans `amorceur/principal.js`, **pas** dans `demarrage.js`. `demarrer()` reste
une machine a etats testable sans reseau ; y coudre un appel HTTP melerait
deux responsabilites.

Le partage est net :

- `demarrer()` **detecte** le refus (etape 1, `choix.refusee`) et le **range
  dans la file** via `depot.filerSignalement(version)`. Il continue par
  ailleurs de le retourner, pour la ligne de journal qu'il ecrit deja.
- `principal.js` **envoie** : il lit la file, y attache l'extrait de journal,
  appelle `canal.signaler`, et vide la file sur un 200.

Aucun appel reseau dans `demarrage.js`, aucune decision d'etat dans
`principal.js`.

L'appel a lieu **avant** le chargement de la fenetre, sur le chemin `charger`
comme sur le chemin `arreter`, des lors qu'une cle validee existe. Un arret
pour coupe-circuit ne doit pas faire perdre un refus en attente.

### La file « a signaler » — le point qui merite l'attention

`choix.refusee` n'existe **qu'une seule fois** : au lancement qui suit le
plantage. Une fois la version rangee dans `refusees`, elle ne ressort plus. Si
le service est injoignable pile a cet instant, l'information disparait pour
toujours — exactement le silence qu'on cherche a supprimer.

`courante.json` gagne donc une file :

```json
{ "version": "0.2.3", "essai": null, "refusees": ["0.2.4"],
  "aSignaler": ["0.2.4"] }
```

Elle ne porte que des **numeros de version** : le journal n'y est pas recopie,
il est lu a l'envoi. Ecrite au moment ou le refus est detecte, videe
**seulement** sur un 200. Tant que le service ne repond pas, elle repart au
lancement suivant. Le dedoublonnage cote serveur (cle primaire
`(cle, version)`) rend ce renvoi sans consequence.

Le journal joint a l'envoi est un extrait des **30 dernieres lignes** de
`%APPDATA%\OMNI\amorceur.log`. Prises a ce moment-la, elles couvrent le
lancement qui a plante et celui qui le signale — c'est ce qu'on veut lire. Le
meme extrait est joint a chaque entree de la file : elles proviennent du meme
fichier, le distinguer par version n'apporterait rien. Il ne contient ni cle,
ni identifiant Ankama — l'amorceur n'en journalise aucun.

### `amorceur/depot.js`

Trois fonctions de plus, dans le style des existantes :
`filerSignalement(version)`, `signalementsEnAttente()`,
`viderSignalements()`. `lire()` tolere un
`courante.json` ancien, sans `aSignaler` — un ami qui met a jour depuis une
version anterieure ne doit pas planter sur un champ absent.

## Cote serveur

### Schema (`lib/db.js`, idempotent comme le reste)

```sql
ALTER TABLE amis ADD COLUMN IF NOT EXISTS version_vue TEXT;

CREATE TABLE IF NOT EXISTS refus (
  cle        TEXT NOT NULL,
  version    TEXT NOT NULL,
  journal    TEXT,
  signale_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cle, version)
);

CREATE TABLE IF NOT EXISTS lancements (
  id      BIGSERIAL PRIMARY KEY,
  cle     TEXT NOT NULL,
  version TEXT,
  au      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lancements_cle_au ON lancements (cle, au DESC);
```

La cle primaire `(cle, version)` de `refus` fait le dedoublonnage, et c'est
elle qui commande le ping Discord : **on ne previent que si une ligne a
reellement ete inseree**, jamais sur un renvoi de file.

`amis.version_vue` est une denormalisation volontaire : elle evite un
`DISTINCT ON` par ami a chaque affichage du tableau principal, qui doit rester
une seule requete.

### `lib/etat.js` — la logique, et rien d'autre

- `enregistrerEtat(sql, { cle, version, refus }) → Promise<{ok, nouveaux: string[]}>`
  Ecrit `version_vue`, insere un `lancements`, insere les refus en
  `ON CONFLICT DO NOTHING`. `nouveaux` liste les versions dont l'insertion a
  reellement eu lieu : c'est ce que la route utilise pour prevenir.
- `compterLancements(sql, { depuis }) → Promise<Array<{cle, n}>>`
- `lancementsDe(sql, cle, limite = 20) → Promise<Array<{version, au}>>`
- `listerRefus(sql) → Promise<Array<{cle, nom, version, journal, signale_le}>>`
- `purgerLancements(sql, jours = 90) → Promise<number>`

Validation, cote serveur, sans confiance dans ce qui arrive :

- `version` doit correspondre a `^[0-9][0-9.]{0,19}$`, sinon elle est ignoree
  (l'appel reste un 200 : un client bavard ne doit pas voir d'erreur).
- `journal` est tronque a **4000 caracteres**.
- `refus` est ignore au-dela de **10 entrees** dans un meme appel.

### `api/etat.js`

POST uniquement. Cle dans `x-cle`. `verifierCle` d'abord — 404 corps vide si
absente, inconnue ou revoquee, **avant toute ecriture**. Puis
`enregistrerEtat`, puis, pour chaque version de `nouveaux`, un ping Discord.
Rend `{ok:true}`.

L'ordre est un invariant testable : une cle revoquee ne doit laisser **aucune**
trace, ni lancement, ni refus. Il existe deja un test de ce genre pour
`/api/paquet` (`verifierCle` avant `lireManifeste`) ; on ecrit le meme ici.

### `lib/discord.js`

`prevenir(fetch, url, texte)`. Variable d'environnement `DISCORD_WEBHOOK` :
**absente → aucun appel, aucune erreur** (les tests et le developpement local
tournent sans). Delai 2 s. Un echec est journalise en console et **jamais**
remonte dans la reponse HTTP : un webhook casse ne doit pas faire echouer le
lancement d'un ami.

Message : `⚠ Jibb a refuse 0.2.4 — elle n'a pas demarre chez lui`.

### `api/admin.js` — deux actions de plus

| Action | Rend |
|---|---|
| `refus` | La liste des refus, ami resolu par jointure sur `amis` |
| `lancements` | Sans `cle` : les compteurs 30 jours par ami, et purge des lignes de plus de 90 jours. Avec `cle` : les 20 derniers lancements de cet ami |

La purge est declenchee par la consultation admin, jamais par le lancement
d'un ami.

## Cote panneau (`web/admin.html`)

| Ou | Quoi |
|---|---|
| Tableau des amis | Colonne **version** : en clair si c'est la version active, en orange si l'ami est en retard, `—` s'il n'a jamais lance. Colonne **30 j** : nombre de lancements |
| Tableau des versions | En face de la ligne active : **`3/5 amis`** |
| Clic sur le nom d'un ami | Ses 20 derniers lancements, date et version. Une boucle de plantage s'y voit a l'oeil nu |
| Nouveau bloc **Refus** | Ami, version, date, journal depliable au clic. **En rouge si le refus porte sur la version actuellement active** — l'alerte s'eteint d'elle-meme des qu'un correctif est publie, sans bouton « effacer » |

## Erreurs et cas limites

| Situation | Comportement attendu |
|---|---|
| Service injoignable au moment de signaler | L'app demarre normalement ; la file est conservee et repart au lancement suivant |
| Cle revoquee entre le manifeste et `/api/etat` | 404 ; aucune ecriture ; l'app demarre quand meme (elle a deja son manifeste) |
| Meme refus renvoye plusieurs fois | Insere une seule fois ; un seul ping Discord |
| `DISCORD_WEBHOOK` absente ou cassee | Aucun effet visible ; la requete de l'ami reste un 200 |
| `courante.json` ancien, sans `aSignaler` | Lu comme une file vide |
| Ami dont le paquet n'a pas ete refait | Ne signale rien ; sa ligne affiche `—`. Aucune erreur |
| Version invalide envoyee | Ignoree, reponse 200 |

## Tests

Sur le modele exact de l'existant : logique pure testee avec le faux `sql` qui
rend les reponses dans l'ordre des appels, routes HTTP testees a travers leur
fonction `traiter*`.

- `lib/etat.js` : ecriture, dedoublonnage (`nouveaux` vide au second envoi),
  validation de version, troncature du journal, plafond de 10 refus, purge.
- `lib/discord.js` : sans URL, aucun appel ; un `fetch` qui leve ne fait pas
  echouer `prevenir`.
- `api/etat.js` : garde 404 (absente, inconnue, revoquee) ; **ordre** —
  `verifierCle` avant toute ecriture ; ping declenche seulement sur `nouveaux`.
- `api/admin.js` : les deux actions nouvelles, garde 404 comprise.
- `amorceur/canal.js` : `signaler` ne leve jamais — timeout, statut 500,
  `fetch` qui explose ; les trois etats sont distingues.
- `amorceur/depot.js` : file conservee sur echec, videe sur 200, tolerance a un
  `courante.json` sans `aSignaler`.
- `amorceur/demarrage.js` : un refus detecte atterrit dans la file.

## Consequence de livraison

Ces changements touchent l'amorceur, qui vit dans le paquet de 480 Mo. Il faut
donc **refabriquer le paquet et le redistribuer une fois** aux amis
(`npm run pack`, puis nouvelle adresse dans le panneau). Les mises a jour de
code suivantes repassent par le mecanisme habituel.

Un ami qui garde l'ancien paquet continue de fonctionner : il ne remonte rien,
sa ligne reste a `—`.
