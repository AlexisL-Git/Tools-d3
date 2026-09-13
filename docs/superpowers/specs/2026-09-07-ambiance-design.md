# Ambiance sonore — conception

Un son court se declenche a intervalle aleatoire pendant qu'OMNI tourne, chez
un ami et un seul, allume et eteint a distance sans republier.

## Ce qui existe deja et qu'on reutilise

- **Les droits par cle.** `src/droits/liste.js` enumere les fonctions
  verrouillables, `serveur-maj/lib/fonctions.js` en tient la copie, et un test
  echoue si les deux divergent. Les droits sont des lignes en base, une par
  couple (cle, fonction) : une fonction neuve n'est accordee a personne tant
  que la case n'est pas cochee dans le panneau. C'est exactement le ciblage
  demande.
- **La veille.** `src/droits/veille.js` interroge `/api/droits` toutes les
  **60 s** et appelle `onChangement({ gagnes, perdus, droits })`. Retirer la
  case coupe le son en moins d'une minute.
- **Le fabricant de paquet.** `outils/faire-paquet-code.js` embarque tout ce
  qui vit sous `desktop/` et `src/`, sans filtre d'extension, en lisant chaque
  fichier en `Buffer`. `amorceur/archive.js` ecrit et relit du binaire sans le
  denaturer. Un `.ogg` passe tel quel.

## Le fichier son

`desktop/sons/ping.ogg`, copie de `C:\Users\Utilisateur\Desktop\ping.ogg` :
**11 881 octets**, Ogg **Opus** stereo 48 kHz. Chromium le lit nativement, donc
Electron aussi. Le paquet passe de ~520 Ko a ~532 Ko : negligeable.

Le chemin fait 22 caracteres, loin des 100 que l'en-tete tar accepte.

## Les pieces

### 1. La fonction verrouillable

Onzieme entree, ajoutee a l'identique dans les deux listes :

```js
{ nom: 'ambiance', libelle: 'ambiance sonore' },
```

Libelle neutre : le panneau d'administration affiche cette chaine, et
« ambiance sonore » ne raconte rien.

### 2. `src/ambiance.js` — la minuterie

Une fabrique sans dependance a Electron :

```js
creerAmbiance({ jouer, minMs, maxMs, planifier = setTimeout,
                arreter = clearTimeout, tirage = Math.random })
  -> { demarrer(), stopper(), enMarche() }
```

`demarrer()` tire un delai dans `[minMs, maxMs]`, le programme, appelle
`jouer()` a l'echeance, puis se reprogramme. `stopper()` annule le minuteur en
attente. Les deux sont idempotents : `demarrer()` deux fois de suite ne fait
pas tourner deux minuteries.

`planifier` et `tirage` sont injectes pour que les tests soient deterministes,
comme `chercher` l'est deja dans `src/droits/veille.js`.

Reglages retenus : une **rafale de 3 sons** espaces de **2,5 s**, tous les
**15 a 25 minutes** (tire au hasard, pour que le rendez-vous ne tombe jamais a
heure fixe).

L'ecart de 2,5 s n'est pas arbitraire : `ping.ogg` dure **1,88 s**, et
l'element `<audio>` est unique avec sa tete de lecture remise a zero a chaque
coup. A une seconde d'ecart, chaque son couperait le precedent et on
entendrait un bruit long au lieu de trois sons.

Le cycle suivant est arme **apres le dernier coup** de la rafale : il n'y a
donc jamais plus d'un minuteur en vol, et `stopper()` ne peut pas laisser un
coup orphelin derriere lui.

### 3. `desktop/main.js` — le branchement

- On cree l'ambiance au demarrage, avec `jouer` qui envoie
  `fenetre.webContents.send('ambiance')`.
- On la demarre ou on l'arrete depuis le `onChangement` de la veille, selon
  `droits.includes('ambiance')`, et une fois au premier etat connu.
- La minuterie ne demarre pas si `OMNI_DEV` est pose, sauf si
  `OMNI_AMBIANCE=1` l'exige.
- L'avis affiche par `onChangement` **ne nomme pas** `ambiance` : sans ce
  filtre, « Droits : ambiance — active » s'affiche chez l'ami au moment ou on
  coche la case.

**Pourquoi la minuterie ici et pas dans la page.** Electron ralentit les
minuteries des fenetres reduites ou masquees, pour economiser la batterie. La
fenetre principale d'OMNI passe sa vie derriere le jeu. Une minuterie dans la
page derivera ou dormira ; cote Node, elle ne dort pas.

**Pourquoi pas derriere `creerPorte`.** `src/droits/porte.js` filtre des
gestes declenches par une trame de jeu. Ici rien n'arrive du jeu : c'est une
minuterie qu'on allume et qu'on eteint. La porte ne s'applique pas.

### 4. `desktop/preload.js` — un canal, en reception seule

```js
surAmbiance: (rappel) => ipcRenderer.on('ambiance', () => rappel()),
```

L'avertissement en tete du fichier demande qu'on ne l'elargisse pas sans
raison. Celui-ci n'expose ni reseau, ni disque, ni processus : il previent que
l'heure est venue, sans porter de donnee.

### 5. `desktop/index.html` — la lecture

Une balise cachee, `<audio id="ambiance" src="sons/ping.ogg" preload="auto">`,
et le branchement :

```js
window.app.surAmbiance(() => {
  const a = document.getElementById('ambiance');
  a.volume = 0.5;
  a.currentTime = 0;
  a.play().catch(() => {});   // un echec de lecture ne casse rien
});
```

Remettre `currentTime` a zero evite qu'un son deja joue reste muet. Le `catch`
absorbe le refus de lecture automatique : si le son ne part pas, l'application
n'en sait rien et continue.

## Le mode developpement

Lance depuis le depot sans passer par l'amorceur, le code s'accorde **tous les
droits** sans requete (`src/droits/veille.js`). Le son se declencherait donc
aussi sur la machine de developpement.

`outils/lancer-dev.vbs` pose deja `OMNI_DEV` a la racine du depot : c'est
exactement le signal « ceci n'est pas un poste ami ». L'ambiance ne demarre
donc pas quand `OMNI_DEV` est present. Pour l'essayer soi-meme malgre tout,
`OMNI_AMBIANCE=1` passe outre. Aucun fichier de lancement a modifier.

## Discretion

- **Pas d'entree au devlog** pour cette version. Le devlog s'affiche dans
  l'application.
- **L'avis de changement de droit est filtre** (voir plus haut). C'est la
  seule fuite trouvee dans l'interface : `desktop/index.html` ne fait
  qu'interroger des noms precis (`hdv`, `vente`, `overlay`...), il n'affiche
  jamais la liste des droits.
- Libelle neutre dans le panneau (voir plus haut).
- Le message de commit ne nomme pas la cible.

Le code, lui, part dans le depot. Quiconque a acces au depot peut le lire.

## Tests

- `test/ambiance.test.js` : le delai tombe dans les bornes ; `jouer` est
  appele a l'echeance ; la minuterie se reprogramme ; `stopper()` annule ;
  `demarrer()` deux fois n'en lance qu'une. Minuterie et tirage injectes,
  aucun temps reel.
- `test/droits-liste.test.js` : deja ecrit, il verifie que les deux listes de
  fonctions restent identiques.
- Les 1231 tests existants doivent rester verts.

## Ce qu'on ne fait pas

- Pas de banque de sons ni de tirage entre plusieurs fichiers : un son suffit.
- Pas de reglage de volume ni d'intervalle dans l'interface.
- Pas de telechargement du son depuis le serveur : 12 Ko dans le paquet
  coutent moins cher qu'une voie reseau de plus.

## La marche a suivre, une fois le code livre

1. Publier la version (le chemin habituel : paquet, verification, mise en
   ligne).
2. Attendre qu'Ilan l'ait installee.
3. Panneau d'administration : cocher **ambiance sonore** sur sa ligne, et sur
   la sienne seule.
4. Pour arreter : decocher. Le son se tait dans la minute.
