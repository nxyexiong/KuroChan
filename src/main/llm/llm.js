/**
 * llm.js — LLM facade. Runs in the main process.
 *
 * Accepts input from multiple sources (chat UI, STT) and routes all output
 * through a single registered output stream. No renderer access.
 */
const { OpenAILLMService }   = require('./openai-llm-service.js');
const { OpenClawLLMService } = require('./openclaw-llm-service.js');

const SERVICES = {
  'openai':   OpenAILLMService,
  'openclaw': OpenClawLLMService,
};
const DEFAULT_SERVICE = 'openai';

let service = new OpenAILLMService();
let history = [];
let systemPrompt = '';
let memoryEntries = [];
let _callId = 0;

// ── Registered output stream handlers ─────────────────────────────────────────
let _onStart = null;
let _onData  = null;
let _onEnd   = null;
let _onError = null;

/**
 * Register the single public output stream.
 * All calls to input() route output through these handlers.
 */
function setOutputStream({ onStart, onData, onEnd, onError }) {
  _onStart = onStart || null;
  _onData  = onData  || null;
  _onEnd   = onEnd   || null;
  _onError = onError || null;
}

function configureLLM(llmConfig) {
  const key = llmConfig?.service || DEFAULT_SERVICE;
  const ServiceClass = SERVICES[key];
  if (!ServiceClass) { service = new SERVICES[DEFAULT_SERVICE](); }
  else { service = new ServiceClass(); }
  service.configure(llmConfig);
  systemPrompt = llmConfig?.character || '';
  history = [];
}

function setMemory(entries) {
  memoryEntries = Array.isArray(entries) ? entries : [];
}

/**
 * Send a user message from any source (chat UI, STT, etc.).
 * Output is routed through the registered output stream.
 * @param {string} text
 */
function input(text) {
  const myId = ++_callId;
  history.push({ role: 'user', content: text });

  let fullSystem = systemPrompt;
  if (memoryEntries.length > 0) {
    const memoriesText = memoryEntries.map(e => `[${e.timestamp}]: ${e.memory}`).join('\n');
    fullSystem = (fullSystem ? fullSystem + '\n\n' : '') + '## Memories from past sessions:\n' + memoriesText;
  }

  const messages = fullSystem
    ? [{ role: 'system', content: fullSystem }, ...history]
    : history;

  let assistantReply = '';

  if (_onStart) _onStart();

  service.stream(
    messages,
    (chunk) => {
      if (_callId !== myId) return;
      assistantReply += chunk;
      if (_onData) _onData(chunk);
    },
    () => {
      if (_callId !== myId) return;
      if (assistantReply) history.push({ role: 'assistant', content: assistantReply });
      if (_onEnd) _onEnd(assistantReply);
    },
    (err) => {
      if (_callId !== myId) return;
      history.pop();
      if (_onError) _onError(err);
    },
  );
}

function clearHistory() { history = []; }

function summarizeSession() {
  return new Promise((resolve) => {
    if (history.length === 0) { resolve(null); return; }
    const transcript = history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const summaryMessages = [{
      role: 'user',
      content: 'Summarize the following conversation in a few sentences, capturing key topics, decisions, and facts that would be useful to remember for future sessions:\n\n' + transcript,
    }];
    let summary = '';
    service.stream(summaryMessages, (c) => { summary += c; }, () => resolve(summary.trim() || null), () => resolve(null));
  });
}

module.exports = { configureLLM, setMemory, setOutputStream, input, clearHistory, summarizeSession };
