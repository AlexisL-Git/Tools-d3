# Refonte graphique OMNI

## Changement 1 - Raccourcis devient le premier onglet

- [x] Confirmer l'ecran vise par son titre visible.
- [x] Valider la nouvelle structure de navigation.
- [x] Faire de Raccourcis l'ecran actif au chargement.
- [x] Conserver l'epee sur le premier bouton et la relier a Raccourcis.
- [x] Supprimer l'ancien bouton clavier et l'ecran Ma flotte.
- [x] Mettre a jour les textes qui annoncent six ecrans.
- [x] Verifier la navigation et les pictos dans le navigateur.

## Review

Implementation terminee dans `labo-omni/app.html`, avec mise a jour de la
presentation dans `labo-omni/index.html`.

- Assertions statiques : OK.
- Serveur local `http://localhost:8731/app.html` : HTTP 200.
- Capture Chrome 1400 x 900 : Raccourcis visible au chargement, epee active,
  bouton clavier absent, Reglages conserve en bas.
- Suite globale : 1 175 tests passent, 20 echecs preexistants lies a une
  dependance serveur absente, aux sockets bloquees dans le bac a sable et au
  chemin temporaire macOS.
