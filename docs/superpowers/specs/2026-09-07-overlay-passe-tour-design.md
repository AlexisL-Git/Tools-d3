# Le passe-tour sur l'overlay, meneur et mules separes

2026-09-07

## Le manque

L'overlay porte un seul interrupteur d'ensemble: la colonne « Repl. ». Le
passe-tour, lui, ne se regle que depuis le panneau — il faut donc quitter le
jeu des yeux pour l'armer ou le couper, ce qui est exactement ce que l'overlay
existe pour eviter.

Et la demande n'est pas « le meme bouton qu'au panneau ». Elle est plus fine:
**le meneur et les mules ne veulent pas le meme reglage.** En combat, les mules
doivent passer leur tour toutes seules pendant que le meneur joue a la main;
mais il arrive qu'on veuille aussi faire passer le meneur, sans pour autant
toucher aux mules. Un seul bouton d'ensemble, comme le titre de colonne du
panneau, ne sait pas exprimer ca.

## Ce qu'on ajoute

Un bouton coupe en deux, pose apres « Repl. »:

    || : [pictos] | <> REPL. | <> M : <> TOUR | <-> X ||

- Moitie gauche (`M`): le passe-tour **du compte qui commande**, seul. Simple
  allume/eteint — un compte, donc pas d'etat « partiel ».
- Moitie droite (`TOUR`): le passe-tour de **tous les autres comptes en jeu**,
  avec les trois etats habituels (tous / partiel / aucun).

Les deux moities sont independantes: aucune n'ecrit dans le tas de l'autre.

## La regle, et ou elle vit

Le calcul ne va PAS dans la page. Il va dans `src/comptes/overlay.js`, a cote de
`pourOverlay()`, en fonction pure — meme raison qu'a la creation de l'overlay le
29/08: une regle ecrite dans `overlay.html` n'est verifiable ni sans Electron ni
sans jeu.

    etatTour(lignes) -> { meneur: 'actif'|'eteint'|'absent',
                          mules:  'tous'|'partiel'|'aucun' }

Elle ne reinvente rien: elle separe les lignes en deux tas selon `estMaitre` et
appelle `etatColonne(tas, 'tour')` de `src/comptes/colonnes.js` — celui-la meme
qui peint le losange du titre de colonne du panneau. Les deux fenetres ne
peuvent donc pas donner deux versions du meme etat.

**`'absent'` est un troisieme cas, pas un synonyme de `'eteint'`.** Sans lui, la
moitie gauche afficherait « le meneur ne passe pas son tour » alors qu'il n'y a
aucun meneur en jeu — un losange creux qui ment. `etatColonne` rend `'aucun'`
pour une liste vide; c'est correct pour une colonne, faux pour un compte unique.

## Le clic

Un seul canal neuf: `basculerTourGroupe('meneur' | 'mules')`.

Cote principal il ne fait que trier les identifiants en deux tas et appeler
`basculerColonneAvec('tour', ids)` — la fonction qui sert deja au titre de
colonne du panneau et au bouton « Repl. » de l'overlay. Consequences, toutes
heritees et aucune reecrite:

- **aucun second etat cache**: ca ecrit dans les memes cases par compte que le
  panneau, celles du fichier de reglages;
- **la cible est calculee cote principal**, depuis les reglages et l'etat vivant,
  jamais depuis ce que la barre affiche: deux clics rapides ne partent pas de
  deux lectures differentes;
- **depuis `partiel`, la moitie « mules » complete** au lieu de tout eteindre —
  le geste qui demande le moins de clics quand on veut aligner l'equipe;
- **le meneur qui change emporte son reglage avec lui**: les deux tas sont
  recalcules a chaque envoi d'etat, l'ancien meneur retombe dans les mules.

## Les deux gardes

1. **`passe-tour` est une fonction verrouillable** (`src/droits/liste.js`). Le
   panneau grise sa colonne quand la cle ne l'a pas; l'overlay doit faire pareil,
   sinon un ami sans le droit clique dans le vide sans rien comprendre.
   `rafraichirOverlay()` envoie donc aussi ce droit, et le bouton entier est
   grise et inerte sans lui. Le canal refuse en plus cote principal: la fenetre
   peut rester ouverte apres un retrait de droit.
2. **La moitie gauche est inerte quand `meneur === 'absent'`**, au lieu de
   basculer un compte qui n'existe pas.

## Le rendu

Aucune couleur neuve, aucune regle neuve: on reemploie `.inter`, `.temoin` et
les classes `.tous` / `.partiel` / `.aucun` deja ecrites. Le filet vertical qui
coupe le bouton devient horizontal en mode vertical, ou les deux moities
s'empilent et les mots disparaissent (`.mot` est deja masque la).

`empreinteDe()` prend les deux nouveaux etats et le droit. Sans ca, la barre se
redessinerait toutes les 2 s sous le curseur et ferait rater les clics — c'est
le defaut que cette empreinte existe pour eviter.

## Fichiers

- `src/comptes/overlay.js` — `etatTour()`
- `test/comptes-overlay.test.js` — ses cas
- `desktop/main.js` — `rafraichirOverlay()` enrichi, canal `basculerTourGroupe`
- `desktop/overlay-preload.js` — le canal
- `desktop/overlay.html` — le bouton coupe en deux

## Hors sujet, delibere

- **Le panneau ne bouge pas.** Sa colonne « Tour » reste un seul titre pour tout
  le monde. Rien n'y manque: les cases par compte permettent deja le reglage fin.
- **Pas de reglage « le meneur passe toujours son tour » persistant a part.** Le
  passe-tour du meneur est celui de son compte, dans les memes cases que les
  autres. Un second etat, propre a « le meneur », divergerait du panneau des le
  premier changement de meneur.
