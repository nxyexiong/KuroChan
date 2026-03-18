/**
 * model.js — PixiJS app creation and Live2D model loading / dragging
 */

import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import { setStatus, hideStatusAfter } from '../ui.js';

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

/** Desired mouth open value set externally; applied inside coreModel.update(). */
let _lipSyncValue = 0;

/**
 * Set the desired mouth-open value. Takes effect on the very next rendered frame.
 * @param {number} value  0 (closed) to 1 (fully open)
 */
export function setMouthOpen(value) {
  _lipSyncValue = Math.max(0, Math.min(1, value));
}

// ── Load and display a model ──────────────────────────────────────────────────
export async function loadModel(modelPath, modelScale = 100) {
  // Destroy any previously loaded model
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
  // Live2D bakes parameters into drawable outputs — the only reliable hook.
  const coreModel = model.internalModel.coreModel;
  const _origCoreUpdate = coreModel.update.bind(coreModel);
  coreModel.update = () => {
    try {
      coreModel.setParameterValueById('ParamMouthOpenY', _lipSyncValue, 1.0);
    } catch { /* parameter may not exist on every model */ }
    _origCoreUpdate();
  };

  _fitModel(model, modelScale);
  app.renderer.on('resize', () => _fitModel(model, modelScale));
  _enableDrag(model);

  setStatus('✓ Model loaded');
  hideStatusAfter(3000);
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
