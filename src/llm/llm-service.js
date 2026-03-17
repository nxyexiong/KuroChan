/**
 * llm-service.js — Abstract interface for LLM backend services.
 * Subclass this to add support for different LLM providers.
 */
export class LLMService {
  /**
   * Configure the service (e.g. API key, model, etc.)
   * @param {Object} config
   */
  configure(config) {
    throw new Error('LLMService.configure() must be implemented');
  }

  /**
   * Stream a response for the given conversation history.
   * @param {{ role: string, content: string }[]} messages  full conversation history
   * @param {(chunk: string) => void} onChunk  called for each streamed text chunk
   * @param {() => void} onDone                called when the stream ends
   * @param {(err: Error) => void} onError     called on error
   * @returns {void}
   */
  stream(messages, onChunk, onDone, onError) {
    throw new Error('LLMService.stream() must be implemented');
  }
}
