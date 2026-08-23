'use strict';
const { execFile } = require('node:child_process');

// Identification des clients Dofus en cours, et du compte de chacun.
//
// La ligne de commande d'un client porte
//   -logFile "...\gamesLogs\dofus-dofus3\dofus.<idCompte>.log"
// ou <idCompte> est exactement le champ id d'une entree de USER_ACCOUNTS.
// Relier une fenetre a un compte ne demande donc ni heuristique ni saisie.

const ID_JOURNAL = /dofus\.(\d+)\.log/i;
// Titre en jeu: "Personnage - Classe - 3.6.10.10 - Release". Avant l'entree en
// partie, il n'y a que la version, et un launcher tiers peut le reecrire.
// Hypothese: ni le nom du personnage ni celui de la classe ne contiennent de
// tiret ([^-]+? les exclut). Si elle est fausse, le titre n'est simplement pas
// reconnu: personnage/classe restent null, le compte apparait sans nom de
// personnage, rien ne plante.
const TITRE_EN_JEU = /^([^-]+?)\s+-\s+([^-]+?)\s+-\s+\d+\.\d+\.\d+\.\d+\s+-\s+/;

function extraireIdCompte(ligne) {
  if (typeof ligne !== 'string') return null;
  const m = ID_JOURNAL.exec(ligne);
  return m === null ? null : Number(m[1]);
}

function extrairePersonnage(titre) {
  if (typeof titre !== 'string') return { personnage: null, classe: null };
  const m = TITRE_EN_JEU.exec(titre);
  if (m === null) return { personnage: null, classe: null };
  return { personnage: m[1].trim(), classe: m[2].trim() };
}

function analyserSortie(json) {
  let brut;
  try { brut = JSON.parse(json); } catch (e) { return []; }
  if (brut === null || brut === undefined) return [];
  // PowerShell rend un objet seul quand il n'y a qu'un process.
  const liste = Array.isArray(brut) ? brut : [brut];
  return liste.map((p) => ({
    pid: p.ProcessId,
    idCompte: extraireIdCompte(p.CommandLine),
    ...extrairePersonnage(p.MainWindowTitle),
  }));
}

// Un seul appel PowerShell rend a la fois la ligne de commande (via CIM) et le
// titre de fenetre (via Get-Process), que Node ne sait pas obtenir seul.
const SCRIPT = [
  '$t = @{};',
  'Get-Process -Name Dofus -ErrorAction SilentlyContinue | ForEach-Object { $t[$_.Id] = $_.MainWindowTitle };',
  "Get-CimInstance Win32_Process -Filter \"Name='Dofus.exe'\" |",
  'ForEach-Object { [pscustomobject]@{ ProcessId = $_.ProcessId; CommandLine = $_.CommandLine; MainWindowTitle = $t[[int]$_.ProcessId] } } |',
  'ConvertTo-Json -Compress',
].join(' ');

// executer est injectable (par defaut le vrai execFile) pour tester le chemin
// d'echec sans dependre d'un vrai PowerShell.
function listerClients(executer = execFile) {
  return new Promise((resolve) => {
    executer('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
      { timeout: 10000, windowsHide: true },
      (err, stdout) => resolve(err ? [] : analyserSortie(stdout)));
  });
}

// Ferme les clients dont on donne les pid. `tuer` est injecte pour que la
// fonction se teste sans tuer quoi que ce soit.
//
// LE GARDE SUR LE PID N'EST PAS COSMETIQUE: sous Node, process.kill(0) vise le
// GROUPE de processus courant, donc l'application elle-meme. Un zero dans la
// liste ferait que le bouton OFF ferme l'application au lieu des clients.
function fermerClients(pids, tuer = (pid) => process.kill(pid)) {
  const rendu = [];
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
      rendu.push({ pid, ok: false, raison: 'pid invalide' });
      continue;
    }
    // Un client ferme entre l'enumeration et le clic fait lever: c'est un
    // chemin normal, pas une anomalie, et les suivants doivent suivre.
    try { tuer(pid); rendu.push({ pid, ok: true }); }
    catch (e) { rendu.push({ pid, ok: false, raison: e.message }); }
  }
  return rendu;
}

module.exports = { extraireIdCompte, extrairePersonnage, analyserSortie, listerClients, fermerClients };
