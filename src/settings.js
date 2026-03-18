/**
 * settings.js — injects the settings modal into the DOM and handles its logic
 */

const DEFAULTS = {
  model: {
    modelDir: 'assets/models/Haru',
    modelScale: 100,
  },
  llm: {
    service: 'openai',
    character: 'You are kuro-chan(クロちゃん), a friendly anime-style assistant.',
    openai: {
      model: 'gpt-4.1-nano',
    },
    openclaw: {
      url:        'ws://127.0.0.1:18789',
      sessionKey: 'main',
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
  stt: {
    service: 'whisper-local',
    vad: {
      voiceThreshold:  0.02,
      silenceDuration: 1500,
    },
    whisper: {
      modelPath: 'resources/whisper/ggml-base.bin',
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
        <input type="text" id="model-dir-input" placeholder="default: assets/models/Haru" />
        <button class="btn-modal" id="btn-browse">Browse…</button>
      </div>
      <label for="model-scale-input">Size <span class="settings-hint">(% of screen fit, default: 100)</span></label>
      <div class="input-row">
        <input type="number" id="model-scale-input" min="1" max="500" step="5" placeholder="default: 100" />
      </div>
      </div>
    </details>

    <details class="settings-section">
      <summary class="settings-section-title">LLM</summary>
      <div class="settings-section-body">
      <label for="llm-service-select">Service</label>
      <div class="input-row">
        <select id="llm-service-select">
          <option value="">— none —</option>
          <option value="openai">OpenAI</option>
          <option value="openclaw">OpenClaw</option>
        </select>
      </div>
      <details class="settings-subsection">
        <summary class="settings-subsection-title">Character</summary>
        <div class="settings-subsection-body">
        <div class="input-row">
          <textarea id="llm-character-input" rows="4" placeholder="default: You are kuro-chan(クロちゃん), a friendly anime-style assistant."></textarea>
        </div>
        </div>
      </details>
      <details class="settings-subsection">
        <summary class="settings-subsection-title">OpenAI</summary>
        <div class="settings-subsection-body">
        <label for="llm-openai-api-key-input">API key</label>
        <div class="input-row">
          <input type="password" id="llm-openai-api-key-input" placeholder="sk-…" autocomplete="off" />
        </div>
        <label for="llm-openai-model-input">Model name</label>
        <div class="input-row">
          <input type="text" id="llm-openai-model-input" placeholder="default: gpt-4.1-nano" />
        </div>
        </div>
      </details>
      <details class="settings-subsection" id="llm-openclaw-section">
        <summary class="settings-subsection-title">OpenClaw</summary>
        <div class="settings-subsection-body">
        <label for="llm-openclaw-url-input">Gateway URL <span class="settings-hint">(default: ws://127.0.0.1:18789)</span></label>
        <div class="input-row">
          <input type="text" id="llm-openclaw-url-input" placeholder="ws://127.0.0.1:18789" />
        </div>
        <label for="llm-openclaw-token-input">Token <span class="settings-hint">(shared token, leave blank if unauthenticated)</span></label>
        <div class="input-row">
          <input type="password" id="llm-openclaw-token-input" placeholder="(optional)" autocomplete="off" />
        </div>
        <label for="llm-openclaw-password-input">Password <span class="settings-hint">(gateway password, alternative to token)</span></label>
        <div class="input-row">
          <input type="password" id="llm-openclaw-password-input" placeholder="(optional)" autocomplete="off" />
        </div>
        <label for="llm-openclaw-session-input">Session key <span class="settings-hint">(default: main)</span></label>
        <div class="input-row">
          <input type="text" id="llm-openclaw-session-input" placeholder="main" />
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
          <option value="openai-tts">OpenAI TTS</option>
        </select>
      </div>
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
          <input type="text" id="stt-whisper-model-path-input" placeholder="default: resources/whisper/ggml-base.bin" />
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
  // Inject modal markup
  document.body.insertAdjacentHTML('beforeend', MODAL_HTML);

  const modal                    = document.getElementById('settings-modal');
  const modelDirInput            = document.getElementById('model-dir-input');
  const modelScaleInput           = document.getElementById('model-scale-input');
  const llmServiceSelect      = document.getElementById('llm-service-select');
  const llmCharacterInput      = document.getElementById('llm-character-input');
  const llmOpenaiApiKeyInput   = document.getElementById('llm-openai-api-key-input');
  const llmOpenaiModelInput    = document.getElementById('llm-openai-model-input');
  const llmOpenclawUrlInput    = document.getElementById('llm-openclaw-url-input');
  const llmOpenclawTokenInput  = document.getElementById('llm-openclaw-token-input');
  const llmOpenclawPasswordInput = document.getElementById('llm-openclaw-password-input');
  const llmOpenclawSessionInput  = document.getElementById('llm-openclaw-session-input');
  const ttsServiceSelect      = document.getElementById('tts-service-select');
  const ttsOpenaiApiKeyInput   = document.getElementById('tts-openai-api-key-input');
  const ttsOpenaiModelInput    = document.getElementById('tts-openai-model-input');
  const ttsOpenaiVoiceInput    = document.getElementById('tts-openai-voice-input');
  const ttsOpenaiSpeedInput    = document.getElementById('tts-openai-speed-input');
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

  document.getElementById('btn-settings').addEventListener('click', async () => {
    const config = await window.electronAPI.getConfig();
    const model = config.model ?? {};
    const llm   = config.llm   ?? {};
    const llmOpenai = llm.openai ?? {};
    modelDirInput.value        = model.modelDir      || DEFAULTS.model.modelDir;
    modelScaleInput.value      = model.modelScale    ?? DEFAULTS.model.modelScale;
    llmServiceSelect.value     = llm.service         || DEFAULTS.llm.service;
    llmCharacterInput.value    = llm.character        || DEFAULTS.llm.character;
    llmOpenaiApiKeyInput.value = llmOpenai.apiKey    || '';
    llmOpenaiModelInput.value  = llmOpenai.model     || DEFAULTS.llm.openai.model;
    const llmOpenclaw = llm.openclaw ?? {};
    llmOpenclawUrlInput.value      = llmOpenclaw.url        || '';
    llmOpenclawTokenInput.value    = llmOpenclaw.token      || '';
    llmOpenclawPasswordInput.value = llmOpenclaw.password   || '';
    llmOpenclawSessionInput.value  = llmOpenclaw.sessionKey || '';
    const tts = config.tts ?? {};
    const ttsOpenai = tts.openai ?? {};
    ttsServiceSelect.value     = tts.service          || DEFAULTS.tts.service;
    ttsOpenaiApiKeyInput.value = ttsOpenai.apiKey     || '';
    ttsOpenaiModelInput.value  = ttsOpenai.model      || DEFAULTS.tts.openai.model;
    ttsOpenaiVoiceInput.value  = ttsOpenai.voice      || DEFAULTS.tts.openai.voice;
    ttsOpenaiSpeedInput.value  = ttsOpenai.speed      ?? DEFAULTS.tts.openai.speed;
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
        modelScale: modelScaleInput.value !== '' ? Number(modelScaleInput.value) : DEFAULTS.model.modelScale,
      },
      llm: {
        service: llmServiceSelect.value || DEFAULTS.llm.service,
        character: llmCharacterInput.value.trim() || DEFAULTS.llm.character,
        openai: {
          apiKey: llmOpenaiApiKeyInput.value.trim() || undefined,
          model:  llmOpenaiModelInput.value.trim()  || DEFAULTS.llm.openai.model,
        },
        openclaw: {
          url:        llmOpenclawUrlInput.value.trim()      || undefined,
          token:      llmOpenclawTokenInput.value.trim()    || undefined,
          password:   llmOpenclawPasswordInput.value.trim() || undefined,
          sessionKey: llmOpenclawSessionInput.value.trim()  || undefined,
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
}
