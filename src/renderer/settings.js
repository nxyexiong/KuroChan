/**
 * settings.js — injects the settings modal into the DOM and handles its logic (renderer)
 */

const DEFAULTS = {
  model: {
    modelDir: 'resources/models/Haru',
  },
  llm: {
    character: 'You are kuro-chan(クロちゃん), a friendly anime-style assistant.',
    copilot: {
      contextTier: 'default',
      provider: {
        enabled: false,
        type: 'openai',
        baseUrl: '',
        apiKey: '',
        model: '',
        wireApi: 'completions',
        azureApiVersion: '',
        reasoningEffort: '',
        maxPromptTokens: 0,
        maxOutputTokens: 0,
      },
    },
  },
  tts: {
    service: 'kokoro',
    pitch: 2.5,
    kokoro: {
      modelDir: '',
      dtype:    'q8',
      voice:    'af_heart',
      speed:    1,
    },
    openai: {
      model: 'gpt-4o-mini-tts',
      voice: 'sage',
      speed: 1,
    },
    xai: {
      voice:    'ara',
      language: 'auto',
    },
  },
  stt: {
    service: 'whisper-local',
    vad: {
      voiceThreshold:  0.02,
      silenceDuration: 1500,
    },
    whisper: {
      modelPath: '',
      nThreads:  4,
      language:  'en',
    },
  },
};

const MODAL_HTML = `
<div id="settings-modal" class="modal-overlay hidden">
  <div class="modal">
    <h3>Settings</h3>
    <div class="modal-body">

    <details class="settings-section">
      <summary class="settings-section-title">Model</summary>
      <div class="settings-section-body">
      <label for="model-dir-input">Model folder</label>
      <div class="input-row">
        <input type="text" id="model-dir-input" placeholder="default: resources/models/Haru" />
        <button class="btn-modal" id="btn-browse">Browse…</button>
      </div>
      </div>
    </details>

    <details class="settings-section">
      <summary class="settings-section-title">LLM</summary>
      <div class="settings-section-body">
      <details class="settings-subsection">
        <summary class="settings-subsection-title">Character</summary>
        <div class="settings-subsection-body">
        <div class="input-row">
          <textarea id="llm-character-input" rows="4" placeholder="default: You are kuro-chan(クロちゃん), a friendly anime-style assistant."></textarea>
        </div>
        </div>
      </details>
      <details class="settings-subsection" id="llm-copilot-section">
        <summary class="settings-subsection-title">GitHub Copilot</summary>
        <div class="settings-subsection-body">
        <label class="settings-check-row" for="copilot-byok-enabled">
          <input type="checkbox" id="copilot-byok-enabled" />
          Use a custom model endpoint (BYOK)
        </label>
        <div id="copilot-github-fields">
        <div class="input-row">
          <button class="btn-modal" id="copilot-login-btn" type="button">Log in</button>
          <span id="copilot-login-status" class="settings-hint">Not logged in</span>
        </div>
        <div id="copilot-login-code-row" class="copilot-code-row hidden">
          <span id="copilot-login-code" class="copilot-code"></span>
          <span id="copilot-login-tip" class="settings-hint"></span>
        </div>
        <label for="copilot-model-select">Model <span class="settings-hint">(from your Copilot account)</span></label>
        <div class="input-row">
          <select id="copilot-model-select"><option value="">(log in to load models)</option></select>
        </div>
        <label for="copilot-effort-select">Thinking effort</label>
        <div class="input-row">
          <select id="copilot-effort-select"><option value="">Default</option></select>
        </div>
        <label for="copilot-context-select">Context length</label>
        <div class="input-row">
          <select id="copilot-context-select">
            <option value="default">Default</option>
            <option value="long_context">Long context</option>
          </select>
        </div>
        <label>Session <span class="settings-hint">(Copilot keeps one conversation across launches)</span></label>
        <div class="input-row">
          <button class="btn-modal" id="copilot-reset-session-btn" type="button">Reset / New session</button>
          <span id="copilot-session-status" class="settings-hint"></span>
        </div>
        </div>
        <div id="copilot-byok-fields" class="hidden">
          <label for="copilot-byok-type">Provider type</label>
          <div class="input-row">
            <select id="copilot-byok-type">
              <option value="openai">OpenAI-compatible (OpenAI, Ollama, OpenRouter…)</option>
              <option value="azure">Azure OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>
          <label for="copilot-byok-baseurl">Endpoint URL</label>
          <div class="input-row">
            <input type="text" id="copilot-byok-baseurl" placeholder="e.g. https://api.openai.com/v1 or http://localhost:11434/v1" />
          </div>
          <label for="copilot-byok-apikey">API key <span class="settings-hint">(leave blank for local providers like Ollama)</span></label>
          <div class="input-row">
            <input type="password" id="copilot-byok-apikey" placeholder="" />
          </div>
          <label for="copilot-byok-model">Model <span class="settings-hint">(required — e.g. gpt-4o, llama3.1)</span></label>
          <div class="input-row">
            <input type="text" id="copilot-byok-model" placeholder="model name" />
          </div>
          <label for="copilot-byok-effort">Thinking effort <span class="settings-hint">(only if your model supports it)</span></label>
          <div class="input-row">
            <select id="copilot-byok-effort">
              <option value="">Default</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">Extra high</option>
            </select>
          </div>
          <label for="copilot-byok-context">Context length <span class="settings-hint">(max prompt tokens — blank = model default)</span></label>
          <div class="input-row">
            <input type="number" id="copilot-byok-context" min="0" step="1024" placeholder="e.g. 128000" />
          </div>
          <label for="copilot-byok-maxout">Max output tokens <span class="settings-hint">(optional — blank = model default)</span></label>
          <div class="input-row">
            <input type="number" id="copilot-byok-maxout" min="0" step="256" placeholder="e.g. 4096" />
          </div>
          <div id="copilot-byok-wireapi-row">
            <label for="copilot-byok-wireapi">API format</label>
            <div class="input-row">
              <select id="copilot-byok-wireapi">
                <option value="completions">Chat Completions (default)</option>
                <option value="responses">Responses</option>
              </select>
            </div>
          </div>
          <div id="copilot-byok-azure-row" class="hidden">
            <label for="copilot-byok-azure-version">Azure API version</label>
            <div class="input-row">
              <input type="text" id="copilot-byok-azure-version" placeholder="2024-10-21" />
            </div>
          </div>
          <span class="settings-hint">When enabled, KuroChan talks to your endpoint — a GitHub login is not required.</span>
        </div>
        </div>
      </details>
      </div>
    </details>

      <details class="settings-section">
      <summary class="settings-section-title">TTS</summary>
      <div class="settings-section-body">
      <label for="tts-service-select">Service</label>
      <div class="input-row">
        <select id="tts-service-select">
          <option value="">— none —</option>
          <option value="kokoro">Kokoro (local)</option>
          <option value="openai-tts">OpenAI TTS</option>
          <option value="xai-tts">xAI TTS</option>
        </select>
      </div>
      <label for="tts-pitch-input">Pitch <span class="settings-hint">(semitones, −12 to +12, default 2.5)</span></label>
      <div class="input-row">
        <input type="number" id="tts-pitch-input" min="-12" max="12" step="0.5" placeholder="default: 2.5" />
      </div>
      <details class="settings-subsection">
        <summary class="settings-subsection-title">Kokoro (local)</summary>
        <div class="settings-subsection-body">
        <label for="tts-kokoro-model-dir-input">Model folder <span class="settings-hint">(download from huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)</span></label>
        <div class="input-row">
          <input type="text" id="tts-kokoro-model-dir-input" placeholder="folder containing config.json + onnx/" />
          <button class="btn-modal" id="btn-browse-kokoro-model">Browse…</button>
        </div>
        <label for="tts-kokoro-dtype-select">Precision <span class="settings-hint">(must match a file in the model's onnx/ folder)</span></label>
        <div class="input-row">
          <select id="tts-kokoro-dtype-select">
            <option value="q8">q8 — quantized (~86 MB, recommended)</option>
            <option value="fp32">fp32 — full (~326 MB)</option>
            <option value="fp16">fp16 (~163 MB)</option>
            <option value="q4">q4</option>
            <option value="q4f16">q4f16</option>
          </select>
        </div>
        <label for="tts-kokoro-voice-select">Voice</label>
        <div class="input-row">
          <select id="tts-kokoro-voice-select">
            <option value="af_heart">af_heart — Heart 🚺❤️ (A)</option>
            <option value="af_bella">af_bella — Bella 🚺🔥 (A-)</option>
            <option value="af_nicole">af_nicole — Nicole 🚺🎧 (B-)</option>
            <option value="af_aoede">af_aoede — Aoede 🚺</option>
            <option value="af_kore">af_kore — Kore 🚺</option>
            <option value="af_sarah">af_sarah — Sarah 🚺</option>
            <option value="af_nova">af_nova — Nova 🚺</option>
            <option value="af_sky">af_sky — Sky 🚺</option>
            <option value="am_fenrir">am_fenrir — Fenrir 🚹</option>
            <option value="am_michael">am_michael — Michael 🚹</option>
            <option value="am_puck">am_puck — Puck 🚹</option>
            <option value="am_echo">am_echo — Echo 🚹</option>
            <option value="bf_emma">bf_emma — Emma 🚺 (en-gb)</option>
            <option value="bf_isabella">bf_isabella — Isabella 🚺 (en-gb)</option>
            <option value="bm_george">bm_george — George 🚹 (en-gb)</option>
            <option value="bm_fable">bm_fable — Fable 🚹 (en-gb)</option>
          </select>
        </div>
        <label for="tts-kokoro-speed-input">Speed <span class="settings-hint">(0.5–2, default 1)</span></label>
        <div class="input-row">
          <input type="number" id="tts-kokoro-speed-input" min="0.5" max="2" step="0.05" placeholder="default: 1" />
        </div>
        </div>
      </details>
      <details class="settings-subsection">
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
      <details class="settings-subsection">
        <summary class="settings-subsection-title">xAI TTS</summary>
        <div class="settings-subsection-body">
        <label for="tts-xai-api-key-input">API key</label>
        <div class="input-row">
          <input type="password" id="tts-xai-api-key-input" placeholder="xai-…" autocomplete="off" />
        </div>
        <label for="tts-xai-voice-input">Voice <span class="settings-hint">(eve, ara, rex, sal, leo)</span></label>
        <div class="input-row">
          <input type="text" id="tts-xai-voice-input" placeholder="default: ara" />
        </div>
        <label for="tts-xai-language-input">Language <span class="settings-hint">(BCP-47 code or auto)</span></label>
        <div class="input-row">
          <input type="text" id="tts-xai-language-input" placeholder="default: auto" />
        </div>
        </div>
      </details>
      </div>
    </details>

    <details class="settings-section">
      <summary class="settings-section-title">STT</summary>
      <div class="settings-section-body">
      <label for="stt-service-select">Service</label>
      <div class="input-row">
        <select id="stt-service-select">
          <option value="">— none —</option>
          <option value="whisper-local">Whisper (local)</option>
        </select>
      </div>
      <details class="settings-subsection">
        <summary class="settings-subsection-title">Voice detection</summary>
        <div class="settings-subsection-body">
        <label for="stt-vad-threshold-input">Voice threshold <span class="settings-hint">(RMS 0.0–1.0, lower = more sensitive)</span></label>
        <div class="input-row">
          <input type="number" id="stt-vad-threshold-input" min="0.001" max="1" step="0.005" placeholder="default: 0.02" />
        </div>
        <label for="stt-vad-silence-input">Silence duration <span class="settings-hint">(ms before sending, e.g. 1500)</span></label>
        <div class="input-row">
          <input type="number" id="stt-vad-silence-input" min="200" max="10000" step="100" placeholder="default: 1500" />
        </div>
        </div>
      </details>
      <details class="settings-subsection">
        <summary class="settings-subsection-title">Whisper (local)</summary>
        <div class="settings-subsection-body">
        <label for="stt-whisper-model-path-input">Model file <span class="settings-hint">(.bin from huggingface.co/ggerganov/whisper.cpp)</span></label>
        <div class="input-row">
          <input type="text" id="stt-whisper-model-path-input" placeholder="" />
          <button class="btn-modal" id="btn-browse-whisper-model">Browse…</button>
        </div>
        <label for="stt-whisper-threads-input">CPU threads <span class="settings-hint">(1–16)</span></label>
        <div class="input-row">
          <input type="number" id="stt-whisper-threads-input" min="1" max="16" step="1" placeholder="default: 4" />
        </div>
        <label for="stt-whisper-language-input">Language <span class="settings-hint">(ISO 639-1 code, e.g. en·ja·zh·fr)</span></label>
        <div class="input-row">
          <input type="text" id="stt-whisper-language-input" maxlength="10" placeholder="default: en" />
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
  document.body.insertAdjacentHTML('beforeend', MODAL_HTML);

  const modal                    = document.getElementById('settings-modal');
  const modelDirInput            = document.getElementById('model-dir-input');
  const llmCharacterInput      = document.getElementById('llm-character-input');
  const ttsServiceSelect      = document.getElementById('tts-service-select');
  const ttsKokoroModelDirInput = document.getElementById('tts-kokoro-model-dir-input');
  const ttsKokoroDtypeSelect   = document.getElementById('tts-kokoro-dtype-select');
  const ttsKokoroVoiceSelect   = document.getElementById('tts-kokoro-voice-select');
  const ttsKokoroSpeedInput    = document.getElementById('tts-kokoro-speed-input');
  const browseKokoroModelBtn   = document.getElementById('btn-browse-kokoro-model');
  const ttsOpenaiApiKeyInput   = document.getElementById('tts-openai-api-key-input');
  const ttsOpenaiModelInput    = document.getElementById('tts-openai-model-input');
  const ttsOpenaiVoiceInput    = document.getElementById('tts-openai-voice-input');
  const ttsOpenaiSpeedInput    = document.getElementById('tts-openai-speed-input');
  const ttsXaiApiKeyInput      = document.getElementById('tts-xai-api-key-input');
  const ttsXaiVoiceInput       = document.getElementById('tts-xai-voice-input');
  const ttsXaiLanguageInput    = document.getElementById('tts-xai-language-input');
  const ttsPitchInput          = document.getElementById('tts-pitch-input');
  const browseBtn                = document.getElementById('btn-browse');
  const saveBtn        = document.getElementById('btn-settings-save');
  const cancelBtn      = document.getElementById('btn-settings-cancel');
  const sttServiceSelect          = document.getElementById('stt-service-select');
  const sttVadThresholdInput       = document.getElementById('stt-vad-threshold-input');
  const sttVadSilenceInput         = document.getElementById('stt-vad-silence-input');
  const sttWhisperModelPathInput   = document.getElementById('stt-whisper-model-path-input');
  const sttWhisperThreadsInput     = document.getElementById('stt-whisper-threads-input');
  const sttWhisperLanguageInput    = document.getElementById('stt-whisper-language-input');
  const browseWhisperModelBtn      = document.getElementById('btn-browse-whisper-model');
  // GitHub Copilot
  const copilotLoginBtn        = document.getElementById('copilot-login-btn');
  const copilotLoginStatus     = document.getElementById('copilot-login-status');
  const copilotLoginCodeRow    = document.getElementById('copilot-login-code-row');
  const copilotLoginCode       = document.getElementById('copilot-login-code');
  const copilotLoginTip        = document.getElementById('copilot-login-tip');
  const copilotModelSelect     = document.getElementById('copilot-model-select');
  const copilotEffortSelect    = document.getElementById('copilot-effort-select');
  const copilotContextSelect   = document.getElementById('copilot-context-select');
  const copilotResetSessionBtn = document.getElementById('copilot-reset-session-btn');
  const copilotSessionStatus   = document.getElementById('copilot-session-status');
  // GitHub Copilot — BYOK (custom endpoint)
  const copilotByokEnabled     = document.getElementById('copilot-byok-enabled');
  const copilotGithubFields    = document.getElementById('copilot-github-fields');
  const copilotByokFields      = document.getElementById('copilot-byok-fields');
  const copilotByokType        = document.getElementById('copilot-byok-type');
  const copilotByokBaseUrl     = document.getElementById('copilot-byok-baseurl');
  const copilotByokApiKey      = document.getElementById('copilot-byok-apikey');
  const copilotByokModel       = document.getElementById('copilot-byok-model');
  const copilotByokEffort      = document.getElementById('copilot-byok-effort');
  const copilotByokContext     = document.getElementById('copilot-byok-context');
  const copilotByokMaxOut      = document.getElementById('copilot-byok-maxout');
  const copilotByokWireApiRow  = document.getElementById('copilot-byok-wireapi-row');
  const copilotByokWireApi     = document.getElementById('copilot-byok-wireapi');
  const copilotByokAzureRow    = document.getElementById('copilot-byok-azure-row');
  const copilotByokAzureVersion = document.getElementById('copilot-byok-azure-version');
  let copilotModels       = [];
  let copilotLoggedIn     = false;
  let copilotSavedModel   = '';
  let copilotSavedEffort  = '';
  let copilotSavedContext = 'default';

  document.getElementById('btn-settings').addEventListener('click', async () => {
    const config = await window.electronAPI.getConfig();
    const model = config.model ?? {};
    const llm   = config.llm   ?? {};
    modelDirInput.value        = model.modelDir      || DEFAULTS.model.modelDir;
    llmCharacterInput.value    = llm.character        || DEFAULTS.llm.character;
    const llmCopilot = llm.copilot ?? {};
    copilotSavedModel   = llmCopilot.model || '';
    copilotSavedEffort  = llmCopilot.reasoningEffort || '';
    copilotSavedContext = llmCopilot.contextTier || DEFAULTS.llm.copilot.contextTier;
    copilotContextSelect.value = copilotSavedContext;
    copilotSessionStatus.textContent = llmCopilot.sessionId ? 'Saved session will resume' : '';
    const byok = llmCopilot.provider ?? {};
    copilotByokEnabled.checked   = !!byok.enabled;
    copilotByokType.value        = byok.type    || DEFAULTS.llm.copilot.provider.type;
    copilotByokBaseUrl.value     = byok.baseUrl || '';
    copilotByokApiKey.value      = byok.apiKey  || '';
    copilotByokModel.value       = byok.model   || '';
    copilotByokEffort.value      = byok.reasoningEffort || '';
    copilotByokContext.value     = byok.maxPromptTokens ? String(byok.maxPromptTokens) : '';
    copilotByokMaxOut.value      = byok.maxOutputTokens ? String(byok.maxOutputTokens) : '';
    copilotByokWireApi.value     = byok.wireApi || DEFAULTS.llm.copilot.provider.wireApi;
    copilotByokAzureVersion.value = byok.azureApiVersion || '';
    updateByokVisibility();
    copilotLoginCodeRow.classList.add('hidden');
    // Async auth + model load with a loading state (no CLI work unless logged in).
    window.electronAPI.copilotAuthStatus().then((s) => {
      setCopilotLoggedIn(s && s.loggedIn);
      if (s && s.loggedIn) {
        loadCopilotModels();
      } else {
        copilotModelSelect.innerHTML = '<option value="">(log in to load models)</option>';
        copilotModelSelect.disabled = true;
        setCopilotEffortOptions(null);
      }
    });
    const tts = config.tts ?? {};
    const ttsOpenai = tts.openai ?? {};
    ttsServiceSelect.value     = tts.service          || DEFAULTS.tts.service;
    const ttsKokoro = tts.kokoro ?? {};
    ttsKokoroModelDirInput.value = ttsKokoro.modelDir || DEFAULTS.tts.kokoro.modelDir;
    ttsKokoroDtypeSelect.value   = ttsKokoro.dtype    || DEFAULTS.tts.kokoro.dtype;
    ttsKokoroVoiceSelect.value   = ttsKokoro.voice    || DEFAULTS.tts.kokoro.voice;
    ttsKokoroSpeedInput.value    = ttsKokoro.speed    ?? DEFAULTS.tts.kokoro.speed;
    ttsOpenaiApiKeyInput.value = ttsOpenai.apiKey     || '';
    ttsOpenaiModelInput.value  = ttsOpenai.model      || DEFAULTS.tts.openai.model;
    ttsOpenaiVoiceInput.value  = ttsOpenai.voice      || DEFAULTS.tts.openai.voice;
    ttsOpenaiSpeedInput.value  = ttsOpenai.speed      ?? DEFAULTS.tts.openai.speed;
    ttsPitchInput.value        = tts.pitch              ?? DEFAULTS.tts.pitch;
    const ttsXai = tts.xai ?? {};
    ttsXaiApiKeyInput.value    = ttsXai.apiKey           || '';
    ttsXaiVoiceInput.value     = ttsXai.voice            || DEFAULTS.tts.xai.voice;
    ttsXaiLanguageInput.value  = ttsXai.language          || DEFAULTS.tts.xai.language;
    const stt        = config.stt ?? {};
    const sttVad     = stt.vad     ?? {};
    const sttWhisper = stt.whisper ?? {};
    sttServiceSelect.value         = stt.service                  || DEFAULTS.stt.service;
    sttVadThresholdInput.value     = sttVad.voiceThreshold        ?? DEFAULTS.stt.vad.voiceThreshold;
    sttVadSilenceInput.value       = sttVad.silenceDuration       ?? DEFAULTS.stt.vad.silenceDuration;
    sttWhisperModelPathInput.value = sttWhisper.modelPath         || DEFAULTS.stt.whisper.modelPath;
    sttWhisperThreadsInput.value   = sttWhisper.nThreads          ?? DEFAULTS.stt.whisper.nThreads;
    sttWhisperLanguageInput.value  = sttWhisper.language          || DEFAULTS.stt.whisper.language;
    modal.classList.remove('hidden');
  });

  cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));

  browseBtn.addEventListener('click', async () => {
    const dir = await window.electronAPI.openFolderDialog();
    if (dir) modelDirInput.value = dir;
  });

  browseKokoroModelBtn.addEventListener('click', async () => {
    const dir = await window.electronAPI.openFolderDialog();
    if (dir) ttsKokoroModelDirInput.value = dir;
  });

  browseWhisperModelBtn.addEventListener('click', async () => {
    const file = await window.electronAPI.openFileDialog({
      title:   'Select Whisper GGML model',
      filters: [{ name: 'GGML model', extensions: ['bin'] }],
    });
    if (file) sttWhisperModelPathInput.value = file;
  });

  saveBtn.addEventListener('click', async () => {
    await window.electronAPI.saveConfig({
      general: {},
      model: {
        modelDir:   modelDirInput.value.trim() || DEFAULTS.model.modelDir,
      },
      llm: {
        character: llmCharacterInput.value.trim() || DEFAULTS.llm.character,
        copilot: {
          model:           copilotModelSelect.value   || undefined,
          reasoningEffort: copilotEffortSelect.value  || undefined,
          contextTier:     copilotContextSelect.value || DEFAULTS.llm.copilot.contextTier,
          provider: {
            enabled:  copilotByokEnabled.checked,
            type:     copilotByokType.value || DEFAULTS.llm.copilot.provider.type,
            baseUrl:  copilotByokBaseUrl.value.trim(),
            apiKey:   copilotByokApiKey.value.trim(),
            model:    copilotByokModel.value.trim(),
            wireApi:  copilotByokWireApi.value || DEFAULTS.llm.copilot.provider.wireApi,
            azureApiVersion: copilotByokAzureVersion.value.trim(),
            reasoningEffort: copilotByokEffort.value || '',
            maxPromptTokens: copilotByokContext.value.trim() ? Number(copilotByokContext.value) : 0,
            maxOutputTokens: copilotByokMaxOut.value.trim() ? Number(copilotByokMaxOut.value) : 0,
          },
        },
      },
      tts: {
        service: ttsServiceSelect.value || DEFAULTS.tts.service,
        pitch:   ttsPitchInput.value !== '' ? Number(ttsPitchInput.value) : DEFAULTS.tts.pitch,
        kokoro: {
          modelDir: ttsKokoroModelDirInput.value.trim() || undefined,
          dtype:    ttsKokoroDtypeSelect.value || DEFAULTS.tts.kokoro.dtype,
          voice:    ttsKokoroVoiceSelect.value || DEFAULTS.tts.kokoro.voice,
          speed:    ttsKokoroSpeedInput.value !== '' ? Number(ttsKokoroSpeedInput.value) : DEFAULTS.tts.kokoro.speed,
        },
        openai: {
          apiKey: ttsOpenaiApiKeyInput.value.trim() || undefined,
          model:  ttsOpenaiModelInput.value.trim()  || DEFAULTS.tts.openai.model,
          voice:  ttsOpenaiVoiceInput.value.trim()  || DEFAULTS.tts.openai.voice,
          speed:  ttsOpenaiSpeedInput.value !== '' ? Number(ttsOpenaiSpeedInput.value) : DEFAULTS.tts.openai.speed,
        },
        xai: {
          apiKey:   ttsXaiApiKeyInput.value.trim()    || undefined,
          voice:    ttsXaiVoiceInput.value.trim()     || DEFAULTS.tts.xai.voice,
          language: ttsXaiLanguageInput.value.trim()  || DEFAULTS.tts.xai.language,
        },
      },
      stt: {
        service: sttServiceSelect.value || DEFAULTS.stt.service,
        vad: {
          voiceThreshold:  sttVadThresholdInput.value  !== '' ? Number(sttVadThresholdInput.value)  : DEFAULTS.stt.vad.voiceThreshold,
          silenceDuration: sttVadSilenceInput.value    !== '' ? Number(sttVadSilenceInput.value)    : DEFAULTS.stt.vad.silenceDuration,
        },
        whisper: {
          modelPath: sttWhisperModelPathInput.value.trim() || DEFAULTS.stt.whisper.modelPath,
          nThreads:  sttWhisperThreadsInput.value  !== '' ? Number(sttWhisperThreadsInput.value)  : DEFAULTS.stt.whisper.nThreads,
          language:  sttWhisperLanguageInput.value.trim() || DEFAULTS.stt.whisper.language,
        },
      },
    });
    // saveConfig triggers a full window reload — nothing after this line runs
  });

  // ── GitHub Copilot wiring ────────────────────────────────────────────────
  function setCopilotLoggedIn(loggedIn) {
    copilotLoggedIn = !!loggedIn;
    copilotLoginStatus.textContent = loggedIn ? '✅ Logged in' : 'Not logged in';
    copilotLoginBtn.textContent = loggedIn ? 'Re-login' : 'Log in';
  }

  function setCopilotEffortOptions(modelMeta) {
    const efforts = (modelMeta && modelMeta.supportedReasoningEfforts) || [];
    copilotEffortSelect.innerHTML = '';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = 'Default';
    copilotEffortSelect.appendChild(def);
    for (const e of efforts) {
      const o = document.createElement('option');
      o.value = e;
      o.textContent = e.charAt(0).toUpperCase() + e.slice(1);
      copilotEffortSelect.appendChild(o);
    }
    copilotEffortSelect.disabled = efforts.length === 0;
    copilotEffortSelect.value = efforts.includes(copilotSavedEffort) ? copilotSavedEffort : '';
  }

  function populateCopilotModels(models) {
    copilotModels = Array.isArray(models) ? models : [];
    copilotModelSelect.innerHTML = '';
    if (!copilotModels.length) {
      copilotModelSelect.innerHTML = '<option value="">(no models available)</option>';
      copilotModelSelect.disabled = true;
      setCopilotEffortOptions(null);
      return;
    }
    copilotModelSelect.disabled = false;
    for (const m of copilotModels) {
      const o = document.createElement('option');
      o.value = m.id;
      const ctx = m.maxContextWindowTokens ? `  ·  ${Math.round(m.maxContextWindowTokens / 1000)}k ctx` : '';
      o.textContent = (m.name || m.id) + ctx;
      copilotModelSelect.appendChild(o);
    }
    const sel = copilotModels.some(m => m.id === copilotSavedModel) ? copilotSavedModel : copilotModels[0].id;
    copilotModelSelect.value = sel;
    setCopilotEffortOptions(copilotModels.find(m => m.id === sel));
  }

  async function loadCopilotModels() {
    if (!copilotLoggedIn) return;
    copilotModelSelect.innerHTML = '<option value="">Loading…</option>';
    copilotModelSelect.disabled = true;
    copilotEffortSelect.disabled = true;
    try {
      const res = await window.electronAPI.copilotListModels();
      if (res && res.ok) {
        populateCopilotModels(res.models);
      } else {
        copilotModelSelect.innerHTML = `<option value="">${res && res.error ? '⚠ ' + res.error : 'Failed to load models'}</option>`;
      }
    } catch {
      copilotModelSelect.innerHTML = '<option value="">⚠ Failed to load models</option>';
    }
  }

  copilotModelSelect.addEventListener('change', () => {
    setCopilotEffortOptions(copilotModels.find(m => m.id === copilotModelSelect.value));
  });

  // Switch between the GitHub login/model block and the BYOK fields.
  function updateByokVisibility() {
    const on = copilotByokEnabled.checked;
    copilotGithubFields.classList.toggle('hidden', on);
    copilotByokFields.classList.toggle('hidden', !on);
    const type = copilotByokType.value;
    copilotByokAzureRow.classList.toggle('hidden', type !== 'azure');
    copilotByokWireApiRow.classList.toggle('hidden', type === 'anthropic'); // wireApi is openai/azure only
  }
  copilotByokEnabled.addEventListener('change', updateByokVisibility);
  copilotByokType.addEventListener('change', updateByokVisibility);

  copilotLoginBtn.addEventListener('click', async () => {
    copilotLoginBtn.disabled = true;
    copilotLoginStatus.textContent = 'Starting login…';
    copilotLoginCodeRow.classList.add('hidden');
    try {
      const res = await window.electronAPI.copilotLogin();
      if (res && res.ok) {
        setCopilotLoggedIn(true);
        copilotLoginCodeRow.classList.add('hidden');
        await loadCopilotModels();
      } else {
        copilotLoginStatus.textContent = `⚠ ${res && res.error ? res.error : 'Login failed'}`;
      }
    } catch {
      copilotLoginStatus.textContent = '⚠ Login failed';
    } finally {
      copilotLoginBtn.disabled = false;
    }
  });

  window.electronAPI.onCopilotLoginCode(({ userCode, verificationUri }) => {
    copilotLoginCode.textContent = userCode;
    copilotLoginTip.textContent = `Open ${verificationUri} in your browser, enter this code, then wait here…`;
    copilotLoginCodeRow.classList.remove('hidden');
    copilotLoginStatus.textContent = 'Waiting for authorization…';
  });

  copilotResetSessionBtn.addEventListener('click', async () => {
    copilotResetSessionBtn.disabled = true;
    copilotSessionStatus.textContent = 'Resetting…';
    try {
      const res = await window.electronAPI.copilotResetSession();
      copilotSessionStatus.textContent = (res && res.ok) ? '✅ New session started' : `⚠ ${res && res.error ? res.error : 'Failed'}`;
    } catch {
      copilotSessionStatus.textContent = '⚠ Failed to reset session';
    } finally {
      copilotResetSessionBtn.disabled = false;
    }
  });
}
