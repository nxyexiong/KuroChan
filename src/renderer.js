/**
 * renderer.js — entry point
 * Wires up UI event handlers, then delegates app bootstrap to core.js.
 */

import './styles/main.css';
import { setStatus } from './ui.js';
import { initSettings } from './settings.js';
import { initCore } from './core.js';
import { summarizeSession } from './llm/llm.js';

// ── Close button ───────────────────────────────────────────────────────────────────
document.getElementById('btn-close').addEventListener('click', async () => {
  setStatus('💾 Saving memory…');
  try {
    const summary = await summarizeSession();
    if (summary) {
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      await window.electronAPI.saveMemory({ timestamp, memory: summary });
    }
  } catch { /* best-effort — always close */ }
  window.electronAPI.closeWindow();
});

// ── Settings ──────────────────────────────────────────────────────────────────
initSettings();

// ── Live2D Core guard ─────────────────────────────────────────────────────────
if (!window.Live2DCubismCore) {
  setStatus('⚠ Live2D Core missing — add libs/live2dcubismcore.min.js (see README)');
  throw new Error('Live2DCubismCore not found');
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
initCore();

