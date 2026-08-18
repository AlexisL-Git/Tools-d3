# Percée IL2CPP — accès au protocole Dofus 3 depuis l'intérieur du jeu

**Date :** 2026-08-18
**Statut :** voie ouverte. Messages de protocole interceptés vivants sur un client réel.

## Le contexte

Les trois voies externes étaient fermées (voir les deux documents précédents) :
réseau invisible aux API Winsock, entrées injectées ignorées. Restait la voie
interne : se greffer dans le moteur du jeu.

## Ce qui rend la voie praticable

Unity IL2CPP compile le C# en natif, mais le runtime a besoin de connaître ses
propres noms à l'exécution. `GameAssembly.dll` (115 Mo) **exporte 242 fonctions
`il2cpp_*`** permettant d'interroger cette carte. Le jeu décrit donc lui-même
sa structure — aucun Il2CppDumper ni `global-metadata.dat` requis.

Contrainte : tout appel à l'API IL2CPP depuis un thread Frida exige un
`il2cpp_thread_attach(domain)` préalable.

Piège rencontré : Frida 17 a supprimé `Module.findExportByName(module, nom)`.
Il faut passer par `Process.getModuleByName().findExportByName()`.

## Architecture réseau de Dofus 3, établie

142 assemblies. Les significatives :

| Assembly | Classes | Rôle |
|---|---|---|
| `Core.dll` | 9439 | cœur du jeu |
| `Ankama.Dofus.Protocol.Game.dll` | 5631 | messages du protocole — **obfusqués** (`hdu`, `hdv`…) |
| `Google.Protobuf.dll` | 370 | sérialisation — noms intacts |
| `DotNetty.Transport.dll` + `Common` | 406 | **transport réseau asynchrone** |
| `ZaapClient.dll` | 178 | dialogue avec le launcher |
| `BouncyCastle.Crypto.dll` | 2236 | cryptographie |

**DotNetty explique rétroactivement tout ce qui bloquait** : c'est un portage
.NET de Netty, dont l'I/O passe par des ports de complétion. D'où l'absence
totale d'appels `recv`/`WSARecv` mesurée plus tôt, et l'inefficacité de tout
hook posé sur `ws2_32.dll`.

## Le point d'ancrage

Les classes de messages sont obfusquées, mais **les bibliothèques tierces ne le
sont pas**. Tout message décodé remonte le pipeline DotNetty par
`FireChannelRead`, tout message émis y descend par `WriteAsync` /
`WriteAndFlushAsync` — trois méthodes aux noms intacts, dans
`DotNetty.Transport.Channels.AbstractChannelHandlerContext`.

```
FireChannelRead/1     @ 0x7ffa00c86a50   entrant
WriteAsync/1          @ 0x7ffa00c8a1e0   sortant
WriteAndFlushAsync/1  @ 0x7ffa00c89cf0   sortant + flush
```

Technique : `il2cpp_class_get_method_from_name` rend un `MethodInfo*` dont le
**premier champ est le pointeur natif** de la méthode. C'est là qu'on attache.
Pour chaque objet interposé, `il2cpp_object_get_class` donne son nom.

## Résultat obtenu

Sur 25 s de jeu réel, 250 objets interceptés, 5 types :

```
93  in   Core.Engine.Networking.Handlers.GameServerHandlers.GameMessage
75  out  DotNetty.Transport.Channels.DefaultChannelHandlerContext
33  in   UnpooledSlicedByteBuffer        (octets bruts avant décodage)
33  in   hea                              <-- MESSAGE DE PROTOCOLE NOMMÉ
16  in   PooledHeapByteBuffer
```

**`hea` est une classe de message du protocole, interceptée vivante** — et
`hea.proto` figure parmi les 1414 fichiers du cache. Le pont entre le jeu en
cours d'exécution et les définitions de protocole existe.

Second acquis, aussi important : **la couche réseau d'Ankama n'est pas
obfusquée**. `Core.Engine.Networking.Handlers.GameServerHandlers` contient
exactement deux classes, aux noms parlants :

- `GameMessage` — réception
- `GameRequest` — **émission**, donc la moitié du Replicate qui manque

Leurs *méthodes* restent obfusquées (`bkmv`, `bkmx`…), sauf `ToString`,
`GetHashCode`, `Equals` et `.ctor`. Les deux classes ont une forme identique
(15 méthodes, mêmes arités) et partagent plusieurs pointeurs natifs : ce sont
des classes protobuf générées, IL2CPP mutualisant le code identique.

## Piste en cours : lecture du contenu sans décoder

Les classes protobuf générées en C# implémentent `ToString()`, qui rend le
message **en JSON**. Appeler cette méthode sur les objets interceptés
(`il2cpp_runtime_invoke`) donnerait le contenu lisible sans avoir à décoder le
protobuf ni à percer l'obfuscation des champs.

Implémenté dans `src/il2cpp/pipelineAgent.js`, **non encore validé** : la
dernière session d'observation n'a capté aucun trafic (personnage inactif). À
reprendre.

## Outils créés

| Fichier | Rôle |
|---|---|
| `src/il2cpp/agent.js` | énumération assemblies / classes / méthodes, filtrable par assembly |
| `src/il2cpp/pipelineAgent.js` | hooks sur le pipeline DotNetty + extraction JSON |
| `src/cli/il2cpp.js` | `assemblies` / `classes` / `methods` |
| `src/cli/il2cpp-probe.js` | méthodes et pointeurs natifs d'une classe donnée |
| `src/cli/il2cpp-pipeline.js` | observation du trafic en direct |

## Prochaines étapes

1. Valider l'extraction JSON — refaire une session en jouant activement
2. Identifier parmi les méthodes obfusquées de `GameRequest` celle qui émet
3. Vérifier qu'on peut **appeler** cette méthode : c'est le vrai mur, lire est
   simple, écrire exige signature correcte et instances valides
4. Émettre un message forgé sur un second compte — le Replicate existe à
   partir de là

## Réserves

- Injecter dans le process est **plus détectable** que tout ce qui a précédé
- Chaque patch Dofus déplacera adresses et noms obfusqués
- Les étapes 1 et 2 sont accessibles ; l'étape 3 est d'un autre ordre

---

# Étape 4 validée — lecture du contenu des messages

## Ce qui ne marche pas : appeler du code du jeu

`ToString()` sur une classe protobuf C# rend le message en JSON. Deux tentatives
pour l'appeler depuis le hook — via `il2cpp_runtime_invoke`, puis par appel
direct du pointeur natif avec la convention IL2CPP `(this, MethodInfo*)` — ont
échoué identiquement : `system error` à chaque invocation.

Cause : `ToString()` alloue une chaîne, ce qui sollicite le ramasse-miettes,
depuis un thread déjà intercepté par Frida. Appeler du code managé depuis un
hook est fragile par nature.

Frida a intercepté l'erreur à chaque fois — le client n'a jamais planté.

## Ce qui marche : lecture mémoire pure

`il2cpp_class_get_fields` donne nom, offset et type de chaque champ. Il suffit
de lire aux offsets, sans jamais appeler de code du jeu. Les champs d'offset 0
sont statiques et sont ignorés.

Types traités : `Int32`, `UInt32`, `Int64`, `UInt64`, `Boolean`, `Single`,
`Double`, `String` (via `il2cpp_string_chars`), et récursion sur les objets
jusqu'à une profondeur donnée.

## Résultat

Entrant — l'enveloppe et son `Any` :

```json
hea → { "ebfz": { "#": "hdx",
        "ebfg": { "#": "Any", "typeUrl_": "type.ankama.com/jsj" } } }
```

Le même message une fois décodé par le jeu :

```json
GameMessage → { "#": "jsj", "epxq": 1, "epxw": 1, "epyc": "-20003", "epye": false }
```

Sortant — une action du joueur :

```json
lqc → { "fcma": 24, "fcmc": "0" }
```

**La moitié « lecture » du Replicate est acquise** : on connaît en temps réel,
avec le détail des champs, ce que le joueur émet et ce que le serveur répond.

## Découverte annexe : les .proto du cache sont périmés

`hea.proto` déclare `hcw dzqm = 1`. Le runtime expose `ebfz`, `ebga`, de types
différents. Le jeu est en 3.6.10.10 ; les `.proto` extraits datent d'avant.

Conséquence heureuse : **les .proto ne servent plus**. Le runtime fournit la
structure à jour à chaque lancement, ce qui supprime l'étape de ré-extraction
après chaque patch. La maintenance par patch s'en trouve nettement allégée —
restera à re-identifier les noms obfusqués, pas à reconstruire le protocole.

## Reste l'étape 5

Émettre. `GameRequest` est la classe d'émission, ses méthodes sont obfusquées
(`bkmv`, `bkmx`…). Il faudra identifier celle qui envoie, puis l'appeler avec
une instance valide — or on vient précisément de constater qu'appeler du code
du jeu depuis un hook échoue. L'appel devra donc se faire depuis un autre
contexte, probablement en s'insérant dans le thread principal du jeu.

C'est le vrai mur, et il n'est pas franchi.
