/**
 * openai-tts-service.js — OpenAI TTS (main process).
 *
 * OpenAI's speech endpoint is request/response (it needs the full input text),
 * so to still start speaking early this service splits the streamed reply into
 * sentences INTERNALLY: as complete sentences arrive via push(), each is sent as
 * its own /audio/speech request and its AAC (ADTS) bytes are streamed to the
 * renderer in order. The first sentence is synthesized as soon as it completes,
 * rather than waiting for the whole reply.
 */
const { TTSService } = require('./tts-service.js');

const OPENAI_TTS_ENDPOINT = 'https://api.openai.com/v1/audio/speech';

// Matches a run of text ending at a sentence terminator (or newline).
const SENTENCE_RE = /[^.!?…。！？\n]*[.!?…。！？\n]+/g;

class OpenAITTSService extends TTSService {
  constructor() {
    super();
    this._apiKey = '';
    this._model  = 'tts-1';
    this._voice  = 'alloy';
    this._speed  = 1.0;
    this._audioFormat = 'aac';

    this._buffer      = '';
    this._chain       = Promise.resolve(); // sequential synthesis chain (keeps audio ordered)
    this._pending     = 0;                 // sentences queued or synthesizing
    this._ended       = false;
    this._controllers = new Set();
    this._utterGen    = 0;
  }

  _configure({ openai = {} } = {}) {
    const { apiKey, model, voice, speed } = openai;
    if (apiKey !== undefined && apiKey !== '') this._apiKey = apiKey;
    if (model  !== undefined && model  !== '') this._model  = model;
    if (voice  !== undefined && voice  !== '') this._voice  = voice;
    if (speed  !== undefined)                  this._speed  = speed;
  }

  _validate() {
    return this._apiKey ? null : 'OpenAI TTS API key is not set. Add it in Settings.';
  }

  _beginImpl() {
    this._buffer  = '';
    this._chain   = Promise.resolve();
    this._pending = 0;
    this._ended   = false;
    this._utterGen = this._gen;
  }

  _pushImpl(text) {
    this._buffer += text;
    this._drain(false);
  }

  _endImpl() {
    this._ended = true;
    this._drain(true);
  }

  /** Extract complete sentences (plus the remainder when final) and enqueue them. */
  _drain(final) {
    const sentences = [];
    let lastIndex = 0;
    let m;
    SENTENCE_RE.lastIndex = 0;
    while ((m = SENTENCE_RE.exec(this._buffer))) {
      const s = m[0].trim();
      if (s) sentences.push(s);
      lastIndex = SENTENCE_RE.lastIndex;
    }
    this._buffer = lastIndex > 0 ? this._buffer.slice(lastIndex) : this._buffer;
    if (final) {
      const rest = this._buffer.trim();
      this._buffer = '';
      if (rest) sentences.push(rest);
    }

    for (const s of sentences) this._enqueue(s);
    if (final && this._pending === 0) this._finish();
  }

  _enqueue(sentence) {
    const gen = this._utterGen;
    this._pending++;
    this._chain = this._chain
      .then(() => (this._isCurrent(gen) ? this._synthOne(sentence, gen) : null))
      .then(() => {
        this._pending--;
        if (this._isCurrent(gen) && this._ended && this._pending === 0) this._finish();
      });
  }

  _finish() {
    this._emitEnd();
  }

  async _synthOne(sentence, gen) {
    const controller = new AbortController();
    this._controllers.add(controller);
    try {
      const response = await fetch(OPENAI_TTS_ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${this._apiKey}`,
        },
        body: JSON.stringify({
          model: this._model, input: sentence, voice: this._voice,
          speed: this._speed, response_format: 'aac',
        }),
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(`OpenAI TTS error ${response.status}: ${errBody?.error?.message || response.statusText}`);
      }
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!this._isCurrent(gen)) break;
        this._emitChunk(Buffer.from(value));
      }
    } catch (err) {
      if (err.name !== 'AbortError' && this._isCurrent(gen)) {
        this._emitError(err);
        this.abort();
      }
    } finally {
      this._controllers.delete(controller);
    }
  }

  abort() {
    for (const c of this._controllers) { try { c.abort(); } catch { /* ignore */ } }
    this._controllers.clear();
    this._buffer  = '';
    this._chain   = Promise.resolve();
    this._pending = 0;
    this._ended   = false;
  }
}

module.exports = { OpenAITTSService };
