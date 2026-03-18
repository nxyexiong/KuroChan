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
    this._pitch    = 0;    // semitones; applied via audio.playbackRate
    this._audioCtx = null;
    this._audio    = null;
    this._blobUrl  = null;
    this._rafId    = null;
    this._reader   = null;  // fetch stream reader, cancelled on stop()
  }

  configure({ openai = {} } = {}) {
    const { apiKey, model, voice, speed } = openai;
    if (apiKey !== undefined && apiKey !== '') this._apiKey = apiKey;
    if (model  !== undefined && model  !== '') this._model  = model;
    if (voice  !== undefined && voice  !== '') this._voice  = voice;
    if (speed  !== undefined)                  this._speed  = speed;    if (openai.pitch !== undefined)            this._pitch  = openai.pitch ?? 0;  }

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

        // Lazily create AudioContext
        if (!this._audioCtx) {
          this._audioCtx = new AudioContext();
        }
        if (this._audioCtx.state === 'suspended') {
          await this._audioCtx.resume();
        }

        // Stream MP3 via MediaSource so playback starts with the first chunks
        // instead of waiting for the entire file to download.
        const ms     = new MediaSource();
        const msUrl  = URL.createObjectURL(ms);
        this._blobUrl = msUrl;

        const audio = new Audio(msUrl);
        this._audio = audio;

        // Apply pitch shift via playbackRate (semitones → rate = 2^(n/12)).
        // preservesPitch=false lets rate affect pitch instead of tempo.
        if (this._pitch !== 0) {
          audio.playbackRate  = Math.pow(2, this._pitch / 12);
          audio.preservesPitch = false;
        }

        const webAudioSource = this._audioCtx.createMediaElementSource(audio);
        const analyser       = this._audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.4;
        const timeDomain = new Uint8Array(analyser.fftSize);

        webAudioSource.connect(analyser);
        analyser.connect(this._audioCtx.destination);

        let ended = false;

        const finish = () => {
          if (ended) return;
          ended = true;
          if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
          }
          URL.revokeObjectURL(msUrl);
          this._blobUrl = null;
          this._audio   = null;
          this._reader  = null;
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

        // Begin playback as soon as the browser has buffered enough
        audio.addEventListener('canplay', () => {
          audio.play()
            .then(() => poll())
            .catch((err) => { finish(); onError(err); });
        }, { once: true });

        // Feed MP3 chunks into the SourceBuffer as they arrive
        ms.addEventListener('sourceopen', async () => {
          let sb;
          try {
            sb = ms.addSourceBuffer('audio/mpeg');
          } catch (e) {
            onError(new Error(`MediaSource setup error: ${e.message}`));
            return;
          }

          const reader = response.body.getReader();
          this._reader = reader;

          const appendChunk = async () => {
            let result;
            try {
              result = await reader.read();
            } catch {
              // Reader was cancelled (stop() called) — ignore
              return;
            }

            if (result.done) {
              if (ms.readyState === 'open') ms.endOfStream();
              return;
            }

            // Wait for previous append to finish before adding the next chunk
            await new Promise((resolve, reject) => {
              sb.addEventListener('updateend', resolve, { once: true });
              sb.addEventListener('error',     reject,  { once: true });
              sb.appendBuffer(result.value);
            });

            appendChunk();
          };

          appendChunk().catch((e) => {
            if (!ended) onError(new Error(`Stream error: ${e.message}`));
          });
        });
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
    if (this._reader) {
      this._reader.cancel().catch(() => {});
      this._reader = null;
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
