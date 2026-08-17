'use strict';

// Produit le script exécuté à l'intérieur du process Dofus par Frida.
// Rôle unique : rediriger connect() vers le proxy local et lui annoncer
// la destination réelle. Aucune lecture, aucune modification du flux ici.
function agentSource(proxyPort) {
  return `
    const connect_p = Module.getExportByName(null, 'connect');
    const send_p = Module.getExportByName(null, 'send');
    const socket_send = new NativeFunction(send_p, 'int', ['int', 'pointer', 'int', 'int']);

    Interceptor.attach(connect_p, {
      onEnter: function (args) {
        this.sockfd = args[0];
        const sockaddr_p = args[1];
        this.port = 256 * sockaddr_p.add(2).readU8() + sockaddr_p.add(3).readU8();
        this.addr = '';
        for (let i = 0; i < 4; i++) {
          this.addr += sockaddr_p.add(4 + i).readU8();
          if (i < 3) this.addr += '.';
        }
        const newport = ${proxyPort};
        sockaddr_p.add(2).writeByteArray([Math.floor(newport / 256), newport % 256]);
        sockaddr_p.add(4).writeByteArray([127, 0, 0, 1]);
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
