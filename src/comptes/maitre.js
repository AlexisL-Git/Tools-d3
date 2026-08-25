'use strict';

// Qui commande, et lui seul.
//
// Le maitre etait le dernier client Dofus a avoir eu le focus: chaque agent
// sondait GetForegroundWindow() toutes les 250 ms et signalait son passage au
// premier plan. Cliquer sur un alt pour une vente a l'HDV en faisait le maitre,
// et c'etaient SES actions qui partaient chez tous les autres, leader compris.
// Le declencheur de la replication n'etait pas decide, il etait herite d'un
// geste de fenetre sans rapport avec l'intention.
//
// Le maitre est desormais choisi. Ce module dit lequel, ou qu'il n'y en a pas.
//
// Fonction pure: ni Electron, ni Frida, ni disque, ni process. Comme
// construireVue, dont elle partage les entrees.

// epingle    — l'identifiant de compte retenu dans favoris.json, ou null.
// clients    — la sortie de listerClients(): { pid, idCompte, ... }.
// intercepte — les pid dont une trame a ete decodee (l'ensemble avecTrafic).
//
// Rend le pid du maitre, ou null s'il n'y en a pas.
//
// L'ELIGIBILITE EXIGE LE TRAFIC PROUVE, pas la simple attache. Un maitre doit
// EMETTRE des trames, sinon il n'y a rien a repliquer: exclure la fenetre
// d'attente ne coute donc rien, puisque avant la premiere trame il n'y a par
// construction aucune action a dupliquer. Meme raisonnement que celui qui a
// fait choisir la trame decodee plutot que l'attache reussie comme preuve
// d'interception.
//
// Le pid n'est jamais memorise: Windows les recycle, et un compte relance en a
// un nouveau. C'est l'identifiant de compte qui est retenu, et le pid s'en
// deduit a chaque appel.
function resoudreMaitre({ epingle, clients, intercepte }) {
  if (!Number.isInteger(epingle)) return null;
  const client = (clients || []).find((c) => c.idCompte === epingle);
  if (client === undefined) return null;
  return intercepte.has(client.pid) ? client.pid : null;
}

module.exports = { resoudreMaitre };
