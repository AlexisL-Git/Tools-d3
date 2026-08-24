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

## Publier une mise a jour aux amis

Rien ne part tant que la derniere etape n'est pas faite a la main.

```powershell
npm test                                   # 416 tests, doit imprimer son total
npm version patch --no-git-tag-version     # 0.2.3 -> 0.2.4

$env:ELECTRON_RUN_AS_NODE = '1'
.\desktop\dist\OMNI-win32-x64\OMNI.exe outils\faire-etape.js
$env:ELECTRON_RUN_AS_NODE = ''
# note le sha256 affiche

cd serveur-maj
node publier.js ..\desktop\dist\code-0.2.4.tar.gz 0.2.4
npx vercel deploy --prod --yes             # l'archive part EN LIGNE d'abord
```

Puis, dans le panneau <https://paquets-maj.vercel.app/api/admin>, bloc
**Publier une version** : coller la version et le sha256, valider. C'est ce
clic, et lui seul, qui bascule les amis sur la nouvelle version a leur
prochain lancement.

L'ordre n'est pas negociable : deployer l'archive AVANT de basculer le
manifeste. L'inverse ferait pointer les amis sur une archive absente.

## Refabriquer le paquet a donner (480 Mo)

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
