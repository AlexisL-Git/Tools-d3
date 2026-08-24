'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { preparerPublication } = require('../publier');

test('preparerPublication ecrit l archive et rend son sha256', () => {
  const contenu = Buffer.from('paquet-test');
  const attendu = crypto.createHash('sha256').update(contenu).digest('hex');
  let ecrit = null;
  const r = preparerPublication({
    version: '0.3.0',
    contenuArchive: contenu,
    ecrireFichier: (chemin, data) => { ecrit = { chemin, data }; },
  });
  assert.strictEqual(r.sha256, attendu);
  assert.match(r.chemin, /0\.3\.0\.tar\.gz$/);
  assert.strictEqual(ecrit.data, contenu);
});
