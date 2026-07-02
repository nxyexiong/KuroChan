/**
 * model.js — PixiJS app creation and Live2D model loading / dragging (renderer).
 *
 * Pure visual: renders the Live2D model, handles zoom/drag, and applies
 * parameter changes received from the main process via IPC.
 */

import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import { setStatus } from '../status.js';
import backend from '../backend.js';

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

backend.onModelCursorPos(({ x, y }) => {
  _cursorTargetX = x;
  _cursorTargetY = y;
});

// ── Listen for parameter updates from main ────────────────────────────────────
backend.onModelSetParam(({ id, value, weight }) => {
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
  _enableInteraction(model);

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

/**
 * Model drag + zoom, driven by raw pointer events on the canvas so it works with
 * both a mouse and touch — independent of the surrounding UI, which is locked on
 * web (see .web-host CSS + web-api.js). The model stays movable (1 pointer drag)
 * and zoomable (2-pointer pinch on touch, mouse wheel on desktop) while the
 * buttons/chat box stay fixed and can't be pinch-zoomed.
 */
function _enableInteraction(model) {
  const view = app.view;
  view.style.touchAction = 'none'; // we handle canvas gestures; no browser pan/zoom here

  const pointers = new Map(); // pointerId -> { x, y } in client coords
  let dragging = false;
  let dragOffX = 0, dragOffY = 0;
  let pinchDist0 = 0, pinchScale0 = 1;

  const twoDist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const startDragFrom = (client) => {
    const s = _toStage(client.x, client.y);
    dragOffX = s.x - model.x;
    dragOffY = s.y - model.y;
    dragging = true;
  };
  const setScale = (v) => model.scale.set(Math.max(0.05, Math.min(20, v)));

  view.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      startDragFrom({ x: e.clientX, y: e.clientY });
    } else if (pointers.size === 2) {
      dragging = false;                 // second finger → pinch, not drag
      pinchDist0 = twoDist();
      pinchScale0 = model.scale.x;
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      if (pinchDist0 > 0) setScale(pinchScale0 * (twoDist() / pinchDist0));
    } else if (dragging) {
      const s = _toStage(e.clientX, e.clientY);
      model.x = s.x - dragOffX;
      model.y = s.y - dragOffY;
    }
  });

  const release = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist0 = 0;
    if (pointers.size === 0) dragging = false;
    else if (pointers.size === 1) startDragFrom([...pointers.values()][0]); // resume drag after pinch
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  // Desktop mouse-wheel zoom.
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
    setScale(model.scale.x * factor);
  }, { passive: false });
}
