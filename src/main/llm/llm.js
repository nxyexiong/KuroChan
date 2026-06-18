/**
 * llm.js — LLM facade (main process). KuroChan uses GitHub Copilot only.
 *
 * Owns the single public output stream and delegates to the Copilot service.
 */
const { CopilotLLMService } = require('./copilot-llm-service.js');

let service = new CopilotLLMService();

// Main-process dependencies injected into the service (Copilot session-id
// persistence). Re-applied whenever a new service instance is created.
let _deps = {};

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

function configureLLM(llmConfig, deps) {
  if (deps) _deps = deps;
  // Stop the previous service's resources (the spawned Copilot CLI) before
  // replacing it, so reconfiguring doesn't leak processes.
  if (service && typeof service.dispose === 'function') { service.dispose(); }
  service = new CopilotLLMService();
  if (typeof service.setDeps === 'function') service.setDeps(_deps);
  service.configure(llmConfig || {});
}

/** Reset the Copilot conversation. Returns the new session id or null. */
function resetCopilotSession() {
  return (service && typeof service.resetSession === 'function') ? service.resetSession() : Promise.resolve(null);
}

/** Stop the active service's resources (e.g. on app quit). */
function disposeLLM() {
  return (service && typeof service.dispose === 'function') ? service.dispose() : Promise.resolve();
}

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

/** Abort the in-flight LLM turn (barge-in). Safe to call when idle. */
function abort() {
  if (service && typeof service.abort === 'function') service.abort();
}

module.exports = { configureLLM, setOutputStream, input, abort, resetCopilotSession, disposeLLM };
