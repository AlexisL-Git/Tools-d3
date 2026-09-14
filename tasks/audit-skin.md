# Brief — audit du skin d'OMNI

> À coller dans une session neuve, ouverte sur `/Users/jibb/mm`.
> Branche : `feat/refonte-graphique`.

---

Tu fais l'audit graphique d'OMNI. Rends un rapport, ne modifie aucun fichier.

## Le cadre, à lire avant tout

**On ne s'occupe que du skin.** La refonte graphique est faite en maquettes HTML
autonomes, dans `labo-omni/`. Un développeur, Alexis, les implémentera ensuite
dans la vraie application. Ton audit sert à ce que ce qu'on lui livre soit juste
et complet.

Ce qui découle de ça, et qui n'est pas négociable :

- **N'audite pas le code de l'application.** `src/`, `amorceur/`, `serveur-maj/`,
  les tests, l'architecture Node : hors sujet. N'y touche pas, n'en parle pas.
- **Ne recommande aucun refactor, aucune techno, aucune dépendance.** Tes
  recommandations doivent être des **décisions de design**, exprimables dans une
  maquette : une couleur, une taille, une hiérarchie, un écran qui fusionne avec
  un autre, un état qui manque.
- **Tu es sur un Mac ; OMNI est une application Windows** qui s'injecte dans le
  client Dofus. Elle ne tournera jamais ici, et ce n'est pas un problème : les
  maquettes s'ouvrent dans un navigateur. Ne propose pas de lancer l'app.
- **Le livrable est destiné à un développeur.** Une remarque qu'Alexis ne peut
  pas appliquer sans te redemander ce que tu voulais dire ne vaut rien.

## Le produit, en trois phrases

OMNI est un outil desktop pour un joueur de Dofus qui pilote 8 comptes en
parallèle : un personnage « mène », les autres recopient ses actions. Il
automatise aussi les courses en hôtel de vente, la mise en vente et la remise à
prix, et le suivi des archimonstres.

L'utilisateur est **une seule personne**, experte de son jeu, qui garde cet écran
ouvert **pendant qu'elle joue** — donc en vision périphérique, entre deux
combats, sur un second écran. Ce n'est pas un tableau de bord qu'on contemple :
c'est un poste de pilotage qu'on consulte d'un coup d'œil. Juge tout à cette
aune-là.

## Le terrain

Lance `node labo-omni/serveur.js 8731` et ouvre `http://localhost:8731/` :
la page d'accueil du labo présente et commente chaque maquette. **Lis-la en
premier**, elle porte l'historique des décisions et dit ce qui est validé, ce
qui est à refaire et ce qui a été rejeté.

| Fichier | Ce que c'est | Statut |
|---|---|---|
| `labo-omni/app.html` | **la maquette de référence** — les six écrans, cliquables, en thème clair et sombre | la plus avancée |
| `labo-omni/icone.html` | l'icône, de 96 à 16 px, barre des tâches et bureau | validé |
| `labo-omni/identite.html` | la planche d'identité : symboles, palette, métier de chaque couleur, les deux polices, les briques | **à refaire** — porte encore l'ancienne palette rejetée |
| `labo-omni/ecran.html` | l'écran d'accueil à la taille exacte de la vraie fenêtre | **à refaire** — ancienne palette |
| `labo-omni/a-rangee.html`, `b-plein-jour.html`, `c-huit-couleurs.html` | la première passe, **rejetée**, gardée pour mémoire | mort |
| `labo-omni/clair.html`, `couleurs.html`, `oeil.html` | orphelins, non liés depuis l'accueil du labo | à qualifier |
| `desktop/index.html` | **le skin actuellement en production** — celui que la refonte remplace | référence |

`app.html` est autonome : tout le CSS est dans son `<head>`, les commentaires du
code portent les intentions de conception — lis-les, ils font partie de ce que
tu audites.

Contraintes déjà posées dans la maquette : deux thèmes (clair et sombre, par
`data-theme` sur la racine), fenêtre de 1097 px de large, deux polices
(`Outfit` pour les titres, `Plus Jakarta Sans` pour l'interface), et une règle de
couleur annoncée ainsi : *le jaune pour ce qui mène et ce qui tourne, le noir
pour ce qui réclame ton attention, le clair pour tout ce qui va bien.*

## Ce que je veux savoir

### 1. La règle de couleur tient-elle ?
Elle est énoncée en toutes lettres. Vérifie-la **écran par écran** dans
`app.html`. Où est-elle trahie ? Un jaune qui ne mène rien, un noir qui n'alerte
de rien : cite l'élément et la ligne. Puis dis si la règle elle-même est bonne.

### 2. L'architecture des six écrans
Ma flotte · Courses · Hôtel de vente · Archimonstres · Raccourcis · Réglages.
Pour chacun : **quelle information n'existe QUE là ?** Sois impitoyable sur les
redites entre écrans. Six écrans est-il le bon compte ? Faut-il en fusionner,
en couper, en ajouter ? Argumente depuis l'usage — quelqu'un qui joue et jette
un œil — pas depuis un principe général.

### 3. La hiérarchie visuelle
Sur chaque écran, qu'est-ce que l'œil voit en premier ? Est-ce bien la chose la
plus importante ? Là où ça ne l'est pas, dis quoi changer : taille, poids,
couleur, position, espace.

### 4. Densité et lisibilité en usage réel
1097 px de large, sur un second écran, regardé en vision périphérique. Est-ce
trop dense, pas assez ? Les tailles de texte tiennent-elles à cette distance ?
Y a-t-il des zones où l'on ne distingue plus rien d'un coup d'œil ?

### 5. La cohérence du système
`identite.html` est marquée « à refaire » : elle décrit une palette rejetée.
Autrement dit, **le système documenté ne correspond plus à la maquette**.
Dis ce que la nouvelle planche d'identité devrait contenir pour décrire
fidèlement `app.html` : couleurs et leur métier, échelle typographique,
rayons, espacements, les briques qui reviennent. C'est ce document qu'Alexis
lira en premier.

### 6. Ce qui manque pour implémenter
**C'est la partie la plus utile, ne la bâcle pas.** Une maquette montre le cas
heureux ; un développeur a besoin de tout le reste. Liste ce qui n'est pas
spécifié et qu'Alexis devra inventer s'il ne l'a pas :
états vides, chargement, erreur, survol, focus clavier, texte trop long,
nombres qui débordent, un seul personnage au lieu de huit, une liste à zéro
élément, ce que devient l'écran quand le jeu n'est pas lancé.
Pour chaque manque : où il apparaîtrait, et ce que tu proposes.

### 7. L'écart avec l'existant
Compare `desktop/index.html` (en production) et `app.html` (la refonte).
La refonte règle-t-elle les vrais défauts de l'actuel, ou change-t-elle
seulement l'habillage ? Et surtout : **y a-t-il quelque chose d'utile dans
l'actuel que la refonte a perdu en route ?**

### 8. Le plan
Ce que tu ferais, dans l'ordre, chaque point avec son gain et son coût, classé
par gain net décroissant. Sépare clairement **ce qui doit être décidé avant de
livrer à Alexis** de ce qui peut attendre une passe suivante.

## Les règles

- **Chaque affirmation s'appuie sur quelque chose que tu as vu.** Fichier et
  ligne, ou capture de la maquette dans le navigateur. Une remarque qu'on
  pourrait écrire sans avoir ouvert le dépôt sera ignorée.
- **Zéro flatterie.** Je cherche ce qui cloche, pas à être rassuré.
- **Pas de généralités de design.** « Améliorer la hiérarchie », « penser au
  contraste », « soigner l'accessibilité » : sans cible et sans valeur proposée,
  c'est du vide.
- **Chaque reproche vient avec sa proposition.** Dire qu'une tuile est mal
  placée sans dire où la mettre ne sert à rien.
- **Un seul utilisateur, une seule machine.** Rien qui suppose une équipe, des
  rôles, ou du multi-utilisateur.
- **Dis ce que tu n'as pas pu vérifier.** Un doute nommé vaut mieux qu'une
  certitude inventée.
- **Ne modifie rien.** Lecture seule. Le rapport est le livrable.
