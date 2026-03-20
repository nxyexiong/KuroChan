/**
 * openai-llm-service.js — OpenAI Chat Completions (streaming SSE) via Node fetch.
 */
const { LLMService } = require('./llm-service.js');

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

class OpenAILLMService extends LLMService {
  constructor() {
    super();
    this._apiKey = '';
    this._model  = 'gpt-4o';
  }

  configure({ openai = {} } = {}) {
    if (openai.apiKey) this._apiKey = openai.apiKey;
    if (openai.model)  this._model  = openai.model;
  }

  stream(messages, onChunk, onDone, onError) {
    if (!this._apiKey) {
      onError(new Error('OpenAI API key is not set. Add it in Settings.'));
      return;
    }

    fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify({ model: this._model, messages, stream: true }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          const msg = errBody?.error?.message || response.statusText;
          onError(new Error(`OpenAI API error ${response.status}: ${msg}`));
          return;
        }

        const reader  = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let   buffer  = '';

        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data: ')) continue;
              const data = trimmed.slice(6);
              if (data === '[DONE]') { onDone(); return; }
              try {
                const chunk = JSON.parse(data).choices?.[0]?.delta?.content;
                if (chunk) onChunk(chunk);
              } catch { /* skip */ }
            }
          }
          onDone();
        };
        pump().catch(onError);
      })
      .catch(onError);
  }
}

module.exports = { OpenAILLMService };
