# Le dictionnaire du protocole Dofus 3

Les `.proto` qui donnent un nom aux messages et a leurs champs. Sans eux,
`rawProto.js` sait lire la structure mais pas le sens : on obtient `champ 2 = 1942`
au lieu de `objectGid = 1942`.

## Pourquoi ces fichiers sont ici et plus dans `.cache`

`src/cli/sniff.js` les cherchait dans `%USERPROFILE%\.cache\`, le dossier de
travail de `dofus-multi`. Deux problemes, tous les deux constates :

1. **Ce dossier ne nous appartient pas.** `dofus-multi` le remplit au lancement
   et l'ecrase a chaque mise a jour. Le 2026-08-23 son `protocol.zip` a ete
   retelecharge et `protocol/game/` est revenu **vide**. `loadRegistry` echoue
   alors sur `source introuvable` avant meme d'ouvrir Dofus.
2. **On dependait d'un outil tiers pour lire le jeu.** Ce n'est pas tenable.

Le dictionnaire est donc versionne avec le projet.

## Provenance

Extrait le 2026-08-25 de `C:\Users\jibef\.cache\index.jsc`, le vrai programme de
`dofus-multi` (l'executable de `Documents\myheroacademia` n'est qu'un lanceur qui
telecharge ce fichier depuis les releases GitHub de krm35). Le fichier est du
bytecode V8 obfusque, mais le texte `.proto` y est present **en clair** dans le
pool de constantes, d'un seul tenant.

| Fichier | Contenu |
|---|---|
| `_Message.proto` | l'enveloppe `Message` / `Request` / `Response` / `Event`, avec son `google.protobuf.Any` |
| `game/dofus3.proto` | le protocole de jeu, **2254 messages**, 6186 champs |
| `connexion/login.proto` | serveur de connexion, noms de messages en clair |
| `connexion/message.proto` | idem, second fichier du meme package |

Les deux fichiers de `connexion/` declarent chacun un `Request` dans le meme
package : ils exigent **deux roots distincts**, comme le dit deja `registry.js`.

## Ce qui a ete verifie, et comment

Charge avec `loadRegistry`, puis 200 trames reelles relues avec `decodeEnvelope` :
**200 noms de message sur 200 identiques** a ceux que produit `dofus-multi` sur les
memes octets. Sur un `kbt` complet, la sortie est identique caractere pour caractere.

Recoupement independant, plus parlant : le dictionnaire retrouve seul ce que
`echange.js` avait etabli a la main le 22/08 en inversant les roles sur quatre
echanges.

- `kfz` = `{ sourceId, targetId, fxie, exchangeType }`. Le champ 1 est bien le
  **proposant**, pas la cible. C'etait la conclusion la plus chere de cette
  journee-la, elle est confirmee.
- `kep` = `{ ready, step }`, ce qui explique le `{1:1, 2:1}` de `TRAME_VALIDATION`.
- `kgi` n'a **aucun champ**, ce qui explique l'`Any.value` vide de `TRAME_ACCEPTATION`.
- `kgt` = `{ fxlv, fxlw, fxlx, fxly }`, dont le champ 3 `fxlx` est la coche.

Le nombre de messages est passe de **1414 a 2254** au passage.

## Ce que le dictionnaire ne dit pas

Les noms restent ceux d'Ankama, donc obfusques (`kbt`, `fwpj`). Ils sont stables
d'une version a l'autre, mais ils ne se lisent pas. Le sens se note a la main, en
mesurant en jeu, comme pour l'echange.

Le decodage sans schema de `rawProto.js` **reste utile** : le jour ou Ankama
reordonne ses champs, il continue de fonctionner la ou le dictionnaire devient faux.
Le dictionnaire confortable, le decodage brut comme filet.

## Messages du marche (HDV)

Releves pour la fonction "vendre l'inventaire". Le sens vient des noms clairs
retrouves a cote, dans le meme `index.jsc`.

| Code | Nom clair | Forme |
|---|---|---|
| `keh` | ExchangeBidHousePriceRequest | `{ objectGid, follow }` |
| `kbt` | offres en vente | `{ objectType, fwpi, fwpj[] }`, `fwpb` = prix par lot [1, 10, 100, 1000] |
| `iue` | historique du marche | `frit` = ventes 24 h, `friv` = serie 30 j |
| `ivi` | prix moyens serveur | `objectAveragePrice[{ frmz gid, frna prix }]` |
| `kge` | **ExchangeObjectMovePricedRequest**, la mise en vente | `{ int64 fxjh, int32 fxji, int32 fxjj }` |
| `kfi` | ExchangeBidHouseInListUpdatedEvent | `{ effects, objectType, objectUid, prices[], objectGid }` |

**`kge` n'est pas verifie champ par champ.** `fxjh` est le seul `int64`, donc c'est
tres probablement le prix ; `fxji` et `fxjj` sont l'uid et la quantite, dans un
ordre inconnu. A trancher en capturant deux mises en vente du meme objet, une en
lot de 1 et une en lot de 10 : le champ qui bascule de 1 a 10 est la quantite.
Ne rien coder avant.
