'use strict';
const frida = require('frida');
const { agentSource } = require('./agent');

const DOFUS_PROCESS_NAMES = ['Dofus.exe', 'dofus.exe'];

async function findDofusProcesses() {
  const device = await frida.getLocalDevice();
  const processes = await device.enumerateProcesses();
  return processes
    .filter((p) => DOFUS_PROCESS_NAMES.some((n) => n.toLowerCase() === p.name.toLowerCase()))
    .map((p) => ({ pid: p.pid, name: p.name }));
}

async function redirect(pid, proxyPort, { onReady = () => {} } = {}) {
  const session = await frida.attach(pid);
  const script = await session.createScript(agentSource(proxyPort));

  script.message.connect((message) => {
    if (message.type === 'error') {
      console.error(`agent frida: ${message.description}`);
      return;
    }
    if ((message.payload || {}).kind === 'ready') onReady(message.payload);
  });

  await script.load();

  return {
    async detach() {
      await script.unload().catch(() => {});
      await session.detach().catch(() => {});
    },
  };
}

module.exports = { redirect, findDofusProcesses, agentSource };
