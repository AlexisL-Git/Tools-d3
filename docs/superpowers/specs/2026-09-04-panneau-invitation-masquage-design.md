# Le panneau d'invitation : masquer la trame plutôt que fermer la fenêtre

**Date :** 2026-09-04
**Statut :** implémenté et **vérifié en jeu le 2026-09-04**, pour l'invitation
de groupe seulement. **L'échange est écarté par cette même mesure** — voir
« Ce que l'essai en jeu a tranché ».
**Reprend et clôt :** `2026-08-25-invitation-panneau-persistant.md`.

## Le symptôme

Une invitation de groupe envoyée depuis le maître : les autres comptes
l'acceptent, rejoignent bien le groupe, et **le panneau d'invitation reste
affiché sur chacun d'eux**. Idem pour la proposition d'échange, dont
l'utilisateur a confirmé le 2026-09-04 qu'elle a le même défaut — ce que le
document du 25/08 annonçait comme « probable, non vérifié ».

## La racine

L'acceptation s'écrit sur la socket **amont** (`superviseur.emettre`,
`src/superviseur.js`), entre le proxy et le serveur. Le client de jeu ne la voit
jamais passer : il ne l'a pas produite, et elle ne redescend pas vers lui. Son
état interne reste « invitation en attente ».

## Pourquoi aucune trame descendante ne fermera ce panneau

Le document du 25/08 prescrivait une mesure : comparer les trames entrantes
après une acceptation manuelle et après une acceptation OMNI, et injecter au
client celle qui n'apparaîtrait que dans le cas manuel. **Cette mesure est
inutile, et son résultat était déductible.** Trois faits, tous déjà mesurés :

1. **Le serveur reçoit des octets identiques dans les deux cas.**
   `construireAcceptation` reproduit la trame du client octet pour octet
   (mesure du 20/08), sur la même connexion. Le serveur ne peut pas distinguer
   un clic humain d'une injection : ce qu'il renvoie ensuite est donc le même.
   Les deux listes à comparer sont identiques par construction.
2. **Les invités ont bien rejoint le groupe, vu à l'écran.** Ils ont donc reçu
   et affiché les trames de composition du groupe. Si l'une d'elles fermait le
   panneau, il serait fermé.
3. **`ijx` part avec `uid = -1`**, y compris émis par le vrai client (octets
   bruts du 20/08). L'enveloppe a un champ de corrélation et le client ne s'en
   sert pas ici : il n'attend aucune réponse. La fermeture n'est pas dans un
   rappel de réponse.

**Conclusion : la fermeture est locale au clic.** Aucune injection vers le
client ne la déclenchera.

Piste écartée au passage : le cache `~/.cache/game` (1414 `.proto`) ne nommera
pas les trames. Son `ijz.proto` déclare `{jdd = 1, int32 = 2, int32 = 3}` là où
la trame mesurée porte `{1, 2, 3, 5, 6 entiers, 7 chaîne}` — les noms obfusqués
ont tourné entre la version du cache et le client 3.6.10.10. Inutile d'y
revenir.

## La solution retenue

On ne ferme pas le panneau : **on l'empêche de s'ouvrir.** Le panneau naît de la
trame entrante ; si le client ne la reçoit pas, il n'y a rien à fermer. Le
compte rejoint le groupe et aucune fenêtre ne s'affiche — meilleur que le
panneau qui se ferme.

`src/masque.js` retire du flux descendant les trames qu'OMNI a acceptées à la
place du joueur.

### Le marquage vient de l'accepteur, jamais d'un filtre recopié

Le proxy appelle `onData('in')` **avant** d'écrire au client
(`src/proxy/server.js`). Quand le masque voit le chunk, l'accepteur a déjà
décidé, avec son propre filtre et ses propres droits. On ne masque donc que ce
qui a **effectivement** été accepté.

Un filtre recopié dans le masque aurait pu diverger de celui de l'accepteur et
avaler l'invitation d'un vrai ami. **Une invitation perdue en silence est bien
pire qu'un panneau qui reste** — c'est la contrainte qui a dicté ce dessin.

L'invitation est marquée seulement si l'acceptation est **partie**. Si
l'émission échoue, le panneau doit rester : il porte alors la seule invitation
encore acceptable, à la main.

**Une seule trame passe par le masque, `ijz`.** Le masquage de la proposition
d'échange `kfz` a été écrit, essayé en jeu, puis retiré — la raison est en
« Ce que l'essai en jeu a tranché », et elle vaut la peine d'être lue avant de
vouloir l'y remettre.

### Pourquoi pas de réassembleur, contrairement au no-anim

Le no-anim **réécrit** des trames : il lui faut un réassembleur sur le chemin
d'écriture, et c'est ce qui l'oblige à refuser définitivement toute connexion
qu'il n'a pas suivie depuis son premier octet — d'où sa limitation « ne prend
effet qu'au prochain démarrage du client ».

Retirer une trame entière n'exige pas cela : on lit les trames du chunk sur
place, sans rien retenir. **Le masquage n'a donc aucune condition d'armement**,
et la garantie « éteint signifie intouché » tient absolument : sans marque, le
module rend `null` et le proxy écrit les octets d'origine.

Le prix est un cas où il ne peut rien : si la trame marquée **commence dans le
chunk précédent**, déjà écrit au client, on ne retire rien du tout et le panneau
s'affiche — le défaut d'avant, jamais une connexion perdue. Ce cas est rare pour
ce qu'on masque : une invitation est un événement isolé, que le serveur envoie
seul, pas noyé dans un segment plein. **Il se journalise** (`masque … pas pu
être masquée`), pour qu'un panneau qui reste ne soit jamais inexplicable.

### La sûreté du retrait

On ne retire que des octets dont le contenu est **exactement égal** à une trame
qu'on a vue arriver, préfixe de longueur compris. Ces octets forment alors à
coup sûr une unité complète du fil : le cadrage du client ne peut pas bouger.
Longueur illisible ou trame incomplète en fin de chunk : on s'arrête là et tout
le reste part tel quel.

## Ce qui a été fait

| Fichier | Changement |
|---|---|
| `src/masque.js` | **nouveau** — le registre des marques, le retrait, et `composerDescendant` |
| `src/invitation.js` | option `masquer`, appelée si l'acceptation est partie |
| `src/echange.js` | **inchangé** — le masquage y a été essayé puis retiré |
| `desktop/main.js` | le registre, le branchement de l'invitation, et la composition des deux politiques descendantes |
| `test/masque.test.js` | **nouveau** — 16 tests, dont deux bout en bout |
| `test/invitation.test.js` | 2 tests de marquage |

Le superviseur n'accepte qu'un transformateur du flux descendant, et il y en a
désormais deux. `composerDescendant` les enchaîne — no-anim d'abord (il
réécrit), masque ensuite (il retire) — en préservant le contrat `null` = « je
n'ai touché à rien ». Une composition naïve rendant toujours un `Buffer` ferait
tomber la Garantie 1 du no-anim.

**Suite complète : 1022 tests passants**, plus les 7 échecs constants de
`serveur-maj` (dépendance absente, sans rapport).

## Ce que l'essai en jeu a tranché — 2026-09-04

**L'invitation de groupe : c'est réglé.** Le panneau ne s'ouvre plus, les
comptes rejoignent le groupe. Rien à changer.

**L'échange : le masquage est retiré.** `kfz` masquée, le compte invité **ne
voit plus du tout qu'il est en échange**, et ne peut donc rien y déposer.

C'est le fait qui manquait, et il renverse la lecture qu'on faisait de ce
symptôme : sur l'échange, la fenêtre qui « restait ouverte » n'était pas un
résidu à supprimer, **c'était l'échange lui-même**. `kfz` ne fait pas
qu'ouvrir un panneau — elle est ce qui apprend au client qu'un échange existe.
La retirer ne nettoie pas l'affichage, elle rend le compte aveugle.

Le masquage de l'échange est donc **écarté définitivement**, pas reporté :
aucun réglage ne peut à la fois retirer cette trame et laisser le client voir
son échange. `src/echange.js` et ses tests sont revenus à leur état d'avant ;
`desktop/main.js` porte la raison à l'endroit où l'option manquerait, pour que
personne ne la rebranche en croyant à un oubli.

Ce qui reste, pour l'échange, si la fenêtre en trop dérange encore : la voie
IL2CPP — faire cliquer le client lui-même, par appel de code managé depuis
l'agent Frida déjà en place, ce qui lui fait émettre son propre `kgi` et fermer
sa propre fenêtre. Coût et risques dans la section « Le repli ».

## Ce qui reste sans preuve

- **Le cas où la trame est à cheval sur deux chunks.** Jamais observé en jeu, et
  par construction non reproductible à la demande. Il se journalise (`masque …
  pas pu être masquée`) : si un panneau reste un jour, la ligne sera là.
- **Les songes** (`src/songes.js`) ont le même défaut par construction, et ne
  sont pas traités ici : l'utilisateur n'a demandé que le groupe et l'échange.
  Le branchement serait d'une ligne.

## Le repli, si l'essai déçoit

Injecter vers le client la trame d'**annulation** d'invitation : elle existe
forcément (l'invitant peut annuler, l'invitation expire), et elle ferme le
panneau par construction. Elle se capture proprement — faire annuler une
invitation par l'invitant, relever ce qui arrive chez l'invité. C'est la mesure
que le document du 25/08 aurait dû prescrire. Plus chère que le masquage :
injecter vers le client exige de tomber sur une frontière de trame, donc le
réassembleur que le masquage évite.
