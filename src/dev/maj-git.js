'use strict';
const { execFile } = require('node:child_process');

// SAVOIR, EN MODE DEV, QUE LE DEPOT A BOUGE. RIEN DE PLUS.
//
// Le mode developpement charge le code du depot tel quel: amorceur/principal.js
// sort avant meme de construire son canal reseau. Aucun manifeste, aucune
// version_vue, donc aucun signal quand origin/master a avance. Ce module est ce
// signal, et rien d'autre.
//
// Il LIT le depot, un point c'est tout: ni commit, ni push, ni stash, ni meme
// une avance rapide. Un bouton qui mettait a jour a existe ici le 2026-09-02;
// il a ete retire le jour meme, a la premiere utilisation reelle. En
// developpement le dossier de travail est presque toujours en cours de
// modification, donc `merge --ff-only` refusait, et l'ami se retrouvait devant
// un pave d'erreur git en anglais pour toute reponse. Dire ou on en est a de la
// valeur; agir a la place de qui developpe n'en avait pas.
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
    // Un arbre sale n'empeche rien: OMNI ne met plus a jour lui-meme, il
    // dit ou tu en es. Le champ reste parce que l'interface l'affiche.
    propre: statut.ok ? statut.sortie === '' : null,
    reference: ref,
    raison: null,
  };
}

module.exports = { etatDepot, executeurGit, DELAI_MS };
