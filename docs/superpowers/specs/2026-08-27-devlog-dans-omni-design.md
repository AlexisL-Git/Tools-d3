# Devlog consultable depuis OMNI — design

**Date :** 2026-08-27
**Etat :** valide par l'utilisateur, pret a planifier

## Le probleme

Les amis prennent les mises a jour automatiquement, sans jamais savoir ce qui a change.
Le numero de version s'affiche en bas de la fenetre (`0.2.4 · 2 comptes en jeu`) mais ne
mene nulle part. On veut pouvoir cliquer dessus et lire ce que chaque version a apporte.

Public vise : **les amis**, pas l'auteur. Ce ne sont pas des developpeurs. Le texte doit
etre en francais simple, tourne vers ce que ca change pour eux, sans jargon.

## Decisions arretees

**Les notes vivent dans le depot, pas sur le serveur.** Fichier `desktop/devlog.json`.
Il voyage dans l'archive de code (`outils/faire-paquet-code.js`, `DOSSIERS = ['src',
'desktop']`), donc il arrive chez les amis par la mise a jour automatique deja en place :
**aucune redistribution du paquet de 480 Mo**.

Alternative ecartee : servir les notes depuis le serveur (`/api/devlog` + colonne en base
+ saisie dans le panneau). Cela permettrait de corriger une faute apres publication et de
montrer a un ami en retard les notes des versions plus recentes que la sienne. Refuse :
beaucoup de machinerie (route, schema, panneau) pour du texte fige au moment de publier,
et le devlog deviendrait dependant du reseau.

**Les entrees sont ecrites a la main, en francais simple**, au moment de publier une
version. Alternative ecartee : generer depuis les commits git — illisible pour un ami
(`fix(serveur-maj): poser le schema une fois par processus`).

## Le fichier

`desktop/devlog.json` — un tableau, version la plus recente en premier :

```json
[
  {
    "version": "0.2.5",
    "le": "2026-08-27",
    "notes": [
      "Le numero de version en bas de la fenetre est cliquable : il ouvre ces notes.",
      "Les mises a jour arrivent plus vite."
    ]
  }
]
```

- `version` : `x.y.z`, identique a celle publiee.
- `le` : `AAAA-MM-JJ`, date de publication.
- `notes` : une phrase par ligne, ce que ca change **pour l'ami**.

L'historique de `0.2.1` a `0.2.4` est rempli retroactivement, pour que le premier clic ait
deja quelque chose a raconter. Le contenu de ces entrees est derive de l'historique git et
du journal de sessions ; **chaque affirmation doit etre verifiee dans le depot avant d'etre
ecrite** — pas de note inventee.

Un devlog embarque ne decrit jamais que les versions **jusqu'a** celle qui le transporte.
C'est le comportement voulu : un ami lit l'histoire jusqu'a la version qu'il fait tourner.

## L'affichage

Aujourd'hui `desktop/index.html:860` ecrit d'un bloc :

```js
document.getElementById('titreEtat').textContent =
  (etat.version || 'dev') + ' · ' + enJeu + ' compte' + (…) + ' en jeu';
```

Le numero devient un element a part, cliquable (souligne pointille, curseur main) ; le
reste du texte ne bouge pas. En `dev` (hors paquet), le numero reste affiche et cliquable :
le devlog est lisible en developpement.

Le clic ouvre un panneau **a l'interieur de la fenetre**, jamais une fenetre modale — le
code s'y refuse deja explicitement (`desktop/index.html:574`, confirmation en place plutot
qu'une modale). Titre « Quoi de neuf », versions les unes sous les autres, celle en cours
marquee. Fermeture par la croix ou par Echap.

**Degradation :** fichier absent, illisible ou JSON invalide → le panneau s'ouvre et
affiche « pas de notes ». Ni erreur silencieuse, ni fenetre cassee : le devlog est du
confort, il ne doit jamais empecher OMNI de tourner.

## Le cablage

La fenetre tourne en `contextIsolation: true`, `nodeIntegration: false`
(`desktop/main.js:522-525`) : le rendu **ne peut pas** lire un fichier lui-meme. On suit le
schema deja en place partout dans ce depot :

- `desktop/devlog.js` — nouveau module, seul endroit qui lit et valide le fichier.
  `lireDevlog(chemin)` rend un tableau d'entrees valides, `[]` en cas de probleme.
- `desktop/main.js` — `ipcMain.handle('devlog', …)`, lit une fois et garde en memoire
  (le fichier ne change pas pendant l'execution). Chemin resolu depuis `__dirname` : le
  code tourne depuis `%APPDATA%\OMNI\versions\<v>\desktop\`, pas depuis le paquet.
- `desktop/preload.js` — `app.devlog()` expose l'appel, comme les autres.

La lecture est faite **au premier clic**, pas a chaque rafraichissement de l'etat : le
devlog n'a rien a faire dans le flux d'etat qui repart en boucle vers la fenetre.

## Tests

`test/devlog.test.js`, ecrit avant le code :

1. fichier valide → les entrees, dans l'ordre decroissant ;
2. fichier absent → `[]`, sans lever ;
3. JSON invalide → `[]`, sans lever ;
4. entree sans `notes`, ou `notes` non tableau → entree ecartee, les autres gardees ;
5. entree sans `version` → ecartee ;
6. fichier reel du depot (`desktop/devlog.json`) → se lit, non vide. Ce test attrape la
   faute de frappe qui rendrait le devlog muet chez tout le monde.

`test/pont-ipc.test.js` verifie deja que chaque nom expose par le preload a son
`ipcMain.handle` : `devlog` y entre sans travail supplementaire, mais le test doit etre
relance pour le prouver.

## Ce que ca coute

Le devlog part par la mise a jour automatique, donc **aucune reinstallation** cote amis.
Mais il faut publier une version pour qu'il arrive : ce sera **0.2.5**. Tant qu'un ami ne
l'a pas prise, rien ne change pour lui.

**Regle a tenir a partir de maintenant :** ajouter l'entree dans `desktop/devlog.json`
**avant** de fabriquer l'archive de code. Une version publiee sans son entree laisse un
trou definitif dans l'histoire que lisent les amis.

## Ce qui n'est PAS fait

- Pas de saisie des notes depuis le panneau admin.
- Pas de notification « une nouvelle version est arrivee » : le devlog se consulte, il ne
  s'impose pas.
- Pas de traduction : francais uniquement.
