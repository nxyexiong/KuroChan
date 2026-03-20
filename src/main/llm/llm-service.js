/**
 * llm-service.js — Abstract interface for LLM backend services.
 */
class LLMService {
  configure(config) { throw new Error('LLMService.configure() must be implemented'); }
  stream(messages, onChunk, onDone, onError) { throw new Error('LLMService.stream() must be implemented'); }
}

module.exports = { LLMService };
