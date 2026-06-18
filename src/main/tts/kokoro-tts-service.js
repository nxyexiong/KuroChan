/**
 * kokoro-tts-service.js — Local streaming TTS via Kokoro-82M (main process).
 *
 * Uses `kokoro-js` (Transformers.js + onnxruntime-node) to synthesize speech
 * 100% locally — no cloud API, no key. Like the Whisper STT backend, the user
 * supplies their own model: a folder downloaded from the Hugging Face repo
 * `onnx-community/Kokoro-82M-v1.0-ONNX`. The 54 voice style-vectors ship inside
 * the kokoro-js package, so only the ONNX model + tokenizer need to be provided.
 *
 * Synthesis runs in a worker thread (kokoro-worker.js) because onnxruntime-node
 * inference does not yield the JS event loop — running it on the Electron main
 * thread froze the UI (IPC, cursor/head tracking, buttons) for ~1–2 s per
 * utterance. Text is streamed into the worker incrementally (begin/push/end), so
 * the model speaks sentence-by-sentence as the LLM generates — emitting 24 kHz
 * 16-bit LE mono PCM that matches the renderer's `format: 'pcm'` player path.
 *
 * The worker is a lazily-spawned, process-lifetime SINGLETON shared by every
 * service instance. It is never force-terminated mid-inference (that crashes the
 * native runtime); shutdownWorker() drains it gracefully on app quit.
 */
const path = require('path');
const { Worker } = require('worker_threads');
const { TTSService } = require('./tts-service.js');

let _worker = null;
let _reqId  = 0;
const _handlers = new Map(); // request id -> { onChunk, onEnd, onError }
let _drainWaiter = null;     // called whenever a request settles (for graceful shutdown)

function _getWorker() {
  if (_worker) return _worker;
  const worker = new Worker(path.join(__dirname, 'kokoro-worker.js'));

  worker.on('message', (m) => {
    if (!m) return;
    const h = _handlers.get(m.id);
    if (m.type === 'chunk') {
      if (h && m.pcm) h.onChunk(Buffer.from(m.pcm));
    } else if (m.type === 'end') {
      _handlers.delete(m.id);
      if (h) h.onEnd();
      if (_drainWaiter) _drainWaiter();
    } else if (m.type === 'error') {
      _handlers.delete(m.id);
      if (h) h.onError(new Error(m.message || 'Kokoro synthesis failed'));
      if (_drainWaiter) _drainWaiter();
    }
  });

  worker.on('error', (err) => {
    for (const h of _handlers.values()) { try { h.onError(err); } catch { /* ignore */ } }
    _handlers.clear();
    _worker = null; // next call respawns
    if (_drainWaiter) _drainWaiter();
  });
  worker.on('exit', () => { _handlers.clear(); _worker = null; if (_drainWaiter) _drainWaiter(); });

  _worker = worker;
  return worker;
}

/**
 * Gracefully stop the synthesis worker — used on app quit. Aborts any in-flight
 * sessions, waits for the worker to drain to idle (the current sentence's native
 * inference cannot be interrupted), then terminates it AFTER a short settle so we
 * never terminate mid-inference (which crashes the runtime).
 */
function shutdownWorker(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const worker = _worker;
    if (!worker) { resolve(); return; }
    _worker = null;

    let settled = false;
    const terminate = () => { _drainWaiter = null; worker.terminate().then(resolve, resolve); };
    const tryDrain = () => { if (!settled && _handlers.size === 0) { settled = true; setTimeout(terminate, 150); } };

    for (const id of [..._handlers.keys()]) {
      try { worker.postMessage({ type: 'abort', id }); } catch { /* ignore */ }
    }
    _drainWaiter = tryDrain;
    tryDrain();
    setTimeout(() => { if (!settled) { settled = true; terminate(); } }, timeoutMs);
  });
}

class KokoroTTSService extends TTSService {
  constructor() {
    super();
    this._modelDir = '';
    this._dtype    = 'q8';
    this._voice    = 'af_heart';
    this._speed    = 1.0;
    this._audioFormat = 'pcm';
    this._activeId = null;
  }

  _configure({ kokoro = {} } = {}) {
    const { modelDir, dtype, voice, speed } = kokoro;
    if (modelDir !== undefined) this._modelDir = (modelDir || '').trim();
    if (dtype    !== undefined && dtype !== '') this._dtype = dtype;
    if (voice    !== undefined && voice !== '') this._voice = voice;
    if (speed    !== undefined && speed !== '' && speed !== null) this._speed = Number(speed);
  }

  _validate() {
    return this._modelDir ? null : 'Kokoro model folder is not set. Add it in Settings (TTS → Kokoro).';
  }

  _beginImpl() {
    const gen = this._gen;
    const worker = _getWorker();
    const id = ++_reqId;
    this._activeId = id;
    _handlers.set(id, {
      onChunk: (buf) => { if (this._isCurrent(gen)) this._emitChunk(buf); },
      onEnd:   ()    => { if (this._isCurrent(gen)) this._emitEnd(); },
      onError: (err) => { if (this._isCurrent(gen)) this._emitError(err); },
    });
    worker.postMessage({
      type: 'begin', id,
      modelDir: this._modelDir, dtype: this._dtype, voice: this._voice, speed: this._speed,
    });
  }

  _pushImpl(text) {
    if (this._activeId == null || !_worker) return;
    try { _worker.postMessage({ type: 'push', id: this._activeId, text }); } catch { /* ignore */ }
  }

  _endImpl() {
    if (this._activeId == null || !_worker) return;
    try { _worker.postMessage({ type: 'end', id: this._activeId }); } catch { /* ignore */ }
  }

  abort() {
    const id = this._activeId;
    this._activeId = null;
    if (id == null) return;
    _handlers.delete(id);
    if (_worker) { try { _worker.postMessage({ type: 'abort', id }); } catch { /* ignore */ } }
  }

  /** On reconfigure/shutdown, just abort. The shared worker singleton is reclaimed on quit. */
  async dispose() {
    this.abort();
  }
}

module.exports = { KokoroTTSService, shutdownWorker };
