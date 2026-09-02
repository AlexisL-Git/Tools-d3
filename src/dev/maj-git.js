'use strict';
const { execFile } = require('node:child_process');

// SAVOIR, EN MODE DEV, QUE LE DEPOT A BOUGE.
//
// Le mode developpement charge le code du depot tel quel: amorceur/principal.js
// sort avant meme de construire son canal reseau. Aucun manifeste, aucune
// version_vue, donc aucun signal quand origin/master a avance. Ce module est ce
// signal, et rien d'autre: il LIT le depot et sait l'avancer en avance rapide.
// Il n'ecrit jamais d'histoire dedans -- ni commit, ni push, ni stash.
//
// Rien d'Electron ici, et aucun appel direct a git: la commande est injectee,
// comme `chercher` l'est dans src/droits/veille.js. C'est ce qui permet de
// tester les sept cas sans depot reel et sans connexion.

const DELAI_MS = 10000;

// TROIS ETATS, JAMAIS CONFONDUS -- meme vocabulaire que amorceur/canal.js:
//   a-jour     HEAD == @{upstream}
//   en-retard  n commits d'ecart, et on sait lesquels
//   inconnu    git absent, dossier sans depot, ou reseau coupe
//
// Le troisieme n'est JAMAIS rendu comme le premier. Dire « a jour » quand on ne
// sait pas, c'est mentir sur le seul fait que cet indicateur existe pour donner.
function inconnu(raison) {
  return { etat: 'inconnu', retard: null, locale: null, distante: null, branche: null, propre: null, raison };
}

// L'executeur reel. Un TABLEAU d'arguments, jamais un shell: rien de ce qui
// vient d'ailleurs ne peut se faire passer pour une commande.
function executeurGit() {
  return (args, racine) => new Promise((resoudre) => {
    execFile('git', args, { cwd: racine, windowsHide: true, timeout: DELAI_MS }, (e, stdout, stderr) => {
      const sortie = String(stdout || '').trim();
      if (!e) return resoudre({ ok: true, sortie, erreur: '' });
      resoudre({
        ok: false,
        sortie,
        erreur: String(stderr || '').trim() || String(e.message || e),
        code: e.code,
      });
    });
  });
}

// LA REFERENCE A LAQUELLE ON SE COMPARE.
//
// @{upstream} d'abord: la branche de travail change (feat/overlay,
// feat/maj-git-dev) et l'indicateur doit suivre celle sur laquelle on est,
// pas une branche supposee.
//
// Mais une branche creee en local n'a PAS d'amont, et c'est le cas courant ici:
// `git checkout -b` n'en pose pas. Sans ce repli, l'indicateur repondrait
// « maj non verifiee » sur toute branche de travail, c'est-a-dire precisement
// quand on developpe. On se compare alors a la branche par defaut du depot.
async function refDistante(executer, racine) {
  const amont = await executer(['rev-parse', '--abbrev-ref', '@{upstream}'], racine);
  if (amont.ok && amont.sortie) return amont.sortie;
  const defaut = await executer(['rev-parse', '--abbrev-ref', 'origin/HEAD'], racine);
  if (defaut.ok && defaut.sortie) return defaut.sortie;
  return null;
}

async function etatDepot({ racine, executer = executeurGit() }) {
  const depot = await executer(['rev-parse', '--git-dir'], racine);
  if (!depot.ok) {
    // ENOENT ne vient pas de git, il vient de l'absence de git: le distinguer
    // evite d'annoncer « pas un depot » sur une machine ou rien n'est installe.
    if (depot.code === 'ENOENT') return inconnu('git introuvable sur cette machine');
    return inconnu("ce dossier n'est pas un depot git");
  }

  const branche = await executer(['rev-parse', '--abbrev-ref', 'HEAD'], racine);

  // Le fetch est une LECTURE: il remplit refs/remotes, il ne touche jamais au
  // dossier de travail. Son echec est un incident reseau, pas une reponse.
  const fetch = await executer(['fetch', '--quiet'], racine);
  if (!fetch.ok) return inconnu(fetch.erreur || 'depot distant injoignable');

  const ref = await refDistante(executer, racine);
  if (ref === null) return inconnu('aucune branche distante a laquelle se comparer');

  const compte = await executer(['rev-list', '--count', 'HEAD..' + ref], racine);
  if (!compte.ok) return inconnu(compte.erreur || 'comparaison impossible');

  const retard = Number.parseInt(compte.sortie, 10);
  if (!Number.isFinite(retard)) return inconnu('reponse de git illisible');

  const locale = await executer(['rev-parse', '--short', 'HEAD'], racine);
  const distante = await executer(['rev-parse', '--short', ref], racine);
  const statut = await executer(['status', '--porcelain'], racine);

  return {
    etat: retard > 0 ? 'en-retard' : 'a-jour',
    retard,
    locale: locale.ok ? locale.sortie : null,
    distante: distante.ok ? distante.sortie : null,
    branche: branche.ok ? branche.sortie : null,
    // Un arbre sale n'empeche rien a priori: c'est --ff-only qui tranchera.
    propre: statut.ok ? statut.sortie === '' : null,
    reference: ref,
    raison: null,
  };
}

// L'AVANCE RAPIDE, ET ELLE SEULE. --ff-only refuse au lieu de fusionner: devant
// des commits locaux ou une divergence, le dossier de travail ne bouge pas et
// le message de git remonte tel quel.
async function mettreAJour({ racine, executer = executeurGit() }) {
  const avant = await executer(['rev-parse', 'HEAD'], racine);
  if (!avant.ok) return { etat: 'refus', relancable: false, raison: avant.erreur || 'depot illisible' };

  const ref = await refDistante(executer, racine);
  if (ref === null) return { etat: 'refus', relancable: false, raison: 'aucune branche distante a laquelle se comparer' };

  // fetch puis merge --ff-only plutot que pull: `pull` tout court exige un
  // amont configure, ce qu'une branche creee en local n'a pas. Nommer la
  // reference marche dans les deux cas, et c'est la meme que celle qu'on a
  // affichee -- l'indicateur et le bouton ne peuvent pas parler de deux
  // branches differentes.
  const fetch = await executer(['fetch', '--quiet'], racine);
  if (!fetch.ok) return { etat: 'refus', relancable: false, raison: fetch.erreur || 'depot distant injoignable' };

  const avance = await executer(['merge', '--ff-only', ref], racine);
  if (!avance.ok) return { etat: 'refus', relancable: false, raison: avance.erreur || 'avance rapide impossible' };

  const apres = await executer(['rev-parse', 'HEAD'], racine);
  if (!apres.ok) return { etat: 'refus', relancable: false, raison: apres.erreur || 'depot illisible' };

  // RELANCER SANS npm install DONNERAIT UN ECRAN MORT. C'est exactement la
  // panne du 29/08 qui a fait refuser la 0.2.6 chez un ami: « Cannot find
  // module 'frida' », version ecartee pour toujours. Quand package.json a
  // bouge, on le DIT et on laisse la main.
  const touches = await executer(['diff', '--name-only', avant.sortie, apres.sortie], racine);
  const listeTouches = touches.ok ? touches.sortie.split('\n').map((l) => l.trim()).filter(Boolean) : [];
  const dependances = listeTouches.includes('package.json') || listeTouches.includes('package-lock.json');

  return {
    etat: 'ok',
    relancable: !dependances,
    raison: dependances ? 'package.json a change : lance npm install avant de relancer' : null,
  };
}

module.exports = { etatDepot, mettreAJour, executeurGit, DELAI_MS };
