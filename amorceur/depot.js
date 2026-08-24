'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Compare deux numeros de version champ par champ, en nombres. Un tri de
// chaines placerait '0.10.0' AVANT '0.9.0' et servirait une vieille version
// pour toujours.
function comparerVersions(a, b) {
  const ca = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const cb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(ca.length, cb.length); i += 1) {
    const d = (ca[i] || 0) - (cb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function creerDepot(racine) {
  const dossierVersions = path.join(racine, 'versions');
  const fichierEtat = path.join(dossierVersions, 'courante.json');

  // Toute lecture rate en douceur: un etat illisible vaut un etat vierge. Un
  // amorceur qui leve ici laisse l'application morte, ce que rien ne rattrape.
  function lire() {
    try {
      const brut = JSON.parse(fs.readFileSync(fichierEtat, 'utf8'));
      return {
        version: typeof brut.version === 'string' ? brut.version : null,
        essai: typeof brut.essai === 'string' ? brut.essai : null,
        refusees: Array.isArray(brut.refusees) ? brut.refusees.filter((x) => typeof x === 'string') : [],
      };
    } catch (e) {
      return { version: null, essai: null, refusees: [] };
    }
  }

  // Ecriture atomique: fichier temporaire puis renommage. Une coupure au
  // mauvais moment laisserait sinon un JSON tronque, donc un depot vierge,
  // donc une version reinstallee pour rien.
  function ecrire(etat) {
    fs.mkdirSync(dossierVersions, { recursive: true });
    const tmp = fichierEtat + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(etat, null, 2));
    fs.renameSync(tmp, fichierEtat);
  }

  function dossierDe(version) {
    return path.join(dossierVersions, version);
  }

  function versionsInstallees() {
    try {
      return fs.readdirSync(dossierVersions, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort(comparerVersions);
    } catch (e) {
      return [];
    }
  }

  function poserTemoin(version) {
    ecrire({ ...lire(), essai: version });
  }

  function effacerTemoin() {
    ecrire({ ...lire(), essai: null });
  }

  function refuser(version) {
    const etat = lire();
    if (!etat.refusees.includes(version)) etat.refusees.push(version);
    ecrire(etat);
  }

  // Applique la regle du temoin et rend la version a charger.
  function choisirVersion() {
    const etat = lire();
    let refusee = null;
    if (etat.essai) {
      // Le temoin est reste: la version n'a pas atteint son etat pret au
      // lancement precedent. Elle est declaree mauvaise, definitivement.
      refusee = etat.essai;
      if (!etat.refusees.includes(refusee)) etat.refusees.push(refusee);
      etat.essai = null;
    }
    const candidates = versionsInstallees().filter((v) => !etat.refusees.includes(v));
    const version = candidates.length ? candidates[candidates.length - 1] : null;
    etat.version = version;
    ecrire(etat);
    return { version, refusee };
  }

  return { lire, ecrire, dossierDe, versionsInstallees, choisirVersion, poserTemoin, effacerTemoin, refuser };
}

module.exports = { creerDepot, comparerVersions };
