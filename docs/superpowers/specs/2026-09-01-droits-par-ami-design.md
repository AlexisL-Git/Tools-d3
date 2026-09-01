# Droits par ami et par fonction

**Date :** 2026-09-01
**Statut :** conception validée avec l'utilisateur, non implémentée.
**Décidé avec :** Draxus, le 2026-09-01.

## Le besoin

Aujourd'hui une clé donne **tout ou rien**. La table `amis` porte
`cle, nom, actif, cree_le, derniere_vue, version_vue` : aucune notion de
fonction. La table `config` n'a qu'une seule ligne (`CHECK (id = 1)`) — un
manifeste unique pour tout le monde.

Draxus veut décider **qui a accès à quoi**. Chaque mise à jour livre tout le
code, comme aujourd'hui ; une fonction non activée pour un ami n'est pas
utilisable chez lui.

## La limite, assumée

Le code part quand même dans l'archive. Un ami suffisamment technique peut
rallumer une fonction en modifiant le code installé. **Ce dessin contrôle qui
voit et qui utilise quoi, il ne construit pas une barrière.** Choix explicite de
Draxus : l'alternative — une archive fabriquée par ami, sans le code non
autorisé — a été écartée comme trop lourde pour un usage entre amis.

Le levier dur reste celui qui existe : `amis.actif = false`, et l'ami n'a plus
rien.

## Ce qui rend la chose possible sans rien réinventer

* `/api/manifeste` et `/api/paquet` **reçoivent déjà la clé** de l'ami dans
  l'en-tête `x-cle` et vérifient qui c'est. Le serveur sait à qui il parle.
* `desktop/main.js:966` assemble déjà les fonctions une par une dans
  `composer()` : `creerDuplicateur`, `creerGardeCombat`, `creerAbandonGroupe`,
  `creerPasseur`, `creerAccepteur`, `creerAccepteurEchange`,
  `creerAccepteurSonge`, plus `creerReprix` (HDV) et l'overlay. Le point de
  branchement existe.
* `amorceur/canal.js` porte déjà le vocabulaire à trois états qu'il faut ici :
  `refuse` / `injoignable` / `ok`.

## Les fonctions verrouillables

| fonction | libellé | verrouillable |
|---|---|---|
| `abandon` | abandon de combat groupé | oui |
| `passe-tour` | passe-tour | oui |
| `invitation` | acceptation d'invitation de groupe | oui |
| `echange` | acceptation d'échange | oui |
| `songe` | acceptation d'invitation à un songe | oui |
| `overlay` | barre flottante | oui |
| `hdv` | mise à jour des prix en hôtel de vente | oui |
| — | le replicate (duplication) | **non** |
| — | le garde-combat | **non** |

**Le replicate n'est pas un droit** : c'est l'outil lui-même, une clé sans lui
ne sert à rien. **Le garde-combat non plus** : c'est une protection, la couper
ferait ouvrir un combat à chaque mule (dégât mesuré le 28/08).

## Modèle de données

```sql
CREATE TABLE IF NOT EXISTS droits (
  cle      TEXT NOT NULL,
  fonction TEXT NOT NULL,
  PRIMARY KEY (cle, fonction)
);
```

Une ligne = un droit accordé. **Pas de ligne = pas le droit.** Fermé par
défaut : un ami neuf n'a rien, une fonction neuve n'est active chez personne
tant qu'elle n'est pas cochée.

Pas de colonne `actif` : accorder, c'est insérer ; retirer, c'est supprimer. Un
booléen en plus offrirait deux façons de dire non.

## La route

`GET /api/droits`, en-tête `x-cle`, calquée sur `/api/manifeste` :

* clé inconnue ou révoquée → **404**, corps vide ;
* sinon → `200` et `{ "droits": ["abandon", "songe", ...] }`.

Logique pure `traiterDroits({ cle, sql })` séparée du HTTP, comme les quatre
routes existantes.

## Le panneau

Deux actions dans le `switch` de `api/admin.js` :

* `droits` — rend toutes les lignes de la table, pour dessiner le tableau ;
* `droit` — `{ cle, fonction, actif }`, insère ou supprime une ligne.

Dans `web/admin.html`, sous chaque ami : une case par fonction verrouillable,
plus un bouton **« tout cocher »** par ligne — la clé de Draxus doit tout avoir
sans sept clics. Un clic = une requête, comme le bouton `actif` d'aujourd'hui.

## Côté application

Trois pièces, toutes dans `src/`. **Jamais dans `amorceur/`** : l'archive de
mise à jour ne contient que `desktop/`, `src/` et `package.json` — ce qui vit
dans l'amorceur ne se corrige plus par une mise à jour.

### `src/droits/liste.js` — pur

La liste des fonctions verrouillables : nom technique, libellé français. **Un
seul endroit.** C'est ce fichier qui empêche le panneau et l'application de se
désynchroniser ; le panneau lit la même liste, servie par l'API.

### `src/droits/veille.js`

Demande les droits au lancement, puis **toutes les 60 secondes**. Fabrique
injectable (`chercher`, `planifier`) pour se tester sans réseau ni horloge.

| réponse du serveur | effet |
|---|---|
| la liste | on l'applique |
| `injoignable` (réseau) | **on ne change rien**, on garde les derniers droits connus |
| `404` (clé révoquée) | toutes les fonctions verrouillables tombent, dans la minute |

Confondre `injoignable` et `404` ferait qu'une coupure de connexion retirerait
ses fonctions à tout le monde. C'est la même erreur que `canal.js` évite déjà,
et pour la même raison.

### Le cache disque

`%APPDATA%\OMNI\droits.json` — les derniers droits connus, écrits à chaque
changement. C'est ce qu'on applique au démarrage, avant la première réponse.
Sans lui, un lancement hors ligne enlèverait tout.

Un fichier absent ou cassé vaut **aucun droit**, jamais une exception : le
défaut fermé est le même que côté serveur.

### La porte

Les modules restent assemblés comme aujourd'hui dans `composer()`. Chacun de
ceux qui portent un nom de fonction passe par une porte qui lit les droits du
moment : droit absent, la trame ne lui est pas remise, donc il n'émet rien.

La porte est une fonction pure de `src/droits/`, pas du code ajouté à
`desktop/main.js` — ce fichier fait déjà 1617 lignes.

Le panneau reçoit la même liste et **grise** les boutons des fonctions non
accordées, avec la raison affichée (« pas activé sur ta clé »). Choix de
Draxus : l'ami voit ce qui existe et peut le demander.

### Coupé en plein milieu

La porte cesse simplement de laisser passer les trames. Un seul module a un
travail qui dure : l'HDV. Sa fabrique rend déjà `{ onTrame, lancer, arreter }` —
la veille appelle `arreter(pid)` quand le droit `hdv` disparaît.

### Ça parle

Tout changement de droit écrit une ligne dans le pied de page, par
`noterAvis()`. Le dépôt documente le mode d'échec le plus coûteux du projet :
« une chose qui ne fait rien sans que rien ne le relie à sa cause ». Une
fonction qui disparaît en silence en est un cas exact.

## Le coût

Cinq amis à une requête par minute : environ 7 000 requêtes par jour sur le
projet Vercel. C'est la seule dépense continue que ce dessin ajoute. La route
ne lit que deux tables et ne renvoie que des noms.

## Hors périmètre

* **Une archive par ami.** Écarté ci-dessus.
* **Un troisième état visible/caché/verrouillé.** Deux états suffisent :
  accordé, ou grisé.
* **Des groupes de droits, des rôles, des profils.** Cinq amis.
* **Un historique de qui a eu quoi et quand.** Les tables `lancements` et
  `refus` couvrent déjà le besoin de savoir qui tourne avec quoi.

## Tests

* `liste.js` — pure, exhaustive.
* `veille.js` — avec un faux `chercher` et un faux `planifier` : les trois
  réponses, le cache appliqué au démarrage, l'appel à `arreter(pid)` quand
  `hdv` tombe, et **le cas qui compte : `injoignable` ne retire rien**.
* La porte — une trame passe avec le droit, ne passe pas sans.
* `traiterDroits` — comme les autres routes : logique pure, sans HTTP.
* Le panneau — les deux nouvelles actions dans les tests d'`admin.js`.

## Ce qui reste à vérifier en vrai

Rien de tout ceci ne se prouve par des tests unitaires :

* qu'un droit retiré au panneau se voie **chez un ami** en moins d'une minute ;
* qu'une coupure de réseau ne retire rien ;
* que le paquet de 480 Mo ne soit **pas** redemandé — l'archive de code doit
  suffire, c'est une exigence explicite de Draxus.
