/**
 * renderer.js — entry point
 * Wires up UI event handlers, then delegates app bootstrap to core.js.
 */

import './styles/main.css';
import { setStatus } from './ui.js';
import { initSettings } from './settings.js';
import { initCore } from './core.js';

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
initCore();

