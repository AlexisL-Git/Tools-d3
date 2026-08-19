'use strict';

// Cartographie EN LECTURE SEULE de tout le chemin de sortie de DotNetty.
//
// Le hook precedent (pipelineAgent) est pose sur AbstractChannelHandlerContext,
// un seul maillon du pipeline. Il ne voit rien au repos: soit le client
// n'emet rien, soit ce qu'il emet passe ailleurs. Impossible de trancher sans
// couvrir toute la chaine.
//
// Cet agent ne devine pas le point d'ancrage: il enumere toutes les classes de
// DotNetty.Transport.dll et accroche chaque methode dont le nom appartient au
// vocabulaire de sortie de Netty (Write*, Flush*, DoWrite...). L'horodatage de
// chaque appel permet ensuite de reperer une periodicite a l'oeil.
//
// Aucune methode du jeu n'est appelee: on ne lit que le nom de classe des
// objets qui passent.
// classSubstring restreint les classes accrochees. Par defaut 'Channel': les
// methodes Write/Flush des tampons d'octets porteraient les memes noms et
// noieraient le journal sous des milliers d'appels sans rapport avec la sortie
// reseau, alors que tout le chemin utile (AbstractChannel, DefaultChannelPipeline,
// TcpSocketChannel, ChannelOutboundBuffer...) contient 'Channel'.
function egressAgentSource({ methodNames = null, classSubstring = 'Channel', dumpFields = true, maxEvents = 200000 } = {}) {
  const names = methodNames || [
    'WriteAsync',
    'WriteAndFlushAsync',
    'Write',
    'WriteAndFlush',
    'Flush',
    'Flush0',
    'DoWrite',
  ];
  return `
    const MOD = 'GameAssembly.dll';
    let _m = null;
    function resolve(n) {
      if (typeof Module.findExportByName === 'function') return Module.findExportByName(MOD, n);
      if (_m === null) _m = Process.getModuleByName(MOD);
      return _m.findExportByName ? _m.findExportByName(n) : _m.getExportByName(n);
    }
    function fn(n, r, a) { const p = resolve(n); if (!p) throw new Error('export ' + n); return new NativeFunction(p, r, a); }

    const domain_get      = fn('il2cpp_domain_get','pointer',[]);
    const thread_attach   = fn('il2cpp_thread_attach','pointer',['pointer']);
    const domain_get_asm  = fn('il2cpp_domain_get_assemblies','pointer',['pointer','pointer']);
    const asm_get_image   = fn('il2cpp_assembly_get_image','pointer',['pointer']);
    const image_get_name  = fn('il2cpp_image_get_name','pointer',['pointer']);
    const image_get_cnt   = fn('il2cpp_image_get_class_count','uint32',['pointer']);
    const image_get_class = fn('il2cpp_image_get_class','pointer',['pointer','uint32']);
    const class_get_meths = fn('il2cpp_class_get_methods','pointer',['pointer','pointer']);
    const class_get_name  = fn('il2cpp_class_get_name','pointer',['pointer']);
    const class_get_ns    = fn('il2cpp_class_get_namespace','pointer',['pointer']);
    const object_get_cls  = fn('il2cpp_object_get_class','pointer',['pointer']);
    const method_get_name = fn('il2cpp_method_get_name','pointer',['pointer']);
    const method_get_pc   = fn('il2cpp_method_get_param_count','uint32',['pointer']);

    const class_get_flds = fn('il2cpp_class_get_fields','pointer',['pointer','pointer']);
    const field_get_name = fn('il2cpp_field_get_name','pointer',['pointer']);
    const field_get_off  = fn('il2cpp_field_get_offset','uint32',['pointer']);
    const field_get_type = fn('il2cpp_field_get_type','pointer',['pointer']);
    const type_get_name  = fn('il2cpp_type_get_name','pointer',['pointer']);
    const string_chars   = fn('il2cpp_string_chars','pointer',['pointer']);
    const string_length  = fn('il2cpp_string_length','int32',['pointer']);

    const S = p => (!p || p.isNull()) ? '' : p.readUtf8String();

    const domain = domain_get();
    thread_attach(domain);

    const WANTED = ${JSON.stringify(names)};
    const FILTER = ${JSON.stringify(classSubstring || '')};
    const DUMP = ${dumpFields ? 'true' : 'false'};
    const MAX = ${maxEvents};
    let events = 0;

    function nameOf(p) {
      try {
        if (!p || p.isNull()) return null;
        const c = object_get_cls(p);
        if (c.isNull()) return null;
        const ns = S(class_get_ns(c));
        return (ns ? ns + '.' : '') + S(class_get_name(c));
      } catch (e) { return '(err)'; }
    }

    // Lecture du contenu par acces memoire pur, jamais par appel de code du
    // jeu: appeler ToString() depuis un hook declenche une allocation, donc le
    // ramasse-miettes, depuis un thread deja intercepte -> erreur systematique.
    const layoutCache = {};
    function layoutOf(klass) {
      const key = klass.toString();
      if (layoutCache[key]) return layoutCache[key];
      const it = Memory.alloc(Process.pointerSize); it.writePointer(NULL);
      const fields = [];
      for (;;) {
        const f = class_get_flds(klass, it);
        if (f.isNull()) break;
        const off = field_get_off(f);
        if (off === 0) continue;              // champ statique
        let tn = '?';
        try { tn = S(type_get_name(field_get_type(f))); } catch (e) {}
        fields.push({ name: S(field_get_name(f)), off: off, type: tn });
      }
      layoutCache[key] = fields;
      return fields;
    }

    function readValue(base, f, depth) {
      const at = base.add(f.off);
      try {
        switch (f.type) {
          case 'System.Int32':   return at.readS32();
          case 'System.UInt32':  return at.readU32();
          case 'System.Int64':   return at.readS64().toString();
          case 'System.UInt64':  return at.readU64().toString();
          case 'System.Boolean': return at.readU8() !== 0;
          case 'System.Single':  return at.readFloat();
          case 'System.Double':  return at.readDouble();
          case 'System.String': {
            const sp = at.readPointer();
            if (sp.isNull()) return null;
            const len = string_length(sp);
            return len > 0 ? string_chars(sp).readUtf16String(Math.min(len, 300)) : '';
          }
          default: {
            const op = at.readPointer();
            if (op.isNull()) return null;
            if (depth <= 0) return '{' + f.type + '}';
            return dump(op, depth - 1);
          }
        }
      } catch (e) { return '(illisible)'; }
    }

    function dump(objPtr, depth) {
      try {
        if (!objPtr || objPtr.isNull()) return null;
        const c = object_get_cls(objPtr);
        if (c.isNull()) return null;
        const out = { '#': S(class_get_name(c)) };
        for (const f of layoutOf(c)) out[f.name] = readValue(objPtr, f, depth);
        return out;
      } catch (e) { return '(erreur)'; }
    }

    const sz = Memory.alloc(8); sz.writeU64(0);
    const asms = domain_get_asm(domain, sz);
    const na = sz.readU64().toNumber();

    const hooked = [];
    const seenPtr = {};

    for (let i = 0; i < na; i++) {
      const img = asm_get_image(asms.add(i * Process.pointerSize).readPointer());
      const iname = S(image_get_name(img));
      if (iname.indexOf('DotNetty') !== 0) continue;

      const nc = image_get_cnt(img);
      for (let ci = 0; ci < nc; ci++) {
        const k = image_get_class(img, ci);
        if (k.isNull()) continue;
        const kname = S(class_get_name(k));
        if (FILTER && kname.indexOf(FILTER) < 0) continue;

        const it = Memory.alloc(Process.pointerSize); it.writePointer(NULL);
        for (;;) {
          const m = class_get_meths(k, it);
          if (m.isNull()) break;
          const mname = S(method_get_name(m));
          if (WANTED.indexOf(mname) < 0) continue;

          const p = m.readPointer();          // 1er champ du MethodInfo = code natif
          if (p.isNull()) continue;
          const key = p.toString();
          if (seenPtr[key]) continue;         // IL2CPP mutualise le code identique
          seenPtr[key] = true;

          const label = iname + ':' + kname + '.' + mname + '/' + method_get_pc(m);
          try {
            Interceptor.attach(p, {
              onEnter: function (args) {
                if (events++ > MAX) return;
                const a1 = nameOf(args[1]);
                // On ne deroule que les objets applicatifs: la plomberie
                // DotNetty (tampons, contextes) n'a rien a dire sur le contenu.
                const app = a1 && a1.indexOf('DotNetty') !== 0;
                send({
                  kind: 'hit',
                  t: Date.now(),
                  at: label,
                  self: nameOf(args[0]),
                  arg1: a1,
                  json: (DUMP && app) ? dump(args[1], 3) : null,
                });
              }
            });
            hooked.push(label);
          } catch (e) { /* methode non accrochable: on passe */ }
        }
      }
    }

    send({ kind: 'ready', hooked: hooked });
  `;
}

module.exports = { egressAgentSource };
