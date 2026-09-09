'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  creerFileDialogue, TRAME_FERMETURE, TYPE_QUESTION, CHAMP_QUESTION,
} = require('../src/file-dialogue');

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
  h.avancer(150);
  assert.deepStrictEqual(sup.emis.map((e) => e.octets[0]), [0x11]);

  h.avancer(140);
  assert.strictEqual(sup.emis.length, 1, 'la suite attend la question de la mule');

  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  h.avancer(150);
  assert.deepStrictEqual(sup.emis.map((e) => e.octets[0]), [0x11, 0x22]);
});

test('deux mules avancent independamment', () => {
  const sup = faux([2, 3]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(150);
  assert.strictEqual(sup.emis.length, 2);

  // Seule la mule 2 recoit sa question: elle seule avance.
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  h.avancer(150);
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
  h.avancer(150);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  h.avancer(150);                                              // le inh part
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });  // LA MEME

  assert.strictEqual(fermetures(sup).length, 1);
  assert.deepStrictEqual(
    rendus.map((r) => [r.ok, r.raison]),
    [[false, 'la mule n a pas cette reponse']],
  );
});

test('imq: la mule n a pas pu ouvrir, on vide la file', () => {
  const sup = faux([2]);
  const h = horloge();
  const rendus = [];
  const file = creer(sup, h, (r) => rendus.push(r));

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  h.avancer(150);
  file.onTrame({ pid: 2, dir: 'in', frame: { kind: 'event', type: 'imq', payload: [] } });
  h.avancer(10000);

  assert.deepStrictEqual(rendus.map((r) => r.raison), ['la mule n a pas pu ouvrir le dialogue']);
  assert.strictEqual(sup.emis.filter((e) => e.octets[0] === 0x22).length, 0);
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
  h.avancer(150);
  file.onTrame({ pid: 2, dir: 'in', frame: question(43122) });
  h.avancer(150);
  file.onTrame({ pid: 2, dir: 'in', frame: question(43123) });
  h.avancer(150);

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
  h.avancer(150);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  h.avancer(10000);

  assert.strictEqual(fermetures(sup).length, 0);
});

test('le kja du maitre ferme la mule, une seule fois', () => {
  const sup = faux([2]);
  const h = horloge();
  const file = creer(sup, h);

  file.pousser({ pidMaitre: 1, ...etape('imp', 0x11) });
  h.avancer(150);
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
  h.avancer(150);
  file.onTrame({ pid: 1, dir: 'in', estMaitre: true, frame: ferme() });
  assert.strictEqual(fermetures(sup).length, 0, 'le inh n est pas encore parti');

  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  h.avancer(150);
  assert.deepStrictEqual(sup.emis.map((e) => e.octets[0]), [0x11, 0x22]);

  file.onTrame({ pid: 2, dir: 'in', frame: question(43122) });
  h.avancer(150);
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
  h.avancer(150);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  file.pousser({ pidMaitre: 1, ...etape('imp', 0x55) });
  h.avancer(150);

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
  h.avancer(150);
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
  h.avancer(150);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  file.pousser({ pidMaitre: 1, ...etape('kiy', 0x44) });
  h.avancer(150);
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
  h.avancer(150);
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
  h.avancer(150);
  file.onTrame({ pid: 2, dir: 'in', frame: question(2681) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x22) });
  file.pousser({ pidMaitre: 1, ...etape('inh', 0x33) });
  h.avancer(150);
  h.avancer(3000);

  assert.strictEqual(fermetures(sup).length, 1);
  assert.deepStrictEqual(rendus.map((r) => r.raison), ['aucune reponse du serveur en 3 s']);
  // La file est VIDEE: l'etape suivante ne part jamais apres coup, ni tout de
  // suite ni dans dix secondes.
  h.avancer(10000);
  assert.strictEqual(sup.emis.filter((e) => e.octets[0] === 0x33).length, 0);
});
