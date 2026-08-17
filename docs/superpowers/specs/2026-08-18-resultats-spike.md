# Résultats du spike — interception du flux Dofus 3

**Date :** 2026-08-18
**Statut :** spike partiellement conclu. La question du chiffrement du protocole de jeu reste **ouverte**.

## Méthode

Agent Frida en lecture seule attaché à un client Dofus 3 en cours d'exécution (pid 26796), hooks sur `recv`, `send`, `WSARecv`, `WSASend`, avec démultiplexage par descripteur de socket et résolution de l'adresse distante par `getpeername`. Trois captures successives de 20 à 30 s. Aucun octet modifié, aucune connexion redirigée. Le client n'a subi aucun incident.

## Connexions du client

Relevé `netstat` pour le pid :

| Distant | Rôle |
|---|---|
| `52.31.96.105:5555` | **serveur de jeu** |
| `54.195.46.170:6337` | service social / chat Ankama |
| `127.0.0.1:26116` | launcher Ankama (Zaap) |
| divers `:443` (CLOSE_WAIT) | CDN / HTTPS |

## Constat 1 — le trafic capturé est du TLS, mais ce n'est pas celui du jeu

Les octets capturés sur la socket la plus bavarde présentent un en-tête constant :

```
17 03 03 00 1d  |  00 00 00 00 00 00 03 fc  |  <21 octets>
└ Application Data
   └ TLS 1.2
      └ longueur 29
                    └ numéro de séquence TLS, incrémental
```

Entropie 6,22 bits/octet. C'est sans ambiguïté du TLS.

**Mais** la résolution d'adresse donne `[::ffff:36c3:2eaa]:6337`, soit `54.195.46.170:6337` — le **service social/chat**, pas le serveur de jeu. Cette observation ne dit donc rien du protocole de jeu.

Erreur à ne pas reproduire : conclure sur la nature d'un flux avant d'avoir identifié la socket. Le démultiplexage par socket et `getpeername` sont indispensables, pas optionnels.

## Constat 2 — le socket de jeu est invisible aux hooks ws2_32

Aucun octet n'a été capturé pour `52.31.96.105:5555`, dans aucun sens, sur trois captures.

Compteurs d'appels relevés sur 20 s :

```
send=23  WSASend=3          ← uniquement chat + boucle locale
recv=0   WSARecv=0          ← AUCUNE réception via les wrappers Winsock
recvfrom=52
ReadFile=189
NtDeviceIoControlFile=304
```

Le client n'appelle jamais `recv` ni `WSARecv`. Ses entrées/sorties de jeu passent par `ReadFile` et `NtDeviceIoControlFile`, c'est-à-dire directement par le pilote AFD au niveau NT, en dessous de `ws2_32.dll`.

## Conséquence sur l'architecture

**Une interception par hooks `send`/`recv` ne peut pas lire le protocole de jeu Dofus 3.** Il faudrait hooker au niveau NT/AFD, ce qui est nettement plus complexe et plus fragile.

Cela explique rétrospectivement pourquoi l'amont (`krm35/dofus-multi`) emploie la redirection de `connect()` vers un proxy local : cette technique opère au niveau de la **connexion**, pas de l'appel, et fonctionne donc quelle que soit l'API d'I/O utilisée par le client.

**La redirection `connect` + proxy est donc la seule approche viable, et elle impose que l'outil lance lui-même les clients** — on ne peut pas intercepter un client déjà connecté, sa socket étant déjà ouverte.

Cela invalide l'architecture envisagée d'un exe s'attachant aux comptes déjà connectés via le launcher Ankama officiel.

## Ce qui reste à établir

La question d'origine — *le protocole de jeu est-il chiffré ?* — n'est **pas** tranchée. Il faut capturer le flux de `:5555` via le proxy, ce qui suppose de lancer le client sous Frida.

Deux issues :

- **En clair** → le codec déjà écrit et validé s'applique tel quel, le projet avance.
- **Chiffré** (TLS comme le chat, ou ARC4 comme le suggèrent `ARC4init`/`ARC4next` dans `index.jsc`) → il faut hooker au-dessus de la couche crypto, dans les méthodes IL2CPP de `GameAssembly.dll`. Coût nettement supérieur.

Le fait que le service social utilise TLS ne présume pas du choix fait pour le serveur de jeu.

## Prochain pas

Lancer un client Dofus **sous Frida** avec redirection `connect` vers le proxy local, et analyser le flux de `:5555`. `mm-public` (clone corrigé du dépôt public) sait déjà lancer les clients ; `mm` fournit le proxy, le codec et la sonde d'entropie.
