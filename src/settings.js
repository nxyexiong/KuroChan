/**
 * settings.js — injects the settings modal into the DOM and handles its logic
 */

const DEFAULTS = {
  model: {
    modelDir: 'assets/models/Haru',
  },
  llm: {
    service: 'openai',
    character: 'You are kuro-chan, a friendly anime-style assistant.',
    openai: {
      model: 'gpt-5-mini',
    },
  },
  tts: {
    service: 'openai-tts',
    openai: {
      model: 'gpt-4o-mini-tts',
      voice: 'sage',
      speed: 1,
    },
  },
};

const MODAL_HTML = `
<div id="settings-modal" class="modal-overlay hidden">
  <div class="modal">
    <h3>Settings</h3>
    <div class="modal-body">

    <details class="settings-section" open>
      <summary class="settings-section-title">Model</summary>
      <div class="settings-section-body">
      <label for="model-dir-input">Model folder</label>
      <div class="input-row">
        <input type="text" id="model-dir-input" placeholder="default: assets/models/Haru" />
        <button class="btn-modal" id="btn-browse">Browse…</button>
      </div>
      </div>
    </details>

    <details class="settings-section" open>
      <summary class="settings-section-title">LLM</summary>
      <div class="settings-section-body">
      <label for="llm-service-select">Service</label>
      <div class="input-row">
        <select id="llm-service-select">
          <option value="">— none —</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>
      <details class="settings-subsection" open>
        <summary class="settings-subsection-title">Character</summary>
        <div class="settings-subsection-body">
        <div class="input-row">
          <textarea id="llm-character-input" rows="4" placeholder="default: You are kuro-chan, a friendly anime-style assistant."></textarea>
        </div>
        </div>
      </details>
      <details class="settings-subsection" open>
        <summary class="settings-subsection-title">OpenAI</summary>
        <div class="settings-subsection-body">
        <label for="llm-openai-api-key-input">API key</label>
        <div class="input-row">
          <input type="password" id="llm-openai-api-key-input" placeholder="sk-…" autocomplete="off" />
        </div>
        <label for="llm-openai-model-input">Model name</label>
        <div class="input-row">
          <input type="text" id="llm-openai-model-input" placeholder="default: gpt-5-mini" />
        </div>
        </div>
      </details>
      </div>
    </details>

      <details class="settings-section" open>
      <summary class="settings-section-title">TTS</summary>
      <div class="settings-section-body">
      <label for="tts-service-select">Service</label>
      <div class="input-row">
        <select id="tts-service-select">
          <option value="">— none —</option>
          <option value="openai-tts">OpenAI TTS</option>
        </select>
      </div>
      <details class="settings-subsection" open>
        <summary class="settings-subsection-title">OpenAI TTS</summary>
        <div class="settings-subsection-body">
        <label for="tts-openai-api-key-input">API key</label>
        <div class="input-row">
          <input type="password" id="tts-openai-api-key-input" placeholder="sk-…" autocomplete="off" />
        </div>
        <label for="tts-openai-model-input">Model <span class="settings-hint">(tts-1, tts-1-hd)</span></label>
        <div class="input-row">
          <input type="text" id="tts-openai-model-input" placeholder="default: gpt-4o-mini-tts" />
        </div>
        <label for="tts-openai-voice-input">Voice <span class="settings-hint">(alloy, echo, fable, onyx, nova, shimmer)</span></label>
        <div class="input-row">
          <input type="text" id="tts-openai-voice-input" placeholder="default: sage" />
        </div>
        <label for="tts-openai-speed-input">Speed <span class="settings-hint">(0.25–4, default 1)</span></label>
        <div class="input-row">
          <input type="number" id="tts-openai-speed-input" min="0.25" max="4" step="0.05" placeholder="default: 1" />
        </div>
        </div>
      </details>
      </div>
    </details>

    </div>

    <div class="modal-actions">
      <button class="btn-modal" id="btn-settings-cancel">Cancel</button>
      <button class="btn-modal primary" id="btn-settings-save">Save &amp; Reload</button>
    </div>
  </div>
</div>
`;

export function initSettings() {
  // Inject modal markup
  document.body.insertAdjacentHTML('beforeend', MODAL_HTML);

  const modal                    = document.getElementById('settings-modal');
  const modelDirInput            = document.getElementById('model-dir-input');
  const llmServiceSelect      = document.getElementById('llm-service-select');
  const llmCharacterInput      = document.getElementById('llm-character-input');
  const llmOpenaiApiKeyInput   = document.getElementById('llm-openai-api-key-input');
  const llmOpenaiModelInput    = document.getElementById('llm-openai-model-input');
  const ttsServiceSelect      = document.getElementById('tts-service-select');
  const ttsOpenaiApiKeyInput   = document.getElementById('tts-openai-api-key-input');
  const ttsOpenaiModelInput    = document.getElementById('tts-openai-model-input');
  const ttsOpenaiVoiceInput    = document.getElementById('tts-openai-voice-input');
  const ttsOpenaiSpeedInput    = document.getElementById('tts-openai-speed-input');
  const browseBtn                = document.getElementById('btn-browse');
  const saveBtn        = document.getElementById('btn-settings-save');
  const cancelBtn      = document.getElementById('btn-settings-cancel');

  document.getElementById('btn-settings').addEventListener('click', async () => {
    const config = await window.electronAPI.getConfig();
    const model = config.model ?? {};
    const llm   = config.llm   ?? {};
    const llmOpenai = llm.openai ?? {};
    modelDirInput.value        = model.modelDir      || DEFAULTS.model.modelDir;
    llmServiceSelect.value     = llm.service         || DEFAULTS.llm.service;
    llmCharacterInput.value    = llm.character        || DEFAULTS.llm.character;
    llmOpenaiApiKeyInput.value = llmOpenai.apiKey    || '';
    llmOpenaiModelInput.value  = llmOpenai.model     || DEFAULTS.llm.openai.model;
    const tts = config.tts ?? {};
    const ttsOpenai = tts.openai ?? {};
    ttsServiceSelect.value     = tts.service          || DEFAULTS.tts.service;
    ttsOpenaiApiKeyInput.value = ttsOpenai.apiKey     || '';
    ttsOpenaiModelInput.value  = ttsOpenai.model      || DEFAULTS.tts.openai.model;
    ttsOpenaiVoiceInput.value  = ttsOpenai.voice      || DEFAULTS.tts.openai.voice;
    ttsOpenaiSpeedInput.value  = ttsOpenai.speed      ?? DEFAULTS.tts.openai.speed;
    modal.classList.remove('hidden');
  });

  cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));

  browseBtn.addEventListener('click', async () => {
    const dir = await window.electronAPI.openFolderDialog();
    if (dir) modelDirInput.value = dir;
  });

  saveBtn.addEventListener('click', async () => {
    await window.electronAPI.saveConfig({
      general: {},
      model: {
        modelDir: modelDirInput.value.trim() || DEFAULTS.model.modelDir,
      },
      llm: {
        service: llmServiceSelect.value || DEFAULTS.llm.service,
        character: llmCharacterInput.value.trim() || DEFAULTS.llm.character,
        openai: {
          apiKey: llmOpenaiApiKeyInput.value.trim() || undefined,
          model:  llmOpenaiModelInput.value.trim()  || DEFAULTS.llm.openai.model,
        },
      },
      tts: {
        service: ttsServiceSelect.value || DEFAULTS.tts.service,
        openai: {
          apiKey: ttsOpenaiApiKeyInput.value.trim() || undefined,
          model:  ttsOpenaiModelInput.value.trim()  || DEFAULTS.tts.openai.model,
          voice:  ttsOpenaiVoiceInput.value.trim()  || DEFAULTS.tts.openai.voice,
          speed:  ttsOpenaiSpeedInput.value !== '' ? Number(ttsOpenaiSpeedInput.value) : DEFAULTS.tts.openai.speed,
        },
      },
    });
    // saveConfig triggers a full window reload — nothing after this line runs
  });
}
