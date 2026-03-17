/**
 * core.js — Application bootstrap.
 *
 * Reads and parses the top-level config, then routes each config section to
 * the appropriate module initialiser. Add new modules here as the app grows.
 */

import { setStatus } from './ui.js';
import { loadModel } from './model/model.js';
import { configureLLM, input as llmInput, outputStream as llmOutputStream } from './llm/llm.js';
import { configureTTS } from './tts/tts.js';
import { BuiltinChatService } from './chat/builtin-chat-service.js';
import { initChat } from './chat/chat.js';

export async function initCore() {
  const config = await window.electronAPI.getConfig();

  // ── General ──────────────────────────────────────────────────────────────
  await initGeneral(config.general ?? {});

  // ── Model ─────────────────────────────────────────────────────────────────
  await initModel(config.model ?? {});

  // ── LLM ───────────────────────────────────────────────────────────────────
  initLLM(config.llm ?? {});

  // ── TTS ───────────────────────────────────────────────────────────────────
  initTTS(config.tts ?? {});

  // ── Chat ──────────────────────────────────────────────────────────────────
  initChatModule();
}

// ── Section initialisers ──────────────────────────────────────────────────────

async function initGeneral(_generalConfig) {
  // reserved for future general settings
}

async function initModel({ modelPath }) {
  if (!modelPath) {
    setStatus('⚙ No model found — click ⚙ to choose a model folder');
    return;
  }
  await loadModel(modelPath);
}

function initLLM(llmConfig) {
  configureLLM(llmConfig);
}

function initTTS(ttsConfig) {
  configureTTS(ttsConfig);
}

function initChatModule() {
  const service = new BuiltinChatService(llmInput, llmOutputStream);
  initChat(service);
}
