/**
 * openai-tts-service.js — OpenAI TTS (main process).
 * Fetches MP3 audio from OpenAI, transcodes to AAC via ffmpeg,
 * and returns a Readable stream of AAC data for chunked playback.
 */
const { spawn } = require('child_process');
const { Readable } = require('stream');
const ffmpegPath = require('ffmpeg-static');

const OPENAI_TTS_ENDPOINT = 'https://api.openai.com/v1/audio/speech';

class OpenAITTSService {
  constructor() {
    this._apiKey = '';
    this._model  = 'tts-1';
    this._voice  = 'alloy';
    this._speed  = 1.0;
    this._controller = null;
    this._ffmpeg = null;
  }

  configure({ openai = {} } = {}) {
    const { apiKey, model, voice, speed } = openai;
    if (apiKey !== undefined && apiKey !== '') this._apiKey = apiKey;
    if (model  !== undefined && model  !== '') this._model  = model;
    if (voice  !== undefined && voice  !== '') this._voice  = voice;
    if (speed  !== undefined)                  this._speed  = speed;
  }

  /**
   * Fetch audio from OpenAI and return a Readable stream of AAC data.
   * The MP3 response is piped through ffmpeg for real-time transcoding.
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
        response_format: 'mp3',
      }),
    }).then(async (response) => {
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const msg = errBody?.error?.message || response.statusText;
        output.destroy(new Error(`OpenAI TTS error ${response.status}: ${msg}`));
        return;
      }

      // Spawn ffmpeg: MP3 stdin → AAC (ADTS framed) stdout
      // -movflags empty_moov is not needed for ADTS; adts muxer produces
      // self-contained frames that MediaSource can consume immediately.
      this._ffmpeg = spawn(ffmpegPath, [
        '-i', 'pipe:0',          // read MP3 from stdin
        '-c:a', 'aac',           // encode to AAC
        '-b:a', '128k',          // bitrate
        '-f', 'adts',            // ADTS framing (streamable AAC)
        'pipe:1',                // write to stdout
      ], { stdio: ['pipe', 'pipe', 'ignore'] });

      this._ffmpeg.stdout.on('data', (chunk) => {
        output.push(chunk);
      });

      this._ffmpeg.stdout.on('end', () => {
        output.push(null);  // signal stream end
      });

      this._ffmpeg.on('error', (err) => {
        output.destroy(err);
      });

      this._ffmpeg.on('close', (code) => {
        if (code !== 0 && !output.destroyed) {
          output.destroy(new Error(`ffmpeg exited with code ${code}`));
        }
        this._ffmpeg = null;
      });

      // Pipe the HTTP response body into ffmpeg's stdin
      const reader = response.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            this._ffmpeg?.stdin.end();
            break;
          }
          if (this._ffmpeg?.stdin.writable) {
            this._ffmpeg.stdin.write(Buffer.from(value));
          }
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
    if (this._ffmpeg) {
      this._ffmpeg.kill('SIGTERM');
      this._ffmpeg = null;
    }
  }
}

module.exports = { OpenAITTSService };
