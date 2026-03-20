/**
 * llm-service.js — Base class for LLM backend services.
 *
 * Owns all backend-agnostic logic: conversation history, system prompt,
 * memory injection, message composition, input routing, and summarization.
 * Subclasses implement only _configure(config) and stream(messages, ...).
 */
class LLMService {
  constructor() {
    this._history      = [];
    this._systemPrompt = '';
    this._memoryEntries = [];
    this._callId       = 0;
  }

  /**
   * Configure shared state then delegate to subclass.
   * Called by the facade whenever settings change.
   */
  configure(llmConfig) {
    this._systemPrompt = llmConfig?.character || '';
    this._history      = [];
    this._configure(llmConfig);
  }

  /** Override in subclasses to handle backend-specific config. */
  _configure(config) {}

  setMemory(entries) {
    this._memoryEntries = Array.isArray(entries) ? entries : [];
  }

  /**
   * Send a user message and stream the reply.
   * @param {string} text
   * @param {{ onStart, onData, onEnd, onError }} handlers
   */
  input(text, { onStart, onData, onEnd, onError } = {}) {
    const myId = ++this._callId;
    this._history.push({ role: 'user', content: text });

    let fullSystem = this._systemPrompt;
    if (this._memoryEntries.length > 0) {
      const memoriesText = this._memoryEntries.map(e => `[${e.timestamp}]: ${e.memory}`).join('\n');
      fullSystem = (fullSystem ? fullSystem + '\n\n' : '') + '## Memories from past sessions:\n' + memoriesText;
    }

    const messages = fullSystem
      ? [{ role: 'system', content: fullSystem }, ...this._history]
      : this._history;

    let assistantReply = '';

    if (onStart) onStart();

    this.stream(
      messages,
      (chunk) => {
        if (this._callId !== myId) return;
        assistantReply += chunk;
        if (onData) onData(chunk);
      },
      () => {
        if (this._callId !== myId) return;
        if (assistantReply) this._history.push({ role: 'assistant', content: assistantReply });
        if (onEnd) onEnd(assistantReply);
      },
      (err) => {
        if (this._callId !== myId) return;
        this._history.pop();
        if (onError) onError(err);
      },
    );
  }

  clearHistory() {
    this._history = [];
  }

  summarizeSession() {
    return new Promise((resolve) => {
      if (this._history.length === 0) { resolve(null); return; }
      const transcript = this._history
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');
      const summaryMessages = [{
        role: 'user',
        content: 'Summarize the following conversation in a few sentences, capturing key topics, decisions, and facts that would be useful to remember for future sessions:\n\n' + transcript,
      }];
      let summary = '';
      this.stream(summaryMessages, (c) => { summary += c; }, () => resolve(summary.trim() || null), () => resolve(null));
    });
  }

  /** Must be implemented by subclasses. */
  stream(messages, onChunk, onDone, onError) { throw new Error('LLMService.stream() must be implemented'); }
}

module.exports = { LLMService };
