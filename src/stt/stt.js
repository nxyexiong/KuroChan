/**
 * stt.js — Public STT interface + Voice Activity Detection.
 *
 * VAD state machine (runs in stt.js, service-agnostic):
 *
 *   idle  ──(RMS > voiceThreshold)──▶  speech  (accumulate chunks)
 *   speech ─(silence ≥ silenceDuration)─▶  processing  (send to service)
 *   processing ──(transcript)──▶  idle
 *
 * Events emitted on sttEvents:
 *   'transcript'  (text: string)
 *   'vad-state'   (state: 'idle'|'speech'|'processing')
 *   'error'       (err: Error)
 *   'start' / 'stop'
 */

import { WhisperSTTService } from './whisper-stt-service.js';
import { setStatus, hideStatusAfter } from '../ui.js';
import { input as llmInput } from '../llm/llm.js';

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

let service        = null;
let _vadThreshold  = 0.02;   // RMS level that counts as speech
let _vadSilenceMs  = 1500;   // ms of continuous silence that ends an utterance

/** STT event emitter. */
export const sttEvents = new EventEmitter();

// ── VAD helpers ───────────────────────────────────────────────────────────────

function computeRMS(chunk) {
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
  return Math.sqrt(sum / chunk.length);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Configure the underlying STT service and VAD parameters.
 * @param {{ service?: string, vad?: Object, whisper?: Object }} sttConfig
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

  const vad = sttConfig?.vad ?? {};
  if (vad.voiceThreshold  != null) _vadThreshold = Number(vad.voiceThreshold);
  if (vad.silenceDuration != null) _vadSilenceMs = Number(vad.silenceDuration);
}

/** Returns true if STT is configured and available. */
export function sttAvailable() {
  return service !== null;
}

/**
 * Start continuous VAD listening.
 * Emits 'start', then cycles 'vad-state' and 'transcript'/'error' automatically.
 */
export function startListening() {
  if (!service) {
    sttEvents.emit('error', new Error('STT is not configured. Add a Whisper model in Settings.'));
    return;
  }
  sttEvents.emit('start');

  // ── VAD state ─────────────────────────────────────────────────────────────
  let vadState        = 'idle';   // 'idle' | 'speech' | 'processing'
  let recordingChunks = [];
  let silenceStart    = null;

  function setVadState(s) {
    vadState = s;
    sttEvents.emit('vad-state', s);
  }

  service.startListening(
    // onChunk — called per AudioWorklet frame (~128 samples)
    (chunk) => {
      const rms = computeRMS(chunk);

      if (vadState === 'idle') {
        if (rms > _vadThreshold) {
          recordingChunks = [chunk.slice()];
          silenceStart    = null;
          setVadState('speech');
        }
      } else if (vadState === 'speech') {
        recordingChunks.push(chunk.slice());
        if (rms > _vadThreshold) {
          silenceStart = null;
        } else {
          if (silenceStart === null) {
            silenceStart = Date.now();
          } else if (Date.now() - silenceStart >= _vadSilenceMs) {
            const chunks    = recordingChunks;
            recordingChunks = [];
            silenceStart    = null;
            setVadState('processing');
            service.transcribe(chunks).then(
              (text) => { setVadState('idle'); if (text) { sttEvents.emit('transcript', text); llmInput(text); } },
              (err)  => { setVadState('idle'); sttEvents.emit('error', err); },
            );
          }
        }
      }
      // 'processing': discard chunks until transcription finishes
    },
    // onError
    (err) => sttEvents.emit('error', err),
  );
}

/**
 * Stop listening and tear down the mic.
 * Emits 'stop'.
 */
export function stopListening() {
  if (!service) return;
  sttEvents.emit('stop');
  service.stopListening();
}

/**
 * Mount the #btn-mic toggle button in the toolbar.
 * Must be called after configureSTT() and after the DOM is ready.
 */
export function initSTTButton() {
  const btn = document.getElementById('btn-mic');
  if (!btn) return;

  if (!sttAvailable()) {
    btn.style.display = 'none';
    return;
  }

  let sttOn = false;

  btn.addEventListener('click', () => {
    if (!sttOn) {
      sttOn = true;
      btn.classList.add('active');
      btn.title = 'Voice input (on — click to stop)';
      startListening();
    } else {
      sttOn = false;
      btn.classList.remove('active', 'speech');
      btn.title = 'Voice input (off)';
      stopListening();
    }
  });

  sttEvents.on('vad-state', (state) => {
    if (state === 'speech') {
      btn.classList.add('speech');
    } else {
      btn.classList.remove('speech');
    }
  });

  sttEvents.on('error', (err) => {
    setStatus(`⚠ STT: ${err.message}`);
    hideStatusAfter(6000);
    if (sttOn) {
      sttOn = false;
      btn.classList.remove('active', 'speech');
      btn.title = 'Voice input (off)';
      stopListening();
    }
  });
}
