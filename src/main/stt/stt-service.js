/**
 * stt-service.js — Base class for STT backend services.
 *
 * Owns shared logic: push-target transport, per-session VAD state machines,
 * audio chunk handling, resampling, and the transcript callback.
 * Subclasses implement transcription.
 *
 * Every mic source has its own VAD session so several clients can talk at the
 * same time without corrupting each other's buffers:
 *   - 'local'           the desktop window (and LAN web clients), Float32 PCM
 *   - 'remote:<client>' a remote browser over kurochan-server, Int16 PCM @ 16 kHz
 * VAD state / errors are pushed only to the session's owner ({ to: sessionId }).
 * Transcriptions run one at a time so concurrent utterances don't run the
 * transcriber in parallel.
 */

class VadSession {
  constructor(id, sampleRate, format) {
    this.id          = id;
    this.sampleRate  = sampleRate || 44100;
    this.format      = format === 's16' ? 's16' : 'f32';
    this.state       = 'idle';
    this.chunks      = [];
    this.silenceStart = null;
  }
}

class STTService {
  constructor() {
    /** Push target with `.webContents.send(channel, data, opts)` + `.isDestroyed()`. */
    this._win             = null;
    this._vadThreshold    = 0.02;
    this._vadSilenceMs    = 1500;
    /** @type {Map<string, VadSession>} */
    this._sessions        = new Map();
    /** @type {((text: string) => void) | null} */
    this._onTranscript    = null;
    /** @type {(() => void) | null} — fired when a user starts speaking (idle→speech). */
    this._onSpeechStart   = null;
    this._transcribeQueue = Promise.resolve();
  }

  setWindow(win) {
    this._win = win;
  }

  _send(channel, data, sessionId) {
    if (this._win && !this._win.isDestroyed()) {
      this._win.webContents.send(channel, data, { to: sessionId });
    }
  }

  /**
   * Configure shared state then delegate to subclass.
   */
  configure(sttConfig, deps) {
    const vad = sttConfig?.vad ?? {};
    if (vad.voiceThreshold != null) this._vadThreshold = Number(vad.voiceThreshold);
    if (vad.silenceDuration != null) this._vadSilenceMs = Number(vad.silenceDuration);
    this._configure(sttConfig, deps);
  }

  setOnTranscript(fn) {
    this._onTranscript = fn;
  }

  setOnSpeechStart(fn) {
    this._onSpeechStart = fn;
  }

  startListening(sampleRate, sessionId = 'local', format = 'f32') {
    const session = new VadSession(sessionId, sampleRate, format);
    this._sessions.set(sessionId, session);
    this._setVadState(session, 'idle');
    return true;
  }

  stopListening(sessionId = 'local') {
    const session = this._sessions.get(sessionId);
    if (!session) return;
    this._sessions.delete(sessionId);
    if (session.state === 'speech' && session.chunks.length > 0) {
      this._finishUtterance(session);
    } else {
      session.chunks = [];
      session.silenceStart = null;
      if (session.state !== 'processing') session.state = 'idle';
    }
  }

  handleAudioChunk(buffer, sessionId = 'local') {
    const session = this._sessions.get(sessionId);
    if (!session) return;
    const chunk = this._toFloat32(buffer, session.format);
    if (chunk.length === 0) return;
    const rms = this._computeRMS(chunk);

    if (session.state === 'idle') {
      if (rms > this._vadThreshold) {
        session.chunks = [Float32Array.from(chunk)];
        session.silenceStart = null;
        this._setVadState(session, 'speech');
        // Barge-in: a user started talking — notify so the app can abort any
        // in-flight LLM turn and TTS playback.
        if (this._onSpeechStart) { try { this._onSpeechStart(); } catch { /* ignore */ } }
      }
    } else if (session.state === 'speech') {
      session.chunks.push(Float32Array.from(chunk));
      if (rms > this._vadThreshold) {
        session.silenceStart = null;
      } else if (session.silenceStart === null) {
        session.silenceStart = Date.now();
      } else if (Date.now() - session.silenceStart >= this._vadSilenceMs) {
        this._finishUtterance(session);
      }
    }
  }

  /** Transcribe the buffered utterance of `session` and deliver the transcript. */
  _finishUtterance(session) {
    const chunks = session.chunks;
    session.chunks = [];
    session.silenceStart = null;
    this._setVadState(session, 'processing');
    this._transcribeChunks(chunks, session.sampleRate).then(
      (text) => {
        this._setVadState(session, 'idle');
        if (text && this._onTranscript) this._onTranscript(text);
      },
      (err) => {
        this._setVadState(session, 'idle');
        this._send('stt:error', { message: err.message }, session.id);
      },
    );
  }

  _setVadState(session, s) {
    session.state = s;
    this._send('stt:vad-state', { state: s }, session.id);
  }

  _toFloat32(buffer, format) {
    if (format === 's16') {
      const byteLength = buffer.byteLength - (buffer.byteLength % 2);
      const int16 = new Int16Array(buffer, 0, byteLength / 2);
      const out = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768;
      return out;
    }
    return new Float32Array(buffer);
  }

  _computeRMS(chunk) {
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    return Math.sqrt(sum / chunk.length);
  }

  _resampleTo16k(channelData, srcRate) {
    if (srcRate === 16000) return channelData;
    const ratio  = srcRate / 16000;
    const outLen = Math.floor(channelData.length / ratio);
    const out    = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos  = i * ratio;
      const idx  = Math.floor(pos);
      const frac = pos - idx;
      const a    = channelData[idx]     ?? 0;
      const b    = channelData[idx + 1] ?? a;
      out[i]     = a + frac * (b - a);
    }
    return out;
  }

  _transcribeChunks(chunks, sampleRate) {
    const totalLen   = chunks.reduce((s, c) => s + c.length, 0);
    const allSamples = new Float32Array(totalLen);
    let offset = 0;
    for (const c of chunks) { allSamples.set(c, offset); offset += c.length; }
    const samples = this._resampleTo16k(allSamples, sampleRate);
    const run = () => this.transcribe(samples.buffer);
    const result = this._transcribeQueue.then(run, run);
    this._transcribeQueue = result.catch(() => {});
    return result;
  }

  /** Override in subclasses for backend-specific config. */
  _configure(config, deps) {}

  /** Must be implemented by subclasses. */
  available()               { throw new Error('STTService.available() must be implemented'); }
  transcribe(samplesBuffer) { throw new Error('STTService.transcribe() must be implemented'); }
}

module.exports = { STTService };
