'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  creerFileDialogue, TRAME_FERMETURE, TYPE_QUESTION, CHAMP_QUESTION,
  ESSAIS_OUVERTURE, DELAI_REESSAI_MS,
} = require('../src/file-dialogue');
const { DELAI_PLANCHER_MS } = require('../src/garde-combat');

// Un superviseur double: il note ce qu'on lui demande d'emettre, sans reseau.
function faux(pids = [2, 3]) {
  const emis = [];
  const etats = new Map(pids.map((pid) => [pid, { pid, exclu: false }]));
  return {
    emis, etats, arme: true,
    comptes: {
      get: (pid) => etats.get(pid) || null,
      esclaves: () => [...etats.values()].filter((e) => !e.exclu),
    },
    emettre: (pid, octets) => { emis.push({ pid, octets }); return { ok: true, octets: octets.length }; },
  };
}

// Un planificateur a la main: rien ne part tant qu'on n'a pas fait avancer le
// temps. Aucun sommeil, donc aucun test qui depend de la charge de la machine.
function horloge() {
  let t = 0;
  const taches = [];
  return {
    maintenant: () => t,
    planifier: (f, ms) => {
      const tache = { a: t + ms, f, annule: false, faite: false };
      taches.push(tache);
      return tache;
    },
    annuler: (tache) => { if (tache) tache.annule = true; },
    avancer(ms) {
      t += ms;
      // Retrie a chaque tour: une tache echue peut en planifier une autre, et
      // celle-la doit partir dans le meme avancement si son echeance y tombe.
      for (;;) {
        const prete = [...taches]
          .filter((x) => !x.annule && !x.faite && x.a <= t)
          .sort((a, b) => a.a - b.a)[0];
        if (prete === undefined) return;
        prete.faite = true;
        prete.f();
      }
    },
  };
}

const question = (no) => ({
  kind: 'event', type: TYPE_QUESTION, payload: [{ no: CHAMP_QUESTION, value: BigInt(no) }],
});
const ferme = () => ({ kind: 'event', type: 'kja', payload: [{ no: 1, value: 1n }] });
const refus = () => ({ kind: 'event', type: 'imq', payload: [] });
const etape = (type, octet) => ({ type, brute: Buffer.from([octet]) });
const creer = (sup, h, onCompteRendu = () => {}) => creerFileDialogue({
  superviseur: sup, alea: () => 0, planifier: h.planifier,
  annuler: h.annuler, maintenant: h.maintenant, onCompteRendu,
});
const fermetures = (sup) => sup.emis.filter(
  (e) => e.octets.toString('hex') === TRAME_FERMETURE.toString('hex'),
);

// Octets releves en jeu le 09/09 (journal-bug-0909.log, 918394 ms): le maitre
// ferme sa fenetre a la main. Meme forme que TRAME_ACCEPTATION de l'echange.
test('la trame de fermeture est celle mesuree', () => {
  assert.strictEqual(
    TRAME_FERMETURE.toString('hex'),
    '0a220a150a13747970652e616e6b616d612e636f6d2f6b697910ffffffffffffffffff01',
  );
});

test('les etapes partent dans l ordre, chacune apres le imw de la mule', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });

  assert.strictEqual(sup.emis.length, 0, 'rien avant le delai humain');
  h.avancer(DELAI_PLANCHER_MS);
  assert.deepStrictEqual(sup.emis.map((e) => e.octets[0]), [0x11]);

  h.avancer(140);
  assert.strictEqual(sup.emis.length, 1, 'la suite attend la question de la mule');

  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  h.avancer(DELAI_PLANCHER_MS);
  assert.deepStrictEqual(sup.emis.map((e) => e.octets[0]), [0x11, 0x22]);
});

test('deux mules avancent independamment', () => {
  const sup = faux([2, 3]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(DELAI_PLANCHER_MS);
  assert.strictEqual(sup.emis.length, 2);

  // Seule la mule 2 recoit sa question: elle seule avance.
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  h.avancer(DELAI_PLANCHER_MS);
  assert.deepStrictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x22).map((e) => e.pid), [2],
  );
});

// LES TROIS SORTIES. Aucune ne laisse la fenetre ouverte: c'est la seule
// propriete qui compte, celle qui supprime la cascade du 09/09.

test('la meme question deux fois: la mule ferme et on le dit', () => {
  const sup = faux([2]);
  const h = horloge();
  const rendus = [];
  const file = creer(sup, h, (r) => rendus.push(r));

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  h.avancer(DELAI_PLANCHER_MS);                                              // le inh part
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });  // LA MEME

  assert.strictEqual(fermetures(sup).length, 1);
  assert.deepStrictEqual(
    rendus.map((r) => [r.ok, r.raison]),
    [[false, 'la mule n a pas cette reponse']],
  );
});

// SIX REFUS, PUIS L'ABANDON. Le compte rendu porte le nombre d'essais: un
// abandon muet au premier refus est ce qui a fait perdre une soiree le 13/09.
test('imq: apres six essais on vide la file, et on dit combien', () => {
  const sup = faux([2]);
  const h = horloge();
  const rendus = [];
  const file = creer(sup, h, (r) => rendus.push(r));

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(DELAI_PLANCHER_MS);

  for (let i = 0; i < ESSAIS_OUVERTURE; i += 1) {
    file.onTrame({ pid: 2, dir: 'in', frame: refus() });
    h.avancer(DELAI_REESSAI_MS);
  }
  h.avancer(10000);

  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x11).length, ESSAIS_OUVERTURE,
    'six clics en tout, pas un septieme',
  );
  assert.deepStrictEqual(
    rendus.map((r) => r.raison),
    ['la mule n a pas pu ouvrir le dialogue (6 essai(s), trop loin ?)'],
    'un seul compte rendu, et il dit le nombre',
  );
  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x22).length, 0,
    'la reponse ne part pas: la file est videe',
  );
});

// La demande de l'utilisateur, mot pour mot: « meme s'il y a un petit retard,
// au moins elles ne seront plus jamais bloquees ».
test('le maitre a fini avant la mule: les etapes restantes partent quand meme', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x33) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: question(43122) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: question(43123) });
  h.avancer(DELAI_PLANCHER_MS);

  assert.deepStrictEqual(sup.emis.map((e) => e.octets[0]), [0x11, 0x22, 0x33]);
});

// LA FIN DE FILE NE FERME PAS TOUTE SEULE. Entre deux clics du maitre, la file
// d'une mule est vide et son dialogue est ouvert: c'est l'etat NORMAL d'un
// dialogue en cours. Fermer la fenetre a ce moment-la la fermerait pendant que
// le maitre lit sa reponse. On attend que le dialogue du MAITRE se termine.
test('tant que le maitre est dans son dialogue, la mule ne ferme pas', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  h.avancer(10000);

  assert.strictEqual(fermetures(sup).length, 0);
});

test('le kja du maitre ferme la mule, une seule fois', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  file.onTrame({ pid: 1, dir: 'in', estMaitre: true, frame: ferme() });
  h.avancer(10000);

  assert.strictEqual(fermetures(sup).length, 1);
});

// Le maitre finit AVANT que la mule ait joue ses etapes: elle les joue quand
// meme, et ferme apres. C'est la demande de l'utilisateur.
test('le kja du maitre attend que la file de la mule soit vide', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 1, dir: 'in', estMaitre: true, frame: ferme() });
  assert.strictEqual(fermetures(sup).length, 0, 'le inh n est pas encore parti');

  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  h.avancer(DELAI_PLANCHER_MS);
  assert.deepStrictEqual(sup.emis.map((e) => e.octets[0]), [0x11, 0x22]);

  file.onTrame({ pid: 2, dir: 'in', frame: question(43122) });
  h.avancer(DELAI_PLANCHER_MS);
  assert.strictEqual(fermetures(sup).length, 1);
});

// LA CEINTURE, EN PLUS DES BRETELLES. Meme si `kja` etait renomme par un patch
// et que plus rien ne fermait, ouvrir un dialogue ferme d'abord celui d'avant:
// c'est exactement le `imq {}` du 09/09 qu'on rend impossible.
test('ouvrir un nouveau dialogue ferme celui qui trainait', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  file.pousser({ pidMaitre: 1, ...etape('imp', 0x55) });
  h.avancer(DELAI_PLANCHER_MS);

  assert.deepStrictEqual(
    sup.emis.map((e) => (e.octets.toString('hex') === TRAME_FERMETURE.toString('hex') ? 'kiy' : e.octets[0])),
    [0x11, 'kiy', 0x55],
  );
});

// Le serveur referme de lui-meme a la derniere reponse d'un arbre. Fermer
// par-dessus enverrait un kiy dans le vide a chaque dialogue reussi.
test('un kja recu ferme l etat: aucune fermeture de plus n est emise', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  file.onTrame({ pid: 2, dir: 'in', frame: ferme() });
  h.avancer(10000);

  assert.strictEqual(fermetures(sup).length, 0);
});

// Le kiy du maitre est une etape comme une autre: il ne doit pas armer une
// attente de question, sinon la file se bloquerait 3 s a chaque fermeture.
test('le kiy du maitre ferme sans armer d attente', () => {
  const sup = faux([2]);
  const h = horloge();
  const rendus = [];
  const file = creer(sup, h, (r) => rendus.push(r));

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  file.pousser({ pidMaitre: 1, ...etape('kiy', 0x44) });
  h.avancer(DELAI_PLANCHER_MS);
  h.avancer(10000);

  assert.deepStrictEqual(sup.emis.map((e) => e.octets[0]), [0x11, 0x44]);
  assert.deepStrictEqual(rendus, []);
});

// LA BOUTIQUE D'UN MARCHAND passe par le MEME `imp` (action 11 au lieu de 3),
// mais le serveur y repond par la liste des articles, PAS par une question.
// Sans ce cas, le delai d'abandon fermait la boutique des mules 3 s apres
// l'ouverture — donc avant l'achat, qui vient une dizaine de secondes plus tard
// (mesure du 08/09: ouverture a 219435 ms, achat a 229028 ms).
test('une ouverture sans question ne ferme rien: c est une boutique', () => {
  const sup = faux([2]);
  const h = horloge();
  const rendus = [];
  const file = creer(sup, h, (r) => rendus.push(r));

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  h.avancer(3000);

  assert.strictEqual(fermetures(sup).length, 0);
  assert.deepStrictEqual(rendus, [], 'une boutique n est pas un incident');
});

// ...mais une REPONSE sans suite, elle, laisse bien une fenetre ouverte.
test('une reponse sans suite ferme au bout de 3 s', () => {
  const sup = faux([2]);
  const h = horloge();
  const rendus = [];
  const file = creer(sup, h, (r) => rendus.push(r));

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x33) });
  h.avancer(DELAI_PLANCHER_MS);
  h.avancer(3000);

  assert.strictEqual(fermetures(sup).length, 1);
  assert.deepStrictEqual(rendus.map((r) => r.raison), ['aucune reponse du serveur en 3 s']);
  // La file est VIDEE: l'etape suivante ne part jamais apres coup, ni tout de
  // suite ni dans dix secondes.
  h.avancer(10000);
  assert.strictEqual(sup.emis.filter((e) => e.octets[0] === 0x33).length, 0);
});

// LE PLANCHER DU GARDE-COMBAT, ET SON ANNULATION.
//
// Avant la file, le rejeu d'un dialogue attendait DELAI_PLANCHER_MS et pouvait
// etre annule par le garde-combat quand le maitre entrait en combat. La file a
// emporte les deux: son delai humain se tire entre 150 et 600 ms, et le signal
// du serveur a ete mesure a 149 ms le 13/09 (journal-bug-0909.log, 832531 ->
// 832680). Un tirage a 150 ms ne laisse pas 1 ms de marge.
//
// Le plancher ne s'applique qu'aux types que le garde surveille: une fermeture
// (`kiy`) n'ouvre aucun combat, et la retarder ne protegerait de rien.
test('une etape sensible attend le plancher du garde-combat', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });

  h.avancer(DELAI_PLANCHER_MS - 10);
  assert.strictEqual(sup.emis.length, 0, 'rien ne part avant le plancher');
  h.avancer(10);
  assert.strictEqual(sup.emis.length, 1);
});

// L'ANNULATION. Le maitre entre en combat pendant que l'etape attend: elle ne
// part pas. C'est tout le mecanisme du garde, rendu a la file.
test('annulerEnVol retire l etape qui n est pas encore partie', () => {
  const sup = faux([2, 3]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  const annules = file.annulerEnVol(1);

  assert.strictEqual(annules, 2, 'une par mule');
  h.avancer(10000);
  assert.strictEqual(sup.emis.length, 0, 'rien ne part apres l annulation');
});

// Ce qui est DEJA parti ne s'annule pas: annulerEnVol ne ment pas sur ce
// qu'elle a pu retenir.
test('annulerEnVol ne compte pas une etape deja emise', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(DELAI_PLANCHER_MS);
  assert.strictEqual(sup.emis.length, 1);

  assert.strictEqual(file.annulerEnVol(1), 0);
});

// CE QUI EST ANNULE EST JETE, PAS REPOUSSE. Defaut trouve en verifiant le
// correctif du 13/09: annulerEnVol ne retirait que l'etape EN VOL. Les etapes
// encore empilees restaient, et la prochaine action du maitre les faisait
// partir — donc la reponse de quete qui ouvre le combat, avec un tour de
// retard. Le garde n'aurait fait que decaler le degat.
test('annulerEnVol vide la file, pas seulement l etape en vol', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });

  assert.strictEqual(file.annulerEnVol(1), 2, 'l etape en vol ET celle empilee');

  h.avancer(60000);
  assert.strictEqual(sup.emis.length, 0);

  // Le maitre repart: seule sa NOUVELLE action doit suivre.
  file.pousser({ pidMaitre: 1, ...etape('imp', 0x33) });
  h.avancer(60000);
  assert.deepStrictEqual(sup.emis.map((e) => e.octets[0]), [0x33]);
});

// LE DIALOGUE OUVERT A LA MAIN N'APPARTIENT PAS A LA FILE.
//
// Defaut mesure le 13/09 en jeu (journal-bug-0909.log): l'utilisateur prend la
// main sur une mule et parle a un PNJ. La question arrive, la file l'entend,
// avance, trouve sa pile vide -- et comme le maitre a fini son propre dialogue,
// elle FERME. Trois essais de suite, meme cycle:
//
//   309290 [mule] --> imp                 le clic de l'utilisateur
//   309330 [mule] <-- imw { 1=923 ... }   la question
//   309368 [mule] <-- kja { 1=1 }         +38 ms, le serveur ferme
//
// La file ne doit fermer QUE ce qu'elle a ouvert.
test('une question ouverte a la main ne se fait pas fermer', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  // Un dialogue A NOUS, mene jusqu'a sa fermeture: c'est ce qui laisse la file
  // en etat « maitre a fini » et cree le defaut.
  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: question(100) });
  file.onTrame({ pid: 1, dir: 'in', estMaitre: true, frame: ferme() });
  const apresNotre = fermetures(sup).length;
  assert.strictEqual(apresNotre, 1, 'la file ferme bien SON dialogue');

  // L'utilisateur prend la main sur la mule et parle a un PNJ.
  file.onTrame({ pid: 2, dir: 'in', frame: question(923) });
  h.avancer(10000);

  assert.strictEqual(fermetures(sup).length, apresNotre, 'rien ne doit fermer le dialogue de l utilisateur');
});

// LA CEINTURE RESTE. Si le maitre relance un dialogue pendant que la mule en a
// un ouvert a la main, « ouvrir ferme d'abord » doit toujours faire place
// nette: sans ca, le serveur refuse l'ouverture par un `imq {}` (mesure du
// 09/09) et la mule decroche.
test('ouvrir ferme d abord, meme un dialogue ouvert a la main', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: question(100) });
  file.onTrame({ pid: 1, dir: 'in', estMaitre: true, frame: ferme() });
  const base = fermetures(sup).length;

  // L'utilisateur ouvre son dialogue a la main.
  file.onTrame({ pid: 2, dir: 'in', frame: question(923) });
  // Le maitre repart sur un PNJ.
  file.pousser({ pidMaitre: 1, ...etape('imp', 0x22) });
  h.avancer(DELAI_PLANCHER_MS);

  assert.strictEqual(fermetures(sup).length, base + 1, 'la place est faite avant d ouvrir');
  assert.ok(sup.emis.some((e) => e.octets[0] === 0x22), 'et l ouverture part');
});

// LA FILE PEUT COMMENCER PAR UNE REPONSE, sans ouverture avant elle: OMNI
// attache a des clients deja en jeu, ou une mule reintegree en plein dialogue
// du maitre. La file doit alors s'estimer chez elle -- sans quoi la question
// suivante ne la ferait plus avancer, et sa pile resterait bloquee jusqu'au
// delai de 3 s.
test('une file qui commence par une reponse avance quand meme', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x33) });
  h.avancer(DELAI_PLANCHER_MS);
  assert.deepStrictEqual(sup.emis.map((e) => e.octets[0]), [0x22]);

  file.onTrame({ pid: 2, dir: 'in', frame: question(100) });
  h.avancer(DELAI_PLANCHER_MS);

  assert.deepStrictEqual(sup.emis.map((e) => e.octets[0]), [0x22, 0x33], 'la seconde reponse doit suivre');
});

// LE MEME DEFAUT, PAR L'AUTRE PORTE: la fermeture REJOUEE.
//
// Mesure du 13/09 en jeu, apres le correctif du dialogue manuel. La mule 9276
// parle a un zaapi a la main, et la fenetre se referme encore:
//
//   122324 [9276] --> imp                     le clic de l utilisateur
//   122364 [9276] <-- imw { 1=47058 ... }     la question
//   122402 [9276] <-- kja { 1=1 }             +38 ms, exactement comme avant
//
// Le maitre n avait aucun dialogue en cours a cet instant (le sien n ouvre qu a
// 125615 ms): ce n est donc pas un `kiy` rejoue de bonne foi.
//
// LA CAUSE. `emettre()` met `ouvert = false` sur une fermeture mais laisse
// `notre = true`. Apres tout dialogue ferme par le `kiy` DU MAITRE — le cas
// normal du zaapi, ou l on clique la destination — la file continue donc de se
// croire chez elle, et la question suivante, meme ouverte a la main, la fait
// avancer jusqu a « fin de file, le maitre a fini » : elle ferme.
//
// C est ce qui donne « une fois sur deux »: la fermeture de trop remet
// `notre` a faux, donc l essai suivant passe.
test('une fermeture rejouee rend le dialogue a l utilisateur', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  // Un dialogue a nous, du clic jusqu a la fermeture rejouee du maitre.
  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: question(100) });
  file.pousser({ pidMaitre: 1, ...etape('kiy', 0x33) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 1, dir: 'in', estMaitre: true, frame: ferme() });
  const base = fermetures(sup).length;

  // L utilisateur parle a un zaapi a la main sur cette mule.
  file.onTrame({ pid: 2, dir: 'in', frame: question(47058) });
  h.avancer(10000);

  assert.strictEqual(fermetures(sup).length, base, 'la file ne ferme plus rien: le dialogue n est pas le sien');
});

// LE REFUS N'EST PAS UNE FIN. Mesure du 13/09, journal-bug-0909.log, mule 9276
// et zaapi -20004: la MEME trame `imp`, refusee a 115267 ms et acceptee a
// 122324 ms — identiques octet pour octet. Seule la position avait change: la
// mule marchait (`jpt` a 119740 et 121356 ms).
test('un refus fait repartir la meme ouverture 800 ms plus tard', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  const premier = sup.emis.filter((e) => e.octets[0] === 0x11).length;
  assert.strictEqual(premier, 1, 'le premier clic est parti');

  file.onTrame({ pid: 2, dir: 'in', frame: refus() });
  h.avancer(DELAI_REESSAI_MS - 1);
  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x11).length, premier,
    'rien ne repart avant le delai',
  );

  h.avancer(1);
  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x11).length, premier + 1,
    'le MEME clic repart, pas un autre',
  );
});

// LA QUESTION ARRETE TOUT. Au troisieme essai le panneau s'ouvre: la file doit
// avancer normalement et ne plus jamais renvoyer le clic.
test('la question recue en cours de reessai arrete les reessais', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(DELAI_PLANCHER_MS);

  file.onTrame({ pid: 2, dir: 'in', frame: refus() });
  h.avancer(DELAI_REESSAI_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: refus() });
  h.avancer(DELAI_REESSAI_MS);
  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x11).length, 3,
    'trois clics: l envoi et deux reessais',
  );

  // Le panneau s'ouvre.
  file.onTrame({ pid: 2, dir: 'in', frame: question(47058) });
  h.avancer(10000);

  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x11).length, 3,
    'plus aucun clic apres la question',
  );
  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x22).length, 1,
    'et la file a repris sa marche: la reponse est partie',
  );
});

// LE GARDE-COMBAT ANNULE UN REESSAI EN ATTENTE. Le minuteur du reessai est
// range dans `minuteurEtape`, celui que le garde annule deja: si ce n'etait
// pas le cas, la mule rejouerait son clic APRES l'entree en combat du maitre.
test('le garde annule un reessai en attente', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: refus() });

  const avant = sup.emis.filter((e) => e.octets[0] === 0x11).length;
  assert.strictEqual(file.annulerEnVol(1), 1, 'le reessai compte pour une annulation');
  h.avancer(10000);

  assert.strictEqual(
    sup.emis.filter((e) => e.octets[0] === 0x11).length, avant,
    'le clic ne repart pas',
  );
});

// UNE MULE DECOCHEE PENDANT LES REESSAIS N'EST PLUS FRAPPEE. La case est relue
// A L'ECHEANCE, pas a l'empilage — meme garde que pour une etape ordinaire.
test('une mule decochee pendant les reessais ne recoit plus rien', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  file.onTrame({ pid: 2, dir: 'in', frame: refus() });

  const avant = sup.emis.length;
  sup.etats.get(2).exclu = true;
  h.avancer(10000);

  assert.strictEqual(sup.emis.length, avant, 'plus une seule ecriture');
});

// LE REESSAI REFAIT « OUVRIR FERME D'ABORD ». C'est ce qui lui fait couvrir
// l'autre sens de `imq` — un dialogue qui traine (mesure du 09/09) — sans
// avoir a distinguer les deux causes du refus.
test('le reessai fait place nette avant de renvoyer le clic', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  const base = fermetures(sup).length;

  // Le serveur refuse: la file croit sa fenetre ouverte (demander vaut ouvrir).
  file.onTrame({ pid: 2, dir: 'in', frame: refus() });
  h.avancer(DELAI_REESSAI_MS);

  assert.strictEqual(fermetures(sup).length, base + 1, 'une fermeture avant le second clic');
  const premier = sup.emis.findIndex((e) => e.octets[0] === 0x11);
  const dernier = sup.emis.map((e) => e.octets[0]).lastIndexOf(0x11);
  const fermeture = sup.emis.findIndex(
    (e) => e.octets.toString('hex') === TRAME_FERMETURE.toString('hex'),
  );
  assert.ok(
    premier < fermeture && fermeture < dernier,
    'la fermeture tombe ENTRE les deux clics',
  );
});

// LA LIGNE QUI MANQUAIT AU JOURNAL. Le 09/09, la spec de la file montrait
// encore « 1059598 [8328] rejeu imp ecrit (+358 ms) ». Dans la session du
// 13/09, AUCUN `rejeu` pour imp, inh ou kiy: la file emet par
// superviseur.emettre(), qui ne journalise pas — contrairement a rejouer().
// C'est ce trou qui a coute le diagnostic du zaapi.
test('la file ecrit au journal ce qu elle rejoue, et le rang de l essai', () => {
  const sup = faux([2]);
  const h = horloge();
  const lignes = [];
  const file = creerFileDialogue({
    superviseur: sup, alea: () => 0, planifier: h.planifier,
    annuler: h.annuler, maintenant: h.maintenant,
    onJournal: (pid, ligne) => lignes.push([pid, ligne]),
  });

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(DELAI_PLANCHER_MS);
  assert.deepStrictEqual(lignes, [[2, 'rejeu imp ecrit (essai 1/6)']]);

  file.onTrame({ pid: 2, dir: 'in', frame: refus() });
  h.avancer(DELAI_REESSAI_MS);
  assert.deepStrictEqual(lignes[1], [2, 'rejeu imp ecrit (essai 2/6)']);

  // Une reponse ne porte pas de rang: il n'y a rien a reessayer derriere elle.
  file.onTrame({ pid: 2, dir: 'in', frame: question(47058) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(DELAI_PLANCHER_MS);
  assert.deepStrictEqual(lignes.at(-1), [2, 'rejeu inh ecrit']);
});
