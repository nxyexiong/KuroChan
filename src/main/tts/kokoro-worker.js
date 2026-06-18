/**
 * kokoro-worker.js — Kokoro synthesis worker (worker_threads).
 *
 * Runs in a separate thread so the heavy work (phonemization, tokenization and
 * onnxruntime-node inference — which does NOT yield the JS event loop) never
 * blocks the Electron main thread.
 *
 * Streaming session model — text is fed incrementally so audio starts before the
 * full reply (or even the first tool round) is complete:
 *   parent → worker:
 *     { type: 'begin', id, modelDir, dtype, voice, speed }
 *     { type: 'push',  id, text }
 *     { type: 'end',   id }
 *     { type: 'abort', id }
 *   worker → parent:
 *     { type: 'chunk', id, pcm }   // ArrayBuffer of 16-bit LE mono @24kHz (transferred)
 *     { type: 'end',   id }
 *     { type: 'error', id, message }
 *
 * Each session holds a kokoro-js TextSplitterStream: push() feeds text, the model
 * emits one audio clip per complete sentence, and close() (on 'end') drains the
 * remainder.
 */
const { parentPort } = require('worker_threads');
const path = require('path');

let _lib = null;
function loadLib() {
  if (!_lib) {
    const k = require('kokoro-js');
    const { env } = require('@huggingface/transformers');
    _lib = { KokoroTTS: k.KokoroTTS, TextSplitterStream: k.TextSplitterStream, env };
  }
  return _lib;
}

// Cache loaded models by modelDir+dtype so repeated utterances reuse the ~90 MB model.
const _modelCache = new Map();
function loadModel(modelDir, dtype) {
  const abs = path.resolve(modelDir);
  const key = `${abs}|${dtype}`;
  if (_modelCache.has(key)) return _modelCache.get(key);
  const p = (async () => {
    const { KokoroTTS, env } = loadLib();
    env.allowRemoteModels = false;   // never touch the HF Hub — fully local
    env.allowLocalModels  = true;
    env.localModelPath    = path.dirname(abs);
    return KokoroTTS.from_pretrained(path.basename(abs), { dtype, device: 'cpu' });
  })();
  _modelCache.set(key, p);
  p.catch(() => _modelCache.delete(key));
  return p;
}

function float32ToInt16LE(f32) {
  const ab = new ArrayBuffer(f32.length * 2);
  const dv = new DataView(ab);
  for (let i = 0; i < f32.length; i++) {
    let s = f32[i];
    if (s > 1) s = 1; else if (s < -1) s = -1;
    dv.setInt16(i * 2, (s * 32767) | 0, true);
  }
  return ab;
}

/** Active sessions: id -> { splitter, aborted, ended }. */
const _sessions = new Map();

async function runSession(id, modelDir, dtype, voice, speed) {
  const { TextSplitterStream } = loadLib();
  const splitter = new TextSplitterStream();
  const session = { splitter, aborted: false };
  _sessions.set(id, session);

  let tts;
  try {
    tts = await loadModel(modelDir, dtype);
  } catch (err) {
    _sessions.delete(id);
    parentPort.postMessage({ type: 'error', id, message: err && err.message ? err.message : String(err) });
    return;
  }

  if (session.aborted) { _sessions.delete(id); parentPort.postMessage({ type: 'end', id }); return; }

  try {
    for await (const { audio } of tts.stream(splitter, { voice, speed })) {
      if (session.aborted) break;
      if (audio && audio.audio && audio.audio.length) {
        const pcm = float32ToInt16LE(audio.audio);
        parentPort.postMessage({ type: 'chunk', id, pcm }, [pcm]); // transfer, no copy
      }
    }
    parentPort.postMessage({ type: 'end', id });
  } catch (err) {
    parentPort.postMessage({ type: 'error', id, message: err && err.message ? err.message : String(err) });
  } finally {
    _sessions.delete(id);
  }
}

parentPort.on('message', (msg) => {
  if (!msg) return;
  const { type, id } = msg;

  if (type === 'begin') {
    runSession(id, msg.modelDir, msg.dtype, msg.voice, msg.speed);
    return;
  }

  const session = _sessions.get(id);
  if (!session) return;

  if (type === 'push') {
    if (!session.aborted && msg.text) {
      try { session.splitter.push(msg.text); } catch { /* ignore */ }
    }
  } else if (type === 'end') {
    try { session.splitter.close(); } catch { /* ignore */ } // drains remaining text, ends iteration
  } else if (type === 'abort') {
    session.aborted = true;
    try { session.splitter.close(); } catch { /* ignore */ } // unblock the async iterator so it can exit
  }
});
