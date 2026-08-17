# Launcher multi-compte Dofus 3 — design

**Date :** 2026-08-17
**Statut :** design validé, prêt pour le plan d'implémentation

## 1. Contexte

L'utilisateur pilote ~10 comptes Dofus 3 (Unity) via un launcher privé payant, `uuuu.exe`, facturé 10–30 €/mois. L'objectif du projet est de reconstruire ce launcher pour cesser de payer l'abonnement.

### Ce qu'est réellement `uuuu.exe`

Analyse statique menée le 2026-08-17 :

- Binaire de 315 Mo, Node 18 empaqueté avec `pkg`, projet `dofus-multi-release` v4.0.4.
- Ce n'est qu'un **bootstrapper**. Son code source est en clair dans le binaire (~60 lignes).
- Il télécharge et exécute `index.jsc` — 7 Mo de bytecode V8 compilé via `bytenode`, donc non lisible en source.
- Cache applicatif : `C:\Users\<user>\.cache\` (dérivé de `%APPDATA%` en remplaçant `AppData\Roaming` par `.cache`).
- Mise à jour forcée : comparaison SHA-256 de `index.jsc` contre `https://xenifti.com/dofusHash`, re-téléchargement si divergence. Un fichier `.cache\skip` désactive ce mécanisme.
- Il se recopie en `.cache\explorer.exe` et refuse de démarrer s'il s'appelle `rename.exe`.
- Authentification Discord OAuth + GitHub, avec `balance` / `subs` / `premium` : c'est un SaaS.
- Le front est une SPA servie depuis `https://krm35.github.io/dofus-multi/`, qui parle à un WebSocket local `ws://localhost:8081/web` avec un protocole RPC `{id, action, resource, body}`.

### Actifs déjà présents sur disque

Dans `C:\Users\<user>\.cache\` :

| Élément | Nature |
|---|---|
| `InputReplicate/input_monitor.node` | Addon N-API. Exporte `start`, `stop`, `sendKeyGlobal`, `sendMouseGlobal`, `sendKeyToPid`, `sendMouseToPid`. Utilise `SetWindowsHookExW`, `SendInput`, `PostMessageW`, `EnumWindows`. |
| `FocusWindow/focus_window.node` | Addon N-API. Exporte `focusWindow`, `maximizeWindow`, `getWindowTitle`, `showWindow`. Utilise `AttachThreadInput` + `BringWindowToTop` + `SetForegroundWindow`. |
| `RobotJS/robotjs.node` | Addon N-API de rejeu clavier/souris. |
| `Release/frida_binding.node` | Binding Frida (73 Mo). |
| `game/*.proto` (1414 fichiers) | Protocole de jeu, décompilé avec protodec depuis l'assembly `Ankama.Dofus.Protocol.Game`. **Noms obfusqués.** |
| `connection/*.proto` | Protocole de connexion. **Noms en clair** (`IdentificationRequest`, `SelectServerRequest`, …). |

`sendKeyToPid` / `sendMouseToPid` reposent sur `PostMessageW`, ce qui explique la réplication « sans switch » : le message est délivré à une fenêtre en arrière-plan sans lui donner le focus.

### Nature de la feature « Replicate (dofus) »

Établi par extraction des littéraux de chaînes de `index.jsc` :

- Deux files distinctes coexistent : `inputReplicateQueue` (niveau input) et `replicateQueue` (niveau protocole).
- Changelogs embarqués : *« Replicate group leader actions (NPC, Zaap, Travel) / Keyboard Shortcut / Accept Teleport »*, *« … / Accept Exchange / Accept Teleport »*.

Répliquer « PNJ / Zaap / Voyage / Accepter échange » n'a pas de sens au niveau du clic. **La feature que l'utilisateur paie est une réplication sémantique par paquets réseau.** Confirmé par l'utilisateur : la réplication fonctionne même sur une fenêtre minimisée ou dont le personnage est dans un état différent.

Mécanisme observé dans le bytecode :

```js
Module.getExportByName(null, 'connect')   // + 'send', 'recv'
Module.findBaseAddress("GameAssembly.dll")
new NativeFunction(Module.findExportByName("GameAssembly.dll", "il2cpp_string_new"), ...)
```

## 2. Objectif et périmètre

### Objectif

Reproduire six features à parité fonctionnelle avec le produit payant, sur les comptes Dofus 3 de l'utilisateur :

1. **Replicate (dofus)** — priorité absolue, c'est la raison de l'abonnement
2. Pass turn
3. Accept group invitation
4. Focus group leader
5. Exchange
6. Shortcut

### Hors périmètre

**La couche d'évasion anti-cheat n'est pas construite.** Le produit payant embarque du spoofing HWID (interception de `IOPlatformUUID`), du masquage de Frida dans l'énumération des process, et des hooks sur `CreateProcessW` / `gethostname` / `CreateFileW`. Rien de tout cela ne sera reproduit.

Conséquence assumée : le clone est fonctionnellement à parité mais **plus détectable** que le produit payant. Le risque de bannissement est réel et relève de l'utilisateur, qui en a été informé avant de valider l'approche.

Également hors périmètre : le support de Dofus Retro, et les ~20 autres features du produit payant.

### Décisions actées

| Décision | Choix | Justification |
|---|---|---|
| Approche | **Clone complet, injection de paquets comprise** | Seule voie vers la parité stricte sur Replicate sémantique. Une alternative hybride « lire par le protocole, agir par l'input » a été proposée et écartée par l'utilisateur : moins chère et moins risquée, mais elle ne rendait pas le Replicate sémantique sur fenêtre minimisée. |
| Stack | Node.js + addons `.node` existants + UI web | Réutilise `input_monitor.node` et `focus_window.node` dont l'API est connue, évite une toolchain C++, et correspond à l'architecture que l'utilisateur connaît déjà. |
| Maintenance | Re-mapping manuel à chaque patch Dofus | Accepté par l'utilisateur. Le design vise à ramener ce coût de 1–3 h à ~20 min. |
| Emplacement | `C:\Users\Utilisateur\mm` | Nom neutre, choisi par l'utilisateur. |

Les addons `.node` réutilisés ne sont pas audités : ce sont des binaires tiers, déjà exécutés quotidiennement par l'utilisateur dans le cadre du produit payant.

## 3. Architecture

Huit modules, chacun avec une responsabilité unique et une interface explicite.

```
┌──────────────┐   ws://127.0.0.1:PORT
│  ui (web)    │◄──────────────────────┐
└──────────────┘                       │
                                 ┌─────┴──────┐
                                 │   core     │  orchestrateur, state store
                                 └─────┬──────┘
              ┌────────────────────────┼────────────────────────┐
        ┌─────┴──────┐           ┌─────┴─────┐            ┌─────┴─────┐
        │  features  │           │   codec   │            │   input   │
        │ (6 modules)│           │ protobuf  │            │   Win32   │
        └─────┬──────┘           └─────┬─────┘            └───────────┘
              │                        │
        ┌─────┴─────┐            ┌─────┴──────┐
        │  mapping  │            │  injector  │  Frida
        │ (données) │            │  agent.js  │
        └───────────┘            └─────┬──────┘
                                       │
                                 Dofus.exe × N
```

| Module | Responsabilité | Dépend de | Interface |
|---|---|---|---|
| `core` | Orchestrateur : cycle de vie des comptes, câblage des modules, serveur WebSocket | tous | `start()`, `stop()`, `accounts()` |
| `injector` | Attacher Frida à chaque process Dofus, hooker `send`/`recv`, remonter les buffers bruts, émettre des buffers | frida | `attach(pid) → EventEmitter<'in'\|'out', Buffer>`, `send(pid, Buffer)` |
| `codec` | Framing varint, décodage de l'enveloppe, résolution du `type_url` | protobufjs | `decode(Buffer) → {name, payload}`, `encode(name, obj) → Buffer` |
| `mapping` | Fichier de données pur : `hdv → fightTurnStart`. Aucune logique. | — | un JSON + un validateur de schéma |
| `state` | Modèle par compte : personnage, map, combat, groupe, échange | codec, mapping | `get(accountId) → AccountState`, émet des transitions |
| `features` | Six modules indépendants, un fichier chacun | state, injector, input | `enable(accountId, opts)`, `disable(accountId)` |
| `input` | Rejeu clavier/souris, focus, énumération de fenêtres | les `.node` | `sendKeyToPid`, `sendMouseToPid`, `focusWindow` |
| `ui` | Page web + WebSocket | core | messages `{id, action, resource, body}` |

### Trois choix structurants

**`mapping` est un fichier de données, pas du code.** C'est le seul module qui casse à chaque patch Dofus. En l'isolant totalement, une mise à jour du jeu se traduit par l'édition d'un JSON, sans toucher à une ligne de logique.

**Un module par feature, un fichier chacun.** Les six features sont indépendantes. Si `exchange` casse après un patch, `replicate` continue de fonctionner. Cela permet aussi de les livrer une par une, en commençant par `replicate`.

**`injector` expose une interface transport, pas une interface Dofus.** Il ne connaît rien du jeu, il déplace des octets. Si le spike (section 7) montre qu'un proxy local suffit, on remplace son implémentation sans toucher au reste du système.

## 4. Flux de données

### Entrant (lecture)

```
Dofus.exe
  recv() ──[hook Frida]──► buffer brut
                             │
                             ▼
                    réassemblage par socket        (TCP n'est pas aligné sur les messages)
                             │
                             ▼
                    framing varint (longueur)
                             │
                             ▼
                    Message{ event | request | response }
                             │
                             ▼
                    Any.type_url = ".../hdv"       (identification gratuite)
                             │
                             ▼
                    codec.decode → {name:'hdv', payload}
                             │
                             ▼
                    mapping: hdv → fightTurnStart  (sinon : "unknown", compté et loggé)
                             │
                             ▼
                    state[accountId] mis à jour
                             │
                             ▼
                    features → input Win32 ou paquet injecté
```

L'enveloppe est définie ainsi (`_Message.proto`, noms de champs obfusqués mais structure claire) :

```proto
message Message {
  oneof dzlw { Request request = 2; Response response = 3; Event event = 1; }
}
message Event    { google.protobuf.Any content = 1; }
message Response { int32 uid = 2; google.protobuf.Any content = 1; }
message Request  { int32 uid = 2; google.protobuf.Any content = 1; }
```

L'usage de `google.protobuf.Any` est déterminant : le champ `type_url` porte le nom du message. **L'identification est donc gratuite** — le problème se réduit à connaître la *sémantique* de `hdv`, pas à l'identifier.

Les messages non mappés ne constituent pas une erreur : ils traversent avec le statut `unknown` et sont comptés. Ce compteur est le détecteur de patch.

### Sortant (injection) et gestion des `uid`

`Request` porte un `uid` : le client maintient un compteur de requêtes. Une injection naïve casse la correspondance requête/réponse, soit en entrant en collision avec un `uid` légitime, soit en provoquant l'arrivée d'une réponse que le client ne sait pas rattacher.

**Solution retenue :** une plage haute de `uid` est réservée aux injections, et l'agent Frida **filtre le flux `recv` en retour** — il retire les `Response` dont l'`uid` appartient à cette plage avant que le client ne les reçoive. Les `Event` déclenchés par l'action injectée passent normalement, ce qui garde l'interface du client synchronisée avec l'état serveur.

Cela impose que le hook soit **bidirectionnel** : écouter ne suffit pas, il faut aussi pouvoir intercepter et supprimer.

## 5. Stratégie de mapping

Le protocole de jeu est renommé à chaque patch Dofus (obfuscation IL2CPP). Exemple de l'état actuel :

```proto
// hdv.proto — Decompiled with protodec
message hdv {
  hdt dzpx = 1;
  hcw dzpy = 2;
  enum hdt { HDT_DDSU = 0; HDT_DDSV = 1; HDT_DDSW = 2; HDT_DDSX = 3; HDT_DDSY = 4; HDT_DDSZ = 5; }
}
```

Trois mécanismes, dans cet ordre.

### 5.1 Ré-extraction des `.proto`

Après chaque patch : `Il2CppDumper` sur `GameAssembly.dll` → assembly reconstruit → `protodec` → jeu de `.proto`. Pipeline scripté une fois, rejoué à chaque mise à jour.

### 5.2 Diff structurel entre patches (automatisme)

Les noms changent, la *structure* des messages reste stable : numéros de champs, types, imbrication, arité des enums. On calcule une empreinte structurelle de chaque message et on apparie ancien → nouveau.

```
patch N-1 :  hdv { enum(6 valeurs) champ1; hcw champ2; }  = fightTurnStart
patch N   :  jkq { enum(6 valeurs) champ1; jkp champ2; }  ← empreinte identique
             → propose jkq = fightTurnStart
```

C'est ce mécanisme qui ramène la maintenance de 1–3 h à ~20 min.

Les appariements ambigus (plusieurs messages de même empreinte) sont présentés à l'arbitrage plutôt que résolus au hasard.

### 5.3 Enregistreur corrélé (filet de sécurité)

Pour les messages que le diff ne résout pas — message réellement nouveau, structure modifiée. Mode enregistrement : l'utilisateur déclenche une action connue en jeu, l'outil horodate les messages reçus dans la fenêtre temporelle et propose les candidats à l'étiquetage dans l'UI. La validation écrit dans le JSON de mapping.

Cet enregistreur est le **même outil** que la capture utilisée pour les tests (section 7.1). Il est écrit une fois et sert aux deux usages, ce qui justifie de le construire tôt.

## 6. Gestion d'erreurs et sécurité d'exploitation

### 6.1 Boucle de rétroaction

Le hook clavier/souris est global. Si un input rejoué est lui-même capturé, chaque action se réplique en cascade et sature les dix clients en quelques millisecondes.

Deux barrières indépendantes :

- `sendKeyToPid` / `sendMouseToPid` passent par `PostMessageW`, qui n'alimente pas les hooks `WH_*_LL`. Le chemin nominal est donc déjà sûr.
- `sendKeyGlobal` / `sendMouseGlobal` passent par `SendInput`, qui l'est. Ces appels estampillent `dwExtraInfo` avec une valeur magique, et le hook rejette tout événement la portant.

Plus un garde-fou indépendant des deux : un limiteur de débit par compte. Au-delà d'un seuil d'actions par seconde, la réplication est coupée et l'utilisateur alerté.

### 6.2 Arrêt d'urgence

Une touche globale désactive instantanément toute réplication et toute injection, sur tous les comptes, sans passer par l'UI.

### 6.3 Dégradation contrôlée après un patch

Le compteur de messages `unknown` sert de détecteur. Au-delà d'un seuil, le launcher désactive de lui-même les features dont le mapping est devenu douteux, plutôt que de les laisser agir sur des données mal interprétées.

Chaque feature déclare les clés de mapping dont elle dépend, ce qui rend la désactivation ciblée : si seul `exchange` est cassé, `replicate` continue.

### 6.4 Isolation par compte

Un compte qui plante, se déconnecte, ou dont l'attach Frida échoue, ne doit pas affecter les autres. Chaque compte dispose d'une pipeline supervisée : attach avec retry et backoff exponentiel, état `disconnected` explicite dans l'UI, reprise automatique au retour du process.

### 6.5 Résolution de fenêtre à chaque envoi

Les PID sont réutilisés par Windows et les fenêtres se ferment. Aucun HWND n'est mis en cache : il est re-résolu avant chaque envoi (`EnumWindows` + `GetWindowThreadProcessId`) et le titre est validé via `getWindowTitle` avant tout envoi.

### 6.6 Échec sûr à l'injection

Si le serveur rejette un paquet injecté, ou si un `uid` sort de la plage réservée, l'injection est arrêtée sur ce compte plutôt que réémise. Réessayer une injection mal formée produit un motif de trafic anormal.

## 7. Stratégie de test

La vérité terrain est un jeu en ligne non déterministe, non invocable depuis une suite de tests.

### 7.1 Enregistrement / rejeu

Les trames brutes d'une vraie session sont capturées une fois sur disque. Tout ce qui se situe **au-dessus** de l'`injector` devient rejouable, déterministe et testable hors ligne. C'est le même outil que l'enregistreur de la section 5.3.

### 7.2 Couverture par module

| Module | Testabilité | Approche |
|---|---|---|
| `codec` | Excellente (fonctions pures) | Tests unitaires sur trames enregistrées. Cas limites : trame coupée par TCP, deux trames dans un buffer, `type_url` inconnu |
| `mapping` (diff) | Bonne | Deux jeux de `.proto` de patches différents en fixtures ; vérifier que l'appariement structurel retrouve les correspondances connues |
| `state` | Bonne | Rejeu d'une session enregistrée, assertions sur les transitions |
| `features` | Bonne | Injecteur et couche input falsifiés. Assertion sur l'intention : « sur `fightTurnStart` du compte X, envoyer Espace au PID de X » |
| `injector` | Faible | Volontairement mince. Test de fumée manuel |
| `input` | Faible | Binaires tiers. Test manuel contre le Bloc-notes |

Les features, qui portent toute la logique métier et tout le risque, sont entièrement testables sans le jeu, parce qu'elles ne dialoguent qu'avec des interfaces.

### 7.3 Montée en charge manuelle

Ordre strict, non négociable :

1. **Bloc-notes** — valider le rejeu d'input sans risque
2. **1 compte, injection désactivée** — valider lecture, décodage, état
3. **2 comptes** — valider réplication, arrêt d'urgence, anti-boucle
4. **10 comptes** — seulement après qu'une session complète tienne à 2 comptes

## 8. Séquencement

### Étape 0 — Spike bloquant : le flux est-il chiffré ?

`ARC4init` / `ARC4next` apparaissent dans le bytecode de `index.jsc`. Si le flux de jeu est chiffré, hooker `send` / `recv` ne rend que du bruit et il faut hooker plus haut, dans les méthodes de sérialisation IL2CPP — nettement plus coûteux et plus fragile aux patches.

Manipulation : attacher Frida à un process Dofus, dumper 30 s de `recv`, chercher un varint de longueur suivi d'un protobuf valide. Réponse binaire.

Cette étape précède tout le reste car elle détermine le coût réel de l'`injector`. Le design reste valide dans les deux cas, mais l'estimation change.

### Étapes suivantes

1. `codec` + enregistrement/rejeu (débloque tests et mapping)
2. `injector` (forme déterminée par le spike)
3. `mapping` initial + outil de diff structurel
4. `state`
5. `input` + `core` + `ui`
6. Features, dans l'ordre : `replicate`, `shortcut`, `focusGroupLeader`, `passTurn`, `acceptGroupInvitation`, `exchange`

`replicate` passe en premier : c'est le besoin réel de l'utilisateur et la seule feature dont l'absence justifie l'abonnement.

## 9. Risques ouverts

| Risque | Impact | Traitement |
|---|---|---|
| Flux de jeu chiffré | Coût de l'`injector` fortement accru | Spike bloquant, étape 0 |
| Injection rejetée par le serveur (état client non répliqué, jeton, séquence applicative) | Replicate sémantique irréalisable tel que conçu | À valider dès que `codec` et `injector` fonctionnent, avant d'écrire les features |
| Détection par l'anti-cheat | Bannissement des comptes | Hors périmètre par décision explicite. Risque assumé par l'utilisateur |
| Le diff structurel n'apparie pas de façon fiable | Maintenance revient à 1–3 h par patch | L'enregistreur corrélé (5.3) reste le filet |
| Lancement multi-instance de Dofus bloqué par le client | Impossible d'ouvrir 10 clients | Le produit payant hooke `CreateFileW` pour cela ; à traiter si le blocage se manifeste |
