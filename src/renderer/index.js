/**
 * index.js — Renderer entry point.
 * Wires up UI event handlers, reads config, loads the model,
 * and initialises all UI modules.
 */

import './styles/main.css';
import { setStatus } from './status.js';
import { initSettings } from './settings.js';
import { loadModel } from './model/model.js';
import { initChat } from './chat/chat.js';
import { initTTSPlayer } from './tts/tts-player.js';
import { initSTTButton } from './stt/stt-ui.js';

// ── Settings ──────────────────────────────────────────────────────────────────
initSettings();

// ── Live2D Core guard ─────────────────────────────────────────────────────────
if (!window.Live2DCubismCore) {
  setStatus('⚠ Live2D Core missing — add libs/live2dcubismcore.min.js (see README)');
  throw new Error('Live2DCubismCore not found');
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const config = await window.electronAPI.getConfig();

  const modelConfig = config.model ?? {};
  const modelPath = await window.electronAPI.resolveModelDir(modelConfig.modelDir);
  if (!modelPath) {
    setStatus('⚙ No model found — click ⚙ to choose a model folder');
  } else {
    await loadModel(modelPath);
  }

  initChat();
  initTTSPlayer();
  await initSTTButton();
}

// ── Buttons ───────────────────────────────────────────────────────────────────
document.getElementById('btn-save').addEventListener('click', async () => {
  setStatus('💾 Saving memory…', 0);
  try {
    const summary = await window.electronAPI.llmSummarize();
    if (summary) {
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      await window.electronAPI.saveMemory({ timestamp, memory: summary });
    }
    setStatus('✅ Memory saved');
  } catch { setStatus('⚠ Failed to save memory'); }
});

document.getElementById('btn-close').addEventListener('click', () => {
  window.electronAPI.closeWindow();
});

// ── Hotkeys ───────────────────────────────────────────────────────────────────
window.electronAPI.onToggleMic(() => {
  document.getElementById('btn-mic')?.click();
});

// ── Start ─────────────────────────────────────────────────────────────────────
await init();
