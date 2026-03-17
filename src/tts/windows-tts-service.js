/**
 * windows-tts-service.js — Windows built-in TTS via the Web Speech API.
 * Electron's renderer exposes window.speechSynthesis, which on Windows is
 * backed by the OS SAPI/OneCore voices — no extra dependencies required.
 */
import { TTSService } from './tts-service.js';

export class WindowsTTSService extends TTSService {
  constructor() {
    super();
    this._voice  = null;  // SpeechSynthesisVoice | null (null = OS default)
    this._rate   = 1;
    this._pitch  = 1;
    this._volume = 1;
  }

  configure({ windows = {} } = {}) {
    const { voiceName, rate, pitch, volume } = windows;
    if (rate   !== undefined) this._rate   = rate;
    if (pitch  !== undefined) this._pitch  = pitch;
    if (volume !== undefined) this._volume = volume;

    if (voiceName) {
      this._voiceName = voiceName;
      this._resolveVoice();
    }
  }

  speak(text, onDone, onError) {
    if (!window.speechSynthesis) {
      onError(new Error('SpeechSynthesis is not available in this environment.'));
      return;
    }

    // Resolve voice lazily (voices load asynchronously on some platforms)
    this._resolveVoice();

    window.speechSynthesis.cancel();

    const utterance       = new SpeechSynthesisUtterance(text);
    utterance.rate        = this._rate;
    utterance.pitch       = this._pitch;
    utterance.volume      = this._volume;
    if (this._voice) utterance.voice = this._voice;

    utterance.onend   = () => onDone();
    utterance.onerror = (e) => onError(new Error(`SpeechSynthesis error: ${e.error}`));

    window.speechSynthesis.speak(utterance);
  }

  stop() {
    window.speechSynthesis?.cancel();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  _resolveVoice() {
    if (!this._voiceName || !window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return; // not loaded yet — will retry on next speak()
    const match = voices.find(v => v.name === this._voiceName);
    if (match) this._voice = match;
  }
}
