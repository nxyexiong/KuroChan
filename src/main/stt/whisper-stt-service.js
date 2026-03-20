/**
 * whisper-stt-service.js — Whisper STT service implementation.
 *
 * Whisper-based transcription via injected DLL function.
 */
const { STTService } = require('./stt-service.js');

class WhisperSTTService extends STTService {
  constructor() {
    super();
    this._modelPath    = '';
    this._nThreads     = 4;
    this._language     = 'en';
    /** @type {((opts: Object) => Promise<string>) | null} */
    this._transcribeFn = null;
  }

  _configure(sttConfig, deps) {
    const whisper = sttConfig?.whisper ?? {};
    if (whisper.modelPath != null) this._modelPath = whisper.modelPath;
    if (whisper.nThreads  != null) this._nThreads  = whisper.nThreads;
    if (whisper.language  != null) this._language  = whisper.language;
    if (deps?.transcribe)          this._transcribeFn = deps.transcribe;
  }

  available() {
    return !!this._modelPath && !!this._transcribeFn;
  }

  transcribe(samplesBuffer) {
    if (!this._transcribeFn) return Promise.reject(new Error('Whisper transcribe not available'));
    return this._transcribeFn({
      samplesBuffer,
      modelPath: this._modelPath,
      nThreads:  this._nThreads,
      language:  this._language,
    });
  }
}

module.exports = { WhisperSTTService };
