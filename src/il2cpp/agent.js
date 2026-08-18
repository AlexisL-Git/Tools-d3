'use strict';

// Agent Frida d'exploration IL2CPP, EN LECTURE SEULE.
//
// GameAssembly.dll exporte l'API IL2CPP (242 symboles). On peut donc
// enumerer assemblies, classes et methodes a l'execution, sans Il2CppDumper
// ni global-metadata.dat.
//
// Point critique: tout appel a l'API IL2CPP depuis un thread Frida exige un
// il2cpp_thread_attach(domain) prealable, sinon le process plante.
function il2cppAgentSource({ mode = 'assemblies', filter = '', limit = 400, image = '' } = {}) {
  return `
    const MOD = 'GameAssembly.dll';

    // Frida 17 a supprime Module.findExportByName(module, nom): il faut passer
    // par l'objet Module lui-meme. On accepte les deux runtimes.
    let _mod = null;
    function resolve(name) {
      if (typeof Module.findExportByName === 'function') {
        return Module.findExportByName(MOD, name);
      }
      if (_mod === null) _mod = Process.getModuleByName(MOD);
      if (typeof _mod.findExportByName === 'function') return _mod.findExportByName(name);
      return _mod.getExportByName(name);
    }

    function fn(name, ret, args) {
      const p = resolve(name);
      if (p === null || p === undefined) throw new Error('export introuvable: ' + name);
      return new NativeFunction(p, ret, args);
    }

    const domain_get            = fn('il2cpp_domain_get', 'pointer', []);
    const thread_attach         = fn('il2cpp_thread_attach', 'pointer', ['pointer']);
    const domain_get_assemblies = fn('il2cpp_domain_get_assemblies', 'pointer', ['pointer', 'pointer']);
    const assembly_get_image    = fn('il2cpp_assembly_get_image', 'pointer', ['pointer']);
    const image_get_name        = fn('il2cpp_image_get_name', 'pointer', ['pointer']);
    const image_get_class_count = fn('il2cpp_image_get_class_count', 'uint32', ['pointer']);
    const image_get_class       = fn('il2cpp_image_get_class', 'pointer', ['pointer', 'uint32']);
    const class_get_name        = fn('il2cpp_class_get_name', 'pointer', ['pointer']);
    const class_get_namespace   = fn('il2cpp_class_get_namespace', 'pointer', ['pointer']);
    const class_get_methods     = fn('il2cpp_class_get_methods', 'pointer', ['pointer', 'pointer']);
    const method_get_name       = fn('il2cpp_method_get_name', 'pointer', ['pointer']);
    const method_get_param_count= fn('il2cpp_method_get_param_count', 'uint32', ['pointer']);

    function str(p) { return p.isNull() ? '' : p.readUtf8String(); }

    const domain = domain_get();
    thread_attach(domain);   // obligatoire avant tout autre appel

    const sizePtr = Memory.alloc(8);
    sizePtr.writeU64(0);
    const assemblies = domain_get_assemblies(domain, sizePtr);
    const count = sizePtr.readU64().toNumber();

    const MODE = '${mode}';
    const FILTER = ${JSON.stringify(filter)}.toLowerCase();
    const IMAGE = ${JSON.stringify(image)}.toLowerCase();
    const LIMIT = ${limit};

    if (MODE === 'assemblies') {
      const out = [];
      for (let i = 0; i < count; i++) {
        const img = assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
        out.push({ name: str(image_get_name(img)), classes: image_get_class_count(img) });
      }
      send({ kind: 'assemblies', count: count, list: out });
    } else if (MODE === 'classes') {
      const out = [];
      let seen = 0;
      for (let i = 0; i < count && out.length < LIMIT; i++) {
        const img = assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
        const imgName = str(image_get_name(img));
        if (IMAGE && imgName.toLowerCase().indexOf(IMAGE) === -1) continue;
        const n = image_get_class_count(img);
        for (let c = 0; c < n && out.length < LIMIT; c++) {
          const k = image_get_class(img, c);
          if (k.isNull()) continue;
          const ns = str(class_get_namespace(k));
          const nm = str(class_get_name(k));
          const full = (ns ? ns + '.' : '') + nm;
          seen++;
          if (FILTER && full.toLowerCase().indexOf(FILTER) === -1) continue;
          out.push({ image: imgName, name: full });
        }
      }
      send({ kind: 'classes', scanned: seen, list: out });
    } else if (MODE === 'methods') {
      const out = [];
      for (let i = 0; i < count && out.length < LIMIT; i++) {
        const img = assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
        if (IMAGE && str(image_get_name(img)).toLowerCase().indexOf(IMAGE) === -1) continue;
        const n = image_get_class_count(img);
        for (let c = 0; c < n && out.length < LIMIT; c++) {
          const k = image_get_class(img, c);
          if (k.isNull()) continue;
          const ns = str(class_get_namespace(k));
          const nm = str(class_get_name(k));
          const full = (ns ? ns + '.' : '') + nm;
          if (FILTER && full.toLowerCase().indexOf(FILTER) === -1) continue;
          const iter = Memory.alloc(Process.pointerSize);
          iter.writePointer(NULL);
          const methods = [];
          for (;;) {
            const m = class_get_methods(k, iter);
            if (m.isNull()) break;
            methods.push(str(method_get_name(m)) + '/' + method_get_param_count(m));
          }
          out.push({ name: full, methods: methods });
        }
      }
      send({ kind: 'methods', list: out });
    }

    send({ kind: 'done' });
  `;
}

module.exports = { il2cppAgentSource };
