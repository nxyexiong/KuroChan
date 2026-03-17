/**
 * llm.js — Public LLM interface.
 *
 * Usage:
 *   import { configureLLM, input, outputStream } from './llm/llm.js';
 *
 *   // Once config is loaded (call before using input()):
 *   configureLLM({ apiKey: config.openaiApiKey });
 *
 *   // Listen to streamed output:
 *   outputStream.on('data',  (chunk) => console.log(chunk));
 *   outputStream.on('end',   ()      => console.log('[done]'));
 *   outputStream.on('error', (err)   => console.error(err));
 *
 *   // Send a message:
 *   input('Hello!');
 */

import { OpenAILLMService } from './openai-llm-service.js';
const SERVICES = {
  'openai': OpenAILLMService,
};
const DEFAULT_SERVICE = 'openai';
// ── Minimal event emitter used as the output stream ───────────────────────────

class OutputStream {
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

let service = new OpenAILLMService();

/** Output stream — listen to 'data', 'end', and 'error' events. */
export const outputStream = new OutputStream();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Configure the underlying LLM service.
 * Selects the active service from llmConfig.service, then passes the full
 * llmConfig opaquely to the service's configure() method.
 * @param {{ service?: string, openai?: Object }} llmConfig
 */
export function configureLLM(llmConfig) {
  const key = llmConfig?.service || DEFAULT_SERVICE;
  const ServiceClass = SERVICES[key];
  if (!ServiceClass) {
    console.warn(`LLM: unknown service "${key}", falling back to "${DEFAULT_SERVICE}"`);
    service = new SERVICES[DEFAULT_SERVICE]();
  } else {
    service = new ServiceClass();
  }
  service.configure(llmConfig);
}

/**
 * Send a text message to the LLM.
 * Emits 'data' for each streamed chunk, 'end' on completion, 'error' on failure.
 * @param {string} text
 */
export function input(text) {
  service.stream(
    text,
    (chunk) => outputStream.emit('data', chunk),
    ()      => outputStream.emit('end'),
    (err)   => outputStream.emit('error', err),
  );
}
