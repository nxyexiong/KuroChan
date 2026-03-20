/**
 * chat-service.js — Base class for chat backend services.
 *
 * Owns shared logic: validates input, stops TTS, and forwards to the LLM.
 * Subclasses provide their own entry point (e.g. renderer chat box, Discord)
 * and call handleUserMessage() to send messages through the pipeline.
 */
const { input: llmInput } = require('../llm/llm.js');
const { stopTTS }         = require('../tts/tts.js');

class ChatService {
  /**
   * Shared pipeline: validate, stop TTS, send to LLM.
   * Called by subclass-specific entry points.
   * @param {string} text
   */
  handleUserMessage(text) {
    if (!text || !text.trim()) return;
    stopTTS();
    llmInput(text.trim());
  }
}

module.exports = { ChatService };
