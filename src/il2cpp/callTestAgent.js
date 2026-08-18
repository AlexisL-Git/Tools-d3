'use strict';

// Experience: peut-on appeler du code du jeu depuis un contexte AUTRE qu'un hook ?
//
// Constat precedent: appeler ToString() depuis Interceptor.onEnter echoue
// systematiquement (allocation -> GC depuis un thread intercepte).
//
// Ici on capture un objet dans le hook, on l'EPINGLE avec un gchandle pour que
// le ramasse-miettes ne le libere pas, puis on tente l'appel plus tard depuis
// un minuteur, sur un thread attache a IL2CPP.
//
// ToString() est sans effet de bord: rien n'est envoye au serveur. C'est
// uniquement un test de faisabilite d'appel.
function callTestAgentSource() {
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
    const string_chars   = fn('il2cpp_string_chars','pointer',['pointer']);
    const string_length  = fn('il2cpp_string_length','int32',['pointer']);
    const gchandle_new   = fn('il2cpp_gchandle_new','uint32',['pointer','int']);
    const gchandle_target= fn('il2cpp_gchandle_get_target','pointer',['uint32']);

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
    const k = class_from_name(img, C('DotNetty.Transport.Channels'), C('AbstractChannelHandlerContext'));
    const mi = class_get_mfn(k, C('FireChannelRead'), 1);
    const target = mi.readPointer();

    let captured = null;   // { handle, className }
    Interceptor.attach(target, {
      onEnter: function (args) {
        if (captured !== null) return;
        const o = args[1];
        if (o.isNull()) return;
        const c = object_get_cls(o);
        if (c.isNull()) return;
        const cn = S(class_get_name(c));
        if (cn.indexOf('ByteBuf') !== -1) return;   // on veut un objet applicatif
        // Pas de gchandle: cette version d'IL2CPP ne rend pas un simple uint32 et
        // le tronquer produisait une adresse invalide. Le GC Boehm etant non
        // compactant, l'adresse reste valide; on raccourcit le delai pour limiter
        // le risque de liberation.
        captured = { ptr: o, className: cn };
        send({ kind: 'capture', className: cn, handle: 0 });
      }
    });

    // Appel differe, hors contexte de hook. On attend qu'un objet soit capture
    // plutot que de tirer a heure fixe.
    let tries = 0;
    const timer = setInterval(function () {
      tries++;
      if (captured === null) {
        if (tries > 60) { clearInterval(timer); send({ kind: 'result', ok: false, why: 'aucun objet capture en 30s' }); }
        return;
      }
      clearInterval(timer);
      try {
        thread_attach(domain);   // le thread du minuteur n'est pas un thread du jeu
        const obj = captured.ptr;
        if (obj.isNull()) { send({ kind: 'result', ok: false, why: 'pointeur nul' }); return; }
        const cls = object_get_cls(obj);
        if (cls.isNull()) { send({ kind: 'result', ok: false, why: 'classe nulle (objet libere ?)' }); return; }
        // GetHashCode: pas d'allocation, pas de reflexion. Si meme celle-ci
        // echoue, c'est l'appel lui-meme qui est impossible, pas ToString.
        const hMi = class_get_mfn(cls, C('GetHashCode'), 0);
        if (hMi.isNull()) { send({ kind: 'result', ok: false, why: 'GetHashCode absent' }); return; }
        const g = new NativeFunction(hMi.readPointer(), 'int32', ['pointer', 'pointer']);
        const hv = g(obj, hMi);
        send({ kind: 'result', ok: true, className: captured.className, text: 'GetHashCode() = ' + hv });
      } catch (e) {
        send({ kind: 'result', ok: false, why: 'exception: ' + e.message });
      }
    }, 500);

    send({ kind: 'ready' });
  `;
}

module.exports = { callTestAgentSource };
