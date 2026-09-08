# L'invitation de groupe après le patch 3.6.11.12

**Symptôme rapporté le 08/09 au soir :** le panneau d'invitation s'affiche de
nouveau et il faut accepter à la main. Avant, la pop-up n'apparaissait pas et
l'acceptation partait toute seule.

**État :** corrigé et vérifié en jeu le 08/09 au soir.

## La cause

Le patch 3.6.11.12 réattribue **tous** les noms de messages : sur 150 relevés
avant et 35 après, deux coïncidaient, et encore par hasard. La campagne de
remappage du 08/09 a couvert le codec, `compte`, `echange`, `passeur`, `hdv`,
`replicate`/`omni` et `pda-archi`.

**`invitation.js` et `songes.js` sont les deux modules restés dehors.** Le
dernier commit touchant l'invitation est `c14844c`, du 25/08 — avant le patch.

`TYPE_INVITATION` valait toujours `'ijz'`, mesuré le 20/08 sur le client
3.6.10.10. Plus aucune trame ne s'appelait ainsi, donc la garde

```js
if (frame.type !== TYPE_INVITATION) return;
```

sortait à chaque trame, rien n'était jamais émis, et **aucune ligne de journal
n'était écrite** — le compte rendu est en aval de la garde. Le symptôme est un
silence, pas une erreur : exactement celui de `hdv`, `echange`, `passeur` et
`compte` le matin du 08/09.

| Vérification | Résultat |
|---|---|
| `ijz` / `ijx` dans les cinq journaux du matin | **0 occurrence** |
| Dernier commit touchant `invitation.js` | `c14844c`, 25/08 — avant le patch |
| Suite de tests | **1 300 verts** pendant que la fonction était morte |

Ce dernier point est la leçon déjà écrite dans le commit du replicate : « les
tests précédents passaient sur une table morte » — ils confrontaient
`TYPE_INVITATION` à lui-même.

## La mesure du 08/09 au soir

`journal-invitation.log`, quatre comptes : un maître invite ses trois mules,
chacune accepte à la main. L'autofollow natif de Dofus était actif et a fait
marcher les personnages — du bruit dans la capture, sans conséquence : rien de
ce qui suit ne repose sur une empreinte structurelle seule.

```
ijz -> ikb   invitation      entrante, kind 2
ijx -> ikg   acceptation     sortante, kind 1
```

### Tous les champs ont permuté

C'est le piège de ce remappage, et il vaut pour le prochain.

| rôle | avant | après |
|---|---|---|
| l'invitant | 2 | **1** |
| la constante 1 | 6 | **2** |
| le nom de l'invitant | 7 | **3** |
| la constante 8 | 3 | **5** |
| l'identifiant de groupe | 5 | **6** |
| le destinataire, nous | 1 | **7** |

Un remappage qui n'aurait touché que le nom aurait lu l'invitant au champ 2 —
qui porte désormais la constante `1`, jamais égale à un characterId, donc
**toutes les invitations refusées** — et le groupe au champ 5, qui porte la
constante `8` : une acceptation partie sur le groupe « 8 ». C'est exactement ce
que l'échange avait payé le matin même.

### Comment les deux noms ont été trouvés

**L'empreinte structurelle n'a pas trouvé `ikb`.** La chaîne étant passée du
champ 7 au champ 3, l'empreinte d'avant (`…,7:len`) ne correspondait à aucune
trame réelle : l'outil a répondu « aucun candidat » sur une capture qui
contenait pourtant trois invitations.

**Ce qui l'a trouvée, c'est la corrélation de valeurs.** Les characterId des
quatre clients s'apprennent des trames `kth`. Un seul événement entrant de toute
la session porte **deux** characterId connus à son premier niveau, et c'est
`ikb`. Ses trois occurrences portent le même champ 1 — le maître — et un champ 7
différent, égal à chaque fois au characterId du client qui la reçoit :
l'invitant et le destinataire, sans ambiguïté.

```
33799ms [pid 6556]  ikb { 1=677012898086  2=1  3="Lance-Truite-Ultime"
                          5=8  6=6687  7=677012701478 }
```

**`ikg` était noyé parmi dix candidats** pour une empreinte `1:varint`, qui ne
tranche jamais seule. La chronologie l'a départagé : trois occurrences, à 7,3 s,
9,2 s et 11,8 s après l'invitation reçue par le même client — le temps de la
main humaine — chacune portant exactement l'identifiant de groupe de cette
invitation.

```
43783ms [pid 5292]  ikg { 1=6687 }   kind=request  uid=-1
```

## L'enveloppe, corrigée séparément

Le patch a aussi échangé les numéros de l'enveloppe : les 63 requêtes sortantes
du 08/09 partent **toutes en kind 1**, les 244 events entrants en kind 2.
`construireAcceptation()` portait encore le `no: 2` d'août — l'acceptation
serait partie comme un **événement**, que le serveur ignore.

Ce défaut avait été trouvé et corrigé *avant* la mesure, à partir de la seule
table du codec. Les octets captés le confirment sans rien y devoir : `ikb`
entrant commence par `12`, `ikg` sortant par `0a`.

`echange.js` et `passeur.js` portaient déjà le 1 depuis le matin ;
`invitation.js` le porte maintenant aussi.

## Ce qui garde le remappage

- **`construireAcceptation(6687)` est comparée octet pour octet aux 41 octets
  que le client a réellement émis.** C'est la vérification qui manquait à
  l'échange : une trame qu'on croit juste parce qu'elle se décode.
- **Le bout en bout part de la trame captée** : la mule reçoit son `ikb`, et
  l'accepteur émet exactement le `ikg` que l'utilisateur avait dû cliquer.
- **`PERIMES` est vide**, et un test l'exige. Au prochain patch, y remettre ce
  qui n'a pas pu être mesuré : c'est le seul endroit où une fonction éteinte se
  déclare, et une suite verte ne doit jamais prétendre qu'elle marche.
- **Les helpers des tests se construisent sur les constantes exportées**, comme
  ceux du passe-tour. C'est ce qui leur a permis de suivre cette permutation
  sans retouche.
- **`test/masque.test.js` fabriquait son propre `ijz`** en kind 1 avec
  l'invitant au champ 2. Cette fixture avait survécu au patch dans une suite
  verte, en testant un protocole disparu ; elle est désormais bâtie sur les
  constantes du module.

## Ce qui reste

**Aucun signal visible dans l'application** quand des noms sont périmés. OMNI ne
dit toujours rien : `journal()` ne s'écrit que sous `OMNI_JOURNAL=complet`, et
`noterAvis()` s'efface au bout de 10 s — au démarrage, avant le premier rendu du
panneau. Où doit vivre un « fonction éteinte » — la ligne du compte, le pied de
page, ou l'interrupteur lui-même — est une décision d'interface, pas de
protocole.

**`songes.js` a exactement le même problème** et n'a pas été touché : `ixf`,
`iyd`, `ixk` sont périmés, et son `TRAME_ACCEPTATION` porte encore le `no: 2`
d'août. Ses trois empreintes sont au catalogue d'appariement, mais le geste
n'a pas été fait pendant la mesure du soir : il faut lancer un songe et
accepter l'invitation à la main, avec `outils\lancer-mesure-invitation.vbs`.
