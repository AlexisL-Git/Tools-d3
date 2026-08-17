'use strict';

function decodeEnvelope(registry, frame) {
  const Message = registry.lookup('Message');
  if (Message === null) throw new Error("type 'Message' absent du registre");

  let msg;
  try {
    msg = Message.toObject(Message.decode(frame), { defaults: false });
  } catch (err) {
    throw new Error(`enveloppe illisible: ${err.message}`);
  }

  for (const kind of ['event', 'request', 'response']) {
    const box = msg[kind];
    if (!box) continue;
    const resolved = registry.decodeAny(box.content || {});
    return {
      kind,
      uid: kind === 'event' ? null : (box.uid ?? 0),
      name: resolved.name,
      payload: resolved.payload,
      unknown: resolved.unknown,
    };
  }

  throw new Error('enveloppe sans event, request ni response');
}

module.exports = { decodeEnvelope };
