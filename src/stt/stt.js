/**
 * stt.js — Public STT interface.
 *
 * Usage:
 *   import { configureSTT, startListening, stopListening, sttEvents } from './stt/stt.js';
 *
 *   configureSTT(config.stt);
 *
 *   sttEvents.on('transcript', (text) => console.log('[heard]', text));
 *   sttEvents.on('error',      (err)  => console.error(err));
 *   sttEvents.on('start',      ()     => console.log('[recording]'));
 *   sttEvents.on('stop',       ()     => console.log('[processing]'));
 *
 *   startListening();
 *   // ... user speaks ...
 *   stopListening();
 */

import { WhisperSTTService } from './whisper-stt-service.js';

const SERVICES = {
  'whisper-local': WhisperSTTService,
};
const DEFAULT_SERVICE = 'whisper-local';

// ── Minimal event emitter ─────────────────────────────────────────────────────

class EventEmitter {
  constructor() { this._listeners = {}; }

  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return this;
  }

  off(event, fn) {
    if (this._listeners[event])
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
    return this;
  }

  emit(event, ...args) {
    (this._listeners[event] ?? []).forEach(fn => fn(...args));
  }
}

// ── Module state ──────────────────────────────────────────────────────────────

let service = null;

/** STT event emitter — listen to 'transcript', 'start', 'stop', 'error'. */
export const sttEvents = new EventEmitter();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Configure the underlying STT service.
 * @param {{ service?: string, whisper?: Object }} sttConfig
 */
export function configureSTT(sttConfig) {
  const key = sttConfig?.service || DEFAULT_SERVICE;
  const ServiceClass = SERVICES[key];
  if (!ServiceClass) {
    console.warn(`STT: unknown service "${key}", STT disabled`);
    service = null;
    return;
  }
  service = new ServiceClass();
  service.configure(sttConfig);
}

/** Returns true if STT is configured and available. */
export function sttAvailable() {
  return service !== null;
}

/**
 * Start capturing microphone audio.
 * Emits 'start' immediately, then 'transcript' or 'error' when done.
 */
export function startListening() {
  if (!service) {
    sttEvents.emit('error', new Error('STT is not configured. Add a Whisper model in Settings.'));
    return;
  }
  sttEvents.emit('start');
  service.startListening(
    (text) => { if (text) sttEvents.emit('transcript', text); },
    (err)  => sttEvents.emit('error', err),
  );
}

/**
 * Stop capturing audio and trigger transcription.
 * Emits 'stop' immediately; 'transcript' or 'error' follows asynchronously.
 */
export function stopListening() {
  if (!service) return;
  sttEvents.emit('stop');
  service.stopListening();
}
