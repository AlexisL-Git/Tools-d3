# No-anim « Safe » — suppression des animations de déplacement en combat

**Date :** 2026-08-21
**Statut :** implémenté et **validé en jeu le 2026-08-22**. Les combattants
apparaissent à leur case d'arrivée sans marcher, le combat reste jouable de bout
en bout, et le compte laissé décoché garde ses animations normales.

Vérifié dans le même essai, avant d'allumer quoi que ce soit : le Replicate
duplique toujours, et le passe-tour a émis 38 fois. La garantie « inerte par
défaut » tient donc en conditions réelles, pas seulement en test.

**Une limitation assumée, née d'un défaut trouvé en revue finale.** Le no-anim
ne prend effet que sur les connexions **ouvertes après son activation**. Armer
une connexion déjà en cours faisait reprendre la lecture du flux à un décalage
arbitraire : la connexion gelait **sans un mot**. Elle est désormais refusée
définitivement, et le journal le dit :

```
no-anim (connexion 3392/34) : connexion deja en cours au moment de
l'armement, relayee telle quelle definitivement
```

En pratique : cocher la case, puis lancer le client.

## Le besoin

Jouer plus vite en combat. Aujourd'hui, chaque déplacement d'un combattant est
animé case par case, et le tour ne progresse qu'une fois l'animation finie. On
veut que les combattants apparaissent directement à leur case d'arrivée.

C'est une des fonctions du launcher de krm35, où elle s'appelle « No anim ».

## Périmètre

**Le « Safe » et lui seul.** Chez krm35, trois variantes coexistent (`noAnim`,
`noAnimSafe`, `noAnimUltra`) ; « Ultra » supprime en plus les effets visuels des
sorts. La mesure du 21/08 n'a **pas** réussi à observer ce que fait Ultra : sur
1193 trames capturées avec Ultra actif, aucune trame d'effet de sort n'était
retenue, et la transformation observée était identique à celle de Safe. La
question reste ouverte, et l'utilisateur a explicitement limité le périmètre à
Safe.

Hors périmètre également : Dofus Retro. La variante Unity (`noAnimUnity` chez
eux) est la seule concernée.

## Ce que la mesure établit

Mesuré le 21/08 en observant le proxy de krm35 (`jklshdj.exe`, pid 6228, port
local 8103) par `src/cli/proxy-tap.js`, sur deux captures de 60 s, l'une en
Safe, l'autre en Ultra.

### Le no-anim est réseau, pas graphique

Trois scans mémoire du client Dofus (avec Safe actif, puis en combat) n'ont
trouvé **qu'une seule** région de source JavaScript : leur agent d'injection,
qui ne contient ni `anim`, ni `speed`, ni `timeScale`, ni `fight`. Aucun second
script IL2CPP n'est chargé, malgré le symbole `il2cppScript` présent dans leur
proxy.

La transformation a lieu **dans leur proxy**, sur le flux descendant. Le sens
client → serveur est relayé à l'octet près : 0 différence sur 30 trames.

### La transformation — version corrigée le 2026-08-21 après mesure

> **Ce qui suit dans cette section a été mesuré une seconde fois et RÉFUTÉ.**
> La règle réelle est établie dans
> `2026-08-21-trames-deplacement-combat.md` et se résume ainsi :
>
> **`jsj` porte le chemin d'un déplacement dans son champ 1, sous forme de
> varints empaquetés (une case chacun). Le no-anim insère, juste avant ce
> `jsj`, une trame `jwe` d'action 4 posant l'acteur sur la dernière case du
> chemin, puis relaie le `jsj` sans le modifier.** Vérifié sur 48 poses sur 51.
>
> Aucune trame n'est retirée. Il n'y a **aucun état à maintenir** : tout ce
> qu'il faut est dans la trame qui déclenche la transformation. Le trou
> « multi-acteurs » décrit plus bas est donc sans objet — il n'a jamais existé,
> il venait de la règle fausse.
>
> La section ci-dessous est conservée telle qu'elle a été écrite, parce qu'elle
> documente comment une règle plausible peut tenir sur un échantillon et tomber
> sur quinze.

Sur le flux serveur → client, et lui seul :

| | capture Safe | capture Ultra |
|---|---|---|
| trames retenues | 1, toutes `jwe` action 300 | 13, toutes `jwe` action 300 |
| trames fabriquées | 2, toutes `jwe` action 4 | 27, toutes `jwe` action 4 |
| autres types touchés | aucun | aucun |

Le champ `14` de `jwe` est un **discriminant d'action** : il commande le numéro
de la branche `oneof` qui porte les données. L'action **300** est le déplacement
animé ; l'action **4** est « pose cet acteur sur cette case ».

Trame retenue, telle que le serveur l'envoie :

```
event jwe (103 octets)
  3 = -2                          l'acteur (negatif = un monstre)
  7 {                             branche oneof de l'action 300
    2 = 665809125670
    4 { 4 = -1 }
    4 { 1 { 1 = 1, 2 = 665809125670 }, 3 = 2, 4 = -2 }
    6 = 241                       la case
    7 { 2 = 4195, 3 = 21698 }
    8 = 1
  }
  14 = 300
```

Trame fabriquée, telle que le client la reçoit :

```
event jwe (49 octets)
  3  = 665809125670
  14 = 4                          branche oneof de l'action 4
  35 { 1 = 241, 2 = 665809125670 }
```

Octets exacts de la trame fabriquée ci-dessus :

```
0a2f0a2d0a13747970652e616e6b616d612e636f6d2f6a7765121618a682c4aab01370049a020a08f10110a682c4aab013
```

**La case est recopiée**, du champ `7.6` de l'action 300 vers le champ `35.1` de
l'action 4. L'acteur vient du champ `7.2` quand il existe, sinon du champ `3`.
Vérifié sur trois cas indépendants : case 241 → joueur, 413 → joueur, 217 →
joueur.

### Le trou connu, et pourquoi il bloque

**13 trames retenues ont produit 27 trames fabriquées.** Une action 300 peut
déplacer plusieurs acteurs à la fois — le champ `7.4` est répété jusqu'à trois
fois, une entrée par combattant — et c'est le cas des poussées et des
attirances. Or **les cases des acteurs secondaires n'apparaissent nulle part
dans la trame retenue** : le champ `7.6` n'en porte qu'une.

Deux explications possibles, non tranchées :

1. la case de chaque acteur se déduit d'un champ que la mesure n'a pas su lire
   (le champ `7.4` porte des sous-champs `3` valant 1 ou 2, qui pourraient être
   un nombre de cases) ;
2. leur proxy tient un état des positions de chaque combattant et calcule les
   destinations.

Livrer sans cette réponse donnerait un no-anim qui casse les poussées et les
attirances : le client recevrait une action 4 pour l'acteur principal et rien
pour les autres, qui resteraient affichés sur leur ancienne case. **La mesure
est donc la première tâche du plan, et elle est bloquante** — même dispositif
que pour les invitations de groupe, où la mesure a révélé que l'invitant était
au champ 2 et non au champ 1.

Ce que la mesure manquante doit produire : une capture longue avec des
déplacements **simples** (marche de monstres, sans sort de poussée), donnant des
paires 300 → 4 en un-pour-un, puis une capture avec poussée pour lire la règle
des acteurs secondaires. Si la règle reste introuvable, la fonction se replie
sur le cas un-pour-un et **relaie sans transformer** toute action 300 portant
plus d'un acteur — dégradation propre, pas de rendu faux.

## L'architecture

### Le proxy doit devenir transformateur

C'est le changement le plus lourd du projet à ce jour, et le seul qui se place
sur le chemin critique du jeu.

Aujourd'hui, `src/proxy/server.js` observe puis relaie :

```js
upstream.on('data', (data) => {
  onData('in', data, conn);
  client.write(data);
});
```

`onData` n'a aucun moyen de modifier ce que le client reçoit. Les trois
fonctions existantes s'en accommodent parce qu'elles ne font qu'**ajouter** des
trames par `superviseur.emettre`. Le no-anim doit en **remplacer** une en
transit, ce qui impose de réassembler les trames descendantes sur le chemin de
relais et de les ré-encoder avec leur préfixe de longueur.

Jusqu'ici, un bug de politique ne pouvait pas casser le jeu. Désormais, une
erreur de cadrage tue la connexion.

### Les deux garanties de sûreté

Ce sont les exigences posées par l'utilisateur, et elles priment sur la
fonction elle-même.

**Garantie 1 — inerte par défaut.** Tant qu'aucun compte n'a le no-anim actif,
le chemin de relais est **identique octet pour octet** au code d'aujourd'hui :
pas de réassemblage, pas de ré-encodage, `client.write(data)` inchangé. La
transformation ne s'arme que lorsqu'au moins un compte l'active, et se désarme
dès que le dernier l'éteint. Le Replicate, le passe-tour et l'acceptation des
invitations ne peuvent donc pas être affectés par cette fonction tant que
personne ne l'allume.

**Garantie 2 — au moindre doute, relayer tel quel.** Une fois armée, la
transformation ne peut jamais produire moins que le flux d'origine. Trame
indécodable, type inattendu, champ manquant, plus d'un acteur, exception dans
la transformation : les octets d'origine repartent inchangés. Le no-anim
dégrade vers « animations normales », jamais vers une connexion cassée.

Ces deux garanties sont verrouillées par des tests, au même titre que
`fakeDeviceId` et `neutralizeCache` le sont déjà pour les contournements de
détection.

### Le module

`src/noanim.js`, jumeau de `src/passeur.js` et de `src/invitation.js` :
fonction pure, sans Electron, sans Frida, sans système, testable avec un double
du superviseur.

- Consomme : `decodeFrameRaw`, `encodeRaw`, `WIRE` de `src/codec/rawProto.js`.
- Produit : `creerTransformateur({ reglages, onCompteRendu }) → transformer(pid, trameBrute) → Buffer | null`.

`null` signifie « ne rien changer » et fait relayer les octets d'origine — c'est
le cas courant, et le seul comportement possible en cas de doute. Un `Buffer`
rendu porte les octets de remplacement **préfixes de longueur inclus**, et peut
contenir **plusieurs trames** : une action 300 qui déplace trois acteurs se
traduit en trois actions 4 concaténées.

Le point de branchement n'est **pas** `composer()` : les politiques existantes
observent, celle-ci transforme. Elle se branche sur un nouveau point d'entrée du
proxy, distinct de `onTrame`, pour que les deux natures ne se mélangent pas.

## L'état, la persistance, l'interface

Le motif est rodé trois fois, on le reprend sans le discuter :

- `EtatCompte.noAnim`, booléen, faux par défaut, indépendant de `exclu`, de
  `passeTour` et de `accepteInvitation` ;
- liste `noAnim` dans `favoris.json`, quatrième jumelle des trois autres, que
  des identifiants numériques ;
- `construireVue({ noAnim })` pose `ligne.noAnim` sur **toutes** les lignes, y
  compris celles du repli en fin de liste — le piège s'est présenté deux fois ;
- IPC `basculerNoAnim(actif)` et `basculerNoAnimCompte(idCompte, actif)`, avec
  validation `Number.isInteger` à la frontière ;
- bouton `ANIM` dans l'en-tête et quatrième interrupteur par ligne, grisé quand
  le client n'est pas suivi.

## Les erreurs

Aucun chemin ne mène au silence. C'est le mode d'échec le plus coûteux du
projet, rencontré quatre fois. Chaque refus de transformer produit un compte
rendu portant sa raison, journalisé par compte :

| situation | ce qui se passe | ce que dit le journal |
|---|---|---|
| interrupteur général éteint | rien, désarmé | rien : c'est l'état normal |
| compte inconnu du superviseur | relais tel quel | `compte inconnu du superviseur` |
| trame indécodable | relais tel quel | `trame indecodable, relayee telle quelle` |
| `jwe` sans champ 14 | relais tel quel | `jwe sans action, relayee telle quelle` |
| action ≠ 300 | relais tel quel | rien : c'est le cas courant |
| action 300 multi-acteurs, **si la mesure n'a pas livré la règle** | relais tel quel | `action 300 a N acteurs, relayee telle quelle` |
| exception | relais tel quel | `POLITIQUE EN ECHEC` + pile |

## Le critère de réussite

En jeu, sur un combat réel : les monstres et le personnage apparaissent
directement à leur case d'arrivée, sans marcher, et le combat reste jouable de
bout en bout — déplacements, sorts, fin de combat, gains. Vérifié dans le jeu,
pas seulement au journal : c'est la leçon du passe-tour, où l'application
affichait « suivi » des clients qu'elle ne pouvait pas atteindre.

Et le critère de non-régression, qui compte autant : avec le no-anim éteint,
les 224 tests passent et le Replicate duplique toujours.
