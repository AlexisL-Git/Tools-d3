# Architecture réelle du Replicate — relevée sur le produit en marche

**Date :** 2026-08-19
**Statut :** établi par mesure directe, sur les deux clients lancés par le
launcher de krm35, Replicate activé.

## Comment on l'a su

L'utilisateur a lancé le produit payant. Trois mesures ont suffi.

**1. Le launcher injecte Frida.** Les dossiers
`%TEMP%\frida-<hash>\64\frida-agent.dll` des deux clients portent l'horodatage
`11:01:37`, la seconde exacte du démarrage des process. Notre propre attache est
survenue deux minutes plus tard. La technique du produit est donc la nôtre.

**2. Le source de l'agent est resté en mémoire.** Un agent Frida est transmis
sous forme de texte JavaScript puis compilé ; le texte survit dans le tas de V8.
Un balayage des régions `rw-` non adossées à un fichier, sur le motif
`Interceptor.attach`, l'a localisé dans deux régions ; l'extraction brute rend
les ~16 Ko du script en clair.

**3. Le proxy est visible depuis l'extérieur.** `Get-NetTCPConnection` montre
**cinq connexions établies** du client vers `127.0.0.1:8102`, port détenu par le
process du launcher.

Outils créés : `src/cli/scan-js.js`, `src/cli/dump-mem.js`, `src/cli/modules.js`.

## Ce que fait l'agent injecté — et ce qu'il ne fait pas

Le script complet tient en trois mécanismes. Aucun ne touche au protocole.

**a) Détournement de `connect` vers le proxy local.** Le `sockaddr` est réécrit
sur place en `127.0.0.1:8102` avant l'appel. Puis, dans `onLeave`, l'agent écrit
lui-même sur la socket :

```js
const connect_request = "CONNECT " + this.addr + ":" + this.port + " HTTP/1.0";
socket_send(this.sockfd.toInt32(), buf_send, connect_request.length, 0);
```

**C'est la pièce qui manquait à notre tentative de proxy.** Rediriger `connect`
seul ne peut pas marcher : le proxy reçoit une connexion sans savoir où la
relayer, puisque la destination d'origine a justement été écrasée. krm35 la lui
annonce en préambule, dans la syntaxe d'un proxy HTTP CONNECT.

**b) Falsification de l'empreinte machine.** Hook sur `GameAssembly.dll+0x4D15DF0`
(le `GetDeviceUniqueIdentifier` d'Unity) ; la valeur de retour est remplacée par
une chaîne IL2CPP forgée via `il2cpp_string_new`. Le même identifiant est réécrit
ailleurs sous plusieurs formes (`gethostname`, `GetHostNameW`, `%COMPUTERNAME%`).
Ankama empreinte donc la machine, et le produit le contourne.

**c) Neutralisation du cache.** `CreateFileW` : tout chemin contenant `.cache`
reçoit le suffixe `"nop"`, ce qui fait échouer l'ouverture.

Le script contient aussi une branche `isRetro` (Dofus 1.x : `uv_tcp_connect`,
port 26116, substitution de `D1ElectronLauncher.html`) et une branche macOS
(`IOPlatformUUID`), toutes deux inertes ici — `isRetro = false`, `isUnity = true`.

## La conséquence

**La duplication n'a pas lieu dans le jeu.** Elle a lieu dans le proxy du
launcher, qui voit les flux de tous les clients et rejoue les messages du maître
vers les esclaves. L'agent ne sert qu'à amener le trafic jusqu'à lui et à faire
passer les clients pour une seule machine.

Nous construisions l'inverse : appeler `WriteAndFlushAsync` depuis IL2CPP pour
émettre depuis l'intérieur du jeu. Cette voie fonctionne — le mécanisme d'appel
a été prouvé le 18/08 — mais elle est plus fragile et plus détectable que
nécessaire, et elle ne correspond pas à l'état de l'art.

## Correction d'une conclusion antérieure

Le document du 18/08 classait « proxy + redirection `connect` » parmi les quatre
voies fermées par la mesure. **C'était faux**, et la cause de l'erreur est
identifiée : le préambule CONNECT manquait. La conclusion « le client ne joint
jamais le port du launcher » portait par ailleurs sur 26116, qui est le port de
la branche Retro ; en Unity c'est 8102.

Reste vraie, en revanche, l'observation qui l'accompagnait : DotNetty passe par
des ports de complétion, donc les hooks `send`/`recv` sur `ws2_32.dll` sont
aveugles. C'est sans effet ici — le détournement porte sur `connect`, qui est
bien appelé, et la lecture des octets se fait dans le proxy, pas dans le jeu.

## Winsock est aveugle, y compris en E/S recouvertes

Les sessions précédentes avaient conclu à l'invisibilité du réseau depuis
`ws2_32.dll` en hookant `send`/`recv`. Le soupçon restait qu'elles avaient testé
les mauvaises fonctions : DotNetty passe par des ports de complétion, donc par
`WSASend`/`WSARecv`, jamais essayées.

Mesure faite (`src/cli/wsa-probe.js`, client vivant, cinq connexions établies,
trafic toutes les 2 s) : **0 entrée brute** sur les deux fonctions en 20 s. Le
compteur est posé avant tout traitement, donc il ne peut pas confondre « jamais
appelé » avec « appelé mais mal lu » — c'est le piège qui avait fait conclure
trop vite ailleurs.

Les E/S de .NET descendent donc directement dans `ntdll`
(`NtDeviceIoControlFile`, pilote AFD) sans passer par `ws2_32`. La conclusion
antérieure était juste, et pour une raison plus profonde qu'annoncé.

Conséquence pratique : **inutile de chercher les octets dans le jeu**. Notre
propre proxy les recevra comme n'importe quel serveur TCP. La question du
chiffrement du flux reste donc ouverte et se réglera là, pas ici.

## Ce que le socle existant devient

`src/proxy/server.js`, `src/codec/framing.js` (réassemblage varint),
`src/codec/envelope.js` et `src/analysis/entropy.js` avaient été écrits pour une
voie crue fermée. Ils redeviennent la charpente du projet.

## Prochaines étapes

1. **Reproduire le préambule CONNECT** dans notre agent, et faire transiter un
   client par notre propre proxy.
2. **Mesurer si le flux est lisible** au niveau TCP. `BouncyCastle.Crypto.dll`
   est chargé ; si le protocole est chiffré au-dessus de TCP, le proxy ne peut
   que tunneliser et la duplication devrait se faire ailleurs. La sonde
   d'entropie répond à cette question sur les premiers octets capturés.
3. Selon la réponse : rejouer un message du maître vers l'esclave, dans le proxy.

## Réserves

- L'analyse porte sur une version donnée du produit ; l'adresse `0x4D15DF0` est
  un RVA lié au binaire du jeu 3.6.10.10 et bougera à chaque patch.
- Le client `Michtou` s'est arrêté pendant la session. La cause la plus probable
  est un balayage mémoire interrompu par un tuyau fermé côté outil, laissant le
  script Frida en plan dans le process. Écrire la sortie dans un fichier plutôt
  que de la filtrer par `Select-Object` évite ce cas.
