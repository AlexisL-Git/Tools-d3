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
const { collection, estArchimonstre } = require('../src/pda-archi/archimonstres');
const hdvReprix = require('../src/hdv/reprix');
const hdvVente = require('../src/hdv/vente');
const { noterEcart } = require('../src/hdv/ecartes');

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

// L'ORDRE DES DEUX COLLECTIONS, du plus faible au plus fort. C'est le tri de
// src/pda-archi/tableau.js, recopie ici pour que « les 96 premiers » veuille
// dire « les 96 premieres lignes du panneau » et pas un paquet au hasard.
function idsParNiveau(quoi) {
  return [...collection(quoi).entrees]
    .sort((a, b) => (a.niveau - b.niveau) || (a.id - b.id))
    .map((a) => a.id);
}
const ARCHI = idsParNiveau('archi');
const BOSS = idsParNiveau('boss');

// Les ames de chaque personnage. Un pid ABSENT de cette carte a un inventaire
// NON LU: sa ligne affichera `—` et non `0`.
//
// LES IDENTIFIANTS SORTENT DES VRAIES TABLES, jamais ecrits a la main. Le
// tableau croise les ames avec archimonstres.json: un identifiant invente
// n'appartient a aucune ligne, il tombe dans « hors tableau », et le panneau
// parait vide alors que l'etat est plein.
//
// LES TROIS LOTS SE RECOUVRENT A PEINE, et c'est le point. Un banc ou tout le
// monde possede la meme chose n'affiche qu'une seule couleur de case; ce
// qu'on vient lire dans ce panneau, c'est « qui l'a, qui ne l'a pas ». Il
// faut donc des trous, et des trous a des endroits differents.
const AMES = new Map([
  // Le chasseur avance: tout le bas de la table, une poignee de pieces
  // tardives, et six ames de BOSS -- qui ne sont pas des archimonstres et
  // nourrissent la colonne « hors tableau » de la vue Archimonstres.
  [101, new Set([...ARCHI.slice(0, 96), ...ARCHI.slice(140, 152), ...BOSS.slice(0, 6)])],
  // Un debut de collection en quinconce: des trous a tous les niveaux, ce qui
  // remplit la vue par zone de « manquants » du premier au dernier ecran.
  [102, new Set(ARCHI.filter((_, i) => i % 3 === 0).slice(0, 54))],
  // Inventaire lu, aucune ame: le zero legitime, a ne pas confondre avec `—`.
  [103, new Set()],
  // Un milieu de table sans le bas: presque rien en commun avec 101, donc des
  // lignes « un seul l'a » a foison.
  [105, new Set(ARCHI.slice(60, 132))],
  // 104 ET 106 RESTENT ABSENTS, deliberement: leur inventaire n'est pas lu et
  // leur ligne affiche `—`. Au moins un des deux doit le rester, sinon la
  // distinction que ce banc sert a verifier n'est plus a l'ecran.
]);

const TOUCHES = { 1: 'F1', 2: 'F2', 3: 'F3' };

// CE QUE LE MENU HDV DE CHAQUE LIGNE DOIT SAVOIR (desktop/main.js:754-765).
// Sans ces cinq champs, les deux entrees du menu HDV restent grisees et la
// fenetre des lots ecartes est inatteignable -- l'interface meme que ce banc
// sert a travailler. Fonction et non table statique: chaque appel de
// fabriquerEtat() doit rendre des objets neufs, jamais une reference
// partagee entre deux onglets.
// UN TABLEAU D'ECARTES COMME noterEcart() EN FABRIQUE, et par le meme chemin:
// c'est `noterEcart` qui pose le nom de l'objet, ici comme en production. Le
// recopier a la main ferait du banc le seul endroit ou un nom peut etre juste
// alors que src/hdv/objets.json a bouge.
//
// `tronque` reste a false: la troncature se declenche a
// PLAFOND_ECARTES (200) lignes, et l'annoncer sous une liste de huit serait
// un badge qui ment.
function ecartes(quoi, lignes) {
  const table = lignes.reduce(noterEcart, []);
  return {
    quoi,
    lots: table.reduce((n, l) => n + l.lots, 0),
    tronque: false,
    lignes: table,
  };
}

function hdvDe(pid) {
  switch (pid) {
    // Des lots connus, aucune passe en cours: l'entree « mettre a jour les
    // prix (3 lots) » doit etre active mais pas tournante. Et une mise en
    // VENTE ratee derriere: c'est l'autre titre de la fenetre des ecartes
    // (« Lots non mis en vente »), qu'aucune autre ligne ne montre.
    case 101: return {
      hdvLots: 3, hdvEnCours: false, hdvPiles: 0, hdvVenteEnCours: false,
      hdvEcartes: ecartes('vente', [
        { gid: 7200, taille: 1, lots: 2, motif: 'au-dessus-du-plafond', vise: 1500000, borne: 900000, moyenUnitaire: 1200000 },
        { gid: 8000, taille: 10, lots: 8, motif: 'pile-fondue', vise: null, borne: null, moyenUnitaire: 340 },
        { gid: 12000, taille: 100, lots: 3, motif: 'taille-hors-creneaux', vise: null, borne: null, moyenUnitaire: 15 },
        // gid 344: ABSENT de src/hdv/objets.json. nomDe() rend null, et la
        // fenetre retombe sur le numero -- le seul chemin qui affiche un gid
        // nu, donc le seul qu'on ne verra jamais sans une ligne comme
        // celle-ci.
        { gid: 344, taille: 10, lots: 5, motif: 'marche-illisible', vise: null, borne: null, moyenUnitaire: null },
        { gid: 1575, taille: 1, lots: 1, motif: 'deduction-trop-basse', vise: 300, borne: 4500, moyenUnitaire: 5200 },
      ]),
    };
    // Une passe de prix en cours: l'icone tourne, meme sans lot connu encore.
    case 102: return { hdvLots: 0, hdvEnCours: true, hdvPiles: 0, hdvVenteEnCours: false, hdvEcartes: null };
    // Des piles en attente de mise en vente.
    case 103: return { hdvLots: 0, hdvEnCours: false, hdvPiles: 4, hdvVenteEnCours: false, hdvEcartes: null };
    // Une mise en vente en cours.
    case 104: return { hdvLots: 0, hdvEnCours: false, hdvPiles: 0, hdvVenteEnCours: true, hdvEcartes: null };
    // Des lots ecartes a la derniere passe de PRIX. La premiere ligne est
    // l'exemple ecrit en tete de src/hdv/ecartes.js -- les six lots de poils
    // partis a 7 000 002 kamas du 05/09. Les suivantes existent pour une
    // seule raison: MOTIF_ECARTE (desktop/index.html:1345) compte treize
    // motifs, et un motif qu'aucune ligne ne porte est un libelle que
    // personne ne relit jamais. Les deux fenetres en couvrent douze.
    case 105: return {
      hdvLots: 0, hdvEnCours: false, hdvPiles: 0, hdvVenteEnCours: false,
      hdvEcartes: ecartes('prix', [
        { gid: 13731, taille: 10, lots: 6, motif: 'trop-haut', vise: 7000001, borne: 7600, moyenUnitaire: 1520 },
        { gid: 448, taille: 100, lots: 4, motif: 'trop-bas', vise: 12, borne: 190, moyenUnitaire: 38 },
        // Ni moyen ni borne: les deux colonnes retombent sur `—`, et c'est la
        // seule facon de verifier qu'elles ne montrent pas « 0 » a la place.
        { gid: 311, taille: 1, lots: 9, motif: 'moyen-inconnu', vise: 4200, borne: null, moyenUnitaire: null },
        { gid: 441, taille: 10, lots: 2, motif: 'aucun-voisin', vise: null, borne: null, moyenUnitaire: 615 },
        { gid: 6900, taille: 100, lots: 11, motif: 'deja-au-minimum', vise: 1, borne: null, moyenUnitaire: 1 },
        { gid: 1234, taille: 10, lots: 3, motif: 'marche-a-1-kama', vise: 1, borne: null, moyenUnitaire: 870 },
        { gid: 439, taille: 1, lots: 5, motif: 'deduction-trop-haute', vise: 98000, borne: 24000, moyenUnitaire: 8000 },
        { gid: 13000, taille: 100, lots: 7, motif: 'sans-reponse', vise: null, borne: null, moyenUnitaire: 2450 },
      ]),
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

// LES PRIX FABRIQUES DES PEPITES. Deux passes, PRECEDENTE et COURANTE: sans
// une deuxieme table, comparer() (src/pepites/classement.js) n'aurait rien a
// comparer et toutes les lignes rendraient 'entree' -- la colonne de
// variation resterait invisible sur ce banc, qui existe pour la montrer.
//
// SEULS LES PRIX SONT INVENTES ICI. Les gid sortent de vrais objets
// recyclables de src/pepites/taux.json -- classer(), comparer() et chercher()
// (appeles par outils/interface-locale.js, jamais ici) retrouvent taux et nom
// aupres des vraies tables, exactement comme le ferait desktop/main.js avec
// une vraie trame ivi. Un prix ne se lit nulle part dans ce depot: c'est
// l'unique donnee qu'un banc doit inventer, faute d'un client Dofus reel pour
// la fournir.
//
// CHAQUE GID JOUE UN ROLE PRECIS -- au moins un de chaque etat, et un prix
// suspect (<= 10 kamas, seuil de src/pepites/classement.js):
//   312 Fer            identique aux deux passes, mais son rang bouge quand
//                       meme au gre des autres -- montee
//   442 Bronze          moins cher que la passe precedente -- montee
//   444 Etain           bien plus cher que la passe precedente -- descente
//   303 Bois de Frene    identique aux deux passes ET <= 10 kamas -- stable,
//                       suspect, et le meme gid que la recherche 'frene' sert
//                       a demontrer (voir chercherPepite sur le banc: Sac de
//                       Bois de Frene et Seve de Frene n'ont pas de prix ici,
//                       et rendent donc « prix inconnu »)
//   384 Laine de Bouftou  present seulement dans la passe precedente -- sortie
//   447 Charbon          present seulement dans la passe courante -- entree
//
// LE MARCHE, AJOUTE A LA TACHE 2: au moins une ligne de chaque source, sans
// quoi le banc ne montrerait jamais la distinction qu'on vient d'ajouter.
//   442 Bronze            porte aussi un prix de marche: la meme ligne passe
//                         de 'moyen' a 'marche' entre les deux tableaux, ET
//                         RESTE UNE MONTEE -- le prix de marche est plus bas
//                         que l'ancienne moyenne, jamais l'inverse.
//   13731 Pierre Medicinale n'a AUCUN prix moyen ici: le marche est sa seule
//                         source -- le cas mesure a 39 % du catalogue le
//                         11/09, docs/superpowers/sdd de la tache. SON PRIX
//                         EST VOLONTAIREMENT ELEVE (30000, hors de toute
//                         mesure reelle): en dessous, la nouvelle ligne se
//                         serait glissee devant les autres et aurait decale
//                         tous leurs rangs d'un cran, effacant la montee de
//                         Fer que le tableau ci-dessus promet.
// 303 (Bois de Frene) reste seul a la moyenne, et donc seul suspect: le
// marche n'est jamais suspect, la ligne perdrait ce role si on la touchait.
function pepites() {
  return {
    precedent: new Map([
      [312, 15],
      [442, 900],
      [444, 50],
      [303, 5],
      [384, 25000],
    ]),
    courant: new Map([
      [312, 15],
      [442, 400],
      [444, 5000],
      [303, 5],
      [447, 4500],
    ]),
    marche: new Map([
      [442, { prix: 350, quand: Date.now() - 3 * 60 * 1000 }],
      [13731, { prix: 30000, quand: Date.now() - 3 * 60 * 1000 }],
    ]),
    // LE PERSONNAGE VU PAR LA DERNIERE ivi: le maitre, comme le reste de ce
    // fichier le traite deja pour tableauArchi.
    perso: CLIENTS.find((c) => c.pid === MAITRE).personnage,
    quand: Date.now(),
    // PLUS ANCIEN QUE `quand`, JAMAIS EGAL: prixQuand est l'horodatage de la
    // derniere ivi, quand celui de la passe est celui d'ouverture du
    // panneau -- confondre les deux masquerait un ecart que la vraie
    // interface affiche.
    prixQuand: Date.now() - 15 * 60 * 1000,
  };
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
    hdvRythme: { ...RYTHME_HDV_DEFAUT },
    hdvGarde: { ...GARDE_HDV_DEFAUT },
    hdvBornes: BORNES,
    avisBascule: null,
    overlayOuvert: false,
    droits: [...DROITS],
    lignes,
  };
}

module.exports = { fabriquerEtat, comptesArchi, pepites };
