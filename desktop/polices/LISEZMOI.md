# Polices embarquées

Deux fichiers, sous-ensemble **latin** uniquement, récupérés depuis Google Fonts.

| fichier | famille | licence |
|---|---|---|
| `cal-sans.woff2` | Cal Sans, une seule graisse (400) | SIL Open Font License 1.1 |
| `karla.woff2` | Karla, variable 200 à 800 | SIL Open Font License 1.1 |

**Pourquoi ici et pas depuis Google.** OMNI doit démarrer sans réseau : un
`<link>` vers `fonts.googleapis.com` ferait retomber l'interface sur une police
système au premier lancement hors ligne, et chez un ami derrière un pare-feu.
Les deux fichiers pèsent ensemble moins de 60 Ko, sans commune mesure avec le
paquet.

**La redistribution est explicitement permise** par l'OFL, contrairement aux
emblèmes de classe d'Ankama, qui eux ne sont pas embarqués et restent
téléchargés puis mis en cache sur la machine de chacun.

Cal Sans n'existe qu'en graisse 400 : ne jamais lui demander de gras, le
navigateur le synthétiserait et l'empâterait.
