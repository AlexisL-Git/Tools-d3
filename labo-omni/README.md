# Le labo OMNI : les maquettes du nouveau skin

Ce dossier contient **le nouveau skin d'OMNI**, dessine en pages HTML autonomes.
Rien n'y est branche sur la vraie application : c'est du dessin, avec des
donnees inventees. Mais tout ce qui y est affiche, OMNI le connait deja.

Ce README s'adresse a la personne qui va **integrer** ce skin dans
`desktop/` (l'app Electron) et il est ecrit pour etre lu aussi par Claude Code :
tout ce qui est decide est ecrit, tout ce qui reste ouvert est marque comme tel.

---

## 1. Ouvrir le labo

```sh
node labo-omni/serveur.js        # -> http://localhost:8731
node labo-omni/serveur.js 8740   # sur un autre port
```

Aucune dependance. Le serveur interdit le cache expres : chaque rechargement
montre le fichier tel qu'il est sur le disque.

La page d'accueil `http://localhost:8731/` presente les maquettes. Trois
d'entre elles sont **la reference a integrer** :

| Page | Ce que c'est | Ce qu'elle remplace en prod |
|---|---|---|
| `app.html` | La fenetre principale, cinq ecrans cliquables, deux themes | `desktop/index.html` |
| `hud.html` | La barre flottante posee sur le jeu, deux themes, deux sens | `desktop/overlay.html` |
| `icone.html` | L'icone, a toutes les tailles, avec ses contextes | l'icone de l'app et de la barre des taches |

`hud-prod.html` est l'overlay de prod tel quel, avec un faux `window.overlay`
injecte pour qu'il s'affiche hors d'Electron. Il ne sert qu'a comparer.

Les autres pages (`identite.html`, `clair.html`, `couleurs.html`, `oeil.html`,
`a-rangee.html`, `b-plein-jour.html`, `c-huit-couleurs.html`) sont **des
etapes rejetees**, gardees pour memoire. Elles portent une palette qui n'existe
plus. Ne pas s'en servir.

---

## 2. L'identite, en une page

Tout est dans le `<style>` de `app.html`, lignes 1 a 370 environ. Le CSS y est
commente : chaque brique dit pourquoi elle est comme elle est.

### Les jetons de couleur

Deux themes, pilotes par `data-theme="sombre"` sur `<html>` (absent = clair).
La meme regle de lecture tient dans les deux : **la carte qui tranche avec le
fond, c'est celle qui te reclame**. Le jaune ne bouge pas.

| Jeton | Clair | Sombre | Metier |
|---|---|---|---|
| `--fond` | `#E7EBE4` | `#14171A` | le fond de la fenetre |
| `--carte` | `#F6F7F3` | `#1D2124` | une carte, un panneau |
| `--carte-creuse` | `#EDEFE9` | `#262B2F` | une surface posee sur une carte (jeton, etiquette) |
| `--encre` | `#16181A` | `#EFF2EC` | le texte |
| `--encre-douce` | `#5C6360` | `#9AA298` | le texte secondaire |
| `--alarme` / `--sur-alarme` | `#16181A` / `#F6F7F3` | `#EFF2EC` / `#1D2124` | **la surface inversee** : une chose a faire, et son texte |
| `--trait` / `--trait-fort` | `#D8DCD3` / `#B9BFB4` | `#2E3438` / `#3B4348` | filets, bordures |
| `--acide` / `--sur-acide` | `#E2F27C` / `#16181A` | idem | **le jaune** : ce qui mene, ce qui tourne |
| `--acide-sur-contre` / `--sur-acide-contre` | `#E2F27C` / `#16181A` | `#16181A` / `#EFF2EC` | le jaune et son texte quand ils sont poses sur une surface inversee |
| `--contre-doux` / `--contre-creux` / `--contre-trait` | `#A9AFA7` / `#25282B` / `#333739` | `#5E6660` / `#DDE2D8` / `#C6CDC0` | texte doux, surface creuse et filet **sur une surface inversee** |
| `--inter-off` / `--inter-bouton` | `#CDD3C7` / `#F6F7F3` | `#3B4348` / `#8E958C` | l'interrupteur eteint et son curseur |
| `--rail` | `#16181A` | `#0B0D0F` | le rail de navigation |

`--encre` et `--alarme` ont la meme valeur mais **pas le meme metier** : l'un
ecrit, l'autre inverse une surface. Ne pas les fusionner, c'est ce qui permet
de compter les blocs inverses.

### Les deux polices

- `--titre` : **Outfit** (500 a 800), pour les titres et les noms.
- `--ui` : **Plus Jakarta Sans** (400 a 700), pour tout le reste.

Chargees depuis Google Fonts dans les maquettes. **A embarquer** dans
`desktop/polices/` pour la prod, comme Karla l'est aujourd'hui (licence
OFL pour les deux, a verifier au moment de copier les fichiers).

### Les quatre regles

1. **La forme avant la couleur.** Un etat se lit par une forme (plein, creux,
   pointille, lisere, trait) avant de se lire par une couleur. OMNI est regarde
   du coin de l'oeil, sur un second ecran, et la vision peripherique ne voit
   pas la teinte.
2. **Le jaune pour ce qui mene et ce qui tourne.** Le meneur porte un lisere
   jaune de 4 px (`.perso.mene`), pas un aplat. Une fonction armee est jaune.
3. **Un bloc inverse = une chose a faire.** Un personnage qui decroche, une
   course a rattraper, un replicate coupe. Le nombre de blocs inverses a
   l'ecran est le nombre de choses a faire ; il doit rester petit.
4. **Creux = eteint, plein = arme, moitie = certains seulement.** Pips,
   losanges, segments : toujours la meme grammaire.

### Les briques

Toutes dans `app.html`. Les plus employees :

| Classe | Role |
|---|---|
| `.rail` + `button[data-vue]` | la navigation, cinq boutons + Reglages en bas, picto DofusDB avec repli SVG |
| `.haut` | la barre du haut : titre, bouton de theme `.fant.theme`, boutons de fenetre |
| `.vue` / `.vue.actif` | un ecran ; `#v-raccourcis`, `#v-courses`, `#v-hotel`, `#v-archi`, `#v-reglages` |
| `.perso`, `.perso.mene`, `.perso.probleme` | la carte d'un personnage, normale / meneur / a rattraper |
| `.jeton` | le carre de classe (embleme DofusDB, repli sur le sigle) |
| `.pips` | les cinq interrupteurs d'un personnage, en points |
| `.inter`, `.inter.on` | l'interrupteur a curseur |
| `.tuile`, `.tuile.acide`, `.tuile.noire` | une tuile de chiffre, normale / jaune / inversee |
| `.capsule` | une jauge de progression |
| `.pastille-etat`, `.pleine`, `.creux` | une etiquette d'etat |
| `.bt-jaune`, `.bt-noir`, `.bt-vide`, `.bt-mini`, `.fant` | les boutons |
| `.marqueur` | la capsule dans un titre |
| `.ligne` | une ligne de tableau (courses, raccourcis) |
| `.archi`, `.archi.manquant` | une case de la grille d'archimonstres, possede / manquant |

### Les pictos du jeu

**Regle : partout ou un picto d'Ankama dit la chose, c'est lui qu'on emploie**,
pas un dessin maison. On reconnait Dofus dans OMNI. Les pictos viennent de
**DofusDB, hote beta** (plus a jour que la prod), jamais embarques (c'est l'art
d'Ankama) :

- `https://api.beta.dofusdb.fr/img/breeds/symbol_<id>.png` : les emblemes de classe
- `https://api.beta.dofusdb.fr/img/items/<id>.png` : les objets
- `https://api.beta.dofusdb.fr/img/monsters/<gfx>.png` : les archimonstres
- pour tout le reste (un sort, une action, un etat), chercher dans l'API
  `https://api.beta.dofusdb.fr/` ce qui existe avant de dessiner quoi que ce soit

C'est deja ce que fait `src/comptes/emblemes.js` (qui connait les deux hotes).
Si l'image ne charge pas, l'hote passe en `.sans-pic` et le dessin OMNI (SVG
ou sigle) reprend sa place : **un picto absent est un defaut d'agrement, pas
une panne.** Le dessin OMNI ne reste que la ou aucun picto du jeu ne dit la
chose : Raccourcis, Reglages, l'icone de l'app.

---

## 3. La fenetre principale (`app.html`)

1097 x 720, la taille reelle de la fenetre. Cinq ecrans, dans l'ordre du rail :

| Ecran | `data-vue` | Ce qu'il montre |
|---|---|---|
| **Raccourcis** (accueil) | `raccourcis` | les huit personnages, leur touche, leurs cinq fonctions, qui commande |
| Courses | `courses` | la course en cours ou en pause, ses lignes, ses trois onglets |
| Hotel de vente | `hotel` | les regles de prix, et ce qu'OMNI pose avec |
| Archimonstres | `archi` | la grille, possedes pleins / manquants creux, filtres |
| Reglages | `reglages` | la cle, les droits, le journal des versions |

L'ecran « Ma flotte » de la prod **n'existe plus** : Raccourcis l'absorbe.
Le bouton « OMNI est arme » de la barre du haut **n'existe plus** non plus ;
ses regles `.armer` trainent encore dans le CSS, a ignorer.

Ce qui bouge pour de vrai dans la maquette : le rail, le bouton de theme,
les onglets de Courses. Le reste est statique.

---

## 4. Le HUD (`hud.html`)

La barre flottante, refaite en **traduction directe** de `desktop/overlay.html` :
meme structure, memes gestes, meme ordre. Seul l'encodage change. Elle **suit
le theme de l'app** : `data-theme` sur la barre, memes jetons.

| En prod (`overlay.html`) | Dans le nouveau skin (`hud.html`) |
|---|---|
| `.picto` carre sombre, bordure | `.p` : jeton 36 px, `--carte-creuse`, rayon 11, embleme DofusDB, sigle en repli |
| `.picto.commande` bordure orange | `.p.mene` : **anneau jaune** 3 px (`inset 0 0 0 3px var(--acide)`), touche en jaune |
| `.picto.ici` outline vert | `.p.ici` : le picto **monte de 2 px et pose un trait** de 16 x 3 dessous, en `--encre`. Cumulable avec `.mene` |
| `.pastille.suit` cyan | rien : suivre est l'etat normal, il ne crie pas |
| `.pastille.souci` rouge | `.p.souci` : **le picto entier passe en `--alarme`**. Le seul bloc inverse de la barre |
| `.pastille.attente` gris | `.p.attente` : fond transparent, contour 1,5 px `--trait-fort`, embleme a 45 % |
| `.picto.inerte` | `.p.inerte` : opacite 0,4, pas de curseur |
| `.picto .touche` | `.p .t` : etiquette 9 px, `--carte` bordee `--trait`, coin bas droit |
| `.inter` RÉPL. trois etats | `.sw` **deux etats** : `.on` jaune plein, `.off` **inverse** avec losange creux. Le replicate est on/off pour tout le monde |
| `.inter.coupe` passe-tour | `.sw.coupe` : moitie meneur (deux etats) et moitie `TOUR` (les mules : `arme` / `mi` / rien). Un clic sur TOUR aligne tout le monde ; l'etat `mi` vient des reglages perso par perso, jamais du clic. **La moitie du meneur ne s'ecrit pas `M`** : la maquette montre encore la lettre faute d'avoir cherche, mais elle doit porter **un picto du jeu trouve sur DofusDB beta** qui dise « le meneur » ou « passer son tour » (une icone de sort, d'action ou d'etat). A chercher avant d'integrer |
| `.poignee`, `.sep`, `⇄`, `✕` | les memes, dans les jetons de l'app |
| palette cyan / orange / vert, Karla | les jetons de l'app, Plus Jakarta Sans |

Comportement inchange : clic gauche sur un picto = passer sur cette fenetre,
clic droit = donner la commande, `⇄` bascule horizontal / vertical, `✕` ferme.
La barre mesure sa taille et la remonte au principal comme aujourd'hui.

**Tranche** : les touches F2 a F5 restent affichees sur les pictos, c'est
voulu. **Decisions par defaut, a contester si besoin** : les pictos font 36 px.

---

## 5. L'icone (`icone.html`)

Validee le 14 septembre 2026. Quatre barres inclinees de 11 degres sur une
pastille claire a coin coupe ; la premiere barre est un peu plus basse, la
derniere un peu plus haute ; la troisieme est la pupille, jaune `#C9DC5C`.
La page montre les vraies tailles de 128 a 16 px, avec l'epaississement du
trait aux petites tailles, et l'icone en situation (barre des taches, bureau,
coin de fenetre). Le SVG est dans la page, a exporter aux tailles Windows
(16, 24, 32, 48, 64, 96, 128, 256) pour l'`.ico`.

---

## 6. Ce qui n'est pas dessine

Pour ne pas l'inventer douze fois : ce qui suit n'existe dans aucune maquette.
Quand tu le rencontres, applique les quatre regles, et **au doute, demande**
plutot que de trancher seul.

- **Les etats d'interaction** : focus clavier, pressé, desactive, occupe. Seul
  le survol est dessine, et pas partout.
- **Les etats vides** : aucun client Dofus detecte, liste de courses vide,
  archimonstres avant la premiere lecture, journal vide, cle sans droits.
- **Les erreurs** : la prod a deux bandeaux en haut de fenetre (`#erreur`,
  `#sansmaitre`). La refonte n'en dessine aucun. Regle retenue : un bandeau
  en surface inversee, entre `.haut` et `.vue`, qui **pousse** l'ecran vers le
  bas et ne recouvre jamais une donnee.
- **Les debordements** : les noms reels sont plus longs que ceux de la maquette.
  `ellipsis` + `title` sur tout texte qui peut deborder.
- **Les barres de defilement**, le theme par defaut (suivre Windows), la zone
  qui deplace la fenetre (`.haut`, en excluant ses boutons ; voir
  `desktop/index.html` l. 108 pour le piege connu).
- **Le format des nombres** : un seul format d'argent, chiffres tabulaires
  (`font-variant-numeric: tabular-nums`) partout ou une valeur se rafraichit.

---

## 7. Travailler dessus avec Claude Code

Le depot a un `README.md` a la racine pour lancer l'app sans rien publier,
et la conception vit dans `docs/superpowers/`. Pour la refonte, la source de
verite est **ce dossier** : en cas de doute entre une maquette et ce README,
la maquette a raison.

Un point de depart qui marche :

```
Lis labo-omni/README.md puis labo-omni/app.html (le <style> d'abord).
Lance node labo-omni/serveur.js et ouvre http://localhost:8731/app.html.
Objectif : porter les jetons, les polices et les briques de app.html dans
desktop/index.html sans changer le comportement de l'application.
Commence par les jetons et les deux themes, ecran par ecran ensuite,
Raccourcis en premier. Ne touche pas a src/.
```

Puis, pour la barre : meme chose avec `hud.html` vers `desktop/overlay.html`,
avec le tableau de correspondance du §4 comme contrat. Le theme de la barre
doit suivre celui de l'app : c'est au principal de le lui transmettre dans
l'etat (`etat.theme`), la page ne fait que le poser sur `<html>`.
