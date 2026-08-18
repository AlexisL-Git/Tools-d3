'use strict';
const frida = require('frida');
const { findDofusProcesses } = require('../injector');

// Sonde ciblee: cherche une classe par (assembly, namespace, nom) et liste
// ses methodes avec leur pointeur natif. Sert a valider un point d'ancrage
// avant d'y poser un hook.
//
// usage: node src/cli/il2cpp-probe.js <assembly.dll> <namespace|-> <Classe>
function source(image, ns, cls) {
  return `
    const MOD = 'GameAssembly.dll';
    let _m = null;
    function resolve(n) {
      if (typeof Module.findExportByName === 'function') return Module.findExportByName(MOD, n);
      if (_m === null) _m = Process.getModuleByName(MOD);
      return _m.findExportByName ? _m.findExportByName(n) : _m.getExportByName(n);
    }
    function fn(n, r, a) { const p = resolve(n); if (!p) throw new Error('export ' + n); return new NativeFunction(p, r, a); }

    const domain_get     = fn('il2cpp_domain_get','pointer',[]);
    const thread_attach  = fn('il2cpp_thread_attach','pointer',['pointer']);
    const domain_get_asm = fn('il2cpp_domain_get_assemblies','pointer',['pointer','pointer']);
    const asm_get_image  = fn('il2cpp_assembly_get_image','pointer',['pointer']);
    const image_get_name = fn('il2cpp_image_get_name','pointer',['pointer']);
    const class_from_name= fn('il2cpp_class_from_name','pointer',['pointer','pointer','pointer']);
    const class_get_meths= fn('il2cpp_class_get_methods','pointer',['pointer','pointer']);
    const class_get_fields= fn('il2cpp_class_get_fields','pointer',['pointer','pointer']);
    const field_get_name = fn('il2cpp_field_get_name','pointer',['pointer']);
    const field_get_offset= fn('il2cpp_field_get_offset','uint32',['pointer']);
    const field_get_type = fn('il2cpp_field_get_type','pointer',['pointer']);
    const type_get_name  = fn('il2cpp_type_get_name','pointer',['pointer']);
    const method_get_name= fn('il2cpp_method_get_name','pointer',['pointer']);
    const method_get_pc  = fn('il2cpp_method_get_param_count','uint32',['pointer']);

    const S = p => (!p || p.isNull()) ? '' : p.readUtf8String();
    const C = s => Memory.allocUtf8String(s);

    const domain = domain_get();
    thread_attach(domain);

    const sz = Memory.alloc(8); sz.writeU64(0);
    const asms = domain_get_asm(domain, sz);
    const n = sz.readU64().toNumber();
    let image = null;
    for (let i = 0; i < n; i++) {
      const img = asm_get_image(asms.add(i * Process.pointerSize).readPointer());
      if (S(image_get_name(img)) === ${JSON.stringify(image)}) { image = img; break; }
    }
    if (image === null) { send({kind:'err', msg:'assembly introuvable'}); } else {
      const k = class_from_name(image, C(${JSON.stringify(ns)}), C(${JSON.stringify(cls)}));
      if (k.isNull()) { send({kind:'err', msg:'classe introuvable'}); }
      else {
        const iter = Memory.alloc(Process.pointerSize); iter.writePointer(NULL);
        const out = [];
        for (;;) {
          const m = class_get_meths(k, iter);
          if (m.isNull()) break;
          out.push({ name: S(method_get_name(m)), params: method_get_pc(m), ptr: m.readPointer().toString() });
        }
        const fit = Memory.alloc(Process.pointerSize); fit.writePointer(NULL);
        const fields = [];
        for (;;) {
          const f = class_get_fields(k, fit);
          if (f.isNull()) break;
          let tn = '?';
          try { tn = S(type_get_name(field_get_type(f))); } catch (e) {}
          fields.push({ name: S(field_get_name(f)), offset: field_get_offset(f), type: tn });
        }
        send({ kind:'ok', methods: out, fields: fields });
      }
    }
  `;
}

async function main() {
  const image = process.argv[2];
  const ns = process.argv[3] === '-' ? '' : process.argv[3] || '';
  const cls = process.argv[4];
  if (!image || !cls) {
    console.error('usage: node src/cli/il2cpp-probe.js <assembly.dll> <namespace|-> <Classe>');
    process.exit(1);
  }

  const procs = await findDofusProcesses();
  if (procs.length === 0) { console.error('Aucun process Dofus.'); process.exit(1); }
  const session = await frida.attach(procs[0].pid);
  const script = await session.createScript(source(image, ns, cls));

  const done = new Promise((resolve) => {
    script.message.connect((m) => {
      if (m.type === 'error') { console.error('AGENT:', m.description); return resolve(); }
      const p = m.payload || {};
      if (p.kind === 'err') console.log('ECHEC:', p.msg);
      else if (p.kind === 'ok') {
        console.log(`${(p.fields || []).length} CHAMPS dans ${ns ? ns + '.' : ''}${cls}:`);
        for (const f of p.fields || []) {
          console.log(`  +0x${f.offset.toString(16).padStart(3, '0')}  ${f.name.padEnd(18)} ${f.type}`);
        }
        console.log(`
${p.methods.length} méthodes:`);
        for (const x of p.methods) console.log(`  ${x.ptr}  ${x.name}/${x.params}`);
      }
      resolve();
    });
  });

  await script.load();
  await done;
  await script.unload().catch(() => {});
  await session.detach().catch(() => {});
}

main().catch((e) => { console.error(e.message); process.exit(1); });
