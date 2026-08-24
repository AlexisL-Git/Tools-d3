'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { creerDepot } = require('../../amorceur/depot');
const { creerCle } = require('../../amorceur/cle');
const { ecrireArchive, empreinte } = require('../../amorceur/archive');
const { demarrer } = require('../../amorceur/demarrage');

function racine() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'amorceur-'));
}

function installer(r, version) {
  const d = path.join(r, 'versions', version);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'marqueur.txt'), version);
}

const ARCHIVE = ecrireArchive([{ chemin: 'desktop/main.js', contenu: Buffer.from('// version neuve\n') }]);
const SHA = empreinte(ARCHIVE);

// Faux ecrans: rendent des reponses programmees et comptent les appels.
function fauxEcrans(reponses = []) {
  const e = {
    demandes: [],
    arrets: [],
    async demanderCle(opts) { e.demandes.push(opts || {}); return reponses.shift(); },
    async afficherArret(opts) { e.arrets.push(opts); },
  };
  return e;
}

function fauxCanal({ manifestes = [], paquets = [] }) {
  return {
    async manifeste() { return manifestes.shift(); },
    async paquet() { return paquets.shift(); },
  };
}

function contexte(r, options) {
  return {
    depot: creerDepot(r),
    cle: creerCle(r),
    journal: () => {},
    versionPaquet: '0.2.0',
    installerInitiale: () => { installer(r, '0.2.0'); },
    ...options,
  };
}

test('premier lancement: la cle est demandee, validee, puis enregistree', async () => {
  const r = racine();
  const ecrans = fauxEcrans(['MA-CLE']);
  const res = await demarrer(contexte(r, {
    ecrans,
    canal: fauxCanal({ manifestes: [{ etat: 'ok', manifeste: { version: '0.2.0', sha256: SHA, actif: true, message: null } }] }),
  }));
  assert.strictEqual(res.action, 'charger');
  assert.strictEqual(res.version, '0.2.0');
  assert.strictEqual(creerCle(r).lire(), 'MA-CLE');
  assert.strictEqual(ecrans.demandes.length, 1);
});

test('lancements suivants: la cle du disque sert, aucun ecran ne s ouvre', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  installer(r, '0.2.0');
  const ecrans = fauxEcrans();
  const res = await demarrer(contexte(r, {
    ecrans,
    canal: fauxCanal({ manifestes: [{ etat: 'ok', manifeste: { version: '0.2.0', sha256: SHA, actif: true, message: null } }] }),
  }));
  assert.strictEqual(res.action, 'charger');
  assert.strictEqual(ecrans.demandes.length, 0);
});

test('une cle refusee redemande une cle, et la bonne demarre', async () => {
  const r = racine();
  creerCle(r).ecrire('CLE-MORTE');
  installer(r, '0.2.0');
  const ecrans = fauxEcrans(['CLE-NEUVE']);
  const res = await demarrer(contexte(r, {
    ecrans,
    canal: fauxCanal({ manifestes: [
      { etat: 'refuse' },
      { etat: 'ok', manifeste: { version: '0.2.0', sha256: SHA, actif: true, message: null } },
    ] }),
  }));
  assert.strictEqual(res.action, 'charger');
  assert.strictEqual(creerCle(r).lire(), 'CLE-NEUVE');
  assert.strictEqual(ecrans.demandes.length, 1);
});

test('fermer la fenetre de saisie arrete l application', async () => {
  const r = racine();
  installer(r, '0.2.0');
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans([null]),
    canal: fauxCanal({}),
  }));
  assert.strictEqual(res.action, 'arreter');
  assert.strictEqual(res.raison, 'sans-cle');
});

test('une cle refusee que l ami ne remplace pas arrete l application', async () => {
  const r = racine();
  creerCle(r).ecrire('CLE-MORTE');
  installer(r, '0.2.0');
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans([null]),
    canal: fauxCanal({ manifestes: [{ etat: 'refuse' }] }),
  }));
  assert.strictEqual(res.action, 'arreter');
  assert.strictEqual(res.raison, 'cle-refusee');
});

test('service injoignable: on demarre sur la version en place, sans bruit', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  installer(r, '0.2.0');
  const ecrans = fauxEcrans();
  const res = await demarrer(contexte(r, {
    ecrans,
    canal: fauxCanal({ manifestes: [{ etat: 'injoignable', raison: 'ENOTFOUND' }] }),
  }));
  assert.strictEqual(res.action, 'charger');
  assert.strictEqual(res.version, '0.2.0');
  assert.strictEqual(ecrans.arrets.length, 0);
});

test('coupe-circuit: actif false arrete tout le monde avec le message', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  installer(r, '0.2.0');
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans(),
    canal: fauxCanal({ manifestes: [{ etat: 'ok', manifeste: { version: '0.2.0', sha256: SHA, actif: false, message: 'maj de Dofus, on attend' } }] }),
  }));
  assert.strictEqual(res.action, 'arreter');
  assert.strictEqual(res.raison, 'coupe-circuit');
  assert.strictEqual(res.message, 'maj de Dofus, on attend');
});

test('une version plus recente est telechargee, installee, et chargee', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  installer(r, '0.2.0');
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans(),
    canal: fauxCanal({
      manifestes: [{ etat: 'ok', manifeste: { version: '0.3.0', sha256: SHA, actif: true, message: null } }],
      paquets: [{ etat: 'ok', archive: ARCHIVE }],
    }),
  }));
  assert.strictEqual(res.version, '0.3.0');
  assert.strictEqual(fs.readFileSync(path.join(r, 'versions', '0.3.0', 'desktop', 'main.js'), 'utf8'), '// version neuve\n');
  // Le temoin est pose AVANT le chargement: c'est lui qui rattrapera un plantage.
  assert.strictEqual(creerDepot(r).lire().essai, '0.3.0');
});

test('archive corrompue: rien n est installe, on garde la version en place', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  installer(r, '0.2.0');
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans(),
    canal: fauxCanal({
      manifestes: [{ etat: 'ok', manifeste: { version: '0.3.0', sha256: SHA, actif: true, message: null } }],
      paquets: [{ etat: 'corrompu', obtenu: '00' }],
    }),
  }));
  assert.strictEqual(res.action, 'charger');
  assert.strictEqual(res.version, '0.2.0');
  assert.strictEqual(fs.existsSync(path.join(r, 'versions', '0.3.0')), false);
});

test('une version refusee annoncee par le manifeste n est pas retelechargee', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  installer(r, '0.2.0');
  installer(r, '0.3.0');
  const d = creerDepot(r);
  d.ecrire({ version: '0.2.0', essai: null, refusees: ['0.3.0'] });
  let paquetsDemandes = 0;
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans(),
    canal: {
      async manifeste() { return { etat: 'ok', manifeste: { version: '0.3.0', sha256: SHA, actif: true, message: null } }; },
      async paquet() { paquetsDemandes += 1; return { etat: 'ok', archive: ARCHIVE }; },
    },
  }));
  assert.strictEqual(res.version, '0.2.0');
  assert.strictEqual(paquetsDemandes, 0);
});

test('depot vierge: la version du paquet est installee avant tout', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans(),
    canal: fauxCanal({ manifestes: [{ etat: 'injoignable', raison: 'hors ligne' }] }),
  }));
  assert.strictEqual(res.action, 'charger');
  assert.strictEqual(res.version, '0.2.0');
});

test('aucune version et service injoignable: on arrete en le disant', async () => {
  const r = racine();
  creerCle(r).ecrire('MA-CLE');
  const res = await demarrer(contexte(r, {
    ecrans: fauxEcrans(),
    canal: fauxCanal({ manifestes: [{ etat: 'injoignable', raison: 'hors ligne' }] }),
    installerInitiale: () => {},   // le paquet n'a rien pu poser
  }));
  assert.strictEqual(res.action, 'arreter');
  assert.strictEqual(res.raison, 'aucune-version');
});
