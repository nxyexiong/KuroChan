/**
 * llm.js — LLM facade. Runs in the main process.
 *
 * Selects the active LLM service and routes the single public output stream.
 * All business logic (history, memory, message composition, summarization)
 * lives in LLMService.
 */
const { OpenAILLMService }   = require('./openai-llm-service.js');
const { OpenClawLLMService } = require('./openclaw-llm-service.js');

const SERVICES = {
  'openai':   OpenAILLMService,
  'openclaw': OpenClawLLMService,
};
const DEFAULT_SERVICE = 'openai';

let service = new OpenAILLMService();

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
  const ServiceClass = SERVICES[key] || SERVICES[DEFAULT_SERVICE];
  service = new ServiceClass();
  service.configure(llmConfig);
}

function setMemory(entries)  { service.setMemory(entries); }
function clearHistory()      { service.clearHistory(); }
function summarizeSession()  { return service.summarizeSession(); }

/**
 * Send a user message from any source (chat UI, STT, etc.).
 * Output is routed through the registered output stream.
 * @param {string} text
 */
function input(text) {
  service.input(text, {
    onStart: () => { if (_onStart) _onStart(); },
    onData:  (chunk) => { if (_onData) _onData(chunk); },
    onEnd:   (reply) => { if (_onEnd) _onEnd(reply); },
    onError: (err)   => { if (_onError) _onError(err); },
  });
}

module.exports = { configureLLM, setMemory, setOutputStream, input, clearHistory, summarizeSession };
