# Conclusion — pourquoi le dépôt public ne peut pas intercepter Dofus 3

**Date :** 2026-08-18
**Statut :** conclusion établie par la mesure. Le chemin « Dofus » de `krm35/dofus-multi` (public) est structurellement incompatible avec Dofus 3.

## Ce qui a été tenté

Faire fonctionner le launcher public (`mm-public`, clone corrigé) pour qu'il lance un client Dofus 3 sous Frida, afin de capturer le flux du serveur de jeu et répondre à la question du chiffrement.

## Les huit défauts rencontrés, et leur nature

| # | Symptôme | Cause | Corrigé |
|---|---|---|---|
| 1 | serveur qui ne démarre pas | `fs.rmSync` non gardé sur un dossier temp Frida verrouillé | oui |
| 2 | `frida@15` non installable | aucun prebuild pour Node 24 | oui, montée en 17 |
| 3 | agent Frida inerte | `Module.getExportByName` supprimé en Frida 17 | oui, shim |
| 4 | enfant qui meurt au chargement | binding `lzma-native` absent | oui |
| 5 | `ENOENT ...\Ankama\Dofus` | canal `main` codé en dur ; Dofus 3 vit sur le canal `dofus3` | oui |
| 6 | icône grisée | `d2Port` écrit avant de savoir si le lancement réussit | contourné |
| 7 | écran noir | `readUInt16BE` sur paquet d'1 octet → paquet jeté, jamais relayé | oui |
| 8 | client figé | agent redirigeant **toutes** les connexions, y compris les IPC internes | oui, filtre de destination |

Les défauts 5, 7 et 8 partagent une même origine : ce code a été écrit pour **Dofus 2** et n'a jamais été porté sur Dofus 3.

## Le constat bloquant

Après correction des huit défauts, le client démarre et s'affiche, mais échoue avec *« la connexion entre Dofus et Ankama launcher a été perdue »*.

Diagnostic instrumenté dans l'agent Frida, sur une session réelle :

```
API réseau utilisées : {"getaddrinfo": 56, "GetAddrInfoW": 56}
WSAConnect  : 0
ConnectEx   : 0
connect()   : port 443 uniquement, plus des ports éphémères
              JAMAIS le port 26116
```

**Le client Dofus 3 ne se connecte jamais au port 26116**, celui du launcher Ankama que le code public intercepte pour y substituer son faux Zaap (`launcher.js`). Le mécanisme d'interception ne peut donc jamais s'engager.

Ce constat rejoint celui du spike précédent (`2026-08-18-resultats-spike.md`) : sur un client déjà lancé, Dofus 3 n'appelle **ni `recv` ni `WSARecv`**, mais passe par `ReadFile` et `NtDeviceIoControlFile`, sous les wrappers `ws2_32`.

**Les deux mesures convergent : la couche réseau de Dofus 3 n'emprunte pas les API Winsock standard.** Ni pour la connexion au launcher, ni pour les entrées/sorties de jeu. Tout hook posé sur `ws2_32.dll` est aveugle.

## Ce que cela dit du produit payant

L'analyse initiale de `index.jsc` avait relevé, sans qu'on en comprenne alors la nécessité :

```js
Module.findBaseAddress("GameAssembly.dll")
new NativeFunction(Module.findExportByName("GameAssembly.dll", "il2cpp_string_new"), ...)
```

La raison est maintenant claire : **il faut hooker au niveau IL2CPP, dans le code du jeu lui-même**, parce que la couche Winsock ne donne rien. Ce n'est pas un raffinement, c'est la seule voie praticable.

C'est précisément ce travail — non publié, refait à chaque patch — qui constitue la valeur de l'abonnement.

## Conséquences pour le projet

1. **Suivre les mises à jour publiques de krm35 ne rattrapera jamais le produit payant.** Le dépôt public est une base Dofus 2 ; l'adaptation Dofus 3 n'existe que dans le bytecode.
2. **L'architecture « proxy + redirection `connect` » est inapplicable à Dofus 3.** Elle reste valide pour Dofus Retro et Wakfu, dont le handshake a fonctionné pendant les essais.
3. **Le OMNI sémantique suppose de la rétro-ingénierie IL2CPP** de `GameAssembly.dll` : localiser les méthodes de sérialisation du jeu, y poser des hooks, et refaire ce travail à chaque patch. C'est un ordre de grandeur au-dessus de tout ce qui a été estimé jusqu'ici.
4. La question du chiffrement du protocole reste **sans objet en l'état** : on ne peut pas atteindre le flux par le réseau.

## Ce qui reste acquis et réutilisable

- `mm` : proxy TCP, réassemblage varint, codec protobuf validé sur les 1414 `.proto` réels, format de capture, sonde d'entropie, agent de sniff avec démultiplexage par socket et résolution de pair. 48 tests.
- Une méthode de diagnostic qui fonctionne : instrumenter, mesurer, puis conclure — c'est elle qui a permis d'écarter successivement le TLS du chat, l'hypothèse EAC, et l'hypothèse IPv6.
- `mm-public` : clone du dépôt public avec huit correctifs, fonctionnel pour Wakfu.

## Options

- **Voie input pure** — omni par rejeu d'inputs Win32, sans jamais lire le protocole. Ne nécessite aucun hook réseau. Dégradé par rapport au produit payant, mais réalisable avec ce qui existe déjà.
- **Voie IL2CPP** — la seule qui mène au OMNI sémantique. Projet de rétro-ingénierie à part entière, avec maintenance à chaque patch.
- **Statu quo** — conserver l'abonnement pour les features, `mm-public` restant utilisable pour Wakfu et Retro.

---

# Addendum — la voie « input » est fermée aussi

**Date :** 2026-08-18, même session.

Après avoir établi que la voie réseau était fermée, la voie par rejeu d'inputs a été testée sur deux clients Dofus 3 réels (Swaggman - Crâ, Spoony - Pandawa), lancés normalement par le launcher Ankama officiel.

## Ce qui fonctionne

| Élément | État |
|---|---|
| `input_monitor.node` sur Node 24 | charge (N-API, ABI stable) |
| `focus_window.node` sur Node 24 | charge |
| `robotjs.node` | incompatible ABI, mais inutile |
| `getWindowTitle(pid)` | correct : `Spoony - Pandawa - 3.6.10.10 - Release` |

Le titre de fenêtre porte **nom du personnage et classe** : l'identification des clients ne nécessite donc aucune lecture du `keydata` de Zaap.

Signatures découvertes (l'addon les révèle par ses propres messages d'erreur) :

```
sendKeyToPid(pid, vkCode, keyDown)
sendMouseToPid(pid, x, y, button, down)
sendKeyGlobal(vkCode, keyDown)
focusWindow(pid)
```

À noter : **aucune de ces fonctions ne prend de `scanCode`**, alors que le binaire contient cette chaîne. L'addon sait lire les scan codes des événements capturés, pas les réémettre.

## Méthode de mesure

L'observation visuelle s'étant révélée peu fiable, l'effet a été mesuré objectivement : capture de la seule fenêtre du jeu, sous-échantillonnée sur une grille (~14 000 points), et comparaison du pourcentage de points modifiés. Le bruit de fond (animations au repos) est mesuré avant chaque test, et un garde refuse de mesurer si la fenêtre cible n'est pas au premier plan.

Sensibilité validée : la méthode a détecté 62 % de changement lors d'un test contaminé où une autre fenêtre avait réagi.

## Résultats

Fenêtre cible vérifiée au premier plan à chaque essai.

| Mécanisme | Accepté par l'OS | Bruit | Effet | Verdict |
|---|---|---|---|---|
| `PostMessageW` + vkCode (Échap) | oui | 0,39 % | 0,20 % | aucune réaction |
| `SendInput` + vkCode (Échap) | oui | 0,06 % | 0,47 % | aucune réaction |
| `SendInput` + vkCode (M) | oui | 0,15 % | 0,06 % | aucune réaction |
| `SendInput` + **scan code** (M) | oui, 2 événements | 0,45 % | 0,00 % | aucune réaction |

`focusWindow` s'est par ailleurs révélé peu fiable : un appel a fait apparaître le sélecteur de tâches de Windows au lieu de mettre le jeu au premier plan (verrou de premier plan Windows).

## Conclusion

**Dofus 3 ne réagit à aucune entrée injectée**, quelle que soit la méthode, y compris par scan code — la technique pourtant attendue pour un jeu en raw input. L'hypothèse cohérente est un filtrage du drapeau `LLKHF_INJECTED`, protection anti-macro usuelle dans un MMO.

Cela confirme, par la mesure, ce que la liste de features du produit payant indiquait dès le départ :

```
["OMNI clicks", ["retro"], "mouse"]      inputs  -> Retro uniquement
["OMNI",        ["dofus"], "omni"]  protocole -> Dofus uniquement
```

L'absence de omni par inputs sur Dofus 3 dans le produit payant n'est pas un choix de conception : c'est une impossibilité technique.

**Réserve :** les tests supposent que Échap ouvre le menu et M la carte. Un raccourci différent fausserait un essai, mais pas les quatre.

## État des voies explorées

| Voie | Statut |
|---|---|
| Proxy réseau + redirection `connect` | fermée — Dofus 3 n'utilise pas les API Winsock standard |
| Hooks `send`/`recv` sur client lancé | fermée — le jeu passe par `ReadFile` / `NtDeviceIoControlFile` |
| Rejeu d'inputs (`PostMessage`, `SendInput`, scan codes) | fermée — entrées injectées ignorées |
| Hooks IL2CPP dans `GameAssembly.dll` | **seule voie restante** — non explorée |

Le OMNI sémantique sur Dofus 3 suppose donc de la rétro-ingénierie du moteur : localiser dans `GameAssembly.dll` les méthodes de sérialisation ou de traitement d'entrées, y poser des hooks Frida, et refaire ce travail à chaque patch. C'est exactement ce que le produit payant réalise, et ce que son abonnement finance.
