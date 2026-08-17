'use strict';

// Produit le script exécuté à l'intérieur du process Dofus par Frida.
// Rôle unique : rediriger connect() vers le proxy local et lui annoncer
// la destination réelle. Aucune lecture, aucune modification du flux ici.
//
// Compatibilité: Frida 17 a supprimé Module.getExportByName(null, name) au
// profit de Module.getGlobalExportByName(name). Le code amont (krm35) date de
// Frida 15. Le shim ci-dessous accepte les deux runtimes.
function agentSource(proxyPort) {
  return `
    function globalExport(name) {
      if (typeof Module.getGlobalExportByName === 'function') {
        return Module.getGlobalExportByName(name);
      }
      return Module.getExportByName(null, name);
    }

    const connect_p = globalExport('connect');
    const send_p = globalExport('send');
    const socket_send = new NativeFunction(send_p, 'int', ['int', 'pointer', 'int', 'int']);

    const AF_INET = 2;

    // Diagnostic: le client n'utilise pas forcément connect(). S'il passe par
    // WSAConnect ou ConnectEx, le hook ci-dessous ne verra jamais rien et la
    // capture sera vide sans qu'on sache pourquoi. On compte les trois.
    const counters = { connect: 0, WSAConnect: 0, ConnectEx: 0, redirected: 0 };
    for (const name of ['WSAConnect', 'ConnectEx']) {
      let p = null;
      try {
        p = (typeof Module.findGlobalExportByName === 'function')
          ? Module.findGlobalExportByName(name)
          : Module.findExportByName(null, name);
      } catch (e) { p = null; }
      if (p !== null) {
        Interceptor.attach(p, { onEnter: function () { counters[name]++; } });
      }
    }
    setInterval(function () { send({ kind: 'counters', counters: counters }); }, 5000);

    Interceptor.attach(connect_p, {
      onEnter: function (args) {
        this.shouldSend = false;
        counters.connect++;

        const sockaddr_p = args[1];
        // sockaddr_in: [0..1] famille, [2..3] port BE, [4..7] adresse IPv4.
        // On ne touche qu'à l'IPv4 : réécrire un sockaddr_in6 corromprait la pile.
        if (sockaddr_p.readU16() !== AF_INET) return;

        this.sockfd = args[0];
        this.port = 256 * sockaddr_p.add(2).readU8() + sockaddr_p.add(3).readU8();
        this.addr = '';
        for (let i = 0; i < 4; i++) {
          this.addr += sockaddr_p.add(4 + i).readU8();
          if (i < 3) this.addr += '.';
        }

        // Déjà à destination du proxy : ne pas re-router en boucle.
        if (this.addr === '127.0.0.1') return;

        const newport = ${proxyPort};
        sockaddr_p.add(2).writeByteArray([Math.floor(newport / 256), newport % 256]);
        sockaddr_p.add(4).writeByteArray([127, 0, 0, 1]);
        counters.redirected++;
        this.shouldSend = true;
      },
      onLeave: function () {
        if (!this.shouldSend) return;
        const line = 'CONNECT ' + this.addr + ':' + this.port + ' HTTP/1.0 ';
        const buf = Memory.allocUtf8String(line);
        socket_send(this.sockfd.toInt32(), buf, line.length, 0);
      }
    });

    send({ kind: 'ready', proxyPort: ${proxyPort} });
  `;
}

module.exports = { agentSource };
