# La pop-up d'echange qui reste chez la mule

2026-09-09

## Le defaut

OMNI accepte l'echange en ecrivant sur la socket AMONT: le serveur le voit,
l'echange se fait. Mais le client de la mule ne voit jamais passer cette
acceptation — il ne l'a pas produite — et sa pop-up « accepter / refuser »
attend un clic qui n'arrivera pas. Elle reste affichee APRES la fin de
l'echange.

## Ce qui etait deja tranche, et qu'on ne refait pas

Le masquage de `jyv`, la solution qui regle le meme symptome pour l'invitation,
a ete essaye en jeu le 04/09 et **ecarte definitivement**: la mule ne voit alors
plus du tout qu'elle est en echange et ne peut plus rien y deposer. Cette trame
ne fait pas qu'ouvrir un panneau, elle EST ce qui apprend l'echange au client.
Voir `docs/superpowers/specs/2026-09-04-panneau-invitation-masquage-design.md`.

## La mesure du 09/09

`journal-bug-0909.log`, acceptation automatique ETEINTE pour la manip.

Le maitre annule sa proposition:

    5160802 [17460] --> kiy { }         le maitre annule
    5160833  [8328] <-- jzi { 1=11 }    la mule recoit ceci
    5160844  [8328] --> kiy { }         son client referme TOUT SEUL

La mule refuse a la main — meme trame, dans l'autre sens:

    5186715  [8328] --> kiy { }
    5186745  [8328] <-- jzi { 1=11 }

Et la fin d'un echange REUSSI, acceptation rallumee:

    5208283  [8328] <-- jzi { 1=11 2=1 }

**Le meme message, a un champ pres.** Le champ 2 dit « l'echange a abouti », et
c'est cette version-la qui ne ferme pas la pop-up. Sans le champ 2, le client
comprend « la demande est annulee » et referme.

## Ce qu'on fait

`src/popup-echange.js`. A la fin d'un echange qu'OMNI a accepte tout seul, la
version SANS champ 2 est glissee dans le flux descendant, juste derriere celle
du serveur. A cet instant l'echange est deja conclu cote serveur: **il n'y a
plus rien a casser**, et c'est ce qui rend ce geste sur la ou masquer `jyv` au
debut rendait la mule aveugle.

    creerFermeturePopup({ onCompteRendu }) -> { marquer(pid), transformer(buf, conn) }

`marquer(pid)` est appelee par `desktop/main.js` quand l'accepteur ACCEPTE (pas
quand il valide: c'est l'acceptation qui laisse la pop-up). `transformer` a la
meme forme que celle de `src/masque.js` et le meme contrat `null` — un compte
sans marque ne fait recopier aucun octet.

**L'insertion se fait a une frontiere de trame**, la seule position sure: le
module lit les trames du chunk sur place, comme le masquage, et n'insere
qu'apres une trame COMPLETE. Une trame coupee par la fin du chunk laisse tout
partir tel quel.

**On decode au lieu de comparer les octets.** Un champ de plus dans la trame du
serveur — une date, un compteur — ferait echouer une egalite exacte EN SILENCE,
et la pop-up reviendrait sans que rien ne le dise. Le type `jzi` et la presence
du champ 2 suffisent a decider.

**Toute fin d'echange solde la marque**, y compris une annulation. Sans cela,
une marque restee armee ferait inserer la trame a la fin de l'echange SUIVANT,
celui-la peut-etre accepte a la main.

## Ce que ca coute

**Un `kiy` de plus, mesure et sans effet.** Comme dans la manip du 09/09, le
client enverra un `kiy` de lui-meme derriere. A cet instant la mule n'a rien
d'autre d'ouvert — l'echange vient de se conclure — donc il ne ferme rien.

**Le flux descendant est touche par un troisieme module.** `composerDescendant`
devient variadique: le no-anim REECRIT, le masquage RETIRE, celui-ci INSERE.
Le contrat `null` — « je n'ai touche a rien, ecris l'original » — survit a la
composition, sans quoi la Garantie 1 du no-anim tomberait.

## Tests

`test/popup-echange.test.js`, 9 cas: les octets mesures et leur decodage, le
`null` sans marque, l'insertion apres la fin d'echange, ce qui suit dans le meme
chunk, la marque a usage unique, l'annulation qui solde sans inserer, un autre
compte, la trame coupee, et un champ de plus qui ne desarme rien.

Reste a verifier EN JEU: que la pop-up disparait vraiment.
