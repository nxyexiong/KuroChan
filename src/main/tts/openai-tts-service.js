/**
 * openai-tts-service.js — OpenAI TTS (main process).
 * Fetches AAC audio directly from OpenAI and returns a Readable stream
 * of AAC (ADTS) data for chunked playback — no transcoding required.
 */
const { Readable } = require('stream');
const { TTSService } = require('./tts-service.js');

const OPENAI_TTS_ENDPOINT = 'https://api.openai.com/v1/audio/speech';

class OpenAITTSService extends TTSService {
  constructor() {
    super();
    this._apiKey = '';
    this._model  = 'tts-1';
    this._voice  = 'alloy';
    this._speed  = 1.0;
    this._controller = null;
  }

  _configure({ openai = {} } = {}) {
    const { apiKey, model, voice, speed } = openai;
    if (apiKey !== undefined && apiKey !== '') this._apiKey = apiKey;
    if (model  !== undefined && model  !== '') this._model  = model;
    if (voice  !== undefined && voice  !== '') this._voice  = voice;
    if (speed  !== undefined)                  this._speed  = speed;
  }

  /**
   * Fetch AAC audio from OpenAI and return a Readable stream.
   * OpenAI returns AAC in ADTS framing when response_format is 'aac',
   * so no transcoding is needed.
   * @param {string} text
   * @returns {Readable}  AAC byte stream
   */
  streamAudio(text) {
    if (!this._apiKey) throw new Error('OpenAI TTS API key is not set. Add it in Settings.');

    // Create a passthrough Readable that we'll push AAC chunks into
    const output = new Readable({ read() {} });

    this._controller = new AbortController();

    fetch(OPENAI_TTS_ENDPOINT, {
      method: 'POST',
      signal: this._controller.signal,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify({
        model:           this._model,
        input:           text,
        voice:           this._voice,
        speed:           this._speed,
        response_format: 'aac',
      }),
    }).then(async (response) => {
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const msg = errBody?.error?.message || response.statusText;
        output.destroy(new Error(`OpenAI TTS error ${response.status}: ${msg}`));
        return;
      }

      // Stream AAC bytes directly — no transcoding needed
      const reader = response.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            output.push(null);  // signal stream end
            break;
          }
          output.push(Buffer.from(value));
        }
      };
      pump().catch((err) => {
        if (!output.destroyed) output.destroy(err);
      });

    }).catch((err) => {
      if (err.name !== 'AbortError') {
        output.destroy(err);
      }
    });

    return output;
  }

  abort() {
    if (this._controller) {
      this._controller.abort();
      this._controller = null;
    }
  }
}

module.exports = { OpenAITTSService };
