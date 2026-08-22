# Mise à jour automatique et distribution à des tiers

**Date :** 2026-08-23
**Statut :** conçu et validé, non implémenté.

## Le besoin

L'utilisateur veut donner l'application à quelques amis, et que **ses mises à
jour arrivent chez eux sans qu'ils aient rien à faire**. Aujourd'hui, publier
une correction voudrait dire redistribuer 482 Mo à la main, à chacun, à chaque
fois.

## Ce que la mesure du paquet impose

| morceau | poids | change ? |
|---|---|---|
| runtime Electron | ~345 Mo | jamais |
| binding natif de Frida (`app.asar.unpacked`) | ~113 Mo | quasi jamais |
| **notre code + dépendances JS (`app.asar`)** | **12,2 Mo** | **à chaque publication** |
| **total** | **482 Mo** | |

**Seuls 2,5 % du paquet bougent.** Tout le reste est du lest. Une mise à jour
qui ne transporte que notre code coûte 12 Mo au lieu de 482.

## Ce que ce mécanisme NE protège PAS, et qui doit être dit

**Le code n'est pas cachable à ceux qui reçoivent l'application.** Un `.asar`
est une archive triviale à ouvrir. Un ami qui a le dossier a le code, avant
même qu'on parle de mise à jour. Aucun hébergement n'y change quoi que ce soit :
le canal ne fait que transporter ce qu'ils possèdent déjà.

Ce qui est réellement obtenu :

- **contre un inconnu :** rien d'indexé, aucun dépôt public, une URL non listée
  et un secret partagé. Efficace.
- **contre un ami curieux :** le code est compilé en **bytecode V8**. Ce n'est
  pas un mur — krm35 fait exactement cela, et récupérer le sien a coûté une
  séance entière en scannant le tas V8 — mais c'est un obstacle sérieux.

**Le secret partagé est extractible de l'application.** Il arrête les robots et
les curieux de passage, pas quelqu'un de déterminé qui a le binaire. C'est une
propriété du modèle, pas un défaut d'implémentation.

**Ce qui est publié s'exécute chez les autres.** Une erreur se propage à tout le
monde au lancement suivant, avec Frida injecté dans leur client de jeu : leurs
comptes portent le risque de ce qui est publié. C'est la raison d'être du retour
arrière automatique et du coupe-circuit, plus bas.

## Décisions prises

1. **Première installation manuelle**, mises à jour automatiques. Le paquet de
   482 Mo est donné une fois.
2. **Canal : Vercel**, projet séparé, URL non listée, secret partagé.
3. **Code compilé en bytecode V8.**
4. **Mise à jour bloquante au lancement**, avant l'ouverture de la fenêtre.
   Quelques secondes sur 12 Mo, et seulement les jours de publication. Garantie
   forte : personne ne joue avec une version périmée — ce qui compte quand une
   trame du jeu change et casse l'ancienne.

## Architecture

### Le paquet ne bouge plus jamais

`resources/app.asar` ne contient plus que **l'amorceur**. C'est la seule pièce
non actualisable à distance : elle doit rester bête, courte et stable. Elle ne
dépend que de Node et d'Electron.

### Le code applicatif vit dehors

```
%APPDATA%\Replicate\
  versions\
    0.2.0\        code compilé de la version 0.2.0
    0.3.0\        code compilé de la version 0.3.0
    courante.json { version, essai, refusees }
```

Une version par dossier. Remplacer un dossier neuf ne verrouille rien —
contrairement à `app.asar`, que Windows garde ouvert tant que l'application
tourne. C'est ce qui rend la mise à jour possible sans manœuvre acrobatique.

### La séquence de démarrage

```
1. lire versions/courante.json
2. si un témoin d'essai est resté  → la version a planté au lancement
                                     précédent : revenir à la précédente et
                                     inscrire la fautive dans `refusees`
3. interroger le manifeste         → délai d'attente 5 s
4. version plus récente disponible → télécharger, vérifier le SHA-256,
                                     extraire dans versions/<nouvelle>/
5. poser le témoin d'essai
6. require() l'entrée de la version courante
7. l'application atteint son état prêt → effacer le témoin
```

Une version inscrite dans `refusees` n'est plus jamais chargée, même si le
manifeste continue de l'annoncer. Elle ne redevient candidate que si le
manifeste publie un numéro supérieur.

### Les dépendances restent dans le paquet

`frida`, `protobufjs` et Electron ne se mettent pas à jour. Le code versionné
les résout depuis le `node_modules` du paquet. **Changer une dépendance impose
donc de redistribuer les 482 Mo** — cas rare et assumé.

### La version initiale est embarquée

Le paquet contient le code de sa propre version, que l'amorceur installe dans
`versions/` au premier lancement. Un ami sans réseau, ou avec Vercel
injoignable, démarre quand même.

## Le canal

Deux fonctions sur un projet Vercel séparé :

```
/api/manifeste   → { version, url, sha256, actif, message }
/api/paquet      → l'archive du code compilé
```

Des fonctions plutôt que des fichiers statiques, pour pouvoir **exiger le secret
partagé et répondre 404 sans lui**.

**La protection de déploiement Vercel doit être désactivée sur ce projet.**
Active par défaut, elle renvoie une page de connexion d'environ 480 Ko à chaque
requête — les machines des amis téléchargeraient cette page au lieu du
manifeste. Le piège a déjà été payé sur `dofus-commerce`.

## Publier

```
npm run publier
  1. incrémenter la version dans package.json
  2. compiler src/ et desktop/ en bytecode V8
  3. fabriquer l'archive, calculer son SHA-256
  4. écrire le manifeste
  5. déployer sur Vercel
```

## Quand ça rate

Les amis n'auront pas de terminal pour comprendre. Chaque échec a donc un
comportement défini, et aucun ne laisse l'application morte.

| ce qui rate | ce qui se passe |
|---|---|
| Vercel injoignable, délai dépassé | démarre sur la version en place, sans bruit |
| manifeste illisible | idem |
| SHA-256 qui ne correspond pas | archive jetée, version en place conservée |
| extraction en échec | dossier partiel supprimé, version en place conservée |
| la nouvelle version plante au démarrage | retour automatique à la précédente, qui n'est plus réessayée |

### Le témoin d'essai

L'amorceur pose un témoin **avant** de charger une version neuve, et l'efface
quand l'application atteint son état prêt. Si au lancement suivant le témoin est
encore là, c'est que la version a planté avant d'y arriver : l'amorceur la
déclare mauvaise, reprend la précédente, et refuse de la réessayer.

**Sans ce mécanisme, une mauvaise publication rend l'outil définitivement mort
chez tout le monde**, sans aucun moyen de rattrapage à distance.

## Le coupe-circuit

Le manifeste porte `actif: false` et un message. L'application refuse alors de
démarrer et affiche ce message.

Le jour où une mise à jour de Dofus rend l'outil dangereux pour les comptes,
c'est le seul moyen d'arrêter tout le monde en une minute. Téléphoner à huit
personnes n'en est pas un.

## La version affichée

L'en-tête affiche la version en cours d'exécution. Quand un ami dit « ça marche
pas », le dépannage ne commence pas par une devinette.

## Périmètre

**Dedans :** l'amorceur, le stockage versionné, le client de mise à jour, les
deux fonctions Vercel, le script de publication, le coupe-circuit, la version
affichée.

**Dehors :** l'installateur (la première installation reste manuelle), la mise à
jour des dépendances natives, la signature de code, les canaux multiples
(bêta/stable), la télémétrie.

## Critères de réussite

1. Un ami lance l'application : elle démarre sur la version embarquée, sans
   réseau requis.
2. L'utilisateur publie une version : au lancement suivant, l'ami l'obtient sans
   rien faire, et l'en-tête affiche le nouveau numéro.
3. Vercel injoignable : l'application démarre quand même, sur la version en
   place.
4. Une archive corrompue est rejetée sur son SHA-256 et ne remplace rien.
5. Une version qui plante au démarrage est abandonnée toute seule au lancement
   suivant, qui repart sur la précédente.
6. `actif: false` empêche le démarrage et affiche le message.
7. Un inconnu sans le secret reçoit 404 sur les deux points d'entrée.
8. `npm test` passe et imprime son total.

## Pièges connus, à ne pas repayer

- **La protection de déploiement Vercel** est active par défaut (voir plus haut).
- **`electron-builder` est interdit sur cette machine.** Le paquet se fabrique
  avec `@electron/packager`, déjà en place. `npm install` n'exécute pas les
  postinstall : `node node_modules/electron/install.js` reste obligatoire.
- **L'amorceur ne peut pas se mettre à jour lui-même.** Toute erreur dedans se
  corrige en redistribuant 482 Mo. Il doit rester minimal et être relu comme tel.
- **Un `.node` natif ne se charge pas depuis une archive asar.** C'est pour cela
  que `app.asar.unpacked` existe. Le code versionné doit résoudre ses
  dépendances vers le `node_modules` du paquet, pas en embarquer une copie.
- **Une route d'API Vercel ne doit avoir qu'un seul segment.** `api/[...path].js`
  ne reçoit pas `/api/a/b` et rend un 404 vide venant de Vercel, alors que ça
  marche en local. D'où `/api/manifeste` et `/api/paquet`, à plat.
