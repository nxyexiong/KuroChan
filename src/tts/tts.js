/**
 * tts.js — Public TTS interface.
 *
 * Usage:
 *   import { configureTTS, speak, stopTTS, ttsEvents } from './tts/tts.js';
 *
 *   // Once config is loaded (call before using speak()):
 *   configureTTS(config.tts);
 *
 *   // Listen to events:
 *   ttsEvents.on('end',   ()    => console.log('[speech done]'));
 *   ttsEvents.on('error', (err) => console.error(err));
 *
 *   // Speak text:
 *   speak('Hello!');
 *
 *   // Stop mid-speech:
 *   stopTTS();
 */

import { OpenAITTSService } from './openai-tts-service.js';

const SERVICES = {
  'openai-tts': OpenAITTSService,
};
const DEFAULT_SERVICE = 'openai-tts';

// ── Minimal event emitter ─────────────────────────────────────────────────────

class EventEmitter {
  constructor() {
    this._listeners = {};
  }

  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return this;
  }

  off(event, fn) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
    }
    return this;
  }

  emit(event, ...args) {
    (this._listeners[event] ?? []).forEach(fn => fn(...args));
  }
}

// ── Module state ──────────────────────────────────────────────────────────────

let service = new OpenAITTSService();

/** TTS event emitter — listen to 'end' and 'error' events. */
export const ttsEvents = new EventEmitter();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Configure the underlying TTS service.
 * Selects the active service from ttsConfig.service, then passes the full
 * ttsConfig opaquely to the service's configure() method.
 * @param {{ service?: string, windows?: Object }} ttsConfig
 */
export function configureTTS(ttsConfig) {
  const key = ttsConfig?.service || DEFAULT_SERVICE;
  const ServiceClass = SERVICES[key];
  if (!ServiceClass) {
    console.warn(`TTS: unknown service "${key}", falling back to "${DEFAULT_SERVICE}"`);
    service = new SERVICES[DEFAULT_SERVICE]();
  } else {
    service = new ServiceClass();
  }
  service.configure(ttsConfig);
}

/**
 * Speak the given text.
 * Emits 'end' on completion, 'error' on failure.
 * @param {string} text
 */
export function speak(text) {
  ttsEvents.emit('start');
  service.speak(
    text,
    ()      => ttsEvents.emit('end'),
    (err)   => ttsEvents.emit('error', err),
    (vol)   => ttsEvents.emit('volume', vol),
  );
}

/**
 * Stop any ongoing speech immediately.
 */
export function stopTTS() {
  service.stop();
}
