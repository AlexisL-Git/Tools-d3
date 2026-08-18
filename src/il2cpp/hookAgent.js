'use strict';

// Hook IL2CPP EN LECTURE SEULE sur la couche de serialisation protobuf.
//
// Pourquoi ce point d'ancrage: les classes d'Ankama sont obfusquees (hdv,
// hcw...) mais Google.Protobuf est une bibliotheque tierce, donc ses noms
// sont intacts. Tout message emis passe par MessageExtensions.ToByteArray,
// tout message recu par MessageParser.ParseFrom. En s'y attachant on voit
// passer l'integralite du trafic applicatif sans avoir a percer
// l'obfuscation.
//
// Le nom du message est ensuite obtenu en demandant a IL2CPP la classe de
// l'objet: on recupere le nom obfusque (hdv), directement raccordable aux
// .proto extraits du meme assembly.
function hookAgentSource({ maxEvents = 4000 } = {}) {
  return `
    const MOD = 'GameAssembly.dll';
    let _mod = null;
    function resolve(name) {
      if (typeof Module.findExportByName === 'function') return Module.findExportByName(MOD, name);
      if (_mod === null) _mod = Process.getModuleByName(MOD);
      if (typeof _mod.findExportByName === 'function') return _mod.findExportByName(name);
      return _mod.getExportByName(name);
    }
    function fn(name, ret, args) {
      const p = resolve(name);
      if (!p) throw new Error('export introuvable: ' + name);
      return new NativeFunction(p, ret, args);
    }

    const domain_get      = fn('il2cpp_domain_get', 'pointer', []);
    const thread_attach   = fn('il2cpp_thread_attach', 'pointer', ['pointer']);
    const domain_get_asm  = fn('il2cpp_domain_get_assemblies', 'pointer', ['pointer', 'pointer']);
    const asm_get_image   = fn('il2cpp_assembly_get_image', 'pointer', ['pointer']);
    const image_get_name  = fn('il2cpp_image_get_name', 'pointer', ['pointer']);
    const class_from_name = fn('il2cpp_class_from_name', 'pointer', ['pointer', 'pointer', 'pointer']);
    const class_get_mfn   = fn('il2cpp_class_get_method_from_name', 'pointer', ['pointer', 'pointer', 'int']);
    const object_get_class= fn('il2cpp_object_get_class', 'pointer', ['pointer']);
    const class_get_name  = fn('il2cpp_class_get_name', 'pointer', ['pointer']);
    const class_get_ns    = fn('il2cpp_class_get_namespace', 'pointer', ['pointer']);

    function str(p) { return (!p || p.isNull()) ? '' : p.readUtf8String(); }
    function cstr(s) { return Memory.allocUtf8String(s); }

    const domain = domain_get();
    thread_attach(domain);

    // Localiser l'image Google.Protobuf.dll
    const sizePtr = Memory.alloc(8); sizePtr.writeU64(0);
    const asms = domain_get_asm(domain, sizePtr);
    const n = sizePtr.readU64().toNumber();
    let pbImage = null;
    for (let i = 0; i < n; i++) {
      const img = asm_get_image(asms.add(i * Process.pointerSize).readPointer());
      if (str(image_get_name(img)) === 'Google.Protobuf.dll') { pbImage = img; break; }
    }
    if (pbImage === null) throw new Error('Google.Protobuf.dll introuvable');

    let events = 0;
    const MAX = ${maxEvents};

    function nameOfObject(objPtr) {
      try {
        if (!objPtr || objPtr.isNull()) return '(null)';
        const k = object_get_class(objPtr);
        if (k.isNull()) return '(classe nulle)';
        const ns = str(class_get_ns(k));
        return (ns ? ns + '.' : '') + str(class_get_name(k));
      } catch (e) { return '(erreur: ' + e.message + ')'; }
    }

    // Le MethodInfo* d'IL2CPP commence par le pointeur natif de la methode.
    function nativeOf(klass, methodName, paramCount) {
      const mi = class_get_mfn(klass, cstr(methodName), paramCount);
      if (mi.isNull()) return null;
      const ptr = mi.readPointer();
      return (ptr.isNull()) ? null : ptr;
    }

    const hooked = [];

    // --- SORTANT: MessageExtensions.ToByteArray(IMessage) ---
    const kExt = class_from_name(pbImage, cstr('Google.Protobuf'), cstr('MessageExtensions'));
    if (!kExt.isNull()) {
      const p = nativeOf(kExt, 'ToByteArray', 1);
      if (p) {
        Interceptor.attach(p, {
          onEnter: function (args) {
            if (events++ > MAX) return;
            send({ kind: 'msg', dir: 'out', via: 'ToByteArray', name: nameOfObject(args[0]) });
          }
        });
        hooked.push('MessageExtensions.ToByteArray/1 @ ' + p);
      }
      const pw = nativeOf(kExt, 'WriteTo', 2);
      if (pw) {
        Interceptor.attach(pw, {
          onEnter: function (args) {
            if (events++ > MAX) return;
            send({ kind: 'msg', dir: 'out', via: 'WriteTo', name: nameOfObject(args[0]) });
          }
        });
        hooked.push('MessageExtensions.WriteTo/2 @ ' + pw);
      }
    }

    // --- ENTRANT: MessageParser.ParseFrom(...) ---
    const kParser = class_from_name(pbImage, cstr('Google.Protobuf'), cstr('MessageParser'));
    if (!kParser.isNull()) {
      const pp = nativeOf(kParser, 'ParseFrom', 1);
      if (pp) {
        Interceptor.attach(pp, {
          onLeave: function (retval) {
            if (events++ > MAX) return;
            send({ kind: 'msg', dir: 'in', via: 'ParseFrom', name: nameOfObject(retval) });
          }
        });
        hooked.push('MessageParser.ParseFrom/1 @ ' + pp);
      }
    }

    send({ kind: 'ready', hooked: hooked });
  `;
}

module.exports = { hookAgentSource };
