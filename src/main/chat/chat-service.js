/**
 * chat-service.js — Base class for chat backend services.
 *
 * Owns shared logic: validates input, stops TTS, and forwards to the LLM.
 * Subclasses provide their own entry point (e.g. renderer chat box, Discord)
 * and call handleUserMessage() to send messages through the pipeline.
 */
const { input: llmInput, abort: abortLLM } = require('../llm/llm.js');
const { stopTTS }         = require('../tts/tts.js');

class ChatService {
  /**
   * Shared pipeline: validate, abort any in-flight turn + TTS, send to LLM.
   * Called by subclass-specific entry points.
   * @param {string} text
   */
  handleUserMessage(text) {
    if (!text || !text.trim()) return;
    abortLLM();   // barge-in: a new typed message supersedes the current turn
    stopTTS();
    llmInput(text.trim());
  }
}

module.exports = { ChatService };
