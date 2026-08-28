'use strict';
const frida = require('frida');
const { createProxy } = require('./proxy/server');
const { FrameReassembler } = require('./codec/framing');
const { decodeFrameRaw, remplacerChamp } = require('./codec/rawProto');
const { writeVarint } = require('./codec/framing');
const { connectAgentSource } = require('./il2cpp/connectAgent');
const { Comptes } = require('./protocol/compte');
const { lookup, needsRewrite } = require('./protocol/omni');

// Pilote 1 a 8 clients Dofus simultanes.
//
// Un proxy PAR client, chacun sur son propre port: la ligne CONNECT ne dit pas
// quel compte se connecte, c'est le port d'ecoute qui les distingue. C'est la
// regle que suit le produit de krm35, dont les proxies occupaient 8102, 8105
// et 8106 pour deux clients.
//
// Le maitre est CHOISI, et les autres rejouent. Il l a longtemps ete par le
// focus: chaque agent sondait GetForegroundWindow() toutes les 250 ms et
// signalait son passage au premier plan. Cliquer sur un alt pour une vente a
// l HDV en faisait le maitre, et c etaient SES actions qui partaient chez tous
// les autres, leader compris.
//
// Le superviseur n ecrit donc plus jamais this.maitre de lui-meme: le champ est
// pose par desktop/main.js a partir du compte epingle dans favoris.json. Sans
// maitre, this.maitre vaut null et rien ne se replique.

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
  // etalementRejeu — { minMs, maxMs } pour espacer les esclaves, ou null pour
  //   emettre pendant l'appel. Null par defaut, comme `arme` vaut faux par
  //   defaut: le comportement inerte est celui qu'on obtient sans rien
  //   demander. Les deux appelants reels (l'application et le CLI) l'activent.
  // alea, planifier — injectes pour que l'etalement se teste sans dormir.
  constructor({
    onTrame = () => {}, onJournal = () => {}, arme = false, transformerEntrant = null,
    etalementRejeu = null, alea = Math.random, planifier = setTimeout, onSouris = () => {},
  } = {}) {
    this.comptes = new Comptes();
    this.clients = new Map();
    this.maitre = null;
    // Le dernier client qu'on a REELLEMENT mis au premier plan, confirme par
    // son agent. Ce n'est pas « qui est devant »: personne ne le surveille
    // plus, et le curseur du cycle vit dans desktop/main.js.
    //
    // IL NE DECERNE RIEN. Le maitre est epingle: confondre le focus et le
    // commandement est exactement ce qu'on a retire.
    this.enAvant = null;
    this.arme = arme;
    this.onTrame = onTrame;
    this.onJournal = onJournal;
    // Les appuis de bouton remontes par les agents. Le superviseur ne juge
    // rien: il transporte, et desktop/main.js decide s'ils correspondent a un
    // raccourci.
    this.onSouris = onSouris;
    // La boucle de sondage ne tourne dans les clients que si au moins un
    // bouton est assigne. L'etat est retenu ici pour etre pose sur les clients
    // qui s'attachent APRES le reglage.
    this.sourisActive = false;
    // Transforme le flux descendant avant qu'il n'atteigne le client. Nul par
    // defaut: le proxy relaie alors octet pour octet, comme avant l'ajout du
    // no-anim.
    this.transformerEntrant = transformerEntrant;
    this.etalementRejeu = etalementRejeu;
    this.alea = alea;
    this.planifier = planifier;
  }

  // Ecart, en millisecondes entieres, entre un esclave et le precedent. Borne
  // aux deux bouts: un ecart nul remettrait deux comptes sur la meme
  // milliseconde, ce que l'etalement existe justement pour eviter.
  _ecartEtalement() {
    if (this.etalementRejeu === null) return 0;
    const { minMs, maxMs } = this.etalementRejeu;
    return minMs + Math.floor(this.alea() * (maxMs - minMs + 1));
  }

  journal(pid, texte) {
    this.onJournal(pid, texte);
  }

  // Un seul transformerEntrant sert tous les comptes: createProxy attribue
  // ses conn.id localement a chaque appel, donc deux comptes ont chacun une
  // connexion n°1, n°2, etc. Sans cette enveloppe, src/noanim-flux.js — qui
  // indexe son etat (reassembleur, drapeau inerte) par conn.id — ferait
  // partager le meme reassembleur a deux comptes differents: un cadrage
  // perdu chez l'un recracherait ses octets bufferises dans la socket de
  // l'autre. Le pid rend la cle unique par compte.
  //
  // FILTRE DE PORT (CRITICAL de revue finale). _recevoir filtre deja
  // conn.port !== PORT_JEU (voir plus bas): sans le meme filtre ici, le
  // transformateur s'appliquait a TOUTE connexion que l'agent redirige, y
  // compris le HTTPS et les CDN du client. Rejeu d'une capture reelle:
  // 124 Ko avales sur une seule socket CDN, pour une ligne de journal. Toute
  // connexion hors du port du jeu doit rester intouchee, exactement comme
  // pour l'observation.
  //
  // null reste null: si aucun transformateur n'est configure, createProxy
  // doit recevoir null tel quel, pas une fonction qui rend toujours null —
  // la garantie « inerte par defaut » du proxy repose sur l'absence de
  // fonction, pas sur son resultat.
  _transformateurPour(pid) {
    if (this.transformerEntrant === null) return null;
    const transformateur = (buf, conn) => {
      if (conn.port !== PORT_JEU) return null;
      return this.transformerEntrant(buf, { id: `${pid}/${conn.id}`, port: conn.port, pid });
    };
    // Purge de l'etat par connexion a la fermeture (IMPORTANT de revue
    // finale): sans crochet de fermeture, chaque connexion laisse une
    // entree permanente dans la Map de src/noanim-flux.js. N'existe que si
    // le transformateur expose fermer() -- les autres appelants de tests ne
    // le fournissent pas forcement.
    transformateur.fermer = (conn) => {
      if (typeof this.transformerEntrant.fermer === 'function') {
        this.transformerEntrant.fermer(`${pid}/${conn.id}`);
      }
    };
    return transformateur;
  }

  async ajouter({ pid, nom }) {
    const client = new Client({ pid, nom });
    this.clients.set(pid, client);

    // Port 0: le systeme en attribue un libre. Rien a coordonner entre huit
    // clients, et aucun conflit avec un run precedent reste ouvert.
    const transformateur = this._transformateurPour(pid);
    client.proxy = await createProxy({
      port: 0,
      onProbleme: (p) => this.journal(pid, `connexion ${p.id} abandonnée — ${p.raison}`),
      onData: (dir, buf, conn) => this._recevoir(client, dir, buf, conn),
      transformerEntrant: transformateur,
      onClose: (conn) => { if (transformateur) transformateur.fermer(conn); },
    });
    client.port = client.proxy.port;

    const etat = this.comptes.ajouter({ pid, port: client.port });

    client.session = await frida.attach(pid);
    client.script = await client.session.createScript(connectAgentSource({
      proxyPort: client.port,
      onlyPorts: [],           // tout sauf les exclusions
      excludePorts: [26116],   // le launcher Ankama: le detourner coupe la session
      // La surveillance du premier plan est DE NOUVEAU eteinte, et cette fois
      // plus rien n'en depend. Elle etait revenue pour dire d'ou partait
      // « personnage suivant »; la navigation est devenue un cycle franc, qui
      // retient le dernier client vise au lieu de chercher lequel est devant.
      //
      // Ce que ca economise n'est pas symbolique: une boucle setInterval de
      // 250 ms tournait A L'INTERIEUR de chaque client Dofus, uniquement pour
      // repondre a une question qu'on ne pose plus.
      reportFocus: false,
    }));
    client.script.message.connect((m) => {
      if (m.type === 'error') return this.journal(pid, `agent: ${m.description}`);
      this._recevoirMessageAgent(pid, m.payload || {}, client.port);
    });
    await client.script.load();
    // Un client attache apres le reglage doit sonder lui aussi.
    if (this.sourisActive) {
      try { client.script.post({ type: 'souris', actif: true }); } catch (e) {}
    }
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
  //
  // Avec etalementRejeu, les esclaves ne partent plus ensemble: chacun est
  // decale de son predecesseur d'un ecart tire entre minMs et maxMs, cumule le
  // long de la boucle. Sept comptes qui se teleportent sur la meme
  // milliseconde n'arrivent pas quand sept personnes jouent.
  //
  // Le compte rendu reste SYNCHRONE, retards compris: `emis` dit que
  // l'emission est acquise, `retardMs` dans combien de temps. Rendre une
  // promesse ici aurait contamine le CLI, le duplicateur et leurs tests pour
  // une information qu'aucun des deux n'attend.
  rejouer({ type, brute, pidMaitre }) {
    const rendu = [];
    let retard = 0;
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
      // L'ecart n'est consomme que par un esclave qui emet vraiment: le
      // compter avant les deux refus ci-dessus ouvrirait des trous de 40 ms
      // pendant lesquels rien ne part.
      retard += this._ecartEtalement();
      if (this.arme) {
        if (retard === 0) client.amont.write(paquet);
        else this._emettreApres(retard, etat.pid, client.amont, paquet);
      }
      // `ok` dit que le rejeu est possible, `emis` qu'il a eu lieu. Les
      // confondre faisait passer tout succes pour un refus en mode
      // observation, ou rien n'est jamais emis.
      rendu.push({ pid: etat.pid, ok: true, emis: this.arme, action: prep.action, octets: paquet.length, retardMs: retard });
    }
    return rendu;
  }

  // Ecriture differee d'un rejeu. A l'echeance on est hors de toute pile
  // d'appel: une socket fermee entre-temps ferait remonter une exception non
  // capturee dans le process principal. Meme garde que emettre(), pour la meme
  // raison — sauf qu'ici il n'y a plus personne a qui rendre un refus, d'ou le
  // journal.
  _emettreApres(retardMs, pid, amont, paquet) {
    this.planifier(() => {
      try { amont.write(paquet); }
      catch (e) { this.journal(pid, `rejeu differe (${retardMs} ms) : ${e.message}`); }
    }, retardMs);
  }

  // Ce que l'agent nous annonce. Extrait de ajouter() pour etre atteignable
  // sans un vrai process Dofus derriere: c'est ici que se joue la distinction
  // entre « ou je suis » et « qui commande ».
  //
  // `premierPlan` alimente enAvant, JAMAIS maitre. Le focus a decerne le role
  // de maitre pendant tout un temps, et cliquer sur un alt envoyait ses actions
  // a toute l'equipe. Il ne sert plus qu'a savoir d'ou part la navigation.
  _recevoirMessageAgent(pid, p, port) {
    if (p.premierPlan !== undefined) {
      if (p.premierPlan) this.enAvant = pid;
      else if (this.enAvant === pid) this.enAvant = null;
      return;
    }
    if (p.premierPlanFait !== undefined) {
      if (p.premierPlanFait) this.enAvant = pid;
      else this.journal(pid, 'bascule de fenetre sans effet');
      return;
    }
    if (p.souris !== undefined) {
      this.onSouris({ pid, clic: p.souris });
      return;
    }
    if (p.ready) {
      this.journal(pid, `agent en place sur le port ${port} — ${p.ready.join(' | ')}`);
    }
  }

  // Demande a un client de mettre sa fenetre au premier plan.
  //
  // C'est l'AGENT qui agit, depuis l'interieur du process: SetForegroundWindow
  // n'autorise que le processus ayant recu le dernier evenement d'entree, et
  // le contournement documente (AttachThreadInput) demande d'etre dans la
  // place. Voir src/il2cpp/connectAgent.js.
  //
  // Ne leve JAMAIS: cette methode est appelee depuis un gestionnaire de
  // raccourci global, ou une exception non capturee tuerait le process
  // principal sans laisser de trace.
  basculerVers(pid) {
    const client = this.clients.get(pid);
    if (!client) return { ok: false, raison: 'client inconnu' };
    if (!client.script || typeof client.script.post !== 'function') {
      return { ok: false, raison: 'agent pas encore en place' };
    }
    try {
      client.script.post({ type: 'premierPlan' });
    } catch (e) {
      return { ok: false, raison: e.message };
    }
    return { ok: true };
  }

  // Allume ou eteint le sondage des boutons dans TOUS les clients.
  //
  // Ne leve JAMAIS: elle est appelee depuis poserRaccourcis(), qui tourne sous
  // un gestionnaire IPC, et un client peut etre en cours d'attache — son
  // script n'existe pas encore.
  reglerSouris(actif) {
    this.sourisActive = Boolean(actif);
    for (const client of this.clients.values()) {
      if (!client.script) continue;
      try { client.script.post({ type: 'souris', actif: this.sourisActive }); }
      catch (e) { this.journal(client.pid, `souris: ${e.message}`); }
    }
  }

  // Ecrit une trame sur UN client. Contrairement a rejouer(), qui vise tous
  // les esclaves et obeit au drapeau `arme` du OMNI, emettre ne juge
  // rien: l'appelant a deja decide. C'est ce qui permet au passe-tour d'avoir
  // son propre interrupteur sans dependre de celui du OMNI.
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
    if (this.enAvant === pid) this.enAvant = null;
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
