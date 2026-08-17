'use strict';
const frida = require('frida');
const { agentSource } = require('./agent');
const { sniffAgentSource } = require('./sniffAgent');

const DOFUS_PROCESS_NAMES = ['Dofus.exe', 'dofus.exe'];

async function findDofusProcesses() {
  const device = await frida.getLocalDevice();
  const processes = await device.enumerateProcesses();
  return processes
    .filter((p) => DOFUS_PROCESS_NAMES.some((n) => n.toLowerCase() === p.name.toLowerCase()))
    .map((p) => ({ pid: p.pid, name: p.name }));
}

async function redirect(pid, proxyPort, { onReady = () => {}, onCounters = () => {} } = {}) {
  const session = await frida.attach(pid);
  const script = await session.createScript(agentSource(proxyPort));

  script.message.connect((message) => {
    if (message.type === 'error') {
      console.error(`agent frida: ${message.description}`);
      return;
    }
    const payload = message.payload || {};
    if (payload.kind === 'ready') onReady(payload);
    else if (payload.kind === 'counters') onCounters(payload.counters);
  });

  await script.load();

  return {
    async detach() {
      await script.unload().catch(() => {});
      await session.detach().catch(() => {});
    },
  };
}

// Attache un agent EN LECTURE SEULE à un process déjà lancé.
// onData(direction, Buffer, socketId) — aucune écriture, aucune redirection.
async function sniff(pid, { onData = () => {}, onReady = () => {}, onCounters = () => {}, onPeer = () => {} } = {}) {
  const session = await frida.attach(pid);
  const script = await session.createScript(sniffAgentSource());

  script.message.connect((message, data) => {
    if (message.type === 'error') {
      console.error(`agent frida: ${message.description}`);
      return;
    }
    const payload = message.payload || {};
    if (payload.kind === 'ready') onReady(payload);
    else if (payload.kind === 'counters') onCounters(payload.counters);
    else if (payload.kind === 'peer') onPeer(payload.sock, payload.peer);
    else if (payload.kind === 'io' && data) onData(payload.dir, Buffer.from(data), payload.sock);
  });

  await script.load();

  return {
    async detach() {
      await script.unload().catch(() => {});
      await session.detach().catch(() => {});
    },
  };
}

module.exports = { redirect, sniff, findDofusProcesses, agentSource, sniffAgentSource };
