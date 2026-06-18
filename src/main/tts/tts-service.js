/**
 * tts-service.js — Base class for TTS backend services.
 *
 * Owns shared logic: BrowserWindow transport, the streaming utterance lifecycle
 * (begin → push → end), pitch, and lip-sync forwarding.
 *
 * The lifecycle is PURE STREAMING — the base class does NOT buffer or segment
 * text. It forwards incremental deltas straight to the provider so TTS can start
 * speaking while the LLM is still generating (and across multi-part tool turns):
 *   - begin()      start an utterance (supersedes any in-progress one)
 *   - push(text)   feed an incremental text delta
 *   - end()        no more text — finalize
 *   - speak(text)  one-shot convenience = begin + push + end
 *
 * Subclasses implement how incremental text becomes audio:
 *   _beginImpl(), _pushImpl(textDelta), _endImpl(), abort()
 * and emit audio back through the protected helpers _emitChunk/_emitEnd/_emitError.
 *
 * Providers that natively accept streamed text (xAI WebSocket, Kokoro's
 * TextSplitterStream) feed deltas directly; request/response providers (OpenAI)
 * do their own internal sentence splitting.
 */
const { setMouthOpen } = require('../model/model.js');

class TTSService {
  constructor() {
    /** @type {import('electron').BrowserWindow | null} */
    this._win         = null;
    this._pitch       = 0;
    this._audioFormat = 'aac';
    this._speaking    = false;
    this._beginFailed = false;
    /** Generation counter — bumped on every begin()/stop() so a superseded
     *  utterance's async audio callbacks can be ignored via _isCurrent(). */
    this._gen         = 0;
  }

  setWindow(win) {
    this._win = win;
  }

  _send(channel, data) {
    if (this._win && !this._win.isDestroyed()) {
      this._win.webContents.send(channel, data);
    }
  }

  configure(ttsConfig) {
    if (ttsConfig?.pitch !== undefined) this._pitch = ttsConfig.pitch;
    this._configure(ttsConfig);
  }

  // ── Utterance lifecycle ──────────────────────────────────────────────────

  /** Begin a new utterance, superseding any in-progress one. */
  begin() {
    const err = this._validate();
    if (err) {
      this._beginFailed = true;          // don't re-attempt (and spam) on each push
      this._send('tts:error', { message: err });
      setMouthOpen(0);
      return;
    }
    this._beginFailed = false;
    this._gen++;                         // supersede any previous utterance
    this.abort();                        // tear down the old producer
    this._speaking = true;
    this._send('tts:start', { pitch: this._pitch, format: this._audioFormat });
    this._beginImpl();
  }

  /** Feed an incremental text delta into the current utterance. */
  push(text) {
    if (!text) return;
    if (!this._speaking) {
      if (this._beginFailed) return;     // already errored this utterance
      this.begin();
      if (!this._speaking) return;       // begin failed (e.g. not configured)
    }
    this._pushImpl(text);
  }

  /** Signal that no more text will be added; finalize synthesis. */
  end() {
    if (!this._speaking) return;
    this._speaking = false;
    this._endImpl();
  }

  /** One-shot convenience: speak a complete string. */
  speak(text) {
    this.begin();
    this.push(text);
    this.end();
  }

  stop() {
    this._gen++;
    this.abort();
    this._speaking    = false;
    this._beginFailed = false;
    setMouthOpen(0);
    this._send('tts:stop', {});
  }

  handleVolume(volume) {
    setMouthOpen(volume);
  }

  // ── Protected audio emit helpers (for subclasses) ────────────────────────

  /** True if `gen` (captured at op start) is still the current utterance. */
  _isCurrent(gen) { return gen === this._gen; }

  _emitChunk(buf) {
    this._send('tts:chunk', { data: new Uint8Array(buf) });
  }

  _emitEnd() {
    this._send('tts:end', {});
  }

  _emitError(err) {
    this._send('tts:error', { message: (err && err.message) || String(err) });
    setMouthOpen(0);
  }

  // ── Subclass hooks ───────────────────────────────────────────────────────

  /** Override in subclasses for backend-specific config. */
  _configure(config) {}

  /** Return an error string if speaking isn't possible yet (e.g. not configured), else null. */
  _validate() { return null; }

  /** Start producing audio for a new utterance. */
  _beginImpl() { throw new Error('TTSService._beginImpl() must be implemented'); }

  /** Receive an incremental text delta. */
  _pushImpl(text) { throw new Error('TTSService._pushImpl() must be implemented'); }

  /** No more text will arrive; finalize. */
  _endImpl() { throw new Error('TTSService._endImpl() must be implemented'); }

  /** Tear down any in-flight audio production. */
  abort() { throw new Error('TTSService.abort() must be implemented'); }
}

module.exports = { TTSService };
