/**
 * builtin-chat-service.js — Built-in chat service implementation.
 *
 * Receives user text from the renderer chat box and routes it through
 * the base ChatService pipeline (validate → stop TTS → LLM).
 */
const { ChatService } = require('./chat-service.js');

class BuiltinChatService extends ChatService {
  /**
   * Entry point for the renderer’s built-in chat box.
   * @param {string} text
   */
  handleBuiltinChatMessage(text) {
    this.handleUserMessage(text);
  }
}

module.exports = { BuiltinChatService };
