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

function listerClients() {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
      { timeout: 10000, windowsHide: true },
      (err, stdout) => resolve(err ? [] : analyserSortie(stdout)));
  });
}

module.exports = { extraireIdCompte, extrairePersonnage, analyserSortie, listerClients };
