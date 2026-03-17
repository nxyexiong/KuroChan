/**
 * settings.js — injects the settings modal into the DOM and handles its logic
 */

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
        <input type="text" id="model-dir-input" placeholder="e.g. assets/models/Haru" />
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
        <summary class="settings-subsection-title">OpenAI</summary>
        <div class="settings-subsection-body">
        <label for="llm-openai-api-key-input">API key</label>
        <div class="input-row">
          <input type="password" id="llm-openai-api-key-input" placeholder="sk-…" autocomplete="off" />
        </div>
        <label for="llm-openai-model-input">Model name</label>
        <div class="input-row">
          <input type="text" id="llm-openai-model-input" placeholder="gpt-4o" />
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
          <option value="windows-tts">Windows TTS</option>
        </select>
      </div>
      <details class="settings-subsection" open>
        <summary class="settings-subsection-title">Windows TTS</summary>
        <div class="settings-subsection-body">
        <label for="tts-windows-voice-input">Voice name</label>
        <div class="input-row">
          <input type="text" id="tts-windows-voice-input" placeholder="e.g. Microsoft Zira Desktop" />
        </div>
        <label for="tts-windows-rate-input">Rate <span class="settings-hint">(0.1–2, default 1)</span></label>
        <div class="input-row">
          <input type="number" id="tts-windows-rate-input" min="0.1" max="2" step="0.1" placeholder="1" />
        </div>
        <label for="tts-windows-pitch-input">Pitch <span class="settings-hint">(0–2, default 1)</span></label>
        <div class="input-row">
          <input type="number" id="tts-windows-pitch-input" min="0" max="2" step="0.1" placeholder="1" />
        </div>
        <label for="tts-windows-volume-input">Volume <span class="settings-hint">(0–1, default 1)</span></label>
        <div class="input-row">
          <input type="number" id="tts-windows-volume-input" min="0" max="1" step="0.05" placeholder="1" />
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
  const llmOpenaiApiKeyInput   = document.getElementById('llm-openai-api-key-input');
  const llmOpenaiModelInput    = document.getElementById('llm-openai-model-input');
  const ttsServiceSelect     = document.getElementById('tts-service-select');
  const ttsWindowsVoiceInput  = document.getElementById('tts-windows-voice-input');
  const ttsWindowsRateInput   = document.getElementById('tts-windows-rate-input');
  const ttsWindowsPitchInput  = document.getElementById('tts-windows-pitch-input');
  const ttsWindowsVolumeInput = document.getElementById('tts-windows-volume-input');
  const browseBtn                = document.getElementById('btn-browse');
  const saveBtn        = document.getElementById('btn-settings-save');
  const cancelBtn      = document.getElementById('btn-settings-cancel');

  document.getElementById('btn-settings').addEventListener('click', async () => {
    const config = await window.electronAPI.getConfig();
    const model = config.model ?? {};
    const llm   = config.llm   ?? {};
    const llmOpenai = llm.openai ?? {};
    modelDirInput.value        = model.modelDir      || '';
    llmServiceSelect.value     = llm.service         ?? '';
    llmOpenaiApiKeyInput.value = llmOpenai.apiKey    || '';
    llmOpenaiModelInput.value  = llmOpenai.model     || '';
    const tts = config.tts ?? {};
    const ttsWindows = tts.windows ?? {};
    ttsServiceSelect.value      = tts.service       ?? '';
    ttsWindowsVoiceInput.value  = ttsWindows.voiceName ?? '';
    ttsWindowsRateInput.value   = ttsWindows.rate      ?? '';
    ttsWindowsPitchInput.value  = ttsWindows.pitch     ?? '';
    ttsWindowsVolumeInput.value = ttsWindows.volume    ?? '';
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
        modelDir: modelDirInput.value.trim(),
      },
      llm: {
        service: llmServiceSelect.value || undefined,
        openai: {
          apiKey: llmOpenaiApiKeyInput.value.trim() || undefined,
          model:  llmOpenaiModelInput.value.trim()  || undefined,
        },
      },
      tts: {
        service: ttsServiceSelect.value || undefined,
        windows: {
          voiceName: ttsWindowsVoiceInput.value.trim()  || undefined,
          rate:      ttsWindowsRateInput.value   !== '' ? Number(ttsWindowsRateInput.value)   : undefined,
          pitch:     ttsWindowsPitchInput.value  !== '' ? Number(ttsWindowsPitchInput.value)  : undefined,
          volume:    ttsWindowsVolumeInput.value !== '' ? Number(ttsWindowsVolumeInput.value) : undefined,
        },
      },
    });
    // saveConfig triggers a full window reload — nothing after this line runs
  });
}
