'use strict';
const frida = require('frida');
const { createProxy } = require('./proxy/server');
const { FrameReassembler } = require('./codec/framing');
const { decodeFrameRaw } = require('./codec/rawProto');
const { connectAgentSource } = require('./il2cpp/connectAgent');
const { Comptes } = require('./protocol/compte');
const { lookup, needsRewrite } = require('./protocol/replicate');

// Pilote 1 a 8 clients Dofus simultanes.
//
// Un proxy PAR client, chacun sur son propre port: la ligne CONNECT ne dit pas
// quel compte se connecte, c'est le port d'ecoute qui les distingue. C'est la
// regle que suit le produit de krm35, dont les proxies occupaient 8102, 8105
// et 8106 pour deux clients.
//
// Le maitre est le client dont la fenetre a le focus; les autres rejouent.
// Chaque agent signale lui-meme son passage au premier plan.

const PORT_JEU = 5555;

class Client {
  constructor({ pid, nom }) {
    this.pid = pid;
    this.nom = nom;
    this.port = null;
    this.session = null;
    this.script = null;
    this.proxy = null;
    // La socket amont de la connexion de jeu: c'est par la qu'une trame
    // rejouee sera ecrite. Rien n'est emis tant que emettre() n'est pas appele.
    this.amont = null;
    this.reassembleurs = new Map();
  }
}

class Superviseur {
  constructor({ onTrame = () => {}, onJournal = () => {} } = {}) {
    this.comptes = new Comptes();
    this.clients = new Map();
    this.maitre = null;
    this.onTrame = onTrame;
    this.onJournal = onJournal;
  }

  journal(pid, texte) {
    this.onJournal(pid, texte);
  }

  async ajouter({ pid, nom }) {
    const client = new Client({ pid, nom });
    this.clients.set(pid, client);

    // Port 0: le systeme en attribue un libre. Rien a coordonner entre huit
    // clients, et aucun conflit avec un run precedent reste ouvert.
    client.proxy = await createProxy({
      port: 0,
      onProbleme: (p) => this.journal(pid, `connexion ${p.id} abandonnée — ${p.raison}`),
      onData: (dir, buf, conn) => this._recevoir(client, dir, buf, conn),
    });
    client.port = client.proxy.port;

    const etat = this.comptes.ajouter({ pid, port: client.port });

    client.session = await frida.attach(pid);
    client.script = await client.session.createScript(connectAgentSource({
      proxyPort: client.port,
      onlyPorts: [],           // tout sauf les exclusions
      excludePorts: [26116],   // le launcher Ankama: le detourner coupe la session
      reportFocus: true,
    }));
    client.script.message.connect((m) => {
      if (m.type === 'error') return this.journal(pid, `agent: ${m.description}`);
      const p = m.payload || {};
      if (p.premierPlan !== undefined) {
        if (p.premierPlan) { this.maitre = pid; this.journal(pid, 'devient MAÎTRE'); }
      } else if (p.ready) {
        this.journal(pid, `agent en place sur le port ${client.port} — ${p.ready.join(' | ')}`);
      }
    });
    await client.script.load();
    return etat;
  }

  _recevoir(client, dir, buf, conn) {
    if (conn.port !== PORT_JEU) return;
    if (conn.amont) client.amont = conn.amont;

    const cle = `${conn.id}/${dir}`;
    if (!client.reassembleurs.has(cle)) client.reassembleurs.set(cle, new FrameReassembler());
    let trames = [];
    try { trames = client.reassembleurs.get(cle).push(buf); }
    catch (e) { return this.journal(client.pid, `cadrage: ${e.message}`); }

    const etat = this.comptes.get(client.pid);
    for (const brute of trames) {
      const frame = decodeFrameRaw(brute);
      if (etat) etat.observer(frame);
      if (frame === null) continue;
      this.onTrame({ pid: client.pid, dir, frame, brute, estMaitre: client.pid === this.maitre });
    }
  }

  // Ce que chaque esclave ferait d'une action du maitre, SANS rien emettre.
  // Sert a verifier le raisonnement avant d'ecrire quoi que ce soit sur le
  // reseau: tant que ce plan n'est pas juste, emettre serait prematuré.
  planRejeu(typeMessage, pidMaitre) {
    const connu = lookup(typeMessage);
    const plan = [];
    for (const etat of this.comptes.esclaves(pidMaitre)) {
      if (connu === null) {
        plan.push({ pid: etat.pid, action: 'ignorer', raison: 'type non répertorié' });
        continue;
      }
      const verdict = etat.peutRejouer(typeMessage);
      if (!verdict.possible) {
        plan.push({ pid: etat.pid, action: 'ignorer', raison: `manque ${verdict.manque.join(', ')}` });
      } else if (needsRewrite(typeMessage)) {
        plan.push({ pid: etat.pid, action: 'réécrire', champs: connu.fields });
      } else {
        plan.push({ pid: etat.pid, action: 'copier' });
      }
    }
    return plan;
  }

  async arreter() {
    for (const c of this.clients.values()) {
      await (c.script ? c.script.unload().catch(() => {}) : Promise.resolve());
      await (c.session ? c.session.detach().catch(() => {}) : Promise.resolve());
      await (c.proxy ? c.proxy.close() : Promise.resolve());
    }
  }
}

module.exports = { Superviseur, Client, PORT_JEU };
