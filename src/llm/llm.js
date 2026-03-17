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

/** Conversation history — array of { role, content } objects. */
let history = [];

/** System prompt derived from the character config field. */
let systemPrompt = '';

/** Past memory entries loaded from memory.json. */
let memoryEntries = [];

/** Output stream — listen to 'data', 'end', and 'error' events. */
export const outputStream = new OutputStream();

/** Monotonic counter — incremented on every input() call to cancel previous streams. */
let _callId = 0;

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
  systemPrompt = llmConfig?.character || '';
  history = [];
}

/**
 * Load past memory entries to be included as context.
 * @param {Array<{timestamp: string, memory: string}>} entries
 */
export function setMemory(entries) {
  memoryEntries = Array.isArray(entries) ? entries : [];
}

/**
 * Send a text message to the LLM.
 * The message is appended to history; the assistant reply is collected and
 * appended once the stream completes.
 * Emits 'data' for each streamed chunk, 'end' on completion, 'error' on failure.
 * @param {string} text
 */
export function input(text) {
  const myId = ++_callId;
  outputStream.emit('start');
  history.push({ role: 'user', content: text });

  // Build system prompt: character + past memories
  let fullSystem = systemPrompt;
  if (memoryEntries.length > 0) {
    const memoriesText = memoryEntries
      .map(e => `[${e.timestamp}]: ${e.memory}`)
      .join('\n');
    fullSystem = (fullSystem ? fullSystem + '\n\n' : '') +
      '## Memories from past sessions:\n' + memoriesText;
  }

  // Build messages: prepend system prompt if configured
  const messages = fullSystem
    ? [{ role: 'system', content: fullSystem }, ...history]
    : history;

  let assistantReply = '';

  service.stream(
    messages,
    (chunk) => {
      if (_callId !== myId) return;
      assistantReply += chunk;
      outputStream.emit('data', chunk);
    },
    () => {
      if (_callId !== myId) return;
      if (assistantReply) {
        history.push({ role: 'assistant', content: assistantReply });
      }
      outputStream.emit('end');
    },
    (err) => {
      if (_callId !== myId) return;
      // Remove the user message that failed so history stays consistent
      history.pop();
      outputStream.emit('error', err);
    },
  );
}

/**
 * Clear the conversation history.
 */
export function clearHistory() {
  history = [];
}

/**
 * Ask the LLM to summarize the current session.
 * Returns a Promise<string|null> — null if history is empty or LLM fails.
 * Does not affect conversation history or emit on outputStream.
 */
export function summarizeSession() {
  return new Promise((resolve) => {
    if (history.length === 0) {
      resolve(null);
      return;
    }
    const transcript = history
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
    const summaryMessages = [
      {
        role: 'user',
        content: 'Summarize the following conversation in a few sentences, capturing key topics, decisions, and facts that would be useful to remember for future sessions:\n\n' + transcript,
      },
    ];
    let summary = '';
    service.stream(
      summaryMessages,
      (chunk) => { summary += chunk; },
      () => resolve(summary.trim() || null),
      () => resolve(null),
    );
  });
}
