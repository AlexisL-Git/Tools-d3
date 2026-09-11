# OMNI

Launcher multi-compte pour Dofus 3. Duplication d'actions, passe-tour,
acceptation des invitations et des echanges, no-anim.

Ce fichier ne decrit qu'une chose : **comment travailler dessus sans rien
casser chez les amis**. La conception vit dans `docs/superpowers/`.

## Travailler en local, sans rien publier

```powershell
$env:OMNI_DEV = 'C:\Users\Utilisateur\mm'
.\desktop\dist\OMNI-win32-x64\OMNI.exe
```

L'application charge alors **le code du depot tel quel** : pas de cle demandee,
pas d'interrogation du service, pas de mise a jour. L'en-tete affiche `dev`.
Modifier un fichier et relancer suffit.

Sans `OMNI_DEV`, la meme application se comporte comme chez un ami : elle
demande une cle, interroge le service, et charge la version installee dans
`%APPDATA%\OMNI\versions\`. **C'est pour cela que modifier le depot ne change
rien a l'ecran en mode normal.**

`npm run app` ne fonctionne pas sur cette machine : Smart App Control refuse
`node_modules\electron\dist\electron.exe`, qui n'est pas signe. Le binaire
produit par le packaging, lui, passe — d'ou la commande ci-dessus.

## Voir l'interface sans lancer le jeu

```powershell
node outils\interface-locale.js   # http://localhost:8787
```

Un banc d'essai: la page d'OMNI servie en HTTP avec un **faux etat** — six
comptes fictifs couvrant les six etats, aucune connexion a Dofus. Les cases
cochent, le maitre change, le tableau des archimonstres se construit. Utile
pour travailler la mise en page sans refabriquer le paquet ni ouvrir un seul
client.

L'onglet affiche l'application **cadree a 1097x720**, la taille exacte de la
vraie fenetre, centree sur un fond sombre — et non etiree sur la largeur du
panneau, ou la mise en page ne ressemble a rien de ce qu'on verra a l'ecran.
Un panneau plus etroit la reduit sans la deformer; le bouton en bas a droite
affiche le taux et bascule en 1:1. La page nue, sans cadre, reste sur
`/index.html`.

VS Code lance ce serveur tout seul a l'ouverture du dossier
(`.vscode/tasks.json`); il demande **une fois** d'autoriser les taches
automatiques du dossier. L'onglet, lui, s'ouvre a la main la premiere fois —
`Ctrl+Shift+P`, « Simple Browser: Show », `http://localhost:8787` — et VS Code
le restaure ensuite a chaque reouverture.

Ce banc ne rejoue aucune regle metier: cocher « passe-tour » y coche une case,
rien de plus. Il ne part pas dans le paquet des amis (`outils/` n'est pas
emporte par `faire-paquet-code.js`).

## Publier une mise a jour aux amis

Rien ne part tant que la derniere etape n'est pas faite a la main.

```powershell
npm test                                   # 416 tests, doit imprimer son total
npm version patch --no-git-tag-version     # 0.2.3 -> 0.2.4

$env:ELECTRON_RUN_AS_NODE = '1'
.\desktop\dist\OMNI-win32-x64\OMNI.exe outils\faire-etape.js
$env:ELECTRON_RUN_AS_NODE = ''
# produit desktop\dist\code-0.2.4.tar.gz
```

Puis, dans le panneau <https://paquets-maj.vercel.app/api/admin>, bloc
**Publier une version** : deposer cette archive avec le bouton **televerser**.
Le serveur calcule lui-meme l'empreinte — rien a recopier a la main. Ce
televersement seul ne change encore rien pour les amis : c'est le clic sur
**activer**, en face de la ligne de version dans le tableau, qui bascule le
manifeste et fait passer les amis sur cette version a leur prochain
lancement.

Aucun redeploiement Vercel n'est necessaire pour publier : l'archive est
stockee en base par le televersement, et `/api/paquet` la sert de la.

Revenir en arriere consiste a cliquer **activer** sur une ligne plus
ancienne du meme tableau.

## Refabriquer le paquet a donner (480 Mo)

Necessaire aussi apres tout changement de l'amorceur — par exemple la remontee
d'etat ajoutee le 2026-08-25 : tant qu'un ami n'a pas le nouveau paquet, il
fonctionne normalement mais ne remonte rien, et sa ligne du panneau reste a
`—`.

Necessaire seulement quand l'amorceur, Electron ou une dependance changent —
le code applicatif, lui, se met a jour tout seul.

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
.\desktop\dist\OMNI-win32-x64\OMNI.exe outils\faire-etape.js
$env:ELECTRON_RUN_AS_NODE = ''
npm run pack
Compress-Archive desktop\dist\OMNI-win32-x64 desktop\dist\OMNI-<version>.zip
```

Televerser l'archive chez un hebergeur, puis coller son adresse https dans le
panneau, bloc **Lien de telechargement**. Les amis n'ont qu'une adresse a
connaitre : <https://paquets-maj.vercel.app/api/telecharger>, plus leur cle.

## Pieges deja payes

- **Fermer l'application avant de refabriquer** : elle tient ses fichiers, et
  le packaging echoue a mi-chemin en laissant un dossier abime.
- **Aucune jonction `node_modules` dans le dossier d'etape.** Une suppression
  recursive la traverse et vide le `node_modules` du depot. Les dependances de
  production y sont copiees, jamais liees.
- **Si `node_modules` disparait** : `npm install`, puis
  `node node_modules/electron/install.js` — les scripts de post-installation ne
  sont pas executes sur cette machine.
- **Le bytecode V8 est desactive** (`OMNI_BYTECODE=oui` pour le reactiver). Le
  processus graphique d'Electron refuse un cache produit ailleurs : compile en
  mode Node, le paquet ouvre une fenetre « Error » sans un mot.
- **Le journal de l'amorceur est dans `%APPDATA%\OMNI\amorceur.log`.** Un
  executable package n'a pas de console : sans ce fichier, toute panne au
  demarrage est muette.
- **Lancer OMNI AVANT les clients Dofus.** Un client deja connecte ne peut plus
  etre intercepte.
