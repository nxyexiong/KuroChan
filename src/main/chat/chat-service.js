/**
 * chat-service.js — Chat input handler. Runs in main process.
 *
 * Thin forwarder: receives user text from renderer and feeds it to the LLM.
 * Does NOT handle output streaming or TTS — the LLM's registered output
 * stream (wired in index.js) handles that for all input sources uniformly.
 */
const { input: llmInput, summarizeSession } = require('../llm/llm.js');
const { stopTTS } = require('../tts/tts.js');

/**
 * Handle user text from the renderer chat UI.
 */
function handleUserMessage(text) {
  if (!text || !text.trim()) return;
  stopTTS();
  llmInput(text.trim());
}

/**
 * Summarize session and save memory entry. Called before closing.
 * @returns {Promise<string|null>}
 */
async function handleSummarize() {
  return summarizeSession();
}

module.exports = { handleUserMessage, handleSummarize };
