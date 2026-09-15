// LA NAVIGATION ET LE THEME. Premier module ES du depot: verifie le 14/09
// par une sonde Electron 43 qu un <script type="module"> avec import relatif
// s execute bien dans un renderer sandboxe charge par loadFile -- le cas
// exact de la production (desktop/main.js:954).
//
// Etre un module n est pas cosmetique: chaque module a SA portee. Le
// commentaire en tete de outils/faux-app.js raconte ce que coutait la portee
// partagee -- une seconde declaration de COLONNES au premier niveau, et tout
// le script de la page ne s executait JAMAIS: l ossature s affichait, sans
// une ligne, sans un mot ailleurs que dans une console que la production
// n ouvre pas.

const CLE_THEME = 'omni.theme';

// Les trois etats du theme, et pourquoi il en faut trois:
//   null     -> suivre Windows (aucun attribut, prefers-color-scheme decide)
//   'sombre' -> sombre impose, meme sur un Windows clair
//   'clair'  -> clair impose, meme sur un Windows sombre
// Deux etats ne suffiraient pas: on ne pourrait plus revenir a « suivre ».
const CYCLE = [null, 'sombre', 'clair'];

const MOT = { null: 'Système', sombre: 'Sombre', clair: 'Clair' };

function lireTheme() {
  // localStorage peut lever ou revenir vide -- fenetre privee, donnees de
  // site effacees. Un theme oubliable ne vaut pas une page blanche.
  try {
    const v = localStorage.getItem(CLE_THEME);
    return CYCLE.includes(v) ? v : null;
  } catch (e) {
    return null;
  }
}

function poserTheme(valeur) {
  const racine = document.documentElement;
  // Le RETRAIT est ce qui rend « suivre Windows » possible: tant qu un
  // attribut est pose, la requete de media ne peut plus rien dire.
  if (valeur === null) racine.removeAttribute('data-theme');
  else racine.setAttribute('data-theme', valeur);

  const mot = document.getElementById('motTheme');
  if (mot !== null) mot.textContent = MOT[String(valeur)];

  try {
    if (valeur === null) localStorage.removeItem(CLE_THEME);
    else localStorage.setItem(CLE_THEME, valeur);
  } catch (e) {
    // Le theme est pose a l ecran; ne pas pouvoir le retenir n est pas
    // une raison d interrompre le montage de la page.
  }
}

function montrer(nom) {
  for (const b of document.querySelectorAll('.rail button[data-vue]')) {
    b.classList.toggle('actif', b.dataset.vue === nom);
  }
  for (const v of document.querySelectorAll('.vue')) {
    v.classList.toggle('actif', v.id === `v-${nom}`);
  }
}

export function monterRail() {
  poserTheme(lireTheme());

  for (const b of document.querySelectorAll('.rail button[data-vue]')) {
    // `disabled` suffit a Windows, mais pas a un clic simule: la garde
    // explicite evite d ouvrir un ecran vide sur Courses.
    b.addEventListener('click', () => {
      if (b.disabled) return;
      montrer(b.dataset.vue);
    });
  }

  const bt = document.getElementById('btTheme');
  if (bt !== null) {
    bt.addEventListener('click', () => {
      const i = CYCLE.indexOf(lireTheme());
      poserTheme(CYCLE[(i + 1) % CYCLE.length]);
    });
  }
}
