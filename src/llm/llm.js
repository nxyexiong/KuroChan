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

const service = new OpenAILLMService();

/** Output stream — listen to 'data', 'end', and 'error' events. */
export const outputStream = new OutputStream();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Configure the underlying LLM service.
 * Must be called before the first `input()` call.
 * Receives the textCompletion section of config directly.
 * @param {{ apiKey: string, model?: string }} textCompletionConfig
 */
export function configureLLM(textCompletionConfig) {
  service.configure(textCompletionConfig);
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
