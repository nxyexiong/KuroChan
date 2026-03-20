/**
 * stt-service.js — Base class for STT backend services.
 *
 * Owns shared logic: BrowserWindow transport, VAD state machine,
 * audio chunk handling, resampling, and transcript callback.
 * Subclasses implement transcription.
 */
class STTService {
  constructor() {
    /** @type {import('electron').BrowserWindow | null} */
    this._win             = null;
    this._vadThreshold    = 0.02;
    this._vadSilenceMs    = 1500;
    this._vadState        = 'idle';
    this._recordingChunks = [];
    this._silenceStart    = null;
    this._sampleRate      = 44100;
    this._listening       = false;
    /** @type {((text: string) => void) | null} */
    this._onTranscript    = null;
  }

  setWindow(win) {
    this._win = win;
  }

  _send(channel, data) {
    if (this._win && !this._win.isDestroyed()) {
      this._win.webContents.send(channel, data);
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

  startListening(sampleRate) {
    this._listening = true;
    this._sampleRate = sampleRate || 44100;
    this._recordingChunks = [];
    this._silenceStart = null;
    this._setVadState('idle');
    return true;
  }

  stopListening() {
    this._listening = false;
    if (this._vadState === 'speech' && this._recordingChunks.length > 0) {
      const chunks = this._recordingChunks;
      this._recordingChunks = [];
      this._silenceStart = null;
      this._setVadState('processing');
      this._transcribeChunks(chunks).then(
        (text) => {
          this._setVadState('idle');
          if (text && this._onTranscript) this._onTranscript(text);
        },
        (err) => {
          this._setVadState('idle');
          this._send('stt:error', { message: err.message });
        },
      );
    } else {
      this._recordingChunks = [];
      this._silenceStart = null;
      if (this._vadState !== 'processing') {
        this._vadState = 'idle';
      }
    }
  }

  handleAudioChunk(buffer) {
    if (!this._listening) return;
    const chunk = new Float32Array(buffer);
    const rms = this._computeRMS(chunk);

    if (this._vadState === 'idle') {
      if (rms > this._vadThreshold) {
        this._recordingChunks = [Float32Array.from(chunk)];
        this._silenceStart = null;
        this._setVadState('speech');
      }
    } else if (this._vadState === 'speech') {
      this._recordingChunks.push(Float32Array.from(chunk));
      if (rms > this._vadThreshold) {
        this._silenceStart = null;
      } else {
        if (this._silenceStart === null) {
          this._silenceStart = Date.now();
        } else if (Date.now() - this._silenceStart >= this._vadSilenceMs) {
          const chunks = this._recordingChunks;
          this._recordingChunks = [];
          this._silenceStart = null;
          this._setVadState('processing');
          this._transcribeChunks(chunks).then(
            (text) => {
              this._setVadState('idle');
              if (text && this._onTranscript) this._onTranscript(text);
            },
            (err) => {
              this._setVadState('idle');
              this._send('stt:error', { message: err.message });
            },
          );
        }
      }
    }
  }

  _setVadState(s) {
    this._vadState = s;
    this._send('stt:vad-state', { state: s });
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

  async _transcribeChunks(chunks) {
    const totalLen   = chunks.reduce((s, c) => s + c.length, 0);
    const allSamples = new Float32Array(totalLen);
    let offset = 0;
    for (const c of chunks) { allSamples.set(c, offset); offset += c.length; }
    const samples = this._resampleTo16k(allSamples, this._sampleRate);
    return this.transcribe(samples.buffer);
  }

  /** Override in subclasses for backend-specific config. */
  _configure(config, deps) {}

  /** Must be implemented by subclasses. */
  available()               { throw new Error('STTService.available() must be implemented'); }
  transcribe(samplesBuffer) { throw new Error('STTService.transcribe() must be implemented'); }
}

module.exports = { STTService };
