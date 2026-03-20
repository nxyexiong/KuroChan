/**
 * tts-service.js — Base class for TTS backend services.
 *
 * Owns shared logic: BrowserWindow transport, stream lifecycle (speak,
 * stop, stream events), pitch, and lip sync forwarding.
 * Subclasses implement _configure(), streamAudio(), and abort().
 */
const { setMouthOpen } = require('../model/model.js');

class TTSService {
  constructor() {
    /** @type {import('electron').BrowserWindow | null} */
    this._win           = null;
    this._pitch         = 0;
    this._audioFormat   = 'aac';
    this._currentStream = null;
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
  configure(ttsConfig) {
    if (ttsConfig?.pitch !== undefined) this._pitch = ttsConfig.pitch;
    this._configure(ttsConfig);
  }

  /**
   * Speak text: get an audio stream from the subclass, wire IPC events.
   * @param {string} text
   */
  speak(text) {
    this._killStreams();

    try {
      const stream = this.streamAudio(text);
      this._currentStream = stream;

      this._send('tts:start', { pitch: this._pitch, format: this._audioFormat });

      stream.on('data', (chunk) => {
        this._send('tts:chunk', { data: new Uint8Array(chunk) });
      });

      stream.on('end', () => {
        this._send('tts:end', {});
        this._currentStream = null;
      });

      stream.on('error', (err) => {
        this._send('tts:error', { message: err.message });
        setMouthOpen(0);
        this._currentStream = null;
      });
    } catch (err) {
      this._send('tts:error', { message: err.message });
      setMouthOpen(0);
    }
  }

  _killStreams() {
    if (this._currentStream) {
      this._currentStream.destroy();
      this._currentStream = null;
    }
  }

  stop() {
    this.abort();
    this._killStreams();
    setMouthOpen(0);
    this._send('tts:stop', {});
  }

  handleVolume(volume) {
    setMouthOpen(volume);
  }

  /** Override in subclasses for backend-specific config. */
  _configure(config) {}

  /** Must be implemented by subclasses. */
  streamAudio(text) { throw new Error('TTSService.streamAudio() must be implemented'); }
  abort()           { throw new Error('TTSService.abort() must be implemented'); }
}

module.exports = { TTSService };
