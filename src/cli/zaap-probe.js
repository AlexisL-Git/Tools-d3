'use strict';
const net = require('node:net');

// Sonde du service local de Zaap (127.0.0.1:26116).
//
// Le code du launcher (app.asar) contient un client Thrift genere: on y lit
// readStructBegin/readFieldBegin et la liste des methodes du service —
// connect, auth_getGameToken, userInfo_get, settings_get, settings_set,
// zaapVersion_get, updater_isUpdateAvailable, release_restartOnExit,
// release_exitAndRepair.
//
// Question a laquelle cet outil repond: Zaap accepte-t-il un client Thrift
// TIERS, ou reserve-t-il ce service au jeu? Si oui, notre application pourrait
// lui demander un jeton de partie et lancer les clients elle-meme, sans jamais
// approcher les identifiants chiffres.
//
// usage: node src/cli/zaap-probe.js [methode] [port]

const CALL = 1;
const REPLY = 2;
const EXCEPTION = 3;
const VERSION_1 = 0x80010000;

function ecrireEntete(nom, seqid) {
  const nomBuf = Buffer.from(nom, 'utf8');
  const b = Buffer.alloc(4 + 4 + nomBuf.length + 4);
  b.writeInt32BE(VERSION_1 | CALL, 0);
  b.writeInt32BE(nomBuf.length, 4);
  nomBuf.copy(b, 8);
  b.writeInt32BE(seqid, 8 + nomBuf.length);
  return b;
}

// Le transport n'est PAS framed. La capture du vrai dialogue le montre: les
// messages commencent directement par l'en-tete 80 01 00 01, sans prefixe de
// longueur. Ajouter ce prefixe faisait lire a Zaap un en-tete absurde, et il
// attendait indefiniment la suite — d'ou le silence de la premiere sonde.
function appel(nom, seqid = 1) {
  // Struct d'arguments vide: uniquement l'octet STOP.
  return Buffer.concat([ecrireEntete(nom, seqid), Buffer.from([0x00])]);
}

function lireReponse(buf) {
  const corps = buf;
  if (corps.length < 8) return { etat: 'corps trop court' };
  const entete = corps.readInt32BE(0);
  if ((entete & 0xffff0000) !== VERSION_1) {
    return { etat: 'pas du Thrift binaire', entete: entete.toString(16) };
  }
  const type = entete & 0xff;
  const lg = corps.readInt32BE(4);
  const nom = corps.toString('utf8', 8, 8 + lg);
  const types = { [REPLY]: 'RÉPONSE', [EXCEPTION]: 'EXCEPTION', [CALL]: 'APPEL' };
  return {
    etat: 'thrift',
    type: types[type] || type,
    methode: nom,
    reste: corps.subarray(8 + lg + 4).toString('latin1').replace(/[^\x20-\x7e]/g, '.').slice(0, 200),
  };
}

async function main() {
  const methode = process.argv[2] || 'zaapVersion_get';
  const port = Number(process.argv[3] || 26116);

  console.log(`appel de ${methode} sur 127.0.0.1:${port}\n`);
  const sock = net.connect(port, '127.0.0.1');
  const morceaux = [];

  const fini = new Promise((resolve) => {
    sock.on('connect', () => { console.log('connecté'); sock.write(appel(methode)); });
    sock.on('data', (d) => { morceaux.push(d); setTimeout(resolve, 400); });
    sock.on('error', (e) => { console.log(`erreur: ${e.message}`); resolve(); });
    sock.on('close', () => resolve());
    setTimeout(() => { console.log('aucune réponse en 5 s'); resolve(); }, 5000);
  });

  await fini;
  sock.destroy();

  if (morceaux.length === 0) { console.log('Zaap n’a rien renvoyé.'); return; }
  const buf = Buffer.concat(morceaux);
  console.log(`${buf.length} octets reçus`);
  console.log(lireReponse(buf));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
