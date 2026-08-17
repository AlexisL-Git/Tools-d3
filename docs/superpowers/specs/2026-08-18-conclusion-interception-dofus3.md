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
3. **Le Replicate sémantique suppose de la rétro-ingénierie IL2CPP** de `GameAssembly.dll` : localiser les méthodes de sérialisation du jeu, y poser des hooks, et refaire ce travail à chaque patch. C'est un ordre de grandeur au-dessus de tout ce qui a été estimé jusqu'ici.
4. La question du chiffrement du protocole reste **sans objet en l'état** : on ne peut pas atteindre le flux par le réseau.

## Ce qui reste acquis et réutilisable

- `mm` : proxy TCP, réassemblage varint, codec protobuf validé sur les 1414 `.proto` réels, format de capture, sonde d'entropie, agent de sniff avec démultiplexage par socket et résolution de pair. 48 tests.
- Une méthode de diagnostic qui fonctionne : instrumenter, mesurer, puis conclure — c'est elle qui a permis d'écarter successivement le TLS du chat, l'hypothèse EAC, et l'hypothèse IPv6.
- `mm-public` : clone du dépôt public avec huit correctifs, fonctionnel pour Wakfu.

## Options

- **Voie input pure** — replicate par rejeu d'inputs Win32, sans jamais lire le protocole. Ne nécessite aucun hook réseau. Dégradé par rapport au produit payant, mais réalisable avec ce qui existe déjà.
- **Voie IL2CPP** — la seule qui mène au Replicate sémantique. Projet de rétro-ingénierie à part entière, avec maintenance à chaque patch.
- **Statu quo** — conserver l'abonnement pour les features, `mm-public` restant utilisable pour Wakfu et Retro.
