# Raccourcis comme premier onglet

## Objectif

Supprimer l'ecran `Ma flotte`, juge inutile, et faire de l'ecran
`Tes huit touches, et ce que chacun suit` le premier ecran de la maquette.

## Navigation validee

- Le premier bouton du rail conserve l'illustration d'epee du Iop.
- Ce bouton ouvre desormais l'ecran Raccourcis.
- L'ancien bouton Raccourcis avec l'icone clavier disparait.
- Le bouton Reglages reste ancre en bas du rail et conserve son comportement.
- Les onglets Courses, Hotel de vente et Archimonstres ne changent pas.

## Contenu

Le contenu de `Ma flotte` est supprime sans reprise. Le contenu et la mise en
page de Raccourcis restent inchanges pour cette etape. Le changement porte
uniquement sur sa position et son statut d'ecran par defaut.

## Verification

- Au chargement, Raccourcis est visible et l'epee est active.
- Cliquer les quatre autres boutons affiche le bon ecran.
- Revenir sur l'epee affiche Raccourcis.
- Il ne reste ni bouton clavier ni ecran `Ma flotte` dans la maquette.
- L'illustration d'epee charge toujours depuis DofusDB, avec le dessin de
  secours actuel en cas d'echec.
