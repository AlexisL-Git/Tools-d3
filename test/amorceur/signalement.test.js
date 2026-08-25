'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { creerSignalement } = require('../../amorceur/signalement');

function fauxDepot(attente = []) {
  let file = attente.slice();
  return {
    signalementsEnAttente: () => file.slice(),
    viderSignalements: () => { file = []; },
    restant: () => file,
  };
}

function fauxCanal(etat) {
  const envois = [];
  return {
    envois,
    signaler: async (cle, corps) => { envois.push({ cle, corps }); return { etat }; },
  };
}

test('sans cle, rien n est envoye', async () => {
  const canal = fauxCanal('ok');
  const s = creerSignalement({ depot: fauxDepot(), canal, lireJournal: () => 'J' });
  const r = await s.envoyer(null, '0.2.4');
  assert.strictEqual(r.etat, 'sans-cle');
  assert.strictEqual(canal.envois.length, 0);
});

test('sans refus en attente, la version part quand meme et le journal n est pas lu', async () => {
  const canal = fauxCanal('ok');
  let lu = 0;
  const s = creerSignalement({ depot: fauxDepot(), canal, lireJournal: () => { lu += 1; return 'J'; } });
  await s.envoyer('CLE', '0.2.4');
  assert.strictEqual(canal.envois.length, 1);
  assert.deepStrictEqual(canal.envois[0].corps, { version: '0.2.4', refus: [] });
  assert.strictEqual(lu, 0);
});

test('avec un refus, le journal est joint', async () => {
  const canal = fauxCanal('ok');
  const s = creerSignalement({ depot: fauxDepot(['0.2.3']), canal, lireJournal: () => 'J' });
  await s.envoyer('CLE', '0.2.4');
  assert.deepStrictEqual(canal.envois[0].corps.refus, [{ version: '0.2.3', journal: 'J' }]);
});

test('un 200 vide la file', async () => {
  const depot = fauxDepot(['0.2.3']);
  const s = creerSignalement({ depot, canal: fauxCanal('ok'), lireJournal: () => 'J' });
  await s.envoyer('CLE', '0.2.4');
  assert.deepStrictEqual(depot.restant(), []);
});

test('un echec CONSERVE la file: c est tout l interet du mecanisme', async () => {
  const depot = fauxDepot(['0.2.3']);
  const s = creerSignalement({ depot, canal: fauxCanal('injoignable'), lireJournal: () => 'J' });
  await s.envoyer('CLE', '0.2.4');
  assert.deepStrictEqual(depot.restant(), ['0.2.3']);
});

test('un refus par le serveur conserve aussi la file', async () => {
  const depot = fauxDepot(['0.2.3']);
  const s = creerSignalement({ depot, canal: fauxCanal('refuse'), lireJournal: () => 'J' });
  await s.envoyer('CLE', '0.2.4');
  assert.deepStrictEqual(depot.restant(), ['0.2.3']);
});

test('un lireJournal qui explose n empeche pas l envoi', async () => {
  const canal = fauxCanal('ok');
  const s = creerSignalement({
    depot: fauxDepot(['0.2.3']), canal,
    lireJournal: () => { throw new Error('fichier illisible'); },
  });
  await s.envoyer('CLE', '0.2.4');
  assert.deepStrictEqual(canal.envois[0].corps.refus, [{ version: '0.2.3', journal: null }]);
});

test('version absente: on envoie null, pas undefined', async () => {
  const canal = fauxCanal('ok');
  const s = creerSignalement({ depot: fauxDepot(), canal, lireJournal: () => 'J' });
  await s.envoyer('CLE', null);
  assert.strictEqual(canal.envois[0].corps.version, null);
});
