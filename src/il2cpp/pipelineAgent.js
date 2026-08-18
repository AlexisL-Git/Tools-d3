'use strict';

// Hook IL2CPP EN LECTURE SEULE sur le pipeline reseau DotNetty.
//
// Dofus 3 transporte son protocole via DotNetty (portage .NET de Netty), ce
// qui explique qu'aucun appel Winsock classique ne soit observable de
// l'exterieur: l'I/O passe par des ports de completion.
//
// Tout message decode remonte le pipeline par FireChannelRead, tout message
// emis y descend par WriteAsync / WriteAndFlushAsync. Ces methodes sont dans
// une bibliotheque tierce, donc NON obfusquees, contrairement aux classes
// d'Ankama. C'est le point de passage oblige, dans les deux sens.
//
// Pour chaque objet intercepte on demande sa classe a IL2CPP: on obtient le
// nom obfusque (hdv, hcw...), directement raccordable aux .proto extraits du
// meme assembly.
function pipelineAgentSource({ maxEvents = 20000 } = {}) {
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
    const class_get_mfn  = fn('il2cpp_class_get_method_from_name','pointer',['pointer','pointer','int']);
    const object_get_cls = fn('il2cpp_object_get_class','pointer',['pointer']);
    const class_get_name = fn('il2cpp_class_get_name','pointer',['pointer']);
    const class_get_ns   = fn('il2cpp_class_get_namespace','pointer',['pointer']);
    const runtime_invoke = fn('il2cpp_runtime_invoke','pointer',['pointer','pointer','pointer','pointer']);
    const string_chars   = fn('il2cpp_string_chars','pointer',['pointer']);
    const string_length  = fn('il2cpp_string_length','int32',['pointer']);

    const S = p => (!p || p.isNull()) ? '' : p.readUtf8String();
    const C = s => Memory.allocUtf8String(s);

    const domain = domain_get();
    thread_attach(domain);

    const sz = Memory.alloc(8); sz.writeU64(0);
    const asms = domain_get_asm(domain, sz);
    const na = sz.readU64().toNumber();
    let img = null;
    for (let i = 0; i < na; i++) {
      const im = asm_get_image(asms.add(i * Process.pointerSize).readPointer());
      if (S(image_get_name(im)) === 'DotNetty.Transport.dll') { img = im; break; }
    }
    if (img === null) throw new Error('DotNetty.Transport.dll introuvable');

    const k = class_from_name(img, C('DotNetty.Transport.Channels'), C('AbstractChannelHandlerContext'));
    if (k.isNull()) throw new Error('AbstractChannelHandlerContext introuvable');

    let events = 0;
    const MAX = ${maxEvents};

    function nameOf(p) {
      try {
        if (!p || p.isNull()) return '(null)';
        const c = object_get_cls(p);
        if (c.isNull()) return '(classe nulle)';
        const ns = S(class_get_ns(c));
        return (ns ? ns + '.' : '') + S(class_get_name(c));
      } catch (e) { return '(err)'; }
    }

    // Les classes protobuf generees par C# implementent ToString() qui rend
    // le message en JSON. On demande donc au jeu de nous decrire lui-meme le
    // contenu, plutot que de decoder le protobuf et l'obfuscation des champs.
    let diagSent = 0;
    function diag(step, extra) {
      if (diagSent++ < 6) send({ kind: 'diag', step: step, extra: extra || '' });
    }
    function jsonOf(objPtr) {
      try {
        if (!objPtr || objPtr.isNull()) { diag('objet nul'); return null; }
        const c = object_get_cls(objPtr);
        if (c.isNull()) { diag('classe nulle'); return null; }
        const mi = class_get_mfn(c, C('ToString'), 0);
        if (mi.isNull()) { diag('ToString introuvable'); return null; }
        const exc = Memory.alloc(Process.pointerSize);
        exc.writePointer(NULL);
        const res = runtime_invoke(mi, objPtr, NULL, exc);
        if (!exc.readPointer().isNull()) { diag('exception levee'); return null; }
        if (res.isNull()) { diag('resultat nul'); return null; }
        const len = string_length(res);
        if (len <= 0) { diag('longueur ' + len); return ''; }
        return string_chars(res).readUtf16String(Math.min(len, 4000));
      } catch (e) { diag('exception js', e.message); return null; }
    }

    function nativeOf(name, pc) {
      const mi = class_get_mfn(k, C(name), pc);
      if (mi.isNull()) return null;
      const p = mi.readPointer();
      return p.isNull() ? null : p;
    }

    const hooked = [];
    // Methodes d'instance: args[0] = this, args[1] = premier parametre.
    for (const [name, pc, dir] of [['FireChannelRead',1,'in'], ['WriteAsync',1,'out'], ['WriteAndFlushAsync',1,'out']]) {
      const p = nativeOf(name, pc);
      if (!p) continue;
      Interceptor.attach(p, {
        onEnter: function (args) {
          if (events++ > MAX) return;
          const cls = nameOf(args[1]);
          // On ne deroule le contenu que pour les objets applicatifs:
          // les tampons DotNetty n'ont rien d'interessant a dire.
          const skip = cls.indexOf('DotNetty') === 0;
          send({ kind: 'msg', dir: dir, via: name, name: cls, json: skip ? null : jsonOf(args[1]) });
        }
      });
      hooked.push(name + '/' + pc + ' @ ' + p);
    }

    send({ kind: 'ready', hooked: hooked });
  `;
}

module.exports = { pipelineAgentSource };
