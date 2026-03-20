/**
 * core.js — Renderer bootstrap.
 *
 * Reads config, loads the model, and initialises UI modules.
 * No business logic here — all logic runs in main process.
 */

import { setStatus } from './ui.js';
import { loadModel } from './model/model.js';
import { initChat } from './chat/chat.js';
import { initTTSPlayer } from './tts/tts-player.js';
import { initSTTButton } from './stt/stt-ui.js';

export async function initCore() {
  const config = await window.electronAPI.getConfig();

  // ── Model ─────────────────────────────────────────────────────────────────
  const modelConfig = config.model ?? {};
  if (!modelConfig.modelPath) {
    setStatus('⚙ No model found — click ⚙ to choose a model folder');
  } else {
    await loadModel(modelConfig.modelPath, modelConfig.modelScale);
  }

  // ── Chat UI ───────────────────────────────────────────────────────────────
  initChat();

  // ── TTS Player (audio playback + lip sync volume) ─────────────────────────
  initTTSPlayer();

  // ── STT button ────────────────────────────────────────────────────────────
  await initSTTButton();
}
