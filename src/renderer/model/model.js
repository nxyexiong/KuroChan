/**
 * model.js — PixiJS app creation and Live2D model loading / dragging (renderer).
 *
 * Pure visual: renders the Live2D model, handles zoom/drag, and applies
 * parameter changes received from the main process via IPC.
 */

import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import { setStatus } from '../status.js';

Live2DModel.registerTicker(PIXI.Ticker);

export const app = new PIXI.Application({
  backgroundAlpha: 0,
  antialias: true,
  autoDensity: true,
  resolution: window.devicePixelRatio || 1,
  resizeTo: window,
});

document.body.appendChild(app.view);

/** Currently loaded Live2D model instance, or null. */
let _currentModel = null;

/** Desired mouth open value, driven by model:set-parameter IPC from main. */
let _lipSyncValue = 0;

/** Normalised cursor offset (−1…1) for eye / head tracking. */
let _cursorTargetX = 0;
let _cursorTargetY = 0;
let _cursorX = 0;
let _cursorY = 0;
const CURSOR_LERP = 0.08;

window.electronAPI.onModelCursorPos(({ x, y }) => {
  _cursorTargetX = x;
  _cursorTargetY = y;
});

// ── Listen for parameter updates from main ────────────────────────────────────
window.electronAPI.onModelSetParam(({ id, value, weight }) => {
  if (!_currentModel) return;
  // Lip sync parameter is stored for per-frame application (smooth animation)
  if (id === 'ParamMouthOpenY') {
    _lipSyncValue = Math.max(0, Math.min(1, value));
    return;
  }
  try {
    _currentModel.internalModel.coreModel.setParameterValueById(id, value, weight);
  } catch { /* parameter may not exist on every model */ }
});

// ── Load and display a model ──────────────────────────────────────────────────
export async function loadModel(modelPath, modelScale = 100) {
  app.stage.removeChildren();
  setStatus('Loading model…');

  let model;
  try {
    model = await Live2DModel.from(modelPath);
  } catch (err) {
    console.error(err);
    setStatus(`⚠ Could not load model: ${err.message} — click ⚙ to fix the path`);
    return;
  }

  app.stage.addChild(model);
  _currentModel = model;

  // Wrap coreModel.update so our lip sync value is injected just before
  // Live2D bakes parameters into drawable outputs.
  const coreModel = model.internalModel.coreModel;
  const _origCoreUpdate = coreModel.update.bind(coreModel);
  coreModel.update = () => {
    // Smoothly interpolate cursor position toward target
    _cursorX += (_cursorTargetX - _cursorX) * CURSOR_LERP;
    _cursorY += (_cursorTargetY - _cursorY) * CURSOR_LERP;

    try { coreModel.setParameterValueById('ParamMouthOpenY', _lipSyncValue, 1.0); } catch {}
    // Eye / head / body tracking driven by global cursor position
    try { coreModel.setParameterValueById('ParamEyeBallX',    _cursorX,       0.8); } catch {}
    try { coreModel.setParameterValueById('ParamEyeBallY',   -_cursorY,       0.8); } catch {}
    try { coreModel.setParameterValueById('ParamAngleX',      _cursorX * 30,  0.6); } catch {}
    try { coreModel.setParameterValueById('ParamAngleY',     -_cursorY * 30,  0.6); } catch {}
    try { coreModel.setParameterValueById('ParamAngleZ',     -_cursorX * 10,  0.4); } catch {}
    try { coreModel.setParameterValueById('ParamBodyAngleX',  _cursorX * 10,  0.4); } catch {}
    _origCoreUpdate();
  };

  _fitModel(model, modelScale);
  app.renderer.on('resize', () => _fitModel(model, modelScale));
  _enableDrag(model);
  _enableWheel(model);

  setStatus('✓ Model loaded', 3000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _fitModel(model, modelScale = 100) {
  const scale = Math.min(
    app.screen.width  / model.internalModel.originalWidth,
    app.screen.height / model.internalModel.originalHeight,
  ) * (modelScale / 100);

  model.scale.set(scale);
  model.anchor.set(0.5, 0.5);
  model.x = app.screen.width  / 2;
  model.y = app.screen.height / 2;
}

function _toStage(clientX, clientY) {
  const rect = app.view.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (app.screen.width  / rect.width),
    y: (clientY - rect.top)  * (app.screen.height / rect.height),
  };
}

function _enableDrag(model) {
  model.interactive = true;
  model.buttonMode  = true;

  let dragging = false;
  let dragOffsetX = 0, dragOffsetY = 0;

  model.on('pointerdown', (e) => {
    const s = _toStage(e.data.originalEvent.clientX, e.data.originalEvent.clientY);
    dragOffsetX = s.x - model.x;
    dragOffsetY = s.y - model.y;
    dragging = true;
  });

  app.view.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const s = _toStage(e.clientX, e.clientY);
    model.x = s.x - dragOffsetX;
    model.y = s.y - dragOffsetY;
  });

  window.addEventListener('pointerup', () => { dragging = false; });
}

function _enableWheel(model) {
  app.view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
    const next   = Math.max(0.05, Math.min(20, model.scale.x * factor));
    model.scale.set(next);
  }, { passive: false });
}
