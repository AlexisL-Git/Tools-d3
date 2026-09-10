'use strict';

// LE FAUX ETAT DU BANC D'ESSAI DE L'INTERFACE.
// Conception: docs/superpowers/specs/2026-09-10-interface-locale-design.md
//
// Charge par outils/interface-locale.js et par personne d'autre. Rien ici ne
// part chez les amis: faire-paquet-code.js n'emporte que desktop/ et src/.
//
// LES LIGNES SONT FABRIQUEES PAR LE VRAI construireVue(), jamais ecrites a la
// main. Un faux etat ecrit a la main derive de la vraie forme au premier champ
// ajoute, et le banc se met alors a mentir en silence -- ce qui est pire que
// pas de banc du tout.

const { construireVue } = require('../src/comptes/vue');
const { RYTHME_HDV_DEFAUT, GARDE_HDV_DEFAUT } = require('../src/comptes/favoris');
const { NOMS: DROITS } = require('../src/droits/liste');
const { estArchimonstre } = require('../src/pda-archi/archimonstres');
const hdvReprix = require('../src/hdv/reprix');
const hdvVente = require('../src/hdv/vente');
const { nomDe } = require('../src/hdv/objets');

// Six comptes: un par etat de vue.js, plus le client sans idCompte qui produit
// le sixieme (« inconnu ») en se rangeant tout seul en fin de liste.
const COMPTES = [
  { id: 1, nickname: 'BrokenLegs' },
  { id: 2, nickname: 'squeezie' },
  { id: 3, nickname: 'yoplait' },
  { id: 4, nickname: 'tartiflette' },
  { id: 5, nickname: 'moumoute' },
  { id: 6, nickname: 'gigi' },
];

const CLIENTS = [
  { pid: 101, idCompte: 1, personnage: 'Kroufi', classe: 'Iop' },
  { pid: 102, idCompte: 2, personnage: 'Bellaflore', classe: 'Cra' },
  { pid: 103, idCompte: 3, personnage: 'Pansement', classe: 'Eniripsa' },
  { pid: 104, idCompte: 4, personnage: 'Saignee', classe: 'Sacrieur' },
  { pid: 105, idCompte: 5, personnage: 'Bouclier', classe: 'Feca' },
  // Aucun idCompte: c'est le client « inconnu », celui qu'aucune ligne de
  // compte n'absorbe. Le compte 6 (gigi) reste donc hors-ligne.
  { pid: 106, idCompte: null, personnage: 'Fantome', classe: 'Osamodas' },
];

const MAITRE = 101;

// Les ames de chaque personnage. Un pid ABSENT de cette carte a un inventaire
// NON LU: sa ligne affichera `—` et non `0`.
// Les identifiants sont de vrais archimonstres de src/pda-archi/archimonstres.json.
const AMES = new Map([
  [101, new Set([2354, 2312, 2343])],
  [102, new Set([2354])],
  // Inventaire lu, aucune ame: le zero legitime, a ne pas confondre avec `—`.
  [103, new Set()],
]);

const TOUCHES = { 1: 'F1', 2: 'F2', 3: 'F3' };

// CE QUE LE MENU HDV DE CHAQUE LIGNE DOIT SAVOIR (desktop/main.js:754-765).
// Sans ces cinq champs, les deux entrees du menu HDV restent grisees et la
// fenetre des lots ecartes est inatteignable -- l'interface meme que ce banc
// sert a travailler. Fonction et non table statique: chaque appel de
// fabriquerEtat() doit rendre des objets neufs, jamais une reference
// partagee entre deux onglets.
function hdvDe(pid) {
  switch (pid) {
    // Des lots connus, aucune passe en cours: l'entree « mettre a jour les
    // prix (3 lots) » doit etre active mais pas tournante.
    case 101: return { hdvLots: 3, hdvEnCours: false, hdvPiles: 0, hdvVenteEnCours: false, hdvEcartes: null };
    // Une passe de prix en cours: l'icone tourne, meme sans lot connu encore.
    case 102: return { hdvLots: 0, hdvEnCours: true, hdvPiles: 0, hdvVenteEnCours: false, hdvEcartes: null };
    // Des piles en attente de mise en vente.
    case 103: return { hdvLots: 0, hdvEnCours: false, hdvPiles: 4, hdvVenteEnCours: false, hdvEcartes: null };
    // Une mise en vente en cours.
    case 104: return { hdvLots: 0, hdvEnCours: false, hdvPiles: 0, hdvVenteEnCours: true, hdvEcartes: null };
    // Des lots ecartes a la derniere passe: la forme est celle de
    // src/hdv/ecartes.js (noterEcart), relue par desktop/index.html:1372
    // (ouvrirEcartes). Le gid, le marche delirant et le plafond viennent de
    // l'exemple ecrit en tete de src/hdv/ecartes.js.
    case 105: return {
      hdvLots: 0, hdvEnCours: false, hdvPiles: 0, hdvVenteEnCours: false,
      hdvEcartes: {
        quoi: 'prix',
        lots: 6,
        tronque: false,
        lignes: [
          { gid: 13731, taille: 10, lots: 6, motif: 'trop-haut', vise: 7000001, borne: 7600, moyenUnitaire: 1520, nom: nomDe(13731) },
        ],
      },
    };
    // Aucune activite HDV connue pour ce pid: le meme repli que « pas de
    // client », donc aussi la valeur pour toute ligne sans pid.
    default: return { hdvLots: 0, hdvEnCours: false, hdvPiles: 0, hdvVenteEnCours: false, hdvEcartes: null };
  }
}

const BORNES = {
  reprix: {
    lot: [hdvReprix.DELAI_MIN, hdvReprix.DELAI_MAX],
    objet: [hdvReprix.DELAI_OBJET_MIN, hdvReprix.DELAI_OBJET_MAX],
    pause: [hdvReprix.PAUSE_MIN, hdvReprix.PAUSE_MAX],
    avantPause: [hdvReprix.AVANT_PAUSE_MIN, hdvReprix.AVANT_PAUSE_MAX],
  },
  vente: {
    lot: [hdvVente.DELAI_RAFALE_MIN, hdvVente.DELAI_RAFALE_MAX],
    objet: [hdvVente.DELAI_OBJET_MIN, hdvVente.DELAI_OBJET_MAX],
    pause: [hdvVente.PAUSE_MIN, hdvVente.PAUSE_MAX],
    avantPause: [hdvVente.AVANT_PAUSE_MIN, hdvVente.AVANT_PAUSE_MAX],
  },
};

// Les comptes tels que src/pda-archi/tableau.js les attend. Neufs a chaque
// appel: les Set sont recopies pour qu'un appelant ne puisse pas vider la
// reference partagee.
function comptesArchi() {
  return CLIENTS.map((c) => {
    const ames = AMES.get(c.pid);
    return { pid: c.pid, nom: c.personnage, ames: ames === undefined ? null : new Set(ames) };
  });
}

function fabriquerEtat() {
  const lignes = construireVue({
    comptes: COMPTES,
    clients: CLIENTS,
    // Le pid 104 n'est ni intercepte ni en attente: c'est lui qui produit
    // « non-intercepte », le client lance avant OMNI.
    intercepte: new Set([101, 102, 106]),
    enAttente: new Set([103]),
    erreurs: new Map([[105, 'attache impossible : process not found']]),
    messages: new Map([[102, "InteractiveUseRequest : manque skillInstanceUid pour l'element 4198401"]]),
    maitre: MAITRE,
    exclus: new Set([4]),
    favoris: new Set([1]),
    passeTour: new Set([2, 3]),
    invitation: new Set([1, 2]),
    noAnim: new Set([1]),
    echange: new Set([2]),
  });

  // Les huit champs que desktop/main.js pose APRES construireVue: touche,
  // archi, embleme (main.js:785-809), puis les cinq champs hdv* (main.js:
  // 754-765).
  for (const l of lignes) {
    l.touche = l.id === null ? null : (TOUCHES[l.id] || null);
    const ames = l.pid === null || l.pid === undefined ? undefined : AMES.get(l.pid);
    l.archi = ames === undefined ? null : [...ames].filter(estArchimonstre).length;
    // Le banc ne telecharge rien: la page retombe sur l'abreviation de classe,
    // chemin qu'elle sait deja prendre quand le cache d'emblemes est froid.
    l.embleme = null;

    // Meme garde que l'aUnPid de main.js: sans pid, les cinq champs hdv*
    // retombent sur « pas de client ».
    const aUnPid = l.pid !== null && l.pid !== undefined;
    Object.assign(l, hdvDe(aUnPid ? l.pid : null));
  }

  return {
    version: 'dev',
    pdaArchi: false,
    pdaArchiRepli: false,
    sansMaitre: false,
    erreurComptes: null,
    delai: 0,
    hdvRythme: { ...RYTHME_HDV_DEFAUT },
    hdvGarde: { ...GARDE_HDV_DEFAUT },
    hdvBornes: BORNES,
    avisBascule: null,
    overlayOuvert: false,
    droits: [...DROITS],
    lignes,
  };
}

module.exports = { fabriquerEtat, comptesArchi };
