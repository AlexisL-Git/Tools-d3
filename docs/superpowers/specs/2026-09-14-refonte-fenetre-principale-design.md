# La fenêtre principale au nouveau skin — conception

Porter le skin dessiné par jib dans `labo-omni/app.html` sur
`desktop/index.html`, en refondant le DOM et le JavaScript sur le vocabulaire
de la maquette, et en découpant le fichier en modules.

Source de vérité du dessin : **`labo-omni/README.md`** et les maquettes du
même dossier. En cas de désaccord entre les deux, la maquette a raison —
c'est la règle posée au §7 du README de jib.

## Pourquoi

`desktop/index.html` fait 3 087 lignes d'un seul tenant : 878 de CSS, 290 de
balisage, 1 914 de JavaScript. Il porte un thème sombre unique, une navigation
faite de cinq panneaux modaux ouverts par-dessus une liste, et deux polices
(Cal Sans, Karla) que la refonte remplace.

La maquette propose une autre architecture d'écran : un rail de cinq icônes,
cinq écrans cousins, deux thèmes, et un jeu de briques nommées. Ce n'est pas
un échange de peinture : c'est un changement d'architecture d'écran.

Le découpage en modules n'est pas un bonus. Un fichier de 3 000 lignes se
relit mal, s'édite mal, et **cache ses collisions** : le commentaire en tête
d'`outils/faux-app.js` raconte comment une seconde déclaration de `COLONNES`
au premier niveau empêchait *tout* le script d'index.html de s'exécuter — la
page affichait son ossature, sans une ligne, et sans un mot ailleurs que dans
la console.

## Ce qui a été vérifié, et non supposé

- **Les modules ES se chargent en `file://`.** Une sonde Electron 43 dans un
  renderer `sandbox: true, contextIsolation: true` a exécuté un
  `<script type="module">` avec un `import` relatif, et le script classique
  voisin. Le renderer de production est chargé par `loadFile`
  (`desktop/main.js:954`) : c'est bien ce cas-là qui a été mesuré. Sans cette
  mesure, le découpage se serait fait en scripts classiques par prudence.
- **L'écran « Courses » n'a pas de fonction derrière.** La maquette le dit
  elle-même : son écran Réglages marque le droit `courses` en `non`, avec la
  phrase « Les courses en hôtel de vente arriveront dans une prochaine
  version ».
- **La liste des droits de la maquette est inventée.** Elle en montre douze
  (`zaap`, `duplicateur`, `chasse`, `réplication`…). `src/droits/liste.js` en
  déclare onze : `abandon`, `passe-tour`, `invitation`, `echange`, `songe`,
  `overlay`, `hdv`, `vente`, `pda-archi`, `no-anim`, `ambiance`.
  `test/droits-liste.test.js` les verrouille, en double avec `serveur-maj`.
- **La maquette ne couvre pas toute l'application.** Ni les pépites
  (`#vuePepites`), ni les lots écartés (`#vueEcartes`), ni les cinq commandes
  de la `.barre-nav` n'y ont de place.

## Les écrans

| Rail | Contenu | Ce qui existe aujourd'hui |
|---|---|---|
| **Raccourcis** | la flotte, ses touches, ses cinq interrupteurs | `#entete` + `#liste` |
| **Courses** | icône **désactivée**, mention « prochaine version » | rien |
| **Hôtel de vente** | trois onglets | voir ci-dessous |
| **Archimonstres** | la grille, ses filtres, ses deux vues | `#vueArchi` |
| **Réglages** | le journal des versions, les droits, la machine | `#quoiDeNeuf` |

L'écran **Hôtel de vente** porte trois onglets, parce que les trois relèvent
du même métier et que le rail n'en compte que cinq :

1. *Règles de prix* — `#vueRythme`, le bouton « Réglage HDV » d'aujourd'hui
2. *Pépites* — `#vuePepites`
3. *Écartés* — `#vueEcartes`

La **`.barre-nav` du bas reste**, restylée aux jetons. Elle porte des bascules
globales — Overlay, Équiper PdA, Monter en calibre, Fermer les clients, le
délai — et non un écran. L'avancement de la passe de marché (`#pepAvance`) y
reste également : il est là parce qu'un texte posé dans le panneau ne se voit
que panneau ouvert, ce qui a été mesuré à la recette du 11/09.

## Trois écarts assumés par rapport à la maquette

- **Les colonnes HDV et Archi de Raccourcis sont gardées.** La maquette les
  laisse tomber. Elles commandent des fonctions réelles : les perdre serait
  une régression, pas une simplification.
- **Les droits affichés sont les onze vrais**, pas les douze inventés.
- **Les bandeaux `#erreur` et `#sansmaitre`** suivent la règle du §6 du
  README, qui ne les dessine pas : surface inversée, posée entre `.haut` et
  `.vue`, qui **pousse** l'écran vers le bas et ne recouvre jamais une donnée.

## Le découpage des fichiers

```
desktop/
  index.html            l'ossature seule : le rail, la barre du haut,
                        les cinq .vue vides, la barre du bas
  skin/
    jetons.css          les deux thèmes, les @font-face
    briques.css         .perso .jeton .pips .inter .tuile .capsule
                        .pastille-etat .bt-* .marqueur .ligne
    ecrans.css          ce qui est propre à chaque écran
  vues/
    rail.js             la navigation, le thème, la barre du haut
    raccourcis.js       etatColonne, creerRang, majRang, dansLaPlaque, bip
    hotel.js            les règles de prix, les pépites, les écartés
    archi.js            la grille des archimonstres
    reglages.js         le devlog, le retard sur le dépôt, les droits
    commun/
      touches.js        la copie de src/comptes/raccourcis.js
      format.js         kamas(), les nombres tabulaires
```

Les sept grappes du script actuel se découpent déjà sur ces lignes : le
devlog et le retard sur le dépôt, les archimonstres, les pépites, les
écartés, le rythme HDV et ses garde-fous, les rangs de la flotte, les touches.

Chaque module a **une portée à lui**. La collision décrite en tête de
`outils/faux-app.js` devient impossible ; le commentaire qui l'explique doit
être mis à jour, pas supprimé — il raconte pourquoi le shim est enrobé.

`outils/faux-app.js` reste un **script classique** : chargé avant les modules,
il s'exécute avant eux, et `window.app` est donc posé quand ils démarrent.

## Les polices

Outfit (500-800) et Plus Jakarta Sans (400-700) sont appelées depuis Google
Fonts dans la maquette. Elles doivent être **embarquées** en `.woff2` dans
`desktop/polices/`, comme Cal Sans et Karla le sont : OMNI doit démarrer sans
réseau.

C'est déjà tombé une fois. Le commentaire de `test/paquet-fichiers.test.js`
raconte l'épisode : `index.html` partait chez les amis **sans ses polices**,
et l'interface retombait sur la police système après une mise à jour.

Licences OFL pour les deux, à vérifier au moment de copier les fichiers.

## Le thème

Deux thèmes, pilotés par `data-theme="sombre"` sur `<html>` (absent = clair).
Par défaut : **suivre Windows**, via `nativeTheme.shouldUseDarkColors`, avec
une bascule manuelle retenue dans les réglages. Le README le range dans « ce
qui n'est pas dessiné ».

Le thème doit à terme voyager jusqu'au HUD dans `etat.theme` — c'est le
chantier de `desktop/overlay.html`, pas celui-ci. On se contente ici de poser
la valeur dans l'état, prête à être lue.

## Les gardes à réécrire, jamais à retirer

Huit tests lisent `desktop/index.html` et deviendront rouges au découpage. Ce
ne sont pas des tests de décor : `pda-archi-panneau.test.js` existe parce que
le 04/09 une classe nommée `case` a hérité d'un `display: grid` posé ailleurs
et empilé verticalement les coches d'un archimonstre — le balisage était
juste, le code aussi, et rien dans le projet ne pouvait le dire.

Ils sont **réécrits sur les nouveaux fichiers**, jamais retirés :

- `test/pont-ipc.test.js` — **le plus important.** Il relève les appels
  `window.app.<nom>` et vérifie que `preload.js` expose chacun ; un canal
  manquant se voit comme un bouton qui « ne fait rien ». Il doit désormais
  balayer tout `desktop/vues/`, et non un seul fichier.
- `test/pepites-panneau.test.js` — la table `PEP` et le préfixe `pep-`
- `test/pda-archi-panneau.test.js` — son frère
- `test/souris-copie.test.js` — la copie de `src/comptes/raccourcis.js`,
  qui part dans `vues/commun/touches.js`
- `test/droits-noms-references.test.js`
- `test/interface-locale-etat.test.js` — connaît la forme que lit
  `ouvrirEcartes()`
- `test/interface-locale-serveur.test.js` — vérifie l'injection du shim
  avant le premier `<script>` de la page

Un huitième change de nature. `test/interface-locale-app.test.js:232`,
« faux-app.js ne se dispute aucun nom global avec le script d index.html »,
garde une collision que les modules rendent **impossible**. Il ne devient pas
faux, il devient sans objet : à réduire au seul périmètre qui partage encore
une portée — `faux-app.js` et l'éventuel script classique de l'ossature — avec
un commentaire disant pourquoi il a rétréci. Le supprimer sans cette note
ferait disparaître la mémoire d'un bug qui a coûté une page blanche.

`test/paquet-fichiers.test.js` deviendra rouge tout seul tant que `skin/` et
`vues/` ne seront pas ajoutés à `DOSSIERS_DESKTOP` dans
`outils/faire-etape.js`. C'est exactement son métier : on le laisse faire, et
on ne touche pas au test.

`outils/interface-locale.js` injecte `<script src="/faux-app.js"></script>`
avant le premier `<script>` de la page, retrouvé par recherche. L'ossature
devra continuer d'offrir ce point d'accroche.

## Les pictos du jeu

Règle du §2 du README : partout où un picto d'Ankama dit la chose, c'est lui
qu'on emploie. Hôte **DofusDB beta**, jamais embarqué. `src/comptes/emblemes.js`
connaît déjà les deux hôtes. Si l'image ne charge pas, la classe `.sans-pic`
rend la main au dessin OMNI : **un picto absent est un défaut d'agrément, pas
une panne.**

## L'ordre, et les points d'arrêt

Chaque étape se termine sur `npm test` vert et une recette sur `npm run banc`
(1 097 × 720 en iframe), avant qu'on passe à la suivante.

0. **L'ossature** — jetons, polices embarquées, rail, deux thèmes, barre du
   haut, bandeaux d'erreur. Rien de branché.
1. **Raccourcis** — le README le demande en premier.
2. **Archimonstres** — le plus gros module, mais autonome.
3. **Hôtel de vente** et ses trois onglets.
4. **Réglages**.
5. **Les gardes réécrites**, `npm test` vert, recette en vrai Electron
   (`npm run app`).

## Hors périmètre

- Le HUD (`labo-omni/hud.html` vers `desktop/overlay.html`) : son propre
  chantier, avec le tableau de correspondance du §4 du README comme contrat.
- L'icône (`labo-omni/icone.html` vers l'`.ico` Windows) : son propre chantier.
- L'écran Courses : la fonction n'existe pas.
- `src/` : on n'y touche pas.
