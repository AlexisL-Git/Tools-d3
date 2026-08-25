'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// LE PONT ENTRE L'INTERFACE ET LE PROCESS PRINCIPAL, verifie de bout en bout.
//
// Trois fichiers doivent s'accorder, et rien ne le garantissait:
//
//   desktop/index.html    appelle window.app.<nom>(...)
//   desktop/preload.js    expose <nom> et le relaie par ipcRenderer.invoke
//   desktop/main.js       enregistre ipcMain.handle('<nom>', ...)
//
// Une rupture ne casse RIEN au demarrage. Elle ne se voit qu'au moment ou
// l'utilisateur clique, sous la forme d'un bouton qui « ne fait rien » — le
// mode d'echec le plus couteux de ce projet, et le plus difficile a relier a sa
// cause.
//
// C'est arrive le 2026-08-25: en retirant les cinq interrupteurs generaux du
// preload, une expression paresseuse a emporte cinq canaux voisins. Quatre des
// cinq cases par compte et le bouton « designer » sont devenus inertes, sans le
// moindre message, et le diagnostic a pris bien plus longtemps que ce test.
//
// Assertion sur le SOURCE, comme celle qui verifie que comptes/zaap.js ne
// touche jamais au keydata: le chemin concerne demande un vrai renderer.

const dossier = path.join(__dirname, '..', 'desktop');
const lire = (nom) => fs.readFileSync(path.join(dossier, nom), 'utf8');

const html = lire('index.html');
const preload = lire('preload.js');
const main = lire('main.js');

// Ce que l'interface appelle vraiment.
const appeles = new Set(
  [...html.matchAll(/window\.app\.([a-zA-Z]+)\s*\(/g)].map((m) => m[1]),
);
// Ce que le pont expose.
const exposes = new Set(
  [...preload.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((m) => m[1]),
);
// Ce que le process principal ecoute.
const ecoutes = new Set(
  [...main.matchAll(/ipcMain\.handle\(\s*'([a-zA-Z]+)'/g)].map((m) => m[1]),
);

test('l interface appelle au moins un canal, sinon le test ne prouve rien', () => {
  assert.ok(appeles.size >= 10, `seulement ${appeles.size} appels trouvés`);
});

test('tout ce que l interface appelle est exposé par le preload', () => {
  const manquants = [...appeles].filter((n) => n !== 'surEtat' && !exposes.has(n));
  assert.deepStrictEqual(
    manquants, [],
    `window.app.${manquants.join('/')} est appelé par index.html mais absent de preload.js : le bouton ne fera rien`,
  );
});

test('tout ce que le preload relaie a un gestionnaire côté principal', () => {
  const relayes = [...preload.matchAll(/ipcRenderer\.invoke\(\s*'([a-zA-Z]+)'/g)].map((m) => m[1]);
  const manquants = [...new Set(relayes)].filter((n) => !ecoutes.has(n));
  assert.deepStrictEqual(
    manquants, [],
    `${manquants.join(', ')} est relayé par preload.js sans ipcMain.handle : l'appel restera sans réponse`,
  );
});

// Un canal expose que personne n'appelle elargit la frontiere de confiance
// sans raison — c'est la doctrine ecrite en tete de preload.js.
test('le preload n expose rien que l interface n utilise', () => {
  const inutiles = [...exposes].filter((n) => n !== 'surEtat' && !appeles.has(n));
  assert.deepStrictEqual(
    inutiles, [],
    `${inutiles.join(', ')} est exposé sans être appelé : surface inutile`,
  );
});
