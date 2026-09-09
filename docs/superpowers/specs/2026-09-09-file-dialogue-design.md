# La file de dialogue par mule

2026-09-09

## Le defaut, mesure

Session du 09/09, `journal-bug-0909.log`, un maitre (`17460`) et trois mules
(`15896`, `10420`, `8328`). Le maitre parle au PNJ `-20008`, une quete en cours.

    1048810 [15896] <-- imw { 1=2681 3={2=195} {2=193} {2=2284} }
    1049082 [17460] --> inh { 1=56180 }
    1049111 [17460] <-- imw { 1=43122 ... }        le maitre avance
    1049371 [15896] rejeu inh ecrit (+283 ms)
    1049400 [15896] <-- imw { 1=2681 ... }         LA MEME QUESTION
    1049401 [15896] <-- log { 1=418 2=1 }          une erreur, chez la mule seule

`56180` est une reponse **de quete**: elle n'existe que dans l'arbre du maitre.
Les mules n'ont que 193, 195 et 2284. Le serveur leur renvoie donc la meme
question, et **leur dialogue ne se ferme jamais**.

## Ce qui coute vraiment: la cascade

Le maitre, lui, termine — le serveur lui envoie `kja` et referme sa fenetre.
Mais `kja` est un message ENTRANT, et le duplicateur ne rejoue que les requetes
SORTANTES du maitre: rien ne dit aux mules de fermer. La fenetre reste ouverte,
et le PNJ suivant est refuse:

    1059598 [8328] rejeu imp ecrit (+358 ms)
    1059627 [8328] <-- imq { }        refus: elle est deja en dialogue

au lieu de `inn` + `imw`. **Une seule reponse ratee casse tous les PNJ
suivants.** La preuve inverse est dans le meme journal: a 1037317 ms le maitre
ferme SA fenetre a la main, le `kiy` se rejoue, et les trois mules se
debloquent d'un coup.

Le retard n'y est pour rien. Rejouee une heure plus tard, `56180` echouerait
pareil. Ce qui manque n'est pas de la vitesse, c'est une SORTIE.

## Ce qu'on construit

`src/file-dialogue.js`: une file d'attente par mule.

Le duplicateur, au lieu d'appeler `superviseur.rejouer()` pour les trois types
de dialogue (`imp`, `inh`, `kiy`), les EMPILE dans la file de chaque esclave.
La file les deroule une par une, et c'est la MULE qui la fait avancer.

    creerFileDialogue({ superviseur, onCompteRendu, delai, alea, planifier, maintenant })
      -> { onTrame({ pid, dir, frame }), pousser({ pidMaitre, type, brute }) }

Comme `src/songe-en-cours.js` et `src/echange.js`, ce module ne depend ni
d'Electron, ni de Frida, ni du reseau: il se teste avec un double du
superviseur, une horloge et un planificateur injectes.

### L'avancement vient de la mule

Apres chaque etape emise, la file attend que le serveur ait repondu A CETTE
MULE — son propre `imw` — avant d'emettre la suivante. Une mule ne peut donc
plus repondre a une question qu'elle n'a pas recue. Un delai humain de 150 a
600 ms s'y ajoute, comme pour l'echange (`DELAI_REACTION`).

L'emission passe par `superviseur.emettre(pid, brute)`: les trois types sont
`verbatim` dans la table, donc les octets du maitre partent tels quels, et le
prefixe de longueur est deja remis par `emettre`.

### Trois sorties, et jamais de blocage

- **Reponse refusee** — le `imw` qui revient porte le MEME identifiant de
  question que le precedent (2681 chez toi). La file emet `kiy`, vide la file,
  et rend `la mule n'a pas cette reponse`.
- **Rien au bout de 3 s** — meme sortie: `kiy`, file videe, compte rendu.
- **File videe normalement** — `kiy` si la fenetre est encore ouverte.

Quel que soit le chemin, **la fenetre finit fermee**. C'est la seule propriete
qui compte: c'est elle qui supprime la cascade.

### Le maitre a fini avant la mule

La file continue. Les etapes deja empilees sont jouees jusqu'au bout, puis la
fenetre se ferme. C'est la demande de l'utilisateur, mot pour mot: « meme s'il y
a un petit retard, au moins elles ne seront plus jamais bloquees ». Un dialogue
de quatre reponses peut prendre 2 a 3 s de plus a une mule qu'au maitre.

## Ce a quoi on ne touche pas

**Les songes.** Le garde-fou du 08/09 (`src/duplicateur.js`, `estDialogue(type)
&& dansUnSonge(pid)`) reste AVANT la file: dans un songe, le dialogue n'entre
meme pas dans la file. Un test verrouille cet ordre — l'intervertir rendrait le
boost aux mules en silence, exactement ce que le module `songe-en-cours` existe
pour empecher.

**Le reste du rejeu.** Deplacements, sorts, achats: rien ne change. Seuls les
trois types de `DIALOGUE` passent par la file.

**L'etalement.** La premiere etape d'un dialogue (`imp`) garde l'ecart par
esclave existant: trois fenetres qui s'ouvrent a la meme milliseconde restent
ce qu'on veut eviter. Les etapes suivantes, elles, sont cadencees par la file.

## Les messages entrants qu'on ecoute

Mesures les 08/09 et 09/09. Ils ne sont PAS dans `src/protocol/omni.js`: cette
table decrit ce qui se rejoue, et aucun de ceux-ci ne se rejoue. Ils vivent en
constantes du module, avec la mesure en commentaire, comme `jpw` dans
`songe-en-cours.js`.

    imw { 1 = <question> 3 = {2 = <reponse>} ... }   la question et ses choix
    imq { }                                          refus d'ouverture
    kja { 1 = 1 }                                    le dialogue est ferme
    inn { 1 = <npc> 3 = <carte> }                    le dialogue s'ouvre

## Ce qui peut mal tourner, et ce que ca coute

- **Un patch renomme `imw`, `imq` ou `kja`.** La file ne voit plus rien
  avancer; le delai de 3 s ferme quand meme. Ca degrade — les mules ne suivent
  plus le dialogue — mais ca ne bloque pas, et le compte rendu le dit.
- **Un arbre qui revient volontairement sur la meme question** (une option
  « retour ») sera pris pour un refus: fermeture propre, la mule s'arrete la.
  Accepte, faute de pouvoir distinguer les deux sans connaitre les arbres.
- **Une mule occupee ailleurs** (HDV, marchand) au moment d'un `kiy`: le `kiy`
  ne part que si la file de CETTE mule a quelque chose en cours. On ne ferme
  jamais une fenetre qu'on n'a pas ouverte.

## Tests

`test/file-dialogue.test.js`, avec un superviseur double, une horloge et un
planificateur injectes — aucun sommeil.

1. Trois etapes empilees partent DANS L'ORDRE, chacune apres le `imw` de la
   mule, jamais avant.
2. Le meme `imw` deux fois de suite: `kiy` emis, file videe, compte rendu
   `la mule n'a pas cette reponse`.
3. Aucun `imw` en 3 s: `kiy` emis, file videe, compte rendu.
4. File videe normalement: `kiy` final, une seule fois.
5. Le maitre finit avant la mule: les etapes restantes partent quand meme.
6. Deux mules avancent independamment: le retard de l'une ne retient pas
   l'autre.
7. `imq` (refus d'ouverture): file videe, compte rendu, pas de reponse envoyee
   dans le vide.
8. **Dans un songe, rien n'entre dans la file** — le test qui verrouille
   l'ordre des deux gardes dans `duplicateur.js`.
