'use strict';
const frida = require('frida');
const { createProxy } = require('./proxy/server');
const { FrameReassembler } = require('./codec/framing');
const { decodeFrameRaw, remplacerChamp } = require('./codec/rawProto');
const { writeVarint } = require('./codec/framing');
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
  // arme = false: tout est calcule et journalise, rien n'est envoye. C'est le
  // defaut, et il doit le rester tant qu'on n'a pas decide d'ecrire pour de
  // bon sur le reseau.
  constructor({ onTrame = () => {}, onJournal = () => {}, arme = false } = {}) {
    this.comptes = new Comptes();
    this.clients = new Map();
    this.maitre = null;
    this.arme = arme;
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

  // Construit, pour un esclave donne, les octets a lui envoyer — ou dit
  // pourquoi c'est impossible. Ne touche pas au reseau.
  preparer(typeMessage, brute, etatEsclave) {
    const connu = lookup(typeMessage);
    if (connu === null) return { ok: false, raison: 'type non répertorié' };

    // Le contexte vient du message du maitre: l'element du monde qu'il
    // designe, a partir duquel chaque esclave retrouve son propre numero.
    const contexte = {};
    if (needsRewrite(typeMessage)) {
      const decodee = decodeFrameRaw(brute);
      const elem = connu.fields.elementId;
      if (elem && decodee) {
        const c = (decodee.payload || []).find((f) => f.no === elem.no);
        if (c) contexte.elementId = c.value;
      }
    }

    const verdict = etatEsclave.peutRejouer(typeMessage, contexte);
    if (!verdict.possible) return { ok: false, raison: `manque ${verdict.manque.join(', ')}` };

    if (!needsRewrite(typeMessage)) return { ok: true, octets: brute, action: 'copier' };

    let sortie = brute;
    for (const [nom, f] of Object.entries(connu.fields)) {
      if (f.nature !== 'compte') continue;
      if (f.no === undefined) return { ok: false, raison: `numéro de champ inconnu pour ${nom}` };
      const valeur = nom === 'fsor' ? etatEsclave.characterId
        : nom === 'skillInstanceUid' ? etatEsclave.skillPour(contexte.elementId)
        : null;
      if (valeur === null) return { ok: false, raison: `valeur inconnue pour ${nom}` };
      const refait = remplacerChamp(sortie, f.no, valeur);
      // Une substitution qui echoue doit arreter le rejeu: emettre la trame
      // du maitre telle quelle ferait agir l'esclave avec l'identifiant d'un
      // autre.
      if (refait === null) return { ok: false, raison: `substitution impossible sur ${nom}` };
      sortie = refait;
    }
    return { ok: true, octets: sortie, action: 'réécrire' };
  }

  // Rejoue une action du maitre chez tous les esclaves. Rend le compte rendu
  // de ce qui a ete fait, ou de ce qui aurait ete fait si arme vaut false.
  rejouer({ type, brute, pidMaitre }) {
    const rendu = [];
    for (const etat of this.comptes.esclaves(pidMaitre)) {
      const prep = this.preparer(type, brute, etat);
      if (!prep.ok) {
        rendu.push({ pid: etat.pid, ok: false, emis: false, raison: prep.raison });
        continue;
      }
      const client = this.clients.get(etat.pid);
      if (!client || !client.amont) {
        rendu.push({ pid: etat.pid, ok: false, emis: false, raison: 'pas de socket amont' });
        continue;
      }
      // Le reassembleur retire le prefixe de longueur: il faut le remettre.
      const paquet = Buffer.concat([writeVarint(prep.octets.length), prep.octets]);
      if (this.arme) client.amont.write(paquet);
      // `ok` dit que le rejeu est possible, `emis` qu'il a eu lieu. Les
      // confondre faisait passer tout succes pour un refus en mode
      // observation, ou rien n'est jamais emis.
      rendu.push({ pid: etat.pid, ok: true, emis: this.arme, action: prep.action, octets: paquet.length });
    }
    return rendu;
  }

  // Ecrit une trame sur UN client. Contrairement a rejouer(), qui vise tous
  // les esclaves et obeit au drapeau `arme` du Replicate, emettre ne juge
  // rien: l'appelant a deja decide. C'est ce qui permet au passe-tour d'avoir
  // son propre interrupteur sans dependre de celui du Replicate.
  emettre(pid, octets) {
    const client = this.clients.get(pid);
    if (!client) return { ok: false, raison: 'client inconnu' };
    if (!client.amont) return { ok: false, raison: 'pas de socket amont' };
    // Le reassembleur retire le prefixe de longueur: il faut le remettre.
    const paquet = Buffer.concat([writeVarint(octets.length), octets]);
    // Le passe-tour a delai non nul appelle emettre depuis un setTimeout, donc
    // hors de toute garde: une socket fermee entre l'armement et l'echeance y
    // ferait remonter une exception non capturee dans le process principal.
    // L'echec doit se rendre comme un refus ordinaire.
    try { client.amont.write(paquet); }
    catch (e) { return { ok: false, raison: e.message }; }
    return { ok: true, octets: paquet.length };
  }

  // Un client ferme doit disparaitre de la liste: sinon il continue de figurer
  // dans chaque plan de rejeu comme « pas de socket amont », et brouille le
  // compte rendu avec des refus qui n'ont pas lieu d'etre.
  async retirer(pid) {
    const c = this.clients.get(pid);
    if (!c) return false;
    this.clients.delete(pid);
    this.comptes.retirer(pid);
    if (this.maitre === pid) this.maitre = null;
    await (c.script ? c.script.unload().catch(() => {}) : Promise.resolve());
    await (c.session ? c.session.detach().catch(() => {}) : Promise.resolve());
    await (c.proxy ? c.proxy.close().catch(() => {}) : Promise.resolve());
    return true;
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
