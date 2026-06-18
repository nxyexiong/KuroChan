/**
 * xai-tts-service.js — xAI streaming TTS via WebSocket (main process).
 *
 * Connects to wss://api.x.ai/v1/tts, streams text deltas in as the LLM generates
 * them, and receives base64 PCM audio chunks back — a natively streaming
 * provider, so begin/push/end map directly onto the socket protocol.
 */
const { WebSocket } = require('ws');
const { TTSService } = require('./tts-service.js');

class XAITTSService extends TTSService {
  constructor() {
    super();
    this._apiKey   = '';
    this._voice    = 'ara';
    this._language = 'auto';
    this._audioFormat = 'pcm';
    this._ws       = null;
    this._wsReady  = false;
    this._pending  = [];     // text deltas queued before the socket opens
    this._endQueued = false; // end() arrived before the socket opened
  }

  _configure({ xai = {} } = {}) {
    const { apiKey, voice, language } = xai;
    if (apiKey   !== undefined && apiKey   !== '') this._apiKey   = apiKey;
    if (voice    !== undefined && voice    !== '') this._voice    = voice;
    if (language !== undefined && language !== '') this._language = language;
  }

  _validate() {
    return this._apiKey ? null : 'xAI TTS API key is not set. Add it in Settings.';
  }

  _beginImpl() {
    const gen = this._gen;
    this._wsReady   = false;
    this._pending   = [];
    this._endQueued = false;

    const params = new URLSearchParams({
      voice: this._voice, language: this._language, codec: 'pcm', sample_rate: '24000',
    });
    const ws = new WebSocket(`wss://api.x.ai/v1/tts?${params}`, {
      headers: { Authorization: `Bearer ${this._apiKey}` },
    });
    this._ws = ws;

    ws.on('open', () => {
      if (!this._isCurrent(gen)) { try { ws.close(); } catch { /* ignore */ } return; }
      this._wsReady = true;
      for (const t of this._pending) ws.send(JSON.stringify({ type: 'text.delta', delta: t }));
      this._pending = [];
      if (this._endQueued) ws.send(JSON.stringify({ type: 'text.done' }));
    });

    ws.on('message', (raw) => {
      if (!this._isCurrent(gen)) return;
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'audio.delta' && msg.delta) {
        this._emitChunk(Buffer.from(msg.delta, 'base64'));
      } else if (msg.type === 'audio.done') {
        this._emitEnd();
        try { ws.close(); } catch { /* ignore */ }
        if (this._ws === ws) this._ws = null;
      } else if (msg.type === 'error') {
        this._emitError(new Error(`xAI TTS error: ${msg.message}`));
        try { ws.close(); } catch { /* ignore */ }
        if (this._ws === ws) this._ws = null;
      }
    });

    ws.on('error', (err) => {
      if (this._isCurrent(gen)) this._emitError(err);
      if (this._ws === ws) this._ws = null;
    });
    ws.on('close', () => { if (this._ws === ws) this._ws = null; });
  }

  _pushImpl(text) {
    if (this._ws && this._wsReady) {
      this._ws.send(JSON.stringify({ type: 'text.delta', delta: text }));
    } else {
      this._pending.push(text); // flushed on 'open'
    }
  }

  _endImpl() {
    if (this._ws && this._wsReady) {
      this._ws.send(JSON.stringify({ type: 'text.done' }));
    } else {
      this._endQueued = true;   // sent after 'open'
    }
  }

  abort() {
    const ws = this._ws;
    this._ws = null;
    this._wsReady = false;
    this._pending = [];
    this._endQueued = false;
    if (ws) { try { ws.close(); } catch { /* ignore */ } }
  }
}

module.exports = { XAITTSService };
