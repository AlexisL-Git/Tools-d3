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
