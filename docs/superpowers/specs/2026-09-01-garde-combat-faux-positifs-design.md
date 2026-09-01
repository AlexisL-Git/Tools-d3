# Le garde combat apprend sur le degat, pas sur un pressentiment

2026-09-01. Conception validee avec l'utilisateur.

## Le defaut rapporte

Ilan, le 01/09 a 17h06 : « les dialogues pnj ca marche plus », puis « ca me dis
oublier 3 combats **alors que y'en a eu aucun** ».

Le message qu'il voyait sur ses lignes de compte est celui de
`src/duplicateur.js:77` — `action connue pour lancer un combat` — le seul
chemin du code qui le produise. Sa version (0.2.6) porte encore le bouton
« Oublier N combats », retire le 01/09 par `ad5582b` et jamais publie : il a pu
se debloquer d'un clic. Un ami sur une version posterieure n'aurait eu aucun
recours, `favoris.oublierCombats()` n'ayant plus d'appelant.

## La cause

Le garde n'observe pas le degat. Il observe un INDICE :

    le maitre entre en combat (`ieb`) moins de 2 s apres une action sensible
    (`iov`, `ioy`, `iwo`)  ->  on retient l'action pour toujours

Or entrer en combat apres avoir parle a un PNJ, c'est jouer normalement. Le
garde confond « le maitre se bat » avec « les mules ont chacune ouvert SON
combat ». Les trois entrees d'Ilan sont trois parties de jeu ordinaires.

Le vrai degat est le second terme, et il est directement observable : OMNI lit
le trafic de TOUS les clients.

## Le critere de remplacement

Celui de `src/abandon-combat.js`, mesure et verifie en jeu deux fois le 01/09 :

    la liste des combattants (`kmk`) recue par une mule contient le
    characterId du maitre  ->  meme combat
    elle ne le contient pas  ->  elle s'est ouvert SON propre combat

Rien de neuf n'est a mesurer. `combattantsDe(frame)` est deja exporte et rend
`null` sur une `kmk` de carte (aucun identifiant negatif, donc aucun monstre) —
cette distinction porte tout le mecanisme et elle est deja testee.

`superviseur.comptes.get(pid).characterId` donne l'identifiant du maitre, comme
dans `creerAbandonGroupe`.

## Ce qui change dans `src/garde-combat.js`

1. **Le module lit desormais le trafic des mules.** Le `if (!estMaitre) return`
   d'entree disparait, remplace par un aiguillage : les trames entrantes des
   esclaves servent au nouveau critere, la branche du maitre reste ce qu'elle
   est. Meme forme que `creerAbandonGroupe`, qui existe precisement parce que
   ni le duplicateur ni ce garde ne voyaient les mules.
2. **L'apprentissage quitte la branche `ieb` du maitre** et se declenche sur la
   `kmk` d'un esclave qui ne contient pas le maitre, si une action sensible a
   ete emise depuis moins de `FENETRE_APPRENTISSAGE_MS`.
3. **Chaque entree est datee.**

`FENETRE_APPRENTISSAGE_MS` reste a **2000 ms**, et la valeur n'est plus
critique. Elle couvre largement la chaine reelle : le rejeu part au plus tot au
plancher de 250 ms, le serveur annonce le combat en ~30 ms, la `kmk` de
l'esclave suit. C'est desormais le CRITERE qui porte la precision, plus la
fenetre — c'est tout l'objet de ce changement.

`derniereAction` est **consommee** des le premier esclave qui declenche
l'apprentissage, comme elle l'etait sur le `ieb` du maitre. Deux mules entrant
chacune dans son combat ne produisent donc qu'une entree, et `estApprise`
garde de toute facon l'idempotence.

## Ce qui ne change pas

L'annulation des rejeux en attente reste declenchee par le `ieb` du MAITRE, au
plancher de 250 ms. C'est la premiere ligne de defense : elle agit AVANT le
degat, n'ecrit rien sur le disque, et n'a jamais faute. La fermeture des
dialogues des esclaves (`kla`) ne change pas non plus.

`favoris.oublierCombats()` reste sans appelant. Elle n'est PAS du code mort :
vider le tableau `combats` de favoris.json revient exactement a l'appeler.
Aucun bouton n'est ajoute — contrainte explicite de l'utilisateur.

## L'oubli automatique

Une entree devient `{ "cle": "ioy:25088", "le": <horodatage ms> }`. Au
chargement, celles de plus de **30 jours** sont ecartees et le fichier est
reecrit.

Justification : les actions dangereuses sont pour l'essentiel des combats de
quete, faits une fois. Passe un mois, l'entree ne protege plus de rien et ne
fait que bloquer. Si l'action est encore dangereuse, le degat se reproduit UNE
fois et elle est retenue de nouveau — c'est le prix, il est assume.

## La migration soigne tout le monde

**Au premier chargement de la nouvelle version, la liste existante est jetee.**

Les entrees en place ont ete apprises par une regle qu'on sait fausse ; les
convertir reviendrait a conserver exactement les blocages qu'on veut
supprimer. Les anciennes entrees sont des chaines, les nouvelles des objets :
la migration se reconnait sans drapeau de version.

C'est ce point, et non l'expiration, qui debloque Ilan et ceux qui portent le
meme probleme sans le savoir — sans clic et sans bouton.

## Tests

`garde-combat` est un module pur, teste avec un double du superviseur, sans
Electron ni Frida. Cas a couvrir :

- mule en combat AVEC le maitre -> rien retenu
- mule en combat SANS le maitre, dans la fenetre -> retenu
- mule en combat SANS le maitre, hors fenetre -> rien retenu
- `kmk` de carte (aucun identifiant negatif) -> rien retenu, liste inchangee
- aucune action sensible recente -> rien retenu
- `ieb` du maitre seul -> les rejeux sont annules, RIEN n'est retenu
- deux mules dans deux combats distincts -> une seule entree, non dupliquee

`favoris` :

- liste de chaines au chargement -> jetee, fichier reecrit
- entree datee de plus de 30 jours -> ecartee
- entree datee de moins de 30 jours -> conservee
- fichier illisible -> reglages par defaut, comme aujourd'hui

## Ce que la conception ne couvre pas

**Un faux positif reste possible** : une mule agressee seule dans la seconde
qui suit un rejeu est en combat sans le maitre. C'est sans commune mesure avec
la regle actuelle, et l'expiration a 30 jours le rattrape sans intervention.

**Le retour a une version anterieure** lit la liste comme vide : la protection
est perdue, rien n'est casse.

**Le degat doit survenir une fois** avant d'etre retenu. C'est deja le cas
aujourd'hui ; l'annulation a 250 ms reste la seule protection de premiere
occurrence, et elle est inchangee.

## Verification en jeu

Non faite au moment d'ecrire. Les 761 tests et deux revues de code n'avaient
pas vu le defaut du 28/08 sur `kmk` : un test ne vaut jamais mieux que la
lecture de protocole sur laquelle il repose. Le critere retenu ici, lui, a ete
verifie en jeu deux fois le 01/09 dans `abandon-combat.js`, y compris sur le
cas le plus dur — un combat de quete ou la mule etait dans SON propre combat,
le maitre absent de sa liste.
