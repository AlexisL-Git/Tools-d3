'use strict';

// Agent Frida EN LECTURE SEULE.
//
// Observe les entrées/sorties socket d'un process déjà lancé. Ne modifie
// aucun octet, ne redirige aucune connexion, n'appelle rien dans le process.
// C'est la seule technique qui fonctionne sur un client Dofus déjà connecté :
// la redirection de connect() n'a plus rien à intercepter une fois la socket
// ouverte.
//
// Chaque émission porte le descripteur de socket : hooker send/recv capture
// TOUTES les sockets du process (HTTP, télémétrie, jeu). Sans démultiplexage
// par socket, les flux se mélangent et le réassemblage de trames est faux.
function sniffAgentSource({ maxChunk = 1 << 20 } = {}) {
  return `
    function globalExport(n) {
      if (typeof Module.getGlobalExportByName === 'function') return Module.getGlobalExportByName(n);
      return Module.getExportByName(null, n);
    }
    function findGlobal(n) {
      try {
        if (typeof Module.findGlobalExportByName === 'function') return Module.findGlobalExportByName(n);
        return Module.findExportByName(null, n);
      } catch (e) { return null; }
    }

    var MAX = ${maxChunk};
    var counters = { recv: 0, send: 0, WSARecv: 0, WSASend: 0, bytes: 0 };

    // Résolution de l'adresse distante par socket. Sans ça on ne sait pas
    // laquelle des sockets du process est celle du serveur de jeu, et toute
    // conclusion sur le contenu du flux est bancale.
    var peerOf = {};
    var getpeername_p = findGlobal('getpeername');
    var getpeername = getpeername_p !== null
      ? new NativeFunction(getpeername_p, 'int', ['pointer', 'pointer', 'pointer'])
      : null;

    function peerName(sockPtr, key) {
      if (peerOf[key] !== undefined) return peerOf[key];
      peerOf[key] = null;
      if (getpeername === null) return null;
      try {
        var addr = Memory.alloc(128);
        var lenP = Memory.alloc(4);
        lenP.writeS32(128);
        var rc = getpeername(sockPtr, addr, lenP);
        if (rc !== 0) { peerOf[key] = 'getpeername a echoue'; send({kind:'peer',sock:key,peer:peerOf[key]}); return peerOf[key]; }
        var fam = addr.readU16();
        var port = 256 * addr.add(2).readU8() + addr.add(3).readU8();
        if (fam === 2) {
          var ip = '';
          for (var i = 0; i < 4; i++) { ip += addr.add(4 + i).readU8(); if (i < 3) ip += '.'; }
          peerOf[key] = ip + ':' + port;
        } else if (fam === 23) {
          var h = [];
          for (var j = 0; j < 8; j++) {
            var v = (addr.add(8 + j*2).readU8() << 8) | addr.add(9 + j*2).readU8();
            h.push(v.toString(16));
          }
          peerOf[key] = '[' + h.join(':') + ']:' + port + ' (IPv6)';
        } else {
          peerOf[key] = 'famille ' + fam + ' port ' + port;
        }
        send({ kind: 'peer', sock: key, peer: peerOf[key] });
      } catch (e) {}
      return peerOf[key];
    }

    function emit(dir, sock, ptr, len) {
      if (len <= 0 || len > MAX) return;
      counters.bytes += len;
      send({ kind: 'io', dir: dir, sock: sock }, ptr.readByteArray(len));
    }

    // int recv(SOCKET s, char *buf, int len, int flags)
    Interceptor.attach(globalExport('recv'), {
      onEnter: function (args) {
        this.sock = args[0].toString();
        this.sockPtr = args[0];
        this.buf = args[1];
      },
      onLeave: function (retval) {
        var n = retval.toInt32();
        if (n > 0) { counters.recv++; peerName(this.sockPtr, this.sock); emit('in', this.sock, this.buf, n); }
      }
    });

    // int send(SOCKET s, const char *buf, int len, int flags)
    Interceptor.attach(globalExport('send'), {
      onEnter: function (args) {
        counters.send++;
        var k = args[0].toString();
        peerName(args[0], k);
        emit('out', k, args[1], args[2].toInt32());
      }
    });

    // WSABUF { ULONG len; CHAR *buf; } -> 16 octets alignés en x64
    function readWsaBufs(sock, dir, buffers, count, total) {
      var remaining = total;
      for (var i = 0; i < count && remaining > 0; i++) {
        var wsabuf = buffers.add(i * 16);
        var len = wsabuf.readU32();
        var p = wsabuf.add(8).readPointer();
        var take = Math.min(len, remaining);
        emit(dir, sock, p, take);
        remaining -= take;
      }
    }

    var pending = {};

    // GetQueuedCompletionStatus(port, lpBytes, lpKey, lpOverlapped, timeout)
    var gqcs = findGlobal('GetQueuedCompletionStatus');
    if (gqcs !== null) {
      Interceptor.attach(gqcs, {
        onEnter: function (args) { this.lpBytes = args[1]; this.lpOv = args[3]; },
        onLeave: function (retval) {
          if (retval.toInt32() === 0 || this.lpOv.isNull()) return;
          var ov = this.lpOv.readPointer();
          if (ov.isNull()) return;
          var op = pending[ov.toString()];
          if (op === undefined) return;
          delete pending[ov.toString()];
          var n = this.lpBytes.readU32();
          if (n > 0) { counters.WSARecv++; readWsaBufs(op.sock, 'in', op.buffers, op.count, n); }
        }
      });
    }

    var wsaRecv = findGlobal('WSARecv');
    if (wsaRecv !== null) {
      Interceptor.attach(wsaRecv, {
        onEnter: function (args) {
          this.sock = args[0].toString();
          this.buffers = args[1];
          this.count = args[2].toInt32();
          this.received = args[3];
          this.sockPtr = args[0];
          this.overlapped = args[5];
        },
        onLeave: function (retval) {
          peerName(this.sockPtr, this.sock);
          if (retval.toInt32() !== 0) {
            // WSA_IO_PENDING: la réception est asynchrone, les octets
            // arriveront par port de complétion. On enregistre l'opération
            // pour la relire à la complétion.
            if (!this.overlapped.isNull()) {
              pending[this.overlapped.toString()] = {
                sock: this.sock, buffers: this.buffers, count: this.count
              };
            }
            return;
          }
          if (this.received.isNull()) return;
          var n = this.received.readU32();
          if (n > 0) { counters.WSARecv++; readWsaBufs(this.sock, 'in', this.buffers, this.count, n); }
        }
      });
    }

    var wsaSend = findGlobal('WSASend');
    if (wsaSend !== null) {
      Interceptor.attach(wsaSend, {
        onEnter: function (args) {
          counters.WSASend++;
          var count = args[2].toInt32();
          var total = 0;
          for (var i = 0; i < count; i++) total += args[1].add(i * 16).readU32();
          readWsaBufs(args[0].toString(), 'out', args[1], count, total);
        }
      });
    }

    // Dofus ne passe ni par recv ni par WSARecv: on cherche par quoi il recoit.
    ['WSARecvFrom','recvfrom','ReadFile','ReadFileEx','GetQueuedCompletionStatusEx','WSAGetOverlappedResult','NtDeviceIoControlFile'].forEach(function (n) {
      var p = findGlobal(n);
      if (p === null) return;
      counters[n] = 0;
      try { Interceptor.attach(p, { onEnter: function () { counters[n]++; } }); } catch (e) {}
    });

    setInterval(function () { send({ kind: 'counters', counters: counters }); }, 5000);
    send({ kind: 'ready', hooks: { WSARecv: wsaRecv !== null, WSASend: wsaSend !== null } });
  `;
}

module.exports = { sniffAgentSource };
