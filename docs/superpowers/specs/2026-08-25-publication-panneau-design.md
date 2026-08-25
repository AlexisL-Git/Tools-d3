# Publier une version depuis le panneau, sans saisir d'empreinte

**Date :** 2026-08-25
**Statut :** conçu et validé, non implémenté.
**Périmètre :** `serveur-maj/` uniquement. Aucune modification du client.

## Le besoin

Publier une version d'OMNI demande aujourd'hui trois gestes, dans le bon ordre,
dont deux sont manuels :

1. `node publier.js <archive> <version>` — range l'archive dans
   `serveur-maj/paquets/` et affiche son sha256 ;
2. `npx vercel --prod` — **redéploie tout le service**, parce que l'archive est
   embarquée dans le bundle de la fonction (`includeFiles: "paquets/**"`) ;
3. panneau admin, action `publier` — on **recopie le sha256 à la main** dans un
   champ texte.

Trois occasions de se tromper, dont une catastrophique : une empreinte mal
collée passe la validation de forme (64 caractères hexadécimaux) et bascule le
manifeste sur une valeur que plus aucun client n'acceptera. Le parc entier se
bloque, et rien dans le panneau ne le dit.

## Ce que la mesure change

`serveur-maj/paquets/0.2.3.tar.gz` pèse **82 Ko**.

L'archive de code ne transporte aucune dépendance (choix acté à
l'implémentation ; le chiffre de 12,2 Mo qui figure dans
`2026-08-23-mise-a-jour-automatique-design.md` décrivait `app.asar`, pas
l'archive finalement retenue). À 82 Ko, **stocker les octets en base est
raisonnable** — ce qui n'aurait pas été le cas à 12 Mo.

Cette mesure est l'hypothèse porteuse de tout le document. Si l'archive
grossissait un jour au-delà de ~4 Mo, le téléversement direct cesserait de
fonctionner (plafond de corps de requête chez Vercel) et il faudrait basculer
sur un stockage objet. Voir « Limite assumée ».

## La conception

### Données

Une table de plus. `config` ne change pas : elle reste le **pointeur** vers la
version courante.

```sql
CREATE TABLE IF NOT EXISTS versions (
  version    TEXT PRIMARY KEY,
  sha256     TEXT NOT NULL,
  archive    BYTEA NOT NULL,
  taille     INTEGER NOT NULL,
  publiee_le TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Conséquence : `/api/manifeste` rend exactement la même chose qu'avant.
**L'amorceur déjà installé chez les amis n'a pas une ligne à changer.**

### Flux

Deux gestes, tous deux dans le panneau, aucun redéploiement :

1. **`televerser`** — le panneau envoie les octets. Le serveur **calcule
   lui-même le sha256** et insère la ligne. Rien n'est encore servi aux amis.
2. **`activer`** — le serveur recopie `version` et `sha256` **depuis la ligne
   stockée** vers `config`.

**L'invariant central :** l'empreinte n'est jamais saisie ni transportée. Elle
est dérivée des octets que le serveur a reçus. Une empreinte fausse devient
structurellement impossible, pas seulement improbable.

Le retour arrière est « activer » sur une ligne plus ancienne — aucun mécanisme
supplémentaire.

Séparer les deux gestes conserve la propriété de sûreté du flux actuel
(l'archive est en place avant que le manifeste la désigne), mais sans
discipline manuelle : le serveur refuse d'activer une version qu'il n'a pas.

### `/api/paquet`

`traiterPaquet` garde sa forme : on lui injecte `lireArchive(version)` — lecture
en base — au lieu de `lireFichier(version)`. Le contrat HTTP ne bouge pas
(200 + `application/gzip`, ou 404).

### Migration, en trois temps

`paquets/0.2.3.tar.gz` est déjà dans le bundle. Basculer sec ouvrirait une
fenêtre où `/api/paquet` rend 404 pour tout le monde.

1. **Déployer avec un repli disque** — `lireArchive` cherche en base ; si la
   ligne n'existe pas, il retombe sur `paquets/<version>.tar.gz`. Cinq lignes,
   commentées comme temporaires.
2. **Téléverser** 0.2.2 et 0.2.3 par le panneau.
3. **Retirer** le repli, `includeFiles: "paquets/**"` du `vercel.json`, le
   dossier `paquets/` et `publier.js` (sans objet une fois l'upload en place).

L'étape 3 est une tâche du plan, pas un « on verra ». Un pont qu'on laisse
devient un chemin de code que plus rien n'exécute, donc que plus rien ne teste.

## Ce que le serveur refuse, et ce qu'il accepte sans rien faire

Chaque refus rend 400 et un `{ erreur }` affiché tel quel dans `#avis`. Les
deux dernières lignes de chaque tableau ne sont pas des refus : ce sont les cas
où recliquer ne doit pas être une faute.

**`televerser` :**

| Cas | Réponse |
|---|---|
| Version absente ou mal formée | `version attendue au format x.y.z` |
| Archive absente ou vide | `archive vide` |
| Plus de 4 Mo | `archive trop grosse (N Mo, plafond 4)` |
| Deux premiers octets ≠ `1f 8b` | `ce fichier n'est pas un .tar.gz` |
| Version déjà en base, octets **différents** | `<v> existe deja avec une autre empreinte` |
| Version déjà en base, octets **identiques** | accepté, sans insertion (idempotent) |

**`activer` :**

| Cas | Réponse |
|---|---|
| Version inconnue en base | `version inconnue — televerse-la d'abord` |
| Version déjà courante | accepté — réécriture des mêmes valeurs, donc sans effet |

Le contrôle des deux octets de gzip ne prouve pas que l'archive est bonne,
seulement qu'elle est plausible. La vraie preuve reste le sha256 vérifié par
l'amorceur chez l'ami. Mais il coûte deux octets de lecture et transforme « le
parc se bloque, tu cherches pourquoi » en « le panneau dit non tout de suite ».

Le refus sur octets différents à version égale mérite d'être souligné :
republier un contenu différent sous un numéro déjà distribué est exactement ce
qui casse un parc en silence, puisque les clients qui ont déjà la version ne la
retéléchargent pas.

## Le panneau

Le bloc « Publier une version » perd ses deux champs texte au profit d'un
sélecteur de fichier, d'un champ version, et d'un tableau des versions :

```
Publier une version
  [ Choisir un fichier ] code-0.2.3.tar.gz
  version : [0.2.3]          [ téléverser ]

version   taille   publiée le          empreinte
0.2.3     82 Ko    2026-08-25 00:49    82394f3f…   [ activer ]
0.2.2     81 Ko    2026-08-24 18:03    2067e6c9…   ● courante
```

- Le champ version se **pré-remplit depuis le nom du fichier**
  (`code-0.2.3.tar.gz` → `0.2.3`) et reste modifiable.
- L'empreinte est **affichée, jamais saisie** : huit caractères suffisent à la
  comparer d'un coup d'œil avec ce qu'a produit la fabrication.
- Les octets partent en **base64 dans le JSON**, via le helper `api()` existant.
  82 Ko deviennent 110 Ko — négligeable, et aucun second chemin de requête à
  ouvrir dans un fichier qui n'en a qu'un.

Trois contraintes du panneau actuel sont conservées, chacune ayant été payée :
**aucun `innerHTML`** (les noms viennent de la base), **aucun dialogue natif**
(`alert`/`confirm` bloquent la page et toute automatisation), **tous les
messages dans `#avis`**.

## Tests

Motif déjà en place dans `serveur-maj/test/` : logique pure, `sql` factice,
sans base ni HTTP.

- **`lib/versions.js`** (nouveau : `enregistrerVersion`, `listerVersions`,
  `lireArchive`, `activerVersion`) — un fichier de test propre, chaque refus du
  tableau ci-dessus, plus l'idempotence.
- **`traiterAdmin`** — les deux nouvelles actions, **y compris qu'elles rendent
  404 sans mot de passe**. C'est la garde qui protège tout le reste : elle se
  teste pour chaque action ajoutée, elle ne se suppose pas.
- **`traiterPaquet`** — sert les octets de la base ; 404 si le manifeste désigne
  une version absente.
- **L'invariant** — après `activer`, le `sha256` de `config` est *exactement*
  celui recalculé sur les octets stockés.

Le dernier est le seul qui compte vraiment : les autres vérifient du code,
celui-là verrouille la raison d'être du chantier. Si quelqu'un rebranche un jour
une saisie manuelle de l'empreinte, c'est ce test qui tombe.

## Ce qui NE sera PAS fait

- **Barre de progression** — 110 Ko passent en un aller-retour.
- **Suppression d'une version depuis le panneau** — une version effacée est une
  version vers laquelle on ne peut plus revenir. Le seul gain serait la place,
  et 82 Ko n'en prennent pas.
- **Glisser-déposer** — un `<input type="file">` fait le travail.
- **Les trois autres chantiers du panneau** (télémétrie des amis, gestion fine
  des amis, session et journal d'accès). Identifiés, écartés de ce spec, chacun
  aura le sien.

## Limite assumée

Vercel plafonne le corps d'une requête à ~4,5 Mo. À 82 Ko on est à 2 % du
plafond, mais **le téléversement direct cesse de fonctionner si l'archive
franchit ce seuil** — il faudrait alors un stockage objet (Vercel Blob ou
équivalent) et une URL signée. Le refus explicite au-delà de 4 Mo existe pour
que ce jour-là le panneau le dise, au lieu de laisser Vercel couper la requête
sans explication.
