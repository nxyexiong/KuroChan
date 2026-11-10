/**
 * remote-codec.js — binary frame codec for the kurochan-server relay.
 *
 * Layout: [u8 kind][u8 idLen][id bytes (utf8)][payload]
 *   kind 1  PC → clients   TTS audio chunk        (id = clientId, '' = all)
 *   kind 2  client → PC    mic PCM Int16LE 16 kHz  (id = clientId, filled by server)
 *   kind 3  PC → server    tunnel body chunk       (id = reqId)
 */

const KIND = Object.freeze({ TTS_AUDIO: 1, MIC_AUDIO: 2, TUNNEL_BODY: 3 });

function encodeBinary(kind, id, payload) {
  const idBuf = Buffer.from(id || '', 'utf8');
  if (idBuf.length > 255) throw new Error('binary frame id too long');
  const body = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload.buffer || payload, payload.byteOffset || 0, payload.byteLength);
  const out = Buffer.allocUnsafe(2 + idBuf.length + body.length);
  out[0] = kind;
  out[1] = idBuf.length;
  idBuf.copy(out, 2);
  body.copy(out, 2 + idBuf.length);
  return out;
}

/** @returns {{ kind:number, id:string, payload:Buffer } | null} */
function decodeBinary(buf) {
  if (!buf || buf.length < 2) return null;
  const idLen = buf[1];
  if (buf.length < 2 + idLen) return null;
  return {
    kind:    buf[0],
    id:      buf.toString('utf8', 2, 2 + idLen),
    payload: buf.subarray(2 + idLen),
  };
}

module.exports = { KIND, encodeBinary, decodeBinary };
