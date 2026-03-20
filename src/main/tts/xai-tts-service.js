/**
 * xai-tts-service.js — xAI streaming TTS via WebSocket (main process).
 * Connects to wss://api.x.ai/v1/tts, sends text deltas, receives
 * base64-encoded PCM audio chunks, and returns a Readable stream.
 */
const { Readable } = require('stream');
const { WebSocket } = require('ws');
const { TTSService } = require('./tts-service.js');

class XAITTSService extends TTSService {
  constructor() {
    super();
    this._apiKey    = '';
    this._voice     = 'ara';
    this._language  = 'auto';
    this._ws        = null;
    this._audioFormat = 'pcm';
  }

  _configure({ xai = {} } = {}) {
    const { apiKey, voice, language } = xai;
    if (apiKey   !== undefined && apiKey   !== '') this._apiKey   = apiKey;
    if (voice    !== undefined && voice    !== '') this._voice    = voice;
    if (language !== undefined && language !== '') this._language = language;
  }

  /**
   * Open a WebSocket to xAI TTS, stream text in, and return a Readable
   * that emits decoded PCM audio chunks.
   * @param {string} text
   * @returns {Readable}
   */
  streamAudio(text) {
    if (!this._apiKey) throw new Error('xAI TTS API key is not set. Add it in Settings.');

    const output = new Readable({ read() {} });

    const params = new URLSearchParams({
      voice:       this._voice,
      language:    this._language,
      codec:       'pcm',
      sample_rate: '24000',
    });

    const ws = new WebSocket(`wss://api.x.ai/v1/tts?${params}`, {
      headers: { Authorization: `Bearer ${this._apiKey}` },
    });
    this._ws = ws;

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'text.delta', delta: text }));
      ws.send(JSON.stringify({ type: 'text.done' }));
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'audio.delta' && msg.delta) {
        output.push(Buffer.from(msg.delta, 'base64'));
      } else if (msg.type === 'audio.done') {
        output.push(null);
        ws.close();
        this._ws = null;
      } else if (msg.type === 'error') {
        output.destroy(new Error(`xAI TTS error: ${msg.message}`));
        ws.close();
        this._ws = null;
      }
    });

    ws.on('error', (err) => {
      if (!output.destroyed) output.destroy(err);
      this._ws = null;
    });

    ws.on('close', () => {
      if (!output.destroyed && output.readable) output.push(null);
      this._ws = null;
    });

    return output;
  }

  abort() {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }
}

module.exports = { XAITTSService };
