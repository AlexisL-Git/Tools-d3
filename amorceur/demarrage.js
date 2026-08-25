'use strict';
const fs = require('node:fs');
const { extraire } = require('./archive');
const { comparerVersions } = require('./depot');

// Installe une archive dans versions/<version>, atomiquement: on extrait a
// cote puis on renomme. Une extraction interrompue ne doit jamais laisser un
// dossier a moitie rempli, que versionsInstallees() compterait comme valide.
function installerArchive(depot, version, archive) {
  const cible = depot.dossierDe(version);
  const partiel = cible + '.partiel';
  fs.rmSync(partiel, { recursive: true, force: true });
  try {
    extraire(archive, partiel);
    fs.rmSync(cible, { recursive: true, force: true });
    fs.renameSync(partiel, cible);
    return true;
  } catch (e) {
    fs.rmSync(partiel, { recursive: true, force: true });
    return false;
  }
}

async function demarrer({ depot, canal, cle, ecrans, installerInitiale, versionPaquet, journal = () => {} }) {
  // 1. La regle du temoin s'applique AVANT tout le reste: si la version
  //    chargee au lancement precedent n'a jamais atteint son etat pret, elle
  //    est ecartee ici, definitivement.
  let choix = depot.choisirVersion();
  if (choix.refusee) {
    journal(`version ${choix.refusee} abandonnee: elle n'a pas demarre`);
    // Range ici et pas ailleurs: c'est le seul instant ou l'information
    // existe. L'envoi, lui, appartient a principal.js.
    depot.filerSignalement(choix.refusee);
  }

  // 2. Depot vierge: le paquet pose sa propre version. Un ami sans reseau
  //    demarre quand meme.
  if (!choix.version) {
    installerInitiale();
    choix = depot.choisirVersion();
    journal(choix.version
      ? `version ${versionPaquet} posee depuis le paquet`
      : `le paquet n'a pas pu poser sa version ${versionPaquet}`);
  }

  // 3. La cle. Elle n'est enregistree qu'une fois validee par le serveur:
  //    l'enregistrer avant ferait garder une cle morte, et l'ecran ne
  //    reapparaitrait plus.
  let secret = cle.lire();
  let message = null;
  let manifeste = null;

  for (;;) {
    if (!secret) {
      secret = await ecrans.demanderCle({ message });
      if (!secret) return { action: 'arreter', raison: message ? 'cle-refusee' : 'sans-cle' };
    }
    const r = await canal.manifeste(secret);
    if (r.etat === 'refuse') {
      journal('cle refusee par le service');
      message = "Cette cle n'est pas (ou plus) valide. Demande-en une nouvelle.";
      secret = null;
      continue;
    }
    if (r.etat === 'injoignable') {
      // Un incident reseau ne revoque personne et n'arrete personne.
      journal(`service injoignable: ${r.raison}`);
      break;
    }
    cle.ecrire(secret);
    manifeste = r.manifeste;
    break;
  }

  // 4. Le coupe-circuit global, seul moyen d'arreter tout le monde en une
  //    minute le jour ou l'outil devient dangereux pour les comptes.
  if (manifeste && manifeste.actif === false) {
    return { action: 'arreter', raison: 'coupe-circuit', message: manifeste.message || null };
  }

  // 5. Une version plus recente, jamais refusee, est recuperee.
  if (manifeste && manifeste.version) {
    const etat = depot.lire();
    const dejaInstallee = depot.versionsInstallees().includes(manifeste.version);
    const refusee = etat.refusees.includes(manifeste.version);
    const plusRecente = !choix.version || comparerVersions(manifeste.version, choix.version) > 0;
    if (!dejaInstallee && !refusee && plusRecente) {
      const p = await canal.paquet(secret, manifeste.sha256);
      if (p.etat === 'ok') {
        if (installerArchive(depot, manifeste.version, p.archive)) {
          journal(`version ${manifeste.version} installee`);
        } else {
          journal(`extraction de ${manifeste.version} en echec: on garde ${choix.version}`);
        }
      } else {
        journal(`telechargement de ${manifeste.version} refuse: ${p.etat}`);
      }
      choix = depot.choisirVersion();
    }
  }

  if (!choix.version) return { action: 'arreter', raison: 'aucune-version', message: null };

  // 6. Le temoin se pose AVANT le chargement. C'est lui, et lui seul, qui
  //    rattrape une version qui plante au demarrage.
  depot.poserTemoin(choix.version);
  return { action: 'charger', version: choix.version, dossier: depot.dossierDe(choix.version) };
}

module.exports = { demarrer, installerArchive };
