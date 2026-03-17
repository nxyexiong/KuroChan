/**
 * openai-tts-service.js — OpenAI TTS implementation.
 * Downloads the audio as a Blob, plays via an <audio> element (no blocking
 * decodeAudioData call), and routes through an AnalyserNode for real-time
 * RMS volume reporting used by lip sync.
 */
import { TTSService } from './tts-service.js';

const OPENAI_TTS_ENDPOINT = 'https://api.openai.com/v1/audio/speech';

export class OpenAITTSService extends TTSService {
  constructor() {
    super();
    this._apiKey   = '';
    this._model    = 'tts-1';
    this._voice    = 'alloy';
    this._speed    = 1.0;
    this._audioCtx = null;
    this._audio    = null;
    this._blobUrl  = null;
    this._rafId    = null;
  }

  configure({ openai = {} } = {}) {
    const { apiKey, model, voice, speed } = openai;
    if (apiKey !== undefined && apiKey !== '') this._apiKey = apiKey;
    if (model  !== undefined && model  !== '') this._model  = model;
    if (voice  !== undefined && voice  !== '') this._voice  = voice;
    if (speed  !== undefined)                  this._speed  = speed;
  }

  speak(text, onDone, onError, onVolume) {
    if (!this._apiKey) {
      onError(new Error('OpenAI TTS API key is not set. Add it in Settings.'));
      return;
    }

    this.stop();

    fetch(OPENAI_TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify({
        model:           this._model,
        input:           text,
        voice:           this._voice,
        speed:           this._speed,
        response_format: 'mp3',
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          const msg = errBody?.error?.message || response.statusText;
          throw new Error(`OpenAI TTS error ${response.status}: ${msg}`);
        }

        // Use a Blob URL so the browser decodes MP3 natively without blocking
        const blob    = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        this._blobUrl = blobUrl;

        // Lazily create AudioContext
        if (!this._audioCtx) {
          this._audioCtx = new AudioContext();
        }
        if (this._audioCtx.state === 'suspended') {
          await this._audioCtx.resume();
        }

        // <audio> element handles decoding; we tap it for volume via Web Audio
        const audio = new Audio(blobUrl);
        this._audio = audio;

        const mediaSource = this._audioCtx.createMediaElementSource(audio);
        const analyser    = this._audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.4;
        const timeDomain = new Uint8Array(analyser.fftSize);

        mediaSource.connect(analyser);
        analyser.connect(this._audioCtx.destination);

        let ended = false;

        const finish = () => {
          if (ended) return;
          ended = true;
          if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
          }
          URL.revokeObjectURL(blobUrl);
          this._blobUrl = null;
          this._audio   = null;
          if (onVolume) onVolume(0);
          onDone();
        };

        audio.addEventListener('ended', finish);
        audio.addEventListener('error', (e) => {
          finish();
          onError(new Error(`Audio playback error: ${e.message ?? e.type}`));
        });

        // Poll RMS amplitude every animation frame for lip sync
        const poll = () => {
          if (ended) return;
          analyser.getByteTimeDomainData(timeDomain);
          let sumSq = 0;
          for (let i = 0; i < timeDomain.length; i++) {
            const v = (timeDomain[i] - 128) / 128;
            sumSq += v * v;
          }
          const rms = Math.sqrt(sumSq / timeDomain.length);
          if (onVolume) onVolume(Math.min(1, rms * 5));
          this._rafId = requestAnimationFrame(poll);
        };

        audio.play()
          .then(() => poll())
          .catch((err) => { finish(); onError(err); });
      })
      .catch((err) => {
        if (this._rafId !== null) {
          cancelAnimationFrame(this._rafId);
          this._rafId = null;
        }
        onError(err);
      });
  }

  stop() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._audio) {
      this._audio.pause();
      this._audio.src = '';
      this._audio = null;
    }
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }
  }
}
