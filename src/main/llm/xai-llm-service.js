/**
 * xai-llm-service.js — xAI Chat Completions (streaming SSE) via Node fetch.
 */
const { LLMService } = require('./llm-service.js');

const XAI_ENDPOINT = 'https://api.x.ai/v1/chat/completions';

class XAILLMService extends LLMService {
  constructor() {
    super();
    this._apiKey = '';
    this._model  = 'grok-4-1-fast-non-reasoning';
  }

  _configure({ xai = {} } = {}) {
    if (xai.apiKey) this._apiKey = xai.apiKey;
    if (xai.model)  this._model  = xai.model;
  }

  stream(messages, onChunk, onDone, onError) {
    if (!this._apiKey) {
      onError(new Error('xAI API key is not set. Add it in Settings.'));
      return;
    }

    fetch(XAI_ENDPOINT, {
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
          onError(new Error(`xAI API error ${response.status}: ${msg}`));
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

module.exports = { XAILLMService };
