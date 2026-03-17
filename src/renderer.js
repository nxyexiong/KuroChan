/**
 * renderer.js — entry point
 * Wires up the three modules: ui, model, settings.
 */

import './styles/main.css';
import { setStatus } from './ui.js';
import { loadModel } from './model.js';
import { initSettings } from './settings.js';

// ── Close button ──────────────────────────────────────────────────────────────
document.getElementById('btn-close').addEventListener('click', () =>
  window.electronAPI.closeWindow()
);

// ── Settings ──────────────────────────────────────────────────────────────────
initSettings();

// ── Live2D Core guard ─────────────────────────────────────────────────────────
if (!window.Live2DCubismCore) {
  setStatus('⚠ Live2D Core missing — add libs/live2dcubismcore.min.js (see README)');
  throw new Error('Live2DCubismCore not found');
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
(async () => {
  const config = await window.electronAPI.getConfig();
  if (!config.modelPath) {
    setStatus('⚙ No model found — click ⚙ to choose a model folder');
    return;
  }
  await loadModel(config.modelPath);
})();

