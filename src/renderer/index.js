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
import backend, { capabilities } from './backend.js';

// ── Settings ──────────────────────────────────────────────────────────────────
initSettings();

// ── Live2D Core guard ─────────────────────────────────────────────────────────
if (!window.Live2DCubismCore) {
  setStatus('⚠ Live2D Core missing — add libs/live2dcubismcore.min.js (see README)');
  throw new Error('Live2DCubismCore not found');
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const config = await backend.getConfig();

  const modelConfig = config.model ?? {};
  const modelPath = await backend.resolveModelDir(modelConfig.modelDir);
  if (!modelPath) {
    setStatus('⚙ No model found — click ⚙ to choose a model folder');
  } else {
    await loadModel(modelPath);
  }

  initChat();
  initTTSPlayer();
  await initSTTButton();
}

// ── Window chrome (feature-detected, not host-detected) ─────────────────────────
// Only a host that owns a desktop window (Electron) gets the drag/close buttons;
// a web browser provides its own window chrome.
if (!capabilities.windowControls) {
  document.getElementById('btn-toggle')?.remove();
  document.getElementById('btn-close')?.remove();
}

// ── Buttons ───────────────────────────────────────────────────────────────────
document.getElementById('btn-close')?.addEventListener('click', () => {
  backend.closeWindow();
});

// ── Hotkeys ───────────────────────────────────────────────────────────────────
backend.onToggleMic(() => {
  document.getElementById('btn-mic')?.click();
});

// ── Start ─────────────────────────────────────────────────────────────────────
await init();
